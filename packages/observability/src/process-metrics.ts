import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Registry } from './metrics';

/**
 * Process health for one Node.js service: memory, CPU, event-loop delay, uptime. Event-loop
 * delay percentiles cover the interval since the previous scrape (the histogram is reset after
 * each one), so they describe recent behaviour rather than the whole process lifetime.
 */
export function registerProcessMetrics(registry: Registry, options: { service: string }): void {
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const startedAt = Date.now() / 1000;
  const service = options.service;

  registry.gauge({
    name: 'process_resident_memory_bytes',
    help: 'Resident set size.',
    labelNames: ['service'],
    collect: (gauge) => gauge.set(process.memoryUsage.rss(), { service }),
  });
  registry.gauge({
    name: 'nodejs_heap_bytes',
    help: 'V8 heap, used and total.',
    labelNames: ['service', 'kind'],
    collect: (gauge) => {
      const memory = process.memoryUsage();
      gauge.set(memory.heapUsed, { service, kind: 'used' });
      gauge.set(memory.heapTotal, { service, kind: 'total' });
      gauge.set(memory.external, { service, kind: 'external' });
      gauge.set(memory.arrayBuffers, { service, kind: 'array_buffers' });
    },
  });
  registry.gauge({
    name: 'process_cpu_seconds_total',
    help: 'User and system CPU time spent (a counter, exposed as a gauge for simplicity).',
    labelNames: ['service', 'mode'],
    collect: (gauge) => {
      const usage = process.cpuUsage();
      gauge.set(usage.user / 1e6, { service, mode: 'user' });
      gauge.set(usage.system / 1e6, { service, mode: 'system' });
    },
  });
  registry.gauge({
    name: 'nodejs_eventloop_delay_seconds',
    help: 'Event-loop delay since the previous scrape (p50, p99, max).',
    labelNames: ['service', 'quantile'],
    collect: (gauge) => {
      const toSeconds = (ns: number) => (Number.isFinite(ns) ? ns / 1e9 : 0);
      gauge.set(toSeconds(loop.percentile(50)), { service, quantile: '0.5' });
      gauge.set(toSeconds(loop.percentile(99)), { service, quantile: '0.99' });
      gauge.set(toSeconds(loop.max), { service, quantile: '1' });
      loop.reset();
    },
  });
  registry.gauge({
    name: 'process_start_time_seconds',
    help: 'When the process started (Unix seconds).',
    labelNames: ['service'],
    collect: (gauge) => gauge.set(startedAt, { service }),
  });
}
