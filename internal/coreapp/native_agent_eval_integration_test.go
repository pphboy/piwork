//go:build integration

package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"os"
	"testing"

	"github.com/moby/moby/client"
	"piwork/internal/dockerengine"
)

// Execute fixture code only in the exact Work's owned Agent container. Readonly
// fact readers supply readonly SQL; existing seed helpers also use this driver.
func nativeAgentEval(t *testing.T, ctx context.Context, a *Application, workID, program string) string {
	t.Helper()
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if direct := os.Getenv("PIWORK_TEST_DOCKER_EXEC_HOST"); direct != "" {
		host = direct
	}
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	raw, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var id string
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow("SELECT runtime_id FROM resource_bindings WHERE work_id=? AND resource_kind='agent' AND logical_id=?", workID, workID+"/agentd").Scan(&id)
	}); err != nil {
		t.Fatal(err)
	}
	job, err := raw.ExecCreate(ctx, id, client.ExecCreateOptions{Cmd: []string{"node", "--no-warnings", "--input-type=module", "-e", program}, AttachStdout: true, AttachStderr: true, User: "10001:10001"})
	if err != nil {
		t.Fatal(err)
	}
	attached, err := raw.ExecAttach(ctx, job.ID, client.ExecAttachOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer attached.Close()
	var out bytes.Buffer
	if err := dockerengine.Demultiplex(ctx, attached.Reader, &out, &out); err != nil {
		t.Fatal(err)
	}
	return out.String()
}
