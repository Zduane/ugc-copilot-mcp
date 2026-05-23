import { z } from 'zod';
import { toolJson } from '../errors.js';
import { ENGINES, PROJECT_MODES, type ToolDefinition } from './types.js';

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
      'Engine-specific model. Examples: "sora-2", "sora-2-pro", "veo-3.1-generate-preview", ' +
      '"fal-ai/kling-video/v3/standard/image-to-video", "fal-ai/kling-video/v3/pro/image-to-video", ' +
      '"fal-ai/kling-video/v3/4k/image-to-video" (native 4K, ~2.5× Pro cost), ' +
      '"bytedance/seedance-2.0/image-to-video".',
    ),
  sceneImage: SceneImageSchema.optional(),
  duration: z.number().int().min(4).max(20).optional().describe('Render duration in seconds (engine-clamped).'),
  editVideoId: z.string().optional().describe('Sora extend flow — source video ID to extend.'),
  isFaceless: z.boolean().optional(),
  projectMode: z.enum(PROJECT_MODES).optional(),
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
});

type Input = z.infer<typeof InputSchema>;

interface StartResult {
  operation: { name: string };
  assembledPrompt?: string | null;
}

export const renderVideo: ToolDefinition<Input> = {
  name: 'render_video',
  description:
    'Start an asynchronous video render. Returns an operationName immediately; credits are deducted at this call. ' +
    'Cost varies by engine, quality, and duration: Sora std=18 / hq=65, Veo std=40 / hq=130 (fixed), Kling std=32 / hq=50 / 4k=130, Seedance std=18 / hq=35 (8s baselines). ' +
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
    return toolJson({
      operationName: result.operation.name,
      engine: input.engine,
      assembledPrompt: result.assembledPrompt ?? null,
      hint: 'Call wait_for_video with this operationName + engine, OR check_video_status periodically (15s start, ×1.2 backoff up to 60s).',
    });
  },
};
