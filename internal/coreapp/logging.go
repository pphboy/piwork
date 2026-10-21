package coreapp

import (
	"errors"
	"io"
	"log"
	"os"
	"strconv"

	"piwork/internal/corelogs"
	"piwork/internal/diagnostics"
)

// logSink persists the same safe projections that the console already shows.
// It never receives raw agent/container output.
type logSink struct{ manager *corelogs.Manager }

func (s logSink) Diagnostic(event diagnostics.Event, workID, operationID, correlationID string, console []byte) {
	if s.manager == nil {
		return
	}
	level := "info"
	switch event.Outcome {
	case "failed":
		level = "error"
	case "interrupted":
		level = "warn"
	}
	fields := map[string]string{"stage": event.Stage, "outcome": event.Outcome, "code": event.Code}
	if event.SkillName != "" {
		fields["skillName"] = event.SkillName
	}
	if event.ServiceID != "" {
		fields["serviceId"] = event.ServiceID
	}
	_ = s.manager.Emit(corelogs.Event{
		Stream: "stderr", Level: level, Component: event.Component, Event: "diagnostic." + event.Stage,
		Message: diagnostics.Message(event), WorkID: workID, ServiceID: event.ServiceID,
		OperationID: operationID, CorrelationID: correlationID, Fields: fields, ConsoleText: console,
	})
}

func (s logSink) Performance(value map[string]any, console []byte) {
	if s.manager == nil {
		return
	}
	text := func(key string) string {
		item, _ := value[key].(string)
		return item
	}
	fields := map[string]string{}
	for _, key := range []string{"phase", "outcome", "cacheState", "preparationCorrelationId"} {
		if item := text(key); item != "" {
			fields[key] = item
		}
	}
	if duration, ok := value["durationMs"].(float64); ok && duration >= 0 {
		fields["durationMs"] = strconv.FormatFloat(duration, 'f', 3, 64)
	}
	level := "info"
	switch fields["outcome"] {
	case "failed":
		level = "error"
	case "cancelled":
		level = "warn"
	}
	eventName := fields["phase"]
	if eventName == "" {
		eventName = "span"
	}
	_ = s.manager.Emit(corelogs.Event{
		Stream: "stderr", Level: level, Component: "core", Event: "performance." + eventName,
		Message: "Performance span completed.", WorkID: text("workId"), OperationID: text("operationId"),
		CorrelationID: text("correlationId"), Fields: fields, ConsoleText: console,
	})
}

func (a *Application) consoleStderr() io.Writer {
	if a.options.Stderr != nil {
		return a.options.Stderr
	}
	return os.Stderr
}

func (a *Application) consoleStdout() io.Writer {
	if a.options.Stdout != nil {
		return a.options.Stdout
	}
	return os.Stdout
}

func (a *Application) diagnosticSink() diagnostics.Sink {
	if a.logs == nil {
		return nil
	}
	return logSink{manager: a.logs}
}

// RecordAppEvent writes a file-only lifecycle event. The console keeps its
// existing stdout/stderr format, so no default console text is emitted.
func (a *Application) RecordAppEvent(event, level string, fields map[string]string) {
	if a.logs == nil {
		return
	}
	_ = a.logs.Emit(corelogs.Event{
		Stream: "stderr", Level: level, Component: "core", Event: event,
		Message: "Core lifecycle event.", Fields: fields, ConsoleText: []byte{},
	})
}

func (a *Application) attachStandardLog() {
	if a.logs == nil {
		return
	}
	a.previousLogOutput = log.Writer()
	log.SetOutput(a.logs.Writer("stderr", "app"))
}

func (a *Application) detachStandardLog() {
	if a.logs == nil {
		return
	}
	if a.previousLogOutput != nil {
		log.SetOutput(a.previousLogOutput)
	}
}

// shutdownLogs records the final lifecycle conclusion before the writer is
// synchronised and closed. It runs while all workload/shutdown diagnostics have
// already been emitted.
func (a *Application) shutdownLogs(result error) error {
	if a.logs == nil {
		return nil
	}
	level, outcome := "info", "succeeded"
	if result != nil {
		level, outcome = "warn", "unconfirmed"
	}
	a.RecordAppEvent("app.shutdown", level, map[string]string{"outcome": outcome})
	if err := a.closeLogs(); err != nil {
		return errors.New("Core log shutdown was not confirmed")
	}
	return nil
}

func (a *Application) closeLogs() error {
	if a.logs == nil {
		return nil
	}
	a.detachStandardLog()
	err := a.logs.Close()
	if a.logsRoot != nil {
		a.logsRoot.Close()
		a.logsRoot = nil
	}
	a.logs = nil
	return err
}
