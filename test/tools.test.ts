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

  it('fetch_video does not send Idempotency-Key (read-only)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJson({ videoUrl: 'https://signed/video.mp4', mimeType: 'video/mp4' }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await fetchVideo.handler(
      { operationName: 'op-1', engine: 'veo' },
      client,
    );
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeUndefined();
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

  it('generate_image posts visualPrompt and quality to proxyGenerateSceneImage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ imageData: 'data:image/png;base64,xxx', mimeType: 'image/png' }));
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

  it('generate_image always sends productDescription (regression for 0.1.0 backend rejection)', async () => {
    // Backend at functions/index.js:7980 rejects when productDescription === undefined
    // even though it's not in the OpenAPI required list. Real bug from 0.1.0 where
    // calls failed with "Missing required parameters... Need at least a visual prompt"
    // despite the visual prompt being valid. Empty string passes the typeof check.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJson({ imageData: 'data:image/png;base64,xxx', mimeType: 'image/png' }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await generateImage.handler({ visualPrompt: 'a creator unboxing a fitness band' }, client);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.productDescription).toBe('');
  });

  it('generate_image passes through caller-supplied productDescription', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJson({ imageData: 'data:image/png;base64,xxx', mimeType: 'image/png' }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await generateImage.handler(
      { visualPrompt: 'a creator unboxing', productDescription: 'pet grooming brush' },
      client,
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.productDescription).toBe('pet grooming brush');
  });

  it('apply_text_overlay posts overlays array to proxyApplyTextOverlay', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ videoUrl: 'https://signed/out.mp4', mimeType: 'video/mp4' }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await applyTextOverlay.handler(
      {
        videoUrl: 'https://example.com/in.mp4',
        overlays: [{ text: 'Hook!', startSec: 0, endSec: 2, position: 'top' }],
      },
      client,
    );
    expect(fetchMock.mock.calls[0]![0]).toContain('/proxyApplyTextOverlay');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.videoUrl).toBe('https://example.com/in.mp4');
    expect(body.overlays).toHaveLength(1);
    expect(body.overlays[0].text).toBe('Hook!');
  });
});
