// ============================================================================
// e2e-groups.spec.js — v4 グループランキング（2026-08-25 発注者改訂 第3弾）
//
// 3つの約束を UI から確かめる:
//   1. 既定（GROUPS.endpoint 空）ではタブが出ない。直リンクで開いても「準備中」の案内だけ
//   2. `?groups=mock` で 作成 → ランキング表示 → URL貼り付けで追加 → プライバシー文 まで一巡できる
//   3. 招待リンク（#/groups/{id}）で開くと自動参加して端末の一覧に残る
//
// サーバー（workers/taps の /g 系）の中身は tests/unit-worker.spec.js が守る。
// ここで見るのはフロントの導線だけなので、ネットワークに出ない mock で密閉する。
// ============================================================================

import { test, expect } from '@playwright/test';
import { gotoApp, waitForApp, seedStorage, blockThumbnails, I18N } from './helpers.js';
import { GROUPS } from '../public/js/config.js';

test.use({ serviceWorkers: 'block' });

test.describe('既定（endpoint 空）', () => {
  test.skip(GROUPS.endpoint !== '', 'GROUPS.endpoint 設定済み（ゲートB完了後）のため、既定=無効のテストは対象外');

  test('グループタブは出ず、#/groups を直接開くと「準備中」の案内が出る', async ({ page }) => {
    await gotoApp(page, '#/groups');
    await expect(page.locator('#mode-groups')).toBeHidden();
    await expect(page.locator('#view-groups')).toBeVisible();
    await expect(page.locator('#groups-wrap .state-title')).toHaveText(I18N.en['groups.notEnabled.title']);
  });
});

test.describe('?groups=mock（表示専用・ネットワークに出ない）', () => {
  const open = async (page, hash = '#/groups') => {
    await blockThumbnails(page);
    await seedStorage(page, { 'ytta.hintSeen': true });
    await page.goto(`/?lang=en&groups=mock${hash}`);
    await waitForApp(page);
  };

  test('タブが出て、作成 → ランキング → URL貼り付けで追加 → プライバシー文 まで一巡できる', async ({ page }) => {
    await open(page);
    await expect(page.locator('#mode-groups')).toBeVisible();

    // 空状態 → 作成（mock は固定 id を返す）
    await expect(page.locator('#groups-wrap .state-title')).toHaveText(I18N.en['groups.empty.title']);
    await page.locator('#groups-wrap .btn-primary').click();
    await expect(page).toHaveURL(/#\/groups\/[a-z0-9]{10}$/);

    // ランキング（mock の決定論的な4本。追加数×新しさの順）
    await expect(page.locator('#group-list .card')).toHaveCount(4);
    await expect(page.locator('.group-count').first())
      .toHaveText(I18N.en['groups.count'].replace('{n}', '4'));

    // YouTube の URL を貼ると videoId が抜き出されて先頭に加わる
    await page.locator('#group-add-input').fill('https://youtu.be/OPf0YbXqDm0?t=5');
    await page.locator('.group-add .btn-primary').click();
    await expect(page.locator('#group-list .card')).toHaveCount(5);

    // 変な入力は弾く（件数が変わらない）
    await page.locator('#group-add-input').fill('not a link');
    await page.locator('.group-add .btn-primary').click();
    await expect(page.locator('#group-list .card')).toHaveCount(5);

    // プライバシーの約束（誰が追加したかは残らない・90日で消える）を常時表示
    await expect(page.locator('.group-privacy')).toHaveText(I18N.en['groups.privacy']);
  });

  test('招待リンク（#/groups/{id}）で開くと自動参加して端末の一覧に残る', async ({ page }) => {
    await open(page, '#/groups/friend0001');
    await expect(page.locator('#group-list .card').first()).toBeVisible();
    const stored = await page.evaluate(
      k => JSON.parse(localStorage.getItem(k) || 'null'),
      GROUPS.storageKey,
    );
    expect(stored.list.map(g => g.id)).toContain('friend0001');
  });
});
