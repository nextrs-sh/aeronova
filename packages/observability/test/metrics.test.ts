import { describe, expect, it } from 'vitest';
import { Registry, isValidRequestId, registerProcessMetrics, requestIdFrom } from '../src';

describe('Registry', () => {
  it('renders counters, gauges, and cumulative histograms in Prometheus text format', () => {
    const registry = new Registry();
    const requests = registry.counter({
      name: 'http_requests_total',
      help: 'Requests.',
      labelNames: ['route', 'status'],
    });
    requests.inc({ route: '/v1/flights', status: '200' });
    requests.inc({ route: '/v1/flights', status: '200' }, 2);
    registry.gauge({ name: 'queue_depth', help: 'Depth.', collect: (g) => g.set(7) });
    const latency = registry.histogram({
      name: 'latency_seconds',
      help: 'Latency.',
      labelNames: ['route'],
      buckets: [0.1, 1],
    });
    latency.observe(0.05, { route: '/a' });
    latency.observe(0.5, { route: '/a' });
    latency.observe(5, { route: '/a' });

    const text = registry.render();
    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toContain('http_requests_total{route="/v1/flights",status="200"} 3');
    expect(text).toContain('queue_depth 7');
    expect(text).toContain('latency_seconds_bucket{route="/a",le="0.1"} 1');
    expect(text).toContain('latency_seconds_bucket{route="/a",le="1"} 2');
    expect(text).toContain('latency_seconds_bucket{route="/a",le="+Inf"} 3');
    expect(text).toContain('latency_seconds_count{route="/a"} 3');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('escapes label values and folds runaway cardinality into "other"', () => {
    const registry = new Registry();
    const counter = registry.counter({
      name: 'c_total',
      help: 'C.',
      labelNames: ['x'],
      maxSeries: 2,
    });
    counter.inc({ x: 'a"b\\c\nd' });
    counter.inc({ x: 'two' });
    counter.inc({ x: 'three' });
    counter.inc({ x: 'four' });
    const text = registry.render();
    expect(text).toContain('c_total{x="a\\"b\\\\c\\nd"} 1');
    expect(text).toContain('c_total{x="other"} 2');
    expect(text).not.toContain('three');
  });

  it('refuses duplicate names, invalid names, and negative counter increments', () => {
    const registry = new Registry();
    registry.counter({ name: 'a_total', help: 'A.' });
    expect(() => registry.counter({ name: 'a_total', help: 'A.' })).toThrow();
    expect(() => registry.counter({ name: 'bad-name', help: 'B.' })).toThrow();
    const counter = registry.counter({ name: 'b_total', help: 'B.' });
    expect(() => counter.inc({}, -1)).toThrow();
  });

  it('publishes process metrics', () => {
    const registry = new Registry();
    registerProcessMetrics(registry, { service: 'test' });
    const text = registry.render();
    expect(text).toMatch(/process_resident_memory_bytes\{service="test"\} \d+/);
    expect(text).toMatch(/nodejs_heap_bytes\{service="test",kind="used"\} \d+/);
    expect(text).toMatch(/nodejs_eventloop_delay_seconds\{service="test",quantile="0.99"\}/);
  });
});

describe('request ids', () => {
  it('keeps well-formed ids and replaces anything else', () => {
    expect(requestIdFrom('abc12345-req')).toBe('abc12345-req');
    expect(isValidRequestId('short')).toBe(false);
    for (const bad of ['x'.repeat(65), 'has space in it', 'line\nbreak-123', '{"json":1}']) {
      const id = requestIdFrom(bad);
      expect(id).not.toBe(bad);
      expect(isValidRequestId(id)).toBe(true);
    }
    expect(isValidRequestId(requestIdFrom(undefined))).toBe(true);
    expect(requestIdFrom(['first-id-123', 'second'])).toBe('first-id-123');
  });
});
