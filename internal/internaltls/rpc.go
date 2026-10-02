package internaltls

import (
	"context"
	"errors"
	"strconv"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

type principalKey struct{}

func ServicePrincipal(ctx context.Context) (Scope, bool) {
	scope, ok := ctx.Value(principalKey{}).(Scope)
	return scope, ok
}

func servicePeer(ctx context.Context, installation string, active func(Scope) bool) (Scope, error) {
	remote, ok := peer.FromContext(ctx)
	if !ok {
		return Scope{}, ErrIdentity
	}
	info, ok := remote.AuthInfo.(credentials.TLSInfo)
	if !ok || len(info.State.VerifiedChains) == 0 || len(info.State.PeerCertificates) == 0 {
		return Scope{}, ErrIdentity
	}
	cert := info.State.PeerCertificates[0]
	now := time.Now()
	if now.Before(cert.NotBefore) || !now.Before(cert.NotAfter) {
		return Scope{}, ErrIdentity
	}
	return AuthorizeServicePeer(cert, installation, active)
}

func rpcIdentityError(err error) error {
	if errors.Is(err, ErrStale) {
		return status.Error(codes.FailedPrecondition, ErrStale.Error())
	}
	return status.Error(codes.Unauthenticated, ErrIdentity.Error())
}

func ServiceUnaryInterceptor(installation string, active func(Scope) bool) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, request any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		scope, err := servicePeer(ctx, installation, active)
		if err != nil {
			return nil, rpcIdentityError(err)
		}
		if !metadataMatchesServicePeer(ctx, scope) {
			return nil, rpcIdentityError(ErrIdentity)
		}
		return handler(context.WithValue(ctx, principalKey{}, scope), request)
	}
}

// Metadata never establishes authority. Reject conflicting identity claims;
// the verified certificate and current runtime remain the sole identity source.
func metadataMatchesServicePeer(ctx context.Context, scope Scope) bool {
	values, _ := metadata.FromIncomingContext(ctx)
	for key, expected := range map[string]string{
		"installation-id": scope.InstallationID, "work-id": scope.WorkID,
		"generation": strconv.FormatInt(scope.Generation, 10), "instance-id": scope.InstanceID,
		"x-piwork-installation-id": scope.InstallationID, "x-piwork-work-id": scope.WorkID,
		"x-piwork-generation": strconv.FormatInt(scope.Generation, 10), "x-piwork-instance-id": scope.InstanceID,
	} {
		claim := values.Get(key)
		if len(claim) > 0 && (len(claim) != 1 || claim[0] != expected) {
			return false
		}
	}
	return true
}
