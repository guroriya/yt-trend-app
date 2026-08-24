// ============================================================================
// tests/helpers.js — E2E 共通ヘルパ
//
// 方針:
//   - 期間・国・カテゴリなどの「軸」は public/js/config.js から import する。
//     設定を1箇所で増減できる（CLAUDE.md §4）ことをテスト側でも守るため、
//     テストに軸をベタ書きしない。
//   - 文言は public/i18n/{en,ja}.json から読む。表示文字列をテストにベタ書きすると
//     「文言は i18n に置く」という約束をテストが破ることになる。
//   - モックデータは seed 固定で決定論的（tools/mock.py）なので、件数は実測値で断言できる。
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

import {
  COUNTRIES, SECTIONS, PERIODS, CATEGORIES, LANGUAGES, AD_EVERY, MAP_COUNTRIES,
  LEARNING, datasetPath,
} from '../public/js/config.js';

export {
  COUNTRIES, SECTIONS, PERIODS, CATEGORIES, LANGUAGES, AD_EVERY, MAP_COUNTRIES,
  LEARNING, datasetPath,
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');
export const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

/** 辞書。テストの期待値は必ずここから引く（文言のベタ書き禁止）。 */
export const I18N = Object.fromEntries(
  LANGUAGES.map(l => [l.id, readJSON(path.join(PUBLIC_DIR, 'i18n', `${l.id}.json`))]),
);

/** デザイン憲章チェッカ（tools/audit.js）の中身。runAudit() がページ内で評価する。 */
export const AUDIT_SRC = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'audit.js'), 'utf8');

export function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** public/data/*.json をそのままフィクスチャとして読む（route で差し替える土台にする）。 */
export function readDataset(country, section, period, category = 'all', metric = 'published') {
  return readJSON(path.join(PUBLIC_DIR, datasetPath(country, section, period, category, metric)));
}

export function readIndexJSON() {
  return readJSON(path.join(PUBLIC_DIR, 'data', 'index.json'));
}

/* ------------------------------------------------------------------ ルーティング */

/** #/everyone/{country}/{section}/{period}/{category}/{metric} を組み立てる。 */
export function everyoneHash({
  country = COUNTRIES[0].code,
  section = SECTIONS[0].id,
  period = PERIODS[0].id,
  category = 'all',
  metric = 'published',
} = {}) {
  return `#/everyone/${country}/${section}/${period}/${category}/${metric}`;
}

export const myHash = () => '#/my';
export const tagsHash = (country = COUNTRIES[0].code) => `#/tags/${country}`;
export const mapHash = () => '#/map';

/* --------------------------------------------------------------- 事前セットアップ */

/**
 * localStorage の初期値を「まだ無い時だけ」入れる。
 * - 値は必ず JSON.stringify する（app.js の LS.set と同じ符号化。生文字列だと
 *   LS.get の JSON.parse が失敗して既定値に落ちる）。
 * - 「無い時だけ」なのは reload をまたいでテスト側の操作結果を潰さないため
 *   （例: 言語を切り替えてから reload して永続を確かめる、が壊れなくなる）。
 */
export async function seedStorage(page, values) {
  await page.addInitScript(vals => {
    try {
      for (const [k, v] of Object.entries(vals)) {
        if (localStorage.getItem(k) === null) localStorage.setItem(k, JSON.stringify(v));
      }
    } catch { /* private mode 等 */ }
  }, values);
}

/**
 * サムネイル（i.ytimg.com）を落とす。モックの videoId は実在しないので本番でも
 * 404 → .thumb-fallback になる。外部通信を切って速く・密閉に回すためのもので、
 * .thumb は width/aspect-ratio 固定なのでレイアウトは変わらない。
 */
export async function blockThumbnails(page) {
  // context 側に張る。Service Worker が投げる fetch は page.route を通らないため
  // （sw.js は activate で clients.claim() するので、2回目以降の読込では SW 経由になる）。
  await page.context().route('https://i.ytimg.com/**', route => route.abort());
}

/**
 * アプリを開く。
 * @param {import('@playwright/test').Page} page
 * @param {string} hash    例: everyoneHash({ period: 'week' })
 * @param {object} opts
 *   lang       … ?lang= で UI 言語を固定（既定 'en'）。null なら付けない。
 *   hintSeen   … 初回スワイプヒントを既読扱いにするか（既定 true）
 *   seed       … 追加で入れる localStorage（値は生の JS 値。JSON 化はこちらでやる）
 *   thumbnails … true にすると i.ytimg.com を落とさない
 */
export async function gotoApp(page, hash = everyoneHash(), opts = {}) {
  const { lang = 'en', hintSeen = true, seed = {}, thumbnails = false } = opts;
  if (!thumbnails) await blockThumbnails(page);
  await seedStorage(page, { 'ytta.hintSeen': hintSeen, ...seed });
  const query = lang ? `?lang=${lang}` : '';
  await page.goto(`/${query}${hash}`);
  await waitForApp(page);
}

/** app.js が起動し切るまで待つ（テスト用フック window.__trendzap の登場）。 */
export async function waitForApp(page) {
  await page.waitForFunction(() => !!(window.__trendzap && window.__trendzap.state));
}

/** ランキングが描き終わるまで待つ。スケルトンには data-video-id が無いので実カードだけ見る。 */
export async function waitForList(page, sel = '#list') {
  await expect(page.locator(`${sel} .card[data-video-id]`).first()).toBeVisible();
  await expect(page.locator(`${sel} .card-skel`)).toHaveCount(0);
}

/** 内部 API 経由の遷移。UI 操作が主目的でない準備工程だけで使う。 */
export async function appGo(page, patch) {
  await page.evaluate(p => window.__trendzap.go(p), patch);
}

export function appState(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__trendzap.state)));
}

/* --------------------------------------------------------------------- 期待値 */

/** 期間×カテゴリの件数（config.js が正）。総合=100 / 個別カテゴリ=50。 */
export function expectedItemCount(category = 'all') {
  const c = CATEGORIES.find(x => x.id === category);
  return c ? c.size : CATEGORIES[0].size;
}

/**
 * n 件のリストに挟まる広告カードの枚数。
 * app.js paintRanking は「8件ごと、ただし最後の1件の直後には入れない」。
 */
export function expectedAdCount(n) {
  return Math.max(0, Math.floor((n - 1) / AD_EVERY));
}

/** 広告カードが入る 1 始まりの位置（9, 18, 27 …）。 */
export function expectedAdPositions(n) {
  return Array.from({ length: expectedAdCount(n) }, (_, k) => (k + 1) * (AD_EVERY + 1));
}

/** 転送 URL の形（docs/SCHEMA.md §3 派生規則）。 */
export const WATCH_URL_RE = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/;
export const SHORTS_URL_RE = /^https:\/\/www\.youtube\.com\/shorts\/[A-Za-z0-9_-]{11}$/;

/* ----------------------------------------------------------------- ジェスチャ */

/**
 * #list-wrap を横にドラッグして「ザッピング」を起こす。
 *
 * Chromium はリンクや画像の上での mousedown をネイティブの HTML5 ドラッグに変える。
 * Playwright はそれを drag-and-drop として横取りするので pointerup がアプリに届かない。
 * 実機のスワイプはタッチで、そこにネイティブドラッグは無い。テスト側だけ
 * -webkit-user-drag を切って、アプリが待っている pointer イベント列をそのまま送る。
 */
export async function swipeList(page, direction /* 'left' | 'right' */) {
  await page.addStyleTag({ content: 'a, img, .card-link { -webkit-user-drag: none; }' });
  await page.evaluate(() => window.scrollTo(0, 0));

  const box = await page.locator('#list-wrap').boundingBox();
  expect(box, '#list-wrap が見つからない').not.toBeNull();
  const vp = page.viewportSize();

  // リスト内かつ画面内の高さを選ぶ（リストは画面よりずっと縦に長い）。
  const y = Math.round(Math.min(box.y + 150, vp.height - 80));
  expect(y).toBeGreaterThan(box.y);

  const left = Math.round(box.x + 30);
  const right = Math.round(box.x + box.width - 30);
  const from = direction === 'left' ? right : left;
  const to = direction === 'left' ? left : right;

  // 縦にも少しずらす。始点と終点が同じカードの <a> に載ったままだと、
  // mouseup で合成クリックが起きてカードのリンク（target=_blank）が開いてしまう。
  // dx がしきい値（60px）を超え、かつ |dx| > |dy| * 1.6 を保つ範囲でずらす。
  const y2 = y + 24;
  await page.mouse.move(from, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(Math.round(from + ((to - from) * i) / 6), Math.round(y + ((y2 - y) * i) / 6));
  }
  await page.mouse.up();
}

/* ------------------------------------------------------------------- 端末内学習 */

/**
 * 学習データを作る。カードを実際にクリックすると target=_blank で youtube.com へ
 * 出て行ってしまうので、アプリ本体と同じ経路（Learn.record）を直接叩いて種を蒔く。
 * 「見る＝impression」はスクロールでも自然に貯まる（IntersectionObserver）ので、
 * そちらは別テストで確認する。
 */
export async function seedLearning(page, { opens = 3, impressions = 9, country = COUNTRIES[0].code } = {}) {
  const dataset = datasetPath(country, 'video', '24h', 'all');
  return page.evaluate(async ({ dataset, opens, impressions }) => {
    const { Learn } = window.__trendzap;
    const data = await (await fetch(dataset)).json();
    data.items.slice(0, opens).forEach(it => Learn.record(it, 'open'));
    data.items.slice(opens, opens + impressions).forEach(it => Learn.record(it, 'impression'));
    return Learn.snapshot();
  }, { dataset, opens, impressions });
}

export function readLearning(page) {
  return page.evaluate(key => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, LEARNING.storageKey);
}

/* --------------------------------------------------------------- デザイン監査 */

/**
 * tools/audit.js をページ内で実行して指摘配列を得る。
 * audit.js は「即時実行して配列を返す式」なので、() で包んで返す
 * （return の直後に改行が来ると ASI で undefined になるため括弧が要る）。
 */
export async function runAudit(page) {
  return page.evaluate(`(() => { return (${AUDIT_SRC}); })()`);
}

export function criticals(findings) {
  return findings.filter(f => f.level === 'Critical');
}

/** 失敗時に読める形へ。 */
export function formatFindings(findings) {
  return findings.map(f => `[${f.level}] ${f.what}: ${JSON.stringify(f.detail)}`).join('\n');
}
