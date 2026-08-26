import { z } from 'zod';
import { toolJson } from '../errors.js';
import { FREE_TOOL_INDUSTRIES, type ToolDefinition } from './types.js';

const InputSchema = z.object({
  industry: z
    .enum(FREE_TOOL_INDUSTRIES)
    .describe(
      'Industry / niche to analyze. Choose from the supported allow-list.',
    ),
});

type Input = z.infer<typeof InputSchema>;

interface TrendResult {
  trends: Array<{
    productName: string;
    whyTrending: string;
    viralHooks: string[];
    targetAudience: string;
    priceRange: string;
  }>;
}

export const analyzeTrends: ToolDefinition<Input> = {
  name: 'analyze_trends',
  title: 'Analyze Industry Trends',
  annotations: { readOnlyHint: true, openWorldHint: true },
  description:
    'Industry-level UGC trend analysis. Returns 3-5 trending product opportunities with viral hook ideas, target audience, and price range. ' +
    'Free tier — no API key required, rate-limited to 3 calls/day per IP. For higher volume, authenticate and use analyze_market.',
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const result = await client.callPublic<TrendResult>('freeTrendAnalyzer', {
      industry: input.industry,
    });
    return toolJson(result);
  },
};
