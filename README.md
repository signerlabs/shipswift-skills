# ShipSwift Skills

**Install once. Build iOS apps with production-ready SwiftUI recipes — right inside your AI coding tool.**

ShipSwift provides copy-paste-ready implementations for animations, charts, UI components, and full-stack modules (auth, camera, subscriptions, chat, and more). This repository distributes ShipSwift as an **Agent Skill**: 85 free recipes are bundled directly inside the skill — no server, no MCP, no configuration.

## Quick Start

```bash
npx skills add signerlabs/shipswift-skills
```

That's it. Works with Claude Code, Cursor, Codex, Copilot, Windsurf, Gemini CLI, and 70+ other AI tools. Your AI tool now has the full free recipe catalog locally. Try:

- "Add a shimmer effect to this button"
- "Build an onboarding flow"
- "Show me what ShipSwift offers"

The skill costs almost nothing at rest — recipe docs are loaded only when your AI actually needs them (progressive disclosure).

## What You Get

| Category | Count | Examples |
|----------|-------|----------|
| **Animation** | 43 | Shimmer, Typewriter, Confetti, Mesh Gradient + 27 Metal shader backgrounds |
| **Chart** | 9 | Line, Bar, Area, Donut, Ring, Radar, Scatter, Heatmap, 3D Network Graph |
| **Component** | 23 | Onboarding, Alert, Loading, Stepper, Search Bar, Wallet, KPI Card |
| **Module** | 40 (30 Pro) | Auth (Cognito / Supabase), Camera, Chat, Settings, Infra (CDK / Supabase); Pro: full app screens, paywall templates |

Every recipe is a self-contained doc: architecture overview + full source code + integration checklist + known pitfalls.

**85 of 115 recipes are free** and bundled in the skill. To update to the latest catalog, just re-run `npx skills add signerlabs/shipswift-skills`.

## ShipSwift Pro

30 module recipes require ShipSwift Pro ($89 one-time, lifetime access): 12 full app screens extracted from shipped apps, 12 paywall recipes (11 paywall designs plus the shared paywall kit), and 6 advanced modules: **StoreKit 2 Subscriptions**, **RevenueCat Subscriptions**, **TikTok Ad Attribution**, **TikTok Attribution with RevenueCat**, **Subject Lifting**, and **Export & Share**.

1. Purchase at [shipswift.app](https://shipswift.app) and get your API key.
2. Connect the ShipSwift recipe server (MCP) with your key:

**Claude Code:**

```bash
export SHIPSWIFT_API_KEY=sk_live_xxxxx   # add to ~/.zshrc or ~/.bashrc
claude mcp add --transport http shipswift https://api.shipswift.app/mcp \
  --header "Authorization: Bearer ${SHIPSWIFT_API_KEY}"
```

**Other tools:**

| Tool | Setup |
|------|-------|
| **Gemini CLI** | `gemini mcp add --transport http shipswift https://api.shipswift.app/mcp --header "Authorization: Bearer $SHIPSWIFT_API_KEY"` |
| **Cursor** | Add `{"mcpServers":{"shipswift":{"type":"streamableHttp","url":"https://api.shipswift.app/mcp","headers":{"Authorization":"Bearer sk_live_xxxxx"}}}}` to `.cursor/mcp.json` |
| **VS Code Copilot** | Add `{"servers":{"shipswift":{"type":"http","url":"https://api.shipswift.app/mcp","headers":{"Authorization":"Bearer sk_live_xxxxx"}}}}` to `.vscode/mcp.json` |
| **Windsurf** | Add `{"mcpServers":{"shipswift":{"serverUrl":"https://api.shipswift.app/mcp","headers":{"Authorization":"Bearer sk_live_xxxxx"}}}}` to `~/.codeium/windsurf/mcp_config.json` |

Once connected, the skill fetches Pro recipes through the MCP tools (`listRecipes`, `searchRecipes`, `getRecipe`).

## Claude Code Plugin

Prefer a one-step install in Claude Code (skill + Pro MCP auto-configured together)?

```
/plugin marketplace add signerlabs/shipswift-skills
/plugin install shipswift
```

The plugin bundles the same skill and auto-configures the Pro recipe server using your `SHIPSWIFT_API_KEY` environment variable.

## Repository Structure

```
signerlabs/shipswift-skills/
├── skills/
│   └── shipswift/
│       ├── SKILL.md                  # The skill (hand-written)
│       └── references/               # GENERATED — 85 free recipes + index.md
│           ├── index.md              # Full catalog (115 recipes, Pro rows marked)
│           ├── animation/            # 43 recipes
│           ├── chart/                # 9 recipes
│           ├── component/            # 23 recipes
│           └── module/               # 10 free recipes
├── plugins/
│   └── shipswift/
│       ├── .mcp.json                 # Pro recipe server auto-config (Claude Code Plugin)
│       └── skills/shipswift/         # Mirror of skills/shipswift/
└── README.md
```

`references/` and the plugin mirror are maintained by a sync script — recipe content is sourced from the ShipSwift server repo and updated on every release.

## Links

- **Website**: [shipswift.app](https://shipswift.app)
- **iOS Template Repo**: [github.com/signerlabs/ShipSwift](https://github.com/signerlabs/ShipSwift)
- **Recipe Server (Pro)**: `https://api.shipswift.app/mcp`

## License

MIT
