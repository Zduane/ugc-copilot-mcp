export const API_KEY_ENV = 'UGC_COPILOT_API_KEY';

export const API_KEY_PROFILE_URL = 'https://ugccopilot.ai/profile/#api-keys';

export class MissingApiKeyError extends Error {
  override readonly name = 'MissingApiKeyError';
  constructor() {
    super(
      `${API_KEY_ENV} is not set. This tool requires authentication. ` +
        `Generate a key at ${API_KEY_PROFILE_URL} and pass it as an env var ` +
        `in your MCP server config. Free tools (analyze_trends, generate_hooks, ` +
        `generate_persona_preview, generate_script_preview) work without a key.`,
    );
  }
}

export function resolveApiKey(): string {
  const key = process.env[API_KEY_ENV];
  if (!key) throw new MissingApiKeyError();
  if (!key.startsWith('ugc_live_')) {
    throw new Error(
      `${API_KEY_ENV} is set but does not have the expected 'ugc_live_' prefix. ` +
        `Make sure you copied the full key from ${API_KEY_PROFILE_URL}.`,
    );
  }
  return key;
}

export function hasApiKey(): boolean {
  const key = process.env[API_KEY_ENV];
  return Boolean(key && key.startsWith('ugc_live_'));
}
