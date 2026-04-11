# WhatsApp DM Access Control

## Problem

WhatsApp uses an internal addressing system called **LID** (`@lid` JIDs, e.g. `77966591668399@lid`) that is separate from phone-based JIDs (`523314465615@s.whatsapp.net`). A single person can appear under multiple JIDs:

- `523314465615@s.whatsapp.net` — standard phone JID
- `5213314465615@s.whatsapp.net` — Mexico 521-prefix variant
- `77966591668399@lid` — the actual JID WhatsApp uses when sending messages
- `211754856530172@lid` — another LID alias

Because of this, incoming DMs may arrive with a `@lid` JID that is not in `registered_groups`. The original code allowed-by-default when the identity was unknown, so **Andy responded to DMs from any phone number**.

## Solution Overview

Three coordinated changes:

1. **`whatsapp.ts` — deny-by-default** for unknown/non-owner `@lid` DMs
2. **`inMemoryOnly` pattern** in `index.ts` — startup alias registrations never write to DB
3. **Canonical `@lid` entry in DB** — owner's chat LID is loaded at startup via `loadState()`

---

## Code Changes

### 1. `src/channels/whatsapp.ts`

Added a public method to expose the LID → phone cache:

```typescript
getLidPhone(lidUser: string): string | undefined {
  return this.lidToPhoneMap[lidUser];
}
```

Replaced the allow-by-default block in `messages.upsert` with deny-by-default:

```typescript
// Only allow unregistered @lid DMs from the owner.
// Deny by default: if no phone mapping is cached the identity is
// unknown and the message is discarded. If a mapping exists but the
// phone is not in registeredGroups (not the owner) it is also blocked.
if (isUnregisteredLidDm && WA_OWNER_NUMBER) {
  const lidUser = rawJid.split('@')[0].split(':')[0];
  const cachedPhone = this.lidToPhoneMap[lidUser];
  const isOwner = !!cachedPhone && !!groups[cachedPhone];
  if (!isOwner) {
    logger.warn(
      { chatJid, cachedPhone: cachedPhone ?? 'unknown' },
      cachedPhone
        ? 'Blocked non-owner LID DM (phone not in registered groups)'
        : 'Blocked unidentified LID DM (no phone mapping)',
    );
    isUnregisteredLidDm = false;
  }
}
```

### 2. `src/index.ts`

Added `inMemoryOnly` parameter to `registerGroup()`:

```typescript
function registerGroup(
  jid: string,
  group: RegisteredGroup,
  inMemoryOnly = false,
): void {
  // ... resolve folder, return early if invalid ...
  registeredGroups[jid] = group;
  // inMemoryOnly: skip DB write to avoid overwriting the canonical JID stored in
  // registered_groups (the folder column has a UNIQUE constraint, so any write
  // with the same folder would replace the canonical entry).
  if (!inMemoryOnly) {
    setRegisteredGroup(jid, group);
  }
  // ... create folder, copy CLAUDE.md, log ...
}
```

All startup alias registrations pass `inMemoryOnly = true`:

- `registerGroup(ownerJid, { ... }, true)` — phone JID alias
- `registerGroup(resolvedJid, { ... }, true)` — `resolvePhoneToJid` result
- `registerGroup(chatJid, { ... }, true)` — `onMessage` auto-registration
- The post-connect LID loop that reads from `getLidDmChats()` also uses `true`

Removed the old `getLidDmChats()` startup loop that ran before channels connected and registered all `@lid` DMs blindly.

Added a filtered post-connect loop (inside `if (waChannel)`, after `resolvePhoneToJid`):

```typescript
const ownerGroup = registeredGroups[resolvedJid] ?? registeredGroups[phoneJid] ??
  Object.values(registeredGroups).find((g) => g.folder === 'personal');
if (ownerGroup) {
  for (const lidJid of getLidDmChats()) {
    if (!registeredGroups[lidJid]) {
      const lidUser = lidJid.split('@')[0];
      const cachedPhone = waChannel.getLidPhone(lidUser);
      if (cachedPhone && registeredGroups[cachedPhone]) {
        registerGroup(lidJid, { ...ownerGroup, added_at: new Date().toISOString() }, true);
        logger.info({ lidJid }, 'Registered owner LID DM from DB');
      }
    }
  }
}
```

---

## One-Time DB Setup (per deployment)

The owner's canonical LID JID must be in `registered_groups` so it loads at startup via `loadState()`. Without this, every message from the owner is blocked until `chats.phoneNumberShare` fires (which may never happen on first boot).

### How to find the canonical LID

1. Start nanoclaw normally (with the code changes above deployed)
2. Send a message from the owner's phone to Andy
3. Check logs: look for `chatJid` in the `messages.upsert` handler — it will be something like `77966591668399@lid`
4. Or query the DB: `SELECT jid FROM registered_groups WHERE folder = 'personal'` — after first auto-registration it will appear there briefly before being replaced (see below)

### Insert via Node.js script

**Critical**: use `better-sqlite3` (Node.js), NOT the `sqlite3` CLI. The running process uses WAL mode and the UNIQUE constraint on `folder` means a CLI insert gets silently overwritten on the next checkpoint (see Gotchas below).

```javascript
const Database = require('better-sqlite3');
const db = new Database('store/messages.db');
db.prepare(`
  INSERT OR REPLACE INTO registered_groups
    (jid, name, folder, trigger_pattern, added_at, is_main, requires_trigger)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  '77966591668399@lid',   // replace with actual canonical LID
  'Personal (WhatsApp)',
  'personal',
  '@Andy',                // replace with your trigger pattern
  new Date().toISOString(),
  1,
  0,
);
db.close();
```

Run while nanoclaw is **stopped**, then start nanoclaw. The `inMemoryOnly` code ensures this entry is never overwritten by startup alias registrations.

---

## Gotchas

### UNIQUE constraint on `folder`

`registered_groups` has `folder TEXT NOT NULL UNIQUE`. This means only one row per folder name can exist at a time. Every `INSERT OR REPLACE` with `folder='personal'` deletes the previous entry. Without `inMemoryOnly`, every startup (which registers multiple aliases: phone JID, 521-prefix JID, resolved LID) would silently delete and replace the canonical entry with whichever alias ran last.

### `sqlite3` CLI vs `better-sqlite3`

Inserts made with the `sqlite3` shell while nanoclaw is running appear to succeed but get overwritten when the running process checkpoints its WAL. Always use a Node.js script with `better-sqlite3` for manual DB inserts.

### Phone mapping race condition

At startup, `chats.phoneNumberShare` events (which populate `lidToPhoneMap`) may not have fired yet when the post-connect loop runs. This is why the canonical LID must be in the DB — it bypasses the phone mapping entirely and is loaded directly by `loadState()`.

### Sender Allowlist is NOT the right tool for DM access control

`~/.config/nanoclaw/sender-allowlist.json` is designed for filtering participants within **group** chats. In a DM, `sender === chatJid`, making sender-based filtering circular and useless for this purpose. The `whatsapp.ts` deny-by-default fix is the correct and only mechanism for DM access control.

---

## Re-Deployment Checklist

When standing up this NanoClaw instance on a new machine:

1. Deploy code with all three changes (see Code Changes above)
2. Build: `npm run build`
3. Start nanoclaw and let it connect to WhatsApp (scan QR code)
4. Send one message from the owner's phone to Andy — check logs for the owner's canonical LID JID
5. Stop nanoclaw
6. Run the Node.js insert script with the correct LID JID
7. Start nanoclaw — verify `groupCount` in startup logs includes the personal group
8. Send a test DM from a non-owner number — confirm it is blocked with a `warn` log
9. Send a DM from the owner — confirm Andy responds

The fix is complete when startup logs show the personal group loaded and non-owner DMs are blocked at the `whatsapp.ts` gate.
