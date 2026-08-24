#!/usr/bin/env node
/* scripts/validate.mjs — public/data/*.json を docs/SCHEMA.md に照らして検証する（ORDER §6 P1 検収）
 *
 *   node scripts/validate.mjs           … 全部見る
 *   node scripts/validate.mjs --quiet   … 失敗時だけ出力
 *
 * 判定ルールそのものは scripts/lib/schema.mjs（Node 依存なし）にある。
 * 失敗があれば終了コード 1。CI はこれで落ちる。
 */

import { join } from 'node:path';
import { DATA_DIR, listDir, parseArgs, readJSON } from './lib/util.mjs';
import { staleWarnings, validateIndex, validateMap, validateRanking, validateTags } from './lib/schema.mjs';

const args = parseArgs();
const quiet = !!args.quiet;
const errors = [];
const warnings = [];
let checked = 0;

const files = (await listDir(DATA_DIR)).filter(f => f.endsWith('.json')).sort();
if (!files.length) {
  console.error('validate: public/data has no JSON files. Run `npm run mock` or `npm run collect` first.');
  process.exit(1);
}

const index = await readJSON(join(DATA_DIR, 'index.json'), null);
if (!index) {
  errors.push('index.json is missing or unreadable');
} else {
  errors.push(...validateIndex(index));
  warnings.push(...staleWarnings(index.datasets));
  checked++;
}

for (const f of files) {
  if (f === 'index.json') continue;
  const obj = await readJSON(join(DATA_DIR, f), null);
  if (!obj) { errors.push(`${f}: unreadable JSON`); continue; }
  checked++;
  if (f === 'map.json') { errors.push(...validateMap(obj)); continue; }
  if (f.startsWith('tags-')) { errors.push(...validateTags(obj, { filename: f })); continue; }
  errors.push(...validateRanking(obj, { filename: f }));
}

// index.datasets と実ファイルの整合
if (index?.datasets) {
  const onDisk = new Set(files.filter(f => f !== 'index.json' && f !== 'map.json' && !f.startsWith('tags-'))
    .map(f => f.replace(/\.json$/, '')));
  for (const id of Object.keys(index.datasets)) {
    if (!onDisk.has(id)) errors.push(`index.json lists dataset "${id}" but public/data/${id}.json does not exist`);
  }
  for (const id of onDisk) {
    if (!index.datasets[id]) errors.push(`public/data/${id}.json exists but index.json does not list it`);
  }
}

if (!quiet || errors.length) {
  console.log(`validate: ${checked} file(s) checked`);
  warnings.forEach(w => console.warn('  ! ' + w));
}
if (errors.length) {
  console.error(`\nvalidate: ${errors.length} problem(s)\n`);
  errors.slice(0, 60).forEach(e => console.error('  ✗ ' + e));
  if (errors.length > 60) console.error(`  … and ${errors.length - 60} more`);
  process.exit(1);
}
console.log('validate: ok');
