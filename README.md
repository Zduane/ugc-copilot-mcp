# @ugccopilot/mcp

Official MCP (Model Context Protocol) server for [UGC Copilot](https://ugccopilot.ai). Generate UGC-style video ads end-to-end from Claude Desktop, Cursor, Cline, Zed, or any MCP-compatible agent.

14 tools across free + authenticated tiers wrapping the public REST API. Render with Kling 3.0, Seedance 2.0/2.5, or Gemini Omni Flash. Pay-as-you-go — no subscription required.

## Quick start

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "ugc-copilot": {
      "command": "npx",
      "args": ["-y", "@ugccopilot/mcp@latest"],
      "env": {
        "UGC_COPILOT_API_KEY": "ugc_live_..."
      }
    }
  }
}
```

Restart Claude Desktop. Fourteen tools will appear in the tools list.

### Cursor

Add to `.cursor/mcp.json` in your project (or to user settings):

```json
{
  "mcpServers": {
    "ugc-copilot": {
      "command": "npx",
      "args": ["-y", "@ugccopilot/mcp@latest"],
      "env": {
        "UGC_COPILOT_API_KEY": "ugc_live_..."
      }
    }
  }
}
```

### Cline / Continue / Zed

Same pattern — point your MCP client at `npx -y @ugccopilot/mcp@latest` with the env var set.

### Forcing a version refresh

Claude Desktop spawns the MCP server once per launch and `npx` caches resolved packages in `~/.npm/_npx/`. After we publish a new version, your running session keeps using the old one until the process restarts and npx re-resolves.

If a Claude Desktop restart isn't picking up a newer version:

```bash
rm -rf ~/.npm/_npx
# Then quit Claude Desktop fully (⌘Q on macOS) and relaunch.
```

Pinning `@latest` in your config (as above) makes npx more aggressive about checking the registry on each cold start. If you'd rather lock to a specific version for stability, replace `@latest` with the exact version, e.g. `@ugccopilot/mcp@0.1.13`.

## Tools

### Free tier (no API key required)

| Tool | Purpose | Limit |
|---|---|---|
| `analyze_trends` | Industry trend analysis with viral hook ideas | 3/day per IP |
| `generate_hooks` | 10 scroll-stopping hooks for a product | 5/day per IP |
| `generate_persona_preview` | Creator persona preview (name, pillars, voice) | 3/day per IP |
| `generate_script_preview` | 3-hook, 3-scene preview script | 3/day per IP |

### Authenticated tier (requires `UGC_COPILOT_API_KEY`)

| Tool | Purpose | Cost |
|---|---|---|
| `analyze_market` | Trending products + market analysis (composite) | 1 credit |
| `generate_script` | Full viral script with platform variations | 1 credit |
| `parse_own_script` | Parse a user-written raw script into the structured ScriptResult shape | 1 credit |
| `generate_image` | Scene image from a visual prompt | 1 std / 2 hq |
| `render_video` | Start an async video render | 9-305 credits |
| `check_video_status` | Single-shot poll | 0 |
| `wait_for_video` | Poll with backoff up to ~50s | 0 |
| `fetch_video` | Get the rendered MP4 URL | 0 |
| `apply_text_overlay` | Burn captions/CTAs onto a video | 1/call |
| `stitch_videos` | Concatenate 1-10 clips into the final video (crossfades + free captions) | 0 |

## Get an API key

Sign up at <https://ugccopilot.ai/signup> and generate a key from **Profile → API Keys**. The key has the `ugc_live_` prefix.

You only need a key for the authenticated tier — the four free tools work without one.

## Credit pricing

Credit packs (no subscription required): $9 Starter Pack (130 credits + 50 first-purchase bonus, one-time), then 200 credits / $25, 500 / $50, 2,500 / $200, 10,000 / $700 — the same rates with or without a subscription. Subscriptions include monthly bundled credits and higher concurrency caps. See <https://ugccopilot.ai/pricing>.

Video render costs vary by engine, quality, and duration:
- Kling 3.0: 32 std / 50 hq / 130 4k (6.4s baseline) — 4K is native, no upscaling
- Seedance 2.0 / 2.5: 18 std / 35 hq / 60 ultra (2.5, launch price) (4s baseline)
- Gemini Omni Flash: 40 (8s baseline, 720p, no HQ)
- Veo 3.1 is retired (Google shuts it down on 2026-10-22); `veo` requests render on Gemini Omni Flash

Sora 2 is retired (OpenAI shut its API down on 2026-09-24).

## Upgrading from 0.5.x — Veo 3.1 retired

Google shuts the Veo 3.1 preview models down on 2026-10-22, so `render_video` no longer accepts `engine: "veo"`.
Replace it in saved agent prompts and workflows:

| Before (0.5.x) | Now |
|---|---|
| `engine: "veo"`, `modelName: "veo-3.1-fast-generate-preview"` or `"veo-3.1-generate-preview"` | `engine: "omni"`, `modelName: "gemini-omni-1.1-flash"` (image-to-video or text-to-video, native audio, 40 credits per 8s, 720p) |
| `engine: "veo"` for an exact face from a specific image | `engine: "kling"`, `modelName: "fal-ai/kling-video/v3/standard/image-to-video"` |
| `modelName: "gemini-omni-flash-preview"` | `modelName: "gemini-omni-1.1-flash"` (the preview id is still accepted for now and renders on the GA model) |

Passing `veo` returns a validation error that names the replacement. `check_video_status`, `wait_for_video`, `fetch_video`
and `stitch_videos` still accept `veo` for renders that already exist, and `parse_own_script` treats a `veo` hint as `omni`.

## Long-running video renders

`render_video` returns an `operationName` immediately. To get the final MP4:

1. Call `wait_for_video` — polls up to ~50s (stays inside the MCP tool window).
2. If still pending, the agent gets back the `operationName` and a hint to call `check_video_status` again in 30s.
3. When done, call `fetch_video` to get the signed MP4 URL.
4. For a multi-scene script: repeat per scene, then `stitch_videos` with the URLs in
   scene order (optional crossfades and free burned-in captions) for the final ad.

## Errors

Errors include actionable hints:
- `402 insufficient-credits` → buy a credit pack at <https://ugccopilot.ai/pricing/#packs>
- `429 rate-limited` (free tier) → set `UGC_COPILOT_API_KEY` for the higher-volume authenticated tier
- `400 validation` → details field describes which input was rejected
- `5xx` / network → automatic retry with backoff, then surface

## Source & support

- Source: <https://github.com/Zduane/ugc-copilot-mcp>
- Server manifest: <https://ugccopilot.ai/.well-known/mcp.json>
- API documentation: <https://ugccopilot.ai/api/>
- OpenAPI 3.1 spec: <https://ugccopilot.ai/.well-known/openapi.json>
- Support: support@ugccopilot.ai

## License

MIT
