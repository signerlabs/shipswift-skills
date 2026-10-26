---
name: shipswift
description: ShipSwift skill library — 115 production-ready SwiftUI skills for iOS/macOS covering animations (view transitions, particle transitions, change effects, shimmer, confetti, typewriter, 27 Metal shaders), charts (line, bar, donut, radar, heatmap, 3D network graph), UI components (onboarding, alert, stepper, search bar, cached remote images) and full-stack modules (Cognito/Supabase auth, camera, chat, StoreKit subscriptions, CDK infra). Use when building SwiftUI features, adding animations/charts/components, or when the user mentions ShipSwift.
---

# ShipSwift Skills

Production-ready SwiftUI implementations you can copy into iOS/macOS apps. Each skill is a self-contained markdown doc with an architecture overview, full source code, an integration checklist, and known pitfalls.

## How to use

1. **Find a skill**: read [references/index.md](references/index.md) — the full catalog (115 skills across animation / chart / component / module) with one-line descriptions.
2. **Read the skill**: free skills are bundled locally at `references/<category>/<id>.md`. Always read the full skill file before writing code — do not improvise from the index line alone.
3. **Integrate**: follow the skill's integration checklist. Keep the `SW` type prefix and `.sw` view-modifier naming conventions unless the user asks otherwise.

Guidelines:

- Skills are self-contained: components depend only on small SWUtil helpers, which each skill inlines or references explicitly.
- When combining skills (e.g. an onboarding flow from onboarding-view + typewriter-text + confetti), read each skill fully first, then integrate them together.
- Present catalog browsing results as scannable tables grouped by category, and include skill IDs so the user can reference them later.

## Latest source on GitHub

The bundled references match the latest ShipSwift release. For the newest source, or for shared utilities not inlined in a skill, fetch from the public template repo:

- Repo: https://github.com/signerlabs/ShipSwift
- Component paths: `ShipSwift/SWPackage/{SWAnimation,SWChart,SWComponent,SWModule,SWUtil}/`
- Raw file example: `https://raw.githubusercontent.com/signerlabs/ShipSwift/main/ShipSwift/SWPackage/SWAnimation/SWShimmer.swift`

## Pro skills

30 skills are Pro tier, marked **Pro** in the index: 12 full app screens, 12 paywall skills (`paywall-kit` plus 11 paywall designs) and 6 advanced modules (`subscription-storekit`, `subscription-revenuecat`, `tiktok-tracking`, `tiktok-tracking-revenuecat`, `subject-lifting`, `export-share`). Their full docs (architecture, integration checklist, pitfalls) are delivered through the ShipSwift MCP server and are not bundled here.

To unlock Pro:

1. Get ShipSwift Pro ($89 a year, or $199 once for lifetime) at https://shipswift.app/#pricing, then copy your API key from https://shipswift.app/dashboard.
2. Set the key and connect the MCP server (Claude Code example; other tools: see the [repo README](https://github.com/signerlabs/shipswift-skills#shipswift-pro)):

   ```bash
   export SHIPSWIFT_API_KEY=sk_live_xxxxx   # add to ~/.zshrc
   claude mcp add --transport http shipswift https://api.shipswift.app/mcp \
     --header "Authorization: Bearer ${SHIPSWIFT_API_KEY}"
   ```

3. Fetch Pro skills with the MCP tools `listSkills` / `searchSkills` / `getSkill`.

If the user asks for a Pro skill and no key/MCP is configured, tell them what the skill covers (from the index) and point them to https://shipswift.app/#pricing. Do not attempt to reconstruct Pro skill content from memory.

## Skill combinations that work well

- **Onboarding flow**: onboarding-view + typewriter-text + confetti
- **Analytics dashboard**: line-chart + bar-chart + donut-chart + activity-heatmap
- **AI chat app**: chat + thinking-indicator + markdown-text
- **Social / media feature**: camera + chat + auth-cognito
- **Monetization**: subscription-storekit (Pro) + order-view
