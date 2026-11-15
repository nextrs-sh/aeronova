/*
 * A small Prometheus registry (text exposition format 0.0.4), so both services can publish
 * metrics without a third-party client. Labels are fixed per metric and their values must come
 * from bounded sets (route templates, status classes, error codes): never ids, tokens, or
 * anything a client controls freely.
 */

export type Labels = Record<string, string>;

const NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatLabels(names: readonly string[], values: readonly string[], extra = ''): string {
  const parts = names.map((name, index) => `${name}="${escapeLabelValue(values[index] ?? '')}"`);
  if (extra) parts.push(extra);
  return parts.length > 0 ? `{${parts.join(',')}}` : '';
}

function formatNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return '+Inf';
  if (value === Number.NEGATIVE_INFINITY) return '-Inf';
  return String(value);
}

interface Metric {
  readonly name: string;
  render(): string;
}

abstract class LabelledMetric<T> implements Metric {
  protected readonly series = new Map<string, { values: string[]; state: T }>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[],
    /** Above this many label combinations, new ones are folded into `other` values. */
    private readonly maxSeries: number,
  ) {
    if (!NAME_PATTERN.test(name)) throw new Error(`Invalid metric name: ${name}`);
  }

  protected abstract initial(): T;

  protected stateFor(labels: Labels = {}): T {
    let values = this.labelNames.map((name) => labels[name] ?? '');
    let key = values.join('\u0000');
    let entry = this.series.get(key);
    if (!entry) {
      if (this.series.size >= this.maxSeries) {
        // A cardinality guard, not a feature: it should never trigger with bounded labels.
        values = this.labelNames.map(() => 'other');
        key = values.join('\u0000');
        entry = this.series.get(key);
      }
      if (!entry) {
        entry = { values, state: this.initial() };
        this.series.set(key, entry);
      }
    }
    return entry.state;
  }

  abstract render(): string;
}

export class Counter extends LabelledMetric<{ value: number }> {
  protected initial() {
    return { value: 0 };
  }

  inc(labels?: Labels, amount = 1): void {
    if (amount < 0) throw new Error('A counter only goes up.');
    this.stateFor(labels).value += amount;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { values, state } of this.series.values()) {
      lines.push(
        `${this.name}${formatLabels(this.labelNames, values)} ${formatNumber(state.value)}`,
      );
    }
    return lines.join('\n');
  }
}

export class Gauge extends LabelledMetric<{ value: number }> {
  constructor(
    name: string,
    help: string,
    labelNames: readonly string[],
    maxSeries: number,
    /** Called at scrape time to refresh the value(s). */
    private readonly collect?: (gauge: Gauge) => void,
  ) {
    super(name, help, labelNames, maxSeries);
  }

  protected initial() {
    return { value: 0 };
  }

  set(value: number, labels?: Labels): void {
    this.stateFor(labels).value = value;
  }

  inc(labels?: Labels, amount = 1): void {
    this.stateFor(labels).value += amount;
  }

  dec(labels?: Labels, amount = 1): void {
    this.stateFor(labels).value -= amount;
  }

  render(): string {
    try {
      this.collect?.(this);
    } catch {
      // A failed collector leaves the previous value; scraping must never throw.
    }
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const { values, state } of this.series.values()) {
      lines.push(
        `${this.name}${formatLabels(this.labelNames, values)} ${formatNumber(state.value)}`,
      );
    }
    return lines.join('\n');
  }
}

/** Default latency buckets, in seconds: 1 ms to 10 s. */
export const LATENCY_BUCKETS = [
  0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

interface HistogramState {
  counts: number[];
  sum: number;
  count: number;
}

export class Histogram extends LabelledMetric<HistogramState> {
  constructor(
    name: string,
    help: string,
    labelNames: readonly string[],
    maxSeries: number,
    readonly buckets: readonly number[] = LATENCY_BUCKETS,
  ) {
    super(name, help, labelNames, maxSeries);
    for (let index = 1; index < buckets.length; index++) {
      if (buckets[index]! <= buckets[index - 1]!) throw new Error('Buckets must increase.');
    }
  }

  protected initial(): HistogramState {
    return { counts: this.buckets.map(() => 0), sum: 0, count: 0 };
  }

  observe(value: number, labels?: Labels): void {
    const state = this.stateFor(labels);
    state.sum += value;
    state.count += 1;
    // Stored non-cumulatively; cumulated when rendered.
    const index = this.buckets.findIndex((bound) => value <= bound);
    if (index >= 0) state.counts[index]! += 1;
  }

  /** Start a timer; the returned function records the elapsed seconds. */
  startTimer(labels?: Labels): (more?: Labels) => number {
    const started = process.hrtime.bigint();
    return (more) => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      this.observe(seconds, { ...labels, ...more });
      return seconds;
    };
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const { values, state } of this.series.values()) {
      let cumulative = 0;
      this.buckets.forEach((bound, index) => {
        cumulative += state.counts[index]!;
        lines.push(
          `${this.name}_bucket${formatLabels(this.labelNames, values, `le="${formatNumber(bound)}"`)} ${cumulative}`,
        );
      });
      lines.push(
        `${this.name}_bucket${formatLabels(this.labelNames, values, 'le="+Inf"')} ${state.count}`,
      );
      lines.push(
        `${this.name}_sum${formatLabels(this.labelNames, values)} ${formatNumber(state.sum)}`,
      );
      lines.push(`${this.name}_count${formatLabels(this.labelNames, values)} ${state.count}`);
    }
    return lines.join('\n');
  }
}

interface MetricOptions {
  name: string;
  help: string;
  labelNames?: readonly string[];
  /** Cardinality guard (default 500 series). */
  maxSeries?: number;
}

export class Registry {
  private readonly metrics = new Map<string, Metric>();

  private add<M extends Metric>(metric: M): M {
    if (this.metrics.has(metric.name)) throw new Error(`Metric ${metric.name} already exists.`);
    this.metrics.set(metric.name, metric);
    return metric;
  }

  counter(options: MetricOptions): Counter {
    return this.add(
      new Counter(options.name, options.help, options.labelNames ?? [], options.maxSeries ?? 500),
    );
  }

  gauge(options: MetricOptions & { collect?: (gauge: Gauge) => void }): Gauge {
    return this.add(
      new Gauge(
        options.name,
        options.help,
        options.labelNames ?? [],
        options.maxSeries ?? 500,
        options.collect,
      ),
    );
  }

  histogram(options: MetricOptions & { buckets?: readonly number[] }): Histogram {
    return this.add(
      new Histogram(
        options.name,
        options.help,
        options.labelNames ?? [],
        options.maxSeries ?? 500,
        options.buckets,
      ),
    );
  }

  /** The Prometheus text exposition (content type `PROMETHEUS_CONTENT_TYPE`). */
  render(): string {
    return `${[...this.metrics.values()].map((metric) => metric.render()).join('\n')}\n`;
  }
}

export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
