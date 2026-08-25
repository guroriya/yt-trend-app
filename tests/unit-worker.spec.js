// ============================================================================
// unit-worker.spec.js — v3 匿名タップ集計（workers/taps）の純粋ロジックを直接テスト
//
// ORDER §2-15 の約束をコードの形で固定する:
//   - 保存するのは 国コード＋動画ID＋日付 のカウンタのみ（それ以外の入力は 400 相当で弾く）
//   - 集計日はサーバー側 UTC（クライアントの時計・タイムゾーンを信用しない）
//   - TTL は 31 日（ORDER §8 の保存30日制約に整合）
//   - 外に出す統計は 合計＋国別 だけ（動画別内訳は出さない）
// ============================================================================

import { test, expect } from '@playwright/test';
import {
  DAY_TTL_SECONDS, MAX_VIDEO_KEYS, PRUNE_TO,
  utcDateOf, isValidDate, validateTap,
  emptyDay, reviveDay, applyTap, publicStats, corsHeaders,
  GROUP_TTL_SECONDS, GROUP_MAX_ITEMS, GROUP_MAX_ADDS_PER_DAY,
  groupIdFrom, isValidGroupId, validateGroupAdd,
  emptyGroup, reviveGroup, applyGroupAdd, publicGroup, hotScore, canAddToday,
} from '../workers/taps/src/lib.mjs';

test.describe('validateTap（入口検証）', () => {
  test('正しい形だけ通す', () => {
    expect(validateTap({ country: 'JP', videoId: 'dQw4w9WgXcQ' }))
      .toEqual({ country: 'JP', videoId: 'dQw4w9WgXcQ' });
    expect(validateTap({ country: 'US', videoId: 'a-b_c123XYZ' }))
      .toEqual({ country: 'US', videoId: 'a-b_c123XYZ' });
  });

  test('形の崩れた入力は null（=400）', () => {
    expect(validateTap(null)).toBeNull();
    expect(validateTap('JP')).toBeNull();
    expect(validateTap({})).toBeNull();
    expect(validateTap({ country: 'jp', videoId: 'dQw4w9WgXcQ' })).toBeNull();  // 小文字
    expect(validateTap({ country: 'JPN', videoId: 'dQw4w9WgXcQ' })).toBeNull(); // 3桁
    expect(validateTap({ country: 'JP', videoId: 'short' })).toBeNull();        // 11文字でない
    expect(validateTap({ country: 'JP', videoId: 'dQw4w9WgXc!' })).toBeNull();  // 記号
    // 余計なフィールドは黙って捨てる（保存対象は2値だけ）
    const t = validateTap({ country: 'JP', videoId: 'dQw4w9WgXcQ', ip: '1.2.3.4' });
    expect(Object.keys(t).sort()).toEqual(['country', 'videoId']);
  });
});

test.describe('日付（UTC）', () => {
  test('utcDateOf は UTC で日を切る', () => {
    expect(utcDateOf(Date.UTC(2026, 7, 25, 0, 0, 1))).toBe('2026-08-25');
    expect(utcDateOf(Date.UTC(2026, 7, 25, 23, 59, 59))).toBe('2026-08-25');
    expect(utcDateOf(Date.UTC(2026, 7, 26, 0, 0, 0))).toBe('2026-08-26');
  });

  test('isValidDate は形と実在の両方を見る', () => {
    expect(isValidDate('2026-08-25')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false); // 実在しない
    expect(isValidDate('2026-8-25')).toBe(false);
    expect(isValidDate('20260825')).toBe(false);
    expect(isValidDate('')).toBe(false);
    expect(isValidDate(null)).toBe(false);
  });
});

test.describe('カウンタ', () => {
  test('applyTap は 合計・国別・動画別 を同時に進める（元は壊さない）', () => {
    const d0 = emptyDay('2026-08-25');
    const d1 = applyTap(d0, { country: 'JP', videoId: 'AAAAAAAAAAA' });
    const d2 = applyTap(d1, { country: 'JP', videoId: 'AAAAAAAAAAA' });
    const d3 = applyTap(d2, { country: 'US', videoId: 'BBBBBBBBBBB' });
    expect(d3).toEqual({
      date: '2026-08-25', total: 3,
      countries: { JP: 2, US: 1 },
      videos: { AAAAAAAAAAA: 2, BBBBBBBBBBB: 1 },
    });
    expect(d0.total).toBe(0); // 破壊していない
  });

  test('動画IDが増えすぎたら上位だけ残す（値の肥大防止）', () => {
    const d = emptyDay('2026-08-25');
    d.videos = Object.fromEntries(
      Array.from({ length: MAX_VIDEO_KEYS }, (_, i) => [`id${String(i).padStart(8, '0')}`, i + 2]),
    );
    d.total = 12345;
    const after = applyTap(d, { country: 'JP', videoId: 'ZZZZZZZZZZZ' });
    expect(Object.keys(after.videos).length).toBe(PRUNE_TO);
    // いちばん多いものは必ず生き残る
    const top = `id${String(MAX_VIDEO_KEYS - 1).padStart(8, '0')}`;
    expect(after.videos[top]).toBe(MAX_VIDEO_KEYS + 1);
    // 合計・国別は間引きの影響を受けない
    expect(after.total).toBe(12346);
    expect(after.countries.JP).toBe(1);
  });

  test('reviveDay は壊れた保存値を作り直す（1件の破損で集計を止めない）', () => {
    expect(reviveDay(null, '2026-08-25')).toEqual(emptyDay('2026-08-25'));
    expect(reviveDay('garbage', '2026-08-25')).toEqual(emptyDay('2026-08-25'));
    expect(reviveDay({ date: '2026-08-24', total: 5, countries: {}, videos: {} }, '2026-08-25'))
      .toEqual(emptyDay('2026-08-25')); // 日付違いは新しい日として空から
    const ok = { date: '2026-08-25', total: 5, countries: { JP: 5 }, videos: { AAAAAAAAAAA: 5 } };
    expect(reviveDay(ok, '2026-08-25')).toBe(ok);
  });

  test('publicStats は動画別内訳を外に出さない', () => {
    const d = applyTap(emptyDay('2026-08-25'), { country: 'JP', videoId: 'AAAAAAAAAAA' });
    expect(publicStats(d)).toEqual({ date: '2026-08-25', total: 1, countries: { JP: 1 } });
    expect('videos' in publicStats(d)).toBe(false);
  });
});

/* -------------------------- v4 グループランキング（2026-08-25 第3弾） */

test.describe('グループ: 入口検証と ID', () => {
  test('groupIdFrom は与えたバイト列から10文字の小文字英数を作る（決定論的）', () => {
    const id = groupIdFrom(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(id).toMatch(/^[a-z0-9]{10}$/);
    expect(groupIdFrom(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(id);
    expect(isValidGroupId(id)).toBe(true);
    expect(isValidGroupId('ABCDEFGHIJ')).toBe(false);   // 大文字は不可
    expect(isValidGroupId('abc')).toBe(false);
  });

  test('validateGroupAdd は動画IDだけを受け付ける（自由文は仕組み上保存できない）', () => {
    expect(validateGroupAdd({ videoId: 'dQw4w9WgXcQ' })).toEqual({ videoId: 'dQw4w9WgXcQ' });
    expect(validateGroupAdd({ videoId: 'bad' })).toBeNull();
    expect(validateGroupAdd({ comment: 'hello' })).toBeNull();
    const ok = validateGroupAdd({ videoId: 'dQw4w9WgXcQ', name: 'me', ip: '1.2.3.4' });
    expect(Object.keys(ok)).toEqual(['videoId']);       // 余計なフィールドは捨てる
  });
});

test.describe('グループ: カウンタとランキング', () => {
  const NOW = Date.UTC(2026, 7, 25, 12);

  test('同じ動画を複数回（別の人が）追加すると n が増え、スコアが上がる', () => {
    let g = emptyGroup(NOW);
    g = applyGroupAdd(g, 'AAAAAAAAAAA', NOW);
    g = applyGroupAdd(g, 'AAAAAAAAAAA', NOW + 1000);
    g = applyGroupAdd(g, 'BBBBBBBBBBB', NOW + 2000);
    const pub = publicGroup(g, NOW + 2000);
    expect(pub.items[0]).toMatchObject({ videoId: 'AAAAAAAAAAA', count: 2 });
    expect(pub.items[1]).toMatchObject({ videoId: 'BBBBBBBBBBB', count: 1 });
  });

  test('hotScore は半減期3日: 古い追加は直近の追加に順位を譲る（ザッピングの趣旨）', () => {
    // 2回追加されたが3日前 → 1回×直近と同スコアまで減衰。同点なら新しい方が上
    expect(hotScore(2, NOW, NOW + 72 * 3600e3)).toBeCloseTo(1, 5);
    let g = emptyGroup(NOW);
    g = applyGroupAdd(g, 'AAAAAAAAAAA', NOW);
    g = applyGroupAdd(g, 'AAAAAAAAAAA', NOW);
    g = applyGroupAdd(g, 'BBBBBBBBBBB', NOW + 72 * 3600e3);
    const pub = publicGroup(g, NOW + 72 * 3600e3);
    expect(pub.items[0].videoId).toBe('BBBBBBBBBBB');
  });

  test('上限を超えたらスコアの低い順に間引き、日別カウンタが1日の追加上限を守る', () => {
    let g = emptyGroup(NOW);
    for (let i = 0; i < GROUP_MAX_ITEMS + 5; i++) {
      g = applyGroupAdd(g, String(i).padStart(11, 'x'), NOW + i);
    }
    expect(Object.keys(g.videos).length).toBe(GROUP_MAX_ITEMS);
    expect(g.adds[utcDateOf(NOW)]).toBe(GROUP_MAX_ITEMS + 5);
    expect(canAddToday(g, NOW)).toBe(GROUP_MAX_ITEMS + 5 < GROUP_MAX_ADDS_PER_DAY);
    // 日付が変わればまた追加できる
    expect(canAddToday(g, NOW + 86400e3)).toBe(true);
  });

  test('reviveGroup は壊れた保存値を 404 に落とす（作り直さない＝勝手に空グループにしない）', () => {
    expect(reviveGroup(null)).toBeNull();
    expect(reviveGroup('garbage')).toBeNull();
    expect(reviveGroup({ v: 2, createdAt: 1, updatedAt: 1, adds: {}, videos: {} })).toBeNull();
    const ok = emptyGroup(NOW);
    expect(reviveGroup(ok)).toBe(ok);
  });

  test('TTL は 90 日（追加が無いグループは自動消滅）', () => {
    expect(GROUP_TTL_SECONDS).toBe(90 * 86400);
  });
});

test.describe('運用の約束', () => {
  test('TTL は 31 日（ORDER §8: 30日以内リフレッシュ/削除 + 1日の余裕）', () => {
    expect(DAY_TTL_SECONDS).toBe(31 * 86400);
  });

  test('corsHeaders: 既定 * / 許可リストは一致したときだけ通す（不許可はヘッダ自体を出さない）', () => {
    expect(corsHeaders('https://example.com')['access-control-allow-origin']).toBe('*');
    const h = corsHeaders('https://me.github.io', 'https://me.github.io, https://other.dev');
    expect(h['access-control-allow-origin']).toBe('https://me.github.io');
    expect(h.vary).toBe('origin'); // オリジンで応答が変わる = 共有キャッシュの誤配防止
    // 不許可時に 'null' を返すと sandbox iframe / file://（Origin: null）が素通しになる。
    // ヘッダ不在 = ブラウザ側でブロック、が正しい失敗の形。
    expect('access-control-allow-origin' in corsHeaders('https://evil.dev', 'https://me.github.io')).toBe(false);
    expect('access-control-allow-origin' in corsHeaders('null', 'https://me.github.io')).toBe(false);
  });
});
