#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_HOME = path.join(os.homedir(), '.cc-connect-profile-manager');
const DEFAULT_PORT = 9876;

function main(argv) {
  const command = argv[2] || 'serve';
  const args = parseArgs(argv.slice(3));

  try {
    if (command === 'help' || command === '--help' || command === '-h') {
      printHelp();
      return;
    }
    const store = new Store(args.home || process.env.CCPM_HOME || DEFAULT_HOME);
    switch (command) {
      case 'serve':
      case 'web':
        serve(store, Number(args.port || DEFAULT_PORT), Boolean(args['no-browser']));
        break;
      case 'list':
        printList(store);
        break;
      case 'create':
        createProfile(store, args);
        break;
      case 'start':
      case 'stop':
      case 'restart':
      case 'status':
      case 'logs':
      case 'config':
        profileCommand(store, command, args);
        break;
      default:
        throw new Error(`unknown command: ${command}`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

function parseArgs(items) {
  const out = { _: [] };
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item.startsWith('--')) {
      out._.push(item);
      continue;
    }
    const eq = item.indexOf('=');
    if (eq >= 0) {
      out[item.slice(2, eq)] = item.slice(eq + 1);
      continue;
    }
    const key = item.slice(2);
    if (i + 1 < items.length && !items[i + 1].startsWith('--')) {
      out[key] = items[i + 1];
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

class Store {
  constructor(root) {
    this.root = path.resolve(expandHome(root));
    this.profilesDir = path.join(this.root, 'profiles');
    this.presetsPath = path.join(this.root, 'presets.json');
    fs.mkdirSync(this.profilesDir, { recursive: true });
  }

  dir(name) {
    return path.join(this.profilesDir, sanitizeName(name));
  }

  profilePath(name) {
    return path.join(this.dir(name), 'profile.json');
  }

  configPath(name) {
    return path.join(this.dir(name), 'config.toml');
  }

  dataDir(name) {
    return path.join(this.dir(name), 'data');
  }

  logPath(name) {
    return path.join(this.dir(name), 'logs', 'cc-connect.log');
  }

  pidPath(name) {
    return path.join(this.dir(name), 'cc-connect.pid');
  }

  list() {
    if (!fs.existsSync(this.profilesDir)) return [];
    return fs.readdirSync(this.profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        try {
          return this.summary(entry.name);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  load(name) {
    const raw = fs.readFileSync(this.profilePath(name), 'utf8');
    return normalizeProfile(JSON.parse(raw));
  }

  save(profile) {
    const next = normalizeProfile(profile);
    if (!next.name) throw new Error('profile name is required');
    if (!next.work_dir) throw new Error('work_dir is required');
    fs.mkdirSync(path.join(this.dir(next.name), 'logs'), { recursive: true });
    fs.mkdirSync(this.dataDir(next.name), { recursive: true });
    const now = new Date().toISOString();
    if (!next.created_at) next.created_at = now;
    next.updated_at = now;
    fs.writeFileSync(this.profilePath(next.name), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    this.writeConfig(next);
    return this.summary(next.name);
  }

  writeConfig(profile) {
    const text = renderConfig(profile, this.dataDir(profile.name));
    fs.writeFileSync(this.configPath(profile.name), text, { mode: 0o600 });
  }

  summary(name) {
    const profile = this.load(name);
    const pid = readPid(this.pidPath(profile.name));
    return {
      ...profile,
      config_path: this.configPath(profile.name),
      data_dir: this.dataDir(profile.name),
      log_path: this.logPath(profile.name),
      pid,
      running: pid > 0 && isPidAlive(pid),
    };
  }

  start(name, ccConnectBin) {
    const profile = this.load(name);
    this.writeConfig(profile);
    const existing = readPid(this.pidPath(profile.name));
    if (existing > 0 && isPidAlive(existing)) return this.summary(profile.name);

    const logFd = fs.openSync(this.logPath(profile.name), 'a');
    const bin = ccConnectBin || process.env.CC_CONNECT_BIN || 'cc-connect';
    const child = spawn(bin, ['--config', this.configPath(profile.name)], {
      cwd: this.dir(profile.name),
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        CC_LOG_FILE: this.logPath(profile.name),
        CC_LOG_MAX_SIZE: String(10 * 1024 * 1024),
      },
      windowsHide: true,
    });
    child.unref();
    fs.closeSync(logFd);
    fs.writeFileSync(this.pidPath(profile.name), `${child.pid}\n`, { mode: 0o600 });
    return this.summary(profile.name);
  }

  stop(name) {
    const profile = this.load(name);
    const pid = readPid(this.pidPath(profile.name));
    if (pid > 0 && isPidAlive(pid)) {
      try {
        process.kill(pid);
      } catch (err) {
        if (err.code !== 'ESRCH') throw err;
      }
    }
    try {
      fs.unlinkSync(this.pidPath(profile.name));
    } catch {
      // already removed
    }
    return this.summary(profile.name);
  }

  presets() {
    const fallback = { providers: detectedProviders(), platforms: [] };
    if (!fs.existsSync(this.presetsPath)) return fallback;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.presetsPath, 'utf8'));
      return {
        providers: Array.isArray(parsed.providers) ? parsed.providers : fallback.providers,
        platforms: Array.isArray(parsed.platforms) ? parsed.platforms : [],
      };
    } catch {
      return fallback;
    }
  }

  savePresets(presets) {
    const next = {
      providers: Array.isArray(presets.providers) ? presets.providers : [],
      platforms: Array.isArray(presets.platforms) ? presets.platforms : [],
    };
    fs.mkdirSync(this.root, { recursive: true });
    fs.writeFileSync(this.presetsPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    return next;
  }
}

function normalizeProfile(profile) {
  const name = sanitizeName(profile.name || profile.project_name || 'profile');
  const basePort = profile.management_port || stablePort(name);
  return {
    name,
    project_name: profile.project_name || name,
    work_dir: expandHome(profile.work_dir || ''),
    agent_type: profile.agent_type || 'codex',
    agent_mode: profile.agent_mode || 'default',
    provider: {
      name: profile.provider?.name || 'primary',
      api_key: profile.provider?.api_key || '',
      base_url: profile.provider?.base_url || '',
      model: profile.provider?.model || '',
      env: profile.provider?.env || {},
    },
    platform: {
      type: profile.platform?.type || 'telegram',
      options: profile.platform?.options || {},
    },
    management_port: basePort,
    management_token: profile.management_token || token(name, 'management'),
    bridge_port: profile.bridge_port || basePort + 1000,
    bridge_token: profile.bridge_token || token(name, 'bridge'),
    language: profile.language || 'zh',
    log_level: profile.log_level || 'info',
    created_at: profile.created_at || '',
    updated_at: profile.updated_at || '',
  };
}

function profileFromArgs(args) {
  const name = args.name || args._[0] || '';
  const platformOptions = {};
  if (args['platform-token']) platformOptions.token = args['platform-token'];
  if (args.app_id) platformOptions.app_id = args.app_id;
  if (args.app_secret) platformOptions.app_secret = args.app_secret;
  if (args.allow_from) platformOptions.allow_from = args.allow_from;

  return normalizeProfile({
    name,
    project_name: args.project || name,
    work_dir: args['work-dir'] || args.work_dir || '',
    agent_type: args.agent || args.agent_type || 'codex',
    agent_mode: args.mode || 'default',
    provider: {
      name: args.provider || 'primary',
      api_key: args['api-key'] || '',
      base_url: args['base-url'] || '',
      model: args.model || '',
      env: parseJSON(args['provider-env'] || '{}'),
    },
    platform: {
      type: args.platform || 'telegram',
      options: { ...platformOptions, ...parseJSON(args['platform-options'] || '{}') },
    },
    management_port: Number(args['management-port'] || 0),
    bridge_port: Number(args['bridge-port'] || 0),
  });
}

function renderConfig(profile, dataDir) {
  const lines = [];
  lines.push('# Generated by cc-connect-profile-manager. This is a normal cc-connect config.');
  lines.push(`data_dir = ${tomlString(dataDir)}`);
  lines.push(`language = ${tomlString(profile.language)}`);
  lines.push('');
  lines.push('[log]');
  lines.push(`level = ${tomlString(profile.log_level)}`);
  lines.push('');
  lines.push('[management]');
  lines.push('enabled = true');
  lines.push(`port = ${profile.management_port}`);
  lines.push(`token = ${tomlString(profile.management_token)}`);
  lines.push('cors_origins = ["*"]');
  lines.push('');
  lines.push('[bridge]');
  lines.push('enabled = true');
  lines.push(`port = ${profile.bridge_port}`);
  lines.push(`token = ${tomlString(profile.bridge_token)}`);
  lines.push('cors_origins = ["*"]');
  lines.push('');
  lines.push('[[providers]]');
  lines.push(`name = ${tomlString(profile.provider.name)}`);
  if (profile.provider.api_key) lines.push(`api_key = ${tomlString(profile.provider.api_key)}`);
  if (profile.provider.base_url) lines.push(`base_url = ${tomlString(profile.provider.base_url)}`);
  if (profile.provider.model) lines.push(`model = ${tomlString(profile.provider.model)}`);
  appendMap(lines, 'providers.env', profile.provider.env);
  lines.push('');
  lines.push('[[projects]]');
  lines.push(`name = ${tomlString(profile.project_name)}`);
  lines.push('');
  lines.push('[projects.agent]');
  lines.push(`type = ${tomlString(profile.agent_type)}`);
  lines.push(`provider_refs = [${tomlString(profile.provider.name)}]`);
  lines.push('');
  lines.push('[projects.agent.options]');
  lines.push(`work_dir = ${tomlString(profile.work_dir)}`);
  lines.push(`mode = ${tomlString(profile.agent_mode)}`);
  lines.push(`provider = ${tomlString(profile.provider.name)}`);
  lines.push('');
  lines.push('[[projects.platforms]]');
  lines.push(`type = ${tomlString(profile.platform.type)}`);
  lines.push('');
  lines.push('[projects.platforms.options]');
  appendMap(lines, '', profile.platform.options);
  return `${lines.join('\n')}\n`;
}

function appendMap(lines, table, values) {
  const keys = Object.keys(values || {}).filter(Boolean).sort();
  if (!keys.length) return;
  if (table) lines.push(`[${table}]`);
  for (const key of keys) {
    lines.push(`${key} = ${tomlString(String(values[key]))}`);
  }
}

function serve(store, port, noBrowser) {
  const server = http.createServer(async (req, res) => {
    try {
      const body = await readBody(req);
      route(store, req, res, body);
    } catch (err) {
      json(res, 400, { ok: false, error: err.message });
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`cc-connect profile manager\n  URL:  ${url}\n  Home: ${store.root}`);
    if (!noBrowser) openURL(url);
  });
}

function route(store, req, res, body) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/') return html(res, APP_HTML_V2);
  if (url.pathname === '/api/discovery' && req.method === 'GET') {
    return json(res, 200, { ok: true, data: discovery() });
  }
  if (url.pathname === '/api/presets' && req.method === 'GET') {
    return json(res, 200, { ok: true, data: store.presets() });
  }
  if (url.pathname === '/api/presets' && req.method === 'PUT') {
    return json(res, 200, { ok: true, data: store.savePresets(JSON.parse(body || '{}')) });
  }
  if (url.pathname === '/api/browse' && req.method === 'GET') {
    return json(res, 200, { ok: true, data: browseDirs(url.searchParams.get('path') || '') });
  }
  if (url.pathname === '/api/profiles' && req.method === 'GET') {
    return json(res, 200, { ok: true, data: { profiles: store.list() } });
  }
  if (url.pathname === '/api/profiles' && req.method === 'POST') {
    return json(res, 200, { ok: true, data: { profile: store.save(JSON.parse(body || '{}')) } });
  }
  const match = url.pathname.match(/^\/api\/profiles\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return json(res, 404, { ok: false, error: 'not found' });
  const name = decodeURIComponent(match[1]);
  const action = match[2] || '';
  if (req.method === 'GET' && action === '') return json(res, 200, { ok: true, data: { profile: store.summary(name) } });
  if (req.method === 'PUT' && action === '') {
    const existing = store.load(name);
    const next = { ...existing, ...JSON.parse(body || '{}'), name };
    return json(res, 200, { ok: true, data: { profile: store.save(next) } });
  }
  if (req.method === 'POST' && action === 'start') return json(res, 200, { ok: true, data: { profile: store.start(name) } });
  if (req.method === 'POST' && action === 'stop') return json(res, 200, { ok: true, data: { profile: store.stop(name) } });
  if (req.method === 'POST' && action === 'restart') {
    store.stop(name);
    return json(res, 200, { ok: true, data: { profile: store.start(name) } });
  }
  if (req.method === 'GET' && action === 'config') {
    return json(res, 200, { ok: true, data: { config: fs.readFileSync(store.configPath(name), 'utf8') } });
  }
  if (req.method === 'GET' && action === 'logs') {
    return json(res, 200, { ok: true, data: { logs: tail(store.logPath(name), 180) } });
  }
  return json(res, 404, { ok: false, error: 'not found' });
}

function createProfile(store, args) {
  const profile = profileFromArgs(args);
  if (!profile.name || !profile.work_dir) throw new Error('--name and --work-dir are required');
  const saved = store.save(profile);
  console.log(`Created ${saved.name}`);
  console.log(`Config: ${saved.config_path}`);
}

function profileCommand(store, command, args) {
  const name = args._[0] || args.name;
  if (!name) throw new Error(`usage: ccpm ${command} <profile>`);
  if (command === 'start') console.log(JSON.stringify(store.start(name, args.bin), null, 2));
  if (command === 'stop') console.log(JSON.stringify(store.stop(name), null, 2));
  if (command === 'restart') {
    store.stop(name);
    console.log(JSON.stringify(store.start(name, args.bin), null, 2));
  }
  if (command === 'status') console.log(JSON.stringify(store.summary(name), null, 2));
  if (command === 'logs') process.stdout.write(tail(store.logPath(name), Number(args.n || 120)));
  if (command === 'config') process.stdout.write(fs.readFileSync(store.configPath(name), 'utf8'));
}

function printList(store) {
  for (const item of store.list()) {
    console.log(`${item.name.padEnd(22)} ${(item.running ? 'running' : 'stopped').padEnd(9)} ${item.agent_type.padEnd(10)} ${item.platform.type.padEnd(10)} ${item.work_dir}`);
  }
}

function printHelp() {
  console.log(`cc-connect-profile-manager

Usage:
  node ccpm.js serve [--port 9876]
  node ccpm.js create --name app --work-dir D:\\dev\\app --agent codex --platform telegram --platform-token xxx
  node ccpm.js list
  node ccpm.js start <name> [--bin cc-connect]
  node ccpm.js stop <name>
  node ccpm.js restart <name>
  node ccpm.js status <name>
  node ccpm.js logs <name>
  node ccpm.js config <name>

Options:
  --home DIR              Profile manager home, default ${DEFAULT_HOME}
  --provider NAME         Provider name, default primary
  --api-key KEY           Provider API key
  --base-url URL          Provider base URL
  --model MODEL           Provider model
  --platform TYPE         Platform type, default telegram
  --platform-token TOKEN  Common token option for token-based platforms
  --platform-options JSON Extra platform options
`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(payload)}\n`);
}

function html(res, text) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(text);
}

function tail(file, count) {
  if (!fs.existsSync(file)) return '';
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split(/\r?\n/);
  return `${lines.slice(-count).join('\n')}\n`;
}

function readPid(file) {
  try {
    return Number(fs.readFileSync(file, 'utf8').trim()) || 0;
  } catch {
    return 0;
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sanitizeName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_.-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '');
}

function stablePort(name) {
  let sum = 0;
  for (const char of name) sum += char.charCodeAt(0);
  return 9820 + (sum % 700);
}

function token(name, purpose) {
  return `${Date.now().toString(16)}-${sanitizeName(name)}-${purpose}`;
}

function tomlString(value) {
  return JSON.stringify(String(value || ''));
}

function parseJSON(value) {
  try {
    return JSON.parse(value || '{}');
  } catch (err) {
    throw new Error(`invalid JSON: ${err.message}`);
  }
}

function expandHome(value) {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function discovery() {
  return {
    home: os.homedir(),
    cwd: process.cwd(),
    roots: directoryRoots(),
    providers: detectedProviders(),
  };
}

function directoryRoots() {
  if (process.platform === 'win32') {
    const roots = [];
    for (let code = 67; code <= 90; code += 1) {
      const root = `${String.fromCharCode(code)}:\\`;
      if (fs.existsSync(root)) roots.push(root);
    }
    return roots;
  }
  return ['/', os.homedir()].filter((item, index, arr) => arr.indexOf(item) === index);
}

function browseDirs(input) {
  const target = path.resolve(expandHome(input || os.homedir()));
  const parent = path.dirname(target);
  const entries = [];
  if (target !== parent) entries.push({ name: '..', path: parent, parent: true });
  try {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') && entry.name !== '.config') continue;
      entries.push({ name: entry.name, path: path.join(target, entry.name) });
    }
  } catch (err) {
    return { path: target, entries, error: err.message };
  }
  entries.sort((a, b) => Number(Boolean(b.parent)) - Number(Boolean(a.parent)) || a.name.localeCompare(b.name));
  return { path: target, entries };
}

function detectedProviders() {
  const providers = [];
  const codexConfig = path.join(os.homedir(), '.codex', 'config.toml');
  if (fs.existsSync(codexConfig)) {
    const text = fs.readFileSync(codexConfig, 'utf8');
    const model = matchFirst(text, /^\s*model\s*=\s*"([^"]+)"/m);
    const provider = matchFirst(text, /^\s*model_provider\s*=\s*"([^"]+)"/m) || matchFirst(text, /^\s*provider\s*=\s*"([^"]+)"/m);
    const baseUrl = matchFirst(text, /^\s*base_url\s*=\s*"([^"]+)"/m);
    providers.push({
      name: provider || 'codex-local',
      label: provider ? `Codex: ${provider}` : 'Codex local config',
      agent_type: 'codex',
      model: model || '',
      base_url: baseUrl || '',
      source: codexConfig,
    });
  }
  const claudeSettings = path.join(os.homedir(), '.claude.json');
  if (fs.existsSync(claudeSettings)) {
    providers.push({
      name: 'claude-local',
      label: 'Claude Code local config',
      agent_type: 'claudecode',
      model: '',
      source: claudeSettings,
    });
  }
  pushEnvProvider(providers, {
    key: 'OPENAI_API_KEY',
    name: 'openai-env',
    label: 'OpenAI API Key',
    agent_type: 'codex',
    base_url: process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || '',
  });
  pushEnvProvider(providers, {
    key: 'ANTHROPIC_API_KEY',
    name: 'anthropic-env',
    label: 'Anthropic API Key',
    agent_type: 'claudecode',
    base_url: process.env.ANTHROPIC_BASE_URL || '',
  });
  pushEnvProvider(providers, {
    key: 'GEMINI_API_KEY',
    name: 'gemini-env',
    label: 'Gemini API Key',
    agent_type: 'gemini',
    base_url: '',
  });
  return providers;
}

function pushEnvProvider(providers, item) {
  const value = process.env[item.key];
  if (!value) return;
  providers.push({
    name: item.name,
    label: `${item.label} (${item.key})`,
    agent_type: item.agent_type,
    api_key: value,
    base_url: item.base_url || '',
    model: '',
    source: `env:${item.key}`,
  });
}

function matchFirst(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1] : '';
}

function openURL(url) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch {
    // URL is already printed.
  }
}

const APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>cc-connect Profile Manager</title>
<style>
:root{--ink:#17201b;--muted:#637169;--line:#d8ddd8;--paper:#f7f6ef;--panel:#eeede3;--accent:#b43d2a;--ok:#1f6f63}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Segoe UI,system-ui,sans-serif}
button,input,select,textarea{font:inherit} .shell{display:grid;grid-template-columns:320px 1fr;min-height:100vh}
aside{padding:20px;background:#ebe9dc;border-right:1px solid var(--line)}main{padding:22px;min-width:0}
h1{font-size:22px;margin:0 0 8px}h2{font-size:18px;margin:0}.sub{font-size:13px;color:var(--muted);line-height:1.45}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}button{border:1px solid var(--ink);background:var(--ink);color:var(--paper);padding:8px 11px;border-radius:6px;cursor:pointer}
button.secondary{background:transparent;color:var(--ink)}button.danger{background:var(--accent);border-color:var(--accent)}button:disabled{opacity:.45}
.list{display:grid;gap:8px}.profile{width:100%;text-align:left;background:transparent;color:var(--ink);border-color:var(--line);display:grid;gap:3px}.profile.active{border-color:var(--ink);background:#f8f7f0}
.name-row{display:flex;justify-content:space-between;gap:10px;align-items:center}.pill{font-size:11px;border:1px solid var(--line);border-radius:999px;padding:2px 7px;color:var(--muted);white-space:nowrap}.pill.run{color:var(--ok)}
.band{border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:16px;margin-bottom:14px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.field{display:grid;gap:5px}label{font-size:12px;color:var(--muted)}
input,select,textarea{width:100%;border:1px solid var(--line);background:#fbfaf4;color:var(--ink);border-radius:6px;padding:9px 10px}textarea{min-height:116px;font-family:Cascadia Code,Consolas,monospace;font-size:12px}
pre{overflow:auto;max-height:360px;background:#20241f;color:#f2f0e6;border-radius:8px;padding:14px;font-size:12px;line-height:1.45}.tabs{display:flex;gap:6px;margin-bottom:10px}.tab{background:transparent;color:var(--ink);border-color:var(--line)}.tab.active{border-color:var(--ink)}
.empty{padding:28px 0;color:var(--muted)}@media(max-width:860px){.shell{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid var(--line)}.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="shell"><aside><h1>cc-connect Profiles</h1><div class="sub">Standalone helper. Generates normal cc-connect configs and starts instances with cc-connect --config.</div><div class="toolbar"><button onclick="newProfile()">New</button><button class="secondary" onclick="loadProfiles()">Refresh</button></div><div id="profiles" class="list"></div></aside><main><div id="editor" class="empty">Select a profile or create a new one.</div></main></div>
<script>
let profiles=[],selected=null,tab='config';
async function api(path,opts){const r=await fetch(path,Object.assign({headers:{'content-type':'application/json'}},opts||{}));const j=await r.json();if(!j.ok)throw new Error(j.error||'request failed');return j.data}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function id(x){return document.getElementById(x)}
async function loadProfiles(){const d=await api('/api/profiles');profiles=d.profiles||[];renderList();if(selected){const f=profiles.find(p=>p.name===selected.name);if(f){selected=f;renderEditor()}}}
function renderList(){id('profiles').innerHTML=profiles.length?profiles.map(p=>'<button class="profile '+(selected&&selected.name===p.name?'active':'')+'" onclick="selectProfile(&quot;'+esc(p.name)+'&quot;)"><span class="name-row"><strong>'+esc(p.name)+'</strong><span class="pill '+(p.running?'run':'')+'">'+(p.running?'running':'stopped')+'</span></span><span class="sub">'+esc(p.agent_type)+' / '+esc(p.provider.name)+' / '+esc(p.platform.type)+'</span></button>').join(''):'<div class="empty">No profiles yet.</div>'}
function selectProfile(n){selected=profiles.find(p=>p.name===n);tab='config';renderList();renderEditor()}
function newProfile(){selected={name:'',project_name:'',work_dir:'',agent_type:'codex',provider:{name:'primary',api_key:'',base_url:'',model:'',env:{}},platform:{type:'telegram',options:{}},log_level:'info'};renderEditor()}
function opts(items,val){return items.map(x=>'<option '+(x===val?'selected':'')+'>'+x+'</option>').join('')}
function renderEditor(){const p=selected;if(!p)return;id('editor').innerHTML='<div class="band"><h2>'+esc(p.name||'New profile')+'</h2><div class="toolbar"><button onclick="saveProfile()">Save</button><button onclick="action(\\'start\\')" '+(p.running?'disabled':'')+'>Start</button><button class="secondary" onclick="action(\\'restart\\')">Restart</button><button class="danger" onclick="action(\\'stop\\')" '+(!p.running?'disabled':'')+'>Stop</button></div></div><div class="band"><div class="grid"><div class="field"><label>Profile name</label><input id="name" value="'+esc(p.name)+'" '+(p.config_path?'disabled':'')+'></div><div class="field"><label>Project name</label><input id="project" value="'+esc(p.project_name||p.name)+'"></div><div class="field"><label>Work directory</label><input id="work" value="'+esc(p.work_dir)+'"></div><div class="field"><label>Agent</label><select id="agent">'+opts(['codex','claudecode','cursor','gemini','opencode','qoder','iflow','kimi','acp'],p.agent_type)+'</select></div><div class="field"><label>Provider</label><input id="provider" value="'+esc(p.provider?.name||'primary')+'"></div><div class="field"><label>Model</label><input id="model" value="'+esc(p.provider?.model||'')+'"></div><div class="field"><label>Base URL</label><input id="base" value="'+esc(p.provider?.base_url||'')+'"></div><div class="field"><label>API Key</label><input id="key" type="password" value="'+esc(p.provider?.api_key||'')+'"></div><div class="field"><label>Platform</label><select id="platform">'+opts(['telegram','feishu','weixin','slack','discord','dingtalk','wecom','qq','qqbot','line','weibo'],p.platform?.type||'telegram')+'</select></div><div class="field"><label>Log level</label><select id="log">'+opts(['info','debug','warn','error'],p.log_level||'info')+'</select></div></div><div class="grid" style="margin-top:12px"><div class="field"><label>Platform options JSON</label><textarea id="platopts">'+esc(JSON.stringify(p.platform?.options||{},null,2))+'</textarea></div><div class="field"><label>Provider env JSON</label><textarea id="envopts">'+esc(JSON.stringify(p.provider?.env||{},null,2))+'</textarea></div></div></div><div class="band"><div class="tabs"><button class="tab '+(tab==='config'?'active':'')+'" onclick="show(\\'config\\')">config.toml</button><button class="tab '+(tab==='logs'?'active':'')+'" onclick="show(\\'logs\\')">logs</button></div><pre id="pane">Save to generate config.</pre></div>';loadPane()}
function collect(){return{name:id('name').value.trim(),project_name:id('project').value.trim(),work_dir:id('work').value.trim(),agent_type:id('agent').value,provider:{name:id('provider').value.trim()||'primary',api_key:id('key').value,base_url:id('base').value.trim(),model:id('model').value.trim(),env:JSON.parse(id('envopts').value||'{}')},platform:{type:id('platform').value,options:JSON.parse(id('platopts').value||'{}')},log_level:id('log').value}}
async function saveProfile(){try{const p=collect();if(!p.name||!p.work_dir)throw new Error('name and work_dir are required');if(selected.config_path)await api('/api/profiles/'+encodeURIComponent(selected.name),{method:'PUT',body:JSON.stringify(p)});else await api('/api/profiles',{method:'POST',body:JSON.stringify(p)});await loadProfiles();selected=profiles.find(x=>x.name===p.name);renderEditor()}catch(e){alert(e.message)}}
async function action(a){try{if(!selected.name)throw new Error('save first');await api('/api/profiles/'+encodeURIComponent(selected.name)+'/'+a,{method:'POST'});setTimeout(loadProfiles,700)}catch(e){alert(e.message)}}
function show(x){tab=x;renderEditor()}async function loadPane(){if(!selected?.config_path)return;try{const d=await api('/api/profiles/'+encodeURIComponent(selected.name)+'/'+tab);id('pane').textContent=tab==='logs'?(d.logs||''):(d.config||'')}catch(e){id('pane').textContent=e.message}}
loadProfiles().catch(e=>alert(e.message))
</script>
</body>
</html>`;

const APP_HTML_V2 = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>cc-connect Profile Manager</title>
<style>
:root{--bg:#eef3ef;--ink:#17201a;--muted:#607066;--line:#cbd8cf;--panel:#fbfcf7;--soft:#e3ece5;--deep:#1f5b49;--deep2:#153d34;--blue:#315f8f;--red:#b44a38;--amber:#a66f25;--shadow:0 18px 55px rgba(24,48,36,.14)}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 12% 10%,#ddebe0 0,#eef3ef 34%,#f7f8f3 100%);color:var(--ink);font-family:"Segoe UI",system-ui,sans-serif;letter-spacing:0}
button,input,select,textarea{font:inherit}button{border:0;border-radius:7px;background:var(--ink);color:#f7fbf4;padding:9px 13px;cursor:pointer;transition:transform .16s ease,background .16s ease,opacity .16s ease,box-shadow .16s ease}button:hover{transform:translateY(-1px);box-shadow:0 10px 24px rgba(23,32,26,.12)}button:disabled{opacity:.42;cursor:not-allowed;transform:none;box-shadow:none}
.ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1px var(--line)}.ghost:hover{background:#f8faf5}.quiet{background:var(--soft);color:var(--ink)}.danger{background:var(--red)}.primary{background:var(--deep)}
.app{display:grid;grid-template-columns:332px minmax(0,1fr);min-height:100vh}.rail{padding:22px;background:linear-gradient(180deg,#dfe9e2,#eef3ef);border-right:1px solid var(--line)}.main{padding:24px;min-width:0}.brand{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}.brand h1{font-size:22px;margin:0}.brand p{margin:6px 0 0;color:var(--muted);font-size:13px;line-height:1.45}.actions{display:flex;gap:8px;flex-wrap:wrap}.profile-list{display:grid;gap:9px;margin-top:14px}
.profile{width:100%;text-align:left;background:rgba(251,252,247,.72);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:12px;display:grid;gap:5px}.profile.active{background:var(--panel);border-color:var(--deep2);box-shadow:var(--shadow)}.row{display:flex;align-items:center;justify-content:space-between;gap:10px}.meta{color:var(--muted);font-size:12px;line-height:1.45}.clip{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pill{font-size:11px;border:1px solid var(--line);border-radius:999px;padding:2px 8px;color:var(--muted);white-space:nowrap}.pill.run{color:var(--deep);border-color:#8bb5a5;background:#edf7f1}.pill.warn{color:var(--amber)}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 370px;gap:18px}.band{background:rgba(251,252,247,.9);border:1px solid var(--line);border-radius:10px;padding:18px;box-shadow:var(--shadow)}.band.soft{box-shadow:none;background:rgba(251,252,247,.62)}.title{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:16px}.title h2{font-size:22px;margin:0}.title p{margin:5px 0 0;color:var(--muted);font-size:13px}
.steps{display:grid;gap:12px}.step{display:grid;grid-template-columns:42px 1fr;gap:13px;padding:15px;border:1px solid var(--line);border-radius:9px;background:linear-gradient(180deg,#ffffff,#f6faf5)}.step-num{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--deep2);color:#f7fbf4;font-weight:700}.step h3{margin:0 0 8px;font-size:15px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.field{display:grid;gap:5px}label{font-size:12px;color:var(--muted)}input,select,textarea{width:100%;border:1px solid var(--line);background:#fefffb;color:var(--ink);border-radius:7px;padding:9px 10px;outline:none}input:focus,select:focus,textarea:focus{border-color:var(--deep);box-shadow:0 0 0 3px rgba(31,91,73,.13)}input[disabled]{background:#edf2ee;color:#6a766d}textarea{min-height:96px;font-family:"Cascadia Code",Consolas,monospace;font-size:12px;resize:vertical}
.choice-row{display:flex;gap:8px;flex-wrap:wrap}.choice{background:#e7efe8;color:var(--ink);display:flex;align-items:center;gap:7px}.choice:hover{background:#dce9df}.choice.selected{background:var(--deep);color:#f7fbf4}.browser{margin-top:10px;border:1px solid var(--line);border-radius:8px;background:#fbfdf8;max-height:235px;overflow:auto}.dir{display:flex;width:100%;align-items:center;justify-content:space-between;gap:10px;text-align:left;background:transparent;color:var(--ink);border-radius:0;border-bottom:1px solid #e6eee8}.dir:hover{background:#edf5ef}.dir-head{position:sticky;top:0;background:#f5faf6;z-index:1}
details{margin-top:12px;border:1px solid var(--line);border-radius:9px;background:#f7faf6;padding:12px}summary{cursor:pointer;color:var(--ink);font-size:13px}.tabs{display:flex;gap:7px;margin-bottom:10px}.tab{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1px var(--line)}.tab.active{box-shadow:inset 0 0 0 1px var(--deep);background:#edf6ef}pre{margin:0;max-height:360px;overflow:auto;background:#17201a;color:#eff8ec;border-radius:8px;padding:14px;font-size:12px;line-height:1.45}.empty{color:var(--muted);padding:30px 0}.hint{font-size:12px;color:var(--muted);margin-top:7px}
.drawer-mask{position:fixed;inset:0;background:rgba(20,31,25,.24);opacity:0;pointer-events:none;transition:opacity .18s ease}.drawer-mask.show{opacity:1;pointer-events:auto}.drawer{position:fixed;top:0;right:0;width:min(560px,100vw);height:100vh;background:#fbfcf7;border-left:1px solid var(--line);box-shadow:-18px 0 55px rgba(24,48,36,.18);transform:translateX(100%);transition:transform .22s ease;display:grid;grid-template-rows:auto 1fr}.drawer.show{transform:translateX(0)}.drawer-head{padding:18px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:14px}.drawer-body{padding:18px;overflow:auto}.preset-card{border:1px solid var(--line);border-radius:8px;padding:11px;background:#fff;display:grid;gap:5px;margin-top:8px}.toast{position:fixed;right:20px;bottom:20px;background:var(--ink);color:#f7fbf4;border-radius:8px;padding:11px 14px;opacity:0;transform:translateY(10px);transition:.22s ease}.toast.show{opacity:1;transform:translateY(0)}
@media(max-width:1080px){.app{grid-template-columns:1fr}.rail{border-right:0;border-bottom:1px solid var(--line)}.layout{grid-template-columns:1fr}.grid{grid-template-columns:1fr}.main{padding:16px}}
</style>
</head>
<body>
<div class="app">
  <aside class="rail">
    <div class="brand"><div><h1>cc-connect Profiles</h1><p>项目、AI Provider、移动端入口分开管理。</p></div><button class="primary" onclick="newProfile()">新建</button></div>
    <div class="actions"><button class="ghost" onclick="loadAll()">刷新</button><button class="ghost" onclick="openPresets()">预设库</button></div>
    <div id="profiles" class="profile-list"></div>
  </aside>
  <main class="main"><div id="editor" class="empty">选择一个 profile，或新建配置。</div></main>
</div>
<div id="mask" class="drawer-mask" onclick="closePresets()"></div>
<aside id="drawer" class="drawer"></aside>
<div id="toast" class="toast"></div>
<script>
let profiles=[],selected=null,presets={providers:[],platforms:[]},discovery={roots:[],providers:[]},tab='config',browseOpen=false,browsePath='';
const AGENTS=['codex','claudecode','cursor','gemini','opencode','qoder','iflow','kimi','acp'];
const PLATFORMS=['telegram','feishu','weixin','slack','discord','dingtalk','wecom','qq','qqbot','line','weibo'];
async function api(path,opts){const r=await fetch(path,Object.assign({headers:{'content-type':'application/json'}},opts||{}));const j=await r.json();if(!j.ok)throw new Error(j.error||'request failed');return j.data}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function id(x){return document.getElementById(x)}
function toast(msg){const t=id('toast');t.textContent=msg;t.classList.add('show');setTimeout(function(){t.classList.remove('show')},1800)}
function opts(items,val){return items.map(function(x){return '<option '+(x===val?'selected':'')+'>'+esc(x)+'</option>'}).join('')}
function statusText(p){return p.running?'运行中':'已停止'}
async function loadAll(){discovery=await api('/api/discovery');presets=await api('/api/presets');const d=await api('/api/profiles');profiles=d.profiles||[];if(selected&&selected.name){const f=profiles.find(function(p){return p.name===selected.name});if(f)selected=f}renderList();renderEditor()}
function renderList(){id('profiles').innerHTML=profiles.length?profiles.map(function(p){return '<button class="profile '+(selected&&selected.name===p.name?'active':'')+'" onclick="selectProfile(&quot;'+esc(p.name)+'&quot;)"><span class="row"><strong>'+esc(p.name)+'</strong><span class="pill '+(p.running?'run':'warn')+'">'+statusText(p)+'</span></span><span class="meta clip">'+esc(p.work_dir||'未设置目录')+'</span><span class="meta">'+esc(p.agent_type)+' / '+esc(p.provider.name)+' / '+esc(p.platform.type)+'</span></button>'}).join(''):'<div class="empty">暂无 profile。</div>'}
function selectProfile(n){selected=profiles.find(function(p){return p.name===n});tab='config';browseOpen=false;renderList();renderEditor()}
function newProfile(){selected={name:'',project_name:'',work_dir:'',agent_type:'codex',agent_mode:'default',provider:{name:'primary',api_key:'',base_url:'',model:'',env:{}},platform:{type:'telegram',options:{}},language:'zh',log_level:'info'};tab='config';browseOpen=false;renderList();renderEditor()}
function safeJson(name,label){try{return JSON.parse(id(name).value||'{}')}catch(e){throw new Error(label+' 不是有效 JSON')}}
function collect(){return{name:id('name').value.trim(),project_name:id('project').value.trim(),work_dir:id('work').value.trim(),agent_type:id('agent').value,agent_mode:'default',provider:{name:id('provider').value.trim()||'primary',api_key:id('key').value,base_url:id('base').value.trim(),model:id('model').value.trim(),env:safeJson('envopts','Provider env')},platform:{type:id('platform').value,options:safeJson('platopts','Platform options')},language:id('language').value,log_level:id('log').value}}
function syncSelected(){if(!selected||!id('name'))return;try{const next=collect();selected=Object.assign({},selected,next)}catch(e){}}
function providerPool(){return [].concat(presets.providers||[],discovery.providers||[])}
function applyProvider(i){syncSelected();const p=providerPool()[i];if(!p||!selected)return;selected.agent_type=p.agent_type||selected.agent_type;selected.provider={name:p.name||'primary',api_key:p.api_key||'',base_url:p.base_url||'',model:p.model||'',env:p.env||{}};renderEditor();toast('Provider 已套用')}
function applyPlatform(i){syncSelected();const p=(presets.platforms||[])[i];if(!p||!selected)return;selected.platform={type:p.type||'telegram',options:p.options||{}};renderEditor();toast('平台预设已套用')}
function providerChoices(){const all=providerPool();return all.length?'<div class="choice-row">'+all.map(function(p,i){return '<button class="choice" onclick="applyProvider('+i+')">'+esc(p.label||p.name)+'<span class="pill">'+esc(p.agent_type||'')+'</span></button>'}).join('')+'</div>':'<div class="hint">未发现本机 Agent 配置，可手动填写或在预设库添加。</div>'}
function platformChoices(){const all=presets.platforms||[];return all.length?'<div class="choice-row">'+all.map(function(p,i){return '<button class="choice" onclick="applyPlatform('+i+')">'+esc(p.label||p.name||p.type)+'<span class="pill">'+esc(p.type||'')+'</span></button>'}).join('')+'</div>':'<div class="hint">先在预设库维护平台凭据，这里就只需选择。</div>'}
function renderEditor(){if(!selected)return;const p=selected;id('editor').innerHTML='<div class="layout"><section><div class="band"><div class="title"><div><h2>'+esc(p.name||'新建 Profile')+'</h2><p>常用路径只保留三项，高级参数默认收起。</p></div><div class="actions"><button class="primary" onclick="saveProfile()">保存</button><button class="ghost" onclick="action(\\'start\\')" '+(p.running?'disabled':'')+'>启动</button><button class="ghost" onclick="action(\\'restart\\')">重启</button><button class="danger" onclick="action(\\'stop\\')" '+(!p.running?'disabled':'')+'>停止</button></div></div><div class="steps">'+stepProject(p)+stepProvider(p)+stepPlatform(p)+'</div>'+advanced(p)+'</div></section><aside>'+sidePane(p)+'</aside></div>';loadPane()}
function stepProject(p){return '<div class="step"><div class="step-num">1</div><div><h3>项目</h3><div class="grid"><div class="field"><label>Profile 名称</label><input id="name" value="'+esc(p.name)+'" '+(p.config_path?'disabled':'')+'></div><div class="field"><label>cc-connect 项目名</label><input id="project" value="'+esc(p.project_name||p.name)+'"></div></div><div class="field" style="margin-top:10px"><label>项目路径</label><div style="display:flex;gap:8px"><input id="work" value="'+esc(p.work_dir)+'"><button class="ghost" onclick="toggleBrowse()">选择目录</button></div></div><div id="browserSlot">'+(browseOpen?'<div class="browser" id="browser">加载中...</div>':'')+'</div></div></div>'}
function stepProvider(p){return '<div class="step"><div class="step-num">2</div><div><h3>AI Provider</h3>'+providerChoices()+'<div class="grid" style="margin-top:10px"><div class="field"><label>Agent</label><select id="agent">'+opts(AGENTS,p.agent_type||'codex')+'</select></div><div class="field"><label>Provider 名称</label><input id="provider" value="'+esc(p.provider?.name||'primary')+'"></div><div class="field"><label>API Key</label><input id="key" type="password" value="'+esc(p.provider?.api_key||'')+'" placeholder="可从本机环境或预设带入"></div><div class="field"><label>Model</label><input id="model" value="'+esc(p.provider?.model||'')+'"></div><div class="field" style="grid-column:1/-1"><label>Base URL</label><input id="base" value="'+esc(p.provider?.base_url||'')+'"></div></div></div></div>'}
function stepPlatform(p){return '<div class="step"><div class="step-num">3</div><div><h3>移动端平台</h3>'+platformChoices()+'<div class="grid" style="margin-top:10px"><div class="field"><label>平台类型</label><select id="platform">'+opts(PLATFORMS,p.platform?.type||'telegram')+'</select></div><div class="field"><label>当前凭据摘要</label><input disabled value="'+esc(Object.keys(p.platform?.options||{}).join(', ')||'未配置')+'"></div></div></div></div>'}
function advanced(p){return '<details><summary>高级选项：语言、日志、Provider env、Platform JSON</summary><div class="grid" style="margin-top:12px"><div class="field"><label>语言</label><select id="language">'+opts(['zh','en','zh-TW','ja','es'],p.language||'zh')+'</select></div><div class="field"><label>日志级别</label><select id="log">'+opts(['info','debug','warn','error'],p.log_level||'info')+'</select></div><div class="field"><label>Provider env JSON</label><textarea id="envopts">'+esc(JSON.stringify(p.provider?.env||{},null,2))+'</textarea></div><div class="field"><label>Platform options JSON</label><textarea id="platopts">'+esc(JSON.stringify(p.platform?.options||{},null,2))+'</textarea></div></div></details>'}
function sidePane(p){const path=p.config_path||'保存后生成 config.toml';return '<div class="band soft"><div class="row"><strong>状态</strong><span class="pill '+(p.running?'run':'warn')+'">'+statusText(p)+'</span></div><p class="meta clip">'+esc(path)+'</p></div><div class="band soft" style="margin-top:12px"><div class="row"><strong>隔离信息</strong><span class="pill">'+esc(p.agent_type||'agent')+'</span></div><p class="meta">data_dir、management、bridge、日志目录按 profile 独立生成。</p></div><div class="band soft" style="margin-top:12px"><div class="tabs"><button class="tab '+(tab==='config'?'active':'')+'" onclick="show(\\'config\\')">配置</button><button class="tab '+(tab==='logs'?'active':'')+'" onclick="show(\\'logs\\')">日志</button></div><pre id="pane">保存后生成配置。</pre></div>'}
async function toggleBrowse(){syncSelected();browseOpen=!browseOpen;renderEditor();if(browseOpen){browsePath=id('work').value||discovery.cwd||discovery.home;await browse(browsePath)}}
async function browse(p){const d=await api('/api/browse?path='+encodeURIComponent(p||''));browsePath=d.path;const box=id('browser');if(!box)return;const warn=d.error?'<div class="hint" style="padding:8px 10px">不可读取：'+esc(d.error)+'</div>':'';box.innerHTML='<div class="dir dir-head"><span class="clip">'+esc(d.path)+'</span><button class="ghost" onclick="chooseDir()">使用此目录</button></div>'+warn+(d.entries||[]).map(function(e){return '<button class="dir" onclick="browse(&quot;'+esc(e.path)+'&quot;)"><span>'+esc(e.name)+'</span><span class="meta clip">'+esc(e.path)+'</span></button>'}).join('')}
function chooseDir(){id('work').value=browsePath;syncSelected();toast('目录已填入')}
async function saveProfile(){try{const payload=collect();if(!payload.name||!payload.work_dir)throw new Error('Profile 名称和项目路径必填');if(selected.config_path)await api('/api/profiles/'+encodeURIComponent(selected.name),{method:'PUT',body:JSON.stringify(payload)});else await api('/api/profiles',{method:'POST',body:JSON.stringify(payload)});toast('已保存');await loadAll();selected=profiles.find(function(x){return x.name===payload.name});renderList();renderEditor()}catch(e){alert(e.message)}}
async function action(a){try{if(!selected?.name)throw new Error('请先保存');await api('/api/profiles/'+encodeURIComponent(selected.name)+'/'+a,{method:'POST'});toast('操作已提交');setTimeout(loadAll,700)}catch(e){alert(e.message)}}
function show(x){tab=x;renderEditor()}async function loadPane(){if(!selected?.config_path)return;try{const d=await api('/api/profiles/'+encodeURIComponent(selected.name)+'/'+tab);id('pane').textContent=tab==='logs'?(d.logs||''):(d.config||'')}catch(e){id('pane').textContent=e.message}}
function openPresets(){id('mask').classList.add('show');id('drawer').classList.add('show');renderPresets()}
function closePresets(){id('mask').classList.remove('show');id('drawer').classList.remove('show')}
function renderPresets(){const providerList=(presets.providers||[]).map(function(p,i){return '<div class="preset-card"><div class="row"><strong>'+esc(p.label||p.name)+'</strong><button class="ghost" onclick="removePreset(\\'providers\\','+i+')">删除</button></div><span class="meta">'+esc(p.agent_type||'')+' / '+esc(p.name||'')+' / '+esc(p.model||'未指定模型')+'</span></div>'}).join('')||'<div class="hint">暂无自定义 Provider 预设。</div>';const platformList=(presets.platforms||[]).map(function(p,i){return '<div class="preset-card"><div class="row"><strong>'+esc(p.label||p.name||p.type)+'</strong><button class="ghost" onclick="removePreset(\\'platforms\\','+i+')">删除</button></div><span class="meta">'+esc(p.type||'')+' / '+esc(Object.keys(p.options||{}).join(', ')||'无 options')+'</span></div>'}).join('')||'<div class="hint">暂无移动端平台预设。</div>';id('drawer').innerHTML='<div class="drawer-head"><div><strong>预设库</strong><div class="meta">平台凭据和常用 Provider 在这里维护。</div></div><button class="ghost" onclick="closePresets()">关闭</button></div><div class="drawer-body"><div class="band soft"><h3 style="margin:0 0 10px">新增 Provider</h3><div class="grid"><div class="field"><label>显示名称</label><input id="pp_label" placeholder="OpenAI 主账号"></div><div class="field"><label>Agent</label><select id="pp_agent">'+opts(AGENTS,'codex')+'</select></div><div class="field"><label>Provider 名称</label><input id="pp_name" value="primary"></div><div class="field"><label>Model</label><input id="pp_model"></div><div class="field"><label>API Key</label><input id="pp_key" type="password"></div><div class="field"><label>Base URL</label><input id="pp_base"></div></div><div class="actions" style="margin-top:10px"><button onclick="addProviderPreset()">保存 Provider</button></div></div><div class="band soft" style="margin-top:12px"><h3 style="margin:0 0 10px">新增移动端平台</h3><div class="grid"><div class="field"><label>显示名称</label><input id="mp_label" placeholder="Telegram 私人 Bot"></div><div class="field"><label>平台类型</label><select id="mp_type">'+opts(PLATFORMS,'telegram')+'</select></div><div class="field" style="grid-column:1/-1"><label>Options JSON</label><textarea id="mp_options">{\\n  \\"token\\": \\"\\"\\n}</textarea></div></div><div class="actions" style="margin-top:10px"><button onclick="addPlatformPreset()">保存平台</button></div></div><div class="band soft" style="margin-top:12px"><h3 style="margin:0 0 10px">Provider 预设</h3>'+providerList+'</div><div class="band soft" style="margin-top:12px"><h3 style="margin:0 0 10px">平台预设</h3>'+platformList+'</div></div>'}
async function persistPresets(){presets=await api('/api/presets',{method:'PUT',body:JSON.stringify(presets)});renderPresets();renderEditor()}
async function addProviderPreset(){try{presets.providers=presets.providers||[];presets.providers.push({label:id('pp_label').value.trim()||id('pp_name').value.trim(),name:id('pp_name').value.trim()||'primary',agent_type:id('pp_agent').value,api_key:id('pp_key').value,base_url:id('pp_base').value.trim(),model:id('pp_model').value.trim(),env:{}});await persistPresets();toast('Provider 预设已保存')}catch(e){alert(e.message)}}
async function addPlatformPreset(){try{presets.platforms=presets.platforms||[];presets.platforms.push({label:id('mp_label').value.trim()||id('mp_type').value,type:id('mp_type').value,options:JSON.parse(id('mp_options').value||'{}')});await persistPresets();toast('平台预设已保存')}catch(e){alert(e.message)}}
async function removePreset(kind,index){presets[kind].splice(index,1);await persistPresets();toast('预设已删除')}
loadAll().catch(function(e){alert(e.message)})
</script>
</body>
</html>`;

main(process.argv);
