import { z } from 'zod';
import { toolJson } from '../errors.js';
import { ENGINES, type ToolDefinition } from './types.js';

const InputSchema = z.object({
  videoUri: z
    .string()
    .min(1)
    .describe(
      'Video URI returned by wait_for_video / check_video_status. For Sora it is the operation handle ' +
      '(e.g. "video_..."); for Veo it is the upstream generativelanguage.googleapis.com file URL.',
    ),
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
  // Non-fatal warning when the backend's combined trim+watermark pass for a Sora
  // extension failed AND the trim-only fallback also failed. The returned clip is the
  // original source + the extension (longer than expected). Surface this to the user
  // so they understand the duration anomaly; the video is still usable. Paired with
  // `warningCode` for programmatic handling.
  warning?: string;
  warningCode?: 'sora-extension-trim-failed';
}

export const fetchVideo: ToolDefinition<Input> = {
  name: 'fetch_video',
  description:
    'Get the signed MP4 URL for a completed video render. Pass the videoUri returned by wait_for_video or check_video_status. ' +
    'Returns videoUrl (typical 7-day expiry), mimeType, isWatermarked flag, and an optional ' +
    '`warning` field (with `warningCode`) when a Sora extension trim fallback failed — surface ' +
    'the warning to the user since the clip is longer than expected in that case. ' +
    'For long-term retention, copy the bytes to your own storage on receipt. No credits charged. Requires UGC_COPILOT_API_KEY.',
  inputSchema: InputSchema,
  handler: async (input, client) => {
    // Backend `proxyFetchVideo` reads `uri` (functions/index.js fetchVideoData
    // at line ~10130). Translate the public-friendly `videoUri` name on the wire.
    const body: Record<string, unknown> = {
      uri: input.videoUri,
      engine: input.engine,
    };
    if (input.duration) body.duration = input.duration;
    if (input.isExtension !== undefined) body.isExtension = input.isExtension;
    const result = await client.callApi<FetchResult>('proxyFetchVideo', body, {}, false);
    return toolJson(result);
  },
};
