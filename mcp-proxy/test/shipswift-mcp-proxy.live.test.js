'use strict';

// shipswift-mcp-proxy.live.test.js
// Runs a local mock upstream + the proxy, sends real HTTP, asserts end-to-end.
// No internet required.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const proxyPath = path.join(__dirname, '..', 'shipswift-mcp-proxy.js');
const { createServer } = require(proxyPath);

/**
 * Start a mock upstream that records every request body it sees and returns
 * the supplied canned response. Returns { url, server, requests }.
 */
async function startMockUpstream(cannedResponse) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': 'mock-session',
      });
      res.end(JSON.stringify(cannedResponse));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { url: `http://127.0.0.1:${port}/mcp`, server, requests };
}

/**
 * POST a JSON-RPC body to the proxy and return the parsed response.
 */
function callProxy(proxyPort, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      method: 'POST',
      hostname: '127.0.0.1',
      port: proxyPort,
      path: '/mcp',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': data.length,
        ...headers,
      },
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(text) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: text });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const CANNED_PROMPT_RESPONSE = {
  jsonrpc: '2.0',
  id: 1,
  result: {
    description: 'Build "rendered" using ShipSwift recipes (SwiftUI)',
    messages: [{ role: 'user', content: { type: 'text', text: 'rendered prompt' } }],
  },
};

test('live: empty prompts/get args → upstream receives filled args', async () => {
  // Build proxy with custom upstream
  process.env.SHIPSWIFT_UPSTREAM = 'http://placeholder/will-be-overridden-below';
  // Clear module cache so we get a fresh proxy with our env (the env-var reads happen at module load)
  delete require.cache[require.resolve(proxyPath)];
  const { createServer: makeProxy, DEFAULT_PORT } = (() => {
    delete require.cache[require.resolve(proxyPath)];
    return require(proxyPath);
  })();

  const upstream = await startMockUpstream(CANNED_PROMPT_RESPONSE);

  // Hack: re-require with custom upstream by patching the cached module's default.
  // Simpler: pass upstream URL via a special build. We'll just monkey-patch
  // the cached module's relayToUpstream by overriding require.cache.
  // Cleanest approach: spawn the proxy as a child process with --upstream flag.
  const { spawn } = require('node:child_process');
  const proxyProc = spawn(process.execPath, [
    proxyPath,
    '--port', '0', // ephemeral
    '--host', '127.0.0.1',
    '--upstream', upstream.url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  // Wait for the proxy to print its listening line
  const proxyPort = await new Promise((resolve, reject) => {
    let buf = '';
    proxyProc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) resolve(parseInt(m[1], 10));
    });
    proxyProc.stderr.on('data', (c) => process.stderr.write(`[proxy stderr] ${c}`));
    setTimeout(() => reject(new Error('proxy did not start in 5s')), 5000);
  });

  try {
    // Case: empty prompts/get → upstream should see filled args
    const resp = await callProxy(proxyPort, {
      jsonrpc: '2.0',
      id: 1,
      method: 'prompts/get',
      params: { name: 'build-feature', arguments: {} },
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.result.description, 'Build "rendered" using ShipSwift recipes (SwiftUI)');
    assert.equal(upstream.requests.length, 1);
    const upstreamReq = JSON.parse(upstream.requests[0].body);
    assert.equal(upstreamReq.method, 'prompts/get');
    assert.equal(upstreamReq.params.name, 'build-feature');
    assert.equal(upstreamReq.params.arguments.platform, 'SwiftUI');
    assert.match(upstreamReq.params.arguments.feature, /placeholder/);
  } finally {
    proxyProc.kill('SIGTERM');
    await new Promise((r) => proxyProc.on('exit', r));
    upstream.server.close();
  }
});

test('live: explicit UIKit is preserved (not overwritten to SwiftUI)', async () => {
  const upstream = await startMockUpstream(CANNED_PROMPT_RESPONSE);
  const { spawn } = require('node:child_process');
  const proxyProc = spawn(process.execPath, [
    proxyPath, '--port', '0', '--host', '127.0.0.1', '--upstream', upstream.url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const proxyPort = await new Promise((resolve) => {
    let buf = '';
    proxyProc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) resolve(parseInt(m[1], 10));
    });
  });

  try {
    const resp = await callProxy(proxyPort, {
      jsonrpc: '2.0', id: 1, method: 'prompts/get',
      params: { name: 'build-feature', arguments: { feature: 'x', platform: 'UIKit' } },
    });
    assert.equal(resp.status, 200);
    const upstreamReq = JSON.parse(upstream.requests[0].body);
    assert.equal(upstreamReq.params.arguments.platform, 'UIKit',
      'explicit platform must not be overwritten');
    assert.equal(upstreamReq.params.arguments.feature, 'x');
  } finally {
    proxyProc.kill('SIGTERM');
    await new Promise((r) => proxyProc.on('exit', r));
    upstream.server.close();
  }
});

test('live: non-prompt methods pass through unmodified', async () => {
  const upstream = await startMockUpstream({
    jsonrpc: '2.0', id: 1, result: { tools: [] },
  });
  const { spawn } = require('node:child_process');
  const proxyProc = spawn(process.execPath, [
    proxyPath, '--port', '0', '--host', '127.0.0.1', '--upstream', upstream.url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const proxyPort = await new Promise((resolve) => {
    let buf = '';
    proxyProc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) resolve(parseInt(m[1], 10));
    });
  });

  try {
    const resp = await callProxy(proxyPort, {
      jsonrpc: '2.0', id: 1, method: 'tools/list',
    });
    assert.equal(resp.status, 200);
    const upstreamReq = JSON.parse(upstream.requests[0].body);
    assert.equal(upstreamReq.method, 'tools/list');
    assert.deepEqual(upstreamReq.params, undefined);
  } finally {
    proxyProc.kill('SIGTERM');
    await new Promise((r) => proxyProc.on('exit', r));
    upstream.server.close();
  }
});