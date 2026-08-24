/* scripts/lib/util.mjs — 収集スクリプト共通の小道具（依存ゼロ） */

import { mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const PUBLIC_DIR = resolve(REPO, 'public');
export const DATA_DIR = resolve(PUBLIC_DIR, 'data');
export const STATE_DIR = resolve(REPO, 'state');
export const PREV_DIR = resolve(STATE_DIR, 'prev');
export const SNAP_DIR = resolve(STATE_DIR, 'snapshots');

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function ensureDir(p) { await mkdir(p, { recursive: true }); }

export async function readJSON(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
}

export async function writeJSON(path, value, { pretty = false } = {}) {
  await ensureDir(dirname(path));
  await writeFile(path, JSON.stringify(value, null, pretty ? 2 : 0), 'utf8');
}

export async function listDir(path) {
  try { return await readdir(path); } catch { return []; }
}

export async function removeFile(path) { await rm(path, { force: true }); }

export async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

/** YouTube の割当は太平洋時間の 0:00 にリセットされる。その日付を YYYY-MM-DD で返す。 */
export function quotaDate(now = new Date(), timeZone = 'America/Los_Angeles') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** UTC 日付（スナップショットのファイル名用）。 */
export const utcDate = (now = new Date()) => now.toISOString().slice(0, 10);

/** 並列度を絞って map する。 */
export async function pMap(items, fn, concurrency = 6) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/** ISO8601 duration (PT1H2M3S) を秒に。 */
export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso || '');
  if (!m) return 0;
  const [, d, h, mi, s] = m;
  return (+d || 0) * 86400 + (+h || 0) * 3600 + (+mi || 0) * 60 + Math.round(+s || 0);
}

export const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** シンプルなログ（秘密情報は絶対に出さない）。 */
export const log = {
  info: (...a) => console.log('•', ...a),
  warn: (...a) => console.warn('!', ...a),
  step: (...a) => console.log('\n▸', ...a),
  done: (...a) => console.log('✓', ...a),
};

/** `--key=value` / `--flag` を解釈する。 */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, ...rest] = a.slice(2).split('=');
      out[k] = rest.length ? rest.join('=') : true;
    } else out._.push(a);
  }
  return out;
}
