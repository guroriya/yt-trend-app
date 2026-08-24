// ============================================================================
// e2e-i18n-theme.spec.js — ORDER §6 P3「i18n切替」＋ テーマ（ORDER §2-5 / §5）
//
// 期待値は public/i18n/{en,ja}.json から引く。テストに文言をベタ書きすると
// 「文言は必ず i18n に置く」という約束（CLAUDE.md §4）をテストが破ってしまう。
// ============================================================================

import { test, expect } from '@playwright/test';
import {
  gotoApp, waitForList, everyoneHash, I18N, PERIODS, SECTIONS, CATEGORIES,
} from './helpers.js';

const EN = I18N.en;
const JA = I18N.ja;

/* --------------------------------------------------------------------- i18n */

test.describe('言語切替', () => {
  test('既定は英語で、見えている文言が en 辞書と一致する', async ({ page }) => {
    await gotoApp(page, everyoneHash(), { lang: 'en' });
    await waitForList(page);

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle(`${EN['app.name']} — ${EN['app.tagline']}`);
    await expect(page.locator('.mode[data-mode="everyone"]')).toHaveText(EN['mode.everyone']);
    await expect(page.locator('.mode[data-mode="my"]')).toHaveText(EN['mode.my']);

    for (const p of PERIODS) {
      await expect(page.locator(`#axis-periods .chip[data-period="${p.id}"]`)).toHaveText(EN[`period.${p.id}`]);
    }
    for (const s of SECTIONS) {
      await expect(page.locator(`#axis-sections button[data-section="${s.id}"]`)).toHaveText(EN[`section.${s.id}`]);
    }
    for (const c of CATEGORIES) {
      await expect(page.locator(`#axis-categories .chip[data-category="${c.id}"]`)).toHaveText(EN[`category.${c.id}`]);
    }

    // 言語ボタンは「切り替えた先」を出す
    await expect(page.locator('#lang-code')).toHaveText('JA');
  });

  test('#btn-lang で en ⇄ ja が切り替わり、ラベルもタイトルも入れ替わる', async ({ page }) => {
    await gotoApp(page, everyoneHash(), { lang: 'en' });
    await waitForList(page);

    await page.locator('#btn-lang').click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(page).toHaveTitle(`${JA['app.name']} — ${JA['app.tagline']}`);
    await expect(page.locator('.mode[data-mode="everyone"]')).toHaveText(JA['mode.everyone']);
    await expect(page.locator('#axis-periods .chip[data-period="24h"]')).toHaveText(JA['period.24h']);
    await expect(page.locator('#lang-code')).toHaveText('EN');

    // 切り替えてもランキングは出たまま（再描画で消えない）
    await waitForList(page);

    await page.locator('#btn-lang').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.mode[data-mode="everyone"]')).toHaveText(EN['mode.everyone']);
  });

  test('選んだ言語は reload をまたいで残る', async ({ page }) => {
    await gotoApp(page, everyoneHash(), { lang: 'en' });
    await waitForList(page);
    await page.locator('#btn-lang').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

    // ?lang= を付けずに開き直す（付けたままだとクエリが勝ってしまい永続の確認にならない）
    await page.goto(`/${everyoneHash()}`);
    await waitForList(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(page.locator('.mode[data-mode="everyone"]')).toHaveText(JA['mode.everyone']);
  });

  test('?lang= は保存済みの設定より優先される（共有リンク用）', async ({ page }) => {
    await gotoApp(page, everyoneHash(), { lang: 'en' });
    await waitForList(page);

    await page.goto(`/?lang=ja${everyoneHash()}`);
    await waitForList(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  });

  test('広告ラベルなど言語に依存しない表記は両言語で同じ', async ({ page }) => {
    // ad.label は en/ja とも "AD"。ここが食い違うと広告表記の一貫性が崩れる（ORDER §2-9）
    expect(JA['ad.label']).toBe(EN['ad.label']);
    await gotoApp(page, everyoneHash(), { lang: 'ja' });
    await waitForList(page);
    await expect(page.locator('#list .card-ad .ad-tag').first()).toHaveText(JA['ad.label']);
  });
});

/* -------------------------------------------------------------------- テーマ */

test.describe('テーマ', () => {
  test('既定（auto＋light 環境）では data-theme="light"', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('設定シートでダークを選ぶと即座に切り替わり、reload しても残る', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);

    await page.locator('#btn-settings').click();
    await expect(page.locator('#sheet-settings')).toBeVisible();

    const themeGroup = page.locator('#sheet-body .set-group', { hasText: EN['settings.theme'] });
    await themeGroup.getByRole('button', { name: EN['settings.theme.dark'], exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.locator('#sheet-close').click();
    await expect(page.locator('#sheet-settings')).toBeHidden();

    await page.reload();
    await waitForList(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('localStorage の ytta.theme=dark で開くとダークで表示される', async ({ page }) => {
    // 値は JSON 文字列。app.js の LS.set/LS.get が JSON で符号化しているため、
    // 生の 'dark' を入れると JSON.parse に失敗して既定（auto）に落ちる。
    await gotoApp(page, everyoneHash(), { seed: { 'ytta.theme': 'dark' } });
    await waitForList(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await waitForList(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('auto のときは OS の設定に従う', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await gotoApp(page);
    await waitForList(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});
