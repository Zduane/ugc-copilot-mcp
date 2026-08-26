import { z } from 'zod';
import { toolJson } from '../errors.js';
import { ENGINES, type ToolDefinition } from './types.js';
import type { VideoStatusResponse } from './checkVideoStatus.js';

const InputSchema = z.object({
  operationName: z.string().describe('Operation handle from render_video.'),
  engine: z.enum(ENGINES).describe('Engine that started the render.'),
  maxWaitSeconds: z
    .number()
    .int()
    .min(10)
    .max(55)
    .default(50)
    .optional()
    .describe('Cap on total wait inside this tool call (default 50s, max 55s to stay inside MCP tool window).'),
});

type Input = z.infer<typeof InputSchema>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const waitForVideo: ToolDefinition<Input> = {
  name: 'wait_for_video',
  title: 'Wait for Render',
  annotations: { readOnlyHint: true, openWorldHint: true },
  description:
    'Poll a video render with exponential backoff (5s → 10s → 15s, capped at ~50s total) inside a single tool call. ' +
    'On completion returns { status: "done", videoUri }. If still pending after maxWaitSeconds, returns { status: "pending", operationName, engine, hint } and the agent should call check_video_status again in 30s. ' +
    'No credits charged. Requires authentication (connected UGC Copilot account or API key).',
  inputSchema: InputSchema,
  handler: async (input, client, ctx) => {
    // The hosted server threads a tighter budget (45s) via ctx — Firebase
    // Hosting kills rewrites at 60s, so the in-call wait must stay well under.
    const budgetCapSeconds = ctx?.waitBudgetMs
      ? Math.max(10, Math.floor(ctx.waitBudgetMs / 1000))
      : Infinity;
    const cap = Math.min(input.maxWaitSeconds ?? 50, budgetCapSeconds);
    const start = Date.now();
    const backoffSequenceMs = [5_000, 10_000, 15_000, 15_000];
    let backoffIdx = 0;
    let lastProgress: number | undefined;
    let lastMessage: string | undefined;

    while ((Date.now() - start) / 1000 < cap) {
      const remainingMs = cap * 1000 - (Date.now() - start);
      const nextDelay = Math.min(backoffSequenceMs[backoffIdx] ?? 15_000, remainingMs);
      if (nextDelay <= 0) break;
      await sleep(nextDelay);
      backoffIdx = Math.min(backoffIdx + 1, backoffSequenceMs.length - 1);

      const status = await client.callApi<VideoStatusResponse>(
        'proxyCheckVideoStatus',
        { operationName: input.operationName, engine: input.engine },
        {},
        false,
      );

      if (status.done) {
        if (status.error) {
          return toolJson({
            status: 'failed',
            error: status.error,
            note: 'Credits were auto-refunded by the backend.',
          });
        }
        const videoUri = status.response?.generatedVideos?.[0]?.video?.uri ?? null;
        // Surface the post-render QC verdict + silent-fallback disclosure so agents can
        // act on quality signals: retryAvailable grants ONE free re-render via
        // render_video with the identical params + qcRetryOfOperation.
        const qcHint = status.qc?.pass === false && status.qc.retryAvailable
          ? ` Quality check FAILED (${(status.qc.defects ?? []).join('; ')}) — one FREE re-render is available: call render_video with the IDENTICAL params (visualPrompt must match) plus qcRetryOfOperation="${input.operationName.replace(/\//g, '_')}".`
          : status.qc?.pass === false
            ? ` Quality check flagged: ${(status.qc.defects ?? []).join('; ')} — review before publishing.`
            : '';
        return toolJson({
          status: 'done',
          videoUri,
          operationName: input.operationName,
          engine: input.engine,
          ...(status.qc ? { qc: status.qc } : {}),
          ...(status.fallbackWarning ? { fallbackWarning: status.fallbackWarning } : {}),
          hint: (videoUri
            ? 'Call fetch_video for a downloadable signed MP4 URL.'
            : 'No video URI in response — call fetch_video to retrieve.') + qcHint,
        });
      }

      lastProgress = status.progress;
      lastMessage = status.message;
    }

    return toolJson({
      status: 'pending',
      operationName: input.operationName,
      engine: input.engine,
      lastProgress: lastProgress ?? null,
      lastMessage: lastMessage ?? null,
      hint: 'Render still in progress. Call check_video_status again in 30s, or call wait_for_video again to keep polling.',
    });
  },
};
