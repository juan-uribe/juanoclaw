import fs from 'fs';
import path from 'path';

import {
  downloadMediaMessage,
  normalizeMessageContent,
  WAMessage,
  WASocket,
} from '@whiskeysockets/baileys';

// Cap on inbound document size we're willing to store (bank statements are small).
const MAX_DOC_BYTES = 25 * 1024 * 1024;

/**
 * Sanitize a WhatsApp-provided filename into a safe basename ending in .pdf.
 */
function safePdfName(raw: string | null | undefined): string {
  const base = path.basename(raw || 'document.pdf').replace(/[^A-Za-z0-9._-]/g, '_');
  const trimmed = base.replace(/^_+/, '') || 'document.pdf';
  return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
}

/** Return the PDF documentMessage (unwrapped) plus a safe filename, or null. */
function getPdfDocument(
  msg: WAMessage,
): { fileName: string } | null {
  const content = normalizeMessageContent(msg.message);
  const doc = content?.documentMessage;
  if (!doc || doc.mimetype !== 'application/pdf') return null;
  return { fileName: safePdfName(doc.fileName || doc.title) };
}

export function isPdfDocumentMessage(msg: WAMessage): boolean {
  return getPdfDocument(msg) !== null;
}

/**
 * Download a PDF document message and save it into destDir. Returns the stored
 * filename (timestamp-prefixed) or null if it isn't a PDF / download failed /
 * exceeds the size cap.
 */
export async function savePdfDocumentMessage(
  msg: WAMessage,
  sock: WASocket,
  destDir: string,
): Promise<{ fileName: string } | null> {
  const info = getPdfDocument(msg);
  if (!info) return null;

  const buffer = (await downloadMediaMessage(
    // Normalize so downloadMediaMessage sees documentMessage at the top level
    // (documentWithCaptionMessage and other containers get unwrapped).
    { ...msg, message: normalizeMessageContent(msg.message) },
    'buffer',
    {},
    {
      logger: console as never,
      reuploadRequest: sock.updateMediaMessage,
    },
  )) as Buffer;

  if (!buffer || buffer.length === 0) {
    console.error('Failed to download document message');
    return null;
  }
  if (buffer.length > MAX_DOC_BYTES) {
    console.error(`Document too large (${buffer.length} bytes), skipping`);
    return null;
  }

  fs.mkdirSync(destDir, { recursive: true });
  const stored = `${Date.now()}-${info.fileName}`;
  fs.writeFileSync(path.join(destDir, stored), buffer);
  return { fileName: stored };
}
