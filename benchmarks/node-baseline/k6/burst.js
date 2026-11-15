/*
 * Milestone 7 — burst and recovery on the mixed workload: 60 s calm (10 VUs), 60 s burst
 * (80 VUs), 60 s recovery (10 VUs). Latency and correctness are reported per phase, so
 * "recovered" means the recovery phase looks like the calm one again.
 *
 *   k6 run -e WEB=… -e API=… -e FIXTURES=… -e ACTION=… --summary-export burst.json k6/burst.js
 */
import { mixed } from './scenarios.js';

const phase = (vus, startTime) => ({
  executor: 'constant-vus',
  vus,
  duration: '60s',
  startTime,
  gracefulStop: '5s',
  exec: 'run',
});

export const options = {
  scenarios: { calm: phase(10, '0s'), burst: phase(80, '65s'), recovery: phase(10, '130s') },
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max', 'count'],
  // Thresholds only so that the per-phase submetrics appear in the summary export.
  thresholds: {
    'http_req_duration{scenario:calm}': ['max>=0'],
    'http_req_duration{scenario:burst}': ['max>=0'],
    'http_req_duration{scenario:recovery}': ['max>=0'],
    'http_reqs{scenario:calm}': ['count>=0'],
    'http_reqs{scenario:burst}': ['count>=0'],
    'http_reqs{scenario:recovery}': ['count>=0'],
    'velasia_correct{scenario:calm}': ['rate>=0'],
    'velasia_correct{scenario:burst}': ['rate>=0'],
    'velasia_correct{scenario:recovery}': ['rate>=0'],
  },
};

export function run() {
  mixed();
}
