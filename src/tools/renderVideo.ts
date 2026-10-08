import { z } from 'zod';
import { toolJson } from '../errors.js';
import { PROJECT_MODES, RENDER_ENGINES, renderEngineErrorMap, type ToolDefinition } from './types.js';

/**
 * Whitelist of valid model names per engine. Mirrors the backend whitelist at
 * functions/index.js:12233 (ENGINE_MODEL_WHITELIST) which is derived from the
 * *_MODELS constants in functions/constants.js. Keeping this list in sync with
 * the backend is the contract — the smoke test catches drift, but for new model
 * additions update both sides.
 *
 * Kling includes both the standard image-to-video endpoints and the motion-control
 * endpoints (clone-video sub-mode). Seedance exposes the user-facing endpoints
 * (image-to-video / reference-to-video / text-to-video, FAST + HQ each) — the
 * backend may also internally route to FAST_TEXT_TO_VIDEO during 422 fallback.
 */
const VALID_MODELS_BY_ENGINE = {
  // No sora / veo: OpenAI shut the Sora API down 2026-09-24, Google shuts the Veo 3.1
  // previews down 2026-10-22 (RENDER_ENGINES in types.ts).
  kling: [
    'fal-ai/kling-video/v3/standard/image-to-video',
    'fal-ai/kling-video/v3/pro/image-to-video',
    'fal-ai/kling-video/v3/4k/image-to-video',
    'fal-ai/kling-video/v3/standard/motion-control',
    'fal-ai/kling-video/v3/pro/motion-control',
  ],
  seedance: [
    'bytedance/seedance-2.0/fast/image-to-video',
    'bytedance/seedance-2.0/image-to-video',
    'bytedance/seedance-2.0/fast/reference-to-video',
    'bytedance/seedance-2.0/reference-to-video',
    'bytedance/seedance-2.0/fast/text-to-video',
    'bytedance/seedance-2.0/text-to-video',
    // Seedance 2.5 — the premium Seedance tier (billed as seedance 'ultra'). No /fast/
    // variants exist on fal; all three are HQ-tier and paid-gated backend-side.
    'bytedance/seedance-2.5/image-to-video',
    'bytedance/seedance-2.5/reference-to-video',
    'bytedance/seedance-2.5/text-to-video',
  ],
  // Gemini Omni Flash — single 720p tier, no HQ variant. The GA id replaced the preview id
  // (shut down 2026-10-22); the preview id stays accepted ONLY because the backend aliases it
  // to the GA model (UGC-Copilot functions/index.js RETIRED_OMNI_MODEL_IDS, applied in
  // coerceRetiredEngine). Remove it here in the same release that drops that alias — the
  // backend would otherwise 400 it with ENGINE_MODEL_WHITELIST after passing this check.
  omni: ['gemini-omni-1.1-flash', 'gemini-omni-flash-preview'],
} as const;

// The imageUrl generate_image returns. The backend reads that stored image directly —
// but only the caller's OWN generated images in UGC Copilot's bucket; any other URL is a
// 400 (no charge). Checked here too so a foreign URL fails before the network call.
const GENERATED_IMAGE_URL_PREFIX = 'https://firebasestorage.googleapis.com/';

const SceneImageSchema = z
  .union([
    z.object({
      data: z.string().describe("Base64-encoded image data (no 'data:' prefix)."),
      mimeType: z.string().describe('e.g. "image/png" or "image/jpeg".'),
    }),
    z
      .string()
      .url()
      .refine((u) => u.startsWith(GENERATED_IMAGE_URL_PREFIX), {
        message:
          'sceneImage as a URL must be the imageUrl generate_image returned for this account. ' +
          'For any other image, send { data, mimeType } with the raw base64 bytes.',
      }),
  ])
  .describe(
    'Reference image for the render: EITHER the imageUrl generate_image returned (pass it as-is) ' +
    'OR { data, mimeType } with raw base64 (no "data:" prefix). Other URLs are rejected. ' +
    'Required for kling, and for seedance when isFaceless=true. ' +
    'Seedance non-faceless runs without one (text-to-video: the person is generated from the prompt) — ' +
    'and Seedance REJECTS a reference image that contains a person, so for a person on camera from a ' +
    'specific image use kling.',
  );

const InputSchema = z.object({
  visualPrompt: z.string().min(1).describe('Visual prompt describing the scene to render.'),
  engine: z
    .enum(RENDER_ENGINES, { errorMap: renderEngineErrorMap })
    .describe(
      'Engine: seedance (low-cost, duration-scaled; text-to-video or faceless image-to-video), kling (image-to-video — keeps the person in your image), omni (Gemini Omni Flash — fastest; 720p with native audio, image-to-video or text-to-video, 4-10s, 16:9/9:16 only, no HQ). ' +
      'Sora is retired (OpenAI shut its API down 2026-09-24) and Veo 3.1 is retired (Google shuts it down 2026-10-22); neither is offered. ' +
      'Cost for an 8-SECOND render, cheapest first (every engine scales linearly with duration): ' +
      'seedance std (36) < kling std / omni (40) < kling hq (63) < seedance hq (70) < seedance 2.5 ultra (120 launch price, 150 regular) < kling 4k (163). ' +
      'Kling motion-control bills its own table: std 44 / pro 88 at 8s. ' +
      'Pick the cheapest that meets the stated need unless the user chose otherwise.',
    ),
  modelName: z
    .string()
    .describe(
      'Engine-specific model. ' +
      'Kling: "fal-ai/kling-video/v3/standard/image-to-video" (FAST), "/pro/image-to-video" (HQ), ' +
      '"/4k/image-to-video" (ULTRA, native 4K), or "/standard/motion-control" / "/pro/motion-control" (clone-video only). ' +
      'Seedance: "bytedance/seedance-2.0/image-to-video" (HQ) or "/fast/image-to-video" (FAST); also reference-to-video and text-to-video variants. ' +
      'Seedance 2.5 (ULTRA, premium — single-take coherence, richer native audio): "bytedance/seedance-2.5/image-to-video", "/reference-to-video", or "/text-to-video"; no fast variant, paid entitlement required. ' +
      'Omni: "gemini-omni-1.1-flash" (only model — 720p, no HQ; the retired "gemini-omni-flash-preview" is still accepted and renders on it). ' +
      'See VALID_MODELS_BY_ENGINE for the full list — passing a string not in the whitelist is rejected with a clear error before the backend is called.',
    ),
  sceneImage: SceneImageSchema.optional(),
  duration: z
    .number()
    .int()
    .min(4)
    .max(30)
    .optional()
    .describe(
      'Render duration in seconds, snapped/clamped per engine: ' +
      'Kling up to 15, Seedance 2.0 up to 15, Seedance 2.5 (bytedance/seedance-2.5/* models) up to 30, ' +
      'Omni up to 10. Values above an engine\'s cap are clamped and billed at the clamped duration — ' +
      'check effectiveDuration/durationSnapped in the response. Cost scales linearly: a 30s Seedance 2.5 ' +
      'render bills 30/4 × the ultra base.',
    ),
  isFaceless: z.boolean().optional(),
  aspectRatio: z
    .enum(['9:16', '16:9', '1:1', '4:5'])
    .optional()
    .describe(
      'Output aspect ratio. Defaults to "9:16" (vertical) — the format UGC ads render in — ' +
      'when omitted, so every engine renders vertical with no landscape fallback. Pass "16:9" ' +
      'explicitly for landscape. Omni supports only "9:16" / "16:9" (other values are ' +
      'coerced toward the nearest supported ratio). For image-to-video the sceneImage should ' +
      'already match this ratio, or the engine may pillarbox the frame.',
    ),
  projectMode: z
    .enum(PROJECT_MODES)
    .optional()
    .describe(
      'Content mode. NOTE: projectMode: "creator-intimate" (Mature Mode) locks the engine to ' +
      '"kling" only — passing any other engine returns 400 mode_engine_not_allowed. Also requires ' +
      'paid entitlement (no trial users) and prior T&C acceptance via the web UI — returns 403 ' +
      'mature_mode_paid_required or mature_mode_terms_required otherwise.',
    ),
  productDescription: z.string().optional(),
  influencerDescription: z.string().optional(),
  masterIdentityPrompt: z
    .string()
    .max(2000)
    .optional()
    .describe(
      'Canonical "actor playing the role" description (face DNA, body proportions, signature markers — ' +
      'no clothing or scene context). When set, the engine character block uses this verbatim so the same ' +
      'person reappears across every render_video call for this character. Pass the same string on each ' +
      'scene to keep the character consistent. Read by kling / seedance / omni. Cap is 2000 chars (kling further truncates to 800 due ' +
      'to its 2500-char total prompt cap); backticks and [IDENTITY] / [/IDENTITY] delimiters are stripped.',
    ),
  seed: z
    .number()
    .int()
    .min(0)
    .max(2147483647)
    .optional()
    .describe(
      'Optional reproducibility seed, honored only by kling, seedance, and kling motion-control ' +
      '(omni has no seed parameter and silently ignores it). Re-rendering with the same ' +
      'seed and inputs reproduces the same generation — useful for comparing prompt iterations. ' +
      'An out-of-range or non-integer value is ignored server-side (render proceeds unseeded, ' +
      'reported as an INVALID_SEED_IGNORED advisory). Do NOT pass a seed alongside ' +
      'qcRetryOfOperation: the backend strips it (QC_RETRY_SEED_IGNORED) because a QC retry ' +
      'exists to re-roll engine variance, not reproduce the failing render.',
    ),
  qcRetryOfOperation: z
    .string()
    .optional()
    .describe(
      'QC free-retry token: the operationName (slashes replaced with underscores) of a prior ' +
      'render whose check_video_status / wait_for_video response carried qc.pass=false with ' +
      'qc.retryAvailable=true. Resubmit the IDENTICAL generation parameters with this set and ' +
      'the render re-runs at NO credit cost (creditCost 0 in the response). Single-use, and the ' +
      'visualPrompt must match the original exactly (enforced — QC_RETRY_PROMPT_MISMATCH ' +
      'otherwise): the free redo re-rolls engine variance on the render you paid for, not a new render.',
    ),
}).superRefine((data, ctx) => {
  // Reject obviously-bad model names client-side so agents get a clear error before
  // hitting the backend. The backend re-validates against the same whitelist as
  // defense-in-depth — see ENGINE_MODEL_WHITELIST at functions/index.js:12233.
  const allowed: readonly string[] = VALID_MODELS_BY_ENGINE[data.engine];
  if (!allowed.includes(data.modelName)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['modelName'],
      message: `'${data.modelName}' is not a valid model for engine '${data.engine}'. Valid models: ${allowed.join(', ')}.`,
    });
  }
});

type Input = z.infer<typeof InputSchema>;

interface StartResult {
  operation: { name: string };
  assembledPrompt?: string | null;
  requestedDuration?: number | null;
  effectiveDuration?: number;
  creditCost?: number;
  quality?: 'standard' | 'hq' | 'ultra';
  // The engine + model that ACTUALLY rendered. The backend can differ from the request
  // (a retired engine is re-routed), and polling / stitching must use what rendered.
  engine?: string;
  modelName?: string;
}

export const renderVideo: ToolDefinition<Input> = {
  name: 'render_video',
  title: 'Render UGC Video',
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  description:
    'Start an asynchronous video render. Returns an operationName immediately; credits are deducted at this call. ' +
    'SPENDS THE USER\'S CREDITS — the same request can cost anywhere from 18 to 450 credits depending on the engine, model, and duration YOU pick, ' +
    'and this tool requires you to pick them. Before calling: (1) state which engine + model you intend to use and ' +
    'what it will cost, and (2) get the user\'s go-ahead. Skip the confirmation ONLY when the user named a specific ' +
    'engine or quality tier, or gave a standing instruction not to ask before spending. A bare request to render ' +
    'something ("render a video of X") is a REQUEST, not that instruction — confirm first. ' +
    'DEFAULT TO THE CHEAPEST option that satisfies the request. For 8 seconds that is seedance (36): ' +
    '"/fast/text-to-video" when a person is on camera (no image needed — the person is generated from the prompt), or ' +
    '"/fast/image-to-video" with isFaceless=true for a hands/product-only shot. When the person must come FROM A SPECIFIC ' +
    'IMAGE, use kling "/standard/image-to-video" (40) — Seedance rejects reference images that contain a person. ' +
    'Cheapest means TOTAL credits for the whole chain, including any generate_image call: seedance text-to-video (36) ' +
    'needs no image, while kling (40) plus a 1-credit image is 41 total. Do not add an image step the engine does not need, ' +
    'and do not pick a pricier engine just to skip a 1-credit step. ' +
    'Reach for hq / 4k ONLY when the user asks for maximum quality or a capability ' +
    'only that engine has; never infer it from adjectives like "cinematic" or "high quality" in a scene description, ' +
    'which describe the SHOT, not the budget. Duration multiplies cost, so do not raise duration beyond what was asked. ' +
    'Cost varies by engine, quality, and duration: Kling std=32 / hq=50 / 4k=130 (6.4s baseline), Kling motion-control std=35 / pro=70 (6.4s baseline, its own table), Seedance std=18 / hq=35 / 2.5-ultra=60 launch price (4s baseline), Omni std=40 (8s baseline). Cost scales linearly with duration off each engine baseline — e.g. a 30s Seedance 2.5 render is 450. ' +
    'IMPORTANT — sceneImage is REQUIRED for kling and for seedance-faceless. ' +
    'If you do not have an image, the typical chain is: ' +
    'generate_image (with a useful productDescription) → pass its imageUrl to render_video as sceneImage, unchanged. ' +
    'After render_video returns, call wait_for_video (polls with backoff up to ~50s) or check_video_status (single poll) ' +
    'with the operationName AND the engine this tool returns (the engine that actually rendered), then fetch_video for the MP4 URL. ' +
    'Requires authentication (connected UGC Copilot account or API key).',
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const body: Record<string, unknown> = {
      visualPrompt: input.visualPrompt,
      engine: input.engine,
      modelName: input.modelName,
    };
    if (input.sceneImage) body.sceneImage = input.sceneImage;
    if (input.duration) body.duration = input.duration;
    if (input.isFaceless !== undefined) body.isFaceless = input.isFaceless;
    if (input.aspectRatio) body.aspectRatio = input.aspectRatio;
    if (input.projectMode) body.projectMode = input.projectMode;
    if (input.productDescription) body.productDescription = input.productDescription;
    if (input.influencerDescription) body.influencerDescription = input.influencerDescription;
    if (input.seed !== undefined) body.seed = input.seed;
    // Wrap masterIdentityPrompt into the twinContext envelope the backend expects. Surfacing
    // it as a flat field on this tool keeps the MCP schema simple — twin/identity is a single
    // string from a caller's perspective, not a nested context object.
    if (input.masterIdentityPrompt) {
      body.twinContext = { masterIdentityPrompt: input.masterIdentityPrompt };
    }
    // The free-retry token. Accepted by the schema and advertised as a 0-credit re-render
    // ever since it was added, but never forwarded — so the backend saw an ordinary render
    // and billed it in full, every time. The schema tests passed throughout, because the
    // field genuinely is in the schema; only an assertion on the request BODY catches a
    // field that is parsed and then dropped.
    if (input.qcRetryOfOperation) body.qcRetryOfOperation = input.qcRetryOfOperation;
    const result = await client.callApi<StartResult>('proxyStartVideoGeneration', body);
    // Surface effective render parameters so the agent knows what actually got rendered
    // and charged. The backend silently snaps duration to engine-specific allowed values
    // (e.g. 11 → 10 on Omni) — without this surfaced, the agent has no way to know.
    const durationWasSnapped =
      typeof result.requestedDuration === 'number' &&
      typeof result.effectiveDuration === 'number' &&
      result.requestedDuration !== result.effectiveDuration;
    // Report what rendered, not what was asked for: poll/fetch/stitch must name the
    // engine that ran the job (stitch_videos, for one, applies engine-specific trims).
    const renderedEngine = result.engine ?? input.engine;
    return toolJson({
      operationName: result.operation.name,
      engine: renderedEngine,
      modelName: result.modelName ?? input.modelName,
      requestedDuration: result.requestedDuration ?? null,
      effectiveDuration: result.effectiveDuration ?? null,
      creditCost: result.creditCost ?? null,
      quality: result.quality ?? null,
      durationSnapped: durationWasSnapped,
      assembledPrompt: result.assembledPrompt ?? null,
      hint: durationWasSnapped
        ? `Note: requested duration ${result.requestedDuration}s was snapped to ${result.effectiveDuration}s (engine-specific allowed values). You were charged ${result.creditCost} credits. Call wait_for_video with this operationName + engine "${renderedEngine}".`
        : `Call wait_for_video with this operationName + engine "${renderedEngine}", OR check_video_status periodically (15s start, ×1.2 backoff up to 60s).`,
    });
  },
};
