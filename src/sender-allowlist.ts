import fs from 'fs';

import { SENDER_ALLOWLIST_PATH } from './config.js';
import { logger } from './logger.js';

export interface ChatAllowlistEntry {
  allow: '*' | string[];
  mode: 'trigger' | 'drop';
}

/**
 * One authorized person. `ids` holds every known identifier for that person:
 * bare phone numbers ("523314465615"), @s.whatsapp.net JIDs, @lid values, etc.
 * New LIDs discovered in logs can be appended here without touching the rest
 * of the config.
 */
export interface AllowlistContact {
  name: string;
  ids: string[];
}

/**
 * Global DM allowlist: when enabled, any WhatsApp direct-message whose sender
 * JID does not match a known contact is silently dropped before storage or
 * agent invocation.
 *
 * Use `contacts` (preferred) to group all identifiers per person.
 * The legacy `allowed` flat array is still accepted for backwards compatibility.
 */
export interface DmAllowlistConfig {
  enabled: boolean;
  contacts?: AllowlistContact[];
  allowed?: string[]; // legacy flat list — still checked if present
}

/**
 * When enabled, inbound WA DMs from numbers NOT in the dmAllowlist are
 * routed to this agent instead of being dropped.  The folder must exist
 * under groups/ and contain a CLAUDE.md describing the public persona.
 *
 * Sessions are kept in memory only (not persisted to DB) — they reset on
 * service restart but conversation message history is preserved in the DB.
 */
export interface PublicDmAgentConfig {
  enabled: boolean;
  folder: string; // e.g. "public" → groups/public/CLAUDE.md
}

export interface SenderAllowlistConfig {
  default: ChatAllowlistEntry;
  chats: Record<string, ChatAllowlistEntry>;
  logDenied: boolean;
  dmAllowlist?: DmAllowlistConfig;
  publicDmAgent?: PublicDmAgentConfig;
}

const DEFAULT_CONFIG: SenderAllowlistConfig = {
  default: { allow: '*', mode: 'trigger' },
  chats: {},
  logDenied: true,
};

function isValidEntry(entry: unknown): entry is ChatAllowlistEntry {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  const validAllow =
    e.allow === '*' ||
    (Array.isArray(e.allow) && e.allow.every((v) => typeof v === 'string'));
  const validMode = e.mode === 'trigger' || e.mode === 'drop';
  return validAllow && validMode;
}

export function loadSenderAllowlist(
  pathOverride?: string,
): SenderAllowlistConfig {
  const filePath = pathOverride ?? SENDER_ALLOWLIST_PATH;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_CONFIG;
    logger.warn(
      { err, path: filePath },
      'sender-allowlist: cannot read config',
    );
    return DEFAULT_CONFIG;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ path: filePath }, 'sender-allowlist: invalid JSON');
    return DEFAULT_CONFIG;
  }

  const obj = parsed as Record<string, unknown>;

  if (!isValidEntry(obj.default)) {
    logger.warn(
      { path: filePath },
      'sender-allowlist: invalid or missing default entry',
    );
    return DEFAULT_CONFIG;
  }

  const chats: Record<string, ChatAllowlistEntry> = {};
  if (obj.chats && typeof obj.chats === 'object') {
    for (const [jid, entry] of Object.entries(
      obj.chats as Record<string, unknown>,
    )) {
      if (isValidEntry(entry)) {
        chats[jid] = entry;
      } else {
        logger.warn(
          { jid, path: filePath },
          'sender-allowlist: skipping invalid chat entry',
        );
      }
    }
  }

  let dmAllowlist: DmAllowlistConfig | undefined;
  if (obj.dmAllowlist && typeof obj.dmAllowlist === 'object') {
    const dma = obj.dmAllowlist as Record<string, unknown>;
    if (typeof dma.enabled !== 'boolean') {
      logger.warn(
        { path: filePath },
        'sender-allowlist: dmAllowlist.enabled must be boolean — ignoring',
      );
    } else {
      // Parse contacts (preferred grouped format)
      let contacts: AllowlistContact[] | undefined;
      if (Array.isArray(dma.contacts)) {
        contacts = [];
        for (const c of dma.contacts as unknown[]) {
          if (
            c &&
            typeof c === 'object' &&
            typeof (c as Record<string, unknown>).name === 'string' &&
            Array.isArray((c as Record<string, unknown>).ids) &&
            ((c as Record<string, unknown>).ids as unknown[]).every(
              (v) => typeof v === 'string',
            )
          ) {
            contacts.push(c as AllowlistContact);
          } else {
            logger.warn(
              { path: filePath },
              'sender-allowlist: skipping invalid contact entry in dmAllowlist',
            );
          }
        }
      }

      // Parse legacy flat allowed list
      let allowed: string[] | undefined;
      if (Array.isArray(dma.allowed)) {
        if ((dma.allowed as unknown[]).every((v) => typeof v === 'string')) {
          allowed = dma.allowed as string[];
        } else {
          logger.warn(
            { path: filePath },
            'sender-allowlist: dmAllowlist.allowed must be string[] — ignoring',
          );
        }
      }

      dmAllowlist = { enabled: dma.enabled, contacts, allowed };
    }
  }

  let publicDmAgent: PublicDmAgentConfig | undefined;
  if (obj.publicDmAgent && typeof obj.publicDmAgent === 'object') {
    const pub = obj.publicDmAgent as Record<string, unknown>;
    if (
      typeof pub.enabled === 'boolean' &&
      typeof pub.folder === 'string' &&
      pub.folder
    ) {
      publicDmAgent = { enabled: pub.enabled, folder: pub.folder };
    } else {
      logger.warn(
        { path: filePath },
        'sender-allowlist: invalid publicDmAgent entry — ignoring',
      );
    }
  }

  return {
    default: obj.default as ChatAllowlistEntry,
    chats,
    logDenied: obj.logDenied !== false,
    dmAllowlist,
    publicDmAgent,
  };
}

function getEntry(
  chatJid: string,
  cfg: SenderAllowlistConfig,
): ChatAllowlistEntry {
  return cfg.chats[chatJid] ?? cfg.default;
}

export function isSenderAllowed(
  chatJid: string,
  sender: string,
  cfg: SenderAllowlistConfig,
): boolean {
  const entry = getEntry(chatJid, cfg);
  if (entry.allow === '*') return true;
  return entry.allow.includes(sender);
}

export function shouldDropMessage(
  chatJid: string,
  cfg: SenderAllowlistConfig,
): boolean {
  return getEntry(chatJid, cfg).mode === 'drop';
}

export function isTriggerAllowed(
  chatJid: string,
  sender: string,
  cfg: SenderAllowlistConfig,
): boolean {
  const allowed = isSenderAllowed(chatJid, sender, cfg);
  if (!allowed && cfg.logDenied) {
    logger.debug(
      { chatJid, sender },
      'sender-allowlist: trigger denied for sender',
    );
  }
  return allowed;
}

/**
 * Check whether an inbound DM should be allowed through the global DM
 * allowlist.  Returns `true` when:
 *   - dmAllowlist is not configured or disabled, OR
 *   - the JID's user portion or the full JID appears in `allowed`
 *
 * Matching is done against both the bare phone/LID number and the full
 * JID so the config accepts entries like "15551234567" (phone only) or
 * "15551234567@s.whatsapp.net" (full JID) interchangeably.
 */
export function isDmSenderAllowed(
  chatJid: string,
  cfg: SenderAllowlistConfig,
): boolean {
  const dmCfg = cfg.dmAllowlist;
  if (!dmCfg?.enabled) return true;

  // Strip @domain and :device suffix to get the bare number/LID.
  const jidUser = chatJid.split('@')[0].split(':')[0];

  const matches = (entry: string) => entry === chatJid || entry === jidUser;

  // Check contacts (preferred grouped format)
  if (dmCfg.contacts?.some((contact) => contact.ids.some(matches))) return true;

  // Check legacy flat allowed list
  if (dmCfg.allowed?.some(matches)) return true;

  return false;
}
