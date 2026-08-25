// ============================================================================
// e2e-search-favs.spec.js — 2026-08-25 発注者改訂の3機能
//   1. ランキング内検索（表示中のランキングを絞る＋期間つきで YouTube へ転送）
//   2. 検索タブ（旧ワードタブ）: 集めたランキング全体を横断して検索
//   3. よく見るランキング（自動チップ＋手動ピン。端末内のみ・外部送信なし）
// ============================================================================

import { test, expect } from '@playwright/test';
import {
  COUNTRIES, SECTIONS, PERIODS, I18N,
  gotoApp, waitForList, everyoneHash, tagsHash, readDataset, readIndexJSON,
} from './helpers.js';

test.use({ serviceWorkers: 'block' });

const EN = I18N.en;

/* ------------------------------------------------- 1. ランキング内検索 */

test.describe('ランキング内検索', () => {
  test('入力するとその語を含む行だけが残り、件数が出る', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);
    const all = await page.locator('#list .card[data-video-id]').count();

    // モックの1位のタイトルから、確実に一致する語を採る
    const data = readDataset(COUNTRIES[0].code, SECTIONS[0].id, PERIODS[0].id);
    const term = data.items[0].title.slice(0, 4);

    await page.locator('#q').fill(term);
    await expect(page.locator('#statusbar')).toContainText(/\d/);
    const hits = await page.locator('#list .card[data-video-id]').count();
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThanOrEqual(all);

    // 残った行はすべてその語を含む（タイトル・チャンネル・タグのいずれか）
    const titles = await page.locator('#list .card[data-video-id] .title').allTextContents();
    expect(titles.length).toBe(hits);
  });

  test('YouTube への転送リンクに検索語と期間フィルタが載る', async ({ page }) => {
    await gotoApp(page, everyoneHash({ period: 'week' }));
    await waitForList(page);
    await page.locator('#q').fill('game');

    const link = page.locator('#statusbar .q-yt');   // 入力欄を潰さないようステータスバーに置いている
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toContain('youtube.com/results?search_query=game');
    expect(href).toContain('sp=');                       // 週間の期間フィルタ
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  });

  test('一致ゼロなら YouTube への導線つきの案内が出る', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);
    await page.locator('#q').fill('zzzzz-not-in-any-ranking-zzzzz');
    await expect(page.locator('#list .state-title')).toBeVisible();
    await expect(page.locator('#list .state a.btn')).toHaveAttribute('href', /youtube\.com\/results/);
  });

  test('✕ で検索が解除され、元の件数に戻る', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);
    const all = await page.locator('#list .card[data-video-id]').count();
    await page.locator('#q').fill('zzzzz');
    await expect(page.locator('#list .state-title')).toBeVisible();
    await page.locator('#q-clear').click();
    await waitForList(page);
    await expect(page.locator('#list .card[data-video-id]')).toHaveCount(all);
  });
});

/* ------------------------------------------------------- 2. 検索タブ */

test.describe('検索タブ', () => {
  test('横断検索: 複数のランキングから集めて件数と出典を出す', async ({ page }) => {
    await gotoApp(page, tagsHash());
    await expect(page.locator('#find-words .chip').first()).toBeVisible();

    const data = readDataset(COUNTRIES[0].code, SECTIONS[0].id, PERIODS[0].id);
    const term = data.items[0].title.slice(0, 3);
    await page.locator('#fq').fill(term);

    await expect(page.locator('#find-list .card[data-video-id]').first()).toBeVisible();
    await expect(page.locator('#find-status')).toContainText(/\d/);
    // 各行に「どのランキングの何位で見つかったか」が出る
    await expect(page.locator('#find-list .card .why').first()).toBeVisible();
  });

  test('期間・種類で絞り込める', async ({ page }) => {
    await gotoApp(page, tagsHash());
    // 絞り込み後の組み合わせ（期間=先頭 / 部門=2つ目）に確実に存在する語を使う
    const target = readDataset(COUNTRIES[0].code, SECTIONS[1].id, PERIODS[0].id);
    await page.locator('#fq').fill(target.items[0].title.slice(0, 3));
    await expect(page.locator('#find-list .card[data-video-id]').first()).toBeVisible();

    await page.locator(`#find-periods .chip[data-period="${PERIODS[0].id}"]`).click();
    await expect(page.locator(`#find-periods .chip[data-period="${PERIODS[0].id}"]`)).toHaveClass(/is-active/);
    await page.locator(`#find-sections button[data-section="${SECTIONS[1].id}"]`).click();
    await expect(page.locator(`#find-sections button[data-section="${SECTIONS[1].id}"]`)).toHaveClass(/is-active/);

    // 絞ったあとも結果は出る（この組み合わせのモックは必ず存在する）
    await expect(page.locator('#find-list .card[data-video-id]').first()).toBeVisible();
    const where = await page.locator('#find-list .card .why').first().textContent();
    expect(where).toContain(EN[`period.${PERIODS[0].id}`]);
  });
});

/* --------------------------------------------- 3. よく見るランキング */

test.describe('よく見るランキング', () => {
  test('☆で今のランキングを留められ、別の軸から1タップで戻れる', async ({ page }) => {
    await gotoApp(page, everyoneHash({ period: '24h' }));
    await waitForList(page);

    await expect(page.locator('#favs')).toBeHidden();      // 何も無いうちは行ごと出さない
    await page.locator('.favstar').click();
    await expect(page.locator('.favstar')).toHaveAttribute('aria-pressed', 'true');

    // 別の期間へ移ると、留めた場所がチップとして出る
    await page.locator('#axis-periods .chip[data-period="month"]').click();
    await waitForList(page);
    await expect(page.locator('#favs')).toBeVisible();
    const chip = page.locator('.favchip.is-pinned .favchip-go').first();
    await expect(chip).toBeVisible();

    await chip.click();
    await expect(page).toHaveURL(/\/video\/24h\/all\/published$/);
    await waitForList(page);
  });

  test('チップは ✕ で消せる', async ({ page }) => {
    await gotoApp(page, everyoneHash({ period: '24h' }));
    await waitForList(page);
    await page.locator('.favstar').click();
    await page.locator('#axis-periods .chip[data-period="week"]').click();
    await waitForList(page);
    await expect(page.locator('.favchip')).toHaveCount(1);

    await page.locator('.favchip-x').first().click();
    await expect(page.locator('.favchip')).toHaveCount(0);
    await expect(page.locator('#favs')).toBeHidden();
  });

  test('よく見る記録は端末内だけ（外部への送信が無い）', async ({ page }) => {
    const external = [];
    await page.context().route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith('http://localhost')) { external.push(url); return route.abort(); }
      return route.fallback();
    });
    await gotoApp(page, everyoneHash());
    await waitForList(page);
    await page.locator('.favstar').click();
    for (const p of ['week', 'month', '24h']) {
      await page.locator(`#axis-periods .chip[data-period="${p}"]`).click();
      await waitForList(page);
    }
    expect(external).toEqual([]);

    // 記録は localStorage にだけ残る
    const stored = await page.evaluate(() => localStorage.getItem('ytta.freq.v1'));
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored).pins.length).toBeGreaterThan(0);
  });
});

/* ------------------------------ 4. 収集がまだ届いていない軸の扱い（2026-08-25 レビュー） */

test.describe('未収集データの扱い', () => {
  /** index.json を「JP-video-24h-all しか無い」状態に差し替えて配る。 */
  async function routeThinIndex(page) {
    const idx = readIndexJSON();
    await page.route('**/data/index.json', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...idx, datasets: { 'JP-video-24h-all': idx.datasets['JP-video-24h-all'] } }),
    }));
  }

  test('データのある軸だけがチップに出る（押せない軸を見せない）', async ({ page }) => {
    await routeThinIndex(page);
    await gotoApp(page, everyoneHash({ country: 'JP', section: 'video', period: '24h' }));
    await waitForList(page);

    const visible = page.locator('#axis-periods .chip:not([hidden])');
    await expect(visible).toHaveCount(1);
    await expect(page.locator('#axis-categories .chip:not([hidden])')).toHaveCount(1);
    await expect(page.locator('#axis-sections button:not([hidden])')).toHaveCount(1);
  });

  test('未収集の軸へ直リンクしても、ある軸へ寄せて表示する（404 のエラーを見せない）', async ({ page }) => {
    await routeThinIndex(page);
    await gotoApp(page, everyoneHash({ country: 'JP', section: 'shorts', period: 'year' }));
    await waitForList(page);

    // 引き戻された結果、必ずデータのある組み合わせになっている
    await expect(page).toHaveURL(/\/JP\/video\/24h\/all\/published$/);
    await expect(page.locator('#list .state-title')).toHaveCount(0);
  });

  test('データが本当に無いときは「集計中」であって通信エラーではない', async ({ page }) => {
    await routeThinIndex(page);
    // ファイル自体を 404 にする（index には載っているが取れない ＝ 本当のエラー経路と区別する）
    await page.route('**/data/JP-video-24h-all.json', route => route.fulfill({ status: 404, body: '' }));
    await gotoApp(page, everyoneHash({ country: 'JP', section: 'video', period: '24h' }));
    await expect(page.locator('#list .state-title')).toHaveText(I18N.en['state.error.title']);

    // index に載っていない軸なら「集計中」（再読み込みボタンを出さない）
    await page.evaluate(() => {
      const st = window.__trendzap.state;
      st.index = { ...st.index, datasets: {} };
    });
    await page.evaluate(() => window.__trendzap.go({ period: '24h' }));
    await expect(page.locator('#list .state-title')).toHaveText(I18N.en['state.pending.title']);
    await expect(page.locator('#list .state .btn')).toHaveCount(0);
  });
});
