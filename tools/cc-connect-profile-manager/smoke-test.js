#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ccpm = path.join(__dirname, 'ccpm.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccpm-smoke-'));

function runCLI(args, opts = {}) {
  const result = spawnSync(process.execPath, [ccpm, ...args, '--home', root], { encoding: 'utf8', ...opts });
  if (!opts.allowFail && result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`ccpm ${args.join(' ')} exited with code ${result.status}`);
  }
  return result;
}

function mustContain(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`${label}: missing "${needle}"\n--- got ---\n${haystack}\n---`);
}

async function withServer(fn) {
  const port = 9876 + Math.floor(Math.random() * 200);
  const proc = spawn(process.execPath, [ccpm, 'serve', '--home', root, '--port', String(port), '--no-browser'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let ready = false;
  proc.stdout.on('data', (chunk) => { if (String(chunk).includes('URL:')) ready = true; });
  let errBuf = '';
  proc.stderr.on('data', (chunk) => { errBuf += String(chunk); });
  try {
    const deadline = Date.now() + 5000;
    while (!ready && Date.now() < deadline) await new Promise((r) => setTimeout(r, 80));
    if (!ready) throw new Error(`server failed to start: ${errBuf}`);
    await fn(port);
  } finally {
    proc.kill();
  }
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }); }
        catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

(async function main() {
  let ok = true;
  try {
    // 1. CLI: create a profile
    runCLI([
      'create', '--name', 'demo', '--work-dir', process.cwd(),
      '--agent', 'codex', '--mode', 'suggest',
      '--platform', 'telegram', '--platform-token', 'token-test',
      '--api-key', 'sk-test', '--model', 'gpt-test',
    ]);

    // 2. CLI: list shows the profile
    const list = runCLI(['list']);
    mustContain(list.stdout, 'demo', 'list output');

    // 3. CLI: config emits valid TOML
    const cfg = runCLI(['config', 'demo']);
    for (const needle of [
      'data_dir = ',
      '[management]',
      '[bridge]',
      '[[providers]]',
      'provider_refs = ["primary"]',
      '[projects.platforms]',
      'token = "token-test"',
    ]) mustContain(cfg.stdout, needle, 'config output');

    // 4. CLI: status shows mgmt URL
    const status = runCLI(['status', 'demo']);
    mustContain(status.stdout, 'Management URL:', 'status output');
    mustContain(status.stdout, 'Bridge URL:', 'status output');

    // 5. Server: discovery + presets + create + list work over HTTP
    await withServer(async (port) => {
      const disc = await fetchJSON(`http://127.0.0.1:${port}/api/discovery`);
      if (!disc.body.ok) throw new Error(`/api/discovery failed: ${disc.body.error}`);

      const platforms = await fetchJSON(`http://127.0.0.1:${port}/api/platforms`);
      if (!platforms.body.ok) throw new Error(`/api/platforms failed`);
      if (!Array.isArray(platforms.body.data.platforms) || !platforms.body.data.platforms.length) throw new Error('platforms list empty');

      const schema = await fetchJSON(`http://127.0.0.1:${port}/api/platforms/schema?type=feishu`);
      if (!schema.body.ok) throw new Error(`schema endpoint failed`);
      const keys = (schema.body.data.schema.fields || []).map((f) => f.key);
      if (!keys.includes('app_id') || !keys.includes('app_secret')) throw new Error('feishu schema missing app_id/app_secret');

      const profiles = await fetchJSON(`http://127.0.0.1:${port}/api/profiles`);
      if (!profiles.body.ok) throw new Error(`/api/profiles failed`);
      const names = (profiles.body.data.profiles || []).map((p) => p.name);
      if (!names.includes('demo')) throw new Error('demo profile missing from server list');
    });

    // 6. CLI: remove cleans up
    runCLI(['remove', 'demo']);
    const list2 = runCLI(['list']);
    if (list2.stdout.includes('demo')) throw new Error('remove did not remove the profile');

    console.log('ccpm smoke test passed');
  } catch (err) {
    console.error('SMOKE FAILED:', err.message);
    ok = false;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  if (!ok) process.exit(1);
})();
