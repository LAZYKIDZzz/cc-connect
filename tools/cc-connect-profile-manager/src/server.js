'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const { Store } = require('./store');
const { discovery, browseDirs } = require('./discovery');
const { platformList, getPlatform, coerceOptions } = require('./platforms');
const { agentList } = require('./agents');
const { loadCcConnectPresets } = require('./presets');
const { spawnInstance, stopInstance, waitForManagement, tailFile, streamLog } = require('./runtime');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function start({ home, port = 9876, noBrowser = false, ccConnectRoot = '' }) {
  const store = new Store(home);
  const ccPresetCache = { cached: null, ts: 0 };

  const loadCcPresets = () => {
    if (ccPresetCache.cached && Date.now() - ccPresetCache.ts < 60_000) return ccPresetCache.cached;
    const result = loadCcConnectPresets(ccConnectRoot);
    ccPresetCache.cached = result;
    ccPresetCache.ts = Date.now();
    return result;
  };

  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res, { store, loadCcPresets });
    } catch (err) {
      json(res, 500, { ok: false, error: err.message });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`cc-connect Profile Manager`);
    console.log(`  URL:           ${url}`);
    console.log(`  Profile home:  ${store.root}`);
    const cc = loadCcPresets();
    if (cc.root) console.log(`  cc-connect:    ${cc.root}  (${cc.providers.length} providers)`);
    else console.log(`  cc-connect:    (provider-presets.json not found; set --cc-connect-root or CC_CONNECT_ROOT)`);
    if (!noBrowser) openURL(url);
  });

  return server;
}

async function route(req, res, ctx) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const method = req.method || 'GET';

  // Static files
  if (method === 'GET' && url.pathname === '/') return serveStatic(res, 'index.html');
  if (method === 'GET' && url.pathname.startsWith('/static/')) {
    return serveStatic(res, url.pathname.replace(/^\/static\//, ''));
  }
  if (method === 'GET' && (url.pathname === '/styles.css' || url.pathname === '/app.js')) {
    return serveStatic(res, url.pathname.slice(1));
  }

  // API
  if (url.pathname === '/api/health' && method === 'GET') return json(res, 200, { ok: true, data: { name: 'ccpm' } });

  if (url.pathname === '/api/discovery' && method === 'GET') {
    const presets = ctx.loadCcPresets();
    return json(res, 200, { ok: true, data: { ...discovery(), cc_connect_root: presets.root } });
  }
  if (url.pathname === '/api/platforms' && method === 'GET') {
    return json(res, 200, { ok: true, data: { platforms: platformList(), agents: agentList() } });
  }
  if (url.pathname === '/api/platforms/schema' && method === 'GET') {
    const type = url.searchParams.get('type') || 'telegram';
    return json(res, 200, { ok: true, data: { schema: getPlatform(type) } });
  }
  if (url.pathname === '/api/cc-presets' && method === 'GET') {
    return json(res, 200, { ok: true, data: ctx.loadCcPresets() });
  }
  if (url.pathname === '/api/presets' && method === 'GET') {
    return json(res, 200, { ok: true, data: ctx.store.presets() });
  }
  if (url.pathname === '/api/presets' && method === 'PUT') {
    const body = await readJSON(req);
    return json(res, 200, { ok: true, data: ctx.store.savePresets(body) });
  }
  if (url.pathname === '/api/browse' && method === 'GET') {
    return json(res, 200, { ok: true, data: browseDirs(url.searchParams.get('path') || '') });
  }
  if (url.pathname === '/api/profiles' && method === 'GET') {
    return json(res, 200, { ok: true, data: { profiles: ctx.store.list() } });
  }
  if (url.pathname === '/api/profiles' && method === 'POST') {
    const body = await readJSON(req);
    body.platform = body.platform || {};
    body.platform.options = coerceOptions(body.platform.type || 'telegram', body.platform.options || {});
    return json(res, 200, { ok: true, data: { profile: ctx.store.save(body) } });
  }

  const m = url.pathname.match(/^\/api\/profiles\/([^/]+)(?:\/([^/]+))?$/);
  if (m) {
    const name = decodeURIComponent(m[1]);
    const action = m[2] || '';

    if (method === 'GET' && action === '') return json(res, 200, { ok: true, data: { profile: ctx.store.summary(name) } });
    if (method === 'PUT' && action === '') {
      const body = await readJSON(req);
      const existing = ctx.store.load(name);
      const merged = { ...existing, ...body, name };
      if (merged.platform) {
        merged.platform.options = coerceOptions(merged.platform.type || 'telegram', merged.platform.options || {});
      }
      return json(res, 200, { ok: true, data: { profile: ctx.store.save(merged) } });
    }
    if (method === 'DELETE' && action === '') {
      try { stopInstance(ctx.store, ctx.store.load(name)); } catch { /* ignore */ }
      ctx.store.remove(name);
      return json(res, 200, { ok: true, data: { removed: name } });
    }
    if (method === 'POST' && action === 'start') {
      const profile = ctx.store.load(name);
      ctx.store.writeConfig(profile);
      const { pid, alreadyRunning } = spawnInstance(ctx.store, profile);
      const probe = await waitForManagement(profile.management_port, profile.management_token, 4000);
      return json(res, 200, {
        ok: true,
        data: {
          profile: ctx.store.summary(name),
          spawned: !alreadyRunning,
          pid,
          health: probe.ok ? 'ready' : 'pending',
          health_reason: probe.ok ? '' : (probe.reason || 'unknown'),
          log_tail: probe.ok ? '' : tailFile(ctx.store.logPath(name), 30),
        },
      });
    }
    if (method === 'POST' && action === 'stop') {
      stopInstance(ctx.store, ctx.store.load(name));
      return json(res, 200, { ok: true, data: { profile: ctx.store.summary(name) } });
    }
    if (method === 'POST' && action === 'restart') {
      stopInstance(ctx.store, ctx.store.load(name));
      const profile = ctx.store.load(name);
      ctx.store.writeConfig(profile);
      const { pid } = spawnInstance(ctx.store, profile);
      const probe = await waitForManagement(profile.management_port, profile.management_token, 4000);
      return json(res, 200, { ok: true, data: { profile: ctx.store.summary(name), pid, health: probe.ok ? 'ready' : 'pending' } });
    }
    if (method === 'GET' && action === 'config') {
      try {
        return json(res, 200, { ok: true, data: { config: fs.readFileSync(ctx.store.configPath(name), 'utf8') } });
      } catch (err) {
        return json(res, 404, { ok: false, error: err.message });
      }
    }
    if (method === 'GET' && action === 'logs') {
      const n = Number(url.searchParams.get('n') || 200);
      return json(res, 200, { ok: true, data: { logs: tailFile(ctx.store.logPath(name), n) } });
    }
    if (method === 'GET' && action === 'stream') {
      return streamLogs(res, ctx.store.logPath(name));
    }
  }

  return json(res, 404, { ok: false, error: 'not found' });
}

function streamLogs(res, file) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(`retry: 2000\n\n`);

  // Send the initial tail so the client immediately sees recent context.
  const initial = tailFile(file, 200).split(/\r?\n/);
  for (const line of initial) {
    if (line === '') continue;
    res.write(`data: ${line}\n\n`);
  }

  const ctrl = new AbortController();
  const stop = streamLog(file, (line) => {
    res.write(`data: ${line}\n\n`);
  }, ctrl.signal);

  const keepAlive = setInterval(() => res.write(`: keep-alive\n\n`), 25_000);

  const done = () => {
    clearInterval(keepAlive);
    ctrl.abort();
    if (stop) stop();
    try { res.end(); } catch { /* ignore */ }
  };
  res.on('close', done);
  res.on('error', done);
}

function serveStatic(res, name) {
  const safe = name.replace(/\.\./g, '').replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) {
    return json(res, 403, { ok: false, error: 'forbidden' });
  }
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { ok: false, error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 1 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (err) { reject(new Error(`invalid JSON: ${err.message}`)); }
    });
    req.on('error', reject);
  });
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(payload)}\n`);
}

function openURL(url) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* ignore */ }
}

module.exports = { start };
