/**
 * Generate TypeScript types from the local openapi.json.
 * Run via: `npm run gen-types` (assumes `fetch-openapi` ran first).
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname ?? '.', '..');
const input = resolve(root, 'openapi.json');
const output = resolve(root, 'src', 'generated.ts');

execSync(`npx -y openapi-typescript@latest "${input}" -o "${output}"`, {
  stdio: 'inherit',
  cwd: root,
});

// eslint-disable-next-line no-console
console.log(`Generated ${output} from ${input}`);
