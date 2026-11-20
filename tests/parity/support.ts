import { expect, test, type Page, type Request, type Response } from '@playwright/test';

/*
 * Milestone 8: shared settings for the Node.js / NextRS parity suite (playwright.parity.config.ts).
 *
 * Both storefronts and the shared retailing API run on a pinned "today" (VELASIA_TODAY, also a
 * build argument), and the browser clock is pinned to it, so inventory and prices are the same
 * for every run and for both runtimes.
 */

export const TODAY = process.env.PARITY_TODAY ?? '2026-12-01';
export const RUNTIMES = {
  node: process.env.PARITY_NODE_URL ?? 'http://127.0.0.1:8081',
  nextrs: process.env.PARITY_NEXTRS_URL ?? 'http://127.0.0.1:8082',
} as const;
export type Runtime = keyof typeof RUNTIMES;
/** Demo registration is closed in production; the account test runs only when it is open. */
export const ACCOUNTS_OPEN = process.env.PARITY_ACCOUNTS === 'enabled';

export const addDays = (days: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export const DEPART = addDays(21);
export const SEARCH = `/flights?trip=one-way&from=MNL&to=SIN&depart=${DEPART}&adults=1&cabin=economy`;
export const API_FLIGHTS = `/api/flights?from=MNL&to=SIN&departureDate=${DEPART}&adults=1`;

export async function pinClock(page: Page) {
  await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00+08:00`));
}

export type Problems = { errors: string[]; rsc: string[]; documents: string[] };

/*
 * Known app-level console message, Firefox only: zod v4 probes eval support inside a
 * try/catch and Velasia's CSP (no 'unsafe-eval') blocks it. The chunk bytes come from
 * `next build`, so both runtimes show it equally. Counted as an annotation, never hidden.
 */
const APP_CSP_EVAL_PROBE = /Content-Security-Policy: .*blocked a JavaScript eval/;

/** Records page errors, console errors (hydration errors are console errors), failed requests. */
export function watch(page: Page, allow: RegExp[] = []): Problems {
  const p: Problems = { errors: [], rsc: [], documents: [] };
  const allowed = (text: string) => {
    if (APP_CSP_EVAL_PROBE.test(text)) {
      test.info().annotations.push({ type: 'app-csp-eval-probe', description: text.slice(0, 160) });
      return true;
    }
    return allow.some((re) => re.test(text));
  };
  page.on('pageerror', (e) => {
    const t = `pageerror: ${e.message}`;
    if (!allowed(t)) p.errors.push(t);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = `console: ${m.text()}`;
    if (!allowed(t)) p.errors.push(t);
  });
  page.on('requestfailed', (r: Request) => {
    const t = `requestfailed: ${r.method()} ${r.url()} (${r.failure()?.errorText})`;
    // A newer navigation aborting an older prefetch is normal.
    if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(t)) return;
    if (!allowed(t)) p.errors.push(t);
  });
  page.on('response', (r: Response) => {
    const t = `http ${r.status()}: ${r.request().method()} ${r.url()}`;
    if (r.status() >= 400 && !allowed(t)) p.errors.push(t);
  });
  page.on('request', (r) => {
    if (r.headers()['rsc'] === '1' || /[?&]_rsc=/.test(r.url())) p.rsc.push(r.url());
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) p.documents.push(r.url());
  });
  return p;
}

export const shown = (page: Page, testId: string) =>
  page.getByTestId(testId).filter({ visible: true });

export async function waitForSearchWidget(page: Page) {
  await expect(
    page.locator('[data-testid="flight-search"][data-ready="true"]').first(),
  ).toBeAttached();
}

/** Visible text of an HTML fragment: tags removed, entities and whitespace normalised. */
export function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;|\s+/g, ' ')
    .trim();
}

/** `<title>`, meta description and every h1/h2 of a server-rendered page. */
export function outline(html: string) {
  const all = (re: RegExp) => [...html.matchAll(re)].map((m) => textOf(m[1] ?? ''));
  return {
    title: all(/<title[^>]*>([\s\S]*?)<\/title>/g)[0] ?? null,
    description: /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? null,
    h1: all(/<h1[^>]*>([\s\S]*?)<\/h1>/g),
    h2: all(/<h2[^>]*>([\s\S]*?)<\/h2>/g),
  };
}
