// ============================================================================
// e2e-pwa-offline.spec.js — ORDER §6 P3「PWAインストール可能」＋ §2-10 オフライン表示
//
// 「インストール可能」を headless で直接検証する API は無い（beforeinstallprompt は
// ユーザー操作とエンゲージメント条件に依存し、CI では発火しない）。そこで Chrome の
// インストール要件そのものを分解して確かめる:
//   1. manifest が取得でき、name / start_url / display / 192・512 のアイコンが揃う
//   2. アイコンの実体が実際に配信されている
//   3. Service Worker が登録され、fetch ハンドラを持って active になる
//   4. その結果としてオフラインでも直近のランキングが出る（§2-10）
// この4つが揃った状態が、headless で到達できる「インストール可能」の実質である。
// ============================================================================

import { test, expect } from '@playwright/test';
import { gotoApp, waitForList, everyoneHash, expectedItemCount } from './helpers.js';

// このファイルだけは Service Worker を有効にする（他のファイルは route 差し替えのため止めている）
test.use({ serviceWorkers: 'allow' });

/** navigator.serviceWorker.ready を「待ちっぱなしにならない形」で待つ。 */
async function serviceWorkerStatus(page, timeoutMs = 20_000) {
  return page.evaluate(async ms => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const timer = new Promise(r => setTimeout(() => r(null), ms));
    const reg = await Promise.race([navigator.serviceWorker.ready, timer]);
    if (!reg) {
      return {
        supported: true,
        ready: false,
        registrations: (await navigator.serviceWorker.getRegistrations()).length,
      };
    }
    return {
      supported: true,
      ready: true,
      scope: reg.scope,
      active: !!reg.active,
      controller: !!navigator.serviceWorker.controller,
    };
  }, timeoutMs);
}

test.describe('PWA', () => {
  test('manifest.webmanifest が取得でき、インストール要件を満たす', async ({ request, baseURL }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok(), `manifest の取得に失敗: ${res.status()}`).toBeTruthy();

    const manifest = await res.json();     // ここで壊れた JSON なら失敗する

    expect(manifest.name, 'name は必須').toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url, 'start_url は必須').toBeTruthy();
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
    expect(Array.isArray(manifest.icons)).toBe(true);

    const sizes = manifest.icons.flatMap(i => String(i.sizes || '').split(/\s+/));
    expect(sizes, '192x192 のアイコンが要る').toContain('192x192');
    expect(sizes, '512x512 のアイコンが要る').toContain('512x512');

    // アイコンの実体が配信されていること（manifest に書いてあるだけでは入らない）
    for (const icon of manifest.icons) {
      const url = new URL(icon.src, baseURL).toString();
      const iconRes = await request.get(url);
      expect(iconRes.ok(), `${icon.src} が配信されていない`).toBeTruthy();
      expect(iconRes.headers()['content-type'] || '').toMatch(/image\//);
    }
  });

  test('HTML から manifest が参照されている', async ({ page }) => {
    await gotoApp(page);
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('manifest.webmanifest');
  });

  test('Service Worker が登録されて active になる', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);

    const sw = await serviceWorkerStatus(page);
    expect(sw.supported, 'この環境は Service Worker を持たない').toBe(true);
    expect(
      sw.ready,
      'navigator.serviceWorker.ready が解決しなかった。app.js の登録は window の load ' +
      'イベント内にあるので、boot() の await が load より後まで伸びるとリスナが張られず ' +
      '一度も登録されない。document.readyState を見て即時登録にフォールバックすること。',
    ).toBe(true);
    expect(sw.active).toBe(true);
    expect(sw.scope).toContain('/');
  });
});

test.describe('オフライン（ORDER §2-10）', () => {
  test('オフラインでも直近のランキングが出る', async ({ page, context }) => {
    test.slow();   // SW の登録・キャッシュ充填・再読込を含むので時間がかかる

    // Service Worker 経由の取得は page.route を通らないので、コンテキスト側でも塞ぐ
    await context.route('https://i.ytimg.com/**', route => route.abort());

    const hash = everyoneHash({ country: 'JP', section: 'video', period: '24h' });
    await gotoApp(page, hash);
    await waitForList(page);

    const sw = await serviceWorkerStatus(page);
    expect(sw.ready, 'Service Worker が登録されないとオフライン表示は成立しない').toBe(true);

    // clients.claim() でこのページも制御下に入る。ここまで来て初めて
    // 以後の fetch が SW を通り、data/*.json がキャッシュに積まれる。
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);

    // 一度オンラインで開き直して、いま見ている期間のデータをキャッシュへ入れる
    await page.reload();
    await waitForList(page);

    await context.setOffline(true);
    await page.reload();

    // シェルはプリキャッシュから、データは直近の集計キャッシュから出る
    await waitForList(page);
    await expect(page.locator('#list .card[data-video-id]')).toHaveCount(expectedItemCount('all'));
    await expect(page.locator('#list .card-hero')).toHaveCount(1);
    // 注: statusbar の OFFLINE バッジはモック配信中は出ない
    //     （renderStatus は source==='mock' の時点で SAMPLE を出して return する）

    await context.setOffline(false);
  });
});
