/* scripts/lib/plan.mjs — API 割当のセーフガード（ORDER §4）
 *
 * やること:
 *   1. config.js の構成から「1回あたり」「1日あたり」の消費 units を算出する
 *   2. 日次見込みが dailyUnits × softLimitRatio(=80%) を超えるなら、
 *      priority の大きいジョブから間隔を倍にして収まるまで落とす（floorHours が下限）
 *   3. 逆に余裕があるなら priority の小さいジョブ（＝ top24h）から間隔を詰める
 *      → QUOTA.dailyUnits を増やすだけで ORDER §4 の理想「24h＝毎時」に自動で近づく
 *
 * 算出根拠と表は docs/BUDGET.md。ここを変えたら向こうも直すこと。
 */

import {
  COUNTRIES, SECTIONS, PERIODS, CATEGORIES, MAP_COUNTRIES, QUOTA, SCHEDULE,
} from '../../public/js/config.js';

/** 1本のランキング（上位 size 件）の費用: ceil(size/50) × (search 100 + videos 1) */
export function costOfList(size) {
  const pages = Math.ceil(size / QUOTA.pageSize);
  return pages * (QUOTA.costSearch + QUOTA.costVideos);
}

const period = id => PERIODS.find(p => p.id === id);
const category = id => CATEGORIES.find(c => c.id === id);

/** ジョブが取りに行くリストの一覧を返す。ここがジョブ定義の唯一の場所。 */
export function listsOfJob(jobId) {
  const out = [];
  const push = (countryCode, sectionId, periodId, categoryId) => {
    const cat = category(categoryId);
    const per = period(periodId);
    out.push({
      country: countryCode, section: sectionId, period: periodId, category: categoryId,
      size: Math.min(cat.size, per.size),
      days: per.days,
      ytCategoryId: cat.ytId,
    });
  };
  const eachCS = fn => COUNTRIES.forEach(c => SECTIONS.forEach(s => fn(c.code, s.id)));

  switch (jobId) {
    case 'top24h':
      eachCS((c, s) => push(c, s, '24h', 'all'));
      break;
    case 'weekmonth':
      eachCS((c, s) => ['week', 'month'].forEach(p => push(c, s, p, 'all')));
      break;
    case 'yearall':
      eachCS((c, s) => ['year', 'all'].forEach(p => push(c, s, p, 'all')));
      break;
    // カテゴリ別は期間ごとに別ジョブ（更新頻度が違う。2026-08-25 発注者改訂で全期間に拡張）。
    // 6カ国化で「1回の費用 < 1日のハード停止」を守るため、旧 catweekmonth / catyearall は
    // 期間単位の4ジョブに分割した（config.js SCHEDULE の不変条件コメント参照）。
    case 'categories':
      eachCS((c, s) => CATEGORIES.filter(x => x.id !== 'all').forEach(cat => {
        cat.periods.filter(p => p === '24h').forEach(p => push(c, s, p, cat.id));
      }));
      break;
    case 'catweek':
    case 'catmonth':
    case 'catyear':
    case 'catall': {
      const period = { catweek: 'week', catmonth: 'month', catyear: 'year', catall: 'all' }[jobId];
      eachCS((c, s) => CATEGORIES.filter(x => x.id !== 'all').forEach(cat => {
        cat.periods.filter(p => p === period).forEach(p => push(c, s, p, cat.id));
      }));
      break;
    }
    case 'map':
    case 'chart':
    case 'tags':
      break;                       // リストは取らない（下の costOfJob で扱う）
    default:
      throw new Error(`unknown job: ${jobId}`);
  }
  return out;
}

/** ジョブ1回あたりの費用（units）。 */
export function costOfJob(jobId) {
  if (jobId === 'map') return MAP_COUNTRIES.length * QUOTA.costVideos;   // chart=mostPopular は 1 unit
  if (jobId === 'chart') return COUNTRIES.length * QUOTA.costVideos;     // 公式急上昇の合流（6カ国×1 unit）
  if (jobId === 'tags') return 0;                                        // 既存 JSON の再集計のみ
  return listsOfJob(jobId).reduce((sum, l) => sum + costOfList(l.size), 0);
}

const runsPerDay = everyHours => 24 / everyHours;

/** 実効間隔の刻み（時間）。24 の約数を並べて、6h → 4h → 3h → 2h → 1h と素直に詰められるようにする。 */
const LADDER = [1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 168, 336, 720];
const slower = h => LADDER.find(v => v > h) ?? LADDER[LADDER.length - 1];
const faster = h => [...LADDER].reverse().find(v => v < h) ?? LADDER[0];

/**
 * 予算に収まるスケジュールを決める。
 * @param {object} [o]
 * @param {number} [o.dailyUnits]
 * @param {number} [o.reservedUnits] 定常ジョブに使わせない予約枠（バックフィル用）。
 *   ソフト上限から差し引くだけで、降格・昇格・スキップの既存ロジックはそのまま働く。
 * @returns {{jobs: Array, dailyUnits: number, softLimit: number, reservedUnits: number, total: number, degraded: boolean, upgraded: boolean}}
 */
export function planSchedule({ dailyUnits = QUOTA.dailyUnits, reservedUnits = 0 } = {}) {
  const softLimit = Math.max(0, Math.floor(dailyUnits * QUOTA.softLimitRatio) - Math.max(0, reservedUnits | 0));
  const jobs = SCHEDULE.jobs.map(j => ({
    ...j,
    costPerRun: costOfJob(j.id),
    everyHours: j.everyHours,
  }));
  const total = () => jobs.reduce((s, j) => s + j.costPerRun * runsPerDay(j.everyHours), 0);

  let degraded = false;
  // ── 降格: priority が大きい（重要度が低い）ものから間隔を倍にする
  let guard = 0;
  while (total() > softLimit && guard++ < 100) {
    const victim = [...jobs]
      .filter(j => j.everyHours < j.floorHours && j.costPerRun > 0)
      .sort((a, b) => b.priority - a.priority)[0];
    if (!victim) break;
    victim.everyHours = Math.min(victim.floorHours, slower(victim.everyHours));
    degraded = true;
  }

  // ── 昇格: 余裕があるなら priority の小さい（重要な）ものから間隔を詰める
  let upgraded = false;
  guard = 0;
  while (guard++ < 100) {
    const candidate = [...jobs]
      .filter(j => j.everyHours > j.desiredHours && j.costPerRun > 0)
      .sort((a, b) => a.priority - b.priority)
      .find(j => {
        const next = Math.max(j.desiredHours, faster(j.everyHours));
        const delta = j.costPerRun * (runsPerDay(next) - runsPerDay(j.everyHours));
        return next < j.everyHours && total() + delta <= softLimit;
      });
    if (!candidate) break;
    candidate.everyHours = Math.max(candidate.desiredHours, faster(candidate.everyHours));
    upgraded = true;
  }

  const finalTotal = Math.round(total());
  // それでも収まらない（国を増やしすぎた等）: 収まるまで priority の大きいジョブを落とす
  const overBudget = finalTotal > softLimit;
  if (overBudget) {
    const sorted = [...jobs].sort((a, b) => b.priority - a.priority);
    for (const j of sorted) {
      if (total() <= softLimit) break;
      if (j.costPerRun > 0) { j.skipped = true; j.everyHours = Infinity; degraded = true; }
    }
    // 落とす順は priority 順なので、安いジョブ（map=26 units）が重いジョブの巻き添えで
    // 消えることがある。空いた枠に収まるものは、重要な順に最低頻度で復活させる。
    for (const j of [...jobs].sort((a, b) => a.priority - b.priority)) {
      if (!j.skipped) continue;
      const at = Math.min(j.floorHours, LADDER[LADDER.length - 1]);
      if (total() + j.costPerRun * runsPerDay(at) <= softLimit) { j.skipped = false; j.everyHours = at; }
    }
  }

  return {
    jobs: jobs.map(j => ({
      id: j.id,
      priority: j.priority,
      everyHours: j.everyHours,
      costPerRun: j.costPerRun,
      dailyUnits: j.skipped ? 0 : Math.round(j.costPerRun * runsPerDay(j.everyHours)),
      skipped: !!j.skipped,
    })),
    dailyUnits,
    softLimit,
    reservedUnits: Math.max(0, reservedUnits | 0),
    total: Math.round(total()),
    degraded,
    upgraded,
  };
}

/** そのジョブを今回実行すべきか。lastRun は ISO 文字列 or null。 */
export function isDue(job, lastRunISO, now = new Date()) {
  if (job.skipped) return false;
  if (!lastRunISO) return true;
  const elapsedH = (now.getTime() - new Date(lastRunISO).getTime()) / 3600e3;
  // cron のゆらぎを吸収するため 5 分ぶんの猶予をもたせる
  return elapsedH >= job.everyHours - 5 / 60;
}

/** 人間が読める予算表（README / ログ用）。 */
export function formatPlan(plan) {
  const rows = plan.jobs.map(j => {
    const every = j.skipped ? 'skipped' : (j.everyHours >= 24
      ? `${j.everyHours / 24} day(s)`
      : `${j.everyHours}h`);
    return `  ${j.id.padEnd(13)} every ${every.padEnd(9)} ${String(j.costPerRun).padStart(5)} u/run  ${String(j.dailyUnits).padStart(6)} u/day`;
  });
  return [
    `plan: ${plan.total} / ${plan.dailyUnits} units per day (soft limit ${plan.softLimit}`
      + `${plan.reservedUnits ? `, ${plan.reservedUnits} reserved for backfill` : ''})`,
    ...rows,
    plan.degraded ? '  ! degraded to stay inside the quota' : '',
    plan.upgraded ? '  + upgraded because quota headroom allows it' : '',
  ].filter(Boolean).join('\n');
}
