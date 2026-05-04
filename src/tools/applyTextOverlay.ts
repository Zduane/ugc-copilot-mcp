import { z } from 'zod';
import { toolJson } from '../errors.js';
import type { ToolDefinition } from './types.js';

const OverlaySchema = z.object({
  text: z.string().min(1).max(200),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  position: z.enum(['top', 'center', 'bottom']).optional(),
  style: z
    .object({
      fontFamily: z.string().optional(),
      fontSize: z.number().int().min(8).max(200).optional(),
      color: z.string().optional(),
      backgroundColor: z.string().nullable().optional(),
    })
    .optional(),
});

const InputSchema = z.object({
  videoUrl: z.string().url().describe('Source video URL (typically a signed URL from fetch_video).'),
  overlays: z.array(OverlaySchema).min(1).describe('One or more text overlays to burn onto the video.'),
});

type Input = z.infer<typeof InputSchema>;

interface OverlayResult {
  videoUrl: string;
  mimeType: string;
}

export const applyTextOverlay: ToolDefinition<Input> = {
  name: 'apply_text_overlay',
  description:
    'Burn text overlays (captions, hooks, CTAs) onto a rendered video. Cost: 1 credit per call (multiple overlays in one call supported). Requires UGC_COPILOT_API_KEY.',
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const result = await client.callApi<OverlayResult>('proxyApplyTextOverlay', {
      videoUrl: input.videoUrl,
      overlays: input.overlays,
    });
    return toolJson(result);
  },
};
