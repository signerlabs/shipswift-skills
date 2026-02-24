---
name: explore-recipes
description: >
  Explore and browse available ShipSwift recipes. Use when the user says "explore",
  "browse", "show recipes", "list components", "what's available", or wants to discover
  what ShipSwift offers.
---

# Explore ShipSwift Recipes

Browse the full catalog of ShipSwift recipes -- 40+ production-ready SwiftUI implementations covering animations, charts, UI components, and full-stack modules.

## Prerequisites Check

Before starting, verify the ShipSwift recipe server is available by calling `listRecipes`.

If the recipe tools are not available, help the user set up:

1. **Install Skills:**
   ```bash
   npx skills add signerlabs/shipswift-skills
   ```

2. **Connect the recipe server** — the AI tool needs MCP access to fetch recipes:
   - **Claude Code**: `claude mcp add --transport http shipswift https://api.shipswift.app/mcp`
   - **Cursor** — add to `.cursor/mcp.json`: `{"mcpServers":{"shipswift":{"type":"streamableHttp","url":"https://api.shipswift.app/mcp"}}}`
   - **VS Code Copilot** — add to `.vscode/mcp.json`: `{"servers":{"shipswift":{"type":"http","url":"https://api.shipswift.app/mcp"}}}`
   - **Other tools**: See [shipswift.app](https://shipswift.app) for setup guides

3. Restart the AI tool, then try again.

## Workflow

1. **List available recipes**: Use `listRecipes` to get the full catalog. Present them organized by category:

   | Category | Count | Examples |
   |----------|-------|---------|
   | Animation | 10 | Shimmer, Typewriter, Glow Scan, Mesh Gradient |
   | Chart | 8 | Line, Bar, Area, Donut, Radar, Heatmap |
   | Component | 14 | Label, Alert, Loading, Stepper, Onboarding |
   | Module | 8 | Auth, Camera, Chat, Settings, Subscriptions |

2. **Filter by category** (optional): If the user is interested in a specific category, use `listRecipes` with the category filter or `searchRecipes` with relevant keywords.

3. **Show recipe details**: When the user picks a recipe, use `getRecipe` to fetch the full implementation and present:
   - What the component does
   - Architecture overview
   - Key features and customization options
   - A preview of the code structure

4. **Suggest combinations**: Based on the user's project, recommend recipe combinations that work well together. For example:
   - **Onboarding flow**: onboarding-view + typewriter-text + shimmer
   - **Analytics dashboard**: line-chart + bar-chart + donut-chart + activity-heatmap
   - **Social feature**: camera + chat + auth-cognito

## Guidelines

- Present recipes in a scannable format (tables or bullet lists).
- Highlight the recipe tier (Free or Pro) so users know what's included.
- When showing recipe details, include the recipe ID so the user can reference it later.
- Suggest relevant recipes based on the user's current project context.

## Pro Recipes

Some recipes require ShipSwift Pro. When browsing, clearly mark Pro recipes and explain:

- **Free recipes** (38): Full source code, always available.
- **Pro recipes** (2+): Preview available (title, description, architecture). Full code requires ShipSwift Pro.
- **Get Pro**: Lifetime access to all Pro recipes at [shipswift.app/pricing](https://shipswift.app/pricing) ($89, one-time payment).

If the user already has a Pro key, guide them to set the `SHIPSWIFT_API_KEY` environment variable:
```bash
# Add to ~/.zshrc or ~/.bashrc
export SHIPSWIFT_API_KEY=sk_live_xxxxx
```
Then restart their AI tool for the key to take effect.
