// ============================================================================
// design-charter.spec.js — デザイン憲章（ORDER §5）の機械チェックを E2E に載せる
//
// 判定ロジックは tools/audit.js（design-reviewer サブエージェントが手で回すのと同じもの）を
// そのままページ内で評価して再利用する。テスト側で判定を書き直すと二重管理になり、
// 憲章を直したときに片方だけ古くなる。
//
// audit.js が見るもの:
//   1. ファーストビューの件数（憲章: 最低4件）
//   2. タップ目標 44px（::before で広げた当たり判定も elementFromPoint で実測）
//   3. コントラスト WCAG AA（本文 4.5:1 / 大字 3:1）
//   4. 横スクロールの発生
//   5. 2行クランプ崩れによるカード高さのばらつき
// ============================================================================

import { test, expect } from '@playwright/test';
import {
  gotoApp, waitForList, everyoneHash, seedLearning,
  runAudit, criticals, formatFindings,
} from './helpers.js';

/** 指摘のうち Critical が 0 であること。落ちたら中身をそのまま出す。 */
function expectNoCritical(findings, where) {
  const bad = criticals(findings);
  expect(bad, `${where} で憲章違反:\n${formatFindings(bad)}`).toEqual([]);
}

/**
 * tools/audit.js は合格と不合格で `what` の文字列が変わる
 * （例: 'tap targets' / 'tap target < 44px'）。前方一致で拾い、
 * 見つからなければ「その検査が走らなかった」ことが分かるように undefined を返す。
 */
function finding(findings, prefix) {
  return findings.find(f => f.what === prefix || f.what.startsWith(prefix.split(' ')[0]));
}

async function auditAt(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  return runAudit(page);
}

test.describe('デザイン憲章', () => {
  test('みんなのランキング（既定画面）が憲章を満たす', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);

    const findings = await auditAt(page);
    expectNoCritical(findings, 'みんなのランキング');

    // 個別にも明示しておく（落ちたときにどの規則かすぐ分かるように）
    expect(finding(findings, 'first-view density').level, 'ファーストビュー4件以上').toBe('ok');
    expect(finding(findings, 'tap targets').level, '44px タップ目標').toBe('ok');
    expect(finding(findings, 'contrast').level, 'WCAG AA コントラスト').toBe('ok');
    expect(finding(findings, 'horizontal overflow').level, '横あふれなし').toBe('ok');
    // hidden を立てた要素が本当に消えていること（UA の [hidden] は作者の display に負ける）
    expect(finding(findings, 'hidden elements').level, 'hidden が効いている').toBe('ok');
    // 2行クランプが効いていればカード高さは揃う（整列＝秩序）
    expect(finding(findings, 'card height').level, 'カード高さの揃い').toBe('ok');
  });

  // 初回だけ出るスワイプヒントの分、縦が削られる。ここがアプリ内で最も余裕のない制約
  // （360x800 の初回表示でちょうど 4 件）なので、ヒントあり・なしを別テストにして
  // それぞれ真っさらな localStorage で数える。落ちたらヒントか軸の高さを削る側を直す。
  for (const hintSeen of [true, false]) {
    test(`ファーストビューに 4 件以上見えている（初回ヒント${hintSeen ? 'なし' : 'あり'}）`, async ({ page }) => {
      await gotoApp(page, everyoneHash(), { hintSeen });
      await waitForList(page);
      await expect(page.locator('.hint')).toHaveCount(hintSeen ? 0 : 1);
      await page.evaluate(() => window.scrollTo(0, 0));

      const visible = await page.locator('#list .card').evaluateAll(els => els.filter(c => {
        const r = c.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      }).length);

      expect(visible, 'ファーストビュー件数（憲章: 最低4件）').toBeGreaterThanOrEqual(4);
    });
  }

  test('ダークテーマでも憲章を満たす', async ({ page }) => {
    await gotoApp(page, everyoneHash(), { seed: { 'ytta.theme': 'dark' } });
    await waitForList(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    expectNoCritical(await auditAt(page), 'ダークテーマ');
  });

  test('日本語表示でも憲章を満たす（文字幅が変わっても崩れない）', async ({ page }) => {
    await gotoApp(page, everyoneHash(), { lang: 'ja' });
    await waitForList(page);

    expectNoCritical(await auditAt(page), '日本語表示');
  });

  test('ショート部門・カテゴリ別でも憲章を満たす', async ({ page }) => {
    for (const hash of [
      everyoneHash({ section: 'shorts' }),
      everyoneHash({ category: 'music' }),
      everyoneHash({ country: 'US', period: 'week' }),
    ]) {
      await gotoApp(page, hash);
      await waitForList(page);
      expectNoCritical(await auditAt(page), hash);
    }
  });

  test('自分・ワード・世界タブ、設定シートでも憲章を満たす', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);
    await seedLearning(page);

    await page.locator('.mode[data-mode="my"]').click();
    await waitForList(page, '#my-list');
    expectNoCritical(await auditAt(page), '自分タブ');

    await page.locator('.mode[data-mode="tags"]').click();
    await expect(page.locator('#tag-list .tagrow').first()).toBeVisible();
    expectNoCritical(await auditAt(page), 'ワードタブ');

    await page.locator('.mode[data-mode="map"]').click();
    await expect(page.locator('#map-wrap .mc-btn').first()).toBeVisible();
    expectNoCritical(await auditAt(page), '世界タブ');

    await page.locator('.mode[data-mode="everyone"]').click();
    await waitForList(page);
    await page.locator('#btn-settings').click();
    await expect(page.locator('#sheet-settings')).toBeVisible();
    expectNoCritical(await auditAt(page), '設定シート');
  });

  test('学習インスペクタの操作ボタンも 44px を満たす', async ({ page }) => {
    await gotoApp(page);
    await waitForList(page);
    await seedLearning(page);
    await page.locator('.mode[data-mode="my"]').click();
    await page.locator('#my-inspect').click();
    await expect(page.locator('#my-inspector .insp-row').first()).toBeVisible();

    // audit.js をそのまま当てないのは、インスペクタが自前のスクロール枠
    // （max-height:46vh）を持つため。枠の縁で半分見切れている行のボタンは、
    // 44px 相当の当たり判定が枠外に出て elementFromPoint が枠の外の要素を返し、
    // 実際には十分な大きさでも誤検出になる。枠内に収まっている行だけを測る。
    const small = await page.evaluate(() => {
      const insp = document.querySelector('#my-inspector');
      const frame = insp.getBoundingClientRect();
      const owns = (hit, node) => !!hit && (hit === node || node.contains(hit) || hit.contains(node));
      const out = [];
      for (const n of insp.querySelectorAll('button, input, a[href]')) {
        const r = n.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.top < frame.top || r.bottom > frame.bottom) continue;   // 見切れている行は対象外
        if (r.height >= 43.5) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx < 0 || cx > innerWidth || cy < 0 || cy > innerHeight) continue;
        if (!owns(document.elementFromPoint(cx, cy), n)) continue;
        const top = document.elementFromPoint(cx, r.top - (44 - r.height) / 2 + 2);
        const bot = document.elementFromPoint(cx, r.bottom + (44 - r.height) / 2 - 2);
        if (!owns(top, n) || !owns(bot, n)) {
          out.push(`${n.tagName.toLowerCase()}.${(n.className || '').split(' ')[0]} h=${Math.round(r.height)} "${(n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 24)}"`);
        }
      }
      return out;
    });

    expect(small, `44px に満たない操作要素:\n${small.join('\n')}`).toEqual([]);
  });
});
