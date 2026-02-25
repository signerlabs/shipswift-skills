# ShipSwift Skills

**Install once. Build iOS apps with production-ready SwiftUI recipes — right inside your AI coding tool.**

ShipSwift provides copy-paste-ready implementations for animations, charts, UI components, and full-stack modules (auth, camera, subscriptions, chat, and more). This repository distributes ShipSwift as **Skills** for 30+ AI coding tools.

## Quick Start

### Step 1: Install Skills

```bash
npx skills add signerlabs/shipswift-skills
```

One command. Works with Claude Code, Cursor, Codex, Copilot, Windsurf, Gemini, and 30+ more AI tools.

### Step 2: Connect the Recipe Server

Your AI tool needs MCP access to fetch ShipSwift recipes. Pick your tool and run one command:

**Claude Code** (recommended — zero config):

```bash
claude mcp add --transport http shipswift https://api.shipswift.app/mcp
```

**Other tools:**

| Tool | Setup |
|------|-------|
| **Gemini CLI** | `gemini mcp add --transport http shipswift https://api.shipswift.app/mcp` |
| **Cursor** | Add `{"mcpServers":{"shipswift":{"type":"streamableHttp","url":"https://api.shipswift.app/mcp"}}}` to `.cursor/mcp.json` |
| **VS Code Copilot** | Add `{"servers":{"shipswift":{"type":"http","url":"https://api.shipswift.app/mcp"}}}` to `.vscode/mcp.json` |
| **Windsurf** | Add `{"mcpServers":{"shipswift":{"serverUrl":"https://api.shipswift.app/mcp"}}}` to `~/.codeium/windsurf/mcp_config.json` |

Restart your AI tool after adding the server.

### Step 3: Start Building

Try saying:
- `explore recipes` — browse the full catalog
- `show me animation components` — filter by category
- `build an onboarding flow` — generate a complete feature

## What You Get

### Skills (AI Workflow Instructions)

| Skill | Triggers | What It Does |
|-------|----------|-------------|
| **build-feature** | "build", "create", "add a feature" | Searches recipes and generates a full integration plan |
| **add-component** | "add component", "add X view" | Finds the right recipe and integrates it into your project |
| **explore-recipes** | "explore", "browse", "show recipes" | Lists all available recipes organized by category |

### Recipe Server (MCP)

Once connected, your AI tool has access to:

- **`listRecipes`** — Browse all recipes, filter by category
- **`searchRecipes`** — Search by keyword across titles, descriptions, and code
- **`getRecipe`** — Get complete source code with architecture docs

## Recipe Catalog

| Category | Examples |
|----------|---------|
| **Animation** | Shimmer, Typewriter, Glow Scan, Mesh Gradient, Orbit, Before/After |
| **Chart** | Line, Bar, Area, Donut, Ring, Radar, Scatter, Heatmap |
| **Component** | Label, Alert, Loading, Stepper, Onboarding, Tab Button |
| **Module** | Auth (Cognito), Camera, Chat, Settings, Subscriptions, Infrastructure |

## ShipSwift Pro

Most recipes are **free** and always available. A few advanced modules require ShipSwift Pro:

- **Pro recipes**: TikTok Event Tracking, StoreKit 2 Subscriptions (more coming)
- **Price**: $89, one-time payment, lifetime access
- **Get it**: [shipswift.app](https://shipswift.app)

After purchasing, set your API key:

```bash
# Add to ~/.zshrc or ~/.bashrc
export SHIPSWIFT_API_KEY=sk_live_xxxxx
```

Then restart your AI tool. The recipe server automatically picks up the key.

## Repository Structure

```
signerlabs/shipswift-skills/
├── skills/                           # Cross-platform Skills (npx skills add)
│   ├── build-feature/SKILL.md
│   ├── add-component/SKILL.md
│   └── explore-recipes/SKILL.md
├── plugins/
│   └── shipswift/
│       ├── .mcp.json                 # Auto-configures recipe server (Claude Code Plugin)
│       └── skills/
│           ├── build-feature/SKILL.md
│           ├── add-component/SKILL.md
│           └── explore-recipes/SKILL.md
└── README.md
```

## Links

- **Website**: [shipswift.app](https://shipswift.app)
- **iOS Template Repo**: [github.com/signerlabs/ShipSwift](https://github.com/signerlabs/ShipSwift)
- **Recipe Server**: `https://api.shipswift.app/mcp`

## License

MIT
