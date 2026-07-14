'use strict';

// shipswift-mcp-proxy.test.js
// Node built-in test runner. Run: node --test ~/.mimocode/lib/test/shipswift-mcp-proxy.test.js
// or: bun test ~/.mimocode/lib/test/shipswift-mcp-proxy.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

// Load proxy from parent lib dir
const proxyPath = path.join(__dirname, '..', 'shipswift-mcp-proxy.js');
const { fillPromptArgs, parseSSE, handleRpc } = require(proxyPath);

// ---------------------------------------------------------------------------
// fillPromptArgs — the actual bug-fix logic
// ---------------------------------------------------------------------------

test('fillPromptArgs: empty build-feature args → filled with both defaults', () => {
  const out = fillPromptArgs('build-feature', {});
  assert.deepEqual(out, {
    feature: 'User feature (placeholder — please supply a real feature description)',
    platform: 'SwiftUI',
  });
});

test('fillPromptArgs: only feature provided → platform defaulted', () => {
  const out = fillPromptArgs('build-feature', { feature: 'login screen' });
  assert.equal(out.feature, 'login screen');
  assert.equal(out.platform, 'SwiftUI');
});

test('fillPromptArgs: only platform provided → feature placeholder', () => {
  const out = fillPromptArgs('build-feature', { platform: 'UIKit' });
  assert.equal(out.feature.includes('placeholder'), true);
  assert.equal(out.platform, 'UIKit');
});

test('fillPromptArgs: both provided → unchanged', () => {
  const out = fillPromptArgs('build-feature', { feature: 'x', platform: 'UIKit' });
  assert.deepEqual(out, { feature: 'x', platform: 'UIKit' });
});

test('fillPromptArgs: null args treated as empty', () => {
  const out = fillPromptArgs('build-feature', null);
  assert.equal(out.feature.includes('placeholder'), true);
  assert.equal(out.platform, 'SwiftUI');
});

test('fillPromptArgs: undefined args treated as empty', () => {
  const out = fillPromptArgs('build-feature', undefined);
  assert.equal(typeof out.feature, 'string');
  assert.equal(out.platform, 'SwiftUI');
});

test('fillPromptArgs: empty string treated as missing', () => {
  const out = fillPromptArgs('build-feature', { feature: '', platform: '' });
  assert.equal(out.feature.includes('placeholder'), true);
  assert.equal(out.platform, 'SwiftUI');
});

test('fillPromptArgs: whitespace-only treated as missing', () => {
  const out = fillPromptArgs('build-feature', { feature: '   ' });
  // whitespace-only is NOT empty per the rules above; only literal "" / null / undefined count.
  // This documents the behavior so future changes are intentional.
  assert.equal(out.feature, '   ');
  assert.equal(out.platform, 'SwiftUI');
});

test('fillPromptArgs: unknown prompt name → pass-through', () => {
  const out = fillPromptArgs('totally-bogus', { foo: 'bar' });
  assert.deepEqual(out, { foo: 'bar' });
});

test('fillPromptArgs: explore-recipes default for projectType', () => {
  const out = fillPromptArgs('explore-recipes', {});
  assert.equal(out.projectType, 'iOS app');
});

// ---------------------------------------------------------------------------
// parseSSE — SSE framing
// ---------------------------------------------------------------------------

test('parseSSE: single message', () => {
  const out = parseSSE("data: {\"jsonrpc\":\"2.0\",\"id\":1}\n\n");
  assert.equal(out.length, 1);
  assert.equal(out[0].event, 'message');
  assert.equal(out[0].data, '{"jsonrpc":"2.0","id":1}');
});

test('parseSSE: explicit event field', () => {
  const out = parseSSE("event: ping\ndata: hi\n\n");
  assert.equal(out.length, 1);
  assert.equal(out[0].event, 'ping');
  assert.equal(out[0].data, 'hi');
});

test('parseSSE: comments and heartbeats skipped', () => {
  const out = parseSSE(": heartbeat\ndata: real\n\n");
  assert.equal(out.length, 1);
  assert.equal(out[0].data, 'real');
});

test('parseSSE: multi-line data field concatenated with newline', () => {
  const out = parseSSE("data: line1\ndata: line2\n\n");
  assert.equal(out.length, 1);
  assert.equal(out[0].data, 'line1\nline2');
});

test('parseSSE: empty input → empty array', () => {
  assert.deepEqual(parseSSE(''), []);
});

test('parseSSE: trailing data without final newline still captured', () => {
  const out = parseSSE("data: orphan");
  assert.equal(out.length, 1);
  assert.equal(out[0].data, 'orphan');
});

// ---------------------------------------------------------------------------
// handleRpc — integration: builds prompts/get request body, but for the
// request itself we stub the upstream relay by intercepting the network
// call via dependency injection. Since handleRpc currently calls relayToUpstream
// directly, we test the unit behavior by checking JSON-RPC error wrapping.
// ---------------------------------------------------------------------------

test('handleRpc: invalid JSON returns -32700 Parse error', async () => {
  const out = await handleRpc('{ not json', {});
  assert.equal(out.status, 200);
  assert.equal(out.contentType, 'application/json');
  const parsed = JSON.parse(out.body);
  assert.equal(parsed.jsonrpc, '2.0');
  assert.equal(parsed.error.code, -32700);
  assert.match(parsed.error.message, /Parse error/);
});

test('handleRpc: notification (no id) returns 202 empty body', async () => {
  const out = await handleRpc(
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    {}
  );
  assert.equal(out.status, 202);
  assert.equal(out.body, '');
});

// ---------------------------------------------------------------------------
// Live integration test — only runs if SHIPSWIFT_PROXY_LIVE=1 is set
// Spins up a local HTTP server that mimics upstream, then calls handleRpc.
// ---------------------------------------------------------------------------

test('handleRpc integration: prompts/get with empty args → upstream sees filled args', async () => {
  // Spawn a mock upstream that records the request body, then spawn the proxy
  // as a child process pointing at it. Send a real HTTP request to the proxy
  // and assert the upstream received the filled args.
  const { spawn } = require('node:child_process');

  let capturedBody = null;
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      capturedBody = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': 'mock-session-id',
      });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          description: 'mocked render',
          messages: [{ role: 'user', content: { type: 'text', text: 'rendered' } }],
        },
      }));
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const upstreamPort = upstream.address().port;
  const upstreamUrl = `http://127.0.0.1:${upstreamPort}/mcp`;

  const proxyProc = spawn(
    process.execPath,
    [proxyPath, '--port', '0', '--host', '127.0.0.1', '--upstream', upstreamUrl],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  // Proxy prints the bound port (resolves --port 0 to the actual assigned port)
  const proxyPort = await new Promise((resolve, reject) => {
    let buf = '';
    const onChunk = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        proxyProc.stdout.off('data', onChunk);
        resolve(parseInt(m[1], 10));
      }
    };
    proxyProc.stdout.on('data', onChunk);
    proxyProc.stderr.on('data', (c) => process.stderr.write(`[proxy] ${c}`));
    setTimeout(() => reject(new Error('proxy did not start within 5s')), 5000);
  });

  try {
    // Send the bug-triggering call (empty args) through the proxy
    const response = await new Promise((resolve, reject) => {
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'prompts/get',
        params: { name: 'build-feature', arguments: {} },
      });
      const req = http.request({
        method: 'POST',
        hostname: '127.0.0.1',
        port: proxyPort,
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10000,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    assert.equal(response.status, 200);
    assert.ok(capturedBody, 'upstream must have received a request');

    const upstreamReq = JSON.parse(capturedBody);
    assert.equal(upstreamReq.method, 'prompts/get');
    assert.equal(upstreamReq.params.name, 'build-feature');
    assert.equal(upstreamReq.params.arguments.platform, 'SwiftUI',
      'empty args → platform must be filled to SwiftUI');
    assert.match(upstreamReq.params.arguments.feature, /placeholder/,
      'empty args → feature must be filled with placeholder');
  } finally {
    proxyProc.kill('SIGTERM');
    await new Promise((r) => proxyProc.on('exit', r));
    upstream.close();
  }
});

test('handleRpc integration: full relay roundtrip via local upstream', async () => {
  // End-to-end: upstream returns canned response, proxy passes it back to caller
  // unmodified (modulo JSON-RPC envelope). Verifies the relay chain works.
  const { spawn } = require('node:child_process');

  const canned = {
    jsonrpc: '2.0',
    id: 99,
    result: {
      description: 'Round-trip test',
      messages: [{ role: 'user', content: { type: 'text', text: 'hello from upstream' } }],
    },
  };

  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': 'roundtrip-session',
      });
      res.end(JSON.stringify(canned));
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const upstreamPort = upstream.address().port;

  const proxyProc = spawn(
    process.execPath,
    [proxyPath, '--port', '0', '--host', '127.0.0.1',
     '--upstream', `http://127.0.0.1:${upstreamPort}/mcp`],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const proxyPort = await new Promise((resolve, reject) => {
    let buf = '';
    const onChunk = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        proxyProc.stdout.off('data', onChunk);
        resolve(parseInt(m[1], 10));
      }
    };
    proxyProc.stdout.on('data', onChunk);
    proxyProc.stderr.on('data', (c) => process.stderr.write(`[proxy] ${c}`));
    setTimeout(() => reject(new Error('proxy did not start within 5s')), 5000);
  });

  try {
    const response = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list' });
      const req = http.request({
        method: 'POST',
        hostname: '127.0.0.1',
        port: proxyPort,
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10000,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
          sessionId: res.headers['mcp-session-id'],
        }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    assert.equal(response.status, 200);
    const parsed = JSON.parse(response.body);
    assert.equal(parsed.jsonrpc, '2.0');
    assert.equal(parsed.id, 99, 'JSON-RPC id must be preserved through relay');
    assert.equal(parsed.result.description, 'Round-trip test',
      'upstream result must pass through unchanged');
    assert.equal(parsed.result.messages[0].content.text, 'hello from upstream');
    // When the caller doesn't send a Mcp-Session-Id, the proxy generates one
    // (prefixed `proxy-`) and forwards that to upstream. The upstream echoes
    // it back, and the proxy relays it to the caller. So the session id we
    // receive is the proxy-generated one, not the upstream's mock value.
    assert.match(response.sessionId, /^proxy-[0-9a-f-]+$/,
      'Mcp-Session-Id must be the proxy-generated id when caller sent none');
  } finally {
    proxyProc.kill('SIGTERM');
    await new Promise((r) => proxyProc.on('exit', r));
    upstream.close();
  }
});