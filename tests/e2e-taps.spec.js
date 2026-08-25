// ============================================================================
// e2e-taps.spec.js — v3 匿名タップ集計（ORDER §2-15）のフロント側 E2E
//
// 3つの約束を UI から確かめる:
//   1. 既定（endpoint 空）では 送信もフェッチも一切起きない（外部送信ゼロの保証）
//   2. endpoint がある時: タップで {country, videoId} だけ を POST し、
//      世界タブに 合計と国別 が重なる（独自指標＋アプリ住民の地図）
//   3. `?taps=mock` は表示専用サンプル（ネットワークに出ない。監査・開発用）
//
// endpoint の差し替えは page.route で config.js 自体を書き換えて行う。
// アプリ側に「テスト用の隠し設定」を増やさないため（設定は config.js の1箇所だけ、CLAUDE.md §4）。
// ============================================================================

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import {
  MAP_COUNTRIES, I18N, PUBLIC_DIR,
  gotoApp, waitForApp, waitForList, mapHash, everyoneHash, blockThumbnails, seedStorage,
} from './helpers.js';

test.use({ serviceWorkers: 'block' });

const TAPS_ORIGIN = 'https://taps.test';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

/** config.js の endpoint をテスト用に書き換えて配る。 */
async function routeConfigWithEndpoint(page, endpoint) {
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'config.js'), 'utf8');
  expect(src).toContain("endpoint: ''");
  await page.route('**/js/config.js', route => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: src.replace("endpoint: ''", `endpoint: '${endpoint}'`),
  }));
}

/** 集計サーバーのモック。受けた POST の中身を配列に貯める。 */
async function routeTapsServer(page, { total = 42, countries = { JP: 30, US: 12 } } = {}) {
  const taps = [];
  await page.context().route(`${TAPS_ORIGIN}/**`, route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (req.method() === 'POST' && req.url() === `${TAPS_ORIGIN}/tap`) {
      taps.push(req.postDataJSON());
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (req.method() === 'GET' && req.url().startsWith(`${TAPS_ORIGIN}/stats`)) {
      return route.fulfill({
        status: 200, headers: CORS, contentType: 'application/json',
        body: JSON.stringify({ date: '2026-08-25', total, countries }),
      });
    }
    return route.fulfill({ status: 404, headers: CORS });
  });
  return taps;
}

/* --------------------------------------------- 1. 既定では外に出ない */

test.describe('既定（endpoint 空）', () => {
  test('タップしても統計表示でも、集計サーバーへの通信は一切ない', async ({ page }) => {
    const external = [];
    await page.context().route('**/*', route => {
      const url = route.request().url();
      // 同一オリジン（アプリ本体）以外への通信をすべて記録して落とす
      if (!url.startsWith('http://localhost')) { external.push(url); return route.abort(); }
      return route.fallback();
    });
    await gotoApp(page);
    await waitForList(page);

    // カードをタップ（別タブは開こうとするが、遷移自体は上の route が落とす）
    const first = page.locator('#list .card[data-video-id] .card-link').first();
    await first.click();

    // 世界タブへ（統計フェッチが起きるならここ）
    await page.locator('.mode[data-mode="map"]').click();
    await expect(page.locator('.map-countries')).toBeVisible();
    await expect(page.locator('.map-residents')).toHaveCount(0);

    // 外部通信は サムネ(blockThumbnails 済) と YouTube への遷移だけが正常。集計系は 0 件。
    const tapsCalls = external.filter(u => u.includes('/tap') || u.includes('/stats') || u.includes('taps'));
    expect(tapsCalls).toEqual([]);
  });
});

/* --------------------------------------------- 2. endpoint あり */

test.describe('endpoint が設定されている時', () => {
  test('カードのタップで {country, videoId} だけが POST される', async ({ page }) => {
    await routeConfigWithEndpoint(page, TAPS_ORIGIN);
    const taps = await routeTapsServer(page);
    await page.context().route('https://www.youtube.com/**', route => route.abort()); // 密閉

    await gotoApp(page, everyoneHash({ country: 'JP' }));
    await waitForList(page);
    const first = page.locator('#list .card[data-video-id]').first();
    const videoId = await first.getAttribute('data-video-id');

    const posted = page.waitForRequest(r => r.url() === `${TAPS_ORIGIN}/tap` && r.method() === 'POST');
    await first.locator('.card-link').click();
    await posted;

    expect(taps).toEqual([{ country: 'JP', videoId }]);
  });

  test('世界タブに 合計＋国別 が重なる（独自指標とアプリ住民の地図）', async ({ page }) => {
    await routeConfigWithEndpoint(page, TAPS_ORIGIN);
    await routeTapsServer(page, { total: 42, countries: { JP: 30, US: 12 } });

    await gotoApp(page, mapHash());
    await expect(page.locator('.map-residents')).toBeVisible();
    const line = I18N.en['taps.today'].replace('{n}', '42');
    await expect(page.locator('.map-residents')).toContainText(line);

    // 統計のある国のピンにはバッジ、無い国には無い
    await expect(page.locator('.map-pin.has-taps .pin-taps')).toHaveCount(2);
    await expect(page.locator('.map-pin.has-taps').first()).toBeVisible();
    // 国リストの行にも出る（JP: 30 → "30 zaps today"）
    const rowText = I18N.en['taps.count'].replace('{n}', '30');
    await expect(page.locator('.mc-taps').filter({ hasText: rowText }).first()).toBeVisible();
  });

  test('統計サーバーが落ちていても地図は普通に出る（劣化は静かに）', async ({ page }) => {
    await routeConfigWithEndpoint(page, TAPS_ORIGIN);
    await page.context().route(`${TAPS_ORIGIN}/**`, route => route.abort());

    await gotoApp(page, mapHash());
    await expect(page.locator('.map-countries')).toBeVisible();
    await expect(page.locator('.map-residents')).toHaveCount(0);
    await expect(page.locator('.map-pin').first()).toBeVisible();
  });
});

/* --------------------------------------------- 3. ?taps=mock（表示専用） */

test.describe('?taps=mock', () => {
  test('決定論的なサンプル統計が表示され、ネットワークには出ない', async ({ page }) => {
    const external = [];
    await page.context().route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith('http://localhost')) { external.push(url); return route.abort(); }
      return route.fallback();
    });
    await seedStorage(page, { 'ytta.hintSeen': true });
    await page.goto(`/?lang=en&taps=mock${mapHash()}`);
    await waitForApp(page);

    // app.js の _mockStats と同じ式（変えたら両方直す約束が Taps モジュールに書いてある）
    let total = 0;
    MAP_COUNTRIES.forEach((c, i) => { total += ((i * 37) % 90) + 8; });
    const fmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(total);

    await expect(page.locator('.map-residents')).toBeVisible();
    await expect(page.locator('.map-residents')).toContainText(I18N.en['taps.today'].replace('{n}', fmt));
    await expect(page.locator('.map-pin .pin-taps')).toHaveCount(MAP_COUNTRIES.length);

    const tapsCalls = external.filter(u => u.includes('/tap') || u.includes('/stats') || u.includes('taps'));
    expect(tapsCalls).toEqual([]);
  });
});
