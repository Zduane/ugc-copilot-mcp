import { z } from 'zod';
import { toolJson } from '../errors.js';
import { ENGINES, PROJECT_MODES, type ToolDefinition } from './types.js';

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
  sora: ['sora-2', 'sora-2-pro'],
  veo: ['veo-3.1-fast-generate-preview', 'veo-3.1-generate-preview'],
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
  ],
} as const;

const SceneImageSchema = z
  .object({
    data: z.string().describe("Base64-encoded image data (no 'data:' prefix)."),
    mimeType: z.string().describe('e.g. "image/png" or "image/jpeg".'),
  })
  .describe(
    'Reference image for the render. Required by the backend for sora, veo, and kling — ' +
    "it's the visual seed every engine builds the video around. " +
    'The only path that runs without sceneImage is seedance text-to-video (engine="seedance" with isFaceless=false). ' +
    "If you don't have an image, call generate_image first and pass its base64 output here " +
    "(strip the 'data:image/png;base64,' prefix; the data field expects raw base64 only).",
  );

const InputSchema = z.object({
  visualPrompt: z.string().min(1).describe('Visual prompt describing the scene to render.'),
  engine: z
    .enum(ENGINES)
    .describe(
      'Engine: sora (cinematic), veo (fast/fixed-cost), kling (image-to-video), seedance (low-cost duration-scaled).',
    ),
  modelName: z
    .string()
    .describe(
      'Engine-specific model. Sora: "sora-2" (FAST) | "sora-2-pro" (HQ). ' +
      'Veo: "veo-3.1-fast-generate-preview" (FAST) | "veo-3.1-generate-preview" (HQ). ' +
      'Kling: "fal-ai/kling-video/v3/standard/image-to-video" (FAST), "/pro/image-to-video" (HQ), ' +
      '"/4k/image-to-video" (ULTRA, native 4K), or "/standard/motion-control" / "/pro/motion-control" (clone-video only). ' +
      'Seedance: "bytedance/seedance-2.0/image-to-video" (HQ) or "/fast/image-to-video" (FAST); also reference-to-video and text-to-video variants. ' +
      'See VALID_MODELS_BY_ENGINE for the full list — passing a string not in the whitelist is rejected with a clear error before the backend is called.',
    ),
  sceneImage: SceneImageSchema.optional(),
  duration: z.number().int().min(4).max(20).optional().describe('Render duration in seconds (engine-clamped).'),
  editVideoId: z.string().optional().describe('Sora extend flow — source video ID to extend.'),
  isFaceless: z.boolean().optional(),
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
      'scene to keep the character consistent. Read by sora / kling / seedance; veo intentionally ignores ' +
      'it (veo gets identity from sceneImage instead — its safety filter trips on detailed physical ' +
      'descriptions alongside an I2V reference). Cap is 2000 chars (kling further truncates to 800 due ' +
      'to its 2500-char total prompt cap); backticks and [IDENTITY] / [/IDENTITY] delimiters are stripped.',
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
}

export const renderVideo: ToolDefinition<Input> = {
  name: 'render_video',
  description:
    'Start an asynchronous video render. Returns an operationName immediately; credits are deducted at this call. ' +
    'Cost varies by engine, quality, and duration: Sora std=18 / hq=65 (8s baseline), Veo std=40 / hq=130 (fixed cost), Kling std=32 / hq=50 / 4k=130 (6.4s baseline), Seedance std=18 / hq=35 (4s baseline). Cost scales linearly with duration off each engine baseline (Veo is fixed regardless of duration). ' +
    'IMPORTANT — sceneImage is REQUIRED for sora/veo/kling and for seedance-faceless. ' +
    'If you do not have an image, the typical chain is: ' +
    'generate_image (with a useful productDescription) → strip the data: prefix → pass to render_video as sceneImage. ' +
    'After render_video returns, call wait_for_video (polls with backoff up to ~50s) or check_video_status (single poll) until done, then fetch_video for the MP4 URL. ' +
    'Requires UGC_COPILOT_API_KEY.',
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const body: Record<string, unknown> = {
      visualPrompt: input.visualPrompt,
      engine: input.engine,
      modelName: input.modelName,
    };
    if (input.sceneImage) body.sceneImage = input.sceneImage;
    if (input.duration) body.duration = input.duration;
    if (input.editVideoId) body.editVideoId = input.editVideoId;
    if (input.isFaceless !== undefined) body.isFaceless = input.isFaceless;
    if (input.projectMode) body.projectMode = input.projectMode;
    if (input.productDescription) body.productDescription = input.productDescription;
    if (input.influencerDescription) body.influencerDescription = input.influencerDescription;
    // Wrap masterIdentityPrompt into the twinContext envelope the backend expects. Surfacing
    // it as a flat field on this tool keeps the MCP schema simple — twin/identity is a single
    // string from a caller's perspective, not a nested context object.
    if (input.masterIdentityPrompt) {
      body.twinContext = { masterIdentityPrompt: input.masterIdentityPrompt };
    }
    const result = await client.callApi<StartResult>('proxyStartVideoGeneration', body);
    // Surface effective render parameters so the agent knows what actually got rendered
    // and charged. The backend silently snaps duration to engine-specific allowed values
    // (e.g. 11 → 8 on Veo) — without this surfaced, the agent has no way to know.
    const durationWasSnapped =
      typeof result.requestedDuration === 'number' &&
      typeof result.effectiveDuration === 'number' &&
      result.requestedDuration !== result.effectiveDuration;
    return toolJson({
      operationName: result.operation.name,
      engine: input.engine,
      requestedDuration: result.requestedDuration ?? null,
      effectiveDuration: result.effectiveDuration ?? null,
      creditCost: result.creditCost ?? null,
      quality: result.quality ?? null,
      durationSnapped: durationWasSnapped,
      assembledPrompt: result.assembledPrompt ?? null,
      hint: durationWasSnapped
        ? `Note: requested duration ${result.requestedDuration}s was snapped to ${result.effectiveDuration}s (engine-specific allowed values). You were charged ${result.creditCost} credits. Call wait_for_video with this operationName + engine.`
        : 'Call wait_for_video with this operationName + engine, OR check_video_status periodically (15s start, ×1.2 backoff up to 60s).',
    });
  },
};
