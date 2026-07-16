# CLAUDE.md

## Project Overview
ShipSwift Skills + Plugin cross-platform distribution (public repo: signerlabs/shipswift-skills). Skills-first strategy: 81 free recipes are bundled inside the `shipswift` skill (progressive disclosure — SKILL.md + references/); the 4 Pro recipes are delivered via the MCP server with an API key.

## Development Constraints
- Public repo — all comments and docs in English
- Skills follow the `npx skills add` standard format (agentskills.io)
- Plugin follows Claude Code Plugin spec (.mcp.json + skills/)
- Recipe Server endpoint (Pro recipes only): `https://api.shipswift.app/mcp`

## Generated Content — Do Not Edit Manually
- `skills/shipswift/references/` is **generated** by `../server/scripts/sync-skills.sh`. Source of truth for recipe content is the server repo `src/recipes/`. To update: edit recipes in the server repo, then re-run the sync script.
- `plugins/shipswift/skills/` is a **script-maintained mirror** of `skills/`. Never edit it directly.
- `skills/shipswift/SKILL.md` is hand-written (the canonical copy). After editing it, re-run the sync script to refresh the plugin mirror.

## Directory Conventions
- `skills/shipswift/` — the single cross-platform skill (SKILL.md + references/)
- `plugins/shipswift/` — Claude Code Plugin (.mcp.json for Pro MCP + mirrored skill)

## 关联项目

> 全局项目地图见用户级 `~/.claude/CLAUDE.md`「signerlabs 项目地图」。本 repo 属 **02 shipswift**。

- **同项目其他 repo**：`../ios/`、`../server/`、`../website/`
