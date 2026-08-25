// ============================================================================
// smoke.spec.js — ORDER §6 P0 検収基準
//   「ローカルでページ表示／タブ切替動作／Playwrightスモーク通過」
//
// ここが落ちたら他は見るまでもない、という最小限だけを速く確かめる。
// ============================================================================

import { test, expect } from '@playwright/test';
import {
  gotoApp, waitForList, everyoneHash, expectedItemCount, expectedAdCount,
  COUNTRIES, SECTIONS, PERIODS, CATEGORIES, I18N,
} from './helpers.js';

test.describe('P0 スモーク', () => {
  test('トップが表示され、骨格（アプリバー・モード・軸・リスト）が揃う', async ({ page }) => {
    await gotoApp(page);

    await expect(page).toHaveTitle(new RegExp(I18N.en['app.name']));
    await expect(page.locator('.appbar .brand-name')).toHaveText(I18N.en['app.name']);

    // モードは みんな／自分／ワード／世界 の4枚（ORDER §2-11, §2-12, §2-13）
    await expect(page.locator('nav.modes .mode')).toHaveCount(4);
    await expect(page.locator('.mode[data-mode="everyone"]')).toHaveAttribute('aria-selected', 'true');

    // 軸は config.js から生成される。数が合わない＝設定と UI がずれている。
    await expect(page.locator('#axis-periods .chip')).toHaveCount(PERIODS.length);
    await expect(page.locator('#axis-sections button')).toHaveCount(SECTIONS.length);
    await expect(page.locator('#axis-categories .chip')).toHaveCount(CATEGORIES.length);

    await expect(page.locator('#statusbar')).toBeVisible();
    await waitForList(page);

    // 既定は 100 件（総合）＋ AD_EVERY 件ごとの広告枠
    await expect(page.locator('#list .card[data-video-id]')).toHaveCount(expectedItemCount('all'));
    await expect(page.locator('#list .card-ad')).toHaveCount(expectedAdCount(expectedItemCount('all')));
    await expect(page.locator('#list .card-hero')).toHaveCount(1);
  });

  test('モードタブ（みんな／自分／ワード／世界）を一巡できる', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);

    await page.locator('.mode[data-mode="my"]').click();
    await expect(page).toHaveURL(/#\/my$/);
    await expect(page.locator('#view-my')).toBeVisible();
    await expect(page.locator('#view-everyone')).toBeHidden();

    await page.locator('.mode[data-mode="tags"]').click();
    await expect(page).toHaveURL(new RegExp(`#/tags/${COUNTRIES[0].code}$`));
    await expect(page.locator('#view-tags')).toBeVisible();
    await expect(page.locator('#tag-list .tagrow').first()).toBeVisible();

    await page.locator('.mode[data-mode="map"]').click();
    await expect(page).toHaveURL(/#\/map$/);
    await expect(page.locator('#map-wrap .mc-btn').first()).toBeVisible();

    await page.locator('.mode[data-mode="everyone"]').click();
    await expect(page).toHaveURL(/#\/everyone\//);
    await waitForList(page);
  });

  test('期間・部門・カテゴリのタブ切替でリストが差し替わる', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);

    await page.locator('#axis-periods .chip[data-period="week"]').click();
    await expect(page).toHaveURL(/#\/everyone\/[A-Z]{2}\/video\/week\/all\/published$/);
    await expect(page.locator('#axis-periods .chip[data-period="week"]')).toHaveClass(/is-active/);
    await waitForList(page);

    await page.locator('#axis-periods .chip[data-period="24h"]').click();
    await page.locator('#axis-sections button[data-section="shorts"]').click();
    await expect(page).toHaveURL(/\/shorts\/24h\/all\/published$/);
    await waitForList(page);
    await expect(page.locator('#list .thumb.is-short').first()).toBeVisible();

    await page.locator('#axis-categories .chip[data-category="music"]').click();
    await expect(page).toHaveURL(/\/shorts\/24h\/music\/published$/);
    await waitForList(page);
    await expect(page.locator('#list .card[data-video-id]')).toHaveCount(expectedItemCount('music'));
  });

  test('初回だけスワイプヒントが出て、閉じると消える', async ({ page }) => {
    await gotoApp(page, everyoneHash(), { hintSeen: false });
    const hint = page.locator('.hint');
    await expect(hint).toBeVisible();
    // hint.swipe は "{axis}" プレースホルダ入りの辞書文字列。実表示は軸名に置換される
    await expect(hint).toContainText(
      I18N.en['hint.swipe'].replace('{axis}', I18N.en['settings.swipeAxis.period']));

    await hint.getByRole('button', { name: I18N.en['hint.gotIt'] }).click();
    await expect(hint).toHaveCount(0);

    // 既読は端末に残る（reload しても出ない）
    await page.reload();
    await waitForList(page);
    await expect(page.locator('.hint')).toHaveCount(0);
  });

  test('起動から一巡まで未捕捉の JS 例外が出ない', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));

    await gotoApp(page);
    await waitForList(page);
    for (const mode of ['my', 'tags', 'map', 'everyone']) {
      await page.locator(`.mode[data-mode="${mode}"]`).click();
      await expect(page.locator(`#view-${mode}`)).toBeVisible();
    }
    await page.locator('#btn-settings').click();
    await expect(page.locator('#sheet-settings')).toBeVisible();
    await page.locator('#sheet-close').click();

    expect(errors, errors.join('\n')).toEqual([]);
  });
});
