import { z } from 'zod';
import { toolJson } from '../errors.js';
import { AUDIO_MODES, ENGINES, PROJECT_MODES, type ToolDefinition } from './types.js';

const InputSchema = z.object({
  rawScript: z
    .string()
    .min(10)
    .max(10000)
    .describe('The user-written raw script text (10–10,000 chars). Plain text — no markdown / JSON wrapping needed.'),
  twinDescription: z
    .string()
    .optional()
    .describe('Optional creator persona description used to flavor visuals (look, vibe, setting).'),
  productDescription: z
    .string()
    .optional()
    .describe('Optional product / topic description used to flavor visuals and platform variations.'),
  isFaceless: z
    .boolean()
    .optional()
    .describe('If true, forces all scenes to scriptType=voiceover with no visible face.'),
  projectMode: z
    .enum(PROJECT_MODES)
    .optional()
    .describe('Content mode used to flavor parsing (e.g. live-broadcast injects ESPN-style broadcast graphics). Defaults to own-script.'),
  audioMode: z
    .enum(AUDIO_MODES)
    .optional()
    .describe('Audio treatment override. voiceover = all scenes VO; dialogue = on-camera dialogue allowed; background = music/ambient only.'),
  engine: z
    .enum(ENGINES)
    .optional()
    .describe('Target video engine (sora | veo | kling | seedance). Passed to the AI as parsing context — soft hint only, does not enforce duration limits.'),
});

type Input = z.infer<typeof InputSchema>;

export const parseOwnScript: ToolDefinition<Input> = {
  name: 'parse_own_script',
  title: 'Parse Your Own Script',
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  description:
    'Parse a user-written raw script (10–10,000 chars) into the structured ScriptResult shape: hooks, scenes with visuals + dialogue, CTAs, and platform variations — ready for generate_image + render_video. ' +
    'Cost: 1 credit. Requires authentication (connected UGC Copilot account or API key). ' +
    "Use this instead of `generate_script` when the user already has their own script and wants to render it without AI rewriting the content. " +
    "Optional `projectMode` and `audioMode` shape the parsing (e.g. live-broadcast adds ESPN-style score-bug graphics; voiceover forces faceless scenes). " +
    "Optional `engine` is passed to the AI as parsing context so scenes adapt to the target renderer's style. " +
    "Note: `projectMode: 'creator-intimate'` (Mature Mode) is gated — requires paid entitlement AND Mature Mode T&C acceptance via the web UI. Returns 403 mature_mode_paid_required or mature_mode_terms_required otherwise.",
  inputSchema: InputSchema,
  handler: async (input, client) => {
    const body: Record<string, unknown> = { rawScript: input.rawScript };
    if (input.twinDescription) body.twinDescription = input.twinDescription;
    if (input.productDescription) body.productDescription = input.productDescription;
    if (input.isFaceless !== undefined) body.isFaceless = input.isFaceless;
    if (input.projectMode) body.projectMode = input.projectMode;
    if (input.audioMode) body.audioMode = input.audioMode;
    if (input.engine) body.engine = input.engine;
    const result = await client.callApi<unknown>('proxyParseOwnScript', body);
    return toolJson(result);
  },
};
