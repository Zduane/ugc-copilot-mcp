import { z } from 'zod';
import { toolJson } from '../errors.js';
import type { ToolDefinition } from './types.js';

const InputSchema = z.object({
  industry: z
    .string()
    .min(1)
    .max(100)
    .describe('Free-form industry label (e.g. "fitness", "skincare", "AI tools").'),
  includeTrendingProducts: z
    .boolean()
    .default(true)
    .optional()
    .describe('Whether to include the top-selling-products call (composite). Default true.'),
});

type Input = z.infer<typeof InputSchema>;

interface TopProductsResult {
  topSellingProducts: Array<Record<string, unknown>>;
}

interface MarketAnalysisResult {
  trends: string[];
  characteristics?: string[];
  personas: Array<{ name: string; description: string }>;
  topKeywords: string[];
  viralHooks: Array<{ type: string; description: string }>;
  strategyRecommendations: string[];
}

export const analyzeMarket: ToolDefinition<Input> = {
  name: 'analyze_market',
  description:
    'Full market analysis for an industry: trending products + market trends, audience personas, top keywords, viral hooks, and strategy recommendations. ' +
    'Cost: 1 credit (the trending products call is free for the first ever analysis on the account, then 1 credit; the full market analysis is included). ' +
    'The market-analysis half is uncharged but capped per account per day — 200/day with paid entitlement, 20/day on never-paid accounts — and returns 429 with Retry-After once exceeded. ' +
    'That half runs on every call, including when includeTrendingProducts is false. ' +
    'Composite of proxyFetchTopSellingProducts + proxyFetchFullMarketAnalysis. Requires UGC_COPILOT_API_KEY.',
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const includeProducts = input.includeTrendingProducts ?? true;
    const [products, analysis] = await Promise.all([
      includeProducts
        ? client.callApi<TopProductsResult>('proxyFetchTopSellingProducts', { industry: input.industry })
        : Promise.resolve(null),
      client.callApi<MarketAnalysisResult>('proxyFetchFullMarketAnalysis', { industry: input.industry }),
    ]);
    return toolJson({
      industry: input.industry,
      analysis,
      topSellingProducts: products?.topSellingProducts ?? null,
    });
  },
};
