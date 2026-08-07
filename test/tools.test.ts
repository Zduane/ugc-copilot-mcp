import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UgcCopilotClient } from '../src/client.js';
import { analyzeTrends } from '../src/tools/analyzeTrends.js';
import { generateHooks } from '../src/tools/generateHooks.js';
import { analyzeMarket } from '../src/tools/analyzeMarket.js';
import { renderVideo } from '../src/tools/renderVideo.js';
import { fetchVideo } from '../src/tools/fetchVideo.js';
import { applyTextOverlay } from '../src/tools/applyTextOverlay.js';
import { generatePersonaPreview } from '../src/tools/generatePersonaPreview.js';
import { generateScriptPreview } from '../src/tools/generateScriptPreview.js';
import { generateScript } from '../src/tools/generateScript.js';
import { parseOwnScript } from '../src/tools/parseOwnScript.js';
import { generateImage } from '../src/tools/generateImage.js';
import { checkVideoStatus } from '../src/tools/checkVideoStatus.js';

const okJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Tool input validation', () => {
  it('analyze_trends rejects industries outside the allow-list', () => {
    // Backend's FREE_TOOL_INDUSTRIES uses fully-qualified labels like "Pets & Animals",
    // not slugs. Lowercase or alternate spellings must be rejected at the zod boundary
    // so we never reach the backend with a wrong shape (real bug from 0.1.0).
    expect(analyzeTrends.inputSchema.safeParse({ industry: 'crypto' }).success).toBe(false);
    expect(analyzeTrends.inputSchema.safeParse({ industry: 'fitness' }).success).toBe(false);
    expect(analyzeTrends.inputSchema.safeParse({ industry: 'pets' }).success).toBe(false);
  });

  it('analyze_trends accepts allowed industries', () => {
    const parsed = analyzeTrends.inputSchema.safeParse({ industry: 'Health & Fitness' });
    expect(parsed.success).toBe(true);
  });

  it('generate_hooks rejects platform="linkedin"', () => {
    const parsed = generateHooks.inputSchema.safeParse({
      productDescription: 'A reusable water bottle that tracks hydration.',
      platform: 'linkedin',
    });
    expect(parsed.success).toBe(false);
  });

  it('generate_hooks rejects descriptions under 10 chars', () => {
    const parsed = generateHooks.inputSchema.safeParse({
      productDescription: 'short',
      platform: 'tiktok',
    });
    expect(parsed.success).toBe(false);
  });

  it('render_video requires engine + modelName', () => {
    const parsed = renderVideo.inputSchema.safeParse({ visualPrompt: 'a creator' });
    expect(parsed.success).toBe(false);
  });

  it('render_video accepts valid engine/modelName combinations', () => {
    // One canonical example per engine — proves the whitelist exists and is open.
    const cases = [
      { engine: 'sora', modelName: 'sora-2' },
      { engine: 'sora', modelName: 'sora-2-pro' },
      { engine: 'veo', modelName: 'veo-3.1-generate-preview' },
      { engine: 'kling', modelName: 'fal-ai/kling-video/v3/pro/image-to-video' },
      { engine: 'kling', modelName: 'fal-ai/kling-video/v3/4k/image-to-video' },
      { engine: 'kling', modelName: 'fal-ai/kling-video/v3/pro/motion-control' },
      { engine: 'seedance', modelName: 'bytedance/seedance-2.0/image-to-video' },
      { engine: 'seedance', modelName: 'bytedance/seedance-2.0/text-to-video' },
    ];
    for (const c of cases) {
      const parsed = renderVideo.inputSchema.safeParse({ visualPrompt: 'a creator', ...c });
      expect(parsed.success).toBe(true);
    }
  });

  it('render_video rejects engine/model mismatch (sora engine + veo model)', () => {
    const parsed = renderVideo.inputSchema.safeParse({
      visualPrompt: 'a creator',
      engine: 'sora',
      modelName: 'veo-3.1-generate-preview',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join(' ');
      expect(issues).toMatch(/not a valid model for engine 'sora'/i);
    }
  });

  it('render_video rejects unknown Kling model with a clear whitelist error', () => {
    const parsed = renderVideo.inputSchema.safeParse({
      visualPrompt: 'a creator',
      engine: 'kling',
      modelName: 'fal-ai/kling-video/v99/bogus/image-to-video',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join(' ');
      expect(issues).toMatch(/not a valid model for engine 'kling'/i);
      // Whitelist should appear in the error message so agents know what's valid.
      expect(issues).toMatch(/fal-ai\/kling-video\/v3/i);
    }
  });

  it('render_video rejects unknown Seedance model', () => {
    const parsed = renderVideo.inputSchema.safeParse({
      visualPrompt: 'a creator',
      engine: 'seedance',
      modelName: 'bytedance/seedance-vNext/fake',
    });
    expect(parsed.success).toBe(false);
  });

  it('apply_text_overlay requires at least one overlay', () => {
    const parsed = applyTextOverlay.inputSchema.safeParse({
      videoUrl: 'https://example.com/video.mp4',
      overlays: [],
    });
    expect(parsed.success).toBe(false);
  });

  it('generate_script ACCEPTS projectMode=podcast-style after backend Layer B fix', () => {
    // Layer A's defensive zod refinement (ship'd in source as commit dff30bd
    // but never reached npm) is now removed because Layer B in the main repo
    // (PR #352, deployed 2026-05-04) made the backend frame productDescription
    // as "Topic to discuss" for podcast-style instead of dropping it. Both
    // commentary modes are now legitimate paths through this tool.
    expect(generateScript.inputSchema.safeParse({
      productDescription: 'pet grooming brush',
      projectMode: 'podcast-style',
    }).success).toBe(true);
    expect(generateScript.inputSchema.safeParse({
      productDescription: 'pet grooming brush',
      projectMode: 'influencer-noproduct',
    }).success).toBe(true);
  });

  it('generate_script ACCEPTS projectMode=ugc-creator (still the default-recommended mode)', () => {
    const parsed = generateScript.inputSchema.safeParse({
      productDescription: 'pet grooming brush',
      projectMode: 'ugc-creator',
      tone: 'podcast-style', // tone is a delivery hint, distinct from projectMode
      isFaceless: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('parse_own_script accepts the minimal valid input', () => {
    expect(
      parseOwnScript.inputSchema.safeParse({
        rawScript: 'Hey everyone, today I want to talk about this brush.',
      }).success,
    ).toBe(true);
  });

  it('parse_own_script accepts full input with all optional params', () => {
    expect(
      parseOwnScript.inputSchema.safeParse({
        rawScript: 'Hey everyone, today I want to talk about this brush.',
        twinDescription: 'a friendly pet owner in their 30s',
        productDescription: 'self-cleaning pet grooming brush',
        isFaceless: true,
        projectMode: 'creator',
        audioMode: 'voiceover',
        engine: 'sora',
      }).success,
    ).toBe(true);
  });

  it('parse_own_script rejects rawScript shorter than 10 chars', () => {
    expect(parseOwnScript.inputSchema.safeParse({ rawScript: 'too short' }).success).toBe(false);
  });

  it('parse_own_script rejects rawScript longer than 10,000 chars', () => {
    expect(
      parseOwnScript.inputSchema.safeParse({ rawScript: 'a'.repeat(10_001) }).success,
    ).toBe(false);
  });

  it('parse_own_script rejects unknown projectMode', () => {
    expect(
      parseOwnScript.inputSchema.safeParse({
        rawScript: 'Hey everyone, today I want to talk about this brush.',
        projectMode: 'not-a-real-mode',
      }).success,
    ).toBe(false);
  });

  it('parse_own_script rejects unknown audioMode', () => {
    expect(
      parseOwnScript.inputSchema.safeParse({
        rawScript: 'Hey everyone, today I want to talk about this brush.',
        audioMode: 'whisper',
      }).success,
    ).toBe(false);
  });
});

describe('Free tool handler wiring', () => {
  beforeEach(() => {
    delete process.env.UGC_COPILOT_API_KEY;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('analyze_trends posts to freeTrendAnalyzer with { data } envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ data: { trends: [{ productName: 'X' }] } }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    const result = await analyzeTrends.handler({ industry: 'Health & Fitness' }, client);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toContain('/freeTrendAnalyzer');
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('productName');
  });

  it('generate_hooks posts to freeGenerateHooks without auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({ data: { hooks: [{ category: 'curiosity', hook: 'h1', visualSuggestion: 'v', textOverlay: 'o', format: 'pov' }] } }),
    );
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await generateHooks.handler(
      { productDescription: 'eco water bottle that tracks hydration', platform: 'tiktok' },
      client,
    );
    expect(fetchMock.mock.calls[0]![0]).toContain('/freeGenerateHooks');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({
      data: { productDescription: 'eco water bottle that tracks hydration', platform: 'tiktok' },
    });
  });

  it('generate_persona_preview posts to freeGenerateCreatorPersona', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ data: { persona: { name: 'P' } } }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await generatePersonaPreview.handler(
      { niche: 'fitness coaching', platform: 'tiktok', targetAudience: 'busy 25-40 professionals' },
      client,
    );
    expect(fetchMock.mock.calls[0]![0]).toContain('/freeGenerateCreatorPersona');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.data).toEqual({
      niche: 'fitness coaching',
      platform: 'tiktok',
      targetAudience: 'busy 25-40 professionals',
    });
  });

  it('generate_script_preview posts to freeGenerateScript', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({ data: { hooks: [], scenes: [], callToAction: 'Buy now' } }),
    );
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    const result = await generateScriptPreview.handler(
      { productDescription: 'eco water bottle that tracks hydration', industry: 'Health & Fitness' },
      client,
    );
    expect(fetchMock.mock.calls[0]![0]).toContain('/freeGenerateScript');
    expect(result.content[0]!.text).toContain('callToAction');
  });
});

describe('Authenticated tool handler wiring', () => {
  beforeEach(() => {
    process.env.UGC_COPILOT_API_KEY = 'ugc_live_test_key_xyz';
  });
  afterEach(() => {
    delete process.env.UGC_COPILOT_API_KEY;
    vi.restoreAllMocks();
  });

  it('analyze_market makes both upstream calls in parallel', async () => {
    const callsByEndpoint: Record<string, number> = {};
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const endpoint = url.split('/').pop() ?? '';
      callsByEndpoint[endpoint] = (callsByEndpoint[endpoint] ?? 0) + 1;
      if (endpoint === 'proxyFetchTopSellingProducts') return okJson({ topSellingProducts: [{ productName: 'P1' }] });
      if (endpoint === 'proxyFetchFullMarketAnalysis')
        return okJson({ trends: ['T1'], personas: [], topKeywords: [], viralHooks: [], strategyRecommendations: [] });
      return okJson({});
    });
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    const result = await analyzeMarket.handler({ industry: 'Health & Fitness' }, client);
    expect(callsByEndpoint).toEqual({ proxyFetchTopSellingProducts: 1, proxyFetchFullMarketAnalysis: 1 });
    expect(result.content[0]!.text).toContain('topSellingProducts');
    expect(result.content[0]!.text).toContain('analysis');
  });

  it('analyze_market skips trending products when includeTrendingProducts=false', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      calls.push(url.split('/').pop() ?? '');
      return okJson({ trends: ['T1'], personas: [], topKeywords: [], viralHooks: [], strategyRecommendations: [] });
    });
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await analyzeMarket.handler(
      { industry: 'fitness', includeTrendingProducts: false },
      client,
    );
    expect(calls).toEqual(['proxyFetchFullMarketAnalysis']);
  });

  it('render_video returns the operationName from start response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJson({ operation: { name: 'sora-op-abc' }, assembledPrompt: 'final prompt' }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    const result = await renderVideo.handler(
      { visualPrompt: 'a person', engine: 'sora', modelName: 'sora-2' },
      client,
    );
    expect(result.content[0]!.text).toContain('sora-op-abc');
    expect(result.content[0]!.text).toContain('hint');
  });

  it('render_video FORWARDS qcRetryOfOperation in the request body', async () => {
    // The tool advertises this token as a 0-credit re-render. It was in the schema and
    // in the description, but never copied into the body, so every "free" retry reached
    // the backend as an ordinary render and was billed in full. Asserting on the parsed
    // body is the only thing that catches a field that is accepted and then dropped —
    // the schema tests above passed the whole time.
    let sentBody: Record<string, unknown> = {};
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      sentBody = JSON.parse(String(init.body));
      return okJson({ operation: { name: 'kling-op-1' }, assembledPrompt: 'p', creditCost: 0 });
    });
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await renderVideo.handler(
      {
        visualPrompt: 'a person',
        engine: 'sora',
        modelName: 'sora-2',
        qcRetryOfOperation: 'ops_abc123',
      },
      client,
    );
    expect(sentBody.qcRetryOfOperation).toBe('ops_abc123');
  });

  it('render_video omits qcRetryOfOperation when it is not a retry', async () => {
    let sentBody: Record<string, unknown> = {};
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      sentBody = JSON.parse(String(init.body));
      return okJson({ operation: { name: 'sora-op-1' }, assembledPrompt: 'p' });
    });
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await renderVideo.handler({ visualPrompt: 'a person', engine: 'sora', modelName: 'sora-2' }, client);
    expect('qcRetryOfOperation' in sentBody).toBe(false);
  });

  it('render_video surfaces effectiveDuration / creditCost / quality from the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({
        operation: { name: 'seedance-op-xyz' },
        assembledPrompt: 'final prompt',
        requestedDuration: 7,
        effectiveDuration: 7,
        creditCost: 31,
        quality: 'hq',
      }),
    );
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    const result = await renderVideo.handler(
      {
        visualPrompt: 'a product',
        engine: 'seedance',
        modelName: 'bytedance/seedance-2.0/image-to-video',
        duration: 7,
      },
      client,
    );
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.operationName).toBe('seedance-op-xyz');
    expect(payload.requestedDuration).toBe(7);
    expect(payload.effectiveDuration).toBe(7);
    expect(payload.creditCost).toBe(31);
    expect(payload.quality).toBe('hq');
    expect(payload.durationSnapped).toBe(false);
  });

  it('render_video flags durationSnapped=true and warns in the hint when backend snaps duration', async () => {
    // Bug 2: agent asks for 20s on Seedance, backend clamps to 15s. The MCP tool surfaces
    // the snap so the agent knows what actually got rendered and charged.
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({
        operation: { name: 'seedance-op-snap' },
        requestedDuration: 20,
        effectiveDuration: 15,
        creditCost: 65,
        quality: 'hq',
      }),
    );
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    const result = await renderVideo.handler(
      {
        visualPrompt: 'a product',
        engine: 'seedance',
        modelName: 'bytedance/seedance-2.0/image-to-video',
        duration: 20,
      },
      client,
    );
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.requestedDuration).toBe(20);
    expect(payload.effectiveDuration).toBe(15);
    expect(payload.durationSnapped).toBe(true);
    expect(payload.hint).toMatch(/snapped to 15s/);
    expect(payload.hint).toMatch(/65 credits/);
  });

  it('fetch_video does not send Idempotency-Key and translates videoUri → uri on wire (regression for 0.1.3 backend rejection)', async () => {
    // Backend at functions/index.js fetchVideoData reads `uri` not `operationName`.
    // 0.1.3 sent `operationName` and got 400 "A valid 'uri' string and 'engine' string are required."
    // 0.1.4 input is `videoUri` (matches what wait_for_video returns), translated to `uri` on the wire.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJson({ videoUrl: 'https://signed/video.mp4', mimeType: 'video/mp4' }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await fetchVideo.handler(
      { videoUri: 'video_abc123', engine: 'sora' },
      client,
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.uri).toBe('video_abc123');
    expect(body.engine).toBe('sora');
    expect(body.videoUri).toBeUndefined();
    expect(body.operationName).toBeUndefined();
  });

  it('check_video_status does not send Idempotency-Key (read-only)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ done: false, progress: 50 }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await checkVideoStatus.handler({ operationName: 'op-x', engine: 'sora' }, client);
    expect(fetchMock.mock.calls[0]![0]).toContain('/proxyCheckVideoStatus');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({ operationName: 'op-x', engine: 'sora' });
  });

  it('generate_script posts to proxyGenerateViralScript with idempotency key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJson({ hooks: ['h1'], scenes: [], ctas: ['cta1'] }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await generateScript.handler(
      { productDescription: 'eco water bottle', tone: 'humorous', platform: 'tiktok' },
      client,
    );
    expect(fetchMock.mock.calls[0]![0]).toContain('/proxyGenerateViralScript');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ugc_live_test_key_xyz');
    expect(headers['Idempotency-Key']).toMatch(/[0-9a-f-]{36}/);
    // Optional fields omitted when undefined.
    expect(JSON.parse(init.body as string)).toEqual({
      productDescription: 'eco water bottle',
      tone: 'humorous',
      platform: 'tiktok',
    });
  });

  it('parse_own_script posts to proxyParseOwnScript with idempotency key and omits undefined optionals', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJson({ hooks: ['h1'], scenes: [], callToActions: ['cta1'] }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await parseOwnScript.handler(
      {
        rawScript: 'Hey everyone, today I want to talk about this brush.',
        productDescription: 'pet grooming brush',
      },
      client,
    );
    expect(fetchMock.mock.calls[0]![0]).toContain('/proxyParseOwnScript');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ugc_live_test_key_xyz');
    expect(headers['Idempotency-Key']).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.parse(init.body as string)).toEqual({
      rawScript: 'Hey everyone, today I want to talk about this brush.',
      productDescription: 'pet grooming brush',
    });
  });

  it('parse_own_script forwards all optional fields when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ hooks: [], scenes: [], callToActions: [] }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await parseOwnScript.handler(
      {
        rawScript: 'Hey everyone, today I want to talk about this brush.',
        twinDescription: 'a friendly pet owner',
        productDescription: 'pet grooming brush',
        isFaceless: true,
        projectMode: 'creator',
        audioMode: 'voiceover',
        engine: 'sora',
      },
      client,
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({
      rawScript: 'Hey everyone, today I want to talk about this brush.',
      twinDescription: 'a friendly pet owner',
      productDescription: 'pet grooming brush',
      isFaceless: true,
      projectMode: 'creator',
      audioMode: 'voiceover',
      engine: 'sora',
    });
  });

  it('generate_image posts visualPrompt and quality to proxyGenerateSceneImage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson('https://firebasestorage.googleapis.com/v0/b/test/o/scene.png?alt=media'));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await generateImage.handler(
      { visualPrompt: 'a creator unboxing a bottle', quality: 'hq', aspectRatio: '9:16' },
      client,
    );
    expect(fetchMock.mock.calls[0]![0]).toContain('/proxyGenerateSceneImage');
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      visualPrompt: 'a creator unboxing a bottle',
      productDescription: '', // Auto-populated; backend rejects undefined.
      quality: 'hq',
      aspectRatio: '9:16',
    });
  });

  it('generate_image forwards imageEngine when set and omits it by default', async () => {
    // Fresh Response per call — a Response body is single-read.
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => okJson('https://firebasestorage.googleapis.com/v0/b/test/o/scene.png?alt=media'));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });

    // Explicit GPT Image 2 selection is forwarded verbatim.
    await generateImage.handler({ visualPrompt: 'a creator holding a labeled jar', imageEngine: 'openai' }, client);
    const withEngine = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(withEngine.imageEngine).toBe('openai');

    // Omitted → the field is absent so the backend applies its own 'gemini' default.
    await generateImage.handler({ visualPrompt: 'a creator holding a labeled jar' }, client);
    const withoutEngine = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect('imageEngine' in withoutEngine).toBe(false);
  });

  it('generate_image always sends productDescription (regression for 0.1.0 backend rejection)', async () => {
    // Backend at functions/index.js:7980 rejects when productDescription === undefined
    // even though it's not in the OpenAPI required list. Real bug from 0.1.0 where
    // calls failed with "Missing required parameters... Need at least a visual prompt"
    // despite the visual prompt being valid. Empty string passes the typeof check.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJson('https://firebasestorage.googleapis.com/v0/b/test/o/scene.png?alt=media'));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await generateImage.handler({ visualPrompt: 'a creator unboxing a fitness band' }, client);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.productDescription).toBe('');
  });

  it('generate_image passes through caller-supplied productDescription', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJson('https://firebasestorage.googleapis.com/v0/b/test/o/scene.png?alt=media'));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await generateImage.handler(
      { visualPrompt: 'a creator unboxing', productDescription: 'pet grooming brush' },
      client,
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.productDescription).toBe('pet grooming brush');
  });

  it('generate_image threads faceless=true to backend isFaceless (explicit opt-in)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJson('https://firebasestorage.googleapis.com/v0/b/test/o/scene.png?alt=media'));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await generateImage.handler({ visualPrompt: 'hands holding a serum bottle', faceless: true }, client);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.isFaceless).toBe(true);
  });

  it('generate_image defaults to non-faceless: omits isFaceless when faceless is unset', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJson('https://firebasestorage.googleapis.com/v0/b/test/o/scene.png?alt=media'));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await generateImage.handler({ visualPrompt: 'a creator looking into the camera' }, client);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect('isFaceless' in body).toBe(false);
  });

  it('generate_image threads an explicit faceless=false opt-out', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJson('https://firebasestorage.googleapis.com/v0/b/test/o/scene.png?alt=media'));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await generateImage.handler({ visualPrompt: 'a creator looking into the camera', faceless: false }, client);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.isFaceless).toBe(false);
  });

  it('apply_text_overlay posts overlays array to proxyApplyTextOverlay', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ overlayVideoUrl: 'https://signed/out.mp4' }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    const result = await applyTextOverlay.handler(
      {
        videoUrl: 'https://example.com/in.mp4',
        overlays: [{ text: 'Hook!', startTime: 0, endTime: 2, position: 'top' }],
      },
      client,
    );
    expect(fetchMock.mock.calls[0]![0]).toContain('/proxyApplyTextOverlay');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    // Backend reads `videoUri` (not `videoUrl`) — handler translates the public name on the wire.
    expect(body.videoUri).toBe('https://example.com/in.mp4');
    expect(body.videoUrl).toBeUndefined();
    expect(body.overlays).toHaveLength(1);
    expect(body.overlays[0].text).toBe('Hook!');
    expect(body.overlays[0].startTime).toBe(0);
    expect(body.overlays[0].endTime).toBe(2);
    // Handler normalizes backend's `overlayVideoUrl` to the public `videoUrl` shape.
    const payload = JSON.parse(result.content[0].text);
    expect(payload.videoUrl).toBe('https://signed/out.mp4');
    expect(payload.overlayVideoUrl).toBeUndefined();
  });
});
