import { z } from 'zod';
import { toolJson } from '../errors.js';
import { PLATFORMS, type ToolDefinition } from './types.js';

const InputSchema = z.object({
  productDescription: z
    .string()
    .min(10)
    .max(1000)
    .describe('Product description (10-1000 chars). What does it do? Who is it for?'),
  platform: z
    .enum(PLATFORMS)
    .describe('Target platform — drives the platform-specific tone and format.'),
});

type Input = z.infer<typeof InputSchema>;

interface HooksResult {
  hooks: Array<{
    category: string;
    hook: string;
    visualSuggestion: string;
    textOverlay: string;
    format: string;
  }>;
}

export const generateHooks: ToolDefinition<Input> = {
  name: 'generate_hooks',
  description:
    'Generate 10 scroll-stopping hook variations across the viral hook taxonomy (curiosity, social proof, skeptic-to-believer, specific-number lead, etc.) for a product on TikTok, Instagram Reels, or YouTube Shorts. ' +
    'Free tier — no API key required, rate-limited to 5 calls/day per IP.',
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const result = await client.callPublic<HooksResult>('freeGenerateHooks', {
      productDescription: input.productDescription,
      platform: input.platform,
    });
    return toolJson(result);
  },
};
