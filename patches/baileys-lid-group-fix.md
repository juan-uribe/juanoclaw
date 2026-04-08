# Baileys LID Group Fix

## Problem
Baileys 6.17.x fails to send messages to WhatsApp groups with `addressing_mode='lid'`
(modern groups). The error is `not-acceptable` (HTTP 406) from `assertSessions`.

## Root cause
In `messages-send.js`, `isLid` is derived from the group JID (`@g.us`), always `false`.
Device JIDs are encoded as `@s.whatsapp.net`, but the server expects `@lid` for pre-key
requests in LID-addressed groups.

## Patch location
`node_modules/@whiskeysockets/baileys/lib/Socket/messages-send.js`

Find the block starting with:
```
if (!participant) {
    const participantsList = ...
```

After `devices.push(...additionalDevices);`, add:
```javascript
const groupUsesLid = isGroup && !!(groupData && groupData.participants &&
  groupData.participants.some(p => typeof p.id === 'string' && p.id.endsWith('@lid')));
const deviceDomain = (isLid || groupUsesLid) ? 'lid' : 's.whatsapp.net';
```

Then replace both occurrences of:
```javascript
jidEncode(user, isLid ? 'lid' : 's.whatsapp.net', device)
```
with:
```javascript
jidEncode(user, deviceDomain, device)
```

## Status
Applied manually. Re-apply after `npm install` upgrades Baileys.
Fixed in Baileys 7.x (not yet stable as of 2026-04-07).
