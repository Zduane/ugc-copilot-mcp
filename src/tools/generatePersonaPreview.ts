import { z } from 'zod';
import { toolJson } from '../errors.js';
import { PLATFORMS, type ToolDefinition } from './types.js';

const InputSchema = z.object({
  niche: z.string().min(3).max(100).describe('Creator niche (e.g. "fitness coaching", "AI productivity").'),
  platform: z.enum(PLATFORMS).describe('Target platform.'),
  targetAudience: z
    .string()
    .min(5)
    .max(500)
    .describe('Description of the target audience (e.g. "busy professionals 25-40 who want to lose weight").'),
});

type Input = z.infer<typeof InputSchema>;

interface PersonaResult {
  persona: {
    name: string;
    tagline: string;
    personalityTraits: string[];
    contentPillars: string[];
    preferredTones: string[];
    hookStyles: string[];
    nicheTopics: string[];
    postingCadence: string;
    targetAudience: string;
    brandVoice: string;
  };
}

export const generatePersonaPreview: ToolDefinition<Input> = {
  name: 'generate_persona_preview',
  title: 'Preview Creator Persona',
  annotations: { readOnlyHint: true, openWorldHint: true },
  description:
    'Generate a creator persona preview: name, tagline, personality traits, content pillars, hook styles, niche topics, posting cadence, and brand voice. ' +
    'Free tier — no API key required, rate-limited to 3 calls/day per IP. For full AI Twin (with persistent face/voice/style), use the web app.',
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const result = await client.callPublic<PersonaResult>('freeGenerateCreatorPersona', {
      niche: input.niche,
      platform: input.platform,
      targetAudience: input.targetAudience,
    });
    return toolJson(result);
  },
};
