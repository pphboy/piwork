// Package preparationcache shares bounded, cancellable preparation work. Only
// complete successes are retained; callers own their waits, not the shared job.
package preparationcache

import (
	"container/list"
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"piwork/internal/diagnostics"
)

const DefaultCapacity = 64
const DefaultTimeout = 10 * time.Minute

type Options[V any] struct {
	Capacity   int
	MaxFlights int
	Timeout    time.Duration
	Clone      func(V) V
	Phase      string
}

type entry[K comparable, V any] struct {
	key   K
	value V
}
type flight[V any] struct {
	ctx     context.Context
	cancel  context.CancelFunc
	done    chan struct{}
	waiters int
	closing bool
	id      string
	value   V
	err     error
}

type Cache[K comparable, V any] struct {
	mu           sync.Mutex
	ctx          context.Context
	cancel       context.CancelFunc
	options      Options[V]
	closed       bool
	values       map[K]*list.Element
	lru          list.List
	pins         map[K]bool
	flights      map[K]*flight[V]
	changed      chan struct{}
	preparations uint64
}

func New[K comparable, V any](lifecycle context.Context, options Options[V]) *Cache[K, V] {
	if options.Capacity == 0 {
		options.Capacity = DefaultCapacity
	}
	if options.MaxFlights == 0 {
		options.MaxFlights = DefaultCapacity
	}
	if options.Timeout == 0 {
		options.Timeout = DefaultTimeout
	}
	if options.Capacity < 1 || options.Capacity > DefaultCapacity || options.MaxFlights < 1 || options.MaxFlights > DefaultCapacity || options.Timeout < 0 || options.Timeout > DefaultTimeout {
		panic("invalid preparation cache bounds")
	}
	if options.Clone == nil {
		options.Clone = func(value V) V { return value }
	}
	ctx, cancel := context.WithCancel(lifecycle)
	return &Cache[K, V]{ctx: ctx, cancel: cancel, options: options, values: make(map[K]*list.Element), pins: make(map[K]bool), flights: make(map[K]*flight[V]), changed: make(chan struct{})}
}

// Get joins an existing job, or starts one under the cache lifecycle. work must
// return only after its bounded cleanup is confirmed. It must honor cancellation.
func (c *Cache[K, V]) Get(ctx context.Context, key K, work func(context.Context) (V, error)) (result V, err error) {
	span := diagnostics.BeginPerformance(ctx, c.options.Phase)
	state, correlation := "shared", ""
	defer func() { span.EndCache(err, state, correlation) }()
	for {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		c.mu.Lock()
		if c.closed || c.ctx.Err() != nil {
			c.mu.Unlock()
			return result, context.Canceled
		}
		if element := c.values[key]; element != nil {
			c.lru.MoveToFront(element)
			result = c.options.Clone(element.Value.(entry[K, V]).value)
			c.mu.Unlock()
			state = "hit"
			return result, nil
		}
		if job := c.flights[key]; job != nil {
			correlation = job.id
			if job.closing {
				c.mu.Unlock()
				if err := c.waitChange(ctx, job.done); err != nil {
					return result, err
				}
				continue
			}
			job.waiters++
			c.mu.Unlock()
			return c.await(ctx, key, job)
		}
		if len(c.flights) >= c.options.MaxFlights {
			changed := c.changed
			c.mu.Unlock()
			if err := c.waitChange(ctx, changed); err != nil {
				return result, err
			}
			continue
		}
		jobContext, cancel := context.WithTimeout(c.ctx, c.options.Timeout)
		correlation = "preparation-" + uuid.NewString()
		jobContext = diagnostics.WithPerformance(jobContext, diagnostics.PerformanceIdentity{CorrelationID: correlation})
		job := &flight[V]{ctx: jobContext, cancel: cancel, done: make(chan struct{}), waiters: 1, id: correlation}
		c.flights[key] = job
		c.preparations++
		c.mu.Unlock()
		go c.run(key, job, work)
		return c.await(ctx, key, job)
	}
}

func (c *Cache[K, V]) run(key K, job *flight[V], work func(context.Context) (V, error)) {
	span := diagnostics.BeginPerformance(job.ctx, c.options.Phase)
	value, err := work(job.ctx)
	if err == nil {
		err = job.ctx.Err()
	}
	c.mu.Lock()
	if err == nil && (c.closed || job.closing || c.ctx.Err() != nil) {
		err = context.Canceled
	}
	if err == nil {
		c.putLocked(key, value)
	}
	job.value, job.err = value, err
	c.mu.Unlock()
	// Finish logging before notifying callers, so reported shared work counts are
	// already observable when a successful waiter continues to activation.
	span.EndCache(err, "prepare", "")
	c.mu.Lock()
	delete(c.flights, key)
	close(job.done)
	c.signalLocked()
	c.mu.Unlock()
	job.cancel()
}

func (c *Cache[K, V]) await(ctx context.Context, key K, job *flight[V]) (result V, err error) {
	select {
	case <-job.done:
		if err := ctx.Err(); err != nil {
			return result, err
		}
		if job.err != nil {
			return result, job.err
		}
		return c.options.Clone(job.value), nil
	case <-ctx.Done():
		err = ctx.Err()
	case <-c.ctx.Done():
		err = context.Canceled
	}
	c.mu.Lock()
	if c.flights[key] == job {
		job.waiters--
		if job.waiters == 0 && !job.closing {
			job.closing = true
			job.cancel()
		}
	}
	c.mu.Unlock()
	return result, err
}

func (c *Cache[K, V]) waitChange(ctx context.Context, changed <-chan struct{}) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-c.ctx.Done():
		return context.Canceled
	case <-changed:
		return nil
	}
}

func (c *Cache[K, V]) putLocked(key K, value V) {
	if old := c.values[key]; old != nil {
		c.lru.Remove(old)
		delete(c.values, key)
	}
	if len(c.values) == c.options.Capacity {
		var evict *list.Element
		for element := c.lru.Back(); element != nil; element = element.Prev() {
			if !c.pins[element.Value.(entry[K, V]).key] {
				evict = element
				break
			}
		}
		if evict == nil {
			return
		}
		delete(c.values, evict.Value.(entry[K, V]).key)
		c.lru.Remove(evict)
	}
	c.values[key] = c.lru.PushFront(entry[K, V]{key: key, value: c.options.Clone(value)})
}

func (c *Cache[K, V]) signalLocked() { close(c.changed); c.changed = make(chan struct{}) }

// Pin replaces the current default set. It neither prepares nor trusts a value.
func (c *Cache[K, V]) Pin(keys ...K) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	pins := make(map[K]bool)
	for _, key := range keys {
		pins[key] = true
	}
	if len(pins) > c.options.Capacity {
		return errors.New("preparation pin capacity exceeded")
	}
	c.pins = pins
	return nil
}

func (c *Cache[K, V]) Invalidate(key K) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if element := c.values[key]; element != nil {
		c.lru.Remove(element)
		delete(c.values, key)
	}
	if job := c.flights[key]; job != nil {
		job.closing = true
		job.cancel()
	}
}

// Close stops admission and waits for work, including work's cleanup, to return.
// A deadline error leaves dependencies owned by the caller for process recovery.
func (c *Cache[K, V]) Close(ctx context.Context) error {
	c.mu.Lock()
	c.closed = true
	c.cancel()
	c.signalLocked()
	for len(c.flights) > 0 {
		changed := c.changed
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-changed:
		}
		c.mu.Lock()
	}
	c.mu.Unlock()
	return nil
}

type Stats struct {
	Entries, Flights, Waiters int
	Preparations              uint64
}

func (c *Cache[K, V]) Stats() Stats {
	c.mu.Lock()
	defer c.mu.Unlock()
	result := Stats{Entries: len(c.values), Flights: len(c.flights), Preparations: c.preparations}
	for _, job := range c.flights {
		result.Waiters += job.waiters
	}
	return result
}
