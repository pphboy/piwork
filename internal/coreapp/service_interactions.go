package coreapp

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/netip"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/rpc/servicesv1"
	"piwork/internal/workaccess"
)

type serviceInteractionIdentity struct {
	WorkID      string `json:"workId"`
	ServiceID   string `json:"serviceId"`
	ServiceName string `json:"serviceName"`
	Token       string `json:"token"`
	ContainerID string `json:"containerId"`
	Revision    int64  `json:"revision"`
}
type serviceInteractionBinding struct {
	serviceInteractionIdentity
	Address string                   `json:"address"`
	Ports   []serviceInteractionPort `json:"ports"`
}
type serviceInteractionPort struct {
	Name     string `json:"name"`
	Port     int64  `json:"port"`
	Protocol string `json:"protocol"`
}

func serviceInteractionKey(workID, serviceID string) string {
	return "service_interaction_" + workID + "_" + serviceID
}
func readInteractionIdentity(tx *sql.Tx, workID, serviceID string) (serviceInteractionIdentity, error) {
	var raw string
	err := tx.QueryRow("SELECT value_json FROM control_metadata WHERE key=?", serviceInteractionKey(workID, serviceID)).Scan(&raw)
	if err != nil {
		return serviceInteractionIdentity{}, err
	}
	var v serviceInteractionIdentity
	if strictMetadata([]byte(raw), &v) != nil || v.WorkID != workID || v.ServiceID != serviceID || len(v.Token) != 64 || v.Revision < 1 {
		return v, corestore.ErrStorage
	}
	if b, err := hex.DecodeString(v.Token); err != nil || len(b) != 32 {
		return v, corestore.ErrStorage
	}
	return v, nil
}
func (a *Application) prepareServiceInteraction(ctx context.Context, target serviceTarget, name string) (serviceInteractionIdentity, string, string, error) {
	var v serviceInteractionIdentity
	err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.serviceTargetTx(tx, target); err != nil {
			return err
		}
		prior, err := readInteractionIdentity(tx, target.WorkID, target.ServiceID)
		if err == nil {
			if prior.Revision != target.Revision || prior.ServiceName != name {
				return errWorkSuperseded
			}
			v = prior
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		secret := make([]byte, 32)
		if _, err = rand.Read(secret); err != nil {
			return err
		}
		v = serviceInteractionIdentity{target.WorkID, target.ServiceID, name, hex.EncodeToString(secret), "", target.Revision}
		raw, _ := json.Marshal(v)
		_, err = tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?)", serviceInteractionKey(target.WorkID, target.ServiceID), string(raw), packageNow())
		return err
	})
	if err != nil {
		return v, "", "", err
	}
	if a.agentTLS == nil {
		return v, "", "", errCapturedWork
	}
	config, ca, err := a.agentTLS.WriteServiceInteractionConfig(ctx, target.WorkID, target.ServiceID, name, v.Token)
	return v, config, ca, err
}
func (a *Application) bindServiceInteractionTx(tx *sql.Tx, target serviceTarget, identity serviceInteractionIdentity, containerID string) error {
	current, err := readInteractionIdentity(tx, target.WorkID, target.ServiceID)
	if err != nil {
		return err
	}
	if current.Token != identity.Token || current.Revision != target.Revision || current.ContainerID != "" && current.ContainerID != containerID {
		return errWorkSuperseded
	}
	current.ContainerID = containerID
	raw, _ := json.Marshal(current)
	_, err = tx.Exec("UPDATE control_metadata SET value_json=?,updated_at=? WHERE key=?", string(raw), packageNow(), serviceInteractionKey(target.WorkID, target.ServiceID))
	return err
}

// Only this ready Agent's private RPC may read secrets. Every returned route is
// proved against the persistent service revision and exact owned Docker instance.
func (a *Application) serviceInteractionBindings(ctx context.Context, actor serviceActor, workID string) (any, error) {
	if actor.Runtime == nil || actor.User != nil {
		return nil, contracts.NewError("PERMISSION_DENIED", "")
	}
	var ids []string
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		if _, err := a.authorizeServiceTx(tx, actor, workID, workaccess.Interact); err != nil {
			return err
		}
		rows, err := tx.Query("SELECT service_id FROM service_heads WHERE work_id=? AND enabled=1 AND tombstoned_at IS NULL ORDER BY service_id", workID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err = rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	bindings := []serviceInteractionBinding{}
	for _, id := range ids {
		var v serviceInteractionIdentity
		var definition contracts.ServiceDefinition
		err = a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			v, err = readInteractionIdentity(tx, workID, id)
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			if err != nil {
				return err
			}
			var raw string
			err = tx.QueryRow("SELECT definition_json FROM service_revisions WHERE work_id=? AND service_id=? AND revision=?", workID, id, v.Revision).Scan(&raw)
			if err != nil {
				return err
			}
			definition, err = contracts.Decode[contracts.ServiceDefinition](strings.NewReader(raw), "ServiceDefinitionSchema", 2<<20)
			return err
		})
		if err != nil {
			return nil, err
		}
		if v.Token == "" || v.ContainerID == "" {
			continue
		}
		view, binding, err := a.inspectServiceRuntime(ctx, workID, id)
		if err != nil {
			return nil, err
		}
		if view == nil || binding == nil || view.State == nil || !view.State.Running || view.ID != v.ContainerID || view.Config.Labels[serviceRevisionLabel] != strconv.FormatInt(v.Revision, 10) {
			continue
		}
		network, err := a.dockerRuntime.EnsureNetwork(ctx, workID)
		if err != nil {
			return nil, err
		}
		address, err := a.dockerRuntime.ContainerAddress(ctx, serviceContainerIdentity(workID, id, v.Revision), network.Name)
		if err != nil {
			return nil, err
		}
		parsed, err := netip.ParseAddr(address)
		if err != nil || !parsed.Is4() || parsed.IsUnspecified() || parsed.IsLoopback() {
			return nil, corestore.ErrStorage
		}
		ports := []serviceInteractionPort{}
		for _, p := range definition.Ports {
			ports = append(ports, serviceInteractionPort{string(p.Name), p.ContainerPort, p.Protocol})
		}
		bindings = append(bindings, serviceInteractionBinding{v, address, ports})
	}
	// A Stop/Apply racing Docker reads invalidates publication of this generation.
	err = a.Store.Read(ctx, func(tx *sql.Tx) error {
		if _, err := a.authorizeServiceTx(tx, actor, workID, workaccess.Interact); err != nil {
			return err
		}
		for _, binding := range bindings {
			current, err := readInteractionIdentity(tx, workID, binding.ServiceID)
			if err != nil || current != binding.serviceInteractionIdentity {
				return errWorkSuperseded
			}
			service, err := corestore.ReadService(tx, workID, binding.ServiceID, false)
			if err != nil || !service.Enabled {
				return errWorkSuperseded
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return struct {
		WorkID   string                      `json:"workId"`
		Bindings []serviceInteractionBinding `json:"bindings"`
	}{workID, bindings}, nil
}
func (server *serviceRPC) GetServiceInteractionBindings(ctx context.Context, request *servicesv1.Empty) (*servicesv1.WorkPrivateResponse, error) {
	actor, workID, err := rpcActor(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, status.Error(codes.InvalidArgument, "invalid binding request")
	}
	result, err := server.App.serviceInteractionBindings(ctx, actor, workID)
	if err != nil {
		return nil, rpcServiceError(err)
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return nil, status.Error(codes.Unavailable, "bindings unavailable")
	}
	return &servicesv1.WorkPrivateResponse{ValueJson: string(raw)}, nil
}
