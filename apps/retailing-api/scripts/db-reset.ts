/* eslint-disable no-console -- a command-line script: its output is the point. */
/**
 * Development only: delete the retailing API's TalaDB file (all demo orders) so the next start
 * begins empty. Never runs automatically.
 *
 *   pnpm --filter @velasia/retailing-api db:reset            # shows what would be deleted
 *   pnpm --filter @velasia/retailing-api db:reset --confirm  # deletes it
 *
 * Refuses while an API process holds the database (TalaDB's file lock), so a running server's
 * data is never pulled out from under it.
 */
import { existsSync, rmSync } from 'node:fs';
import { loadConfig } from '../src/config';
import { openDatabase } from '../src/db/client';

const path = loadConfig().persistence.path!;
if (!existsSync(path)) {
  console.log(`No database at ${path}; nothing to reset.`);
  process.exit(0);
}
try {
  const db = await openDatabase(path);
  const orders = await db.orders.count({});
  await db.close();
  if (!process.argv.includes('--confirm')) {
    console.log(`${path} holds ${orders} order(s). Run again with --confirm to delete it.`);
    process.exit(0);
  }
} catch (error) {
  console.error(`Not reset: ${(error as Error).message} Stop the retailing API first.`);
  process.exit(1);
}
rmSync(path, { force: true });
console.log(`Deleted ${path}. The next start creates an empty database.`);
// The open handle can't be reused once its file is gone; exit explicitly.
process.exit(0);
