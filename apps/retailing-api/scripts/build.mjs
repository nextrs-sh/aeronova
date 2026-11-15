/**
 * Milestone 7: bundle the retailing API for production (`dist/server.mjs`, `dist/db-tool.mjs`).
 *
 * The production image runs plain `node` — no tsx, no TypeScript, no dev dependencies. Workspace
 * TypeScript (`@velasia/contracts`, `@velasia/observability`) and pure-JS packages are bundled.
 * Packages with native bindings stay external and are installed from the lockfile in the image:
 * `taladb` (+ `@taladb/node`) and `@node-rs/argon2`.
 */
import { build } from 'esbuild';

const external = ['taladb', '@taladb/node', '@node-rs/argon2'];

await build({
  entryPoints: { server: 'src/server.ts', 'db-tool': 'src/tools/db-tool-cli.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: 'linked',
  legalComments: 'linked',
  external,
  // Some bundled CommonJS dependencies call `require`; give the ESM bundle one.
  banner: {
    js: "import { createRequire as __velasiaCreateRequire } from 'node:module'; const require = __velasiaCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});
