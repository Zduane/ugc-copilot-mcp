import { z } from 'zod';
import { toolJson } from '../errors.js';
import { ENGINES, PROJECT_MODES, type ToolDefinition } from './types.js';

const SceneImageSchema = z
  .object({
    data: z.string().describe("Base64-encoded image data (no 'data:' prefix)."),
    mimeType: z.string().describe('e.g. "image/png" or "image/jpeg".'),
  })
  .describe('Optional reference image for image-to-video engines (Kling, Seedance).');

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
      'Engine-specific model. Examples: "sora-2", "sora-2-pro", "veo-3.1-generate-preview", "fal-ai/kling-video/o3/standard/image-to-video", "bytedance/seedance-2.0/image-to-video".',
    ),
  sceneImage: SceneImageSchema.optional(),
  duration: z.number().int().min(4).max(20).optional().describe('Render duration in seconds (engine-clamped).'),
  editVideoId: z.string().optional().describe('Sora extend flow — source video ID to extend.'),
  isFaceless: z.boolean().optional(),
  projectMode: z.enum(PROJECT_MODES).optional(),
  productDescription: z.string().optional(),
  influencerDescription: z.string().optional(),
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
    'Cost varies by engine, quality, and duration: Sora std=18 / hq=65, Veo std=40 / hq=130 (fixed), Kling std~25 / hq~50, Seedance std=18 / hq=35 (8s baselines). ' +
    'After this returns, call wait_for_video (poll with backoff) or check_video_status (single poll) until done, then fetch_video for the MP4 URL. ' +
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
    const result = await client.callApi<StartResult>('proxyStartVideoGeneration', body);
    return toolJson({
      operationName: result.operation.name,
      engine: input.engine,
      assembledPrompt: result.assembledPrompt ?? null,
      hint: 'Call wait_for_video with this operationName + engine, OR check_video_status periodically (15s start, ×1.2 backoff up to 60s).',
    });
  },
};
