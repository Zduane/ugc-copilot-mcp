import type { z } from 'zod';
import type { UgcCopilotClient } from '../client.js';
import type { ToolResult } from '../errors.js';

/**
 * MCP tool behavior annotations (subset of the spec's ToolAnnotations we use).
 * Directory reviewers check these against actual behavior — readOnlyHint must
 * be true ONLY for tools with no persistent side effects and no credit charge.
 */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Per-call context threaded by the server (third handler arg). Stdio passes
 * nothing; the hosted Streamable HTTP server uses it to shrink in-call wait
 * budgets below the Firebase Hosting 60s rewrite cap.
 */
export interface ToolContext {
  /** Hard cap on intentional in-call waiting (wait_for_video), in ms. */
  waitBudgetMs?: number;
}

export interface ToolDefinition<TInput = unknown> {
  name: string;
  /** Human-readable display name (required for the Claude connector directory). */
  title: string;
  description: string;
  annotations: ToolAnnotations;
  inputSchema: z.ZodType<TInput>;
  handler: (input: TInput, client: UgcCopilotClient, ctx?: ToolContext) => Promise<ToolResult>;
}

/**
 * Industries supported by the free trend analyzer + script preview endpoints.
 * Backend allow-list at functions/index.js:15278 (FREE_TOOL_INDUSTRIES).
 *
 * MUST stay in sync — sending an industry not on the backend list returns
 * 400 "Invalid industry. Please select from the provided list." (real bug
 * we hit in 0.1.0 where the local list used slugs like 'pets' but the
 * backend wants "Pets & Animals"). Drift-check in CI guards this.
 */
export const FREE_TOOL_INDUSTRIES = [
  'Beauty & Cosmetics',
  'Fashion & Style',
  'Food & Recipes',
  'Gaming & eSports',
  'Health & Fitness',
  'DIY & Crafts',
  'Comedy & Entertainment',
  'Dance & Music',
  'Education & Life Hacks',
  'Pets & Animals',
  'Personal Finance & Investing',
  'Tech & Gadgets',
  'Software & Apps',
  'Travel & Adventure',
  'Parenting & Family',
  'Home & Decor',
] as const;

export const PLATFORMS = ['tiktok', 'instagram', 'youtube'] as const;

// 'omni' = Gemini Omni Flash (preview) — 720p, 4–10s, 16:9/9:16 only, no HQ tier.
export const ENGINES = ['sora', 'veo', 'kling', 'seedance', 'omni'] as const;

export const QUALITIES = ['standard', 'hq'] as const;

// Image engines accepted by the image endpoints (optional `imageEngine` field,
// OpenAPI v2026-07-14). 'gemini' is the backend default; 'openai' = GPT Image 2.
// Credits differ at HQ: gemini 1/2, openai 1/3 — mirror IMAGE_ENGINE_COSTS in
// the main repo's constants when this changes.
export const IMAGE_ENGINES = ['gemini', 'openai'] as const;

export const ASPECT_RATIOS = ['1:1', '9:16', '16:9', '4:5'] as const;

/**
 * Project modes accepted by the backend. Must stay in sync with VALID_PROJECT_MODES in
 * `functions/constants.js` of the main repo. The deprecated trio (ugc-creator,
 * influencer-noproduct, vlog) is kept for backwards compatibility — the backend's
 * normalizeProjectMode maps them to 'creator' on read.
 *
 * - 'creator' — canonical creator-led / lifestyle / vlog / haul content. Preferred over
 *   the deprecated aliases for new integrations.
 * - 'creator-intimate' — Mature Mode (suggestive-not-explicit photo sets for OnlyFans,
 *   Fanvue, Instagram subscriber feeds). Requires the user to have paid entitlement AND
 *   to have accepted the Mature Mode T&C via the web UI. Also locks the video engine to
 *   'kling' — passing any other engine to /proxyStartVideoGeneration returns 400
 *   mode_engine_not_allowed.
 *   API errors specific to this mode: mature_mode_paid_required, mature_mode_terms_required.
 */
export const PROJECT_MODES = [
  'product-ad',
  'creator',
  'creator-intimate',
  'ugc-creator',
  'podcast-style',
  'live-broadcast',
  'influencer-noproduct',
  'vlog',
  'clone-video',
  'own-script',
] as const;

export const SCRIPT_PLATFORMS = ['tiktok', 'instagram-reels', 'youtube-shorts'] as const;

/**
 * Audio treatment hint used by parse_own_script (and any future tool that needs
 * to override the projectMode-inferred audio mode).
 *
 * - 'voiceover' — all scenes are scriptType=voiceover, no visible speaker
 * - 'dialogue' — on-camera dialogue allowed
 * - 'background' — music/ambient only, no spoken script
 */
export const AUDIO_MODES = ['voiceover', 'dialogue', 'background'] as const;
