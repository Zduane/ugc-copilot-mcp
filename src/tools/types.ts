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
 * Backend allow-list at functions/index.js:15270 (FREE_TOOL_INDUSTRIES). Keep in sync.
 */
export const FREE_TOOL_INDUSTRIES = [
  'fitness',
  'beauty',
  'skincare',
  'fashion',
  'home',
  'tech',
  'food',
  'pets',
  'baby',
  'wellness',
  'gaming',
  'education',
  'finance',
  'travel',
  'business',
  'general',
] as const;

export const PLATFORMS = ['tiktok', 'instagram', 'youtube'] as const;

export const ENGINES = ['sora', 'veo', 'kling', 'seedance'] as const;

export const QUALITIES = ['standard', 'hq'] as const;

export const ASPECT_RATIOS = ['1:1', '9:16', '16:9', '4:5'] as const;

export const PROJECT_MODES = [
  'product-ad',
  'ugc-creator',
  'podcast-style',
  'influencer-noproduct',
  'vlog',
  'clone-video',
  'own-script',
] as const;

export const SCRIPT_PLATFORMS = ['tiktok', 'instagram-reels', 'youtube-shorts'] as const;
