// Get Emoji ID bot — Telegram Serverless handler.
// Send a premium (custom) emoji, a text with several, or a sticker.
// Bot replies with custom_emoji_id + ready-to-use HTML / MarkdownV2 snippets.

import { api } from 'sdk';

const MAX_LEN = 3800; // stay under Telegram's 4096 char message limit

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// Collect unique custom emoji IDs from text, caption and stickers.
// Returns Map<id, fallbackEmoji>.
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

function emojiBlock(index, id, fallback) {
  const f = esc(fallback);
  return [
    `<b>${index}.</b> ${f}`,
    `ID: <code>${id}</code>`,
    `HTML: <code>&lt;tg-emoji emoji-id="${id}"&gt;${f}&lt;/tg-emoji&gt;</code>`,
    `MarkdownV2: <code>![${f}](tg://emoji?id=${id})</code>`,
  ].join('\n');
}

function stickerBlock(st) {
  const lines = ['<b>Sticker info:</b>'];
  if (st.emoji) lines.push(`Emoji: ${esc(st.emoji)}`);
  lines.push(`Type: <code>${esc(st.type)}</code>`);
  if (st.set_name) lines.push(`Set: <code>${esc(st.set_name)}</code>`);
  lines.push(`File ID: <code>${esc(st.file_id)}</code>`);
  lines.push(`Unique ID: <code>${esc(st.file_unique_id)}</code>`);
  return lines.join('\n');
}

// Split blocks into messages that fit Telegram's limit.
function pack(header, blocks) {
  const out = [];
  let cur = header;
  for (const b of blocks) {
    const next = cur ? `${cur}\n\n${b}` : b;
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

async function reply(message, html) {
  await api.sendMessage({
    chat_id: message.chat.id,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_parameters: {
      message_id: message.message_id,
      allow_sending_without_reply: true,
    },
  });
}

const START_TEXT = [
  '👋 <b>Get Emoji ID</b>',
  '',
  'Send me any <b>premium / custom emoji</b> (one or many in a message).',
  'I reply with its ID and ready-to-paste code for bots.',
  '',
  'Also works with stickers (shows file_id and set name).',
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
  const blocks = [];
  let i = 1;
  for (const [id, fallback] of emojis) {
    blocks.push(emojiBlock(i++, id, fallback));
  }

  // Regular (non-custom-emoji) sticker: show sticker info.
  if (message.sticker && !message.sticker.custom_emoji_id) {
    blocks.push(stickerBlock(message.sticker));
  }

  if (blocks.length === 0) {
    await reply(
      message,
      '❌ No premium emoji found.\nSend a custom (premium) emoji or a sticker.'
    );
    return;
  }

  const header = emojis.size
    ? `✅ <b>Found ${emojis.size} emoji ID${emojis.size > 1 ? 's' : ''}:</b>`
    : '';

  for (const part of pack(header, blocks)) {
    await reply(message, part);
  }
}
