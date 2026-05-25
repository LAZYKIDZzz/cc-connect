#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');

const DEFAULT_HOME = path.join(os.homedir(), '.cc-connect-profile-manager');
const DEFAULT_PORT = 9876;

async function main(argv) {
  const command = argv[2] || 'serve';
  const args = parseArgs(argv.slice(3));

  if (command === 'help' || command === '--help' || command === '-h') {
    return printHelp();
  }

  const home = args.home || process.env.CCPM_HOME || DEFAULT_HOME;

  try {
    if (command === 'serve' || command === 'web') {
      const { start } = require('./src/server');
      start({
        home,
        port: Number(args.port || DEFAULT_PORT),
        noBrowser: Boolean(args['no-browser']),
        ccConnectRoot: args['cc-connect-root'] || '',
      });
      return;
    }
    const cli = require('./src/cli');
    await cli.run(command, args, { home });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (process.env.CCPM_DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

function parseArgs(items) {
  const out = { _: [] };
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item.startsWith('--')) { out._.push(item); continue; }
    const eq = item.indexOf('=');
    if (eq >= 0) { out[item.slice(2, eq)] = item.slice(eq + 1); continue; }
    const key = item.slice(2);
    if (i + 1 < items.length && !items[i + 1].startsWith('--')) {
      out[key] = items[i + 1]; i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function printHelp() {
  console.log(`cc-connect Profile Manager

Usage:
  ccpm serve [--port 9876] [--no-browser] [--cc-connect-root DIR]
  ccpm create --name <name> --work-dir <path>
              [--agent codex] [--mode default] [--agent-model gpt-5.4]
              [--provider primary] [--api-key sk-...] [--base-url URL] [--model NAME]
              [--platform telegram] [--platform-token TOKEN] [--platform-options JSON]
  ccpm list
  ccpm start <name>     [--bin cc-connect] [--timeout 6000]
  ccpm stop <name>
  ccpm restart <name>
  ccpm status <name>
  ccpm logs <name>      [--follow] [-n 120]
  ccpm config <name>
  ccpm remove <name>

Common options:
  --home DIR            Profile home (default ${DEFAULT_HOME})
  --port N              Web UI port (serve, default ${DEFAULT_PORT})
  --cc-connect-root DIR Path to cc-connect repo (auto-detected from sibling dirs)

Environment:
  CCPM_HOME             Default --home
  CC_CONNECT_BIN        Default cc-connect binary
  CC_CONNECT_ROOT       Default cc-connect repo root
  CCPM_DEBUG=1          Print stack traces on error
`);
}

main(process.argv);
