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
  /** Post-render QC verdict (product-ad renders + fallback-degraded renders only;
   *  absent = not checked). pass=false + retryAvailable=true grants ONE free
   *  re-render: call render_video again with the IDENTICAL params (visualPrompt
   *  must match — enforced) plus qcRetryOfOperation set to this operationName with
   *  slashes replaced by underscores. retried=true marks a clip whose free retry
   *  also failed the check (delivered anyway). */
  qc?: {
    checked: boolean;
    pass?: boolean;
    defects?: string[];
    retryAvailable?: boolean;
    retried?: boolean;
  };
  /** The engine silently re-rendered without the reference image (e.g. Seedance
   *  face policy) — the clip's product/subject may be invented; surface to the user. */
  fallbackWarning?: string;
}

export const checkVideoStatus: ToolDefinition<Input> = {
  name: 'check_video_status',
  description:
    'Single-shot poll of an in-progress video render. Returns done=false (with optional progress 0-100) while in progress; on completion returns done=true with response.generatedVideos[].video.uri; on failure returns done=true with error details (credits auto-refunded). ' +
    'Completed product-ad renders may carry a qc verdict: on qc.pass=false with qc.retryAvailable=true you get ONE free re-render — call render_video with the identical params plus qcRetryOfOperation (no credits charged). A fallbackWarning means the engine dropped the reference image; double-check product accuracy. ' +
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
