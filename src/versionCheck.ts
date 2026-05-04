/**
 * Startup version check.
 *
 * Once the MCP server is spawned by Claude Desktop / Cursor / etc, the running
 * process is "stuck" on whatever version npx resolved at spawn time. Even if
 * we publish a new version to npm, that running process keeps using the old
 * one until the host quits and respawns. Without a heads-up, users hit fixed
 * bugs because they don't realize they're on a stale npx cache.
 *
 * This runs once at startup, fire-and-forget. It fetches the registry's
 * `latest` dist-tag, compares to our compiled-in version, and writes a single
 * stderr line if newer. Stderr in this context goes to the host's MCP log
 * (`~/Library/Logs/Claude/mcp-server-ugc-copilot.log` on macOS) — visible to
 * anyone debugging their Claude Desktop session.
 *
 * Failure modes are silent on purpose: we never want a network glitch to
 * break startup. Failures here are not user-visible.
 */

const REGISTRY_URL = 'https://registry.npmjs.org/@ugccopilot/mcp/latest';
const TIMEOUT_MS = 3_000;

interface CheckOptions {
  /** Override fetch for tests. */
  fetch?: typeof fetch;
  /** Override stderr writer for tests. */
  log?: (msg: string) => void;
  /** Skip the actual call (useful in tests). */
  skip?: boolean;
}

/**
 * Compares two semver-ish version strings (e.g. "0.1.1" vs "0.1.2").
 * Returns true if `latest` is strictly newer than `current`.
 *
 * Naive but sufficient for our 0.x.y → 1.x.y trajectory. Pre-release tags
 * (`-beta.1`, `-rc.0`) are not handled — we'd surface them as "newer than"
 * a same-numeric stable, which is wrong, but we don't ship pre-release tags
 * yet. Revisit if/when we do.
 */
export function isNewer(current: string, latest: string): boolean {
  if (current === latest) return false;
  const cur = current.split('.').map((n) => Number.parseInt(n, 10));
  const lat = latest.split('.').map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < Math.max(cur.length, lat.length); i++) {
    const c = cur[i] ?? 0;
    const l = lat[i] ?? 0;
    if (Number.isNaN(c) || Number.isNaN(l)) return false; // unknown shape — bail
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

export async function checkForNewerVersion(
  currentVersion: string,
  options: CheckOptions = {},
): Promise<{ checked: boolean; latest?: string; isNewer?: boolean }> {
  if (options.skip) return { checked: false };
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const log = options.log ?? ((msg: string) => process.stderr.write(`${msg}\n`));

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const resp = await fetchImpl(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return { checked: false };
    const body = (await resp.json()) as { version?: string };
    const latest = body.version;
    if (!latest || typeof latest !== 'string') return { checked: false };
    const newer = isNewer(currentVersion, latest);
    if (newer) {
      log(
        `[ugc-copilot-mcp ${currentVersion}] newer version ${latest} available — quit Claude Desktop (⌘Q on macOS), run \`rm -rf ~/.npm/_npx\`, relaunch.`,
      );
    }
    return { checked: true, latest, isNewer: newer };
  } catch {
    // Network glitch / DNS / timeout — never break startup over this.
    return { checked: false };
  }
}
