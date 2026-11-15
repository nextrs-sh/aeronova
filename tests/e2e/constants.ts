/**
 * The whole suite runs on a pinned "today": the API, the Next.js server, and
 * (via `page.clock`, see helpers.ts) the browser all agree, so inventory,
 * prices, and dates are deterministic regardless of the real date.
 */
export const E2E_TODAY = '2026-12-01';
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3200);
export const API_PORT = Number(process.env.E2E_API_PORT ?? 4210);
export const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
