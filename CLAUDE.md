# CLAUDE.md

## Project Overview
ShipSwift Skills + Plugin cross-platform distribution (public repo: signerlabs/shipswift-skills). Provides AI coding tool integration for ShipSwift recipes via Skills (npx) and Claude Code Plugin.

## Development Constraints
- Public repo — all comments and docs in English
- Skills follow the `npx skills add` standard format
- Plugin follows Claude Code Plugin spec (.mcp.json + skills/)
- Recipe Server endpoint: `https://api.shipswift.app/mcp`

## Directory Conventions
- `skills/` — Cross-platform Skills (SKILL.md format, works with 30+ AI tools)
- `plugins/shipswift/` — Claude Code Plugin (auto-configures MCP + skills)
- `plugins/shipswift/.mcp.json` — MCP server auto-configuration
- `plugins/shipswift/skills/` — Plugin-bundled skills (mirrors top-level skills/)

## 关联项目

> 全局项目地图见用户级 `~/.claude/CLAUDE.md`「signerlabs 项目地图」。本 repo 属 **02 shipswift**。

- **同项目其他 repo**：`../ios/`、`../server/`、`../website/`
