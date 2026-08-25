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
import { QUOTA, COUNTRIES, SECTIONS, CATEGORIES } from '../public/js/config.js';
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

  test('ジョブ別の費用が docs/BUDGET.md と一致する（4か国・カテゴリ全期間）', () => {
    expect(listsOfJob('top24h')).toHaveLength(COUNTRIES.length * SECTIONS.length);
    expect(costOfJob('top24h')).toBe(1616);
    expect(costOfJob('weekmonth')).toBe(3232);
    expect(costOfJob('yearall')).toBe(3232);
    expect(costOfJob('categories')).toBe(4040);       // カテゴリ×24h
    expect(costOfJob('catweekmonth')).toBe(8080);     // カテゴリ×週間・月間
    expect(costOfJob('catyearall')).toBe(8080);       // カテゴリ×年間・全期間
    expect(costOfJob('map')).toBe(26);
    expect(costOfJob('tags')).toBe(0);
    // カテゴリのリストは3ジョブに漏れなく重複なく分かれること（期間帯で分割しているため）
    const catLists = ['categories', 'catweekmonth', 'catyearall'].flatMap(listsOfJob);
    const expected = COUNTRIES.length * SECTIONS.length
      * CATEGORIES.filter(c => c.id !== 'all').reduce((n, c) => n + c.periods.length, 0);
    expect(catLists).toHaveLength(expected);
    expect(new Set(catLists.map(l => `${l.country}/${l.section}/${l.period}/${l.category}`)).size)
      .toBe(expected);
  });

  test('既定割当では 1日 7,837 units、ソフト上限 8,000 の下に収まる', () => {
    const plan = planSchedule({ dailyUnits: 10000 });
    expect(plan.total).toBe(7837);
    expect(plan.total).toBeLessThanOrEqual(plan.softLimit);
    expect(plan.jobs.find(j => j.id === 'top24h').everyHours).toBe(8);
    // 4か国＋カテゴリ全期間は既定割当に収まりきらないので、planner が間隔を落として合わせる
    expect(plan.degraded).toBe(true);
    // 安い map（26 units）は毎日を維持する
    expect(plan.jobs.find(j => j.id === 'map').everyHours).toBe(24);
    expect(plan.jobs.some(j => j.skipped)).toBe(false);   // 落とすだけで、捨てはしない
  });

  test('割当を増やすと 24時間ランキングが自動で毎時に近づく（docs/BUDGET.md の表）', () => {
    const at = units => {
      const p = planSchedule({ dailyUnits: units });
      return [p.jobs.find(j => j.id === 'top24h').everyHours, p.total];
    };
    expect(at(15000)).toEqual([6, 11954]);
    expect(at(20000)).toEqual([6, 15955]);
    expect(at(30000)).toEqual([4, 22650]);
    expect(at(50000)).toEqual([2, 36386]);
    // ORDER §4 の理想「24h＝毎時」は 4か国＋カテゴリ全期間では 10万 units 級が要る
    expect(at(100000)[0]).toBe(1);
  });

  test('割当が足りないと priority の低いジョブから間隔を落とし、最後はスキップする', () => {
    for (const units of [6000, 3000, 1500]) {
      const p = planSchedule({ dailyUnits: units });
      expect(p.total, `${units} units で収まること`).toBeLessThanOrEqual(p.softLimit);
      expect(p.degraded).toBe(true);
      // 24時間ランキングは最後まで残す（priority 1）
      const top = p.jobs.find(j => j.id === 'top24h');
      const cats = p.jobs.find(j => j.id === 'catyearall');   // いちばん重く優先度が低い
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

  test('QUOTA の単価が docs/BUDGET.md と一致している', () => {
    expect(QUOTA.costSearch).toBe(100);
    expect(QUOTA.costVideos).toBe(1);
    expect(QUOTA.pageSize).toBe(50);
    expect(QUOTA.softLimitRatio).toBe(0.8);
    expect(QUOTA.resetTimeZone).toBe('America/Los_Angeles');
  });
});
