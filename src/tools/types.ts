import { z } from 'zod';
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

// 'omni' = Gemini Omni Flash (GA gemini-omni-1.1-flash) — 720p, 4–10s, 16:9/9:16 only, no HQ tier.
// Full OpenAPI Engine enum. 'sora' and 'veo' stay here for tools that name an EXISTING
// render (check_video_status / wait_for_video / fetch_video / stitch_videos): OpenAI shut
// the Sora API down 2026-09-24 (backend renders 'sora' on Seedance or Kling) and Google
// shuts the Veo 3.1 previews down 2026-10-22 (backend renders 'veo' on Omni), so a caller
// may still hold either name for an existing render.
export const ENGINES = ['sora', 'veo', 'kling', 'seedance', 'omni'] as const;

// Engines a NEW render can target. No 'sora' or 'veo' — both are retired; an agent that
// asks for one is rendered (and billed) on the replacement engine, not the one it named.
export const RENDER_ENGINES = ['kling', 'seedance', 'omni'] as const;

// Retired engine → what the backend renders it on. Used to turn a rejected 'veo'/'sora'
// into an actionable error (render_video) or to forward a soft hint (parse_own_script).
export const RETIRED_ENGINE_REPLACEMENTS = { sora: 'seedance', veo: 'omni' } as const;

const RETIRED_ENGINE_MESSAGES: Record<string, string> = {
  veo:
    "Veo 3.1 is retired (Google shuts it down 2026-10-22) and can't be used for new renders. " +
    "Use engine 'omni' with modelName 'gemini-omni-1.1-flash' — image-to-video or text-to-video with native audio, " +
    '40 credits per 8s — or kling for an exact face from a specific image.',
  sora:
    "Sora 2 is retired (OpenAI shut its API down 2026-09-24) and can't be used for new renders. " +
    "Use seedance (text-to-video or faceless image-to-video) or kling (a person from a specific image).",
};

/**
 * zod errorMap for the RENDER_ENGINES enum: a retired engine gets a message naming its
 * replacement instead of the bare "Invalid enum value" (agents otherwise pick an engine
 * at random — e.g. seedance, which rejects a person in the reference image).
 */
export const renderEngineErrorMap: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code === z.ZodIssueCode.invalid_enum_value) {
    const msg = RETIRED_ENGINE_MESSAGES[String(issue.received)];
    if (msg) return { message: msg };
  }
  return { message: ctx.defaultError };
};

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
