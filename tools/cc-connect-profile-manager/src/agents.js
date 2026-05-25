'use strict';

// Agent type metadata: which CLI it wraps, what modes it supports, suggested model field.

const AGENTS = [
  {
    type: 'claudecode',
    label: 'Claude Code',
    cli: 'claude',
    modes: ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk'],
    default_mode: 'default',
  },
  {
    type: 'codex',
    label: 'Codex (OpenAI)',
    cli: 'codex',
    modes: ['suggest', 'auto-edit', 'full-auto', 'yolo'],
    default_mode: 'suggest',
  },
  {
    type: 'cursor',
    label: 'Cursor Agent',
    cli: 'agent',
    modes: ['default', 'force', 'plan', 'ask'],
    default_mode: 'default',
  },
  {
    type: 'gemini',
    label: 'Gemini CLI',
    cli: 'gemini',
    modes: ['default', 'auto_edit', 'yolo', 'plan'],
    default_mode: 'default',
  },
  {
    type: 'iflow',
    label: 'iFlow CLI',
    cli: 'iflow',
    modes: ['default', 'auto-edit', 'plan', 'yolo'],
    default_mode: 'default',
  },
  {
    type: 'opencode',
    label: 'OpenCode',
    cli: 'opencode',
    modes: ['default', 'yolo'],
    default_mode: 'default',
  },
  {
    type: 'qoder',
    label: 'Qoder',
    cli: 'qodercli',
    modes: ['default', 'yolo'],
    default_mode: 'default',
  },
  {
    type: 'kimi',
    label: 'Kimi CLI',
    cli: 'kimi',
    modes: ['default', 'yolo', 'plan', 'quiet'],
    default_mode: 'default',
  },
  {
    type: 'devin',
    label: 'Devin',
    cli: 'devin',
    modes: ['normal', 'ask', 'plan', 'accept-edits', 'bypass'],
    default_mode: 'normal',
  },
  {
    type: 'acp',
    label: 'ACP (generic)',
    cli: '',
    modes: ['default'],
    default_mode: 'default',
  },
  {
    type: 'tmux',
    label: 'tmux session',
    cli: 'tmux',
    modes: ['default'],
    default_mode: 'default',
  },
  {
    type: 'pi',
    label: 'Pi',
    cli: 'pi',
    modes: ['default'],
    default_mode: 'default',
  },
];

const BY_TYPE = new Map(AGENTS.map((a) => [a.type, a]));

function getAgent(type) { return BY_TYPE.get(type) || AGENTS[0]; }
function agentList() { return AGENTS.map((a) => ({ type: a.type, label: a.label, modes: a.modes, default_mode: a.default_mode })); }

module.exports = { AGENTS, getAgent, agentList };
