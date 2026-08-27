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

describe('wait_for_video hosted budget', () => {
  beforeEach(() => {
    process.env.UGC_COPILOT_API_KEY = 'ugc_live_test_key';
    vi.useFakeTimers();
  });
  afterEach(() => {
    delete process.env.UGC_COPILOT_API_KEY;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ctx.waitBudgetMs caps the wait below maxWaitSeconds (Hosting 60s rewrite limit)', async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ done: false, progress: 10 }), { status: 200 }),
    );
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });

    const promise = waitForVideo.handler(
      { operationName: 'op-budget', engine: 'sora', maxWaitSeconds: 55 },
      client,
      { waitBudgetMs: 20_000 },
    );
    await vi.advanceTimersByTimeAsync(25_000);
    const result = await promise;

    expect(result.content[0]!.text).toContain('"status": "pending"');
    // A 20s cap allows sleeps of 5s + 10s + ≤5s remainder — at most 3 polls,
    // where the uncapped 55s request would have kept polling.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('without ctx the input maxWaitSeconds governs (stdio unchanged)', async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ done: false, progress: 10 }), { status: 200 }),
    );
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });

    const promise = waitForVideo.handler(
      { operationName: 'op-nolimit', engine: 'sora', maxWaitSeconds: 30 },
      client,
    );
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await promise;
    expect(result.content[0]!.text).toContain('"status": "pending"');
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
