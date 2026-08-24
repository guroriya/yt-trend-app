/* tools/audit.js — デザイン憲章（docs/ORDER.md §5）の機械チェック
 *
 * 使い方: ブラウザのコンソール、または自動操作ツールの javascript_exec に
 *         このファイルの中身を貼って実行する。返り値は指摘の配列。
 *         スクリーンショットが撮れない環境でも「数値で判定できる部分」は全部見る。
 *
 * 見るもの:
 *   1. ファーストビューに何件見えているか（憲章: 最低4件）
 *   2. タップ目標 44px（::before で広げた当たり判定も elementFromPoint で実測）
 *   3. コントラスト比 WCAG AA（本文 4.5:1 / 大文字 3:1）
 *   4. 横スクロールの発生（body が横に溢れていないか）
 *   5. 2行クランプが効かずに縦に伸びているカードがないか（英日どちらでも崩れない）
 */
(() => {
  const out = [];
  const push = (level, what, detail) => out.push({ level, what, detail });

  /* ---------- 1. ファーストビュー件数 ---------- */
  // 表示中のビューのカードだけを見る（hidden なビューは高さ 0 になり誤検出するため）
  const cards = [...document.querySelectorAll('#list .card, #my-list .card')]
    .filter(c => c.closest('.view:not([hidden])') && c.getClientRects().length);
  // 学習インスペクタを開いている間は「編集パネルが主役」なので密度チェックの対象外
  const inspectorOpen = !!document.querySelector('#my-inspector:not([hidden])');
  if (cards.length && !inspectorOpen) {
    const visible = cards.filter(c => {
      const r = c.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    }).length;
    if (visible < 4) push('Critical', 'first-view density', `${visible} cards fully visible (charter: >= 4)`);
    else push('ok', 'first-view density', `${visible} cards visible`);
  }

  /* ---------- 2. タップ目標 ---------- */
  const interactive = [...document.querySelectorAll(
    'a[href], button, input, select, textarea, [role="tab"], [tabindex]:not([tabindex="-1"])')]
    .filter(n => {
      const r = n.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(n);
      if (n.dataset.secondaryTarget === '1') return false;  // 同等の 44px 導線が別にある副次的アフォーダンス
      return cs.visibility !== 'hidden' && cs.display !== 'none' && r.top > -200;
    });
  const owns = (hit, node) => !!hit && (hit === node || node.contains(hit) || hit.contains(node));
  const smallTargets = [];
  for (const n of interactive) {
    const r = n.getBoundingClientRect();
    if (r.height >= 43.5) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // 画面外・横スクロール領域の外側・他要素に隠れているものは判定対象外（偽陽性を避ける）
    if (cx < 0 || cx > innerWidth || cy < 0 || cy > innerHeight) continue;
    if (!owns(document.elementFromPoint(cx, cy), n)) continue;
    const top = document.elementFromPoint(cx, Math.max(1, r.top - (44 - r.height) / 2 + 2));
    const bot = document.elementFromPoint(cx, Math.min(innerHeight - 1, r.bottom + (44 - r.height) / 2 - 2));
    if (!owns(top, n) || !owns(bot, n)) {
      smallTargets.push(`${n.tagName.toLowerCase()}.${(n.className || '').toString().split(' ')[0]} h=${Math.round(r.height)} "${(n.textContent || '').trim().slice(0, 16)}"`);
    }
  }
  if (smallTargets.length) push('Critical', 'tap target < 44px', smallTargets.slice(0, 12));
  else push('ok', 'tap targets', `${interactive.length} interactive elements, all >= 44px effective`);

  /* ---------- 3. コントラスト ---------- */
  const parse = c => {
    const m = (c || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(s => parseFloat(s));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = c => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const bgOf = node => {
    let n = node;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // グラデは自動判定しない
      const c = parse(cs.backgroundColor);
      if (c && c.a >= 0.75) return c;   // 半透明の暗幕（.dur など）も背景として扱う
      n = n.parentElement;
    }
    const c = parse(getComputedStyle(document.body).backgroundColor);
    return c && c.a >= 0.75 ? c : { r: 255, g: 255, b: 255, a: 1 };
  };
  const textNodes = [...document.querySelectorAll('body *')].filter(n => {
    if (!n.childNodes.length) return false;
    const hasText = [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim().length > 1);
    if (!hasText) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < innerHeight * 3;
  });
  const bad = [];
  const seen = new Set();
  for (const n of textNodes) {
    const cs = getComputedStyle(n);
    const fg = parse(cs.color);
    const bg = bgOf(n);
    if (!fg || !bg) continue;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(fg, bg);
    const key = `${cs.color}|${bg.r},${bg.g},${bg.b}|${size}`;
    if (got < need && !seen.has(key)) {
      seen.add(key);
      bad.push(`${n.tagName.toLowerCase()}.${(n.className || '').toString().split(' ')[0]} ${size}px ${cs.color} on rgb(${bg.r},${bg.g},${bg.b}) = ${got.toFixed(2)}:1 (need ${need})`);
    }
  }
  if (bad.length) push('Critical', 'contrast below WCAG AA', bad.slice(0, 12));
  else push('ok', 'contrast', 'all sampled text meets AA');

  /* ---------- 4. 横あふれ ---------- */
  if (document.documentElement.scrollWidth > innerWidth + 1) {
    const culprits = [...document.querySelectorAll('body *')]
      .filter(n => n.getBoundingClientRect().right > innerWidth + 1 && !n.closest('.axis'))
      .slice(0, 6).map(n => `${n.tagName.toLowerCase()}.${(n.className || '').toString().split(' ')[0]}`);
    push('Critical', 'horizontal overflow', { scrollWidth: document.documentElement.scrollWidth, innerWidth, culprits });
  } else push('ok', 'horizontal overflow', 'none');

  /* ---------- 5. カード高さのばらつき（クランプ崩れ検出） ---------- */
  const plain = cards.filter(c => !c.classList.contains('card-hero') && !c.classList.contains('card-ad'));
  if (plain.length > 4) {
    const hs = plain.map(c => Math.round(c.getBoundingClientRect().height));
    const min = Math.min(...hs), max = Math.max(...hs);
    if (max - min > 8) push('Should', 'card height varies', `${min}px .. ${max}px — 2行クランプが効いていない可能性`);
    else push('ok', 'card height', `${min}..${max}px`);
  }

  return out;
})()
