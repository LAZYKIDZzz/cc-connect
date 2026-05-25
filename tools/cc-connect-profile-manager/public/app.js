// cc-connect Profile Manager — frontend SPA
// Vanilla ES module, no build step, no framework.

const el = (tag, attrs, ...children) => {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'data' && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) node.dataset[k] = v;
      } else if (key === 'value' && (tag === 'input' || tag === 'select' || tag === 'textarea')) {
        node.value = value;
      } else if (typeof value === 'boolean') {
        if (value) node.setAttribute(key, '');
      } else {
        node.setAttribute(key, value);
      }
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  return node;
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const api = {
  async request(path, options) {
    const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
    let payload;
    try { payload = await res.json(); } catch { payload = { ok: false, error: `bad response (${res.status})` }; }
    if (!payload.ok) throw new Error(payload.error || `request failed (${res.status})`);
    return payload.data;
  },
  get(path) { return this.request(path); },
  post(path, body) { return this.request(path, { method: 'POST', body: JSON.stringify(body || {}) }); },
  put(path, body) { return this.request(path, { method: 'PUT', body: JSON.stringify(body || {}) }); },
  del(path) { return this.request(path, { method: 'DELETE' }); },
};

const state = {
  profiles: [],
  selectedName: null,
  draftProfile: null,
  presets: { providers: [], platforms: [], local: [] },
  ccPresets: { providers: [], root: '' },
  discovery: {},
  platforms: [],
  agents: [],
  search: '',
  tab: 'config',
  drawer: null,
  modal: null,
  liveSource: null,
  configText: '',
  logsText: '',
  pendingAction: false,
};

const PLATFORM_DEFAULTS = {
  telegram: { token: '', allow_from: '*' },
  feishu: { app_id: '', app_secret: '', allow_from: '*' },
  slack: { bot_token: '', app_token: '', allow_from: '*' },
  discord: { token: '', allow_from: '*' },
  dingtalk: { client_id: '', client_secret: '', allow_from: '*' },
};

function defaultsFor(platformType) {
  return PLATFORM_DEFAULTS[platformType] || {};
}

function blankProfile() {
  return {
    name: '',
    project_name: '',
    work_dir: state.discovery.cwd || state.discovery.home || '',
    agent_type: 'codex',
    agent_mode: 'suggest',
    agent_model: '',
    provider: { name: 'primary', api_key: '', base_url: '', model: '', env: {} },
    platform: { type: 'telegram', options: defaultsFor('telegram') },
    language: 'zh',
    log_level: 'info',
  };
}

/* -------------------------- API helpers -------------------------- */

async function bootstrap() {
  const [discovery, platformsResp, presets] = await Promise.all([
    api.get('/api/discovery'),
    api.get('/api/platforms'),
    api.get('/api/presets'),
  ]);
  state.discovery = discovery;
  state.platforms = platformsResp.platforms;
  state.agents = platformsResp.agents;
  state.presets = presets;
  // cc-connect presets — non-fatal if absent
  try {
    const cc = await api.get('/api/cc-presets');
    state.ccPresets = cc || { providers: [], root: '' };
  } catch { state.ccPresets = { providers: [], root: '' }; }
  await reloadProfiles();
}

async function reloadProfiles() {
  const data = await api.get('/api/profiles');
  state.profiles = data.profiles || [];
  if (state.selectedName) {
    const found = state.profiles.find((p) => p.name === state.selectedName);
    if (!found && !state.draftProfile) state.selectedName = null;
  }
}

async function loadConfigAndLogs(name) {
  state.configText = '';
  state.logsText = '';
  try { const r = await api.get(`/api/profiles/${encodeURIComponent(name)}/config`); state.configText = r.config || ''; } catch (e) { state.configText = `(no config yet)`; }
  try { const r = await api.get(`/api/profiles/${encodeURIComponent(name)}/logs?n=200`); state.logsText = r.logs || ''; } catch { state.logsText = ''; }
}

function subscribeLogs(name) {
  unsubscribeLogs();
  const source = new EventSource(`/api/profiles/${encodeURIComponent(name)}/stream`);
  source.onmessage = (evt) => {
    appendLogLine(evt.data);
  };
  source.onerror = () => { source.close(); state.liveSource = null; };
  state.liveSource = source;
}

function unsubscribeLogs() {
  if (state.liveSource) { state.liveSource.close(); state.liveSource = null; }
}

function appendLogLine(line) {
  const pane = $('#log-pane');
  if (!pane) return;
  const div = el('div', { class: 'log-line' }, line);
  pane.appendChild(div);
  // keep only last ~500 lines
  while (pane.childElementCount > 500) pane.removeChild(pane.firstChild);
  pane.scrollTop = pane.scrollHeight;
}

/* -------------------------- App shell render -------------------------- */

function render() {
  const root = $('#root');
  root.innerHTML = '';
  root.appendChild(renderApp());
}

function renderApp() {
  const app = el('div', { class: 'app' });
  app.appendChild(renderTopbar());
  const body = el('div', { class: 'body' });
  body.appendChild(renderSidebar());
  body.appendChild(renderMain());
  app.appendChild(body);
  return app;
}

function renderTopbar() {
  const search = el('div', { class: 'search' },
    el('span', { class: 'icon' }, svg(`<path d="M11 5a6 6 0 1 1-3.92 10.58l-3.32 3.32a1 1 0 0 1-1.42-1.42l3.32-3.32A6 6 0 0 1 11 5Zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/>`, 16)),
    el('input', { class: 'input', placeholder: '搜索 Profile…  (⌘K)', value: state.search,
      oninput: (e) => { state.search = e.target.value; renderSidebarOnly(); } }),
  );
  return el('header', { class: 'topbar' },
    el('div', { class: 'brand' },
      el('div', { class: 'mark' }, 'CC'),
      el('div', { class: 'name' }, 'CCPM'),
      el('span', { class: 'dot' }, '·'),
      el('div', { class: 'sub' }, '多 Profile 管理'),
    ),
    search,
    el('div', { class: 'actions' },
      el('button', { class: 'btn ghost theme-toggle', title: '切换浅色 / 深色主题', onclick: toggleTheme },
        el('span', { class: 'glyph-sun' }, '🌙'),
        el('span', { class: 'glyph-moon' }, '☀'),
      ),
      el('button', { class: 'btn ghost', onclick: openPresetsDrawer }, '⚙ 预设库'),
      el('button', { class: 'btn primary', onclick: startNewProfile }, '+ 新建 Profile'),
    ),
  );
}

function toggleTheme() {
  const root = document.documentElement;
  const cur = root.getAttribute('data-theme');
  if (cur === 'light') {
    root.removeAttribute('data-theme');
    try { localStorage.setItem('ccpm-theme', 'dark'); } catch { /* ignore */ }
  } else {
    root.setAttribute('data-theme', 'light');
    try { localStorage.setItem('ccpm-theme', 'light'); } catch { /* ignore */ }
  }
}

function renderSidebarOnly() {
  const sidebar = $('.sidebar');
  if (!sidebar) return;
  sidebar.replaceWith(renderSidebar());
}

function renderSidebar() {
  const sidebar = el('aside', { class: 'sidebar' });
  sidebar.appendChild(el('div', { class: 'side-header' },
    el('div', { class: 'side-eyebrow' }, '我的 PROFILE'),
    el('div', { class: 'side-count' }, String(state.profiles.length)),
  ));
  const filtered = state.profiles.filter((p) => {
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return p.name.toLowerCase().includes(q) ||
      (p.work_dir || '').toLowerCase().includes(q) ||
      (p.agent_type || '').toLowerCase().includes(q) ||
      (p.platform?.type || '').toLowerCase().includes(q);
  });
  if (!filtered.length) {
    sidebar.appendChild(el('div', { class: 'empty-sidebar' }, state.profiles.length ? '无匹配。' : '还没有 Profile，点击右上角新建。'));
    return sidebar;
  }
  const list = el('div', { class: 'profile-list' });
  for (const p of filtered) {
    const item = el('button', {
      class: 'profile' + (state.selectedName === p.name && !state.draftProfile ? ' active' : ''),
      onclick: () => selectProfile(p.name),
    });
    item.appendChild(el('div', { class: 'profile-row' },
      el('span', { class: `dot ${p.running ? 'running' : ''}` }),
      el('span', { class: 'profile-name' }, p.name),
      el('span', { class: 'profile-port' }, `:${p.management_port}`),
    ));
    item.appendChild(el('div', { class: 'profile-meta' },
      el('span', { class: 'tag' }, p.agent_type || 'agent'),
      el('span', { class: 'sep' }, '·'),
      el('span', { class: 'tag' }, p.platform?.type || 'platform'),
    ));
    if (p.work_dir) item.appendChild(el('div', { class: 'profile-meta' }, el('span', { class: 'work' }, p.work_dir)));
    list.appendChild(item);
  }
  sidebar.appendChild(list);
  return sidebar;
}

function renderMain() {
  const main = el('main', { class: 'main' });
  if (state.draftProfile) {
    main.appendChild(renderEditor(state.draftProfile, /* isDraft */ true));
    return main;
  }
  if (!state.selectedName) {
    main.appendChild(renderEmpty());
    return main;
  }
  const profile = state.profiles.find((p) => p.name === state.selectedName);
  if (!profile) {
    main.appendChild(renderEmpty());
    return main;
  }
  main.appendChild(renderEditor(profile, /* isDraft */ false));
  return main;
}

function renderEmpty() {
  return el('div', { class: 'empty-main' },
    el('div', null,
      el('div', { class: 'glyph' }, '＋'),
      el('h1', null, '选择一个 Profile，或新建一个'),
      el('p', null, state.profiles.length
        ? '每个 Profile = 一个项目 + 一个 AI Provider + 一个移动端入口，各自独立的 data_dir、management 端口和 token。'
        : '你还没有任何 Profile。新建第一个开始使用。'),
      el('div', { class: 'btn-row', style: { justifyContent: 'center' } },
        el('button', { class: 'btn primary', onclick: startNewProfile }, '+ 新建 Profile'),
        el('button', { class: 'btn ghost', onclick: openPresetsDrawer }, '⚙ 预设库'),
      ),
      el('div', { class: 'hint', style: { marginTop: '20px' } },
        '提示：',
        el('span', { class: 'kbd' }, '⌘ K'),
        ' 搜索 · ',
        el('span', { class: 'kbd' }, '⌘ N'),
        ' 新建',
      ),
    ),
  );
}

/* -------------------------- Editor -------------------------- */

function renderEditor(profile, isDraft) {
  const wrap = el('div', { class: 'editor' });

  // Page head + status card
  const head = el('div', { class: 'page-head' });
  head.appendChild(el('div', { class: 'page-eyebrow' }, isDraft ? '新建 Profile' : 'PROFILE'));
  const titleRow = el('h1', { class: 'page-title' });
  const nameInput = el('input', {
    class: 'name-input', value: profile.name || '', placeholder: 'profile-name',
    disabled: !isDraft,
    oninput: (e) => { profile.name = e.target.value; },
  });
  titleRow.appendChild(nameInput);
  head.appendChild(titleRow);
  wrap.appendChild(head);

  if (!isDraft) wrap.appendChild(renderStatusCard(profile));

  // Project card
  wrap.appendChild(renderProjectCard(profile, isDraft));
  // Provider card
  wrap.appendChild(renderProviderCard(profile));
  // Platform card
  wrap.appendChild(renderPlatformCard(profile));
  // Advanced card
  wrap.appendChild(renderAdvancedCard(profile));

  // Footer save bar for drafts
  if (isDraft) {
    wrap.appendChild(el('div', { class: 'btn-row', style: { justifyContent: 'flex-end' } },
      el('button', { class: 'btn ghost', onclick: () => { state.draftProfile = null; render(); } }, '取消'),
      el('button', { class: 'btn primary', onclick: () => saveProfile(profile, /* isNew */ true) }, '创建 Profile'),
    ));
  } else {
    wrap.appendChild(renderConfigLogsCard(profile));
  }
  return wrap;
}

function renderStatusCard(profile) {
  const card = el('div', { class: 'status-card' });
  const left = el('div', { class: 'status-left' });
  left.appendChild(el('div', { class: `status-pill ${profile.running ? 'running' : 'stopped'}` },
    el('span', { class: `dot ${profile.running ? 'running' : ''}` }),
    profile.running ? '运行中' : '已停止',
  ));
  const detail = el('div', { class: 'status-detail' });
  detail.appendChild(rowKV('PID', profile.running ? String(profile.pid || '—') : '—'));
  detail.appendChild(rowKV('管理', profile.management_url, { copy: true }));
  detail.appendChild(rowKV('桥接', profile.bridge_url, { copy: true }));
  detail.appendChild(rowKV('目录', profile.work_dir || '—'));
  left.appendChild(detail);
  card.appendChild(left);

  const actions = el('div', { class: 'status-actions' });
  const isBusy = state.pendingAction;
  if (profile.running) {
    actions.appendChild(el('button', { class: 'btn', disabled: isBusy, onclick: () => doAction(profile, 'restart') }, '重启'));
    actions.appendChild(el('button', { class: 'btn danger', disabled: isBusy, onclick: () => doAction(profile, 'stop') }, '停止'));
  } else {
    actions.appendChild(el('button', { class: 'btn primary', disabled: isBusy, onclick: () => doAction(profile, 'start') },
      isBusy ? el('span', { class: 'spinner' }) : null,
      isBusy ? ' 启动中…' : '▶ 启动'));
  }
  actions.appendChild(el('button', { class: 'btn ghost', onclick: () => saveProfile(profile, false) }, '保存'));
  actions.appendChild(el('button', { class: 'btn ghost', onclick: () => confirmRemove(profile) }, '⌫ 删除'));
  card.appendChild(actions);

  return card;
}

function rowKV(label, value, opts = {}) {
  const row = el('div', { class: 'status-row' });
  row.appendChild(el('span', { class: 'lbl' }, label));
  row.appendChild(el('span', { class: 'val', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '380px' } }, value));
  if (opts.copy && value && value !== '—') {
    const btn = el('button', { class: 'copy', title: '复制', onclick: async () => {
      try {
        await navigator.clipboard.writeText(value);
        btn.classList.add('ok'); btn.textContent = '✓';
        setTimeout(() => { btn.classList.remove('ok'); btn.textContent = '⧉'; }, 1200);
      } catch { toast('剪贴板不可用', 'error'); }
    } }, '⧉');
    row.appendChild(btn);
  }
  return row;
}

function renderProjectCard(profile, isDraft) {
  const card = el('section', { class: 'card' });
  card.appendChild(el('div', { class: 'card-head' },
    el('div', null, el('h3', null, '项目'), el('div', { class: 'head-sub' }, 'cc-connect 在哪里运行。')),
  ));
  const body = el('div', { class: 'card-body' });
  const grid = el('div', { class: 'grid' });

  grid.appendChild(field('cc-connect 项目名', el('input', {
    class: 'input', value: profile.project_name || profile.name || '',
    placeholder: '如 my-backend',
    oninput: (e) => { profile.project_name = e.target.value; },
  })));

  const workInput = el('input', {
    class: 'input mono', value: profile.work_dir || '',
    placeholder: '/path/to/project',
    oninput: (e) => { profile.work_dir = e.target.value; },
  });
  const pickBtn = el('button', { class: 'btn ghost', onclick: () => openDirPicker(profile.work_dir, (chosen) => { profile.work_dir = chosen; workInput.value = chosen; }) }, '📂 浏览');
  const workField = field('项目路径', el('div', { class: 'input-row' }, workInput, pickBtn), '使用绝对路径。');
  workField.classList.add('full');
  grid.appendChild(workField);

  body.appendChild(grid);
  card.appendChild(body);
  return card;
}

function renderProviderCard(profile) {
  const card = el('section', { class: 'card' });
  card.appendChild(el('div', { class: 'card-head' },
    el('div', null,
      el('h3', null, 'AI Provider'),
      el('div', { class: 'head-sub' },
        state.ccPresets.root
          ? `${state.ccPresets.providers.length} 个精选预设可用 · 来自 ${state.ccPresets.root}`
          : '仅检测本机 Provider — 设置 --cc-connect-root 可加载精选预设。',
      ),
    ),
  ));
  const body = el('div', { class: 'card-body' });

  // Chooser
  const chooser = el('div', { class: 'provider-chooser' });
  const sel = el('select', { class: 'select', onchange: (e) => applyProviderChoice(profile, e.target.value) });
  sel.appendChild(el('option', { value: '' }, '套用预设…'));

  if (state.ccPresets.providers.length) {
    const grp = el('optgroup', { label: `cc-connect 精选（${state.ccPresets.providers.length}）` });
    const filtered = state.ccPresets.providers
      .filter((p) => p.supported_agent_types.includes(profile.agent_type) || !profile.agent_type)
      .sort((a, b) => (a.tier - b.tier) || a.display_name.localeCompare(b.display_name));
    for (const p of filtered) {
      grp.appendChild(el('option', { value: `cc:${p.name}` }, `${p.display_name}  ·  ${(p.features || []).slice(0,2).join(' · ') || 'preset'}`));
    }
    sel.appendChild(grp);
  }
  if (state.presets.local && state.presets.local.length) {
    const grp = el('optgroup', { label: '本机检测' });
    for (const p of state.presets.local) {
      if (profile.agent_type && p.agent_type && p.agent_type !== profile.agent_type) continue;
      grp.appendChild(el('option', { value: `local:${p.name}` }, `${p.label || p.name}（${p.source || 'env'}）`));
    }
    sel.appendChild(grp);
  }
  if (state.presets.providers && state.presets.providers.length) {
    const grp = el('optgroup', { label: '我的自定义预设' });
    for (let i = 0; i < state.presets.providers.length; i += 1) {
      const p = state.presets.providers[i];
      grp.appendChild(el('option', { value: `custom:${i}` }, `${p.label || p.name}  ·  ${p.agent_type || 'agent'}`));
    }
    sel.appendChild(grp);
  }
  chooser.appendChild(el('div', { class: 'row' }, sel,
    el('button', { class: 'btn ghost', onclick: () => openPresetsDrawer() }, '管理预设'),
  ));

  // Active provider chips
  const chip = el('div', { class: 'row' });
  if (profile.provider?.model) chip.appendChild(el('span', { class: 'provider-chip' }, '🧠 ', profile.provider.model));
  if (profile.provider?.base_url) chip.appendChild(el('span', { class: 'provider-chip' }, '🔗 ', profile.provider.base_url));
  if (profile.provider?.api_key) chip.appendChild(el('span', { class: 'provider-chip' }, '🔑 ', maskKey(profile.provider.api_key)));
  if (chip.childElementCount) chooser.appendChild(chip);

  body.appendChild(chooser);

  const grid = el('div', { class: 'grid', style: { marginTop: '14px' } });
  // Agent type
  const agentSel = el('select', { class: 'select', onchange: (e) => onAgentChange(profile, e.target.value) });
  for (const a of state.agents) agentSel.appendChild(el('option', { value: a.type, selected: a.type === profile.agent_type }, a.label));
  grid.appendChild(field('Agent', agentSel));

  // Agent mode
  const agentMeta = state.agents.find((a) => a.type === profile.agent_type) || state.agents[0];
  const modeSel = el('select', { class: 'select', onchange: (e) => { profile.agent_mode = e.target.value; } });
  for (const m of agentMeta.modes) modeSel.appendChild(el('option', { value: m, selected: m === profile.agent_mode }, m));
  grid.appendChild(field('Agent 模式', modeSel));

  // Provider name
  grid.appendChild(field('Provider 名称', el('input', { class: 'input', value: profile.provider?.name || 'primary',
    oninput: (e) => { profile.provider.name = e.target.value; } })));

  // API Key
  grid.appendChild(field('API Key', el('input', { class: 'input mono', type: 'password', value: profile.provider?.api_key || '',
    placeholder: profile.provider?.api_key ? '••••••' : 'sk-…',
    oninput: (e) => { profile.provider.api_key = e.target.value; } })));

  // Base URL
  const baseField = field('Base URL', el('input', { class: 'input mono', value: profile.provider?.base_url || '',
    placeholder: 'https://api.example.com/v1', oninput: (e) => { profile.provider.base_url = e.target.value; } }));
  baseField.classList.add('full');
  grid.appendChild(baseField);

  // Model
  grid.appendChild(field('模型', el('input', { class: 'input mono', value: profile.provider?.model || '',
    placeholder: '如 claude-sonnet-4-6', oninput: (e) => { profile.provider.model = e.target.value; } })));

  // Agent-specific model (passed to agent CLI, often = provider model)
  grid.appendChild(field('Agent 模型覆盖', el('input', { class: 'input mono', value: profile.agent_model || '',
    placeholder: '（可选）', oninput: (e) => { profile.agent_model = e.target.value; } }), '通常留空。'));

  body.appendChild(grid);
  card.appendChild(body);
  return card;
}

function applyProviderChoice(profile, value) {
  if (!value) return;
  const [scope, idx] = value.split(':');
  let source;
  if (scope === 'cc') {
    source = state.ccPresets.providers.find((p) => p.name === idx);
    if (!source) return;
    const conf = source.agents[profile.agent_type] || Object.values(source.agents)[0];
    profile.provider = {
      name: source.name,
      api_key: profile.provider.api_key || '',
      base_url: (conf && conf.base_url) || '',
      model: (conf && conf.model) || '',
      env: {},
    };
    toast(`已套用 ${source.display_name}，请填入 API Key。`, 'info');
  } else if (scope === 'local') {
    source = state.presets.local.find((p) => p.name === idx);
    if (!source) return;
    if (source.agent_type) profile.agent_type = source.agent_type;
    profile.provider = {
      name: source.name || 'primary',
      api_key: source.api_key || '',
      base_url: source.base_url || '',
      model: source.model || '',
      env: {},
    };
    toast(`已套用 ${source.label || source.name}。`, 'success');
  } else if (scope === 'custom') {
    source = state.presets.providers[Number(idx)];
    if (!source) return;
    if (source.agent_type) profile.agent_type = source.agent_type;
    profile.provider = {
      name: source.name || 'primary',
      api_key: source.api_key || '',
      base_url: source.base_url || '',
      model: source.model || '',
      env: source.env || {},
    };
    toast(`已套用 ${source.label || source.name}。`, 'success');
  }
  rerenderEditor();
}

function onAgentChange(profile, type) {
  profile.agent_type = type;
  const agent = state.agents.find((a) => a.type === type);
  if (agent) profile.agent_mode = agent.default_mode;
  rerenderEditor();
}

function renderPlatformCard(profile) {
  const card = el('section', { class: 'card' });
  card.appendChild(el('div', { class: 'card-head' },
    el('div', null, el('h3', null, '移动端平台'), el('div', { class: 'head-sub' }, '消息从哪里来。')),
  ));
  const body = el('div', { class: 'card-body' });

  // Type chooser
  const sel = el('select', { class: 'select', onchange: (e) => onPlatformChange(profile, e.target.value) });
  for (const p of state.platforms) sel.appendChild(el('option', { value: p.type, selected: p.type === profile.platform.type }, p.label));

  // Optional preset chooser
  const presetMatching = (state.presets.platforms || []).filter((p) => p.type === profile.platform.type);
  const presetSel = el('select', { class: 'select', onchange: (e) => applyPlatformPreset(profile, e.target.value) });
  presetSel.appendChild(el('option', { value: '' }, presetMatching.length ? '套用凭据预设…' : '暂无匹配的预设'));
  for (const p of presetMatching) presetSel.appendChild(el('option', { value: p.id }, p.label || p.type));
  presetSel.disabled = !presetMatching.length;

  body.appendChild(el('div', { class: 'grid' },
    field('平台类型', sel),
    field('凭据预设', presetSel, presetMatching.length ? `${presetMatching.length} 个匹配。` : '在预设库中维护凭据，新建时可一键套用。'),
  ));

  const schema = (() => {
    const meta = state.platforms.find((p) => p.type === profile.platform.type) || state.platforms[0];
    return resolvedSchema(meta);
  })();

  if (schema.docs) {
    body.appendChild(el('div', { class: 'platform-doc', style: { marginTop: '10px' } },
      schema.description ? `${schema.description}  ` : '',
      el('a', { href: schema.docs, target: '_blank', rel: 'noreferrer noopener' }, '文档 ↗'),
    ));
  }

  body.appendChild(renderPlatformFields(profile, schema));

  card.appendChild(body);
  return card;
}

function renderPlatformFields(profile, schema) {
  const grid = el('div', { class: 'grid', style: { marginTop: '12px' } });
  profile.platform.options = profile.platform.options || {};
  const primary = schema.fields.filter((f) => f.required || f.primary !== false);
  const advanced = schema.fields.filter((f) => !primary.includes(f));

  const renderField = (f) => {
    const value = profile.platform.options[f.key] ?? '';
    const placeholder = f.placeholder || '';
    let control;
    if (f.type === 'bool') {
      control = makeToggle(Boolean(value), (v) => { profile.platform.options[f.key] = v; });
      const wrap = el('div', { class: 'field' + (f.full ? ' full' : '') }, control);
      return wrap;
    }
    if (f.type === 'select') {
      control = el('select', { class: 'select', onchange: (e) => { profile.platform.options[f.key] = e.target.value; } });
      for (const opt of f.options) control.appendChild(el('option', { value: opt, selected: opt === value }, opt || '(default)'));
    } else if (f.type === 'textarea') {
      control = el('textarea', { class: 'textarea', placeholder, oninput: (e) => { profile.platform.options[f.key] = e.target.value; } }, String(value));
    } else if (f.type === 'password') {
      control = el('input', { class: 'input mono', type: 'password', value, placeholder,
        oninput: (e) => { profile.platform.options[f.key] = e.target.value; } });
    } else {
      control = el('input', { class: 'input mono', value, placeholder,
        oninput: (e) => { profile.platform.options[f.key] = e.target.value; } });
    }
    return field(labelWith(f), control, f.help);
  };

  for (const f of primary) grid.appendChild(renderField(f));

  const wrap = el('div', null, grid);

  if (advanced.length) {
    const moreBtn = el('button', { class: 'btn ghost', style: { marginTop: '12px' } }, '＋ 展开高级字段');
    const advGrid = el('div', { class: 'grid', style: { marginTop: '12px', display: 'none' } });
    for (const f of advanced) advGrid.appendChild(renderField(f));
    moreBtn.onclick = () => {
      const hidden = advGrid.style.display === 'none';
      advGrid.style.display = hidden ? 'grid' : 'none';
      moreBtn.textContent = hidden ? '− 收起高级字段' : '＋ 展开高级字段';
    };
    wrap.appendChild(moreBtn);
    wrap.appendChild(advGrid);
  }
  return wrap;
}

function labelWith(f) {
  const label = el('span', null, f.label);
  if (f.required) label.appendChild(el('span', { class: 'req' }, '*'));
  return label;
}

function makeToggle(value, onChange) {
  const wrap = el('label', { class: 'toggle' + (value ? ' on' : '') });
  const input = el('input', { type: 'checkbox', checked: value, onchange: (e) => {
    if (e.target.checked) wrap.classList.add('on'); else wrap.classList.remove('on');
    onChange(e.target.checked);
  } });
  wrap.appendChild(input);
  wrap.appendChild(el('span', { class: 'pip' }));
  wrap.appendChild(el('span', { class: 'lbl' }, '启用'));
  return wrap;
}

function onPlatformChange(profile, type) {
  profile.platform.type = type;
  profile.platform.options = { ...defaultsFor(type) };
  rerenderEditor();
}

function applyPlatformPreset(profile, id) {
  const p = (state.presets.platforms || []).find((x) => x.id === id);
  if (!p) return;
  profile.platform.options = { ...(p.options || {}) };
  toast(`已套用 ${p.label || p.type}`, 'success');
  rerenderEditor();
}

function renderAdvancedCard(profile) {
  const card = el('section', { class: 'card' });
  card.appendChild(el('div', { class: 'card-head' },
    el('div', null, el('h3', null, '高级'), el('div', { class: 'head-sub' }, '默认值通常无需改动。')),
  ));
  const body = el('div', { class: 'card-body' });

  const grid = el('div', { class: 'grid cols-3' });
  const langSel = el('select', { class: 'select', onchange: (e) => { profile.language = e.target.value; } });
  for (const l of ['zh', 'en', 'zh-TW', 'ja', 'es']) langSel.appendChild(el('option', { value: l, selected: l === profile.language }, l));
  grid.appendChild(field('语言', langSel));

  const logSel = el('select', { class: 'select', onchange: (e) => { profile.log_level = e.target.value; } });
  for (const l of ['info', 'debug', 'warn', 'error']) logSel.appendChild(el('option', { value: l, selected: l === profile.log_level }, l));
  grid.appendChild(field('日志级别', logSel));

  grid.appendChild(field('Management 端口', el('input', { class: 'input mono', value: profile.management_port || '', placeholder: '自动',
    oninput: (e) => { profile.management_port = Number(e.target.value) || 0; } }), 'Bridge = mgmt + 1000'));

  body.appendChild(grid);

  body.appendChild(el('div', { class: 'grid', style: { marginTop: '14px' } },
    field('Provider env (JSON)', el('textarea', { class: 'textarea', oninput: (e) => { profile.provider.env = safeJSON(e.target.value); } },
      JSON.stringify(profile.provider?.env || {}, null, 2)), '例如 CLAUDE_CODE_USE_BEDROCK。'),
    field('Management Token', el('input', { class: 'input mono', value: profile.management_token || '',
      oninput: (e) => { profile.management_token = e.target.value; } }), '通常保持默认。'),
  ));

  card.appendChild(body);
  return card;
}

function renderConfigLogsCard(profile) {
  const card = el('section', { class: 'card', style: { padding: '0' } });
  const head = el('div', { class: 'tab-bar' });
  const tabs = el('div', { class: 'tabs' });
  const configTab = el('button', { class: 'tab' + (state.tab === 'config' ? ' active' : ''), onclick: () => { state.tab = 'config'; unsubscribeLogs(); rerenderEditor(); } }, 'config.toml');
  const logsTab = el('button', { class: 'tab' + (state.tab === 'logs' ? ' active' : ''), onclick: () => { state.tab = 'logs'; rerenderEditor(); } }, '日志');
  tabs.appendChild(configTab); tabs.appendChild(logsTab);
  head.appendChild(tabs);

  const tabActions = el('div', { class: 'tab-actions' });
  if (state.tab === 'config') {
    tabActions.appendChild(el('button', { class: 'btn ghost', onclick: () => copyToClipboard(state.configText) }, '复制'));
  } else {
    const liveLbl = el('span', { class: 'hint' }, state.liveSource ? '● 实时' : '○ 已暂停');
    tabActions.appendChild(liveLbl);
    tabActions.appendChild(el('button', { class: 'btn ghost', onclick: () => {
      if (state.liveSource) { unsubscribeLogs(); rerenderEditor(); }
      else { subscribeLogs(profile.name); toast('已连接实时日志流', 'info'); rerenderEditor(); }
    } }, state.liveSource ? '暂停' : '继续'));
  }
  head.appendChild(tabActions);
  card.appendChild(head);

  const pane = el('pre', { class: 'pane', id: state.tab === 'logs' ? 'log-pane' : '' });
  if (state.tab === 'config') {
    pane.textContent = state.configText || '（尚未生成 config）';
  } else {
    const text = state.logsText || '';
    if (!text.trim()) { pane.classList.add('empty'); pane.textContent = '（暂无日志 — 启动 Profile 后会显示输出）'; }
    else {
      for (const line of text.split('\n')) {
        if (!line) continue;
        pane.appendChild(el('div', { class: 'log-line' }, line));
      }
      requestAnimationFrame(() => { pane.scrollTop = pane.scrollHeight; });
    }
  }
  card.appendChild(pane);
  return card;
}

/* -------------------------- Drawer: presets -------------------------- */

function openPresetsDrawer() {
  state.drawer = 'presets';
  mountDrawer();
}
function closeDrawer() {
  const d = $('.drawer');
  if (d) d.remove();
  state.drawer = null;
}
function mountDrawer() {
  const existing = $('.drawer'); if (existing) existing.remove();
  const tpl = $('#tpl-presets-drawer').content.cloneNode(true);
  const drawer = tpl.querySelector('.drawer');
  document.body.appendChild(drawer);
  drawer.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeDrawer));
  const body = drawer.querySelector('[data-body]');
  body.appendChild(renderPresetEditor());
  requestAnimationFrame(() => drawer.classList.add('show'));
}

function renderPresetEditor() {
  const wrap = el('div');
  // Add provider preset
  const provForm = el('section', { class: 'preset-section' },
    el('h4', null, '+ 新增 Provider 预设'),
    el('div', { class: 'grid' },
      field('显示名称', el('input', { class: 'input', id: 'p_label', placeholder: 'OpenAI 主账号' })),
      field('Agent', selectFromAgents('p_agent')),
      field('Provider 名称', el('input', { class: 'input', id: 'p_name', value: 'primary' })),
      field('模型', el('input', { class: 'input mono', id: 'p_model', placeholder: 'gpt-5.4' })),
      field('API Key', el('input', { class: 'input mono', id: 'p_key', type: 'password' })),
      field('Base URL', el('input', { class: 'input mono', id: 'p_base', placeholder: 'https://api.example.com/v1' })),
    ),
    el('div', { class: 'btn-row', style: { marginTop: '10px' } },
      el('button', { class: 'btn primary', onclick: addProviderPreset }, '保存 Provider'),
    ),
  );
  wrap.appendChild(provForm);

  // Add platform preset
  const platSel = el('select', { class: 'select', id: 'mp_type', onchange: () => repaintPresetPlatformFields() });
  for (const p of state.platforms) platSel.appendChild(el('option', { value: p.type }, p.label));
  const platFieldsBox = el('div', { id: 'platFieldsBox', class: 'grid', style: { marginTop: '10px' } });

  const platForm = el('section', { class: 'preset-section', style: { marginTop: '20px' } },
    el('h4', null, '+ 新增移动端平台预设'),
    el('div', { class: 'grid' },
      field('显示名称', el('input', { class: 'input', id: 'mp_label', placeholder: 'Telegram 私人 Bot' })),
      field('平台', platSel),
    ),
    platFieldsBox,
    el('div', { class: 'btn-row', style: { marginTop: '10px' } },
      el('button', { class: 'btn primary', onclick: addPlatformPreset }, '保存平台'),
    ),
  );
  wrap.appendChild(platForm);

  // Existing
  wrap.appendChild(renderExistingPresets());

  // Initial paint of platform fields
  setTimeout(repaintPresetPlatformFields, 0);
  return wrap;
}

function repaintPresetPlatformFields() {
  const sel = document.getElementById('mp_type');
  const box = document.getElementById('platFieldsBox');
  if (!sel || !box) return;
  const type = sel.value;
  const meta = state.platforms.find((p) => p.type === type);
  const schema = resolvedSchema(meta);
  box.innerHTML = '';
  for (const f of schema.fields) {
    let input;
    if (f.type === 'bool') {
      input = el('select', { class: 'select', id: `mpf_${f.key}` },
        el('option', { value: 'false' }, 'false'),
        el('option', { value: 'true' }, 'true'),
      );
    } else if (f.type === 'select') {
      input = el('select', { class: 'select', id: `mpf_${f.key}` });
      for (const opt of f.options) input.appendChild(el('option', { value: opt }, opt || '(default)'));
    } else if (f.type === 'password') {
      input = el('input', { class: 'input mono', id: `mpf_${f.key}`, type: 'password', placeholder: f.placeholder || '' });
    } else {
      input = el('input', { class: 'input mono', id: `mpf_${f.key}`, placeholder: f.placeholder || '' });
    }
    box.appendChild(field(labelWith(f), input, f.help));
  }
}

function renderExistingPresets() {
  const wrap = el('section', { class: 'preset-section', style: { marginTop: '20px' } },
    el('h4', null, '已有预设'),
  );
  const provList = el('div', { class: 'preset-list' });
  if (!state.presets.providers || !state.presets.providers.length) {
    provList.appendChild(el('div', { class: 'hint' }, '暂无自定义 Provider 预设。'));
  } else {
    for (let i = 0; i < state.presets.providers.length; i += 1) {
      const p = state.presets.providers[i];
      provList.appendChild(el('div', { class: 'preset-row' },
        el('div', { class: 'row' },
          el('span', { class: 'name' }, p.label || p.name),
          el('button', { class: 'btn ghost', onclick: () => removePreset('providers', i) }, '⌫'),
        ),
        el('div', { class: 'meta' }, `${p.agent_type || '?'} · ${p.name || ''} · ${p.model || '未指定模型'}`),
      ));
    }
  }
  wrap.appendChild(el('h4', null, 'Provider 预设'));
  wrap.appendChild(provList);

  const platList = el('div', { class: 'preset-list', style: { marginTop: '14px' } });
  if (!state.presets.platforms || !state.presets.platforms.length) {
    platList.appendChild(el('div', { class: 'hint' }, '暂无自定义平台预设。'));
  } else {
    for (let i = 0; i < state.presets.platforms.length; i += 1) {
      const p = state.presets.platforms[i];
      platList.appendChild(el('div', { class: 'preset-row' },
        el('div', { class: 'row' },
          el('span', { class: 'name' }, p.label || p.type),
          el('button', { class: 'btn ghost', onclick: () => removePreset('platforms', i) }, '⌫'),
        ),
        el('div', { class: 'meta' }, `${p.type} · ${Object.keys(p.options || {}).join(', ') || '无字段'}`),
      ));
    }
  }
  wrap.appendChild(el('h4', { style: { marginTop: '14px' } }, '移动端平台预设'));
  wrap.appendChild(platList);

  return wrap;
}

async function addProviderPreset() {
  const label = $('#p_label').value.trim();
  const agent = $('#p_agent').value;
  const name = $('#p_name').value.trim() || 'primary';
  state.presets.providers = state.presets.providers || [];
  state.presets.providers.push({
    label: label || name,
    name,
    agent_type: agent,
    api_key: $('#p_key').value,
    base_url: $('#p_base').value.trim(),
    model: $('#p_model').value.trim(),
    env: {},
  });
  try {
    state.presets = await api.put('/api/presets', state.presets);
    toast('Provider 预设已保存', 'success');
    mountDrawer();
    rerenderEditor();
  } catch (err) { toast(err.message, 'error'); }
}

async function addPlatformPreset() {
  const sel = $('#mp_type');
  const type = sel.value;
  const meta = state.platforms.find((p) => p.type === type);
  const schema = resolvedSchema(meta);
  const options = {};
  for (const f of schema.fields) {
    const node = document.getElementById(`mpf_${f.key}`);
    if (!node) continue;
    const v = node.value;
    if (!v) continue;
    if (f.type === 'bool') options[f.key] = v === 'true';
    else options[f.key] = v;
  }
  state.presets.platforms = state.presets.platforms || [];
  state.presets.platforms.push({
    label: ($('#mp_label').value.trim() || type),
    type,
    options,
  });
  try {
    state.presets = await api.put('/api/presets', state.presets);
    toast('平台预设已保存', 'success');
    mountDrawer();
    rerenderEditor();
  } catch (err) { toast(err.message, 'error'); }
}

async function removePreset(kind, index) {
  state.presets[kind].splice(index, 1);
  try {
    state.presets = await api.put('/api/presets', state.presets);
    toast('预设已删除', 'success');
    mountDrawer();
    rerenderEditor();
  } catch (err) { toast(err.message, 'error'); }
}

function selectFromAgents(id) {
  const sel = el('select', { class: 'select', id });
  for (const a of state.agents) sel.appendChild(el('option', { value: a.type }, a.label));
  return sel;
}

/* -------------------------- Directory picker -------------------------- */

function openDirPicker(start, onChoose) {
  state.modal = 'dir';
  const tpl = $('#tpl-dir-picker').content.cloneNode(true);
  const modal = tpl.querySelector('.modal');
  document.body.appendChild(modal);

  const closeBtns = modal.querySelectorAll('[data-close]');
  closeBtns.forEach((el) => el.addEventListener('click', () => { modal.remove(); state.modal = null; }));
  const list = modal.querySelector('[data-list]');
  const cur = modal.querySelector('[data-current]');
  const pathInput = modal.querySelector('[data-path]');
  const upBtn = modal.querySelector('[data-up]');
  const goBtn = modal.querySelector('[data-go]');
  const chooseBtn = modal.querySelector('[data-choose]');

  let currentPath = start || state.discovery.cwd || state.discovery.home || '/';

  const load = async (p) => {
    try {
      const data = await api.get(`/api/browse?path=${encodeURIComponent(p || '')}`);
      currentPath = data.path; cur.textContent = currentPath; pathInput.value = currentPath;
      list.innerHTML = '';
      if (data.error) list.appendChild(el('li', { class: 'parent' }, `无法读取：${data.error}`));
      for (const entry of data.entries || []) {
        const li = el('li', { class: entry.parent ? 'parent' : '', onclick: () => load(entry.path) },
          el('span', { class: 'name' }, entry.name),
          el('span', { class: 'path' }, entry.path),
        );
        list.appendChild(li);
      }
    } catch (e) { toast(e.message, 'error'); }
  };
  upBtn.onclick = () => load(currentPath.replace(/[\\/][^\\/]*$/, '') || '/');
  goBtn.onclick = () => load(pathInput.value);
  pathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(pathInput.value); });
  chooseBtn.onclick = () => { onChoose(currentPath); modal.remove(); state.modal = null; toast('目录已选择', 'success'); };

  requestAnimationFrame(() => modal.classList.add('show'));
  load(currentPath);
}

/* -------------------------- Confirm modal -------------------------- */

function openConfirm({ title, message, eyebrow, danger = true, onConfirm }) {
  const tpl = $('#tpl-confirm').content.cloneNode(true);
  const modal = tpl.querySelector('.modal');
  document.body.appendChild(modal);
  modal.querySelector('[data-title]').textContent = title || '';
  modal.querySelector('[data-eyebrow]').textContent = eyebrow || '确认';
  modal.querySelector('[data-message]').textContent = message || '';
  modal.querySelectorAll('[data-close], [data-cancel]').forEach((el) => el.addEventListener('click', () => modal.remove()));
  const ok = modal.querySelector('[data-confirm]');
  ok.classList.add(danger ? 'danger' : 'primary');
  ok.textContent = danger ? '删除' : '确认';
  ok.addEventListener('click', async () => { try { await onConfirm(); } finally { modal.remove(); } });
  requestAnimationFrame(() => modal.classList.add('show'));
}

function confirmRemove(profile) {
  openConfirm({
    eyebrow: '危险操作',
    title: `删除 ${profile.name}？`,
    message: `将删除 ${profile.name} 的 config、data 和 logs。如果正在运行将先停止 cc-connect 进程。`,
    onConfirm: async () => {
      try {
        await api.del(`/api/profiles/${encodeURIComponent(profile.name)}`);
        toast('Profile 已删除', 'success');
        state.selectedName = null;
        await reloadProfiles();
        render();
      } catch (e) { toast(e.message, 'error'); }
    },
  });
}

/* -------------------------- Actions -------------------------- */

async function doAction(profile, action) {
  state.pendingAction = true; rerenderEditor();
  try {
    const data = await api.post(`/api/profiles/${encodeURIComponent(profile.name)}/${action}`);
    if (action === 'start' || action === 'restart') {
      if (data.health === 'ready') toast(`${profile.name} 已就绪。`, 'success');
      else if (data.log_tail) {
        toast(`已启动，但 management API 未响应 — 请查看日志。`, 'error');
        state.tab = 'logs';
      } else {
        toast(`${profile.name} 已启动（pid ${data.pid}），等待 management 响应…`, 'info');
      }
    } else if (action === 'stop') {
      toast(`${profile.name} 已停止。`, 'success');
    }
    await reloadProfiles();
    if (state.selectedName === profile.name) {
      await loadConfigAndLogs(profile.name);
    }
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    state.pendingAction = false;
    rerenderEditor();
  }
}

async function saveProfile(profile, isNew) {
  if (!profile.name) { toast('请填写 Profile 名称', 'error'); return; }
  if (!profile.work_dir) { toast('请填写项目路径', 'error'); return; }
  try {
    if (isNew) {
      await api.post('/api/profiles', profile);
      state.draftProfile = null;
      state.selectedName = profile.name;
    } else {
      await api.put(`/api/profiles/${encodeURIComponent(profile.name)}`, profile);
    }
    toast('已保存', 'success');
    await reloadProfiles();
    if (state.selectedName) await loadConfigAndLogs(state.selectedName);
    render();
  } catch (e) { toast(e.message, 'error'); }
}

function startNewProfile() {
  state.selectedName = null;
  state.draftProfile = blankProfile();
  unsubscribeLogs();
  render();
}

async function selectProfile(name) {
  state.selectedName = name;
  state.draftProfile = null;
  state.tab = 'config';
  unsubscribeLogs();
  render();
  await loadConfigAndLogs(name);
  rerenderEditor();
}

/* -------------------------- Utilities -------------------------- */

function rerenderEditor() {
  // Replace only the .main element. For simplicity we re-render the entire body.
  render();
}

function field(label, control, help) {
  const fld = el('div', { class: 'field' });
  const lbl = typeof label === 'string' ? document.createTextNode(label) : label;
  fld.appendChild(el('label', null, lbl));
  fld.appendChild(control);
  if (help) fld.appendChild(el('div', { class: 'help' }, help));
  return fld;
}

function resolvedSchema(metaShim) {
  // /api/platforms gives only { type, label, docs, description }; fields come from /api/platforms/schema?type=
  // To avoid one extra round trip per render, we use an embedded copy keyed by type.
  return PLATFORM_SCHEMAS[metaShim.type] || { fields: [], docs: metaShim.docs || '', description: metaShim.description || '' };
}

const PLATFORM_SCHEMAS = {};

async function loadPlatformSchemas() {
  // Fetch each platform schema once and cache.
  await Promise.all(state.platforms.map(async (p) => {
    if (PLATFORM_SCHEMAS[p.type]) return;
    try {
      const r = await api.get(`/api/platforms/schema?type=${encodeURIComponent(p.type)}`);
      PLATFORM_SCHEMAS[p.type] = r.schema;
    } catch { PLATFORM_SCHEMAS[p.type] = { fields: [], docs: '', description: '' }; }
  }));
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 3)}••••${key.slice(-3)}`;
}

function safeJSON(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); toast('已复制', 'success'); }
  catch { toast('剪贴板不可用', 'error'); }
}

function toast(message, kind = 'info') {
  let host = $('.toast');
  if (!host) { host = el('div', { class: 'toast' }); document.body.appendChild(host); }
  const item = el('div', { class: `toast-item ${kind}` }, el('span', { class: 'dot' }), el('span', { class: 'msg' }, message));
  host.appendChild(item);
  setTimeout(() => {
    item.style.transition = 'opacity .3s';
    item.style.opacity = '0';
    setTimeout(() => item.remove(), 280);
  }, 2400);
}

function svg(d, size = 16) {
  const span = document.createElement('span');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor">${d}</svg>`;
  return span.firstChild;
}

/* -------------------------- Init -------------------------- */

(async function init() {
  try {
    await bootstrap();
    await loadPlatformSchemas();
    render();
  } catch (e) {
    $('#root').innerHTML = `<div class="empty-main"><div><h1>${escapeHtml(e.message)}</h1><p>Profile Manager 服务返回错误。</p></div></div>`;
  }
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      const input = document.querySelector('.topbar .search input');
      if (input) input.focus();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault(); startNewProfile();
    }
    if (e.key === 'Escape') {
      if (state.modal) document.querySelector('.modal')?.remove();
      if (state.drawer) closeDrawer();
      state.modal = null;
    }
  });
})();

function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
