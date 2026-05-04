import { z } from 'zod';
import { toolJson } from '../errors.js';
import { FREE_TOOL_INDUSTRIES, type ToolDefinition } from './types.js';

const InputSchema = z.object({
  productDescription: z
    .string()
    .min(10)
    .max(1000)
    .describe('Product description (10-1000 chars).'),
  industry: z
    .enum(FREE_TOOL_INDUSTRIES)
    .describe('Industry / niche to tailor the script style.'),
});

type Input = z.infer<typeof InputSchema>;

interface ScriptPreviewResult {
  hooks: Array<{ verbal: string; visual: string; category: string; textOverlay: string; format: string }>;
  scenes: Array<{ visual: string; script: string; scriptType: string; tone: string }>;
  callToAction: string;
}

export const generateScriptPreview: ToolDefinition<Input> = {
  name: 'generate_script_preview',
  description:
    'Generate a preview-tier viral UGC script: 3 hooks (different psychological triggers), 3 scenes with visual + script + tone, and a CTA. ' +
    'Free tier — no API key required, rate-limited to 3 calls/day per IP. For full multi-mode scripts with platform variations and scene-level visual prompts, use generate_script.',
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const result = await client.callPublic<ScriptPreviewResult>('freeGenerateScript', {
      productDescription: input.productDescription,
      industry: input.industry,
    });
    return toolJson(result);
  },
};
