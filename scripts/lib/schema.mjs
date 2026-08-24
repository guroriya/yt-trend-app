/* scripts/lib/schema.mjs — docs/SCHEMA.md をコードにしたもの（純粋関数・Node 依存なし）
 *
 * Node 依存を持たないので、ブラウザからも import して検証できる。
 * ローカルに Node が無い開発機（NEEDS_HUMAN.md ゲート0）でも、この検証だけは実行できる。
 *
 * 各 validate* は「エラー文字列の配列」を返す。空配列なら合格。
 */

import { COUNTRIES, SECTIONS, PERIODS, CATEGORIES, RETENTION } from '../../public/js/config.js';

const COUNTRY_IDS = new Set(COUNTRIES.map(c => c.code));
const SECTION_IDS = new Set(SECTIONS.map(s => s.id));
const PERIOD_IDS = new Set(PERIODS.map(p => p.id));
const CATEGORY_IDS = new Set(CATEGORIES.map(c => c.id));

const isISO = v => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = v => v === null || isNum(v);
const isStr = v => typeof v === 'string';

export function validateIndex(o) {
  const e = [];
  if (!o || typeof o !== 'object') return ['index.json: not an object'];
  if (o.schemaVersion !== 1) e.push(`index.json: schemaVersion must be 1 (got ${o.schemaVersion})`);
  if (!isISO(o.generatedAt)) e.push('index.json: generatedAt must be an ISO8601 string');
  if (!['mock', 'youtube-api'].includes(o.source)) e.push(`index.json: source must be "mock" or "youtube-api" (got ${o.source})`);
  if (!Array.isArray(o.countries) || !o.countries.length) e.push('index.json: countries must be a non-empty array');
  else o.countries.filter(c => !COUNTRY_IDS.has(c)).forEach(c => e.push(`index.json: unknown country "${c}"`));

  if (!o.datasets || typeof o.datasets !== 'object') e.push('index.json: datasets must be an object');
  else for (const [id, meta] of Object.entries(o.datasets)) {
    if (!isISO(meta?.generatedAt)) e.push(`index.json: datasets["${id}"].generatedAt must be ISO8601`);
    if (!isNum(meta?.count)) e.push(`index.json: datasets["${id}"].count must be a number`);
    if (typeof meta?.stale !== 'boolean') e.push(`index.json: datasets["${id}"].stale must be a boolean`);
  }

  const g = o.features?.growth;
  if (!g) e.push('index.json: features.growth is required');
  else {
    if (typeof g.enabled !== 'boolean') e.push('index.json: features.growth.enabled must be a boolean');
    if (!isNum(g.daysCollected)) e.push('index.json: features.growth.daysCollected must be a number');
    if (!isNum(g.requiredDays)) e.push('index.json: features.growth.requiredDays must be a number');
    if (!Array.isArray(g.periods)) e.push('index.json: features.growth.periods must be an array');
    else {
      g.periods.filter(p => !PERIOD_IDS.has(p)).forEach(p => e.push(`index.json: growth period "${p}" is unknown`));
      const bad = g.periods.filter(p => !RETENTION.growthPeriods.includes(p));
      bad.forEach(p => e.push(`index.json: growth period "${p}" is not allowed (ORDER §2-14: 年間・全期間は投稿日ベースのまま)`));
    }
    if (g.enabled && !g.periods.length) e.push('index.json: growth.enabled is true but no periods are listed');
  }
  if (typeof o.features?.map !== 'boolean') e.push('index.json: features.map must be a boolean');
  if (typeof o.features?.tags !== 'boolean') e.push('index.json: features.tags must be a boolean');

  if (!o.quota || !isNum(o.quota.spentToday) || !isNum(o.quota.dailyUnits) || typeof o.quota.degraded !== 'boolean') {
    e.push('index.json: quota must be { spentToday:number, dailyUnits:number, degraded:boolean }');
  }
  if (!isStr(o.attribution) || !/YouTube API Services/i.test(o.attribution)) {
    e.push('index.json: attribution must mention "YouTube API Services" (ORDER §8)');
  }
  return e;
}

export function validateRanking(o, { filename = '(inline)' } = {}) {
  const e = [];
  const at = m => `${filename}: ${m}`;
  if (!o || typeof o !== 'object') return [at('not an object')];
  if (o.schemaVersion !== 1) e.push(at(`schemaVersion must be 1 (got ${o.schemaVersion})`));
  if (!COUNTRY_IDS.has(o.country)) e.push(at(`unknown country "${o.country}"`));
  if (!SECTION_IDS.has(o.section)) e.push(at(`unknown section "${o.section}"`));
  if (!PERIOD_IDS.has(o.period)) e.push(at(`unknown period "${o.period}"`));
  if (!CATEGORY_IDS.has(o.category)) e.push(at(`unknown category "${o.category}"`));
  if (!['published', 'growth'].includes(o.metric)) e.push(at(`metric must be "published" or "growth" (got ${o.metric})`));

  const expectId = `${o.country}-${o.section}-${o.period}-${o.category}${o.metric === 'growth' ? '-growth' : ''}`;
  if (o.id !== expectId) e.push(at(`id should be "${expectId}" (got "${o.id}")`));
  if (filename !== '(inline)' && filename.replace(/\.json$/, '') !== o.id) {
    e.push(at(`filename does not match id "${o.id}"`));
  }

  if (!isISO(o.generatedAt)) e.push(at('generatedAt must be ISO8601'));
  if (o.prevGeneratedAt !== null && !isISO(o.prevGeneratedAt)) e.push(at('prevGeneratedAt must be ISO8601 or null'));
  const period = PERIODS.find(p => p.id === o.period);
  if (period && period.days == null) {
    if (o.windowStart !== null) e.push(at('windowStart must be null for the all-time period'));
  } else if (!isISO(o.windowStart)) {
    e.push(at('windowStart must be ISO8601 for a bounded period'));
  }

  if (!Array.isArray(o.items)) return e.concat(at('items must be an array'));
  const cat = CATEGORIES.find(c => c.id === o.category);
  const maxSize = Math.min(cat?.size ?? 100, period?.size ?? 100);
  if (o.items.length > maxSize) e.push(at(`items has ${o.items.length} entries, more than the configured max ${maxSize}`));

  const seen = new Set();
  o.items.forEach((it, i) => {
    const where = `${filename}: items[${i}]`;
    if (it.rank !== i + 1) e.push(`${where}: rank must be ${i + 1} (got ${it.rank})`);
    if (!isStr(it.videoId) || it.videoId.length < 5) e.push(`${where}: videoId looks invalid ("${it.videoId}")`);
    else if (seen.has(it.videoId)) e.push(`${where}: duplicate videoId "${it.videoId}"`);
    else seen.add(it.videoId);
    if (!isStr(it.title)) e.push(`${where}: title must be a string`);
    if (!isStr(it.channelTitle)) e.push(`${where}: channelTitle must be a string`);
    if (!isStr(it.channelId)) e.push(`${where}: channelId must be a string`);
    if (it.publishedAt !== null && !isISO(it.publishedAt)) e.push(`${where}: publishedAt must be ISO8601 or null`);
    if (!isNumOrNull(it.viewCount)) e.push(`${where}: viewCount must be a number or null`);
    if (!isNumOrNull(it.likeCount)) e.push(`${where}: likeCount must be a number or null`);
    if (!isNumOrNull(it.commentCount)) e.push(`${where}: commentCount must be a number or null`);
    if (!isNum(it.durationSec)) e.push(`${where}: durationSec must be a number`);
    if (typeof it.isShort !== 'boolean') e.push(`${where}: isShort must be a boolean`);
    if (o.section === 'shorts' && it.isShort !== true) e.push(`${where}: shorts list must only contain shorts`);
    if (o.section === 'video' && it.isShort === true) e.push(`${where}: video list must not contain shorts`);
    if (it.categoryId !== null && !isStr(it.categoryId)) e.push(`${where}: categoryId must be a string or null`);
    if (!Array.isArray(it.tags)) e.push(`${where}: tags must be an array`);
    else if (it.tags.length > 8) e.push(`${where}: tags must hold at most 8 entries`);
    if (it.prevRank !== null && !isNum(it.prevRank)) e.push(`${where}: prevRank must be a number or null`);
    const expectDelta = it.prevRank == null ? null : it.prevRank - it.rank;
    if (it.delta !== expectDelta) e.push(`${where}: delta must be ${expectDelta} (got ${it.delta})`);
  });

  // 再生数は降順であるべき（同数は許容）
  for (let i = 1; i < o.items.length; i++) {
    const a = o.items[i - 1].viewCount, b = o.items[i].viewCount;
    if (o.metric === 'published' && isNum(a) && isNum(b) && b > a) {
      e.push(at(`items[${i}] viewCount ${b} is greater than items[${i - 1}] ${a} — list is not sorted`));
      break;
    }
  }
  return e;
}

export function validateMap(o) {
  const e = [];
  if (!o || typeof o !== 'object') return ['map.json: not an object'];
  if (o.schemaVersion !== 1) e.push('map.json: schemaVersion must be 1');
  if (!isISO(o.generatedAt)) e.push('map.json: generatedAt must be ISO8601');
  if (!Array.isArray(o.items)) return e.concat('map.json: items must be an array');
  o.items.forEach((it, i) => {
    const where = `map.json: items[${i}]`;
    if (!isStr(it.country) || it.country.length !== 2) e.push(`${where}: country must be a 2-letter code`);
    if (!isNum(it.lat) || it.lat < -90 || it.lat > 90) e.push(`${where}: lat out of range`);
    if (!isNum(it.lon) || it.lon < -180 || it.lon > 180) e.push(`${where}: lon out of range`);
    if (!isStr(it.videoId)) e.push(`${where}: videoId must be a string`);
    if (!isStr(it.title)) e.push(`${where}: title must be a string`);
    if (!isNumOrNull(it.viewCount)) e.push(`${where}: viewCount must be a number or null`);
    if (typeof it.isShort !== 'boolean') e.push(`${where}: isShort must be a boolean`);
  });
  return e;
}

export function validateTags(o, { filename = 'tags.json' } = {}) {
  const e = [];
  if (!o || typeof o !== 'object') return [`${filename}: not an object`];
  if (o.schemaVersion !== 1) e.push(`${filename}: schemaVersion must be 1`);
  if (!COUNTRY_IDS.has(o.country)) e.push(`${filename}: unknown country "${o.country}"`);
  if (!isISO(o.generatedAt)) e.push(`${filename}: generatedAt must be ISO8601`);
  if (!PERIOD_IDS.has(o.period)) e.push(`${filename}: unknown period "${o.period}"`);
  if (!Array.isArray(o.items)) return e.concat(`${filename}: items must be an array`);
  o.items.forEach((it, i) => {
    const where = `${filename}: items[${i}]`;
    if (it.rank !== i + 1) e.push(`${where}: rank must be ${i + 1} (got ${it.rank})`);
    if (!isStr(it.term) || !it.term) e.push(`${where}: term must be a non-empty string`);
    if (!isNum(it.score)) e.push(`${where}: score must be a number`);
    if (!isNum(it.count)) e.push(`${where}: count must be a number`);
    if (it.delta !== null && !isNum(it.delta)) e.push(`${where}: delta must be a number or null`);
    if (!Array.isArray(it.videoIds)) e.push(`${where}: videoIds must be an array`);
  });
  return e;
}

/** ORDER §8: 取得データは30日以内にリフレッシュまたは削除。古すぎるものを警告する。 */
export function staleWarnings(datasets, now = Date.now()) {
  const out = [];
  for (const [id, meta] of Object.entries(datasets || {})) {
    const ageDays = (now - Date.parse(meta.generatedAt)) / 864e5;
    if (ageDays > RETENTION.dataMaxAgeDays) {
      out.push(`${id}: generated ${Math.floor(ageDays)} days ago — ORDER §8 requires refresh or deletion within ${RETENTION.dataMaxAgeDays} days`);
    }
  }
  return out;
}
