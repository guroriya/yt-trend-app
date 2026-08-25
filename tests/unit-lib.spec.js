// ============================================================================
// unit-lib.spec.js — 収集スクリプトの「純粋なロジック」を Node 側で直接テストする
//
// ブラウザを起動しないので速い。ここで守るのは、実 API を叩かずに正しさを確かめられる部分:
//   - scripts/lib/pure.mjs   … 期間パース・割当リセット日・並列度・引数
//   - scripts/lib/plan.mjs   … ORDER §4 の予算プランナ（docs/BUDGET.md の数値と一致すること）
//   - scripts/lib/tags.mjs   … タグ／頻出ワード集計（言語別ストップワード）
//   - scripts/lib/schema.mjs … docs/SCHEMA.md の検証規則（モックデータが通ること）
//
// なぜ重要か: この4つは「実 API キーが無くても壊れていることが分かる」唯一の層で、
// P1 の収集が正しく走るかどうかの大部分をここで先取りして守れる。
// ============================================================================

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseDuration, quotaDate, utcDate, chunk, parseArgs, pMap,
} from '../scripts/lib/pure.mjs';
import { planSchedule, costOfList, costOfJob, listsOfJob, isDue } from '../scripts/lib/plan.mjs';
import { rankTerms, extractTerms } from '../scripts/lib/tags.mjs';
import { validateIndex, validateRanking, validateMap, validateTags } from '../scripts/lib/schema.mjs';
import {
  backfillWindows, poolUpsert, poolEvict, poolStaleIds, poolPrune, poolApplyRefresh, rebuildRanking,
} from '../scripts/lib/backfill.mjs';
import { QUOTA, COUNTRIES, SECTIONS, CATEGORIES, BACKFILL } from '../public/js/config.js';
import { PUBLIC_DIR, readJSON } from './helpers.js';

/* ------------------------------------------------------------------ pure */

test.describe('pure.mjs', () => {
  test('parseDuration は ISO8601 duration を秒にする', () => {
    expect(parseDuration('PT3M2S')).toBe(182);
    expect(parseDuration('PT1H2M3S')).toBe(3723);
    expect(parseDuration('PT30S')).toBe(30);
    expect(parseDuration('PT45M')).toBe(2700);
    expect(parseDuration('P1D')).toBe(86400);
    expect(parseDuration('P1DT2H')).toBe(93600);
    expect(parseDuration('PT1M40.5S')).toBe(101);
    expect(parseDuration('PT0S')).toBe(0);
    // 壊れた入力で例外を投げず 0 を返すこと（1本の異常データで収集を止めない）
    expect(parseDuration('nope')).toBe(0);
    expect(parseDuration(undefined)).toBe(0);
    expect(parseDuration('')).toBe(0);
  });

  test('quotaDate は太平洋時間の日付を返す（割当リセットの境界）', () => {
    // 08-25T06:00Z は PT では 08-24 23:00 → まだ前日の割当
    expect(quotaDate(new Date('2026-08-25T06:00:00Z'))).toBe('2026-08-24');
    // 08-25T08:00Z は PT 01:00 → 新しい日
    expect(quotaDate(new Date('2026-08-25T08:00:00Z'))).toBe('2026-08-25');
    expect(utcDate(new Date('2026-08-25T23:59:00Z'))).toBe('2026-08-25');
  });

  test('chunk と parseArgs', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
    expect(parseArgs(['--jobs=a,b', '--force', 'x'])).toEqual({ _: ['x'], jobs: 'a,b', force: true });
    expect(parseArgs([])).toEqual({ _: [] });
  });

  test('pMap は並列度を超えない', async () => {
    let inFlight = 0, peak = 0;
    const out = await pMap([1, 2, 3, 4, 5, 6, 7, 8], async v => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return v * 2;
    }, 3);
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(peak).toBeLessThanOrEqual(3);
  });
});

/* ------------------------------------------------- plan.mjs（ORDER §4） */

test.describe('plan.mjs — 割当セーフガード', () => {
  test('1本あたりの費用は ceil(N/50) × (search 100 + videos 1)', () => {
    expect(costOfList(50)).toBe(101);
    expect(costOfList(100)).toBe(202);
    expect(costOfList(1)).toBe(101);
  });

  test('ジョブ別の費用が docs/BUDGET.md と一致する（6か国・カテゴリ全期間）', () => {
    expect(listsOfJob('top24h')).toHaveLength(COUNTRIES.length * SECTIONS.length);
    expect(costOfJob('top24h')).toBe(2424);
    expect(costOfJob('weekmonth')).toBe(4848);
    expect(costOfJob('yearall')).toBe(4848);
    expect(costOfJob('categories')).toBe(6060);       // カテゴリ×24h
    expect(costOfJob('catweek')).toBe(6060);          // カテゴリ×週間
    expect(costOfJob('catmonth')).toBe(6060);         // カテゴリ×月間
    expect(costOfJob('catyear')).toBe(6060);          // カテゴリ×年間
    expect(costOfJob('catall')).toBe(6060);           // カテゴリ×全期間
    expect(costOfJob('map')).toBe(60);
    expect(costOfJob('tags')).toBe(0);
    // カテゴリのリストは5ジョブに漏れなく重複なく分かれること（期間で分割しているため）
    const catLists = ['categories', 'catweek', 'catmonth', 'catyear', 'catall'].flatMap(listsOfJob);
    const expected = COUNTRIES.length * SECTIONS.length
      * CATEGORIES.filter(c => c.id !== 'all').reduce((n, c) => n + c.periods.length, 0);
    expect(catLists).toHaveLength(expected);
    expect(new Set(catLists.map(l => `${l.country}/${l.section}/${l.period}/${l.category}`)).size)
      .toBe(expected);
  });

  test('既定割当では 1日 7,823 units、ソフト上限 8,000 の下に収まる（2026-08-25 第3弾）', () => {
    const plan = planSchedule({ dailyUnits: 10000 });
    expect(plan.total).toBe(7823);
    expect(plan.total).toBeLessThanOrEqual(plan.softLimit);
    // 発注者指示「24時間ランキングは当面毎日1回でよい」＝ desiredHours=24 のキャップ
    expect(plan.jobs.find(j => j.id === 'top24h').everyHours).toBe(24);
    // 24h を毎日に緩めたぶんで 6か国が既定割当に収まる（degraded しない）
    expect(plan.degraded).toBe(false);
    // 余った予算は weekmonth（priority 2）へ自動で流れる（3日→2日）
    expect(plan.jobs.find(j => j.id === 'weekmonth').everyHours).toBe(48);
    // 安い map（60 units）は毎日を維持する
    expect(plan.jobs.find(j => j.id === 'map').everyHours).toBe(24);
    expect(plan.jobs.some(j => j.skipped)).toBe(false);   // 落とすだけで、捨てはしない
  });

  test('バックフィルの予約枠はソフト上限から差し引かれ、解除すると自動で速くなる', () => {
    // 予約中（遡り収集が走っている間）: 定常ジョブは現状維持で収まる
    const reserved = planSchedule({ dailyUnits: 10000, reservedUnits: 1440 });
    expect(reserved.total).toBe(6397);
    expect(reserved.total + 1440).toBeLessThanOrEqual(Math.floor(10000 * 0.8));
    expect(reserved.jobs.find(j => j.id === 'weekmonth').everyHours).toBe(72);
    expect(reserved.degraded).toBe(false);
    expect(reserved.jobs.some(j => j.skipped)).toBe(false);
    // 完走後（予約はプールrefresh 40だけ）: weekmonth が 2日に自動昇格 ＝(a)→(b) の自動遷移
    const done = planSchedule({ dailyUnits: 10000, reservedUnits: 40 });
    expect(done.jobs.find(j => j.id === 'weekmonth').everyHours).toBe(48);
  });

  test('割当を増やすと週間/月間とカテゴリが自動で速くなる（24h は毎日のまま＝発注者意向）', () => {
    const at = units => {
      const p = planSchedule({ dailyUnits: units });
      const g = id => p.jobs.find(j => j.id === id).everyHours;
      return [g('top24h'), g('weekmonth'), g('categories'), p.total];
    };
    expect(at(15000)).toEqual([24, 24, 48, 11978]);
    // ゲートFの申請額 20,000: 週間/月間もカテゴリ×24h も毎日に
    expect(at(20000)).toEqual([24, 24, 24, 15874]);
    expect(at(30000)).toEqual([24, 24, 24, 23809]);
    // 24h を再び高頻度にしたければ top24h の desiredHours を下げるだけ（コメント参照）
  });

  test('割当が足りないと priority の低いジョブから間隔を落とし、最後はスキップする', () => {
    for (const units of [6000, 3000, 1500]) {
      const p = planSchedule({ dailyUnits: units });
      expect(p.total, `${units} units で収まること`).toBeLessThanOrEqual(p.softLimit);
      expect(p.degraded).toBe(true);
      // 24時間ランキングは最後まで残す（priority 1）
      const top = p.jobs.find(j => j.id === 'top24h');
      const cats = p.jobs.find(j => j.id === 'catall');   // いちばん優先度が低いカテゴリ系
      // 重いカテゴリ系より先に 24h が捨てられることはない（捨てるなら最後）
      if (top.skipped) expect(cats.skipped).toBe(true);
      // 安い map（26 units/日）は、重いジョブを落とした空き枠で必ず生き残る
      expect(p.jobs.find(j => j.id === 'map').skipped).toBe(false);
      expect(cats.skipped || cats.everyHours >= 24).toBe(true);
    }
  });

  test('isDue は間隔と 5分の猶予で判定する', () => {
    const now = new Date('2026-08-25T12:00:00Z');
    const job = { id: 'top24h', everyHours: 6 };
    expect(isDue(job, null, now)).toBe(true);                        // 未実行
    expect(isDue(job, '2026-08-25T11:30:00Z', now)).toBe(false);     // さっき走った
    expect(isDue(job, '2026-08-25T06:00:00Z', now)).toBe(true);      // ちょうど6時間
    expect(isDue(job, '2026-08-25T05:58:00Z', now)).toBe(true);      // 猶予の内側
    expect(isDue({ ...job, skipped: true }, null, now)).toBe(false);
  });
});

/* -------------------------------------- backfill.mjs（2026-08-25 第3弾） */

test.describe('backfill.mjs — 全期間の遡り収集', () => {
  const NOW = new Date('2026-08-25T12:00:00Z');

  test('窓は決定論的: 動画2005年〜・ショート2020年〜、直近2年は半年割', () => {
    const w = backfillWindows({ videoStartYear: 2005, shortsStartYear: 2020, splitRecentYears: 2 }, NOW);
    const video = w.filter(x => x.section === 'video');
    const shorts = w.filter(x => x.section === 'shorts');
    expect(video).toHaveLength(20 + 4);            // 2005-2024 年窓 + 2025/2026 半年窓
    expect(shorts).toHaveLength(5 + 4);            // 2020-2024 年窓 + 半年窓
    expect(video[0]).toEqual({ section: 'video', after: '2005-01-01T00:00:00.000Z', before: '2006-01-01T00:00:00.000Z' });
    // 未来に始まる窓は作らない（8月時点で7月開始の窓はある）
    expect(w.every(x => new Date(x.after) < NOW)).toBe(true);
    // 総費用 = 窓数 × 101 units × 国数。1,400 units/日 の予約なら3週間以内に完走できる規模
    const totalUnits = w.length * COUNTRIES.length * (QUOTA.costSearch + QUOTA.costVideos);
    expect(Math.ceil(totalUnits / BACKFILL.dailyUnits)).toBeLessThanOrEqual(21);
  });

  test('プール: upsert は冪等・evict は再生数の少ない順・stale は古い順', () => {
    const pool = {};
    const mk = (id, views, at) => ({ videoId: id, title: id, viewCount: views, publishedAt: '2020-01-01T00:00:00Z', durationSec: 300, isShort: false, fetchedAt: at });
    expect(poolUpsert(pool, [mk('aaaaaaaaaaa', 10), mk('bbbbbbbbbbb', 30)], '2026-08-01T00:00:00Z')).toBe(2);
    expect(poolUpsert(pool, [mk('aaaaaaaaaaa', 99)], '2026-08-20T00:00:00Z')).toBe(0);  // 既存は上書きのみ
    expect(pool['aaaaaaaaaaa'].viewCount).toBe(99);
    poolUpsert(pool, [mk('ccccccccccc', 5)], '2026-08-10T00:00:00Z');
    expect(poolEvict(pool, 2)).toBe(1);
    expect(pool['ccccccccccc']).toBeUndefined();   // いちばん再生数が少ないものが消える
    expect(poolStaleIds(pool, { limit: 10 })).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa']);  // 古い順
  });

  test('ORDER §8: 30日を超えた項目は prune され、refresh は fetchedAt を進める', () => {
    const pool = {
      old00000000: { videoId: 'old00000000', viewCount: 1, fetchedAt: '2026-07-01T00:00:00Z' },
      new00000000: { videoId: 'new00000000', viewCount: 2, fetchedAt: '2026-08-20T00:00:00Z' },
    };
    expect(poolPrune(pool, { maxAgeDays: 30, now: NOW.getTime() })).toBe(1);
    expect(pool.old00000000).toBeUndefined();
    // refresh: 返ってきたものは更新、返ってこないものは2回連続で消える
    poolApplyRefresh(pool, ['new00000000'], [], '2026-08-25T00:00:00Z');
    expect(pool.new00000000.miss).toBe(1);
    expect(poolApplyRefresh(pool, ['new00000000'], [], '2026-08-26T00:00:00Z')).toBe(1);
    expect(pool.new00000000).toBeUndefined();
  });

  test('rebuildRanking は期間と部門で絞り、再生数降順の上位を返す', () => {
    const pool = {};
    poolUpsert(pool, [
      { videoId: 'vvvvvvvvvv1', title: 'old video', viewCount: 900, publishedAt: '2010-01-01T00:00:00Z', durationSec: 600, isShort: false },
      { videoId: 'vvvvvvvvvv2', title: 'new video', viewCount: 500, publishedAt: '2026-08-01T00:00:00Z', durationSec: 600, isShort: false },
      { videoId: 'sssssssssss', title: 'short', viewCount: 700, publishedAt: '2026-08-01T00:00:00Z', durationSec: 30, isShort: true },
    ], '2026-08-25T00:00:00Z');
    const all = rebuildRanking(pool, { section: 'video', days: null, now: NOW });
    expect(all.map(x => x.videoId)).toEqual(['vvvvvvvvvv1', 'vvvvvvvvvv2']);
    expect(all[0].fetchedAt).toBeUndefined();      // 内部フィールドは公開データに漏らさない
    const year = rebuildRanking(pool, { section: 'video', days: 365, now: NOW });
    expect(year.map(x => x.videoId)).toEqual(['vvvvvvvvvv2']);
    const shorts = rebuildRanking(pool, { section: 'shorts', days: null, now: NOW });
    expect(shorts.map(x => x.videoId)).toEqual(['sssssssssss']);
  });
});

/* ------------------------------------------------- tags.mjs（ORDER §2-12） */

test.describe('tags.mjs — ワードの勢い', () => {
  const items = [
    { videoId: 'a', title: 'Building a homemade jet engine', tags: ['build', 'diy'], viewCount: 1_000_000 },
    { videoId: 'b', title: 'The truth about a homemade jet engine', tags: ['build'], viewCount: 500_000 },
    { videoId: 'c', title: '【検証】自作キーボードは本当に効果あるのか？', tags: ['検証'], viewCount: 800_000 },
    { videoId: 'd', title: '自作キーボードの作り方を丁寧に解説', tags: ['検証', '解説'], viewCount: 400_000 },
  ];

  test('英語のストップワードを落とし、和文はカタカナ・漢字の連なりを拾う', () => {
    const terms = rankTerms(items, { size: 20 }).map(r => r.term);
    expect(terms).toContain('homemade');
    expect(terms).toContain('キーボード');
    expect(terms).toContain('自作');
    expect(terms).toContain('検証');
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('about');
  });

  test('順位は連番で、delta は前回順位との差', () => {
    const ranked = rankTerms(items, { size: 20 });
    ranked.forEach((r, i) => expect(r.rank).toBe(i + 1));
    const withPrev = rankTerms(items, { size: 20, prevRanks: new Map([[ranked[0].term, 5]]) });
    expect(withPrev[0].delta).toBe(4);
    expect(withPrev.at(-1).delta).toBeNull();      // 前回に居なければ null
  });

  test('1本しか出てこない語は落とす（minCount）', () => {
    const terms = rankTerms(items, { size: 50 }).map(r => r.term);
    expect(terms).not.toContain('diy');            // tags に1回だけ
  });

  test('extractTerms は 1件の動画から語を取り出す', () => {
    const got = extractTerms(items[2]);
    expect(got).toContain('検証');
    expect(got.every(t => t.length >= 2)).toBe(true);
  });

  test('SEARCH_Q の常用語がワードランキングを占拠しない（IN/BR/KR 追加・2026-08-25 第3弾）', () => {
    // pt: 'de|que|em|para|com' / hi: 'के|में|है|की|का' は全動画のタイトルに載るのでストップワード必須
    const pt = extractTerms({ title: 'de que em para com futebol brasileiro', tags: [] });
    expect(pt).toContain('futebol');
    expect(pt).not.toContain('de');
    expect(pt).not.toContain('que');
    const hi = extractTerms({ title: 'के में है की का क्रिकेट मैच', tags: [] });
    expect(hi).toContain('क्रिकेट');
    expect(hi).not.toContain('में');
    // ハングルも語として拾えること（KR のワードタブが空にならない）
    const ko = extractTerms({ title: '오늘 축구 하이라이트 영상', tags: [] });
    expect(ko).toContain('축구');
    expect(ko).not.toContain('오늘');            // ko ストップワード
  });
});

/* ---------------------------------------- schema.mjs（docs/SCHEMA.md） */

test.describe('schema.mjs — データ契約', () => {
  const dataDir = path.join(PUBLIC_DIR, 'data');

  test('同梱のデータが1件残らずスキーマを満たす', () => {
    const index = readJSON(path.join(dataDir, 'index.json'));
    expect(validateIndex(index)).toEqual([]);

    for (const id of Object.keys(index.datasets)) {
      const file = path.join(dataDir, `${id}.json`);
      expect(fs.existsSync(file), `${id}.json が存在すること`).toBe(true);
      expect(validateRanking(readJSON(file), { filename: `${id}.json` }), id).toEqual([]);
    }
    expect(validateMap(readJSON(path.join(dataDir, 'map.json')))).toEqual([]);
    for (const c of index.countries) {
      expect(validateTags(readJSON(path.join(dataDir, `tags-${c}.json`)), { filename: `tags-${c}.json` })).toEqual([]);
    }
  });

  test('壊れたデータをちゃんと落とす', () => {
    const good = readJSON(path.join(dataDir, `${COUNTRIES[0].code}-video-24h-all.json`));

    const dupe = structuredClone(good);
    dupe.items[1].videoId = dupe.items[0].videoId;
    expect(validateRanking(dupe).join('\n')).toContain('duplicate videoId');

    const badRank = structuredClone(good);
    badRank.items[3].rank = 99;
    expect(validateRanking(badRank).join('\n')).toContain('rank must be 4');

    const badDelta = structuredClone(good);
    badDelta.items[0].prevRank = 5;
    badDelta.items[0].delta = 0;
    expect(validateRanking(badDelta).join('\n')).toContain('delta must be 4');

    const unsorted = structuredClone(good);
    unsorted.items[0].viewCount = 1;
    expect(validateRanking(unsorted).join('\n')).toContain('not sorted');

    const shortInVideo = structuredClone(good);
    shortInVideo.items[0].isShort = true;
    expect(validateRanking(shortInVideo).join('\n')).toContain('must not contain shorts');

    const noAttribution = structuredClone(readJSON(path.join(dataDir, 'index.json')));
    noAttribution.attribution = '';
    expect(validateIndex(noAttribution).join('\n')).toContain('YouTube API Services');
  });

  test('年間・全期間の「伸び」ランキングは許さない（ORDER §2-14）', () => {
    const index = structuredClone(readJSON(path.join(dataDir, 'index.json')));
    index.features.growth = { enabled: true, daysCollected: 40, requiredDays: 3, periods: ['year'] };
    expect(validateIndex(index).join('\n')).toContain('not allowed');
  });

  test('features.backfill と map の top は任意だが、あれば形を検証する（2026-08-25 第3弾）', () => {
    const index = structuredClone(readJSON(path.join(dataDir, 'index.json')));
    delete index.features.backfill;                      // 旧データ（フィールド無し）も通る
    expect(validateIndex(index)).toEqual([]);
    index.features.backfill = { active: true, done: 210, total: 198 };
    expect(validateIndex(index).join('\n')).toContain('must not exceed total');
    index.features.backfill = { active: 'yes' };
    expect(validateIndex(index).join('\n')).toContain('backfill.active');

    const map = structuredClone(readJSON(path.join(dataDir, 'map.json')));
    expect(map.items[0].top.length).toBeGreaterThan(1);  // mock は top を出す
    map.items[0].top = [{ videoId: 123 }];
    expect(validateMap(map).join('\n')).toContain('top[0]: videoId');
    delete map.items[0].top;                             // 旧データ（top 無し）も通る
    expect(validateMap(map)).toEqual([]);
  });

  test('QUOTA の単価が docs/BUDGET.md と一致している', () => {
    expect(QUOTA.costSearch).toBe(100);
    expect(QUOTA.costVideos).toBe(1);
    expect(QUOTA.pageSize).toBe(50);
    expect(QUOTA.softLimitRatio).toBe(0.8);
    expect(QUOTA.resetTimeZone).toBe('America/Los_Angeles');
  });
});

/* ------------------------------------------------------ 収集の進み方（飢餓しないこと）
 * 2026-08-25 のレビューで、1回の費用が1日の予算を超えるジョブ（カテゴリ×週月＝8,080 units）が
 * 「毎回先頭からやり直す」「完走しないので毎日 due で居座る」の合わせ技で、
 * 年間・全期間のデータを永久に取れなくすることが判明した。対策は2つ:
 *   (a) collect.mjs の再開カーソル（途中で予算切れしたら次回はそこから）
 *   (b) collect.mjs のエイジング（待たされた度合いで順番を決める）
 * ここでは planner の値を使って、その2つがある場合と無い場合を突き合わせる。
 */
test.describe('収集スケジュールの飢餓耐性', () => {
  const HARD_STOP = Math.floor(QUOTA.dailyUnits * 0.95);

  /** 60日ぶんの実行をなぞって「一度でも取れたデータセット」を返す。 */
  function simulate({ aging, cursorResume, days = 60, reservedUnits = 0 }) {
    const plan = planSchedule({ dailyUnits: QUOTA.dailyUnits, reservedUnits });
    const jobs = plan.jobs.filter(j => !j.skipped && j.costPerRun > 0 && j.id !== 'map');
    const cursor = {}, lastRun = {}, written = new Set(), spentByDay = {};
    const overdue = (j, hour) => (lastRun[j.id] === undefined
      ? Infinity : (hour - lastRun[j.id]) / Math.max(1, j.everyHours));

    for (let hour = 0; hour < days * 24; hour++) {
      const day = Math.floor(hour / 24);
      // 予約枠（バックフィル）は実消費としても毎日先に取られるものとして扱う
      spentByDay[day] = spentByDay[day] || reservedUnits;
      const due = jobs.filter(j => lastRun[j.id] === undefined || (hour - lastRun[j.id]) >= j.everyHours);
      if (aging) due.sort((a, b) => (overdue(b, hour) - overdue(a, hour)) || (a.priority - b.priority));
      else due.sort((a, b) => a.priority - b.priority);

      for (const j of due) {
        const lists = listsOfJob(j.id);
        const start = cursorResume ? (cursor[j.id] || 0) : 0;
        let walked = true;
        for (let i = 0; i < lists.length; i++) {
          const idx = (start + i) % lists.length;
          const cost = costOfList(lists[idx].size);
          if (spentByDay[day] + cost > HARD_STOP) { cursor[j.id] = idx; walked = false; break; }
          spentByDay[day] += cost;
          const l = lists[idx];
          written.add(`${l.country}-${l.section}-${l.period}-${l.category}`);
        }
        if (walked) { delete cursor[j.id]; lastRun[j.id] = hour; }
      }
    }
    return written;
  }

  const allLists = () => new Set(
    ['top24h', 'weekmonth', 'categories', 'catweek', 'catmonth', 'yearall', 'catyear', 'catall']
      .flatMap(listsOfJob)
      .map(l => `${l.country}-${l.section}-${l.period}-${l.category}`));

  test('カーソル＋エイジングがあれば 60日で全データセットが1度は取れる', () => {
    const all = allLists();
    const got = simulate({ aging: true, cursorResume: true });
    const missing = [...all].filter(k => !got.has(k));
    expect(missing, `取れなかった: ${missing.slice(0, 5).join(', ')}`).toHaveLength(0);
  });

  test('バックフィル予約（1,440/日）が走っている間も、60日で全データセットが取れる（飢餓なし）', () => {
    const all = allLists();
    const got = simulate({ aging: true, cursorResume: true, reservedUnits: 1440 });
    const missing = [...all].filter(k => !got.has(k));
    expect(missing, `取れなかった: ${missing.slice(0, 5).join(', ')}`).toHaveLength(0);
  });

  /* かつてここに「カーソルかエイジングが欠けると飢餓が再現する」裏取りテストがあった。
     ジョブを期間単位に分割して「1回の費用 < ハード停止」の不変条件（下のテスト）を守るように
     してからは、6カ国構成では対策なしでも60日で全件取れるほど頑健になったため、
     再現テストは成立しなくなった。カーソル＋エイジング自体は「日をまたぐ再開を速くする」
     効果が残っているので、対策あり構成が対策なしを下回らないことだけを見張る。 */
  test('カーソル＋エイジングは、無い場合と比べて取得範囲を狭めない（非退行）', () => {
    const withBoth = simulate({ aging: true, cursorResume: true });
    const noCursor = simulate({ aging: true, cursorResume: false });
    const noAging = simulate({ aging: false, cursorResume: true });
    expect(withBoth.size).toBeGreaterThanOrEqual(noCursor.size);
    expect(withBoth.size).toBeGreaterThanOrEqual(noAging.size);
  });

  test('不変条件: どのジョブも1回の費用が1日のハード停止を超えない（超えると1周を完走できず飢餓する）', () => {
    // 6カ国化のとき catweekmonth（12,120 units）がこれを破って年間・全期間を飢餓させた。
    // 国を増やすときは必ずこのテストで守られる（8カ国でも catweek=8,080 < 9,500 で収まる）。
    const plan = planSchedule({ dailyUnits: QUOTA.dailyUnits });
    for (const j of plan.jobs) {
      expect(j.costPerRun, `${j.id} は1日で1周を完走できること`).toBeLessThan(HARD_STOP);
    }
  });
});
