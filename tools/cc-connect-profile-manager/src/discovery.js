'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

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
    const text = safeRead(codexConfig);
    providers.push({
      name: matchFirst(text, /^\s*model_provider\s*=\s*"([^"]+)"/m) || 'codex-local',
      label: 'Codex local config',
      agent_type: 'codex',
      model: matchFirst(text, /^\s*model\s*=\s*"([^"]+)"/m) || '',
      base_url: matchFirst(text, /^\s*base_url\s*=\s*"([^"]+)"/m) || '',
      source: codexConfig,
      kind: 'local',
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
      kind: 'local',
    });
  }

  pushEnv(providers, { key: 'OPENAI_API_KEY', name: 'openai-env', label: 'OPENAI_API_KEY', agent_type: 'codex',
    base_url: process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || '' });
  pushEnv(providers, { key: 'ANTHROPIC_API_KEY', name: 'anthropic-env', label: 'ANTHROPIC_API_KEY', agent_type: 'claudecode',
    base_url: process.env.ANTHROPIC_BASE_URL || '' });
  pushEnv(providers, { key: 'GEMINI_API_KEY', name: 'gemini-env', label: 'GEMINI_API_KEY', agent_type: 'gemini', base_url: '' });
  pushEnv(providers, { key: 'MOONSHOT_API_KEY', name: 'kimi-env', label: 'MOONSHOT_API_KEY', agent_type: 'kimi', base_url: '' });

  return providers;
}

function pushEnv(providers, item) {
  const value = process.env[item.key];
  if (!value) return;
  providers.push({
    name: item.name,
    label: item.label,
    agent_type: item.agent_type,
    api_key: value,
    base_url: item.base_url || '',
    model: '',
    source: `env:${item.key}`,
    kind: 'env',
  });
}

function matchFirst(text, pattern) {
  if (!text) return '';
  const match = text.match(pattern);
  return match ? match[1] : '';
}

function safeRead(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function expandHome(value) {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

module.exports = { discovery, browseDirs, detectedProviders };
