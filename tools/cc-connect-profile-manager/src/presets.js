'use strict';

const fs = require('fs');
const path = require('path');

// Try to locate cc-connect's bundled provider-presets.json.
// Order: explicit override → env → walking up from this file (we live in tools/cc-connect-profile-manager/src).
function locateCcConnectRoot(override) {
  const candidates = [];
  if (override) candidates.push(override);
  if (process.env.CC_CONNECT_ROOT) candidates.push(process.env.CC_CONNECT_ROOT);
  candidates.push(path.resolve(__dirname, '../../..'));
  candidates.push(path.resolve(__dirname, '../..'));
  for (const dir of candidates) {
    if (!dir) continue;
    const file = path.join(dir, 'provider-presets.json');
    if (fs.existsSync(file)) return dir;
  }
  return '';
}

function loadCcConnectPresets(override) {
  const root = locateCcConnectRoot(override);
  if (!root) return { root: '', updated_at: '', providers: [] };
  const file = path.join(root, 'provider-presets.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      root,
      updated_at: parsed.updated_at || '',
      providers: Array.isArray(parsed.providers) ? parsed.providers.map(normalize) : [],
    };
  } catch (err) {
    return { root, updated_at: '', providers: [], error: err.message };
  }
}

function normalize(p) {
  const agents = {};
  for (const [agentType, conf] of Object.entries(p.agents || {})) {
    agents[agentType] = {
      base_url: conf.base_url || '',
      model: conf.model || '',
      models: Array.isArray(conf.models) ? conf.models.slice() : [],
    };
  }
  return {
    name: p.name,
    display_name: p.display_name || p.name,
    description: p.description || '',
    description_zh: p.description_zh || '',
    features: Array.isArray(p.features) ? p.features.slice() : [],
    tier: p.tier || 99,
    website: p.website || '',
    invite_url: p.invite_url || '',
    agents,
    supported_agent_types: Object.keys(agents),
  };
}

module.exports = { loadCcConnectPresets, locateCcConnectRoot };
