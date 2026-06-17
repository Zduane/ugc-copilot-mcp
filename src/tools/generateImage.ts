import { z } from 'zod';
import { toolJson } from '../errors.js';
import { ASPECT_RATIOS, PROJECT_MODES, QUALITIES, type ToolDefinition } from './types.js';

const InputSchema = z.object({
  visualPrompt: z
    .string()
    .min(1)
    .max(4000)
    .describe('Narrative visual prompt for the scene (paragraph style works better than keyword lists).'),
  productDescription: z
    .string()
    .max(2000)
    .optional()
    .describe(
      'Description of the product or subject (1-2 sentences). The backend rejects calls when this field is undefined ' +
      "even though it's not in the OpenAPI required list — pass an empty string if there's no product. " +
      'Including a real description anchors the AI to the right subject and reduces generic output.',
    ),
  quality: z.enum(QUALITIES).default('standard').optional().describe('standard (1 credit) or hq (2 credits).'),
  aspectRatio: z.enum(ASPECT_RATIOS).default('9:16').optional().describe('Aspect ratio.'),
  influencerImageUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), { message: 'influencerImageUrl must use https://' })
    .optional()
    .describe('Optional reference photo URL of the creator.'),
  productImageUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), { message: 'productImageUrl must use https://' })
    .optional()
    .describe('Optional product photo URL for compositing.'),
  referenceImageUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), { message: 'referenceImageUrl must use https://' })
    .optional()
    .describe('Generic reference photo to guide style.'),
  projectMode: z
    .enum(PROJECT_MODES)
    .optional()
    .describe(
      'Content mode — affects compositing logic (e.g. own-script disables influencer framing). ' +
      'projectMode: "creator-intimate" (Mature Mode) requires paid entitlement and prior T&C acceptance ' +
      'via the web UI — returns 403 mature_mode_paid_required or mature_mode_terms_required otherwise. ' +
      'Mature Mode prompts are injected automatically by the backend (suggestive framing + platform-safety guardrails).',
    ),
  masterIdentityPrompt: z
    .string()
    .max(2000)
    .optional()
    .describe(
      'Canonical "actor playing the role" description (face DNA, body proportions, signature markers — ' +
      'no clothing or scene context). When set, the backend injects this verbatim as an [IDENTITY] block at ' +
      'the top of the Gemini prompt so the same character reappears across every generate_image call. ' +
      'Pass the same string on each call to keep the character consistent across scenes. ' +
      'Skipped server-side in faceless mode or when no influencer image is supplied. Cap is 2000 chars; ' +
      'backticks and [IDENTITY] / [/IDENTITY] delimiters are stripped to prevent prompt-injection escapes.',
    ),
  faceless: z
    .boolean()
    .optional()
    .describe(
      'Render a faceless, hands-only composition (no face or person shown). Defaults to false — by default the ' +
      'creator/person is rendered per your visualPrompt, with their face visible when the prompt asks for it. ' +
      'Set true only for hands-on-product or POV-style hooks.',
    ),
});

type Input = z.infer<typeof InputSchema>;

export const generateImage: ToolDefinition<Input> = {
  name: 'generate_image',
  description:
    'Generate a scene image from a visual prompt. Returns a permanent Firebase Storage HTTPS URL (JSON-encoded string). ' +
    'Cost: 1 credit standard / 2 credits hq. Requires UGC_COPILOT_API_KEY. ' +
    'The URL is suitable for direct rendering in chat UIs or feeding into render_video as a sceneImage source.',
  inputSchema: InputSchema,
  handler: async (input, client) => {
    // Backend validation rejects when productDescription === undefined (line 7980 of
    // functions/index.js as of OpenAPI v2026-04-29). Empty string passes that check.
    // OpenAPI doesn't list productDescription as required, but the implementation
    // treats it as "must at least exist". Default to '' so this tool works without
    // forcing every caller to think about product context.
    const body: Record<string, unknown> = {
      visualPrompt: input.visualPrompt,
      productDescription: input.productDescription ?? '',
    };
    if (input.quality) body.quality = input.quality;
    if (input.aspectRatio) body.aspectRatio = input.aspectRatio;
    if (input.influencerImageUrl) body.influencerImageUrl = input.influencerImageUrl;
    if (input.productImageUrl) body.productImageUrl = input.productImageUrl;
    if (input.referenceImageUrl) body.referenceImageUrl = input.referenceImageUrl;
    if (input.projectMode) body.projectMode = input.projectMode;
    if (input.masterIdentityPrompt) body.masterIdentityPrompt = input.masterIdentityPrompt;
    if (input.faceless !== undefined) body.isFaceless = input.faceless;
    const imageUrl = await client.callApi<string>('proxyGenerateSceneImage', body);
    return toolJson({ imageUrl });
  },
};
