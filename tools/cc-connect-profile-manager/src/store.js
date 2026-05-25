'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { renderConfig } = require('./config');
const { detectedProviders } = require('./discovery');

class Store {
  constructor(root) {
    this.root = path.resolve(expandHome(root));
    this.profilesDir = path.join(this.root, 'profiles');
    this.presetsPath = path.join(this.root, 'presets.json');
    fs.mkdirSync(this.profilesDir, { recursive: true });
  }

  dir(name) { return path.join(this.profilesDir, sanitizeName(name)); }
  profilePath(name) { return path.join(this.dir(name), 'profile.json'); }
  configPath(name) { return path.join(this.dir(name), 'config.toml'); }
  dataDir(name) { return path.join(this.dir(name), 'data'); }
  logDir(name) { return path.join(this.dir(name), 'logs'); }
  logPath(name) { return path.join(this.logDir(name), 'cc-connect.log'); }
  pidPath(name) { return path.join(this.dir(name), 'cc-connect.pid'); }
  startedAtPath(name) { return path.join(this.dir(name), 'started_at'); }

  list() {
    if (!fs.existsSync(this.profilesDir)) return [];
    return fs.readdirSync(this.profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => { try { return this.summary(entry.name); } catch { return null; } })
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
    fs.mkdirSync(this.logDir(next.name), { recursive: true });
    fs.mkdirSync(this.dataDir(next.name), { recursive: true });
    const now = new Date().toISOString();
    if (!next.created_at) next.created_at = now;
    next.updated_at = now;
    fs.writeFileSync(this.profilePath(next.name), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    this.writeConfig(next);
    return this.summary(next.name);
  }

  remove(name) {
    fs.rmSync(this.dir(name), { recursive: true, force: true });
  }

  writeConfig(profile) {
    const text = renderConfig(profile, this.dataDir(profile.name));
    fs.writeFileSync(this.configPath(profile.name), text, { mode: 0o600 });
  }

  summary(name) {
    const profile = this.load(name);
    const pid = readPid(this.pidPath(profile.name));
    const running = pid > 0 && isPidAlive(pid);
    let startedAt = '';
    try { startedAt = fs.readFileSync(this.startedAtPath(profile.name), 'utf8').trim(); } catch { /* none */ }
    return {
      ...profile,
      config_path: this.configPath(profile.name),
      data_dir: this.dataDir(profile.name),
      log_path: this.logPath(profile.name),
      pid: running ? pid : 0,
      running,
      started_at: running ? startedAt : '',
      management_url: `http://127.0.0.1:${profile.management_port}`,
      bridge_url: `ws://127.0.0.1:${profile.bridge_port}${profile.bridge_path || '/bridge/ws'}`,
    };
  }

  presets() {
    const local = detectedProviders();
    const fallback = { providers: [], platforms: [], local };
    if (!fs.existsSync(this.presetsPath)) return fallback;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.presetsPath, 'utf8'));
      return {
        providers: Array.isArray(parsed.providers) ? parsed.providers : [],
        platforms: Array.isArray(parsed.platforms) ? parsed.platforms.map(ensurePlatformId) : [],
        local,
      };
    } catch {
      return fallback;
    }
  }

  savePresets(input) {
    const next = {
      providers: Array.isArray(input.providers) ? input.providers : [],
      platforms: Array.isArray(input.platforms) ? input.platforms.map(ensurePlatformId) : [],
    };
    fs.mkdirSync(this.root, { recursive: true });
    fs.writeFileSync(this.presetsPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    return this.presets();
  }
}

function ensurePlatformId(p) {
  if (p && p.id) return p;
  return { ...(p || {}), id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` };
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
    agent_model: profile.agent_model || '',
    provider: {
      name: (profile.provider && profile.provider.name) || 'primary',
      api_key: (profile.provider && profile.provider.api_key) || '',
      base_url: (profile.provider && profile.provider.base_url) || '',
      model: (profile.provider && profile.provider.model) || '',
      env: (profile.provider && profile.provider.env) || {},
    },
    platform: {
      type: (profile.platform && profile.platform.type) || 'telegram',
      options: (profile.platform && profile.platform.options) || {},
    },
    management_port: basePort,
    management_token: profile.management_token || token(name, 'management'),
    bridge_port: profile.bridge_port || basePort + 1000,
    bridge_token: profile.bridge_token || token(name, 'bridge'),
    bridge_path: profile.bridge_path || '/bridge/ws',
    language: profile.language || 'zh',
    log_level: profile.log_level || 'info',
    created_at: profile.created_at || '',
    updated_at: profile.updated_at || '',
  };
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
  for (const ch of name) sum += ch.charCodeAt(0);
  return 9820 + (sum % 700);
}

function token(name, purpose) {
  return `${Date.now().toString(16)}-${sanitizeName(name)}-${purpose}`;
}

function readPid(file) {
  try { return Number(fs.readFileSync(file, 'utf8').trim()) || 0; } catch { return 0; }
}

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function expandHome(value) {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

module.exports = { Store, normalizeProfile, sanitizeName, expandHome };
