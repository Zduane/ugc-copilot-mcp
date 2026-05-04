import { z } from 'zod';
import { toolJson } from '../errors.js';
import { ASPECT_RATIOS, PROJECT_MODES, QUALITIES, type ToolDefinition } from './types.js';

const InputSchema = z.object({
  visualPrompt: z
    .string()
    .min(1)
    .max(4000)
    .describe('Narrative visual prompt for the scene (paragraph style works better than keyword lists).'),
  quality: z.enum(QUALITIES).default('standard').optional().describe('standard (1 credit) or hq (2 credits).'),
  aspectRatio: z.enum(ASPECT_RATIOS).default('9:16').optional().describe('Aspect ratio.'),
  influencerImageUrl: z.string().url().optional().describe('Optional reference photo URL of the creator.'),
  productImageUrl: z.string().url().optional().describe('Optional product photo URL for compositing.'),
  referenceImageUrl: z.string().url().optional().describe('Generic reference photo to guide style.'),
  projectMode: z
    .enum(PROJECT_MODES)
    .optional()
    .describe('Content mode — affects compositing logic (e.g. own-script disables influencer framing).'),
});

type Input = z.infer<typeof InputSchema>;

interface ImageResult {
  imageData: string;
  mimeType: string;
}

export const generateImage: ToolDefinition<Input> = {
  name: 'generate_image',
  description:
    'Generate a scene image from a visual prompt. Returns a base64 data URI or a Firebase Storage URL plus mime type. ' +
    'Cost: 1 credit standard / 2 credits hq. Requires UGC_COPILOT_API_KEY. ' +
    'NOTE: When the backend returns inline base64, a single image can be 600KB-1MB which consumes a lot of agent context. ' +
    "Call sparingly; if you only need to display the image, prefer rendering through the web app or a follow-up tool that returns a URL.",
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const body: Record<string, unknown> = { visualPrompt: input.visualPrompt };
    if (input.quality) body.quality = input.quality;
    if (input.aspectRatio) body.aspectRatio = input.aspectRatio;
    if (input.influencerImageUrl) body.influencerImageUrl = input.influencerImageUrl;
    if (input.productImageUrl) body.productImageUrl = input.productImageUrl;
    if (input.referenceImageUrl) body.referenceImageUrl = input.referenceImageUrl;
    if (input.projectMode) body.projectMode = input.projectMode;
    const result = await client.callApi<ImageResult>('proxyGenerateSceneImage', body);
    return toolJson(result);
  },
};
