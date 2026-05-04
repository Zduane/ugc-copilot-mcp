/**
 * Smoke tests against the real production backend.
 *
 * Skipped by default. Enable with UGC_RUN_SMOKE=1 in env (or via the dedicated
 * `npm run smoke` script, which sets it for you).
 *
 * Auth-tier tests require UGC_COPILOT_API_KEY (a real `ugc_live_...` key with
 * positive credit balance). Free-tier tests need no auth but are IP-rate-limited
 * to 3-5 calls/day, so frequent CI runs from a shared GHA IP may hit the cap.
 *
 * **Why these exist:** Mocked-fetch unit tests (test/tools.test.ts) cannot catch
 * cases where the OpenAPI spec says a field is optional but the backend
 * implementation actually requires it. We hit four such bugs in 0.1.0 — see
 * the 0.1.1 commit message for details. These smoke tests exercise the real
 * request/response shape so future drift surfaces fast.
 *
 * **Cost per run:** ~3 credits (one each: analyze_market, generate_script,
 * generate_image standard). render_video is tested only via its validation
 * path (no credits charged on validation rejection). Long-running video chain
 * tools (check_video_status, wait_for_video, fetch_video, apply_text_overlay)
 * need real artifacts to test successfully and are deferred to manual smoke.
 *
 * Run locally to verify fixes:
 *   UGC_COPILOT_API_KEY=ugc_live_... npm run smoke
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UgcCopilotClient } from '../src/client.js';
import { analyzeTrends } from '../src/tools/analyzeTrends.js';
import { generateHooks } from '../src/tools/generateHooks.js';
import { generatePersonaPreview } from '../src/tools/generatePersonaPreview.js';
import { generateScriptPreview } from '../src/tools/generateScriptPreview.js';
import { analyzeMarket } from '../src/tools/analyzeMarket.js';
import { generateScript } from '../src/tools/generateScript.js';
import { generateImage } from '../src/tools/generateImage.js';
import { renderVideo } from '../src/tools/renderVideo.js';
import { UgcMcpError } from '../src/errors.js';

const RUN_SMOKE = process.env.UGC_RUN_SMOKE === '1';
const HAS_API_KEY = Boolean(process.env.UGC_COPILOT_API_KEY?.startsWith('ugc_live_'));

const describeSmoke = RUN_SMOKE ? describe : describe.skip;
const itAuth = HAS_API_KEY ? it : it.skip;

// 90s per call — backend is slow on cold starts, especially analysis with web search.
const SMOKE_TIMEOUT_MS = 90_000;

let client: UgcCopilotClient;

beforeAll(() => {
  client = new UgcCopilotClient({ timeoutMs: SMOKE_TIMEOUT_MS });
});

afterAll(() => {
  if (!RUN_SMOKE) return;
  // eslint-disable-next-line no-console
  console.log('\n  ⓘ Smoke run complete. Approximate credit cost: ~3 credits if all auth tools ran.');
});

describeSmoke('Smoke — free tier (no API key required)', () => {
  // The free endpoints are IP-rate-limited; running the full suite multiple
  // times in a day from the same IP will start failing with 429s. That's a
  // legitimate signal — the suite SHOULD fail in that case.

  it(
    'analyze_trends returns trends array for an allowed industry',
    { timeout: SMOKE_TIMEOUT_MS },
    async () => {
      const result = await analyzeTrends.handler({ industry: 'Pets & Animals' }, client);
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.trends).toBeInstanceOf(Array);
      expect(parsed.trends.length).toBeGreaterThan(0);
      expect(parsed.trends[0]).toHaveProperty('productName');
    },
  );

  it(
    'generate_hooks returns 10 hooks across categories',
    { timeout: SMOKE_TIMEOUT_MS },
    async () => {
      const result = await generateHooks.handler(
        {
          productDescription: 'A self-cleaning pet grooming brush that captures shed fur as you brush.',
          platform: 'tiktok',
        },
        client,
      );
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.hooks).toBeInstanceOf(Array);
      expect(parsed.hooks.length).toBeGreaterThanOrEqual(5); // backend aims for 10 but tolerate variance
      expect(parsed.hooks[0]).toHaveProperty('hook');
      expect(parsed.hooks[0]).toHaveProperty('category');
    },
  );

  it(
    'generate_persona_preview returns a complete persona',
    { timeout: SMOKE_TIMEOUT_MS },
    async () => {
      const result = await generatePersonaPreview.handler(
        {
          niche: 'pet care for dog owners',
          platform: 'tiktok',
          targetAudience: 'first-time dog owners 25-40 who shop online',
        },
        client,
      );
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.persona).toBeDefined();
      expect(parsed.persona.name).toBeTruthy();
      expect(parsed.persona.contentPillars).toBeInstanceOf(Array);
    },
  );

  it(
    'generate_script_preview returns hooks/scenes/CTA — and accepts "Pets & Animals" (regression for 0.1.0 industry-list bug)',
    { timeout: SMOKE_TIMEOUT_MS },
    async () => {
      const result = await generateScriptPreview.handler(
        {
          productDescription: 'A self-cleaning pet grooming brush that captures shed fur as you brush.',
          industry: 'Pets & Animals',
        },
        client,
      );
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.hooks).toBeInstanceOf(Array);
      expect(parsed.scenes).toBeInstanceOf(Array);
      expect(parsed.callToAction).toBeTruthy();
    },
  );
});

describeSmoke('Smoke — authenticated tier (UGC_COPILOT_API_KEY required)', () => {
  itAuth(
    'analyze_market returns trends + analysis',
    { timeout: SMOKE_TIMEOUT_MS * 2 },
    async () => {
      // 1 credit (or free if hasUsedFreeAnalysis is unset on the account)
      const result = await analyzeMarket.handler({ industry: 'pet care' }, client);
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.analysis).toBeDefined();
      expect(parsed.analysis.trends).toBeInstanceOf(Array);
      // topSellingProducts may be null if includeTrendingProducts was skipped, but default is true
      expect(parsed.topSellingProducts).toBeInstanceOf(Array);
    },
  );

  itAuth(
    'generate_script returns a structured script with isFaceless mode',
    { timeout: SMOKE_TIMEOUT_MS },
    async () => {
      // Use ugc-creator + isFaceless to bypass product-ad's productImages requirement.
      // 1 credit. Asserts the description guidance from 0.1.1 actually works.
      const result = await generateScript.handler(
        {
          productDescription: 'self-cleaning pet grooming brush',
          tone: 'conversational',
          platform: 'tiktok',
          projectMode: 'ugc-creator',
          isFaceless: true,
          targetDurationSec: 15,
        },
        client,
      );
      const parsed = JSON.parse(result.content[0]!.text);
      // ScriptResult shape — at minimum should have hooks or scenes
      expect(parsed.hooks ?? parsed.scenes).toBeDefined();
    },
  );

  itAuth(
    'generate_script in podcast-style mode produces ON-TOPIC commentary (regression for backend Layer B fix)',
    { timeout: SMOKE_TIMEOUT_MS },
    async () => {
      // Layer B fix (main repo PR #352, deployed 2026-05-04) made the backend
      // frame productDescription as "Topic to discuss: ..." for podcast-style
      // instead of dropping it entirely. Before: AI hallucinated unrelated
      // topics ("AI content polish", "minimalist desks"). After: AI produces
      // commentary about the supplied topic. This smoke locks in regression
      // coverage — if Layer B is ever rolled back, this test fires next week.
      // 1 credit.
      const result = await generateScript.handler(
        {
          productDescription: 'self-cleaning pet grooming brush for shedding dogs',
          projectMode: 'podcast-style',
          tone: 'opinionated',
          platform: 'tiktok',
          isFaceless: true,
          targetDurationSec: 20,
        },
        client,
      );
      const parsed = JSON.parse(result.content[0]!.text);
      // Stringify the whole response and search for topic-relevant words.
      // The AI may use "brush", "grooming", "shedding", "dog", "pet" — any of
      // these in the output proves the topic landed. Hallucinated outputs
      // ("minimalist desks", "AI productivity") would not contain any.
      const haystack = JSON.stringify(parsed).toLowerCase();
      const topicWords = ['brush', 'grooming', 'shedding', 'pet', 'dog', 'fur'];
      const hits = topicWords.filter((w) => haystack.includes(w));
      expect(hits.length).toBeGreaterThanOrEqual(2);
    },
  );

  itAuth(
    'generate_image succeeds without explicit productDescription (regression for 0.1.0 undefined-rejection bug)',
    { timeout: SMOKE_TIMEOUT_MS },
    async () => {
      // 1 credit. The 0.1.0 bug: backend rejected this exact call shape (no
      // productDescription) with "Missing required parameters". 0.1.1 auto-defaults
      // productDescription to '' to pass the typeof check.
      const result = await generateImage.handler(
        {
          visualPrompt:
            'A creator in a sunlit kitchen smiling at the camera holding a pet grooming brush. UGC style, smartphone photo.',
          quality: 'standard',
          aspectRatio: '9:16',
        },
        client,
      );
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.imageData).toBeTruthy();
      expect(parsed.mimeType).toMatch(/^image\//);
    },
  );

  itAuth(
    'render_video without sceneImage returns the expected validation error (no credits)',
    { timeout: SMOKE_TIMEOUT_MS },
    async () => {
      // Validation path test — backend rejects before reserving credits, so this
      // is free. Confirms the contract behind render_video's description warning.
      let caught: unknown;
      try {
        await renderVideo.handler(
          {
            visualPrompt: 'a creator unboxing a brush',
            engine: 'sora',
            modelName: 'sora-2',
          },
          client,
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(UgcMcpError);
      const err = caught as UgcMcpError;
      expect(err.status).toBeGreaterThanOrEqual(400);
      expect(err.message.toLowerCase()).toMatch(/sceneimage|edit.*video|reference image|required/);
    },
  );
});
