/**
 * Pull the latest OpenAPI spec from the main UGC Copilot repo.
 * Run from npm: `npm run fetch-openapi`.
 *
 * Default source is the deployed JSON; override via OPENAPI_URL env var if you want
 * to pull from a local clone (e.g. file:///path/to/UGC-Copilot/docs/openapi.yaml).
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_URL = 'https://ugccopilot.ai/.well-known/openapi.json';

async function main(): Promise<void> {
  const url = process.env.OPENAPI_URL ?? DEFAULT_URL;
  const isLocalFile = url.startsWith('file://');

  let body: string;
  if (isLocalFile) {
    const { readFileSync } = await import('node:fs');
    body = readFileSync(new URL(url), 'utf-8');
  } else {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Fetch ${url} failed: HTTP ${resp.status}`);
    body = await resp.text();
  }

  const outPath = resolve(import.meta.dirname ?? '.', '..', 'openapi.json');
  writeFileSync(outPath, body, 'utf-8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath} (${body.length} bytes) from ${url}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
