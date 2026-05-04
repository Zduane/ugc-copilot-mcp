import { z } from 'zod';
import { toolJson } from '../errors.js';
import { PROJECT_MODES, SCRIPT_PLATFORMS, type ToolDefinition } from './types.js';

const InputSchema = z.object({
  productDescription: z.string().min(1).max(4000).describe('Product / service description.'),
  twinDescription: z.string().optional().describe('Inline creator persona description (alternative to twinId).'),
  twinId: z.string().optional().describe('ID of a saved AI Twin (reuse a persistent persona).'),
  tone: z.string().optional().describe('Script tone (e.g. "humorous", "urgent", "educational").'),
  platform: z.enum(SCRIPT_PLATFORMS).optional().describe('Target platform.'),
  projectMode: z.enum(PROJECT_MODES).optional().describe('Content mode — drives template structure.'),
  isFaceless: z.boolean().optional().describe('If true, skip influencer / direct-to-camera framing.'),
  targetDurationSec: z
    .number()
    .int()
    .min(8)
    .max(90)
    .optional()
    .describe('Target total duration in seconds (8-90).'),
});

type Input = z.infer<typeof InputSchema>;

export const generateScript: ToolDefinition<Input> = {
  name: 'generate_script',
  description:
    'Generate a full viral UGC script: hook variations, scene-level visual prompts and dialogue, CTAs, and platform-specific variations (TikTok / Instagram Reels / YouTube Shorts). ' +
    'Cost: 1 credit. Requires UGC_COPILOT_API_KEY. ' +
    "IMPORTANT — pick the right tool for the job: " +
    "(a) For a product-focused script (most common case), use **generate_script_preview** instead — it's free, " +
    "takes only `industry` + `productDescription`, and returns the same hooks/scenes/CTA shape. " +
    "(b) Use this `generate_script` tool when you need full control over `tone`, `platform`, `targetDurationSec`, or AI Twin reuse via `twinId`. " +
    "(c) `projectMode` defaults to 'product-ad', which on the BACKEND requires product images that this MCP tool does not yet expose — " +
    "so calling with default mode + no twinId returns a validation error. " +
    "For ad-hoc product scripts via this tool, set `projectMode: 'ugc-creator'` or `'influencer-noproduct'` and pass `isFaceless: true`. " +
    "Setting `tone: 'podcast-style'` is a STYLE hint (the AI applies it to delivery), distinct from `projectMode: 'podcast-style'` " +
    "which is a CONTENT MODE for talking-head commentary that does not center a product.",
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const body: Record<string, unknown> = { productDescription: input.productDescription };
    if (input.twinDescription) body.twinDescription = input.twinDescription;
    if (input.twinId) body.twinId = input.twinId;
    if (input.tone) body.tone = input.tone;
    if (input.platform) body.platform = input.platform;
    if (input.projectMode) body.projectMode = input.projectMode;
    if (input.isFaceless !== undefined) body.isFaceless = input.isFaceless;
    if (input.targetDurationSec) body.targetDurationSec = input.targetDurationSec;
    const result = await client.callApi<unknown>('proxyGenerateViralScript', body);
    return toolJson(result);
  },
};
