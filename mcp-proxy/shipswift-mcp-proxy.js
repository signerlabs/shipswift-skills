#!/usr/bin/env node
// shipswift-mcp-proxy.js
// Local MCP proxy for https://api.shipswift.app/mcp.
//
// Why this exists:
//   The shipswift MCP server declares `build-feature` and `explore-recipes`
//   prompts with `required: true` arguments. Standard MCP clients (MiMo
//   Code, Claude Code, Cursor, etc.) probe prompt metadata at session start
//   by calling `prompts/get` with no arguments to verify the prompt renders.
//   The shipswift server rejects these probes with -32602 Invalid arguments,
//   polluting audit logs.
//
// What this proxy does:
//   - Acts as a JSON-RPC 2.0 / Streamable-HTTP relay to api.shipswift.app/mcp
//   - Intercepts `prompts/get` calls:
//     * If `arguments.feature` is missing, synthesize a placeholder
//       ("User feature (placeholder — please supply a real feature
//       description)") so the server returns a successful prompt render
//     * If `arguments.platform` is missing, default to "SwiftUI"
//     * For other prompts, pass arguments through unchanged
//   - Translates non-streaming JSON-RPC requests to the upstream server's
//     Streamable-HTTP transport (handles Mcp-Session-Id, SSE event framing)
//   - Returns the upstream's response to the caller
//
// Usage:
//   node ~/.mimocode/lib/shipswift-mcp-proxy.js [--port 7654] [--upstream https://api.shipswift.app/mcp]
//
// Configured for MiMo Code via ~/.local/share/mimocode/shared/mcp-config/mcp-servers.json
// (see deployment notes in ~/.local/share/mimocode/lib/shipswift-mcp-proxy.README.md)
//
// License: MIT

'use strict';

const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

const argv = process.argv.slice(2);
function getArg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}

const PORT = parseInt(getArg('port', process.env.SHIPSWIFT_PROXY_PORT || '7654'), 10);
const HOST = getArg('host', process.env.SHIPSWIFT_PROXY_HOST || '127.0.0.1');
const UPSTREAM = getArg('upstream', process.env.SHIPSWIFT_UPSTREAM || 'https://api.shipswift.app/mcp');

// ---------- prompt defaults (the actual bug fix) ----------

const PROMPT_DEFAULTS = {
  'build-feature': {
    feature: 'User feature (placeholder — please supply a real feature description)',
    platform: 'SwiftUI',
  },
  'explore-recipes': {
    projectType: 'iOS app',
  },
};

/**
 * Fill in missing required args for a prompt before forwarding upstream.
 * Mutates and returns the arguments object. Does not overwrite caller values.
 */
function fillPromptArgs(promptName, args) {
  const defaults = PROMPT_DEFAULTS[promptName];
  if (!defaults) return args;
  const out = { ...(args || {}) };
  for (const [k, v] of Object.entries(defaults)) {
    if (out[k] === undefined || out[k] === null || out[k] === '') {
      out[k] = v;
    }
  }
  return out;
}

// ---------- upstream relay (Streamable-HTTP transport) ----------

/**
 * Forward a JSON-RPC request to the upstream server.
 * Preserves the caller's Mcp-Session-Id if present, otherwise creates one.
 * Returns { status, headers, body (string), sse: boolean }
 */
async function relayToUpstream(jsonBody, callerHeaders) {
  const upstreamUrl = new URL(UPSTREAM);
  const isHttps = upstreamUrl.protocol === 'https:';
  const lib = isHttps ? require('https') : require('http');

  // Reuse session ID if caller passed one (keeps prompt/capability state coherent)
  const sessionId = callerHeaders['mcp-session-id'] || `proxy-${crypto.randomUUID()}`;

  const body = Buffer.from(JSON.stringify(jsonBody), 'utf8');

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Mcp-Session-Id': sessionId,
    'Content-Length': body.length,
  };

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method: 'POST',
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port || (isHttps ? 443 : 80),
        path: upstreamUrl.pathname + upstreamUrl.search,
        headers,
        timeout: 30000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks).toString('utf8');
          const ct = (res.headers['content-type'] || '').toLowerCase();
          resolve({
            status: res.statusCode,
            headers: { ...res.headers, 'mcp-session-id': sessionId },
            body: buf,
            sse: ct.includes('text/event-stream'),
          });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('upstream timeout'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Parse an SSE stream into an array of {event, data} objects.
 * Skips comments and heartbeats.
 */
function parseSSE(text) {
  const out = [];
  let event = 'message';
  let dataLines = [];
  for (const line of text.split(/\r?\n/)) {
    if (line === '') {
      if (dataLines.length > 0) {
        out.push({ event, data: dataLines.join('\n') });
      }
      event = 'message';
      dataLines = [];
      continue;
    }
    if (line.startsWith(':')) continue; // SSE comment / heartbeat
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon);
    let value = line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length > 0) {
    out.push({ event, data: dataLines.join('\n') });
  }
  return out;
}

// ---------- request handler ----------

/**
 * Handle one incoming JSON-RPC request body (string or already-parsed object).
 * Returns { status, contentType, body } for the HTTP response.
 */
async function handleRpc(rawBody, callerHeaders) {
  let rpc;
  try {
    rpc = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  } catch (e) {
    return jsonRpcError(null, -32700, 'Parse error: invalid JSON');
  }

  // Notifications have no `id` and expect 202 Accepted with empty body.
  if (rpc.id === undefined && rpc.method) {
    return { status: 202, contentType: 'application/json', body: '' };
  }

  // Intercept prompts/get — fill missing required args before forwarding.
  if (rpc.method === 'prompts/get' && rpc.params && rpc.params.name) {
    const original = rpc.params.arguments || {};
    const filled = fillPromptArgs(rpc.params.name, original);
    rpc = {
      ...rpc,
      params: { ...rpc.params, arguments: filled },
    };
  }

  // Forward to upstream
  let upstream;
  try {
    upstream = await relayToUpstream(rpc, callerHeaders);
  } catch (e) {
    return jsonRpcError(rpc.id ?? null, -32603, `Upstream relay error: ${e.message}`);
  }

  // Translate SSE response → JSON if caller didn't ask for stream
  const wantsStream = (callerHeaders['accept'] || '').includes('text/event-stream');

  if (upstream.sse) {
    const events = parseSSE(upstream.body);
    if (wantsStream) {
      // Pass-through SSE
      return {
        status: upstream.status,
        contentType: 'text/event-stream',
        body: upstream.body,
        extraHeaders: { 'mcp-session-id': upstream.headers['mcp-session-id'] },
      };
    }
    // Coalesce into a single JSON response (last data event)
    let lastData = null;
    for (const ev of events) {
      if (ev.event === 'message' && ev.data) {
        try {
          lastData = JSON.parse(ev.data);
        } catch {
          /* skip unparseable */
        }
      }
    }
    if (lastData !== null) {
      return {
        status: upstream.status,
        contentType: 'application/json',
        body: JSON.stringify(lastData),
        extraHeaders: { 'mcp-session-id': upstream.headers['mcp-session-id'] },
      };
    }
  }

  // Non-SSE upstream response — pass through
  return {
    status: upstream.status,
    contentType: upstream.headers['content-type'] || 'application/json',
    body: upstream.body,
    extraHeaders: { 'mcp-session-id': upstream.headers['mcp-session-id'] },
  };
}

function jsonRpcError(id, code, message) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    }),
  };
}

// ---------- HTTP server ----------

function createServer() {
  return http.createServer(async (req, res) => {
    // Health endpoint for ops
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        upstream: UPSTREAM,
        port: PORT,
        pid: process.pid,
        uptime: process.uptime(),
      }));
      return;
    }

    // Only POST to /mcp or / is meaningful
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'method not allowed; POST to /mcp' }));
      return;
    }

    // Normalize URL — accept /mcp, /, or anything else, all relay.
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        const result = await handleRpc(raw, req.headers);
        const headers = { 'Content-Type': result.contentType, ...(result.extraHeaders || {}) };
        res.writeHead(result.status, headers);
        res.end(result.body);
      } catch (e) {
        console.error('[proxy] internal error:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal proxy error' } }));
      }
    });
    req.on('error', (e) => {
      console.error('[proxy] request error:', e);
      res.writeHead(400);
      res.end();
    });
  });
}

// Only start listening when run as a script (not when imported as a module).
// This lets test suites import PROMPT_DEFAULTS / handleRpc without binding a port.
if (require.main === module) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    // When PORT=0 (ephemeral), print the actual bound port so test runners
    // can discover it from stdout.
    const boundPort = server.address() ? server.address().port : PORT;
    console.log(`[shipswift-mcp-proxy] listening on http://${HOST}:${boundPort} → ${UPSTREAM}`);
  });

  // Graceful shutdown
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log(`[shipswift-mcp-proxy] ${sig} received, shutting down`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 5000).unref();
    });
  }
}

module.exports = {
  fillPromptArgs,
  parseSSE,
  handleRpc,
  createServer,
  PROMPT_DEFAULTS,
  DEFAULT_PORT: PORT,
  DEFAULT_HOST: HOST,
  DEFAULT_UPSTREAM: UPSTREAM,
};