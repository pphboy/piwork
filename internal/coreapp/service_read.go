package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/workaccess"
)

type publicServiceView struct {
	MemoryLimitMode string                      `json:"memoryLimitMode"`
	WorkID          string                      `json:"workId"`
	ServiceID       string                      `json:"serviceId"`
	Name            string                      `json:"name"`
	DesiredRevision int64                       `json:"desiredRevision"`
	AppliedRevision *int64                      `json:"appliedRevision"`
	Enabled         bool                        `json:"enabled"`
	ObservedState   string                      `json:"observedState"`
	LastError       any                         `json:"lastError"`
	Definition      contracts.ServiceDefinition `json:"definition"`
	Endpoints       []contracts.ServiceEndpoint `json:"endpoints"`
	CreatedAt       string                      `json:"createdAt"`
	Access          serviceAccess               `json:"access"`
}

func safeServiceDiagnostic(raw *string, serviceID string) any {
	if raw == nil {
		return nil
	}
	var value struct {
		Code          string
		Stage         string
		CorrelationID string
		ExitCode      *int
	}
	if json.Unmarshal([]byte(*raw), &value) != nil || !validDiagnosticStage(value.Stage) {
		return nil
	}
	message, remediation, retryable, known := safeDiagnosticText(value.Code)
	if !known {
		return nil
	}
	view := map[string]any{"code": value.Code, "stage": value.Stage, "message": message, "remediation": remediation, "retryable": retryable, "serviceId": serviceID}
	if validResourceID(value.CorrelationID) {
		view["correlationId"] = value.CorrelationID
	}
	if value.ExitCode != nil {
		view["exitCode"] = *value.ExitCode
	}
	return view
}

func (a *Application) serviceView(ctx context.Context, work corestore.WorkRecord, record corestore.ServiceRecord) (publicServiceView, error) {
	var definition contracts.ServiceDefinition
	if json.Unmarshal([]byte(record.DefinitionJSON), &definition) != nil {
		return publicServiceView{}, corestore.ErrStorage
	}
	endpoints := []contracts.ServiceEndpoint{}
	for _, port := range definition.Ports {
		endpoint := contracts.ServiceEndpoint{Name: port.Name, Protocol: port.Protocol, Host: "svc-" + definition.Name, Port: port.ContainerPort}
		if definition.Readiness.Present && definition.Readiness.Value.Kind == "http" && definition.Readiness.Value.PortName.Value == port.Name {
			endpoint.Url = contracts.Supplied("http://" + endpoint.Host + ":" + strconv.FormatInt(port.ContainerPort, 10) + definition.Readiness.Value.Path.Value)
		}
		endpoints = append(endpoints, endpoint)
	}
	probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	access, err := a.serviceDomains().describe(probeCtx, work, record)
	if err != nil {
		return publicServiceView{}, err
	}
	return publicServiceView{MemoryLimitMode: "unlimited", WorkID: record.WorkID, ServiceID: record.ServiceID, Name: record.Name, DesiredRevision: record.DesiredRevision, AppliedRevision: record.AppliedRevision, Enabled: record.Enabled, ObservedState: record.ObservedState, LastError: safeServiceDiagnostic(record.LastErrorJSON, record.ServiceID), Definition: definition, Endpoints: endpoints, CreatedAt: record.CreatedAt, Access: access}, nil
}
func (a *Application) readService(ctx context.Context, actor serviceActor, workID, serviceID string) (publicServiceView, error) {
	var work corestore.WorkRecord
	var record corestore.ServiceRecord
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		work, err = a.authorizeServiceTx(tx, actor, workID, workaccess.Metadata)
		if err != nil {
			return err
		}
		record, err = corestore.ReadService(tx, workID, serviceID, false)
		return err
	})
	if err != nil {
		return publicServiceView{}, servicePublicError(err)
	}
	return a.serviceView(ctx, work, record)
}
func (a *Application) listServices(ctx context.Context, actor serviceActor, workID string) ([]publicServiceView, error) {
	var work corestore.WorkRecord
	var records []corestore.ServiceRecord
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		work, err = a.authorizeServiceTx(tx, actor, workID, workaccess.Metadata)
		if err != nil {
			return err
		}
		records, err = corestore.ReadServices(tx, workID, false)
		return err
	})
	if err != nil {
		return nil, servicePublicError(err)
	}
	views := []publicServiceView{}
	for _, record := range records {
		view, err := a.serviceView(ctx, work, record)
		if err != nil {
			return nil, err
		}
		views = append(views, view)
	}
	return views, nil
}

type serviceLogView struct {
	ServiceID   string `json:"serviceId"`
	Status      string `json:"status"`
	Text        string `json:"text"`
	Truncated   bool   `json:"truncated"`
	CollectedAt string `json:"collectedAt"`
	Reason      string `json:"reason,omitempty"`
}

var serviceLogSecret = regexp.MustCompile(`(?i)(token|password|secret|api[_-]?key)\s*[=:]\s*\S+`)

func redactServiceOutput(text string, definition contracts.ServiceDefinition) string {
	text = serviceLogSecret.ReplaceAllString(text, "$1=[redacted]")
	for key, raw := range definition.Environment {
		if !regexpSecretKey.MatchString(key) {
			continue
		}
		var secret string
		if json.Unmarshal(raw, &secret) == nil && secret != "" {
			text = strings.ReplaceAll(text, secret, "[redacted]")
		}
	}
	return strings.ToValidUTF8(text, "�")
}

var regexpSecretKey = regexp.MustCompile(`(?i)(token|password|secret|api[_-]?key)`)

func (a *Application) serviceLogs(ctx context.Context, actor serviceActor, workID, serviceID string, lines int) (serviceLogView, error) {
	view := serviceLogView{ServiceID: serviceID, Status: "unavailable", CollectedAt: packageNow(), Reason: "service instance is unavailable"}
	var record corestore.ServiceRecord
	var boundInstance *string
	authorize := func(tx *sql.Tx) error {
		if _, err := a.authorizeServiceTx(tx, actor, workID, workaccess.Content); err != nil {
			return err
		}
		var err error
		record, err = corestore.ReadService(tx, workID, serviceID, false)
		if err != nil {
			return err
		}
		binding, err := corestore.ReadServiceRuntimeBinding(tx, workID, serviceID)
		if errors.Is(err, corestore.ErrNotFound) {
			boundInstance = nil
			return nil
		}
		if err != nil {
			return err
		}
		boundInstance = binding.ContainerID
		return nil
	}
	if err := a.Store.Read(ctx, authorize); err != nil {
		return view, servicePublicError(err)
	}
	if lines < 1 || lines > 200 {
		return view, contracts.NewError("INVALID_REQUEST", "tailLines")
	}
	probeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	actual, _, err := a.inspectServiceRuntime(probeCtx, workID, serviceID)
	if err != nil || actual == nil || boundInstance == nil || actual.ID != *boundInstance {
		return view, nil
	}
	logs, err := a.dockerRuntime.Logs(probeCtx, serviceContainerIdentity(workID, serviceID, 0), lines, actual.ID)
	if err != nil {
		view.Reason = "service log collection failed"
		return view, nil
	}
	if err := a.Store.Read(ctx, authorize); err != nil {
		return view, servicePublicError(err)
	}
	if boundInstance == nil || actual.ID != *boundInstance {
		return view, nil
	}
	var definition contracts.ServiceDefinition
	if json.Unmarshal([]byte(record.DefinitionJSON), &definition) != nil {
		return view, corestore.ErrStorage
	}
	view.Text = redactServiceOutput(logs.Text, definition)
	view.Truncated = logs.Truncated
	if len(view.Text) > 64<<10 {
		view.Text = view.Text[len(view.Text)-(64<<10):]
		for !utf8.ValidString(view.Text) {
			view.Text = view.Text[1:]
		}
		view.Truncated = true
	}
	view.Status = "available"
	if view.Truncated {
		view.Status = "truncated"
	}
	view.Reason = ""
	return view, nil
}
