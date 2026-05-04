import { z } from 'zod';
import { toolJson } from '../errors.js';
import { ENGINES, type ToolDefinition } from './types.js';

const InputSchema = z.object({
  operationName: z.string().describe('Opaque operation handle returned by render_video.'),
  engine: z.enum(ENGINES).describe('Engine that started the render.'),
});

type Input = z.infer<typeof InputSchema>;

export interface VideoStatusResponse {
  done: boolean;
  progress?: number;
  message?: string;
  response?: { generatedVideos: Array<{ video?: { uri?: string } }> };
  error?: { code: string; message: string };
}

export const checkVideoStatus: ToolDefinition<Input> = {
  name: 'check_video_status',
  description:
    'Single-shot poll of an in-progress video render. Returns done=false (with optional progress 0-100) while in progress; on completion returns done=true with response.generatedVideos[].video.uri; on failure returns done=true with error details (credits auto-refunded). ' +
    'No credits charged. Requires UGC_COPILOT_API_KEY.',
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const result = await client.callApi<VideoStatusResponse>(
      'proxyCheckVideoStatus',
      { operationName: input.operationName, engine: input.engine },
      {},
      false,
    );
    return toolJson(result);
  },
};
