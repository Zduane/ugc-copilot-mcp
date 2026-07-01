import type { z } from 'zod';
import type { UgcCopilotClient } from '../client.js';
import type { ToolResult } from '../errors.js';

export interface ToolDefinition<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  handler: (input: TInput, client: UgcCopilotClient) => Promise<ToolResult>;
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

// 'omni' = Gemini Omni Flash (preview) — 720p, 3–10s, 16:9/9:16 only, no HQ tier.
export const ENGINES = ['sora', 'veo', 'kling', 'seedance', 'omni'] as const;

export const QUALITIES = ['standard', 'hq'] as const;

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
