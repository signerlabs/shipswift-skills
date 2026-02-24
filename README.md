# ShipSwift Skills

Build iOS apps faster with **40+ production-ready SwiftUI recipes** -- right inside your AI coding tool.

ShipSwift provides copy-paste-ready implementations for animations, charts, UI components, and full-stack modules (auth, camera, subscriptions, chat, and more). This repository distributes ShipSwift as **Skills + Plugin** for 30+ AI coding tools.

## Quick Start

### Claude Code (recommended)

```bash
# Install the plugin (auto-configures MCP)
/plugin marketplace add signerlabs/shipswift-skills
/plugin install shipswift
```

### Universal (works with any AI tool)

```bash
npx skills add signerlabs/shipswift-skills
```

### Platform-Specific

| Platform | Install Command |
|----------|----------------|
| **Claude Code** | `/plugin marketplace add signerlabs/shipswift-skills` → `/plugin install shipswift` |
| **OpenAI Codex** | `$skill-installer install shipswift from signerlabs/shipswift-skills` |
| **Gemini CLI** | `gemini skills install https://github.com/signerlabs/shipswift-skills.git` |
| **Cursor** | `npx skills add signerlabs/shipswift-skills -a cursor` |
| **VS Code Copilot** | `npx skills add signerlabs/shipswift-skills -a github-copilot` |
| **Windsurf** | `npx skills add signerlabs/shipswift-skills -a windsurf` |

## What You Get

### Skills (AI Workflow Instructions)

| Skill | Triggers | What It Does |
|-------|----------|-------------|
| **build-feature** | "build", "create", "add a feature" | Searches recipes and generates a full integration plan |
| **add-component** | "add component", "add X view" | Finds the right recipe and integrates it into your project |
| **explore-recipes** | "explore", "browse", "show recipes" | Lists all available recipes organized by category |

### MCP Server (Auto-Configured)

The plugin automatically connects to the ShipSwift MCP server, giving your AI tool access to:

- **`listRecipes`** -- Browse all recipes, filter by category
- **`searchRecipes`** -- Search by keyword across titles, descriptions, and code
- **`getRecipe`** -- Get complete source code with architecture docs

## Recipe Catalog

| Category | Count | Examples |
|----------|-------|---------|
| **Animation** | 10 | Shimmer, Typewriter, Glow Scan, Mesh Gradient, Orbit, Before/After |
| **Chart** | 8 | Line, Bar, Area, Donut, Ring, Radar, Scatter, Heatmap |
| **Component** | 14 | Label, Alert, Loading, Stepper, Onboarding, Tab Button |
| **Module** | 8 | Auth (Cognito), Camera, Chat, Settings, Subscriptions, Infrastructure |

## ShipSwift Pro

Most recipes are **free** and always available. A few advanced modules require ShipSwift Pro:

- **Pro recipes**: TikTok Event Tracking, StoreKit 2 Subscriptions (more coming)
- **Price**: $89, one-time payment, lifetime access
- **Get it**: [shipswift.app/pricing](https://shipswift.app/pricing)

After purchasing, set your API key:

```bash
# Add to ~/.zshrc or ~/.bashrc
export SHIPSWIFT_API_KEY=sk_live_xxxxx
```

Then restart your AI tool. The plugin's MCP configuration automatically picks up the key -- no manual header setup needed.

## Manual MCP Setup

If you prefer not to use the plugin/skills system, you can configure the MCP server directly:

**Claude Code:**

```bash
claude mcp add --transport http shipswift https://api.shipswift.app/mcp
```

**Cursor / VS Code / Other (mcp.json):**

```json
{
  "mcpServers": {
    "shipswift": {
      "type": "http",
      "url": "https://api.shipswift.app/mcp"
    }
  }
}
```

**With Pro API key:**

```json
{
  "mcpServers": {
    "shipswift": {
      "type": "http",
      "url": "https://api.shipswift.app/mcp",
      "headers": {
        "Authorization": "Bearer sk_live_xxxxx"
      }
    }
  }
}
```

## Repository Structure

```
signerlabs/shipswift-skills/
├── .claude-plugin/
│   └── marketplace.json              # Claude Code Marketplace entry
├── plugins/
│   └── shipswift/
│       ├── .claude-plugin/
│       │   └── plugin.json           # Plugin metadata
│       ├── .mcp.json                 # Auto-configures MCP server
│       └── skills/
│           ├── build-feature/SKILL.md
│           ├── add-component/SKILL.md
│           └── explore-recipes/SKILL.md
├── skills/                           # Cross-platform standard (npx skills add)
│   ├── build-feature/SKILL.md
│   ├── add-component/SKILL.md
│   └── explore-recipes/SKILL.md
└── README.md
```

## Links

- **Website**: [shipswift.app](https://shipswift.app)
- **iOS Template Repo**: [github.com/signerlabs/ship-swift-ios](https://github.com/signerlabs/ship-swift-ios)
- **MCP Server**: `https://api.shipswift.app/mcp`

## License

MIT
