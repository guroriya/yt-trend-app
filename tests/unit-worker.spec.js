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

test.describe('運用の約束', () => {
  test('TTL は 31 日（ORDER §8: 30日以内リフレッシュ/削除 + 1日の余裕）', () => {
    expect(DAY_TTL_SECONDS).toBe(31 * 86400);
  });

  test('corsHeaders: 既定 * / 許可リストは一致したときだけ通す', () => {
    expect(corsHeaders('https://example.com')['access-control-allow-origin']).toBe('*');
    const h = corsHeaders('https://me.github.io', 'https://me.github.io, https://other.dev');
    expect(h['access-control-allow-origin']).toBe('https://me.github.io');
    expect(corsHeaders('https://evil.dev', 'https://me.github.io')['access-control-allow-origin']).toBe('null');
  });
});
