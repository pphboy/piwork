package rpc_test

import (
	"os"
	"testing"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/types/descriptorpb"
	"piwork/internal/rpc/agentv1"
	"piwork/internal/rpc/servicesv1"
)

// The fixture is generated with the canonical root proto files.
// Comparing descriptors covers names, field numbers/types, enums, optional
// presence, oneofs and streaming RPC semantics rather than just Go compilation.
func TestCurrentWireDescriptorsMatchCanonicalProto(t *testing.T) {
	bytes, err := os.ReadFile("testdata/wire-descriptor.pb")
	if err != nil {
		t.Fatal(err)
	}
	var expected descriptorpb.FileDescriptorSet
	if err := proto.Unmarshal(bytes, &expected); err != nil {
		t.Fatal(err)
	}
	actual := &descriptorpb.FileDescriptorSet{File: []*descriptorpb.FileDescriptorProto{
		protodesc.ToFileDescriptorProto(agentv1.File_agent_proto),
		protodesc.ToFileDescriptorProto(servicesv1.File_work_services_proto),
	}}
	if !proto.Equal(&expected, actual) {
		t.Fatal("generated Go descriptors differ from the canonical Agent/WorkServices protocol")
	}
}

func TestSubmitRunModelPresence(t *testing.T) {
	for _, ref := range []*string{nil, proto.String(""), proto.String("model-0000000000000001")} {
		raw, err := proto.Marshal(&agentv1.SubmitRunRequest{ModelRef: ref})
		if err != nil {
			t.Fatal(err)
		}
		var decoded agentv1.SubmitRunRequest
		if err := proto.Unmarshal(raw, &decoded); err != nil {
			t.Fatal(err)
		}
		if (ref == nil) != (decoded.ModelRef == nil) || ref != nil && *ref != *decoded.ModelRef {
			t.Fatalf("model presence lost: %v -> %v", ref, decoded.ModelRef)
		}
	}
}
