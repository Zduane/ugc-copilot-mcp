import { z } from 'zod';
import { toolJson } from '../errors.js';
import type { ToolDefinition } from './types.js';

/**
 * Mirrors the backend `TextOverlay` shape in /Users/zacharywarren/UGC-Copilot/types.ts:178-207
 * (and what `proxyApplyTextOverlay` actually consumes at functions/index.js:10319-10446).
 *
 * Prior versions of this schema used `startSec`/`endSec` and a nested `style.{fontSize:number,...}`
 * block — neither matched the backend, so timing and styling silently fell back to defaults.
 * Keep this file's fields aligned with `TextOverlay` end-to-end.
 */
const OverlaySchema = z.object({
  text: z.string().min(1).max(50),
  position: z.enum(['top', 'center', 'bottom']).optional(),
  fontFamily: z.enum(['montserrat', 'poppins', 'bebas', 'oswald']).optional(),
  fontSize: z.enum(['small', 'medium', 'large', 'xlarge']).optional(),
  fontColor: z.string().optional(),
  uppercase: z.boolean().optional(),
  showBackground: z.boolean().optional(),
  backgroundColor: z.string().optional(),
  backgroundOpacity: z.number().min(0).max(100).optional(),
  strokeEnabled: z.boolean().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().min(0).max(5).optional(),
  shadowEnabled: z.boolean().optional(),
  shadowColor: z.string().optional(),
  shadowOffset: z.number().min(1).max(5).optional(),
  startTime: z.number().min(0).optional(),
  endTime: z.number().min(0).optional(),
});

const InputSchema = z.object({
  videoUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), { message: 'videoUrl must use https://' })
    .describe('Source video URL (typically a signed URL from fetch_video).'),
  overlays: z
    .array(OverlaySchema)
    .min(1)
    .max(5)
    .describe('1-5 text overlays. Per-overlay timing via startTime/endTime (seconds) controls when each overlay appears.'),
});
// Note: `aspectRatio` is destructured by the backend (functions/index.js:10249)
// but never referenced in the FFmpeg filter chain — it's effectively a no-op
// today, so omit it from the public MCP surface to avoid misleading users.
// Re-add here (and update backend to honor it) if/when positioning math becomes
// aspect-aware.

type Input = z.infer<typeof InputSchema>;

interface BackendResult {
  overlayVideoUrl: string;
}

interface OverlayResult {
  videoUrl: string;
}

export const applyTextOverlay: ToolDefinition<Input> = {
  name: 'apply_text_overlay',
  title: 'Apply Text Overlays',
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  description:
    'Burn 1-5 text overlays (captions, hooks, CTAs) onto a rendered video. Each overlay supports independent positioning, font/color/stroke/shadow styling, and per-overlay timing via startTime/endTime (in seconds). Cost: 1 credit per call. Requires authentication (connected UGC Copilot account or API key).',
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const result = await client.callApi<BackendResult>('proxyApplyTextOverlay', {
      videoUri: input.videoUrl,
      overlays: input.overlays,
    });
    const normalized: OverlayResult = { videoUrl: result.overlayVideoUrl };
    return toolJson(normalized);
  },
};
