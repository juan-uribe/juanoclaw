/**
 * Google Sheets sync. Watches each configured group's CSV and mirrors it to a
 * Google Sheet on every change (one-way: CSV is the source of truth).
 *
 * Each target reads its Sheet id + service-account key path from a per-group
 * secrets file (SECRETS_DIR/<secretsFile>). Targets whose secrets are missing
 * are simply skipped, so this is safe to ship before a Sheet is configured.
 */
import fs from 'fs';
import path from 'path';

import { google } from 'googleapis';

import { GROUPS_DIR, SECRETS_DIR } from './config.js';
import { parseEnvFile } from './env.js';
import { logger } from './logger.js';

interface SyncTarget {
  /** Group folder under GROUPS_DIR. */
  folder: string;
  /** CSV filename within the group folder (source of truth). */
  csvFile: string;
  /** Secrets file under SECRETS_DIR holding the SA key path (+ optional Sheet id). */
  secretsFile: string;
  /**
   * Env key in the secrets file holding the target Sheet id. Used for
   * owner-managed sheets whose id lives host-side.
   */
  sheetIdKey?: string;
  /**
   * Filename within the group folder holding the Sheet id (one line). Used
   * for user-provided sheets: the container agent writes this file when the
   * user shares their sheet link, so the id can arrive AFTER startup without
   * the owner touching host secrets. Takes precedence over `sheetIdKey`.
   */
  sheetIdFile?: string;
}

const TARGETS: SyncTarget[] = [
  {
    folder: 'pam',
    csvFile: 'registros.csv',
    secretsFile: 'pam.env',
    sheetIdKey: 'PAM_SHEET_ID',
  },
  {
    folder: 'gastos',
    csvFile: 'gastos.csv',
    secretsFile: 'gastos.env',
    sheetIdKey: 'GASTOS_SHEET_ID',
  },
  {
    // Finanzas (Dany): the sheet is created & shared by the end user, who
    // pastes the link in chat. The agent extracts the id into sheet_id.txt,
    // which this watcher picks up live — no host-side secret edit needed.
    folder: 'finanzas',
    csvFile: 'finanzas.csv',
    secretsFile: 'finanzas.env',
    sheetIdFile: 'sheet_id.txt',
  },
];

interface SyncConfig {
  target: SyncTarget;
  keyPath: string;
  csvPath: string;
  groupDir: string;
  csvFile: string;
  folder: string;
}

/**
 * Load the base sync config for a target. Only the SA key needs to be present
 * here — the Sheet id is resolved dynamically at sync time (via
 * {@link resolveSheetId}) so watchers can start before a user-provided sheet
 * id exists and begin syncing the moment it appears.
 */
function loadConfig(target: SyncTarget): SyncConfig | null {
  const secretsFile = path.join(SECRETS_DIR, target.secretsFile);
  const env = parseEnvFile(secretsFile);
  const keyPath = env.GOOGLE_SA_KEY_PATH;

  if (!keyPath) return null;

  if (!fs.existsSync(keyPath)) {
    logger.warn(
      { keyPath, folder: target.folder },
      'Google SA key file not found, sheets sync disabled for group',
    );
    return null;
  }

  const groupDir = path.join(GROUPS_DIR, target.folder);
  return {
    target,
    keyPath,
    csvPath: path.join(groupDir, target.csvFile),
    groupDir,
    csvFile: target.csvFile,
    folder: target.folder,
  };
}

/** Extract a bare spreadsheet id from a raw string that may be a full URL. */
function extractSheetId(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : trimmed;
}

/**
 * Resolve the current target Sheet id, or null if not configured yet.
 * A per-group `sheetIdFile` (user-provided) takes precedence over the
 * host-side `sheetIdKey` secret.
 */
function resolveSheetId(config: SyncConfig): string | null {
  const { target, groupDir } = config;

  if (target.sheetIdFile) {
    try {
      const raw = fs.readFileSync(
        path.join(groupDir, target.sheetIdFile),
        'utf-8',
      );
      const id = extractSheetId(raw);
      if (id) return id;
    } catch {
      // Not provided yet — fall through.
    }
  }

  if (target.sheetIdKey) {
    const env = parseEnvFile(path.join(SECRETS_DIR, target.secretsFile));
    const id = env[target.sheetIdKey]?.trim();
    if (id) return id;
  }

  return null;
}

/** Parse a single CSV line respecting double-quoted fields (RFC-4180-ish). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCSV(content: string): string[][] {
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map(parseCsvLine);
}

async function syncToSheet(config: SyncConfig): Promise<void> {
  const sheetId = resolveSheetId(config);
  if (!sheetId) return; // No target sheet configured yet — nothing to do.

  let content: string;
  try {
    content = fs.readFileSync(config.csvPath, 'utf-8');
  } catch {
    return; // File doesn't exist yet
  }

  const rows = parseCSV(content);
  if (rows.length === 0) return;

  const auth = new google.auth.GoogleAuth({
    keyFile: config.keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Get the first sheet's name
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets.properties.title',
  });
  const sheetTitle = meta.data.sheets?.[0]?.properties?.title ?? 'Sheet1';
  const range = `'${sheetTitle}'!A1`;

  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `'${sheetTitle}'`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  logger.info(
    { rows: rows.length - 1, sheet: sheetTitle, folder: config.folder },
    'Synced CSV to Google Sheets',
  );
}

function startWatcher(config: SyncConfig): void {
  // Initial sync on startup
  syncToSheet(config).catch((err) =>
    logger.error({ err, folder: config.folder }, 'Initial sheets sync failed'),
  );

  // Watch the group directory for changes to its CSV — and, for
  // user-provided sheets, to the sheet-id file (so sync starts the moment the
  // user shares their sheet, without a restart).
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const watched = new Set(
    [config.csvFile, config.target.sheetIdFile].filter(Boolean) as string[],
  );

  fs.watch(config.groupDir, (_, filename) => {
    if (!filename || !watched.has(filename)) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      syncToSheet(config).catch((err) =>
        logger.error({ err, folder: config.folder }, 'Sheets sync failed'),
      );
    }, 1500);
  });

  logger.info(
    { folder: config.folder, watching: [...watched] },
    'Sheets sync watcher started',
  );
}

export function startSheetsSyncWatcher(): void {
  let started = 0;
  for (const target of TARGETS) {
    const config = loadConfig(target);
    if (!config) continue;
    startWatcher(config);
    started++;
  }
  if (started === 0) {
    logger.info('Google Sheets sync not configured, skipping');
  }
}
