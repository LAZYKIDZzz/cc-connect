'use strict';

// Field types: text (default), password, bool, number, textarea
// Each platform has a primary set of fields shown by default; rest collapsed under "advanced".
// Schema mirrors what cc-connect's config.example.toml documents per platform.

const PLATFORMS = [
  {
    type: 'telegram',
    label: 'Telegram',
    description: 'Bot via long polling. No public URL needed.',
    docs: 'https://core.telegram.org/bots',
    fields: [
      { key: 'token', label: 'Bot Token', type: 'password', required: true, placeholder: '123456:ABC-DEF...' },
      { key: 'allow_from', label: 'Allowed user IDs', placeholder: '* (all) or 123,456' },
      { key: 'group_reply_all', label: 'Reply to all group msgs (no @ needed)', type: 'bool' },
      { key: 'share_session_in_channel', label: 'Share session in group', type: 'bool' },
      { key: 'enable_reactions', label: 'Add ⚡ reaction on incoming', type: 'bool' },
    ],
  },
  {
    type: 'feishu',
    label: 'Feishu (CN)',
    description: 'WebSocket long-connection, no public URL needed.',
    docs: 'https://open.feishu.cn',
    fields: [
      { key: 'app_id', label: 'App ID', required: true, placeholder: 'cli_xxxxxx' },
      { key: 'app_secret', label: 'App Secret', type: 'password', required: true },
      { key: 'allow_from', label: 'Allowed open_ids', placeholder: '* (all) or open_id_1,open_id_2' },
      { key: 'allow_chat', label: 'Allowed group chat_ids', placeholder: '*' },
      { key: 'group_only', label: 'Group only (ignore P2P)', type: 'bool' },
      { key: 'group_reply_all', label: 'Reply to all group msgs', type: 'bool' },
      { key: 'enable_feishu_card', label: 'Enable Feishu cards', type: 'bool', default: true },
      { key: 'reaction_emoji', label: 'Incoming reaction emoji', placeholder: 'OnIt' },
      { key: 'done_emoji', label: 'Done reaction emoji', placeholder: 'none' },
    ],
  },
  {
    type: 'lark',
    label: 'Lark (Intl.)',
    description: 'Lark international. WebSocket recommended.',
    docs: 'https://open.larksuite.com',
    fields: [
      { key: 'app_id', label: 'App ID', required: true },
      { key: 'app_secret', label: 'App Secret', type: 'password', required: true },
      { key: 'allow_from', label: 'Allowed open_ids', placeholder: '*' },
      { key: 'enable_feishu_card', label: 'Enable cards', type: 'bool', default: true },
      { key: 'domain', label: 'API domain override', placeholder: 'https://open.larksuite.com' },
    ],
  },
  {
    type: 'slack',
    label: 'Slack',
    description: 'Socket Mode. No public URL needed.',
    docs: 'https://api.slack.com/apps',
    fields: [
      { key: 'bot_token', label: 'Bot Token (xoxb-...)', type: 'password', required: true },
      { key: 'app_token', label: 'App Token (xapp-...)', type: 'password', required: true },
      { key: 'allow_from', label: 'Allowed Slack user IDs', placeholder: '*' },
      { key: 'share_session_in_channel', label: 'Share session in channel', type: 'bool' },
    ],
  },
  {
    type: 'discord',
    label: 'Discord',
    description: 'Gateway WebSocket. No public URL needed.',
    docs: 'https://discord.com/developers/applications',
    fields: [
      { key: 'token', label: 'Bot Token', type: 'password', required: true },
      { key: 'allow_from', label: 'Allowed Discord user IDs', placeholder: '*' },
      { key: 'guild_id', label: 'Guild ID (instant slash registration)' },
      { key: 'group_reply_all', label: 'Reply to all guild msgs', type: 'bool' },
      { key: 'thread_isolation', label: 'Isolate sessions by thread', type: 'bool' },
      { key: 'proxy', label: 'HTTP/SOCKS5 proxy', placeholder: 'http://127.0.0.1:7890' },
    ],
  },
  {
    type: 'dingtalk',
    label: 'DingTalk',
    description: 'Stream mode. No public URL needed.',
    docs: 'https://open-dev.dingtalk.com',
    fields: [
      { key: 'client_id', label: 'Client ID (AppKey)', required: true },
      { key: 'client_secret', label: 'Client Secret (AppSecret)', type: 'password', required: true },
      { key: 'allow_from', label: 'Allowed staff IDs', placeholder: '*' },
      { key: 'share_session_in_channel', label: 'Share session in group', type: 'bool' },
    ],
  },
  {
    type: 'wecom',
    label: 'WeChat Work',
    description: 'Default = HTTP callback. Use websocket mode for the AI Bot endpoint.',
    docs: 'https://work.weixin.qq.com/wework_admin/frame',
    fields: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['', 'websocket'], default: '', help: 'Empty = HTTP callback; websocket = AI Bot' },
      { key: 'corp_id', label: 'Corp ID' },
      { key: 'corp_secret', label: 'Corp Secret', type: 'password' },
      { key: 'agent_id', label: 'Agent ID', placeholder: '1000002' },
      { key: 'callback_token', label: 'Callback Token' },
      { key: 'callback_aes_key', label: 'Callback AES Key (43 chars)' },
      { key: 'port', label: 'Callback port', placeholder: '8081' },
      { key: 'callback_path', label: 'Callback path', placeholder: '/wecom/callback' },
      { key: 'bot_id', label: 'Bot ID (websocket mode)' },
      { key: 'bot_secret', label: 'Bot Secret (websocket mode)', type: 'password' },
      { key: 'allow_from', label: 'Allowed user IDs', placeholder: '*' },
    ],
  },
  {
    type: 'qq',
    label: 'QQ (OneBot v11)',
    description: 'Requires NapCat / LLOneBot adapter beside your QQ client.',
    docs: 'https://github.com/NapNeko/NapCatQQ',
    fields: [
      { key: 'ws_url', label: 'WebSocket URL', required: true, placeholder: 'ws://127.0.0.1:3001' },
      { key: 'token', label: 'Access token (optional)', type: 'password' },
      { key: 'allow_from', label: 'Allowed QQ user IDs', placeholder: '* or 12345,67890' },
      { key: 'share_session_in_channel', label: 'Share session in group', type: 'bool' },
    ],
  },
  {
    type: 'qqbot',
    label: 'QQ Bot (Official)',
    description: 'Official QQ Bot Platform API.',
    docs: 'https://q.qq.com',
    fields: [
      { key: 'app_id', label: 'AppID', required: true },
      { key: 'app_secret', label: 'AppSecret', type: 'password', required: true },
      { key: 'sandbox', label: 'Use sandbox endpoint', type: 'bool' },
      { key: 'allow_from', label: 'Allowed user openids', placeholder: '*' },
      { key: 'markdown_support', label: 'Enable Markdown (msg_type: 2)', type: 'bool' },
    ],
  },
  {
    type: 'line',
    label: 'LINE',
    description: 'HTTP webhook — requires public URL (ngrok, cloudflared).',
    docs: 'https://developers.line.biz/console/',
    fields: [
      { key: 'channel_secret', label: 'Channel Secret', type: 'password', required: true },
      { key: 'channel_token', label: 'Channel Access Token', type: 'password', required: true },
      { key: 'port', label: 'Listen port', placeholder: '8080' },
      { key: 'callback_path', label: 'Callback path', placeholder: '/callback' },
      { key: 'allow_from', label: 'Allowed LINE user IDs', placeholder: '*' },
    ],
  },
  {
    type: 'weibo',
    label: 'Weibo DM',
    description: 'Weibo DMs via WebSocket (open-im.api.weibo.com).',
    docs: 'https://open.weibo.com',
    fields: [
      { key: 'app_id', label: 'App ID', required: true },
      { key: 'app_secret', label: 'App Secret', type: 'password', required: true },
      { key: 'allow_from', label: 'Allowed Weibo user IDs', placeholder: '*' },
    ],
  },
  {
    type: 'weixin',
    label: 'WeChat (personal, ilink)',
    description: 'ilink bot gateway. Run `cc-connect weixin setup` to fetch a token.',
    docs: '',
    fields: [
      { key: 'token', label: 'Bearer token', type: 'password', required: true },
      { key: 'base_url', label: 'Base URL', placeholder: 'https://ilinkai.weixin.qq.com' },
      { key: 'allow_from', label: 'Allowed user IDs', placeholder: '* or user@im.wechat' },
      { key: 'account_id', label: 'Account ID (state isolation)', placeholder: 'default' },
    ],
  },
  {
    type: 'max',
    label: 'MAX messenger',
    description: 'Long-poll by default; webhook also supported.',
    docs: '',
    fields: [
      { key: 'token', label: 'Bot token', type: 'password', required: true },
      { key: 'allow_from', label: 'Allowed MAX user IDs', placeholder: '*' },
      { key: 'webhook_url', label: 'Webhook URL (optional)', placeholder: 'https://bot.example.com/webhook' },
    ],
  },
  {
    type: 'wps-xiezuo',
    label: 'WPS Xiezuo',
    description: 'WPS Open Platform app, WebSocket event push.',
    docs: '',
    fields: [
      { key: 'app_id', label: 'App ID', required: true },
      { key: 'app_secret', label: 'App Secret', type: 'password', required: true },
      { key: 'allow_from', label: 'Allowed WPS user IDs', placeholder: '*' },
      { key: 'base_url', label: 'API base URL', placeholder: 'https://openapi.wps.cn' },
    ],
  },
];

const BY_TYPE = new Map(PLATFORMS.map((p) => [p.type, p]));

function getPlatform(type) {
  return BY_TYPE.get(type) || PLATFORMS[0];
}

function platformList() {
  return PLATFORMS.map((p) => ({ type: p.type, label: p.label, description: p.description, docs: p.docs }));
}

function coerceOptions(type, raw) {
  const schema = getPlatform(type);
  const out = {};
  for (const field of schema.fields) {
    const value = raw && Object.prototype.hasOwnProperty.call(raw, field.key) ? raw[field.key] : undefined;
    if (value === undefined || value === null || value === '') continue;
    if (field.type === 'bool') out[field.key] = value === true || value === 'true';
    else if (field.type === 'number') {
      const n = Number(value);
      if (!Number.isNaN(n)) out[field.key] = n;
    } else {
      out[field.key] = String(value);
    }
  }
  // Carry through fields not in schema (preserve user extras).
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(raw)) {
      if (out[key] === undefined && raw[key] !== '' && raw[key] != null) {
        out[key] = raw[key];
      }
    }
  }
  return out;
}

module.exports = { PLATFORMS, getPlatform, platformList, coerceOptions };
