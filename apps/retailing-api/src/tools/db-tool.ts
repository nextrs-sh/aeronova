/* eslint-disable no-console -- a command-line tool: its output is the point. */
/**
 * Milestone 7: TalaDB backup, restore, and verification for the retailing API.
 *
 *   db-tool verify  --db <file>
 *   db-tool backup  --db <file> --out <dir>
 *   db-tool restore --backup <file.db> --db <file> [--replace]
 *
 * In development: `pnpm --filter @velasia/retailing-api db:backup -- --db … --out …`.
 * In the container: `node dist/db-tool.mjs …` (see docs/DEPLOYMENT.md).
 *
 * Consistency: TalaDB 0.13 has no online snapshot or export API, and copying the file while
 * the API is writing is not safe. Every command therefore first takes TalaDB's exclusive file
 * lock, which fails while an API process owns the file: backups and restores happen with the
 * API stopped (a quiesced, cold copy). Holding the lock, the tool copies the file, fsyncs the
 * copy, records its SHA-256, and checks a scratch copy end to end (`checkIntegrity`) before the
 * backup is kept. A restore re-checks the checksum and integrity, never overwrites a database
 * unless `--replace` is given, keeps the replaced file beside it, and swaps the new file in with
 * an atomic rename.
 *
 * Backups contain passenger names, contact details, and account data: they are written with
 * owner-only permissions (0600) and must never be committed or published as CI artifacts.
 */
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openDB } from 'taladb';
import { openDatabase } from '../db/client';
import { checkIntegrity, type IntegrityReport } from '../db/integrity';

export const BACKUP_FORMAT = 'velasia-taladb-backup/1';

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  file: string;
  sha256: string;
  bytes: number;
  createdAt: string;
  schemaVersion: number;
  counts: IntegrityReport['counts'];
  orders: IntegrityReport['orders'];
}

export class DbToolError extends Error {
  override readonly name = 'DbToolError';
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function fsyncFile(file: string): void {
  const fd = openSync(file, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDir(dir: string): void {
  try {
    fsyncFile(dir);
  } catch {
    // Not every platform allows fsync on a directory; the rename is still atomic.
  }
}

/**
 * Hold TalaDB's exclusive lock on `file` while `work` runs. Opening without migrations never
 * changes the file's schema. Fails with a clear message while the API (or anyone) owns it.
 */
async function withExclusiveLock<T>(file: string, work: () => T | Promise<T>): Promise<T> {
  let db: Awaited<ReturnType<typeof openDB>>;
  try {
    db = await openDB(file, { config: {}, durability: { flush_every_write: true } });
  } catch (cause) {
    const locked = /already open|acquire lock/i.test(String((cause as Error)?.message));
    throw new DbToolError(
      locked
        ? `${file} is in use by another process. Stop the retailing API first (backups and restores are taken with the API stopped).`
        : `Could not open ${file}: ${(cause as Error)?.message}`,
      { cause },
    );
  }
  try {
    return await work();
  } finally {
    await db.close();
  }
}

/**
 * Open a throwaway copy of `file` and check it end to end; the original is never opened by
 * the application code (migrations run only on the copy). `copy` lets the caller take the copy
 * while it holds the lock.
 */
export async function verifyCopyOf(
  file: string,
  copy: (from: string, to: string) => void | Promise<void> = copyFileSync,
): Promise<IntegrityReport> {
  const scratchDir = mkdtempSync(join(tmpdir(), 'velasia-verify-'));
  const scratch = join(scratchDir, 'verify.db');
  try {
    await copy(file, scratch);
    const database = await openDatabase(scratch);
    try {
      return await checkIntegrity(database);
    } finally {
      await database.close();
    }
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

const timestamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-');

export async function backup(dbFile: string, outDir: string): Promise<BackupManifest> {
  const source = resolve(dbFile);
  if (!existsSync(source)) throw new DbToolError(`No database at ${source}.`);
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const name = `velasia-${timestamp()}`;
  const partial = join(outDir, `${name}.db.partial`);
  await withExclusiveLock(source, () => {
    copyFileSync(source, partial);
    fsyncFile(partial);
  });
  chmodSync(partial, 0o600);
  const report = await verifyCopyOf(partial);
  if (!report.ok) {
    rmSync(partial, { force: true });
    throw new DbToolError(
      `The copy failed its integrity check; no backup was kept:\n- ${report.violations.join('\n- ')}`,
    );
  }
  const final = join(outDir, `${name}.db`);
  renameSync(partial, final);
  fsyncDir(outDir);
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    file: basename(final),
    sha256: sha256(final),
    bytes: statSync(final).size,
    createdAt: new Date().toISOString(),
    schemaVersion: report.schemaVersion,
    counts: report.counts,
    orders: report.orders,
  };
  const manifestFile = join(outDir, `${name}.json`);
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

export function readManifest(backupFile: string): BackupManifest {
  const manifestFile = backupFile.replace(/\.db$/, '.json');
  if (!existsSync(manifestFile)) {
    throw new DbToolError(`No manifest beside ${backupFile} (expected ${manifestFile}).`);
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as BackupManifest;
  if (manifest.format !== BACKUP_FORMAT) {
    throw new DbToolError(`Unknown backup format in ${manifestFile}.`);
  }
  return manifest;
}

export async function restore(
  backupFile: string,
  dbFile: string,
  { replace = false }: { replace?: boolean } = {},
): Promise<{ manifest: BackupManifest; replaced: string | null; report: IntegrityReport }> {
  const source = resolve(backupFile);
  const target = resolve(dbFile);
  if (!existsSync(source)) throw new DbToolError(`No backup at ${source}.`);
  const manifest = readManifest(source);
  if (sha256(source) !== manifest.sha256) {
    throw new DbToolError(`${source} does not match its manifest checksum; not restored.`);
  }
  const report = await verifyCopyOf(source);
  if (!report.ok) {
    throw new DbToolError(
      `The backup failed its integrity check; not restored:\n- ${report.violations.join('\n- ')}`,
    );
  }
  mkdirSync(dirname(target), { recursive: true });
  let replaced: string | null = null;
  const incoming = `${target}.restore-partial`;
  copyFileSync(source, incoming);
  fsyncFile(incoming);
  chmodSync(incoming, 0o600);
  if (existsSync(target)) {
    if (!replace) {
      rmSync(incoming, { force: true });
      throw new DbToolError(
        `${target} already exists. Pass --replace to replace it (it is kept as a .pre-restore copy).`,
      );
    }
    replaced = `${target}.pre-restore-${timestamp()}`;
    // Proves no API owns the live file, then moves it aside (same directory: atomic rename).
    await withExclusiveLock(target, () => renameSync(target, replaced!));
  }
  renameSync(incoming, target);
  fsyncDir(dirname(target));
  return { manifest, replaced, report };
}

export async function verify(dbFile: string): Promise<IntegrityReport> {
  const file = resolve(dbFile);
  if (!existsSync(file)) throw new DbToolError(`No database at ${file}.`);
  // Copy under the lock: a file the API is writing must not be judged from a mid-write copy.
  return verifyCopyOf(file, (from, to) => withExclusiveLock(from, () => copyFileSync(from, to)));
}

const USAGE = `usage:
  db-tool verify  --db <file>
  db-tool backup  --db <file> --out <dir>
  db-tool restore --backup <file.db> --db <file> [--replace]`;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      db: { type: 'string' },
      out: { type: 'string' },
      backup: { type: 'string' },
      replace: { type: 'boolean', default: false },
    },
    strict: true,
  });
  try {
    switch (command) {
      case 'verify': {
        if (!values.db) break;
        const report = await verify(values.db);
        console.log(JSON.stringify(report, null, 2));
        return report.ok ? 0 : 2;
      }
      case 'backup': {
        if (!values.db || !values.out) break;
        const manifest = await backup(values.db, values.out);
        console.log(JSON.stringify(manifest, null, 2));
        return 0;
      }
      case 'restore': {
        if (!values.backup || !values.db) break;
        const result = await restore(values.backup, values.db, { replace: values.replace });
        console.log(
          JSON.stringify(
            {
              restored: result.manifest.file,
              replaced: result.replaced,
              counts: result.report.counts,
            },
            null,
            2,
          ),
        );
        return 0;
      }
    }
    console.error(USAGE);
    return 64;
  } catch (error) {
    console.error(error instanceof DbToolError ? error.message : error);
    return 1;
  }
}
