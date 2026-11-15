/**
 * Capture one real Server Action request (the Manage Booking lookup form, submitted by a real
 * browser) so k6 can replay it byte for byte. Without cookies the action validates the reference,
 * finds no owner credentials, and answers its "not found" state: this measures the Server Action
 * pipeline (routing, decoding, action, RSC response), not the API.
 *
 *   node lib/capture-action.mjs <webUrl> <out.json>
 */
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [webUrl, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(new URL('/manage-booking', webUrl).toString());
const captured = page.waitForRequest(
  (r) => r.method() === 'POST' && Boolean(r.headers()['next-action']),
);
await page.getByRole('textbox', { name: 'Booking reference' }).fill('VEL-8K4P2Q');
await page.getByTestId('lookup-submit').click();
const request = await captured;
const headers = Object.fromEntries(
  Object.entries(request.headers()).filter(([name]) =>
    ['accept', 'content-type', 'next-action', 'next-router-state-tree', 'origin'].includes(name),
  ),
);
writeFileSync(
  out,
  `${JSON.stringify({ path: new URL(request.url()).pathname, headers, body: request.postDataBuffer().toString('base64') }, null, 2)}\n`,
);
await browser.close();
console.log(`captured Server Action ${headers['next-action'].slice(0, 12)}…`);
