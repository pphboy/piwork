//go:build integration

package dockerengine

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/client"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"piwork/internal/packagehelper"
	"piwork/internal/pipackage"
	"piwork/internal/testsupport"
	goruntime "runtime"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

// The retained image is read-only; until task 3.9 this fixture mounts the
// current native helper binary. It does not claim a business Core gate.
func TestNativePackageHelperRealImageSourcesAndTSArtifactCompatibility(t *testing.T) {
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	endpoint, err := SelectEndpoint(SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	engine, err := Connect(context.Background(), endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Log("package fixture installation:", scope.ID())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, engine.api); err != nil {
			t.Error(err)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	image, nativeImage := migrationAgentImage(t, engine, ctx)
	_, source, _, _ := goruntime.Caller(0)
	repository := filepath.Join(filepath.Dir(source), "..", "..")
	binary := os.Getenv("PIWORK_PACKAGE_HELPER_TEST_BINARY")
	if binary == "" {
		binary = filepath.Join(repository, "dist/go/piwork-package-helper")
	}
	if !nativeImage {
		if info, err := os.Stat(binary); err != nil || info.Mode().Perm()&0111 == 0 {
			t.Fatal("run make build-go before native package integration", err)
		}
		binary, err = filepath.Abs(binary)
		if err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-host-tools"))
	labels, _ := scope.Labels()
	bridge, err := engine.api.NetworkCreate(ctx, scope.ID()+"-package", client.NetworkCreateOptions{Driver: "bridge", Labels: labels})
	if err != nil {
		t.Fatal(err)
	}
	inspected, err := engine.api.NetworkInspect(ctx, bridge.ID, client.NetworkInspectOptions{})
	if err != nil || len(inspected.Network.IPAM.Config) != 1 {
		t.Fatal("fixture bridge unavailable", err)
	}
	gateway := inspected.Network.IPAM.Config[0].Gateway.String()
	var sequence atomic.Int64
	var cancelNext atomic.Bool
	run := func(t *testing.T, action, user, volume string, binds []mount.Mount, env []string, command []string) ([]byte, int64) {
		t.Helper()
		number := sequence.Add(1)
		pids := int64(256)
		mounts := append([]mount.Mount{}, binds...)
		if !nativeImage {
			mounts = append(mounts, mount.Mount{Type: mount.TypeBind, Source: binary, Target: "/usr/local/bin/piwork-package-helper", ReadOnly: true})
		}
		if volume != "" {
			mounts = append(mounts, mount.Mount{Type: mount.TypeVolume, Source: volume, Target: "/package/work", ReadOnly: action == "capture"})
		}
		networkMode := container.NetworkMode("none")
		var networking *network.NetworkingConfig
		if action == "prepare" {
			networkMode = container.NetworkMode(bridge.ID)
			networking = &network.NetworkingConfig{EndpointsConfig: map[string]*network.EndpointSettings{bridge.ID: {}}}
			mounts = append(mounts, mount.Mount{Type: mount.TypeTmpfs, Target: "/tmp", TmpfsOptions: &mount.TmpfsOptions{Mode: 01777, SizeBytes: 256 << 20}})
		}
		capabilities := []string{}
		if action == "init" {
			capabilities = []string{"CHOWN"}
		}
		if action == "capture" {
			capabilities = []string{"DAC_OVERRIDE", "CHOWN"}
		}
		if action == "fixture" {
			capabilities = []string{"DAC_OVERRIDE", "CHOWN"}
		}
		entry := []string{"/usr/local/bin/piwork-package-helper"}
		args := []string{action}
		if len(command) > 0 {
			entry = command[:1]
			args = command[1:]
		}
		environment := append([]string{"PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/package/work/home", "NPM_CONFIG_CACHE=/package/work/npm-cache"}, env...)
		created, err := engine.api.ContainerCreate(ctx, client.ContainerCreateOptions{Name: fmt.Sprintf("%s-pkg-%d", scope.ID(), number), Config: &container.Config{Image: image.ID, User: user, Entrypoint: entry, Cmd: args, Env: environment, WorkingDir: "/workspace", Labels: labels}, HostConfig: &container.HostConfig{ReadonlyRootfs: true, CapDrop: []string{"ALL"}, CapAdd: capabilities, SecurityOpt: []string{"no-new-privileges:true"}, NetworkMode: networkMode, Mounts: mounts, Resources: container.Resources{Memory: 512 << 20, NanoCPUs: 1e9, PidsLimit: &pids}}, NetworkingConfig: networking})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := engine.api.ContainerStart(ctx, created.ID, client.ContainerStartOptions{}); err != nil {
			t.Fatal(err)
		}
		var exit int64
		interrupt := cancelNext.Swap(false)
		for {
			view, err := engine.api.ContainerInspect(ctx, created.ID, client.ContainerInspectOptions{})
			if err != nil {
				t.Fatal(err)
			}
			if !view.Container.State.Running {
				exit = int64(view.Container.State.ExitCode)
				break
			}
			if interrupt {
				archive, err := engine.api.CopyFromContainer(ctx, created.ID, client.CopyFromContainerOptions{SourcePath: "/package/work/result/started"})
				if err == nil {
					archive.Content.Close()
					if _, err := engine.api.ContainerKill(ctx, created.ID, client.ContainerKillOptions{Signal: "SIGTERM"}); err != nil {
						t.Fatal(err)
					}
					interrupt = false
				}
			}
			select {
			case <-ctx.Done():
				t.Fatal("helper did not exit", ctx.Err())
			case <-time.After(25 * time.Millisecond):
			}
		}
		logs, err := engine.api.ContainerLogs(ctx, created.ID, client.ContainerLogsOptions{ShowStdout: true, ShowStderr: true, Tail: "100"})
		if err != nil {
			t.Fatal(err)
		}
		defer logs.Close()
		output, diagnostic := newTail(1<<20), newTail(8192)
		if err := Demultiplex(ctx, logs, output, diagnostic); err != nil {
			t.Fatal(err)
		}
		if len(diagnostic.bytes) > 0 {
			t.Log("fixture diagnostic:", string(diagnostic.bytes))
		}
		return output.bytes, exit
	}
	probeScript := `const fs=require('fs');let sdk;for(const p of ['/workspace/node_modules/@earendil-works/pi-coding-agent/package.json']){sdk=JSON.parse(fs.readFileSync(p)).version;}console.log(JSON.stringify({os:process.platform,architecture:process.arch==='x64'?'amd64':process.arch,variant:null,nodeAbi:process.versions.modules,piSdkVersion:sdk}));`
	raw, exit := run(t, "fixture", "10001:10001", "", nil, nil, []string{"node", "-e", probeScript})
	if exit != 0 {
		t.Fatal("image environment probe failed")
	}
	environment, err := pipackage.ValidateEnvironment(bytes.TrimSpace(raw))
	if err != nil {
		t.Fatal("image environment invalid", string(raw), err)
	}
	t.Logf("image fixed identity %s / Node ABI %s / SDK %s", image.ID, environment.NodeAbi, environment.PiSdkVersion)
	// A local registry serves exact fixture bytes to the isolated image npm.
	makeTar := func(name, version, body string, deps map[string]string) []byte {
		var data bytes.Buffer
		gz := gzip.NewWriter(&data)
		writer := tar.NewWriter(gz)
		manifest, _ := json.Marshal(map[string]any{"name": name, "version": version, "main": "index.js", "dependencies": deps})
		for _, item := range []struct {
			name string
			raw  []byte
		}{{"package/package.json", manifest}, {"package/index.js", []byte(body)}} {
			if err := writer.WriteHeader(&tar.Header{Name: item.name, Typeflag: tar.TypeReg, Mode: 0644, Size: int64(len(item.raw))}); err != nil {
				t.Fatal(err)
			}
			if _, err := writer.Write(item.raw); err != nil {
				t.Fatal(err)
			}
		}
		if writer.Close() != nil || gz.Close() != nil {
			t.Fatal("fixture tar generation failed")
		}
		return data.Bytes()
	}
	tarballs := map[string][]byte{"registry-tools": makeTar("registry-tools", "1.2.3", "module.exports = 'registry fixture';\n", map[string]string{"registry-dependency": "3.0.0"}), "registry-dependency": makeTar("registry-dependency", "3.0.0", "module.exports = 'dependency fixture';\n", map[string]string{})}
	listener, err := net.Listen("tcp", net.JoinHostPort(gateway, "0"))
	if err != nil {
		t.Fatal(err)
	}
	registryURL := "http://" + listener.Addr().String()
	server := &http.Server{ReadHeaderTimeout: time.Second, Handler: http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		name := strings.TrimPrefix(request.URL.Path, "/")
		archive, ok := tarballs[name]
		if ok {
			version := "1.2.3"
			deps := map[string]string{"registry-dependency": "3.0.0"}
			if name == "registry-dependency" {
				version = "3.0.0"
				deps = map[string]string{}
			}
			hash := sha1.Sum(archive)
			metadata := map[string]any{"name": name, "dist-tags": map[string]string{"latest": version}, "versions": map[string]any{version: map[string]any{"name": name, "version": version, "dependencies": deps, "dist": map[string]string{"tarball": registryURL + "/" + name + "/-/" + name + "-" + version + ".tgz", "shasum": hex.EncodeToString(hash[:])}}}}
			response.Header().Set("Content-Type", "application/json")
			json.NewEncoder(response).Encode(metadata)
			return
		}
		for name, archive := range tarballs {
			if strings.HasPrefix(request.URL.Path, "/"+name+"/-/") {
				response.Header().Set("Content-Type", "application/octet-stream")
				response.Write(archive)
				return
			}
		}
		response.WriteHeader(404)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close() })
	newVolume := func(t *testing.T, label string) string {
		t.Helper()
		value, err := engine.api.VolumeCreate(ctx, client.VolumeCreateOptions{Name: scope.ID() + "-" + label, Labels: labels})
		if err != nil {
			t.Fatal(err)
		}
		return value.Volume.Name
	}
	setupSource := func(t *testing.T, name string, request any, tree string) string {
		t.Helper()
		input := t.TempDir()
		if err := os.Chmod(input, 0755); err != nil {
			t.Fatal(err)
		}
		if tree != "" {
			source, err := pipackage.OpenTree(ctx, tree)
			if err != nil {
				t.Fatal(err)
			}
			defer source.Close()
			if _, err := pipackage.PackArchive(ctx, source, filepath.Join(input, "input.zip")); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(filepath.Join(input, "input.zip"), 0644); err != nil {
				t.Fatal(err)
			}
		}
		raw, _ := json.Marshal(map[string]any{"source": request})
		if err := os.WriteFile(filepath.Join(input, "request.json"), raw, 0644); err != nil {
			t.Fatal(err)
		}
		return input
	}
	// Git fixture setup runs entirely inside the retained image, never host Git.
	gitInput := setupSource(t, "git", map[string]string{"kind": "git", "spec": "fixture.invalid/org/repo@v2"}, "")
	gitScript := `const fs=require('fs'),cp=require('child_process');const root='/package/source/repo';fs.mkdirSync(root);fs.writeFileSync(root+'/package.json','{"name":"git-tools","version":"2.0.0"}');fs.writeFileSync(root+'/index.js','module.exports = "git fixture";\n');const run=(...args)=>cp.execFileSync('git',args,{stdio:['ignore','pipe','ignore']}).toString().trim();run('init','-q',root);run('-C',root,'config','user.name','Fixture');run('-C',root,'config','user.email','fixture@example.invalid');run('-C',root,'add','.');run('-C',root,'commit','-qm','fixture');run('-C',root,'tag','v2');fs.writeFileSync('/package/source/gitconfig','[url "file:///package/source/repo"]\n\tinsteadOf = https://fixture.invalid/org/repo\n[safe]\n\tdirectory = /package/source/repo/.git\n');console.log(run('-C',root,'rev-parse','HEAD'));const owner=fs.statSync('/package/source');const own=(p)=>{for(const e of fs.readdirSync(p,{withFileTypes:true})){const n=p+'/'+e.name;if(e.isDirectory())own(n);fs.chownSync(n,owner.uid,owner.gid);}fs.chownSync(p,owner.uid,owner.gid);};own(root);`
	raw, exit = run(t, "fixture", "0:0", "", []mount.Mount{{Type: mount.TypeBind, Source: gitInput, Target: "/package/source"}}, nil, []string{"node", "-e", gitScript})
	if exit != 0 {
		t.Fatal("Git fixture creation failed")
	}
	commit := strings.TrimSpace(string(raw))
	cases := []struct{ name, kind, input, expected, preparedMarker string }{
		{"local", "local", setupSource(t, "local", map[string]string{"kind": "local", "displayName": "tools-v1"}, filepath.Join(repository, "fixtures/pi-packages/tools-v1")), "tools-v1", "prepared-v1\n"},
		{"zip", "zip", setupSource(t, "zip", map[string]string{"kind": "zip", "displayName": "tools-v2.zip"}, filepath.Join(repository, "fixtures/pi-packages/tools-v2")), "tools-v2.zip", "prepared-v2\n"},
		{"npm", "npm", setupSource(t, "npm", map[string]string{"kind": "npm", "spec": "registry-tools@1.2.3"}, ""), "registry-tools@1.2.3", ""},
		{"git", "git", gitInput, "https://fixture.invalid/org/repo@" + commit, ""},
	}
	var captured []packagehelper.Captured
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			volume := newVolume(t, item.name)
			raw, exit := run(t, "init", "0:0", volume, nil, nil, nil)
			if exit != 0 {
				t.Fatal("init failed", string(raw))
			}
			env := []string{"NPM_CONFIG_REGISTRY=" + registryURL, "GIT_CONFIG_GLOBAL=/package/source/gitconfig"}
			raw, exit = run(t, "prepare", "10001:10001", volume, []mount.Mount{{Type: mount.TypeBind, Source: item.input, Target: "/package/source", ReadOnly: true}}, env, nil)
			var prepared packagehelper.Prepared
			if exit != 0 || json.Unmarshal(bytes.TrimSpace(raw), &prepared) != nil || prepared.SourceKind != item.kind || prepared.ResolvedSource != item.expected {
				t.Fatal("real prepare failed", exit, string(raw))
			}
			raw, exit = run(t, "measure", "0:0", volume, nil, nil, nil)
			var measured struct{ Bytes int64 }
			if exit != 0 || json.Unmarshal(raw, &measured) != nil || measured.Bytes == 0 {
				t.Fatal("measure failed", exit, string(raw))
			}
			spool := t.TempDir()
			if err := os.Chmod(spool, 0755); err != nil {
				t.Fatal(err)
			}
			request, _ := json.Marshal(map[string]any{"sourceKind": item.kind, "resolvedSource": prepared.ResolvedSource, "preparedEnvironment": environment})
			if err := os.WriteFile(filepath.Join(spool, "request.json"), request, 0644); err != nil {
				t.Fatal(err)
			}
			raw, exit = run(t, "capture", "0:0", volume, []mount.Mount{{Type: mount.TypeBind, Source: spool, Target: "/package/spool"}}, nil, nil)
			var capture packagehelper.Captured
			if exit != 0 || json.Unmarshal(raw, &capture) != nil {
				t.Fatal("capture failed", exit, string(raw))
			}
			captured = append(captured, capture)
			owner, err := os.Stat(spool)
			if err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{"artifact.zip", "result.json"} {
				info, err := os.Stat(filepath.Join(spool, name))
				if err != nil {
					t.Fatal(err)
				}
				want, got := owner.Sys().(*syscall.Stat_t), info.Sys().(*syscall.Stat_t)
				if got.Uid != want.Uid || got.Gid != want.Gid || info.Mode().Perm() != 0644 {
					t.Fatal("trusted helper output did not inherit spool ownership", name, got.Uid, got.Gid, want.Uid, want.Gid)
				}
			}
			restored := filepath.Join(t.TempDir(), "restored")
			if _, err := pipackage.ExtractArchive(ctx, filepath.Join(spool, "artifact.zip"), restored); err != nil {
				t.Fatal(err)
			}
			tree, err := pipackage.OpenTree(ctx, restored)
			if err != nil {
				t.Fatal(err)
			}
			defer tree.Close()
			after, err := pipackage.ValidateArtifact(tree, item.kind, prepared.ResolvedSource, environment, string(capture.Metadata.ContentDigest))
			if err != nil || after.EntryCount != capture.EntryCount || after.RestoredBytes != capture.RestoredBytes {
				t.Fatal("Go independently rejected captured artifact", err)
			}
			if item.preparedMarker != "" {
				raw, err := os.ReadFile(filepath.Join(restored, "prepared.txt"))
				if err != nil || string(raw) != item.preparedMarker {
					t.Fatal("image lifecycle script did not execute", err)
				}
				original, err := os.ReadFile(filepath.Join(repository, "fixtures/pi-packages/tools-v"+map[string]string{"local": "1", "zip": "2"}[item.kind], "package.json"))
				if err != nil || !bytes.Equal(original, tree.ManifestBytes) {
					t.Fatal("original manifest bytes changed", err)
				}
			}
			if item.kind == "npm" {
				body, err := os.ReadFile(filepath.Join(restored, "node_modules/registry-dependency/index.js"))
				if err != nil || string(body) != "module.exports = 'dependency fixture';\n" {
					t.Fatal("resolved runtime dependency bytes differ", err)
				}
			}
			metadata, _ := json.Marshal(capture.Metadata)
			validationScript := `const {validatePiPackageArtifact,assertPiPackageEnvironment}=await import('/workspace/packages/pi-package/dist/artifact.js');const expected=` + string(metadata) + `;assertPiPackageEnvironment(expected.preparedEnvironment,` + string(bytes.TrimSpace(mustJSON(t, environment))) + `);const result=await validatePiPackageArtifact({root:'/package/work/result',sourceKind:expected.sourceKind,resolvedSource:expected.resolvedSource,preparedEnvironment:expected.preparedEnvironment,expectedDigest:expected.contentDigest});console.log(JSON.stringify(result));`
			raw, exit = run(t, "fixture", "0:0", "", []mount.Mount{{Type: mount.TypeBind, Source: restored, Target: "/package/work/result", ReadOnly: true}}, nil, []string{"node", "--input-type=module", "-e", validationScript})
			var oracle pipackage.Artifact
			if exit != 0 || json.Unmarshal(raw, &oracle) != nil {
				t.Fatal("actual TS artifact validator rejected Go capture", exit, string(raw))
			}
			left, _ := json.Marshal(oracle)
			right, _ := json.Marshal(capture.Artifact)
			if !bytes.Equal(left, right) {
				t.Fatal("TS/Go artifact metadata differs", string(left), string(right))
			}
		})
	}
	if len(captured) != 4 {
		t.Fatal("not all four sources succeeded")
	}
	// Genuine image npm/Git failures must stay distinct and expose no stderr.
	newTree := func(t *testing.T, manifest string) string {
		t.Helper()
		root := t.TempDir()
		if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(manifest), 0644); err != nil {
			t.Fatal(err)
		}
		return root
	}
	failures := []struct {
		name, input, code string
		cancel            bool
	}{
		{"source-fetch", setupSource(t, "fetch", map[string]string{"kind": "npm", "spec": "missing-package@1.0.0"}, ""), "PI_PACKAGE_SOURCE_FETCH_FAILED", false},
		{"dependency", setupSource(t, "dependency", map[string]string{"kind": "local", "displayName": "bad-deps"}, newTree(t, `{"name":"bad-deps","version":"1.0.0","dependencies":{"missing-dependency":"1.0.0"}}`)), "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED", false},
		{"peer", setupSource(t, "peer", map[string]string{"kind": "zip", "displayName": "bad-peer.zip"}, newTree(t, `{"name":"bad-peer","peerDependencies":{"@earendil-works/pi-ai":"999.0.0"}}`)), "PI_PACKAGE_SDK_VERSION_UNSUPPORTED", false},
		{"script", setupSource(t, "script", map[string]string{"kind": "local", "displayName": "bad-script"}, newTree(t, `{"name":"bad-script","version":"1.0.0","scripts":{"postinstall":"node -e \"process.stderr.write('private diagnostic');process.exit(7)\""}}`)), "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED", false},
		{"cancel", setupSource(t, "cancel", map[string]string{"kind": "local", "displayName": "blocked-script"}, newTree(t, `{"name":"blocked-script","version":"1.0.0","scripts":{"postinstall":"node -e \"require('fs').writeFileSync('started','ready');setInterval(()=>{},1000)\""}}`)), "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED", true},
	}
	for _, item := range failures {
		t.Run("failure/"+item.name, func(t *testing.T) {
			volume := newVolume(t, "failure-"+item.name)
			raw, exit := run(t, "init", "0:0", volume, nil, nil, nil)
			if exit != 0 {
				t.Fatal("fixture init failed", string(raw))
			}
			cancelNext.Store(item.cancel)
			raw, exit = run(t, "prepare", "10001:10001", volume, []mount.Mount{{Type: mount.TypeBind, Source: item.input, Target: "/package/source", ReadOnly: true}}, []string{"NPM_CONFIG_REGISTRY=" + registryURL}, nil)
			var safe struct {
				ErrorCode string `json:"errorCode"`
			}
			if exit != 1 || json.Unmarshal(raw, &safe) != nil || safe.ErrorCode != item.code {
				t.Fatal("failure classification differs", exit, string(raw))
			}
			if strings.Contains(string(raw), "private") || strings.Contains(string(raw), "/package/") {
				t.Fatal("command diagnostics leaked")
			}
		})
	}
	server.Close() // Captured bytes are independent of the source registry.
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
