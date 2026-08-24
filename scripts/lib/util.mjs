/* scripts/lib/util.mjs — 収集スクリプト共通の小道具（依存ゼロ）
 *
 * Node 組み込み（fs / path / url）を使うものだけをここに置く。
 * 純粋な小道具は ./pure.mjs にあり、ブラウザからも import して検証できる。
 */

import { mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export { sleep, quotaDate, utcDate, pMap, parseDuration, chunk } from './pure.mjs';
import { parseArgs as parseArgsPure } from './pure.mjs';

export const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const PUBLIC_DIR = resolve(REPO, 'public');
export const DATA_DIR = resolve(PUBLIC_DIR, 'data');
export const STATE_DIR = resolve(REPO, 'state');
export const PREV_DIR = resolve(STATE_DIR, 'prev');
export const SNAP_DIR = resolve(STATE_DIR, 'snapshots');

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

/** シンプルなログ（秘密情報は絶対に出さない）。 */
export const log = {
  info: (...a) => console.log('•', ...a),
  warn: (...a) => console.warn('!', ...a),
  step: (...a) => console.log('\n▸', ...a),
  done: (...a) => console.log('✓', ...a),
};

/** `--key=value` / `--flag` を解釈する（既定は process.argv）。 */
export function parseArgs(argv = process.argv.slice(2)) {
  return parseArgsPure(argv);
}
