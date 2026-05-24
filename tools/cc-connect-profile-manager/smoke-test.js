#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccpm-smoke-'));
const ccpm = path.join(__dirname, 'ccpm.js');

function run(args) {
  const result = spawnSync(process.execPath, [ccpm, ...args, '--home', root], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
  return result.stdout;
}

try {
  run([
    'create',
    '--name', 'app',
    '--work-dir', process.cwd(),
    '--agent', 'codex',
    '--platform', 'telegram',
    '--platform-token', 'token-test',
    '--api-key', 'sk-test',
    '--model', 'gpt-test',
  ]);
  const list = run(['list']);
  const config = run(['config', 'app']);
  const required = [
    'app',
    'data_dir = ',
    '[management]',
    '[bridge]',
    '[[providers]]',
    'provider_refs = ["primary"]',
    'type = "telegram"',
    'token = "token-test"',
  ];
  for (const token of required) {
    const haystack = token === 'app' ? list : config;
    if (!haystack.includes(token)) {
      throw new Error(`missing ${token}`);
    }
  }
  console.log('ccpm smoke test passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
