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

// The fixture was generated from both TS-era source files before their move.
// Comparing descriptors covers names, field numbers/types, enums, optional
// presence, oneofs and streaming RPC semantics rather than just Go compilation.
func TestWireDescriptorsUnchanged(t *testing.T) {
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
		t.Fatal("generated Go descriptors differ from the original Agent/WorkServices protocol")
	}
}
