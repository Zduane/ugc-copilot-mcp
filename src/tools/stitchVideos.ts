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
  // Full OpenAPI Engine enum. For the URL inputs this tool accepts, 'sora' is the only
  // tag with an effect (the 0.5s prompt-flash trim) — the rest are harmless no-ops, so
  // truthfully tagging clips by their render engine is fine. This was narrowed to
  // 'sora'|null until 2026-08-31, when 'omni' with a Storage URL genuinely broke the
  // stitch (the backend's omni download branch claimed URL-shaped inputs); that backend
  // routing is fixed, so the schema no longer needs to reject honest tags.
  engines: z
    .array(z.enum(ENGINES).nullable())
    .optional()
    .describe(
      "Optional parallel array, one entry per videoUrls clip, naming the engine that rendered " +
      "it (or null if unknown). Only 'sora' changes behavior: it applies the standard 0.5s " +
      'start trim that removes the prompt-image flash on UNTRIMMED Sora sources. Other ' +
      'engine tags are accepted and harmless. Omit entirely if the sources are already trimmed.',
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
      "Optional parallel array, one entry per videoUrls clip: that clip's spoken script text, " +
      'or null to leave that clip uncaptioned. Burns TikTok-style captions into the ' +
      'stitched output, timed against each clip\'s measured duration. Free. If the caption pass ' +
      'fails the stitch still succeeds and the response carries a warning.',
    ),
}).superRefine((val, ctx) => {
  // Both parallel arrays must match videoUrls 1:1. The backend hard-errors on a
  // captions mismatch (wasted round-trip) but SILENTLY tolerates a short/long
  // engines array — which mis-applies the Sora trim to the wrong clip. Catch both
  // locally. This also rejects empty arrays (videoUrls has min 1).
  for (const key of ['engines', 'captions'] as const) {
    const arr = val[key];
    if (arr && arr.length !== val.videoUrls.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} must be parallel to videoUrls (expected ${val.videoUrls.length}, got ${arr.length})`,
      });
    }
  }
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
    'costs were already paid at render_video. Returns a permanent download URL. Typical flow ' +
    'for a multi-scene script: render each scene → fetch_video each → stitch_videos with the ' +
    "URLs in scene order and each scene's dialogue as captions. Every clip should carry an " +
    'audio track — a silent clip can fail the whole stitch. Trial/free accounts get a ' +
    'watermark on the stitched output. PRACTICAL LIMIT: on the hosted connector the whole ' +
    'stitch runs inside one ~45s call — a handful of short scenes is fine, many long clips ' +
    'can time out. If a call times out, WAIT about a minute before retrying with fewer clips: ' +
    'the earlier attempt is usually still running server-side and holds one of your ' +
    'concurrency slots. Requires authentication (connected UGC Copilot account or API key).',
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const body: Record<string, unknown> = { videoUrls: input.videoUrls };
    if (input.engines !== undefined) body.engines = input.engines;
    if (input.useCrossfade !== undefined) body.useCrossfade = input.useCrossfade;
    if (input.crossfadeDuration !== undefined) body.crossfadeDuration = input.crossfadeDuration;
    if (input.captions !== undefined) body.captions = input.captions;
    const result = await client.callApi<BackendResult>('proxyStitchVideos', body);
    return toolJson({
      videoUrl: result.videoUrl,
      mimeType: result.mimeType,
      ...(result.warning ? { warning: result.warning } : {}),
    });
  },
};
