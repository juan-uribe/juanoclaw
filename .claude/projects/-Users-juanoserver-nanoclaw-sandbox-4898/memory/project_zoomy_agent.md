---
name: Zoomy WhatsApp agent — Zoom scheduler
description: Status and details of the Zoomy agent for scheduling Zoom sessions via WhatsApp
type: project
---

Zoomy is a WhatsApp-only agent registered in the Zoomy-ECIHEM group for scheduling Zoom sessions.

**Why:** User wanted a dedicated agent that reads all messages (no trigger) from a specific WhatsApp group and helps schedule Zoom sessions.

**How to apply:** When the user asks about the Zoom scheduling agent or wants to wire up Zoom API credentials, refer to this context.

## Setup Status

- Group: Zoomy - ECIHEM (`120363424868686457@g.us`)
- Folder: `groups/whatsapp_zoomy-ecihem/`
- Channel: WhatsApp (personal number 523332489836)
- Trigger: none required (reads all messages)
- CLAUDE.md: created in Spanish, CST/UTC-6, Guadalajara timezone
- Persona: "Zoomy" with 📅 emoji signature

## Pending

Zoom API credentials NOT yet configured. The agent knows how to call the Zoom API once these env vars are set:
- `ZOOM_ACCOUNT_ID`
- `ZOOM_CLIENT_ID`  
- `ZOOM_CLIENT_SECRET`

These are Server-to-Server OAuth credentials from a Zoom Marketplace app.
