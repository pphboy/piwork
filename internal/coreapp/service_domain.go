package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
)

var serviceHostnamePattern = regexp.MustCompile(`^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\.w-[a-f0-9]{8,61}\.work$`)

type serviceAccessPort struct {
	Name string `json:"name"`
	Port int64  `json:"port"`
	URL  string `json:"url"`
}
type serviceAccess struct {
	Hostname        string              `json:"hostname"`
	DefaultURL      *string             `json:"defaultUrl"`
	DefaultPortName *string             `json:"defaultPortName"`
	Status          string              `json:"status"`
	Ports           []serviceAccessPort `json:"ports"`
}

func normalizeServiceHostname(raw string) (string, bool) {
	if len(raw) > 254 {
		return "", false
	}
	for _, char := range raw {
		if char < 33 || char > 126 {
			return "", false
		}
	}
	value := strings.ToLower(strings.TrimSuffix(raw, "."))
	return value, serviceHostnamePattern.MatchString(value)
}
func serviceTCPPorts(definition contracts.ServiceDefinition) ([]contracts.ServicePort, *contracts.ServicePort) {
	ports := []contracts.ServicePort{}
	for _, port := range definition.Ports {
		if port.Protocol == "tcp" {
			ports = append(ports, port)
		}
	}
	sort.Slice(ports, func(i, j int) bool {
		if ports[i].ContainerPort != ports[j].ContainerPort {
			return ports[i].ContainerPort < ports[j].ContainerPort
		}
		return ports[i].Name < ports[j].Name
	})
	for i := range ports {
		if ports[i].ContainerPort == 80 {
			return ports, &ports[i]
		}
	}
	if definition.Readiness.Present && definition.Readiness.Value.Kind == "http" {
		for i := range ports {
			if ports[i].Name == definition.Readiness.Value.PortName.Value {
				return ports, &ports[i]
			}
		}
	}
	return ports, nil
}
func serviceEligible(work corestore.WorkRecord, service corestore.ServiceRecord) bool {
	return work.DesiredState == "running" && (work.ObservedState == "ready" || work.ObservedState == "degraded") && service.Enabled && service.ObservedState == "ready" && service.TombstonedAt == nil
}

// Domain display and resolution share this boundary. Domain assignments live
// in installation metadata, independently of Work config and exported bytes.
type serviceDomainResolver struct {
	Store   *corestore.Store
	Inspect func(context.Context, string, string) (bool, error)
}

func (a *Application) serviceDomains() serviceDomainResolver {
	return serviceDomainResolver{Store: a.Store, Inspect: func(ctx context.Context, workID, serviceID string) (bool, error) {
		view, _, err := a.inspectServiceRuntime(ctx, workID, serviceID)
		return view != nil && view.State != nil && view.State.Running, err
	}}
}
func (resolver serviceDomainResolver) describe(ctx context.Context, work corestore.WorkRecord, service corestore.ServiceRecord) (serviceAccess, error) {
	var access serviceAccess
	if err := resolver.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT s.label || '.' || w.name || '.work' FROM service_domain_labels s JOIN work_network_names w ON w.work_id=s.work_id WHERE s.work_id=? AND s.service_id=?`, work.ID, service.ServiceID).Scan(&access.Hostname)
	}); err != nil {
		return access, err
	}
	var definition contracts.ServiceDefinition
	if json.Unmarshal([]byte(service.DefinitionJSON), &definition) != nil {
		return access, corestore.ErrStorage
	}
	ports, selected := serviceTCPPorts(definition)
	access.Ports = []serviceAccessPort{}
	for _, port := range ports {
		access.Ports = append(access.Ports, serviceAccessPort{Name: string(port.Name), Port: port.ContainerPort, URL: "http://" + access.Hostname + ":" + strconv.FormatInt(port.ContainerPort, 10) + "/"})
	}
	if selected != nil {
		url, name := "http://"+access.Hostname+"/", string(selected.Name)
		access.DefaultURL = &url
		access.DefaultPortName = &name
	}
	access.Status = "unavailable"
	if serviceEligible(work, service) && resolver.Inspect != nil {
		if ready, err := resolver.Inspect(ctx, work.ID, service.ServiceID); err == nil && ready {
			if selected != nil {
				access.Status = "available"
			} else if len(ports) > 0 {
				access.Status = "no-default-port"
			}
		}
	}
	return access, nil
}

func (resolver serviceDomainResolver) lookup(ctx context.Context, raw string) (corestore.WorkRecord, corestore.ServiceRecord, error) {
	var work corestore.WorkRecord
	var service corestore.ServiceRecord
	hostname, valid := normalizeServiceHostname(raw)
	if !valid {
		return work, service, contracts.NewError("NOT_FOUND", "")
	}
	parts := strings.Split(hostname, ".")
	err := resolver.Store.Read(ctx, func(tx *sql.Tx) error {
		var workID, serviceID string
		if err := tx.QueryRow(`SELECT s.work_id,s.service_id FROM service_domain_labels s JOIN work_network_names w ON w.work_id=s.work_id WHERE s.label=? AND w.name=?`, parts[0], parts[1]).Scan(&workID, &serviceID); err != nil {
			return corestore.ErrNotFound
		}
		var err error
		work, err = corestore.ReadWork(tx, workID, false)
		if err != nil {
			return err
		}
		service, err = corestore.ReadService(tx, workID, serviceID, false)
		return err
	})
	return work, service, servicePublicError(err)
}
func selectedServicePort(service corestore.ServiceRecord, requested *int64) (int64, error) {
	if requested != nil && (*requested < 1 || *requested > 65535) {
		return 0, contracts.NewError("PORT_NOT_DECLARED", "")
	}
	var definition contracts.ServiceDefinition
	if json.Unmarshal([]byte(service.DefinitionJSON), &definition) != nil {
		return 0, corestore.ErrStorage
	}
	ports, selected := serviceTCPPorts(definition)
	if requested != nil {
		for _, port := range ports {
			if port.ContainerPort == *requested {
				return port.ContainerPort, nil
			}
		}
		if *requested != 80 {
			return 0, contracts.NewError("PORT_NOT_DECLARED", "")
		}
	}
	if selected == nil {
		return 0, contracts.NewError("PORT_REQUIRED", "")
	}
	return selected.ContainerPort, nil
}
