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

export const ENGINES = ['sora', 'veo', 'kling', 'seedance'] as const;

export const QUALITIES = ['standard', 'hq'] as const;

export const ASPECT_RATIOS = ['1:1', '9:16', '16:9', '4:5'] as const;

export const PROJECT_MODES = [
  'product-ad',
  'ugc-creator',
  'podcast-style',
  'live-broadcast',
  'influencer-noproduct',
  'vlog',
  'clone-video',
  'own-script',
] as const;

export const SCRIPT_PLATFORMS = ['tiktok', 'instagram-reels', 'youtube-shorts'] as const;
