// ============================================================================
// e2e-everyone.spec.js — ORDER §6 P3 の中核
//   「全タブ網羅／転送URL検証」＋ P4「伸びランキングの自動有効化ロジック確認」
//
// 全 40 通り（国2×部門2×期間5×カテゴリ）を総当りしても得るものが増えないので、
// 「軸ごとに全部踏む」＋「代表的な組合せを直リンクで開く」の2本立てで網羅する。
//
// このファイルは page.route でデータを差し替えるテストを含む。Service Worker が
// 間に入ると route が素通りされるので、ファイル単位で SW を止める。
// （PWA としての挙動は e2e-pwa-offline.spec.js が受け持つ）
// ============================================================================

import { test, expect } from '@playwright/test';
import {
  gotoApp, waitForList, everyoneHash, appState, swipeList,
  expectedItemCount, expectedAdCount, expectedAdPositions,
  WATCH_URL_RE, SHORTS_URL_RE,
  readIndexJSON, readDataset,
  COUNTRIES, SECTIONS, PERIODS, CATEGORIES, AD_EVERY, I18N,
} from './helpers.js';

test.use({ serviceWorkers: 'block' });

/* ------------------------------------------------------------------ 全タブ網羅 */

test.describe('全タブ網羅', () => {
  test('期間タブを全部踏んでも必ずランキングが出る', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);

    for (const p of PERIODS) {
      await page.locator(`#axis-periods .chip[data-period="${p.id}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/video/${p.id}/all/published$`));
      await expect(page.locator(`#axis-periods .chip[data-period="${p.id}"]`)).toHaveClass(/is-active/);
      await waitForList(page);
      await expect(page.locator('#list .card[data-video-id]')).toHaveCount(expectedItemCount('all'));
    }
  });

  test('カテゴリタブ（24h）を全部踏める。総合以外の期間ではカテゴリが隠れる', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);

    for (const c of CATEGORIES) {
      const chip = page.locator(`#axis-categories .chip[data-category="${c.id}"]`);
      await expect(chip).toBeVisible();      // 24h では全カテゴリが使える（config.js）
      await chip.click();
      await expect(page).toHaveURL(new RegExp(`/video/24h/${c.id}/published$`));
      await waitForList(page);
      await expect(page.locator('#list .card[data-video-id]')).toHaveCount(expectedItemCount(c.id));
    }

    // 24h 以外は総合のみ（ORDER §2-3 の割当の都合）。カテゴリは総合へ戻る。
    await page.locator('#axis-periods .chip[data-period="month"]').click();
    await expect(page).toHaveURL(/\/video\/month\/all\/published$/);
    for (const c of CATEGORIES.filter(x => !x.periods.includes('month'))) {
      await expect(page.locator(`#axis-categories .chip[data-category="${c.id}"]`)).toBeHidden();
    }
    await expect(page.locator('#axis-categories .chip[data-category="all"]')).toBeVisible();
  });

  test('部門タブと国トグルを踏める', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);

    for (const s of SECTIONS) {
      await page.locator(`#axis-sections button[data-section="${s.id}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/${s.id}/24h/all/published$`));
      await waitForList(page);
    }

    // #btn-country は COUNTRIES を順送りする
    for (let i = 1; i <= COUNTRIES.length; i++) {
      const expected = COUNTRIES[i % COUNTRIES.length].code;
      await page.locator('#btn-country').click();
      await expect(page).toHaveURL(new RegExp(`#/everyone/${expected}/`));
      await expect(page.locator('#country-code')).toHaveText(expected);
      await waitForList(page);
    }
  });

  // 直リンク（PWA ショートカット・共有 URL 相当）のサンプル。総当りはしない。
  const SAMPLES = [
    { country: 'JP', section: 'video', period: '24h', category: 'all' },
    { country: 'JP', section: 'shorts', period: '24h', category: 'all' },
    { country: 'US', section: 'video', period: 'week', category: 'all' },
    { country: 'US', section: 'shorts', period: 'all', category: 'all' },
    { country: 'JP', section: 'video', period: '24h', category: 'music' },
    { country: 'US', section: 'shorts', period: '24h', category: 'news' },
  ];

  for (const s of SAMPLES) {
    test(`直リンクで開ける: ${s.country}/${s.section}/${s.period}/${s.category}`, async ({ page }) => {
      await gotoApp(page, everyoneHash(s));
      await waitForList(page);

      const n = expectedItemCount(s.category);
      await expect(page.locator('#list .card[data-video-id]')).toHaveCount(n);
      await expect(page.locator('#list .card-ad')).toHaveCount(expectedAdCount(n));

      // 軸の選択状態が URL と一致していること
      await expect(page.locator(`#axis-periods .chip[data-period="${s.period}"]`)).toHaveClass(/is-active/);
      await expect(page.locator(`#axis-sections button[data-section="${s.section}"]`)).toHaveClass(/is-active/);
      await expect(page.locator('#country-code')).toHaveText(s.country);
    });
  }
});

/* --------------------------------------------------------------- ランキング表示 */

test.describe('ランキングカード', () => {
  test('順位は 1 から連番で、1位はヒーローカード', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);

    const ranks = await page.locator('#list .card[data-video-id]')
      .evaluateAll(els => els.map(e => Number(e.dataset.rank)));
    expect(ranks.length).toBe(expectedItemCount('all'));
    expect(ranks).toEqual(ranks.map((_, i) => i + 1));

    const hero = page.locator('#list .card-hero');
    await expect(hero).toHaveCount(1);
    await expect(hero).toHaveAttribute('data-rank', '1');
    await expect(hero.locator('.hero-badge')).toHaveText(I18N.en['card.hero']);
    await expect(hero.locator('.hero-rank')).toHaveText('1');

    // ヒーローはリストの先頭
    const firstIsHero = await page.locator('#list > li').first()
      .evaluate(el => el.classList.contains('card-hero'));
    expect(firstIsHero).toBe(true);
  });

  test('広告カードは AD_EVERY 件ごとに1枠、AD 表記つき（ORDER §2-9・発注者改訂）', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);

    const n = expectedItemCount('all');
    await expect(page.locator('#list .card-ad')).toHaveCount(expectedAdCount(n));

    const positions = await page.locator('#list > li').evaluateAll(els =>
      els.map((el, i) => (el.classList.contains('card-ad') ? i + 1 : 0)).filter(Boolean));
    expect(positions).toEqual(expectedAdPositions(n));

    // 広告枠は「AD」であることが一目で分かること（誤タップ防止・ORDER §8 の表示義務）
    await expect(page.locator('#list .card-ad .ad-tag').first()).toHaveText(I18N.en['ad.label']);
    // 広告カードは動画カードではない（リンクを持たない）
    await expect(page.locator('#list .card-ad a')).toHaveCount(0);

    // 広告と広告の間は必ず AD_EVERY 件
    const gaps = positions.map((p, i) => (i === 0 ? p - 1 : p - positions[i - 1] - 1));
    expect(new Set(gaps)).toEqual(new Set([AD_EVERY]));
  });

  test('転送 URL: 動画は watch?v=、ショートは /shorts/、別タブ＋noopener', async ({ page }) => {
    for (const section of SECTIONS.map(s => s.id)) {
      await gotoApp(page, everyoneHash({ section }));
      // 2周目はハッシュだけが変わる同一ドキュメント遷移なので、リストが空になる瞬間が無い。
      // 「リストが非空」だけを待つと前の部門のまま検証してしまうため、状態で待つ。
      await page.waitForFunction(s => window.__trendzap?.state.section === s, section);
      await waitForList(page);

      const links = await page.locator('#list .card[data-video-id] > a').evaluateAll(els =>
        els.map(a => ({
          href: a.getAttribute('href'),
          target: a.getAttribute('target'),
          rel: a.getAttribute('rel'),
          isShort: !!a.querySelector('.thumb.is-short'),
        })));

      expect(links.length).toBe(expectedItemCount('all'));
      for (const l of links) {
        // 縦動画バッジの有無と転送先の種類が食い違わないこと（SCHEMA.md §3 派生規則）
        expect(l.href).toMatch(l.isShort ? SHORTS_URL_RE : WATCH_URL_RE);
        expect(l.target).toBe('_blank');
        expect(l.rel).toContain('noopener');
        expect(l.rel).toContain('noreferrer');
      }
      // 部門と中身が一致していること（ショート部門に横動画が混ざっていない）
      const shorts = links.filter(l => l.isShort).length;
      expect(shorts).toBe(section === 'shorts' ? links.length : 0);
    }
  });

  test('順位変動マーク（↑ / ↓ / NEW）が区別できる形で出る', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);

    const up = page.locator('#list .delta-up');
    const down = page.locator('#list .delta-down');
    const isNew = page.locator('#list .delta-new');
    expect(await up.count()).toBeGreaterThan(0);
    expect(await down.count()).toBeGreaterThan(0);
    expect(await isNew.count()).toBeGreaterThan(0);

    // 1つの .delta が持つ状態クラスはちょうど1つ
    const classCounts = await page.locator('#list .delta').evaluateAll(els =>
      els.map(e => ['delta-up', 'delta-down', 'delta-new', 'delta-same']
        .filter(c => e.classList.contains(c)).length));
    expect(new Set(classCounts)).toEqual(new Set([1]));

    await expect(up.first()).toHaveText(/^▲\d+$/);
    await expect(down.first()).toHaveText(/^▼\d+$/);
    await expect(isNew.first()).toHaveText(I18N.en['card.new']);

    // 色でも見分けられる（上昇・下降・新規が同じ色ではない）
    const colors = await page.evaluate(() => ['delta-up', 'delta-down', 'delta-new']
      .map(c => getComputedStyle(document.querySelector('#list .' + c)).color));
    expect(new Set(colors).size).toBe(colors.length);
  });
});

/* ------------------------------------------------------------------ ザッピング */

test.describe('ザッピング（スワイプ／矢印キー）', () => {
  test('横スワイプで期間が前後に動く', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);
    expect(PERIODS[0].id).toBe('24h');

    await swipeList(page, 'left');   // 左へ払う＝次の期間へ
    await expect(page).toHaveURL(new RegExp(`/video/${PERIODS[1].id}/all/published$`));
    await expect(page.locator(`#axis-periods .chip[data-period="${PERIODS[1].id}"]`)).toHaveClass(/is-active/);
    await waitForList(page);

    await swipeList(page, 'right');  // 右へ払う＝前の期間へ
    await expect(page).toHaveURL(new RegExp(`/video/${PERIODS[0].id}/all/published$`));
    await waitForList(page);

    // 端では止まる（先頭より前には行かない）
    await swipeList(page, 'right');
    await expect(page).toHaveURL(new RegExp(`/video/${PERIODS[0].id}/all/published$`));
  });

  test('矢印キーでも同じように動く（キーボード等価）', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);

    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(new RegExp(`/video/${PERIODS[1].id}/all/published$`));
    await waitForList(page);

    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(new RegExp(`/video/${PERIODS[0].id}/all/published$`));
    await waitForList(page);
  });
});

/* ------------------------------------------- 伸びランキングの自動有効化（P4） */

test.describe('「伸び」ランキングの自動有効化（ORDER §2-14）', () => {
  /** index.json の features.growth だけ差し替える。 */
  async function routeIndexGrowth(page, growth) {
    const index = readIndexJSON();
    index.features = { ...index.features, growth };
    await page.route('**/data/index.json', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(index),
    }));
  }

  test('蓄積が足りない間は指標タブを DOM に出さない', async ({ page }) => {
    await routeIndexGrowth(page, { enabled: false, daysCollected: 1, requiredDays: 3, periods: [] });
    await gotoApp(page);
    await waitForList(page);
    await expect(page.locator('#axis-metric-row')).toBeHidden();
  });

  test('蓄積が足りたら指標タブが自動で現れる', async ({ page }) => {
    await routeIndexGrowth(page, { enabled: true, daysCollected: 3, requiredDays: 3, periods: ['24h'] });
    await gotoApp(page);
    await waitForList(page);

    const row = page.locator('#axis-metric-row');
    await expect(row).toBeVisible();
    await expect(page.locator('#axis-metric button[data-metric="published"]')).toHaveText(I18N.en['metric.published']);
    await expect(page.locator('#axis-metric button[data-metric="growth"]')).toHaveText(I18N.en['metric.growth']);
    await expect(page.locator('#axis-metric button[data-metric="growth"]')).toBeEnabled();

    // 有効化されていない期間では、タブは出たままでも「伸び」は押せない
    await page.locator('#axis-periods .chip[data-period="week"]').click();
    await waitForList(page);
    await expect(row).toBeVisible();
    await expect(page.locator('#axis-metric button[data-metric="growth"]')).toBeDisabled();
  });

  test('URL に growth が入っていても、無効なら published に正規化される', async ({ page }) => {
    await routeIndexGrowth(page, { enabled: false, daysCollected: 0, requiredDays: 3, periods: [] });
    await gotoApp(page, everyoneHash({ metric: 'growth' }));
    await waitForList(page);
    // normalize() は state を戻すだけで URL は書き換えない（起動時の hash は温存される）。
    // 大事なのは「存在しない -growth.json を取りに行かない」こと。
    expect((await appState(page)).metric).toBe('published');
    await expect(page.locator('#axis-metric-row')).toBeHidden();
    await expect(page.locator('#list .card[data-video-id]')).toHaveCount(expectedItemCount('all'));
  });
});

/* ------------------------------------------------------------- 空・エラー状態 */

test.describe('空とエラーの状態', () => {
  const target = '**/data/JP-video-24h-all.json';

  test('items が空なら空状態を出す', async ({ page }) => {
    const empty = { ...readDataset('JP', 'video', '24h', 'all'), items: [] };
    await page.route(target, route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(empty),
    }));

    await gotoApp(page, everyoneHash({ country: 'JP', section: 'video', period: '24h' }));
    await expect(page.locator('#list .state-title')).toHaveText(I18N.en['state.empty.title']);
    await expect(page.locator('#list .state-body')).toHaveText(I18N.en['state.empty.body']);
    await expect(page.locator('#list .card[data-video-id]')).toHaveCount(0);
    // 空はエラーではないので再試行ボタンは出さない
    await expect(page.locator('#list .state button')).toHaveCount(0);
  });

  test('取得に失敗したらエラー状態＋再試行ボタン。再試行で復帰する', async ({ page }) => {
    let failing = true;
    await page.route(target, route => (failing
      ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' })
      : route.continue()));

    await gotoApp(page, everyoneHash({ country: 'JP', section: 'video', period: '24h' }));
    await expect(page.locator('#list .state-title')).toHaveText(I18N.en['state.error.title']);

    const retry = page.locator('#list .state').getByRole('button', { name: I18N.en['state.retry'] });
    await expect(retry).toBeVisible();

    failing = false;
    await retry.click();
    await waitForList(page);
    await expect(page.locator('#list .card[data-video-id]')).toHaveCount(expectedItemCount('all'));
  });
});
