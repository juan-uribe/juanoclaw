/**
 * Google Sheets sync for PAM's registros.csv
 * Watches groups/pam/registros.csv and syncs to Google Sheets on every change.
 */
import fs from 'fs';
import path from 'path';

import { google } from 'googleapis';

import { GROUPS_DIR, SECRETS_DIR } from './config.js';
import { parseEnvFile } from './env.js';
import { logger } from './logger.js';

const PAM_DIR = path.join(GROUPS_DIR, 'pam');
const CSV_PATH = path.join(PAM_DIR, 'registros.csv');

interface SyncConfig {
  keyPath: string;
  sheetId: string;
}

function loadConfig(): SyncConfig | null {
  const secretsFile = path.join(SECRETS_DIR, 'pam.env');
  const env = parseEnvFile(secretsFile);
  const keyPath = env.GOOGLE_SA_KEY_PATH;
  const sheetId = env.PAM_SHEET_ID;

  if (!keyPath || !sheetId) return null;

  if (!fs.existsSync(keyPath)) {
    logger.warn(
      { keyPath },
      'Google SA key file not found, sheets sync disabled',
    );
    return null;
  }

  return { keyPath, sheetId };
}

function parseCSV(content: string): string[][] {
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.split(','));
}

async function syncToSheet(config: SyncConfig): Promise<void> {
  let content: string;
  try {
    content = fs.readFileSync(CSV_PATH, 'utf-8');
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
    spreadsheetId: config.sheetId,
    fields: 'sheets.properties.title',
  });
  const sheetTitle = meta.data.sheets?.[0]?.properties?.title ?? 'Sheet1';
  const range = `'${sheetTitle}'!A1`;

  await sheets.spreadsheets.values.clear({
    spreadsheetId: config.sheetId,
    range: `'${sheetTitle}'`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  logger.info(
    { rows: rows.length - 1, sheet: sheetTitle },
    'Synced registros.csv to Google Sheets',
  );
}

export function startSheetsSyncWatcher(): void {
  const config = loadConfig();
  if (!config) {
    logger.info('Google Sheets sync not configured, skipping');
    return;
  }

  // Initial sync on startup
  syncToSheet(config).catch((err) =>
    logger.error({ err }, 'Initial sheets sync failed'),
  );

  // Watch the pam directory for changes to registros.csv
  let debounce: ReturnType<typeof setTimeout> | null = null;

  fs.watch(PAM_DIR, (_, filename) => {
    if (filename !== 'registros.csv') return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      syncToSheet(config).catch((err) =>
        logger.error({ err }, 'Sheets sync failed'),
      );
    }, 1500);
  });

  logger.info({ sheetId: config.sheetId }, 'PAM sheets sync watcher started');
}
