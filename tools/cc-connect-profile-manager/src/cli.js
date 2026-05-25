'use strict';

const fs = require('fs');

const { Store } = require('./store');
const { coerceOptions } = require('./platforms');
const { spawnInstance, stopInstance, waitForManagement, tailFile } = require('./runtime');

async function run(command, args, opts) {
  const store = new Store(opts.home);
  switch (command) {
    case 'list': return printList(store);
    case 'create': return await createProfile(store, args);
    case 'remove':
    case 'delete': return removeProfile(store, args);
    case 'start': return await startProfile(store, args);
    case 'stop': return stopProfile(store, args);
    case 'restart': return await restartProfile(store, args);
    case 'status': return statusProfile(store, args);
    case 'logs': return logsProfile(store, args);
    case 'config': return configProfile(store, args);
    default: throw new Error(`unknown command: ${command}`);
  }
}

function printList(store) {
  const items = store.list();
  if (!items.length) {
    console.log('No profiles yet. Create one with: ccpm create --name <name> --work-dir <path>');
    return;
  }
  const cols = [
    ['NAME', 22],
    ['STATUS', 9],
    ['AGENT', 12],
    ['PLATFORM', 11],
    ['MGMT PORT', 10],
    ['WORK DIR', 0],
  ];
  console.log(cols.map(([h, w]) => w ? h.padEnd(w) : h).join('  '));
  for (const item of items) {
    const cells = [
      item.name.padEnd(22),
      (item.running ? 'running' : 'stopped').padEnd(9),
      item.agent_type.padEnd(12),
      item.platform.type.padEnd(11),
      String(item.management_port).padEnd(10),
      item.work_dir,
    ];
    console.log(cells.join('  '));
  }
}

async function createProfile(store, args) {
  const profile = profileFromArgs(args);
  if (!profile.name || !profile.work_dir) throw new Error('--name and --work-dir are required');
  profile.platform.options = coerceOptions(profile.platform.type, profile.platform.options);
  const saved = store.save(profile);
  console.log(`Created profile '${saved.name}'`);
  console.log(`  Config:        ${saved.config_path}`);
  console.log(`  Data dir:      ${saved.data_dir}`);
  console.log(`  Management:    ${saved.management_url}`);
}

function removeProfile(store, args) {
  const name = requireName(args, 'remove');
  try { stopInstance(store, store.load(name)); } catch { /* ignore */ }
  store.remove(name);
  console.log(`Removed profile '${name}'`);
}

async function startProfile(store, args) {
  const name = requireName(args, 'start');
  const profile = store.load(name);
  store.writeConfig(profile);
  const { pid, alreadyRunning } = spawnInstance(store, profile, { bin: args.bin });
  const probe = await waitForManagement(profile.management_port, profile.management_token, args.timeout ? Number(args.timeout) : 6000);
  const summary = store.summary(name);
  if (probe.ok) {
    console.log(`${alreadyRunning ? 'Already running' : 'Started'} '${name}'  pid=${pid}`);
    console.log(`  Management:    ${summary.management_url}`);
    console.log(`  Bridge:        ${summary.bridge_url}`);
    console.log(`  Log file:      ${summary.log_path}`);
  } else {
    console.error(`Started '${name}' pid=${pid} but management API did not respond.`);
    console.error('--- recent log ---');
    process.stderr.write(tailFile(store.logPath(name), 30));
    process.exitCode = 1;
  }
}

function stopProfile(store, args) {
  const name = requireName(args, 'stop');
  stopInstance(store, store.load(name));
  console.log(`Stopped '${name}'`);
}

async function restartProfile(store, args) {
  stopInstance(store, store.load(requireName(args, 'restart')));
  await startProfile(store, args);
}

function statusProfile(store, args) {
  const name = requireName(args, 'status');
  const summary = store.summary(name);
  console.log(`Profile:        ${summary.name}`);
  console.log(`Status:         ${summary.running ? 'running' : 'stopped'}`);
  if (summary.running) console.log(`PID:            ${summary.pid}`);
  if (summary.started_at) console.log(`Started at:     ${summary.started_at}`);
  console.log(`Work dir:       ${summary.work_dir}`);
  console.log(`Agent:          ${summary.agent_type}  (mode=${summary.agent_mode})`);
  console.log(`Provider:       ${summary.provider.name}${summary.provider.model ? ` · ${summary.provider.model}` : ''}`);
  console.log(`Platform:       ${summary.platform.type}`);
  console.log(`Management URL: ${summary.management_url}`);
  console.log(`Bridge URL:     ${summary.bridge_url}`);
  console.log(`Config:         ${summary.config_path}`);
  console.log(`Log file:       ${summary.log_path}`);
}

function logsProfile(store, args) {
  const name = requireName(args, 'logs');
  if (args.follow || args.f) {
    const file = store.logPath(name);
    if (!fs.existsSync(file)) { console.error(`(no log file yet at ${file})`); return; }
    process.stdout.write(tailFile(file, Number(args.n || 60)));
    const stat = fs.statSync(file);
    let pos = stat.size;
    const watcher = fs.watch(file, () => {
      try {
        const s = fs.statSync(file);
        if (s.size < pos) pos = 0;
        if (s.size === pos) return;
        const stream = fs.createReadStream(file, { start: pos, end: s.size - 1, encoding: 'utf8' });
        stream.on('data', (chunk) => process.stdout.write(chunk));
        stream.on('end', () => { pos = s.size; });
      } catch { /* ignore */ }
    });
    process.on('SIGINT', () => { watcher.close(); process.exit(0); });
  } else {
    process.stdout.write(tailFile(store.logPath(name), Number(args.n || 120)));
  }
}

function configProfile(store, args) {
  const name = requireName(args, 'config');
  process.stdout.write(fs.readFileSync(store.configPath(name), 'utf8'));
}

function requireName(args, command) {
  const name = args.name || args._[0];
  if (!name) throw new Error(`usage: ccpm ${command} <profile>`);
  return name;
}

function profileFromArgs(args) {
  const name = args.name || args._[0] || '';
  const platformOptions = {};
  if (args['platform-token']) platformOptions.token = args['platform-token'];
  if (args.app_id) platformOptions.app_id = args.app_id;
  if (args.app_secret) platformOptions.app_secret = args.app_secret;
  if (args.allow_from) platformOptions.allow_from = args.allow_from;
  const extra = args['platform-options'] ? safeJSON(args['platform-options']) : {};

  return {
    name,
    project_name: args.project || name,
    work_dir: args['work-dir'] || args.work_dir || '',
    agent_type: args.agent || args.agent_type || 'codex',
    agent_mode: args.mode || 'default',
    agent_model: args['agent-model'] || '',
    provider: {
      name: args.provider || 'primary',
      api_key: args['api-key'] || '',
      base_url: args['base-url'] || '',
      model: args.model || '',
      env: args['provider-env'] ? safeJSON(args['provider-env']) : {},
    },
    platform: {
      type: args.platform || 'telegram',
      options: { ...platformOptions, ...extra },
    },
    management_port: Number(args['management-port'] || 0),
    bridge_port: Number(args['bridge-port'] || 0),
    language: args.language || 'zh',
    log_level: args['log-level'] || 'info',
  };
}

function safeJSON(value) {
  try { return JSON.parse(value); } catch (err) { throw new Error(`invalid JSON: ${err.message}`); }
}

module.exports = { run, profileFromArgs };
