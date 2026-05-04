import { z } from 'zod';
import { toolJson } from '../errors.js';
import { ENGINES, type ToolDefinition } from './types.js';

const InputSchema = z.object({
  operationName: z.string().describe('Operation handle from render_video.'),
  engine: z.enum(ENGINES).describe('Engine that started the render.'),
  duration: z.number().int().min(4).max(20).optional().describe('Original render duration (passed back for trimming).'),
  isExtension: z
    .boolean()
    .optional()
    .describe('Set true for Sora extend flows so server-side FFmpeg trims correctly.'),
});

type Input = z.infer<typeof InputSchema>;

interface FetchResult {
  videoUrl: string;
  mimeType: string;
  isWatermarked?: boolean;
}

export const fetchVideo: ToolDefinition<Input> = {
  name: 'fetch_video',
  description:
    'Get the signed MP4 URL for a completed video render. Returns videoUrl (typical 7-day expiry), mimeType, and isWatermarked flag. ' +
    'For long-term retention, copy the bytes to your own storage on receipt. No credits charged. Requires UGC_COPILOT_API_KEY.',
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const body: Record<string, unknown> = {
      operationName: input.operationName,
      engine: input.engine,
    };
    if (input.duration) body.duration = input.duration;
    if (input.isExtension !== undefined) body.isExtension = input.isExtension;
    const result = await client.callApi<FetchResult>('proxyFetchVideo', body, {}, false);
    return toolJson(result);
  },
};
