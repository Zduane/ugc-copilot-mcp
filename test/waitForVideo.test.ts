import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UgcCopilotClient } from '../src/client.js';
import { waitForVideo } from '../src/tools/waitForVideo.js';

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('wait_for_video', () => {
  beforeEach(() => {
    process.env.UGC_COPILOT_API_KEY = 'ugc_live_test_key';
    vi.useFakeTimers();
  });
  afterEach(() => {
    delete process.env.UGC_COPILOT_API_KEY;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns done with videoUri when status flips to done', async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 2) return okJson({ done: false, progress: 30 });
      return okJson({
        done: true,
        response: { generatedVideos: [{ video: { uri: 'https://signed/video.mp4' } }] },
      });
    });
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });

    const promise = waitForVideo.handler(
      { operationName: 'op-1', engine: 'sora', maxWaitSeconds: 50 },
      client,
    );
    // Advance through the 5s + 10s backoff.
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;

    expect(result.content[0]!.text).toContain('"status": "done"');
    expect(result.content[0]!.text).toContain('https://signed/video.mp4');
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('returns pending with operationName when render does not finish in time', async () => {
    // Fresh Response per call — Response bodies are single-use.
    const fetchMock = vi.fn().mockImplementation(async () => okJson({ done: false, progress: 10 }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });

    const promise = waitForVideo.handler(
      { operationName: 'op-pending', engine: 'sora', maxWaitSeconds: 30 },
      client,
    );
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await promise;

    expect(result.content[0]!.text).toContain('"status": "pending"');
    expect(result.content[0]!.text).toContain('op-pending');
    expect(result.content[0]!.text).toContain('check_video_status');
  });

  it('returns failed with refund note when render errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({ done: true, error: { code: 'SAFETY_BLOCK', message: 'content blocked' } }),
    );
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });

    const promise = waitForVideo.handler(
      { operationName: 'op-fail', engine: 'sora', maxWaitSeconds: 50 },
      client,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    expect(result.content[0]!.text).toContain('"status": "failed"');
    expect(result.content[0]!.text).toContain('SAFETY_BLOCK');
    expect(result.content[0]!.text).toContain('auto-refunded');
  });
});
