package coreapp

import (
	"context"
	"sync"
)

// A file request owns its deadline and body-close callbacks until they finish.
// AfterFunc's stop alone does not wait for a callback already in progress; a
// late deadline could otherwise cancel a later request on the same connection.
func afterFileCancellation(ctx context.Context, callback func()) func() {
	done := make(chan struct{})
	stop := context.AfterFunc(ctx, func() {
		defer close(done)
		callback()
	})
	var once sync.Once
	return func() {
		once.Do(func() {
			if !stop() {
				<-done
			}
		})
	}
}
