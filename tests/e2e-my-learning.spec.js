// ============================================================================
// e2e-my-learning.spec.js — ORDER §6 P4 検収基準
//   「学習の『見える・消せる・いじれる』を E2E で確認／地図タブ表示」
//   （伸びランキングの自動有効化は e2e-everyone.spec.js が持つ）
//
// ORDER §2-11: 端末内学習。一覧で見える・個別に消せる・重みをいじれる。外部送信なし。
// ============================================================================

import { test, expect } from '@playwright/test';
import {
  gotoApp, waitForList, seedLearning, readLearning,
  COUNTRIES, MAP_COUNTRIES, LEARNING, I18N,
} from './helpers.js';

const EN = I18N.en;

test.use({ serviceWorkers: 'block' });

/* --------------------------------------------------------------- 学習が貯まる */

test.describe('端末内学習', () => {
  test('見ているだけで学習が端末内に貯まる（IntersectionObserver）', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);

    // ファーストビューに入ったカードの分がまず記録される
    await expect.poll(async () => {
      const d = await readLearning(page);
      return d ? Object.keys(d.channels).length : 0;
    }, { message: '表示しただけで学習が始まること' }).toBeGreaterThan(0);

    const before = await readLearning(page);
    expect(before.v).toBe(1);
    expect(before.enabled).toBe(true);

    await page.evaluate(() => window.scrollBy(0, 4000));
    await expect.poll(async () => {
      const d = await readLearning(page);
      return Object.keys(d.channels).length;
    }, { message: 'スクロールで学習が増えること' })
      .toBeGreaterThan(Object.keys(before.channels).length);
  });

  test('学習は外へ出ない（同一オリジン以外へ通信しない）', async ({ page }) => {
    const requested = [];
    page.on('request', r => requested.push(r.url()));

    await gotoApp(page);
    await waitForList(page);
    await seedLearning(page);
    await page.locator('.mode[data-mode="my"]').click();
    await waitForList(page, '#my-list');
    await page.locator('#my-inspect').click();
    await expect(page.locator('#my-inspector .insp-row').first()).toBeVisible();

    const origin = new URL(page.url()).origin;
    const outside = requested.filter(u => /^https?:/.test(u))
      .filter(u => new URL(u).origin !== origin)
      // サムネイルだけは i.ytimg.com（ORDER §8 で許容。学習内容は載らない）
      .filter(u => new URL(u).hostname !== 'i.ytimg.com');
    expect(outside, `外部送信を検出: ${outside.join(', ')}`).toEqual([]);
  });

  /* ------------------------------------------------------------ 見える */

  test('見える: 学習結果が「自分」タブのランキングと理由行に出る', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);
    await seedLearning(page);

    await page.locator('.mode[data-mode="my"]').click();
    await expect(page).toHaveURL(/#\/my$/);
    await expect(page.locator('#view-my')).toBeVisible();
    await expect(page.locator('#view-my .pane-title')).toHaveText(EN['my.title']);
    await waitForList(page, '#my-list');

    const cards = page.locator('#my-list .card[data-video-id]');
    expect(await cards.count()).toBeGreaterThan(0);

    // 「なぜ出たか」が必ず1行出る（見えることが仕様の核）
    const why = page.locator('#my-list .why');
    expect(await why.count()).toBe(await cards.count());
    await expect(why.first()).toContainText(EN['my.matched'].split('{reason}')[0].trim());

    // 自分のランキングも 1 位から連番
    const ranks = await cards.evaluateAll(els => els.map(e => Number(e.dataset.rank)));
    expect(ranks).toEqual(ranks.map((_, i) => i + 1));
  });

  test('見える: インスペクタに学習した語とチャンネルが一覧で出る', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);
    await seedLearning(page);
    await page.locator('.mode[data-mode="my"]').click();

    const inspector = page.locator('#my-inspector');
    await expect(inspector).toBeHidden();
    await expect(page.locator('#my-inspect')).toHaveText(EN['my.inspector.open']);

    await page.locator('#my-inspect').click();
    await expect(inspector).toBeVisible();
    await expect(page.locator('#my-inspect')).toHaveText(EN['my.inspector.close']);

    const rows = inspector.locator('.insp-row');
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(inspector.locator('.insp-h').first()).toHaveText(EN['my.channels']);
    await expect(inspector).toContainText(EN['my.terms']);
    await expect(inspector.locator('.insp-note')).toHaveText(EN['my.localOnly']);

    // 1行は「名前・重みスライダ・数値・ミュート・削除」で構成される
    const first = rows.first();
    await expect(first.locator('.insp-name')).not.toBeEmpty();
    await expect(first.locator('input[type="range"]')).toBeVisible();
    await expect(first.locator(`button[aria-label^="${EN['my.mute']}"]`)).toBeVisible();
    await expect(first.locator(`button[aria-label^="${EN['my.remove']}"]`)).toBeVisible();

    // 閉じられる
    await page.locator('#my-inspect').click();
    await expect(inspector).toBeHidden();
  });

  /* ------------------------------------------------------------ いじれる */

  test('いじれる: スライダで重みを変えると表示にも端末内保存にも反映される', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);
    await seedLearning(page);
    await page.locator('.mode[data-mode="my"]').click();
    await page.locator('#my-inspect').click();

    const first = page.locator('#my-inspector .insp-row').first();
    const name = (await first.locator('.insp-name').textContent()).trim();
    const range = first.locator('input[type="range"]');
    await expect(range).toHaveAttribute('max', '100');

    // 表示ログの学習（IntersectionObserver）が走り続けていると、書いた直後に
    // 重みが加算されて厳密比較が不安定になる。値を触る前に学習を止める。
    await page.evaluate(() => window.__trendzap.Learn.setEnabled(false));
    await range.fill('80');

    await expect(first.locator('.insp-w')).toHaveText('80');
    await expect.poll(async () => {
      const d = await readLearning(page);
      const hit = Object.values(d.channels).find(v => (v.name || '') === name);
      return hit ? hit.w : null;
    }, { message: '重みが端末内保存に書かれること' }).toBe(80);
  });

  /* ------------------------------------------------------------ 消せる */

  test('消せる: 1件ずつ忘れさせられる', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);
    await seedLearning(page);
    await page.locator('.mode[data-mode="my"]').click();
    await page.locator('#my-inspect').click();

    const rows = page.locator('#my-inspector .insp-row');
    const before = await rows.count();
    expect(before).toBeGreaterThan(1);

    const first = rows.first();
    const name = (await first.locator('.insp-name').textContent()).trim();
    await first.locator(`button[aria-label^="${EN['my.remove']}"]`).click();

    // 仕様の核は「その1件が消える」こと。行数は各グループ上位12件表示（renderInspector の
    // slice(0,12)）のため、溢れた分が繰り上がると減らない。増えていないことだけ確かめる。
    await expect(page.locator('#my-inspector .insp-name', { hasText: name })).toHaveCount(0);
    expect(await rows.count()).toBeLessThanOrEqual(before);
  });

  test('消せる: ミュートして、また戻せる', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);
    await seedLearning(page);
    await page.locator('.mode[data-mode="my"]').click();
    await page.locator('#my-inspect').click();

    const inspector = page.locator('#my-inspector');
    await inspector.locator('.insp-row').first()
      .locator(`button[aria-label^="${EN['my.mute']}"]`).click();

    const unmute = inspector.getByRole('button', { name: EN['my.unmute'] });
    await expect(unmute).toBeVisible();
    await expect.poll(async () => (await readLearning(page)).muted.length).toBe(1);

    await unmute.click();
    await expect(inspector.getByRole('button', { name: EN['my.unmute'] })).toHaveCount(0);
    await expect.poll(async () => (await readLearning(page)).muted.length).toBe(0);
  });

  test('消せる: 全消去すると学習前の状態に戻る', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);
    await seedLearning(page);
    await page.locator('.mode[data-mode="my"]').click();
    await page.locator('#my-inspect').click();
    await expect(page.locator('#my-inspector .insp-row').first()).toBeVisible();

    // confirm() を承認する（既定では Playwright は dismiss する＝何も消えない）
    let dialogMessage = null;
    page.once('dialog', async dialog => {
      dialogMessage = dialog.message();
      await dialog.accept();
    });
    await page.locator('#my-inspector .insp-actions')
      .getByRole('button', { name: EN['my.clearAll'] }).click();

    await expect.poll(() => dialogMessage, { message: '確認ダイアログが出ること' })
      .toBe(EN['my.clearAll.confirm']);
    await expect(page.locator('#my-inspector .insp-row')).toHaveCount(0);
    await expect(page.locator('#my-list .state-title')).toHaveText(EN['my.empty.title']);
    expect(await page.evaluate(() => window.__trendzap.Learn.isEmpty())).toBe(true);
  });

  /* --------------------------------------------------------- 学習の停止 */

  test('学習スイッチを切ると新しい記録が止まる', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);
    await seedLearning(page);
    await page.locator('.mode[data-mode="my"]').click();

    const toggle = page.locator('#my-enabled');
    await expect(toggle).toBeChecked();
    await page.locator('.pane-tools label.switch').click();   // input は視覚的に隠れているのでラベルを押す
    await expect(toggle).not.toBeChecked();
    await expect.poll(async () => (await readLearning(page)).enabled).toBe(false);

    const before = Object.keys((await readLearning(page)).channels).length;
    const after = await page.evaluate(key => {
      window.__trendzap.Learn.record({
        videoId: 'zzzzzzzzzzz', title: 'stopped learning probe', channelId: 'UC_probe',
        channelTitle: 'Probe', categoryId: '10', tags: ['probe'],
      }, 'open');
      return Object.keys(JSON.parse(localStorage.getItem(key)).channels).length;
    }, LEARNING.storageKey);
    expect(after).toBe(before);
  });
});

/* ------------------------------------------------------------- 地図・ワード */

test.describe('世界タブ（ORDER §2-13）', () => {
  test('各国1位がピンと一覧で出る', async ({ page }) => {
    await gotoApp(page);
    await page.locator('.mode[data-mode="map"]').click();
    await expect(page).toHaveURL(/#\/map$/);

    const wrap = page.locator('#map-wrap');
    await expect(wrap).toBeVisible();
    await expect(wrap.locator('.map-pin')).toHaveCount(MAP_COUNTRIES.length);
    // ピンは 44px を確保できないので、同じ内容を 44px の行一覧でも出す（憲章の主導線）
    await expect(wrap.locator('.mc-btn')).toHaveCount(MAP_COUNTRIES.length);
    await expect(wrap.locator('.mc-row.is-primary').first()).toBeVisible();
  });

  test('対応国の行を押すとその国のランキングへ潜る', async ({ page }) => {
    await gotoApp(page);
    await page.locator('.mode[data-mode="map"]').click();
    await page.locator('#map-wrap .mc-row.is-primary .mc-btn').first().click();

    const codes = COUNTRIES.map(c => c.code).join('|');
    await expect(page).toHaveURL(new RegExp(`#/everyone/(${codes})/video/24h/all/published$`));
    await waitForList(page);
  });
});

test.describe('ワードタブ（ORDER §2-12）', () => {
  test('勢いのある語が順位つきで出る', async ({ page }) => {
    await gotoApp(page);
    await page.locator('.mode[data-mode="tags"]').click();
    await expect(page).toHaveURL(new RegExp(`#/tags/${COUNTRIES[0].code}$`));

    const rows = page.locator('#tag-list .tagrow');
    expect(await rows.count()).toBeGreaterThan(9);
    await expect(rows.first().locator('.tagrank')).toHaveText('1');
    await expect(rows.first().locator('.tagterm')).not.toBeEmpty();
    await expect(rows.first().locator('.tagcount')).toHaveText(/\d/);
  });
});
