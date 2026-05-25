'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

function readPid(file) {
  try { return Number(fs.readFileSync(file, 'utf8').trim()) || 0; } catch { return 0; }
}

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function spawnInstance(store, profile, opts = {}) {
  const existing = readPid(store.pidPath(profile.name));
  if (existing > 0 && isPidAlive(existing)) return { pid: existing, alreadyRunning: true };

  fs.mkdirSync(store.logDir(profile.name), { recursive: true });
  const logFd = fs.openSync(store.logPath(profile.name), 'a');
  const bin = opts.bin || process.env.CC_CONNECT_BIN || 'cc-connect';

  const child = spawn(bin, ['--config', store.configPath(profile.name)], {
    cwd: store.dir(profile.name),
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      CC_LOG_FILE: store.logPath(profile.name),
      CC_LOG_MAX_SIZE: String(10 * 1024 * 1024),
    },
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(logFd);
  fs.writeFileSync(store.pidPath(profile.name), `${child.pid}\n`, { mode: 0o600 });
  fs.writeFileSync(store.startedAtPath(profile.name), new Date().toISOString(), { mode: 0o600 });
  return { pid: child.pid, alreadyRunning: false };
}

function stopInstance(store, profile) {
  const pid = readPid(store.pidPath(profile.name));
  if (pid > 0 && isPidAlive(pid)) {
    try { process.kill(pid); } catch (err) { if (err.code !== 'ESRCH') throw err; }
  }
  try { fs.unlinkSync(store.pidPath(profile.name)); } catch { /* gone */ }
  try { fs.unlinkSync(store.startedAtPath(profile.name)); } catch { /* gone */ }
}

function waitForManagement(port, token, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      probeManagement(port, token)
        .then((ok) => {
          if (ok) return resolve({ ok: true });
          if (Date.now() >= deadline) return resolve({ ok: false, reason: 'timeout' });
          setTimeout(attempt, 250);
        })
        .catch(() => {
          if (Date.now() >= deadline) return resolve({ ok: false, reason: 'timeout' });
          setTimeout(attempt, 250);
        });
    };
    attempt();
  });
}

function probeManagement(port, token) {
  return new Promise((resolve) => {
    const req = http.request({
      method: 'GET',
      hostname: '127.0.0.1',
      port,
      path: '/api/health',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      timeout: 600,
    }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function tailFile(file, count = 200) {
  if (!fs.existsSync(file)) return '';
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split(/\r?\n/);
  return `${lines.slice(-count).join('\n')}\n`;
}

function streamLog(file, onLine, signal) {
  if (!fs.existsSync(file)) {
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); } catch { /* ignore */ }
  }
  let position = 0;
  try { position = fs.statSync(file).size; } catch { position = 0; }

  let pending = '';
  let stopped = false;
  let timer = null;

  const cleanup = () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
  if (signal) {
    if (signal.aborted) cleanup();
    else signal.addEventListener('abort', cleanup, { once: true });
  }

  const pump = () => {
    if (stopped) return;
    let stat;
    try { stat = fs.statSync(file); } catch { return; }
    if (stat.size < position) position = 0; // log rotated/truncated
    if (stat.size === position) return;
    const stream = fs.createReadStream(file, { start: position, end: stat.size - 1, encoding: 'utf8' });
    stream.on('data', (chunk) => { pending += chunk; });
    stream.on('end', () => {
      position = stat.size;
      const segments = pending.split(/\r?\n/);
      pending = segments.pop() || '';
      for (const line of segments) {
        if (line === '' && !pending) continue;
        try { onLine(line); } catch { /* drop */ }
      }
    });
    stream.on('error', () => { /* swallow */ });
  };

  timer = setInterval(pump, 400);
  pump();
  return cleanup;
}

module.exports = { spawnInstance, stopInstance, waitForManagement, tailFile, streamLog, isPidAlive, readPid };
