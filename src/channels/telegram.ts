import { Bot, Context } from 'grammy';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Channel, NewMessage, OnChatMetadata, OnInboundMessage, RegisteredGroup } from '../types.js';
import { registerChannel } from './registry.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';

function makeProxyAgent(): HttpsProxyAgent<string> | undefined {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxyUrl) return undefined;
  logger.debug({ proxyUrl }, 'Telegram: using HTTPS proxy');
  return new HttpsProxyAgent(proxyUrl);
}

const TELEGRAM_JID_PREFIX = 'tg:';

function chatIdToJid(chatId: number): string {
  return `${TELEGRAM_JID_PREFIX}${chatId}`;
}

function jidToChatId(jid: string): number {
  return parseInt(jid.slice(TELEGRAM_JID_PREFIX.length), 10);
}

class TelegramChannel implements Channel {
  name = 'telegram';
  private bot: Bot;
  private connected = false;
  private onMessage: OnInboundMessage;
  private onChatMetadata: OnChatMetadata;
  private registeredGroups: () => Record<string, RegisteredGroup>;

  constructor(
    token: string,
    opts: {
      onMessage: OnInboundMessage;
      onChatMetadata: OnChatMetadata;
      registeredGroups: () => Record<string, RegisteredGroup>;
    },
  ) {
    const proxyAgent = makeProxyAgent();
    this.bot = new Bot(token, proxyAgent ? { client: { baseFetchConfig: { agent: proxyAgent } } } : undefined);
    this.onMessage = opts.onMessage;
    this.onChatMetadata = opts.onChatMetadata;
    this.registeredGroups = opts.registeredGroups;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.bot.command('chatid', async (ctx: Context) => {
      const chatId = ctx.chat?.id;
      if (chatId !== undefined) {
        await ctx.reply(`Chat ID: \`${chatId}\`\nJID: \`${chatIdToJid(chatId)}\``, {
          parse_mode: 'Markdown',
        });
      }
    });

    this.bot.on('message', (ctx: Context) => {
      const msg = ctx.message;
      if (!msg || !ctx.chat) return;

      const chatId = ctx.chat.id;
      const jid = chatIdToJid(chatId);
      const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      const chatName =
        'title' in ctx.chat
          ? ctx.chat.title
          : ('first_name' in ctx.chat ? ctx.chat.first_name : '') +
            ('last_name' in ctx.chat && ctx.chat.last_name ? ` ${ctx.chat.last_name}` : '');
      const timestamp = new Date(msg.date * 1000).toISOString();

      this.onChatMetadata(jid, timestamp, chatName, 'telegram', isGroup);

      const groups = this.registeredGroups();
      if (!groups[jid]) return;

      const from = msg.from;
      if (!from) return;

      const senderName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || String(from.id);
      const text = msg.text ?? msg.caption ?? '';
      if (!text) return;

      const newMsg: NewMessage = {
        id: `tg_${msg.message_id}_${chatId}`,
        chat_jid: jid,
        sender: String(from.id),
        sender_name: senderName,
        content: text,
        timestamp,
        is_from_me: false,
        is_bot_message: from.is_bot,
      };

      this.onMessage(jid, newMsg);
    });

    this.bot.catch((err) => {
      logger.error({ err }, 'Telegram bot error');
    });
  }

  async connect(): Promise<void> {
    // Verify token before starting long-poll
    await this.bot.api.getMe();
    this.bot.start({ drop_pending_updates: true }).catch((err) => {
      logger.error({ err }, 'Telegram polling error');
    });
    this.connected = true;
    logger.info('Telegram channel connected');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const chatId = jidToChatId(jid);
    const MAX = 4096;
    for (let i = 0; i < text.length; i += MAX) {
      await this.bot.api.sendMessage(chatId, text.slice(i, i + MAX));
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!isTyping) return;
    const chatId = jidToChatId(jid);
    await this.bot.api.sendChatAction(chatId, 'typing').catch(() => {});
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(TELEGRAM_JID_PREFIX);
  }

  async disconnect(): Promise<void> {
    await this.bot.stop();
    this.connected = false;
    logger.info('Telegram channel disconnected');
  }
}

registerChannel('telegram', (opts) => {
  const token = process.env.TELEGRAM_BOT_TOKEN || readEnvFile(['TELEGRAM_BOT_TOKEN']).TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  return new TelegramChannel(token, opts);
});
