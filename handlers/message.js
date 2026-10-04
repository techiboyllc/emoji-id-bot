// Get Emoji ID bot — Telegram Serverless handler.
// Send a premium (custom) emoji, a text with several, or a sticker.
// Bot replies with the custom_emoji_id, copy-ready code blocks and copy buttons.

import { api } from 'sdk';

const MAX_LEN = 3800;      // under Telegram's 4096 char limit
const MAX_COPY = 256;      // copy_text button limit
const MAX_BTN_ROWS = 8;    // keep keyboard compact

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const htmlSnippet = (id, f) => `<tg-emoji emoji-id="${id}">${f}</tg-emoji>`;
const mdSnippet = (id, f) => `![${f}](tg://emoji?id=${id})`;

// Collect unique custom emoji IDs. Returns Map<id, fallbackEmoji>.
function collectEmojis(message) {
  const found = new Map();

  const scan = (text, entities) => {
    if (!Array.isArray(entities)) return;
    for (const e of entities) {
      if (e.type !== 'custom_emoji' || !e.custom_emoji_id) continue;
      if (found.has(e.custom_emoji_id)) continue;
      // Offsets are UTF-16 units; JS strings are UTF-16, so substr works.
      const fallback = text ? text.substr(e.offset, e.length) : '';
      found.set(e.custom_emoji_id, fallback || '⭐');
    }
  };

  scan(message.text, message.entities);
  scan(message.caption, message.caption_entities);

  const st = message.sticker;
  if (st && st.custom_emoji_id && !found.has(st.custom_emoji_id)) {
    found.set(st.custom_emoji_id, st.emoji || '⭐');
  }

  return found;
}

function emojiBlock(index, total, id, fallback) {
  const title =
    total > 1
      ? `<b>${index}</b> ┃ ${esc(fallback)}`
      : `${esc(fallback)}  <b>Premium Emoji</b>`;

  return [
    title,
    `🆔 <code>${id}</code>`,
    `<pre><code class="language-HTML">${esc(htmlSnippet(id, fallback))}</code></pre>`,
    `<pre><code class="language-Markdown">${esc(mdSnippet(id, fallback))}</code></pre>`,
  ].join('\n');
}

function stickerBlock(st) {
  const rows = [`🎴 <b>Sticker</b>  ${esc(st.emoji || '')}`, ''];
  rows.push(`<b>Type</b> · <code>${esc(st.type)}</code>`);
  if (st.set_name) rows.push(`<b>Pack</b> · <code>${esc(st.set_name)}</code>`);
  rows.push('');
  rows.push(`<pre><code class="language-file_id">${esc(st.file_id)}</code></pre>`);
  return rows.join('\n');
}

// Copy buttons: per emoji (ID / HTML / MD), plus "copy all IDs" when several.
function buildKeyboard(emojis) {
  const rows = [];
  const list = [...emojis.entries()];
  const btn = (text, copy) =>
    copy.length <= MAX_COPY ? { text, copy_text: { text: copy } } : null;

  if (list.length === 1) {
    const [id, f] = list[0];
    rows.push(
      [btn('📋 ID', id), btn('📋 HTML', htmlSnippet(id, f)), btn('📋 MD', mdSnippet(id, f))]
        .filter(Boolean)
    );
  } else {
    for (const [n, [id, f]] of list.slice(0, MAX_BTN_ROWS).entries()) {
      rows.push(
        [btn(`${n + 1} · ID`, id), btn('HTML', htmlSnippet(id, f)), btn('MD', mdSnippet(id, f))]
          .filter(Boolean)
      );
    }
    const all = list.map(([id]) => id).join(',');
    const allBtn = btn('📋 Copy all IDs', all);
    if (allBtn) rows.push([allBtn]);
  }

  const clean = rows.filter((r) => r.length);
  return clean.length ? { inline_keyboard: clean } : undefined;
}

// Split blocks into messages that fit Telegram's limit.
function pack(header, blocks) {
  const sep = '\n\n';
  const out = [];
  let cur = header;
  for (const b of blocks) {
    const next = cur ? `${cur}${sep}${b}` : b;
    if (next.length > MAX_LEN && cur) {
      out.push(cur);
      cur = b;
    } else {
      cur = next;
    }
  }
  if (cur) out.push(cur);
  return out;
}

async function reply(message, html, keyboard) {
  const params = {
    chat_id: message.chat.id,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_parameters: {
      message_id: message.message_id,
      allow_sending_without_reply: true,
    },
  };
  if (keyboard) params.reply_markup = keyboard;
  await api.sendMessage(params);
}

const START_TEXT = [
  '✨ <b>Get Emoji ID</b>',
  '',
  '<blockquote>Send any <b>premium emoji</b> — one or many.\nGet its ID and copy-ready code for your bots.</blockquote>',
  '',
  '<b>Supports</b>',
  '› Premium / custom emoji',
  '› Several emoji in one message',
  '› Stickers (file_id + pack name)',
].join('\n');

const EMPTY_TEXT = [
  '⚠️ <b>No premium emoji found</b>',
  '',
  '<blockquote>Send a custom (premium) emoji or a sticker.</blockquote>',
].join('\n');

export default async function (message) {
  // Private chats only.
  if (!message || message.chat?.type !== 'private') return;

  const text = message.text || '';

  if (/^\/(start|help)(@\w+)?(\s|$)/i.test(text)) {
    await reply(message, START_TEXT);
    return;
  }

  const emojis = collectEmojis(message);
  const total = emojis.size;
  const blocks = [];
  let i = 1;
  for (const [id, fallback] of emojis) {
    blocks.push(emojiBlock(i++, total, id, fallback));
  }

  // Regular (non-custom-emoji) sticker.
  if (message.sticker && !message.sticker.custom_emoji_id) {
    blocks.push(stickerBlock(message.sticker));
  }

  if (blocks.length === 0) {
    await reply(message, EMPTY_TEXT);
    return;
  }

  const header = total > 1 ? `✨ <b>${total} Premium Emoji</b>` : '';
  const parts = pack(header, blocks);
  const keyboard = total ? buildKeyboard(emojis) : undefined;

  for (let p = 0; p < parts.length; p++) {
    // Buttons only on the last message.
    await reply(message, parts[p], p === parts.length - 1 ? keyboard : undefined);
  }
}
