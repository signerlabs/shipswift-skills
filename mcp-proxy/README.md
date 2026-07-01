# shipswift-mcp-proxy

A local MCP proxy that fixes the `build-feature` and `explore-recipes` prompt
probe errors from `https://api.shipswift.app/mcp`.

## The bug

The shipswift MCP server registers `build-feature` with required arguments
(`feature`, `platform`). Standard MCP clients (MiMo Code, Claude Code, Cursor,
etc.) probe prompts at session start by calling `prompts/get` with empty args
to verify renderability. The shipswift server rejects these probes with
`-32602: Invalid arguments`, polluting audit logs for every user.

## The fix

This proxy sits between your MCP client and the upstream server:

```
[MCP client] → http://127.0.0.1:7654/mcp → [this proxy] → https://api.shipswift.app/mcp
```

When it sees a `prompts/get` call with missing required arguments, it fills
them with sensible defaults before forwarding:

| Prompt             | Missing arg  | Default value                                                |
|--------------------|--------------|--------------------------------------------------------------|
| `build-feature`    | `feature`    | `User feature (placeholder — please supply a real feature)`  |
| `build-feature`    | `platform`   | `SwiftUI`                                                    |
| `explore-recipes`  | `projectType`| `iOS app`                                                    |

Explicit caller values are always preserved (UIKit is not overwritten).

## Install

```bash
git clone https://github.com/signerlabs/shipswift-skills.git
cd shipswift-skills/mcp-proxy
node shipswift-mcp-proxy.js --port 7654 --host 127.0.0.1
```

Or install as a launchd service on macOS (auto-start at login, restart on crash):

```bash
cat > ~/Library/LaunchAgents/com.shipswift.mcp-proxy.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.shipswift.mcp-proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(which node)</string>
    <string>$(pwd)/shipswift-mcp-proxy.js</string>
    <string>--port</string><string>7654</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
launchctl load ~/Library/LaunchAgents/com.shipswift.mcp-proxy.plist
```

## Configure your MCP client

Point your MCP client at `http://127.0.0.1:7654/mcp` instead of
`https://api.shipswift.app/mcp`.

### MiMo Code
Edit `~/.local/share/mimocode/shared/mcp-config/mcp-servers.json`:

```json
"shipswift": {
  "description": "SwiftUI recipes (via local proxy)",
  "url": "http://127.0.0.1:7654/mcp"
}
```

### Claude Code
```bash
claude mcp remove shipswift
claude mcp add --transport http shipswift http://127.0.0.1:7654/mcp
```

### Cursor
Update `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "shipswift": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:7654/mcp"
    }
  }
}
```

### Other clients
Substitute the upstream URL with the local proxy URL.

## Test

```bash
# Unit tests (no network)
node --test test/shipswift-mcp-proxy.test.js

# Live integration test against real upstream
node shipswift-mcp-proxy.js --port 7657 &
bash test/integration-test.sh 7657
```

## Configuration

| Flag           | Env var                  | Default                          |
|----------------|--------------------------|----------------------------------|
| `--port`       | `SHIPSWIFT_PROXY_PORT`   | `7654`                           |
| `--host`       | `SHIPSWIFT_PROXY_HOST`   | `127.0.0.1`                      |
| `--upstream`   | `SHIPSWIFT_UPSTREAM`     | `https://api.shipswift.app/mcp`  |

## Why a proxy and not a server fix?

The MCP server code lives in a private shipswift repo (not in this public
skills repo). This proxy is the durable client-side fix that:

- works today, regardless of upstream timeline
- preserves user choice (just unset the `url` to revert to direct upstream)
- gets out of the way once shipswift ships the upstream fix

When shipswift fixes the prompt registration server-side, you can simply
unset the `url` override and remove the proxy.

## License

MIT (same as this repo).