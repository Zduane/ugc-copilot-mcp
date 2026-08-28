import { z } from 'zod';
import { toolJson } from '../errors.js';
import { ENGINES, type ToolDefinition } from './types.js';

/**
 * Wraps `proxyStitchVideos` (docs/openapi.yaml /proxyStitchVideos — the
 * API-friendly `videoUrls[]` shape; the legacy `videos[]` shape is web-UI only).
 * Closes the last gap in the connector's end-to-end story: without it a
 * multi-scene script ended as separate per-scene MP4s with no way to assemble
 * the final ad from Claude.
 */
const InputSchema = z.object({
  videoUrls: z
    .array(
      z
        .string()
        .url()
        .refine((u) => u.startsWith('https://'), { message: 'videoUrls entries must use https://' }),
    )
    .min(1)
    .max(10)
    .describe(
      'Signed MP4 URLs in output order (typically from fetch_video). 1-10 clips. ' +
      'Each clip must belong to the calling account — foreign URLs are rejected.',
    ),
  engines: z
    .array(z.enum(ENGINES).nullable())
    .optional()
    .describe(
      'Optional parallel array, one entry per videoUrls clip (null to skip): the engine that ' +
      'rendered each clip. Sora-tagged clips get the standard 0.5s start trim that removes ' +
      "the prompt-image flash. Omit if the sources are already trimmed.",
    ),
  useCrossfade: z
    .boolean()
    .optional()
    .describe('Default true: fadeblack transitions where clip durations allow. false = plain concatenation.'),
  crossfadeDuration: z
    .number()
    .min(0.3)
    .max(2.0)
    .optional()
    .describe('Transition length in seconds (0.3-2.0, default ~1.0). Ignored when useCrossfade is false.'),
  captions: z
    .array(z.string().max(2000).nullable())
    .optional()
    .describe(
      'Optional parallel array, one entry per videoUrls clip: that clip\'s spoken script text, ' +
      'or null to leave a clip uncaptioned (e.g. B-roll). Burns TikTok-style captions into the ' +
      'stitched output, timed against each clip\'s measured duration. Free. If the caption pass ' +
      'fails the stitch still succeeds and the response carries a warning.',
    ),
});

type Input = z.infer<typeof InputSchema>;

interface BackendResult {
  videoUrl: string;
  mimeType: string;
  warning?: string;
}

export const stitchVideos: ToolDefinition<Input> = {
  name: 'stitch_videos',
  title: 'Stitch Final Video',
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  description:
    'Concatenate 1-10 rendered clips into the final video, in order, with optional crossfade ' +
    'transitions and free burned-in TikTok-style captions. NO credits — the per-clip render ' +
    'costs were already paid at render_video. Returns a PERMANENT signed URL (unlike ' +
    "fetch_video's ~7-day links), so this is also the right way to get a keepable link for a " +
    'single clip. Typical flow for a multi-scene script: render each scene → fetch_video each → ' +
    'stitch_videos with the URLs in scene order and each scene\'s dialogue as captions. ' +
    'PRACTICAL LIMIT: stitching runs inside one ~50s call — a handful of short scenes is fine, ' +
    'but many long clips can time out; if that happens retry with fewer clips per call ' +
    '(stitch in batches), or assemble in the web app. Requires authentication (connected ' +
    'UGC Copilot account or API key).',
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const body: Record<string, unknown> = { videoUrls: input.videoUrls };
    if (input.engines) body.engines = input.engines;
    if (input.useCrossfade !== undefined) body.useCrossfade = input.useCrossfade;
    if (input.crossfadeDuration !== undefined) body.crossfadeDuration = input.crossfadeDuration;
    if (input.captions) body.captions = input.captions;
    const result = await client.callApi<BackendResult>('proxyStitchVideos', body);
    return toolJson({
      videoUrl: result.videoUrl,
      mimeType: result.mimeType,
      ...(result.warning ? { warning: result.warning } : {}),
    });
  },
};
