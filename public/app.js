/* ==========================================================================
   TrendZap — app.js
   素の ES モジュール。ビルド工程なし。設定は js/config.js の1箇所だけ。
   データ契約は docs/SCHEMA.md。仕様は docs/ORDER.md。
   ========================================================================== */

import {
  COUNTRIES, SECTIONS, PERIODS, CATEGORIES, LANGUAGES, DEFAULT_LANG,
  MAP_COUNTRIES, AD_EVERY, RETENTION, LEARNING, TAPS, datasetId, datasetPath,
} from './js/config.js';

/* ---------------------------------------------------------------- helpers */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const LS = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } },
  set(k, v)  { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota / private mode */ } },
  del(k)     { try { localStorage.removeItem(k); } catch { /* noop */ } },
};

/* ------------------------------------------------------------------ state */
const state = {
  mode: 'everyone',
  // localStorage は古い版や手編集で壊れていることがある。ハッシュや言語と同じように検証する。
  country: (c => (COUNTRIES.some(x => x.code === c) ? c : COUNTRIES[0].code))(LS.get('ytta.country', COUNTRIES[0].code)),
  section: 'video',
  period: '24h',
  category: 'all',
  metric: 'published',
  lang: DEFAULT_LANG,
  themePref: LS.get('ytta.theme', 'auto'),
  swipeAxis: (a => (['period', 'section', 'category', 'country'].includes(a) ? a : 'period'))(LS.get('ytta.swipeAxis', 'period')),
  reduceMotion: LS.get('ytta.reduceMotion', false),
  index: null,
  offline: !navigator.onLine,
  reqId: 0,
  q: '',                     // ランキング内検索の語。ハッシュには載せない（端末内で完結）
};

/* ------------------------------------------------------------------- i18n */
const dicts = {};
let dict = {};

async function loadLang(lang) {
  if (!dicts[lang]) {
    const res = await fetch(`i18n/${lang}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`i18n ${lang} ${res.status}`);
    dicts[lang] = await res.json();
  }
  dict = dicts[lang];
  state.lang = lang;
  document.documentElement.lang = lang;
  LS.set('ytta.lang', lang);
}

function t(key, params) {
  let s = dict[key];
  if (s == null) return key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

function applyStatic() {
  $$('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
  $$('[data-i18n-aria]').forEach(n => { n.setAttribute('aria-label', t(n.dataset.i18nAria)); });
  $$('[data-i18n-placeholder]').forEach(n => { n.placeholder = t(n.dataset.i18nPlaceholder); });
  document.title = `${t('app.name')} — ${t('app.tagline')}`;
  $('#lang-code').textContent = (LANGUAGES.find(l => l.id !== state.lang) || LANGUAGES[0]).id.toUpperCase();
}

const locale = () => (state.lang === 'ja' ? 'ja-JP' : 'en-US');

function fmtCount(n) {
  if (n == null) return '–';
  try { return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n); }
  catch { return String(n); }
}

function fmtViews(n) { return t('card.views', { n: fmtCount(n) }); }

function fmtAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return t('time.now');
  if (m < 60) return t('time.minute', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('time.hour', { n: h });
  const d = Math.floor(h / 24);
  if (d < 30) return t('time.day', { n: d });
  const mo = Math.floor(d / 30);
  if (mo < 12) return t('time.month', { n: mo });
  return t('time.year', { n: Math.floor(mo / 12) });
}

function fmtDur(sec) {
  if (!sec && sec !== 0) return '';
  const s = sec % 60, m = Math.floor(sec / 60) % 60, h = Math.floor(sec / 3600);
  const p = v => String(v).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

/* ------------------------------------------------------------------ theme */
function resolveTheme() {
  const pref = state.themePref;
  const dark = pref === 'dark' ||
    (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const meta = $('meta[name="theme-color"]:not([media])');
  if (meta) meta.content = dark ? '#0d0f14' : '#ffffff';
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.themePref === 'auto') resolveTheme();
});

function setTheme(pref) {
  state.themePref = pref;
  LS.set('ytta.theme', pref);
  resolveTheme();
}

/* ------------------------------------------------------------------- data */
const memCache = new Map();

async function getJSON(path, { soft = false } = {}) {
  // キャッシュ命中のときも必ず同じ try/catch を通す。先に return してしまうと
  // 2人目の呼び出し側では soft:true が効かず、未処理の rejection にもなる。
  let p = memCache.get(path);
  if (!p) {
    p = fetch(path, { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error(`${path} ${r.status}`);
      return r.json();
    });
    memCache.set(path, p);
  }
  try { return await p; }
  catch (err) {
    if (memCache.get(path) === p) memCache.delete(path);
    if (soft) return null;
    throw err;
  }
}

const listPath = (s = state) => datasetPath(s.country, s.section, s.period, s.category, s.metric);

/* ---------------------------------------------- データの可用性（index.json）
 * 収集は予算内で少しずつ進むので、config.js に定義があっても「まだ集まっていない」
 * 軸が必ず存在する。index.json の datasets を正本にして、無い軸は押させない。
 * index.json 自体が取れないときは全部あるものとして扱う（従来どおりの挙動に戻す）。
 */
function hasData(country = state.country, section = state.section, period = state.period,
                 category = state.category, metric = state.metric) {
  const ds = state.index?.datasets;
  if (!ds) return true;
  return Object.prototype.hasOwnProperty.call(ds, datasetId(country, section, period, category, metric));
}

/** その国に1本でもデータがあるか（国トグルの巡回対象を決める）。 */
function countryHasData(code) {
  const ds = state.index?.datasets;
  if (!ds) return true;
  return Object.keys(ds).some(k => k.startsWith(`${code}-`));
}

/** いま選べる国。データのある国だけ（全滅なら config どおり）。 */
function usableCountries() {
  const list = COUNTRIES.filter(c => countryHasData(c.code));
  return list.length ? list : COUNTRIES;
}

/* ------------------------------------------- 端末内学習（v2 / 外部送信なし） */
const STOP = new Set([
  'the','and','for','you','are','with','this','that','from','have','out','but','all','not','was',
  'your','how','why','what','who','one','two','new','get','got','can','will','just','now','when',
  'その','この','あの','こと','もの','ため','など','よう','これ','それ','ます','です','した','して',
  'いる','ある','する','なる','から','まで','より','ない','てる','だけ','という',
]);

function tokensOf(item) {
  const out = new Set();
  (item.tags || []).slice(0, 8).forEach(x => { const v = String(x).trim().toLowerCase(); if (v.length >= 2) out.add(v); });
  const title = String(item.title || '');
  (title.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || []).forEach(w => { if (!STOP.has(w)) out.add(w); });
  (title.match(/[ァ-ヴー]{3,}/g) || []).forEach(w => out.add(w));
  (title.match(/[一-龥]{2,4}/g) || []).forEach(w => { if (!STOP.has(w)) out.add(w); });
  return [...out].slice(0, 12);
}

const Learn = {
  data: null,
  load() {
    if (this.data) return this.data;
    const d = LS.get(LEARNING.storageKey, null) || {
      v: 1, updatedAt: Date.now(), terms: {}, channels: {}, categories: {}, opened: {}, muted: [], enabled: true,
    };
    d.terms ||= {}; d.channels ||= {}; d.categories ||= {}; d.opened ||= {}; d.muted ||= [];
    this.data = d;
    return d;
  },
  save() { const d = this.load(); d.updatedAt = Date.now(); LS.set(LEARNING.storageKey, d); },
  decayed(entry) {
    if (!entry) return 0;
    const days = (Date.now() - (entry.t || 0)) / 864e5;
    return entry.w * Math.pow(0.5, days / LEARNING.halfLifeDays);
  },
  bump(bag, key, amount, extra) {
    const cur = bag[key];
    const base = cur ? this.decayed(cur) : 0;
    bag[key] = Object.assign({ w: Math.min(999, base + amount), t: Date.now() }, extra || {});
  },
  record(item, kind) {
    const d = this.load();
    if (!d.enabled) return;
    const amount = kind === 'open' ? LEARNING.weights.open : LEARNING.weights.impression;
    this.bump(d.channels, item.channelId, amount, { name: item.channelTitle });
    if (item.categoryId) this.bump(d.categories, item.categoryId, amount * 0.6);
    tokensOf(item).forEach(term => this.bump(d.terms, term, amount * 0.5));
    if (kind === 'open') d.opened[item.videoId] = Date.now();
    this.prune(d);
    this.save();
  },
  prune(d) {
    const trim = (bag, max) => {
      const keys = Object.keys(bag);
      if (keys.length <= max) return;
      keys.map(k => [k, this.decayed(bag[k])]).sort((a, b) => a[1] - b[1])
        .slice(0, keys.length - max).forEach(([k]) => delete bag[k]);
    };
    trim(d.terms, LEARNING.maxTerms);
    trim(d.channels, LEARNING.maxChannels);
    trim(d.categories, 40);
    // opened は1本開くたびに増え続ける。古いものから落として localStorage を溢れさせない。
    const cut = Date.now() - 90 * 864e5;
    for (const [k, ts] of Object.entries(d.opened)) if (!ts || ts < cut) delete d.opened[k];
    const openedKeys = Object.keys(d.opened);
    if (openedKeys.length > 800) {
      openedKeys.sort((a, b) => d.opened[a] - d.opened[b])
        .slice(0, openedKeys.length - 800).forEach(k => delete d.opened[k]);
    }
  },
  isMuted(key) { return this.load().muted.includes(key); },
  score(item) {
    const d = this.load();
    let s = 0; const why = [];
    const ch = d.channels[item.channelId];
    if (ch) { const v = this.decayed(ch); if (v > 0.5) { s += v * 2.2; why.push(item.channelTitle); } }
    const cat = d.categories[item.categoryId];
    if (cat) s += this.decayed(cat) * 0.8;
    for (const term of tokensOf(item)) {
      if (d.muted.includes(term)) return { score: -1, why: [] };
      const e = d.terms[term];
      if (e) { const v = this.decayed(e); if (v > 0.5) { s += v; why.push(term); } }
    }
    if (d.muted.includes(item.channelId)) return { score: -1, why: [] };
    if (d.opened[item.videoId]) s *= 0.45;              // 一度開いたものは下げる
    return { score: s, why: why.slice(0, 3) };
  },
  snapshot() {
    const d = this.load();
    const rows = bag => Object.entries(bag)
      .map(([k, v]) => ({ key: k, name: v.name || k, w: this.decayed(v) }))
      .filter(r => r.w > 0.4).sort((a, b) => b.w - a.w);
    return { terms: rows(d.terms), channels: rows(d.channels), categories: rows(d.categories), enabled: d.enabled, muted: d.muted };
  },
  setWeight(bag, key, w) { const d = this.load(); if (d[bag][key]) { d[bag][key] = { ...d[bag][key], w, t: Date.now() }; this.save(); } },
  forget(bag, key) { const d = this.load(); delete d[bag][key]; this.save(); },
  mute(key) { const d = this.load(); if (!d.muted.includes(key)) d.muted.push(key); this.save(); },
  unmute(key) { const d = this.load(); d.muted = d.muted.filter(x => x !== key); this.save(); },
  setEnabled(on) { const d = this.load(); d.enabled = !!on; this.save(); },
  clear() { LS.del(LEARNING.storageKey); this.data = null; this.load(); },
  isEmpty() { const s = this.snapshot(); return !s.terms.length && !s.channels.length; },
};

/* ------------------------------------------ ランキング内検索（発注者改訂 2026-08-25）
 * YouTube 全体の検索はしない（API キーをブラウザに置けないため）。
 * ここでやるのは「いま表示しているランキングの中を絞る」ことと、
 * 「同じ語＋同じ期間で YouTube 本体の検索へ送り出す」ことの2つ。
 */
const YT_PERIOD_SP = {   // YouTube 検索の期間フィルタ（sp パラメータ）
  '24h':   'EgIIAg%253D%253D',
  week:    'EgIIAw%253D%253D',
  month:   'EgIIBA%253D%253D',
  year:    'EgIIBQ%253D%253D',
  all:     '',
};

function normalizeQ(s) {
  // 大小・全半角の差で取りこぼさない。NFKC で全角英数と半角を揃える。
  return (s || '').normalize('NFKC').toLowerCase().trim();
}

function matchesQuery(item, q) {
  if (!q) return true;
  const hay = normalizeQ(`${item.title} ${item.channelTitle} ${(item.tags || []).join(' ')}`);
  // 空白区切りの AND（「ゲーム 実況」で両方含むものだけ）
  return q.split(/\s+/).filter(Boolean).every(term => hay.includes(term));
}

function youtubeSearchUrl(q, period) {
  const sp = YT_PERIOD_SP[period] ?? '';
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}${sp ? `&sp=${sp}` : ''}`;
}

function syncSearchChrome() {
  $('#q-clear').hidden = !state.q;
}

/** 「YouTubeでこの期間で検索」ボタン。検索バーに置くと入力欄が潰れるのでステータスバーに出す。 */
function youtubeSearchButton(q, period) {
  const a = el('a', 'btn btn-ghost btn-sm q-yt', period === 'all'
    ? t('search.onYouTubeAll')
    : t('search.onYouTube', { period: t(`period.${period}`) }));
  a.href = youtubeSearchUrl(q, period);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/* ------------------------------------- よく見るランキング（発注者改訂 2026-08-25）
 * 端末内だけの記録。外部送信はしない（ORDER §2-11 と同じ約束）。
 *   counts … 軸の組み合わせごとの訪問回数（自動チップの材料）
 *   pins   … 手動で☆を付けた組み合わせ（常に先頭に出る）
 */
const FAV_KEY = 'ytta.freq.v1';
const FAV_SHOW = 3;             // 自動チップの本数（憲章「一覧性」を圧迫しない範囲）
const FAV_MIN_VISITS = 3;       // これ未満は「よく見る」と呼ばない

const Favs = {
  load() {
    const d = LS.get(FAV_KEY, null);
    if (!d || typeof d !== 'object') return { v: 1, counts: {}, pins: [] };
    return { v: 1, counts: d.counts && typeof d.counts === 'object' ? d.counts : {},
      pins: Array.isArray(d.pins) ? d.pins.filter(k => typeof k === 'string') : [] };
  },
  save(d) { LS.set(FAV_KEY, d); },
  /** 軸の組み合わせを1つの文字列で表す（ハッシュと同じ並び。復元も容易）。 */
  keyOf(s = state) { return `${s.country}/${s.section}/${s.period}/${s.category}`; },
  parse(key) {
    const [country, section, period, category] = key.split('/');
    if (!COUNTRIES.some(c => c.code === country)) return null;
    if (!SECTIONS.some(x => x.id === section)) return null;
    if (!PERIODS.some(p => p.id === period)) return null;
    const cat = CATEGORIES.find(c => c.id === category);
    if (!cat || !cat.periods.includes(period)) return null;
    return { country, section, period, category };
  },
  label(key) {
    const p = this.parse(key);
    if (!p) return key;
    const flag = COUNTRIES.find(c => c.code === p.country)?.flag || '';
    const parts = [t(`period.${p.period}`), t(`section.${p.section}`)];
    if (p.category !== 'all') parts.push(t(`category.${p.category}`));
    return `${flag} ${parts.join(' · ')}`.trim();
  },
  /** 通過しただけの軸を「よく見る」と数えないための遅延記録。 */
  _pending: 0,
  recordSoon() {
    if (state.mode !== 'everyone') return;
    clearTimeout(this._pending);
    const key = this.keyOf();
    // スワイプで隣を通り抜けただけなら数えない（2.5秒とどまって初めて1回）
    this._pending = setTimeout(() => { if (this.keyOf() === key) this.record(key); }, 2500);
  },
  record(k = this.keyOf()) {
    if (state.mode !== 'everyone') return;
    const d = this.load();
    d.counts[k] = (d.counts[k] || 0) + 1;
    // 際限なく増やさない（軸の総数を超える分は少ない順に捨てる）
    const keys = Object.keys(d.counts);
    if (keys.length > 60) {
      keys.sort((a, b) => d.counts[a] - d.counts[b]).slice(0, keys.length - 60)
        .forEach(x => { delete d.counts[x]; });
    }
    this.save(d);
  },
  isPinned(key = this.keyOf()) { return this.load().pins.includes(key); },
  togglePin(key = this.keyOf()) {
    const d = this.load();
    const i = d.pins.indexOf(key);
    if (i >= 0) d.pins.splice(i, 1); else d.pins.unshift(key);
    d.pins = d.pins.slice(0, 8);
    this.save(d);
    return i < 0;
  },
  forget(key) {
    const d = this.load();
    d.pins = d.pins.filter(k => k !== key);
    delete d.counts[key];
    this.save(d);
  },
  /** 表示するチップ: ピン（手動）→ 訪問回数上位（自動）。いまいる場所は出さない。 */
  chips() {
    const d = this.load();
    const here = this.keyOf();
    const pins = d.pins.filter(k => this.parse(k));
    const often = Object.entries(d.counts)
      .filter(([k, n]) => n >= FAV_MIN_VISITS && !pins.includes(k) && this.parse(k))
      .sort((a, b) => b[1] - a[1])
      .slice(0, FAV_SHOW)
      .map(([k]) => k);
    return [...pins.map(k => ({ key: k, pinned: true })), ...often.map(k => ({ key: k, pinned: false }))]
      .filter(c => c.key !== here);
  },
};

function renderFavs() {
  const box = $('#favs');
  const chips = Favs.chips();
  const pinnedHere = Favs.isPinned();
  box.replaceChildren();

  // ☆は検索バーの中（常設・1行に畳んでファーストビューを削らない）
  const slot = $('#favstar-slot');
  slot.replaceChildren();
  const star = el('button', pinnedHere ? 'favstar is-on' : 'favstar', pinnedHere ? '★' : '☆');
  star.type = 'button';
  star.title = t(pinnedHere ? 'fav.unpin' : 'fav.pin');
  star.setAttribute('aria-label', star.title);
  star.setAttribute('aria-pressed', String(pinnedHere));
  star.addEventListener('click', () => {
    const on = Favs.togglePin();
    toast(t(on ? 'fav.pinned' : 'fav.unpin'));
    renderFavs();
  });
  slot.append(star);

  chips.forEach(({ key, pinned }) => {
    const wrap = el('span', pinned ? 'favchip is-pinned' : 'favchip');
    const b = el('button', 'favchip-go', Favs.label(key));
    b.type = 'button';
    b.title = pinned ? t('fav.pinned') : t('fav.often');
    b.addEventListener('click', () => { const p = Favs.parse(key); if (p) go(p); });
    const x = el('button', 'favchip-x', '✕');
    x.type = 'button';
    x.title = t('fav.remove', { name: Favs.label(key) });
    x.setAttribute('aria-label', x.title);
    x.addEventListener('click', () => { Favs.forget(key); renderFavs(); });
    wrap.append(b, x);
    box.append(wrap);
  });
  // チップが無いときは行ごと畳む（憲章「一覧性が正義」: 空の行に高さを使わない）
  box.hidden = chips.length === 0;
}

/* ------------------------------------- v3 匿名タップ集計（ORDER §2-15） */
/*
 * 「このアプリ経由で今日◯回飛んだ」独自指標。送るのは 国コード＋動画ID だけで、
 * 個人識別情報は送らない・持たない。TAPS.endpoint が空なら送信もフェッチもしない。
 * `?taps=mock` はネットワークに一切出ない表示専用サンプル（開発・E2E・監査用）。
 * 集計は「人」ではなく「回」。匿名制約下では人数の一意化ができないため回数で表す。
 */
const Taps = {
  mock: new URLSearchParams(location.search).get('taps') === 'mock',
  endpoint: TAPS.endpoint.replace(/\/+$/, ''), // 末尾スラッシュ付きで貼られても //tap にしない
  enabled() { return this.mock || !!this.endpoint; },
  send(videoId, country) {
    if (!this.endpoint || this.mock) return;
    try {
      // content-type を付けない（既定 text/plain）= CORS の単純リクエストになり、
      // プリフライト無しで 1 タップ = 1 リクエストで済む。サーバー側は本文だけを見る。
      fetch(`${this.endpoint}/tap`, {
        method: 'POST', mode: 'cors', keepalive: true,
        body: JSON.stringify({ country, videoId }),
      }).catch(() => {});
    } catch { /* 集計が落ちても転送（本体機能）は妨げない */ }
  },
  _stats: null, _statsAt: 0,
  async stats() {
    if (this.mock) return this._mockStats();
    if (!this.endpoint) return null;
    if (this._stats && Date.now() - this._statsAt < TAPS.statsTtlMs) return this._stats;
    try {
      const res = await fetch(`${this.endpoint}/stats`, { mode: 'cors' });
      if (!res.ok) return null;
      const s = await res.json();
      if (typeof s?.total !== 'number' || !s.countries || typeof s.countries !== 'object') return null;
      this._stats = s; this._statsAt = Date.now();
      return s;
    } catch { return null; }
  },
  _mockStats() { // 決定論的（E2E が値を断言できる）。式を変えたら tests/e2e-taps.spec.js も直す
    const countries = {}; let total = 0;
    MAP_COUNTRIES.forEach((c, i) => { const n = ((i * 37) % 90) + 8; countries[c.code] = n; total += n; });
    return { date: new Date().toISOString().slice(0, 10), total, countries };
  },
};

/* --------------------------------------------------------------- card DOM */
const catLabelOf = ytId => {
  const c = CATEGORIES.find(x => x.ytId === ytId);
  return c ? t(`category.${c.id}`) : null;
};
const thumbUrl = (id, big) => `https://i.ytimg.com/vi/${id}/${big ? 'hqdefault' : 'mqdefault'}.jpg`;
const watchUrl = item => item.isShort
  ? `https://www.youtube.com/shorts/${item.videoId}`
  : `https://www.youtube.com/watch?v=${item.videoId}`;

function deltaNode(item) {
  const n = el('span', 'delta');
  if (item.prevRank == null) { n.className = 'delta delta-new'; n.textContent = t('card.new'); n.title = t('card.new'); return n; }
  const d = item.delta ?? (item.prevRank - item.rank);
  if (d > 0)      { n.className = 'delta delta-up';   n.textContent = `▲${d}`; n.title = t('card.up',   { n: d }); }
  else if (d < 0) { n.className = 'delta delta-down'; n.textContent = `▼${-d}`; n.title = t('card.down', { n: -d }); }
  else            { n.className = 'delta delta-same'; n.textContent = '–';      n.title = t('card.same'); }
  return n;
}

function cardNode(item, { hero = false, why = null, delta = true } = {}) {
  const li = el('li', hero ? 'card card-hero' : 'card');
  li.dataset.rank = item.rank;
  li.dataset.videoId = item.videoId;

  const a = el('a', 'card-link');
  a.href = watchUrl(item);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.setAttribute('aria-label', `${t('card.rank', { n: item.rank })} ${item.title} — ${item.channelTitle} — ${fmtViews(item.viewCount)}`);

  if (!hero) {
    const col = el('span', 'rankcol');
    col.append(el('span', 'rank', String(item.rank)));
    // 自分タブには「前回の順位」が無い。出すと全行 NEW になり、変動の合図が意味を失う。
    if (delta) col.append(deltaNode(item));
    a.append(col);
  }

  const th = el('span', item.isShort ? 'thumb is-short' : 'thumb');
  const img = new Image();
  img.src = thumbUrl(item.videoId, hero);
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener('error', () => { th.classList.add('thumb-fallback'); img.remove(); }, { once: true });
  th.append(img);
  if (hero) th.append(el('span', 'hero-rank', String(item.rank)));
  if (item.durationSec) th.append(el('span', 'dur', fmtDur(item.durationSec)));
  a.append(th);

  const info = el('span', 'info');
  if (hero) {
    const line = el('span', 'hero-line');
    line.append(el('span', 'hero-badge', t('card.hero')));
    if (delta) line.append(deltaNode(item));
    info.append(line);
  }
  info.append(el('span', 'title', item.title));
  info.append(el('span', 'chan', item.channelTitle));
  const meta = el('span', 'meta');
  meta.append(el('b', 'views', fmtViews(item.viewCount)), el('span', 'dot', '·'), el('span', null, fmtAgo(item.publishedAt)));
  info.append(meta);
  if (why && why.length) info.append(el('span', 'why', t('my.matched', { reason: why.join(' · ') })));
  a.append(info);

  a.addEventListener('click', () => { Learn.record(item, 'open'); Taps.send(item.videoId, state.country); });
  li.append(a);
  li.__item = item;
  return li;
}

/* -------------------------------------------------------------------- 広告枠
   ORDER §2-9: リスト 8 件ごとに 1 枠。v1 はプレースホルダ（"AD" 表記のダミーカード）。
   審査通過後（ORDER §7 ゲートC）は **fillAdSlot の中身だけ**を差し替える。
   外側の <li class="card card-ad"> と "AD" バッジ、高さのリズムはそのまま使い回せる。

     Web / AdSense インフィード:
       box.append(insElement);  (adsbygoogle = window.adsbygoogle || []).push({});
     Android / AdMob ネイティブ（Capacitor）:
       window.AdMob?.showNativeAd({ slot, container: box });

   差し替えるときの禁則（ORDER §5 / §8）:
     - "AD" 表記は必ず残す（コンテンツと明確に区別する）
     - カードの min-height を崩さない（リストのリズムを壊さない）
     - プレイヤー上・周辺への重畳、再生前インタースティシャルは不可
   外部から差し替えたい場合は window.__trendzapAds = (slot, box) => {...} を定義すれば、
   このファイルを触らずに差し込める。 */
function fillAdSlot(slot, box) {
  if (typeof window.__trendzapAds === 'function') { window.__trendzapAds(slot, box); return; }
  box.append(el('span', 'ad-thumb'), el('span', null, t('ad.placeholder')));   // v1: プレースホルダ
}

function adNode(slot) {
  const li = el('li', 'card card-ad');
  li.dataset.adSlot = slot;
  const wrap = el('div', 'card-link');
  const box = el('div', 'ad-box');
  box.append(el('span', 'ad-tag', t('ad.label')));      // "AD" 表記は常に出す
  fillAdSlot(slot, box);
  wrap.append(box);
  li.append(wrap);
  return li;
}

function skeletonList(target, n = 8, { hero = false } = {}) {
  unobserveCards(target);
  target.replaceChildren();
  target.setAttribute('aria-busy', 'true');
  target.setAttribute('aria-label', t('state.loading'));
  for (let i = 0; i < n; i++) {
    // 読み込み後の姿と同じ形にする。違うと描画の瞬間にリストが跳ねる。
    const li = el('li', hero && i === 0 ? 'card card-skel card-hero' : 'card card-skel');
    const a = el('div', 'card-link');
    const col = el('span', 'rankcol'); col.append(el('span', 'sk sk-rank'));
    const th = el('span', 'sk sk-thumb');
    const info = el('span', 'info');
    info.append(el('span', 'sk sk-l1'), el('span', 'sk sk-l2'), el('span', 'sk sk-l3'));
    a.append(col, th, info);
    li.append(a);
    target.append(li);
  }
}

function stateNode(kind) {
  const box = el('div', 'state');
  if (kind === 'pending') {
    // 収集は予算内で少しずつ進む（docs/BUDGET.md）。まだ来ていないだけなので再読み込みは出さない。
    box.append(el('div', 'state-emoji', '⏳'));
    box.append(el('p', 'state-title', t('state.pending.title')));
    box.append(el('p', 'state-body', t('state.pending.body')));
    const li0 = el('li'); li0.append(box); return li0;
  }
  if (kind === 'noHits') {
    // 検索で 0 件。ここから YouTube 本体へ抜けられる導線を必ず添える。
    box.append(el('div', 'state-emoji', '🔍'));
    box.append(el('p', 'state-title', t('search.none', { q: state.q })));
    const a = youtubeSearchButton(state.q, state.period);
    a.className = 'btn btn-primary';
    box.append(a);
    const li0 = el('li'); li0.append(box); return li0;
  }
  box.append(el('div', 'state-emoji', kind === 'error' ? '⚠️' : '🗒️'));
  box.append(el('p', 'state-title', t(kind === 'error' ? 'state.error.title' : 'state.empty.title')));
  box.append(el('p', 'state-body', t(kind === 'error' ? 'state.error.body' : 'state.empty.body')));
  if (kind === 'error') {
    const b = el('button', 'btn', t('state.retry'));
    b.type = 'button';
    b.addEventListener('click', () => { memCache.delete(listPath()); renderEveryone(); });
    box.append(b);
  }
  const li = el('li');
  li.append(box);
  return li;
}

/* --------------------------------------------------- impression observer */
const seenThisSession = new Set();
const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const item = e.target.__item;
    if (item && !seenThisSession.has(item.videoId)) {
      seenThisSession.add(item.videoId);
      Learn.record(item, 'impression');
    }
    io.unobserve(e.target);
  }
}, { threshold: 0.6 }) : null;

function observeCards(root) { if (io) $$('.card[data-video-id]', root).forEach(n => io.observe(n)); }
/** 描き替える前に古いカードの監視を外す（交差しなかったカードは unobserve されないため）。 */
function unobserveCards(root) { if (io) $$('.card[data-video-id]', root).forEach(n => io.unobserve(n)); }

/** スケルトンで立てた aria-busy を必ず畳む。空・エラーで抜ける経路でも呼ぶこと。 */
function endLoading(list) {
  list.setAttribute('aria-busy', 'false');
  list.setAttribute('aria-label', t('a11y.list'));
}

/* ------------------------------------------------------------------- axes */
function buildAxes() {
  // 期間
  const pa = $('#axis-periods');
  pa.replaceChildren();
  PERIODS.forEach(p => {
    const b = el('button', 'chip', t(`period.${p.id}`));
    b.type = 'button'; b.role = 'tab'; b.dataset.period = p.id;
    // タップでもスワイプと同じ zap を出す。方向は軸上の並び順から決める（BACKLOG 2026-08-25）
    b.addEventListener('click', () => go({ period: p.id },
      { dir: Math.sign(PERIODS.findIndex(x => x.id === p.id) - PERIODS.findIndex(x => x.id === state.period)) }));
    pa.append(b);
  });
  // 部門
  const sa = $('#axis-sections');
  sa.replaceChildren();
  SECTIONS.forEach(s => {
    const b = el('button', null, t(`section.${s.id}`));
    b.type = 'button'; b.role = 'tab'; b.dataset.section = s.id;
    b.addEventListener('click', () => go({ section: s.id },
      { dir: Math.sign(SECTIONS.findIndex(x => x.id === s.id) - SECTIONS.findIndex(x => x.id === state.section)) }));
    sa.append(b);
  });
  // カテゴリ
  const ca = $('#axis-categories');
  ca.replaceChildren();
  CATEGORIES.forEach(c => {
    const b = el('button', 'chip', t(`category.${c.id}`));
    b.type = 'button'; b.role = 'tab'; b.dataset.category = c.id;
    b.addEventListener('click', () => go({ category: c.id },
      { dir: Math.sign(CATEGORIES.findIndex(x => x.id === c.id) - CATEGORIES.findIndex(x => x.id === state.category)) }));
    ca.append(b);
  });
  // 指標（新着／伸び）— index.json の features.growth が有効なときだけ出す
  const ma = $('#axis-metric');
  ma.replaceChildren();
  ['published', 'growth'].forEach(m => {
    const b = el('button', null, t(`metric.${m}`));
    b.type = 'button'; b.role = 'tab'; b.dataset.metric = m;
    b.title = t(`metric.${m}.hint`);
    b.addEventListener('click', () => go({ metric: m }));
    ma.append(b);
  });
}

function growthAvailable(period = state.period) {
  const g = state.index?.features?.growth;
  return !!(g && g.enabled && (g.periods || []).includes(period));
}

function syncAxes() {
  syncSearchChrome();   // 期間が変われば「YouTubeで検索」の期間表示も変わる
  // 収集がまだ届いていない軸は押させない（押すと 404 になり「通信を確認」と誤解させるため）
  $$('#axis-periods .chip').forEach(b => {
    const p = b.dataset.period;
    const usable = hasData(state.country, state.section, p, 'all') || hasData(state.country, state.section, p, state.category);
    b.hidden = !usable;
    const on = usable && p === state.period;
    b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
  });
  $$('#axis-sections button').forEach(b => {
    const s = b.dataset.section;
    const usable = hasData(state.country, s, state.period, state.category) || hasData(state.country, s, state.period, 'all');
    b.hidden = !usable;
    const on = usable && s === state.section;
    b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
  });
  $$('#axis-categories .chip').forEach(b => {
    const cat = CATEGORIES.find(c => c.id === b.dataset.category);
    const usable = cat.periods.includes(state.period)
      && hasData(state.country, state.section, state.period, cat.id);
    b.hidden = !usable;
    const on = usable && b.dataset.category === state.category;
    b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
  });
  // 選択中のチップが横スクロールの外に居ると、どこに居るのか分からないまま
  // リストだけ入れ替わる（カテゴリはスワイプ軸にもなる）。必ず見える位置へ寄せる。
  for (const sel of ['#axis-periods', '#axis-categories']) {
    const active = $(`${sel} .chip.is-active`);
    active?.scrollIntoView({ inline: 'center', block: 'nearest',
      behavior: state.reduceMotion ? 'auto' : 'smooth' });
  }
  const showMetric = growthAvailable('24h') || growthAvailable(state.period);
  $('#axis-metric-row').hidden = !showMetric;
  $$('#axis-metric button').forEach(b => {
    const on = b.dataset.metric === state.metric;
    b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
    b.disabled = b.dataset.metric === 'growth' && !growthAvailable();
  });
  $('#list-wrap').setAttribute('aria-label',
    t('a11y.swipeHint', { axis: t('settings.swipeAxis.' + state.swipeAxis) }));
  const c = COUNTRIES.find(x => x.code === state.country) || COUNTRIES[0];
  $('#country-flag').textContent = c.flag;
  $('#country-code').textContent = c.code;
  $('#btn-country').setAttribute('aria-label', `${t('settings.country')}: ${t('country.' + c.code)}`);
}

/* --------------------------------------------------------------- statusbar */
function renderStatus(data, search = null) {
  const bar = $('#statusbar');
  bar.replaceChildren();
  if (search?.q) {
    // 検索中は「何件中何件か」を最優先で出す（データの鮮度表示より知りたい情報）
    bar.append(el('span', 'badge badge-mock', '🔍'),
      el('span', null, t('search.hits', { n: search.shown, total: search.total })),
      youtubeSearchButton(search.q, state.period));
    return;
  }
  if (state.index?.source === 'mock') {
    bar.append(el('span', 'badge badge-mock', 'SAMPLE'), el('span', null, t('settings.dataSource.mock')));
    return;
  }
  if (state.offline) bar.append(el('span', 'badge badge-off', 'OFFLINE'), el('span', null, t('state.offline')));
  if (data?.generatedAt) {
    const ageDays = (Date.now() - new Date(data.generatedAt).getTime()) / 864e5;
    const key = ageDays > 1 ? 'state.stale' : 'state.updated';
    bar.append(el('span', null, t(key, { t: fmtAgo(data.generatedAt) })));
  }
  if (state.index?.quota?.degraded) bar.append(el('span', 'badge badge-off', '↓'), el('span', null, t('state.degraded')));
}

/* ---------------------------------------------------------- everyone view */
async function renderEveryone() {
  const list = $('#list');
  const my = ++state.reqId;
  skeletonList(list, 8, { hero: true });
  renderStatus(null);
  let data = null;
  try {
    data = await getJSON(listPath());
  } catch {
    if (my !== state.reqId) return;
    // まだ収集が届いていない軸と、本当の通信エラーを区別する（同じ見た目にしない）
    list.replaceChildren(stateNode(hasData() ? 'error' : 'pending'));
    renderStatus(null);
    return;
  }
  if (my !== state.reqId) return;
  const q = normalizeQ(state.q);
  const shown = q ? data.items.filter(it => matchesQuery(it, q)) : data.items;
  // 絞り込み中は 1 位のヒーロー扱いをやめる（「検索結果の1件目」は1位ではない）
  paintRanking(list, shown, { hero: !q });
  if (q && !shown.length) list.replaceChildren(stateNode('noHits'));
  renderStatus(data, { q, shown: shown.length, total: data.items.length });
  syncSearchChrome();
}

function paintRanking(list, items, { hero = false, why = false, delta = true } = {}) {
  unobserveCards(list);
  list.replaceChildren();
  endLoading(list);
  if (!items || !items.length) { list.append(stateNode('empty')); return; }
  let sinceAd = 0, slot = 0;
  items.forEach((item, i) => {
    list.append(cardNode(item, { hero: hero && i === 0, why: why ? item.__why : null, delta }));
    sinceAd++;
    if (sinceAd === AD_EVERY && i !== items.length - 1) { list.append(adNode(++slot)); sinceAd = 0; }
  });
  observeCards(list);
}

/* ---------------------------------------------------------------- my view */
function syncLearningSwitch() {
  const on = Learn.load().enabled;
  $('#my-enabled').checked = on;
  $('.switch-label').textContent = `${t('my.learning')}: ${t(on ? 'my.learning.on' : 'my.learning.off')}`;
}

async function renderMy() {
  const list = $('#my-list');
  const my = ++state.reqId;                 // 遅れて返ってきた前の描画で上書きされないように
  skeletonList(list, 6);
  syncLearningSwitch();
  if (Learn.isEmpty()) {
    const li = el('li');
    const box = el('div', 'state');
    box.append(el('div', 'state-emoji', '🌱'));
    box.append(el('p', 'state-title', t('my.empty.title')));
    box.append(el('p', 'state-body', t('my.empty.body')));
    const b = el('button', 'btn btn-primary', t('mode.everyone'));
    b.type = 'button';
    b.addEventListener('click', () => go({ mode: 'everyone' }));
    box.append(b);
    li.append(box);
    list.replaceChildren(li);
    endLoading(list);
    return;
  }
  // 候補プール: いまの国の主要リストをまとめて読む（キャッシュ済みなら即返る）
  const wanted = [];
  for (const s of SECTIONS) for (const p of ['24h', 'week', 'month']) {
    wanted.push(datasetPath(state.country, s.id, p, 'all'));
  }
  const pools = await Promise.all(wanted.map(p => getJSON(p, { soft: true })));
  if (my !== state.reqId) return;
  const seen = new Set(); const cand = [];
  pools.filter(Boolean).forEach(d => d.items.forEach(it => {
    if (seen.has(it.videoId)) return;
    seen.add(it.videoId);
    const { score, why } = Learn.score(it);
    // 理由は必ず1行出す（「見える」ことが仕様の核。行の有無でカード高さが揺れるのも防ぐ）
    if (score > 0) cand.push({ ...it, __score: score, __why: why.length ? why : [catLabelOf(it.categoryId) || it.channelTitle] });
  }));
  cand.sort((a, b) => b.__score - a.__score);
  const top = cand.slice(0, 100).map((it, i) => ({ ...it, rank: i + 1, prevRank: null, delta: null }));
  paintRanking(list, top, { hero: false, why: true, delta: false });
  if (!$('#my-inspector').hidden) renderInspector();
}

function renderInspector() {
  const box = $('#my-inspector');
  box.replaceChildren();
  const snap = Learn.snapshot();
  const group = (titleKey, bag, rows) => {
    if (!rows.length) return;
    const g = el('div', 'insp-group');
    g.append(el('h2', 'insp-h', t(titleKey)));
    rows.slice(0, 12).forEach(r => {
      const row = el('div', 'insp-row');
      row.append(el('span', 'insp-name', r.name));
      const range = document.createElement('input');
      range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '1';
      range.value = String(Math.round(clamp(r.w, 0, 100)));
      range.setAttribute('aria-label', `${t('my.weight')}: ${r.name}`);
      range.addEventListener('change', () => {
        Learn.setWeight(bag, r.key, Number(range.value));
        wv.textContent = range.value;
        renderMy();
      });
      const wv = el('span', 'insp-w', String(Math.round(r.w)));
      const mute = el('button', 'iconx', '🚫');
      mute.type = 'button'; mute.title = t('my.mute');
      mute.setAttribute('aria-label', `${t('my.mute')}: ${r.name}`);
      mute.addEventListener('click', () => { Learn.mute(r.key); renderInspector(); renderMy(); });
      const del = el('button', 'iconx', '✕');
      del.type = 'button'; del.title = t('my.remove');
      del.setAttribute('aria-label', `${t('my.remove')}: ${r.name}`);
      del.addEventListener('click', () => { Learn.forget(bag, r.key); renderInspector(); renderMy(); });
      row.append(range, wv, mute, del);
      g.append(row);
    });
    box.append(g);
  };
  group('my.channels', 'channels', snap.channels);
  group('my.terms', 'terms', snap.terms);
  group('my.categories', 'categories',
    snap.categories.map(r => ({ ...r, name: catLabelOf(r.key) || r.key })));

  if (snap.muted.length) {
    const g = el('div', 'insp-group');
    g.append(el('h2', 'insp-h', t('my.mute')));
    snap.muted.forEach(k => {
      const row = el('div', 'insp-row');
      row.append(el('span', 'insp-name', k));
      const b = el('button', 'btn btn-ghost btn-sm', t('my.unmute'));
      b.type = 'button';
      b.addEventListener('click', () => { Learn.unmute(k); renderInspector(); renderMy(); });
      row.append(b);
      g.append(row);
    });
    box.append(g);
  }

  box.append(el('p', 'insp-note', t('my.localOnly')));
  const acts = el('div', 'insp-actions');
  const exp = el('button', 'btn btn-ghost btn-sm', t('my.export'));
  exp.type = 'button';
  exp.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(Learn.load(), null, 2)], { type: 'application/json' });
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'trendzap-learning.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  const clr = el('button', 'btn btn-ghost btn-sm', t('my.clearAll'));
  clr.type = 'button';
  clr.addEventListener('click', () => {
    if (confirm(t('my.clearAll.confirm'))) { Learn.clear(); renderInspector(); renderMy(); toast(t('my.clearAll')); }
  });
  acts.append(exp, clr);
  box.append(acts);
}

/* ------------------------------------------------------------- search view
 * 2026-08-25 発注者改訂: 「ワード」タブを「検索」タブに置き換えた。
 * ここで検索するのは *このアプリが集めたランキング全体*（国 × 部門 × 期間 × カテゴリ）。
 * YouTube 全体の検索は API キーをブラウザに置けないので本家へ転送する（ORDER §8 の転送導線）。
 * 旧ワードランキング（ORDER §2-12）は「話題のワード」チップとして検索の入口に残している。
 */
const find = {
  q: '',
  period: 'any',
  section: 'any',
  built: false,
};

/** 検索対象のデータセット一覧。多すぎると重いので「総合」を全期間×全部門ぶん見る。 */
function findTargets() {
  const out = [];
  // 存在するデータセットだけを見る（無いものを叩くと打鍵のたびに 404 が並ぶ）
  const add = (section, period, category) => {
    if (!hasData(state.country, section, period, category, 'published')) return;
    out.push({ section, period, path: datasetPath(state.country, section, period, category) });
  };
  for (const s of SECTIONS) {
    if (find.section !== 'any' && find.section !== s.id) continue;
    for (const p of PERIODS) {
      if (find.period !== 'any' && find.period !== p.id) continue;
      add(s.id, p.id, 'all');
      // 期間か部門を絞っているときは、その範囲のカテゴリ別も混ぜて取りこぼしを減らす
      if (find.period !== 'any' || find.section !== 'any') {
        CATEGORIES.filter(c => c.id !== 'all' && c.periods.includes(p.id))
          .forEach(c => add(s.id, p.id, c.id));
      }
    }
  }
  return out;
}

function buildFindAxes() {
  const pa = $('#find-periods');
  pa.replaceChildren();
  [{ id: 'any', label: t('find.any') }, ...PERIODS.map(p => ({ id: p.id, label: t(`period.${p.id}`) }))]
    .forEach(o => {
      const b = el('button', 'chip', o.label);
      b.type = 'button'; b.role = 'tab'; b.dataset.period = o.id;
      b.addEventListener('click', () => { find.period = o.id; syncFindAxes(); renderFind(); });
      pa.append(b);
    });
  const sa = $('#find-sections');
  sa.replaceChildren();
  [{ id: 'any', label: t('find.any') }, ...SECTIONS.map(s => ({ id: s.id, label: t(`section.${s.id}`) }))]
    .forEach(o => {
      const b = el('button', null, o.label);
      b.type = 'button'; b.role = 'tab'; b.dataset.section = o.id;
      b.addEventListener('click', () => { find.section = o.id; syncFindAxes(); renderFind(); });
      sa.append(b);
    });
  find.built = true;
}

function syncFindAxes() {
  $$('#find-periods .chip').forEach(b => {
    const on = b.dataset.period === find.period;
    b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
  });
  $$('#find-sections button').forEach(b => {
    const on = b.dataset.section === find.section;
    b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
  });
}

/** 話題のワード（旧ワードランキング）。タップで検索語になる。 */
async function renderFindWords() {
  const box = $('#find-words');
  box.replaceChildren();
  if (find.q) return;                       // 検索中は結果に集中させる
  const data = await getJSON(`data/tags-${state.country}.json`, { soft: true });
  if (!data?.items?.length) return;
  box.append(el('h2', 'find-words-h', t('tags.title')));
  const row = el('div', 'find-words-row');
  data.items.slice(0, 12).forEach(it => {
    const b = el('button', 'chip', it.term);
    b.type = 'button';
    b.addEventListener('click', () => {
      $('#fq').value = it.term;
      find.q = it.term;
      renderFind();
      $('#fq').focus();
    });
    row.append(b);
  });
  box.append(row);
}

function findStatus(text, icon = '🔍') {
  const bar = $('#find-status');
  bar.replaceChildren();
  if (!text) return;
  bar.append(el('span', 'badge badge-mock', icon), el('span', null, text));
}

async function renderFind() {
  if (!find.built) buildFindAxes();
  syncFindAxes();
  const list = $('#find-list');
  const my = ++state.reqId;
  $('#fq-clear').hidden = !find.q;

  const q = normalizeQ(find.q);
  if (!q) {
    list.replaceChildren();
    const li = el('li'); const box = el('div', 'state');
    box.append(el('div', 'state-emoji', '🔎'));
    box.append(el('p', 'state-title', t('find.empty.title')));
    box.append(el('p', 'state-body', t('find.empty.body')));
    li.append(box); list.append(li);
    endLoading(list);
    findStatus('');
    await renderFindWords();
    return;
  }

  findStatus(t('find.loading'));
  skeletonList(list, 6);
  const targets = findTargets();
  const datasets = await Promise.all(targets.map(tg => getJSON(tg.path, { soft: true })));
  if (my !== state.reqId) return;

  // 同じ動画が複数のランキングに出るので、いちばん順位の高い1件にまとめる
  const best = new Map();
  datasets.forEach((d, i) => {
    if (!d?.items) return;
    const tg = targets[i];
    d.items.forEach(it => {
      if (!matchesQuery(it, q)) return;
      const prev = best.get(it.videoId);
      if (!prev || it.rank < prev.__origRank) {
        best.set(it.videoId, { ...it, __where: tg, __origRank: it.rank });
      }
    });
  });
  const hits = [...best.values()].sort((a, b) => b.viewCount - a.viewCount);
  $('#find-words').replaceChildren();

  if (!hits.length) {
    const li = el('li'); const box = el('div', 'state');
    box.append(el('div', 'state-emoji', '🔍'));
    box.append(el('p', 'state-title', t('find.none.title')));
    box.append(el('p', 'state-body', t('find.none.body', { q: find.q })));
    const a = youtubeSearchButton(find.q, find.period === 'any' ? 'all' : find.period);
    a.className = 'btn btn-primary';
    box.append(a);
    li.append(box);
    list.replaceChildren(li);
    endLoading(list);
    findStatus(t('find.hits', { n: 0 }));
    return;
  }

  // 順位欄には「検索結果の何番目か」ではなく「元のランキングで何位だったか」を出す。
  // 連番を出すと1件目が常に金色の1位に見え、意味の無い数字がいちばん目立ってしまう。
  const shown = hits.slice(0, 100).map(it => ({ ...it, rank: it.__origRank, prevRank: null, delta: null }));
  paintRanking(list, shown, { hero: false, why: false, delta: false });
  // 「どのランキングの何位で見つかったか」を各行に添える（検索結果の意味づけ）
  $$('#find-list .card[data-video-id]', document).forEach(li => {
    const item = li.__item;
    const w = item?.__where;
    if (!w) return;
    const info = $('.info', li);
    if (!info) return;
    info.append(el('span', 'why', t('find.where', {
      period: t(`period.${w.period}`), section: t(`section.${w.section}`),
    })));
  });
  endLoading(list);

  const bar = $('#find-status');
  bar.replaceChildren();
  bar.append(el('span', 'badge badge-mock', '🔍'), el('span', null, t('find.hits', { n: hits.length })));
  // 上位 100 件しか描かない。切り捨てた件数を黙って隠さない（憲章「一覧性」の誠実さ）
  if (hits.length > shown.length) {
    bar.append(el('span', 'dot', '·'), el('span', null, t('find.more', { n: hits.length - shown.length })));
  }
  bar.append(youtubeSearchButton(find.q, find.period === 'any' ? 'all' : find.period));
}

/* --------------------------------------------------------------- map view */
function project(lat, lon) { return { x: (lon + 180) / 360 * 100, y: (90 - lat) / 180 * 100 }; }

/* 世界の陸地（正距円筒図法・viewBox 0 0 360 180、x=経度+180 / y=90-緯度）。
 * 外部 CDN を使えないので、輪郭を大づかみに手で置いた埋め込みパス。
 * 目的は「どこが陸か」を一目で示すことで、測量的な正確さではない（BACKLOG に実測版の案）。 */
const LAND_PATHS = [
  // ユーラシア（本体）
  'M170 32 L196 26 L232 22 L268 26 L300 34 L316 44 L330 44 L336 52 L322 58 L306 56 L292 62 L280 58 L268 66 L256 62 L246 72 L236 66 L226 74 L214 68 L206 76 L196 70 L188 78 L180 70 L172 62 L164 66 L156 58 L162 48 L156 42 L166 38 Z',
  // ヨーロッパ西部の張り出し
  'M162 40 L176 36 L184 42 L180 52 L172 56 L164 52 Z',
  // インド亜大陸
  'M246 72 L254 70 L258 82 L250 92 L244 84 Z',
  // 東南アジア・島嶼
  'M276 84 L292 82 L300 88 L288 96 L276 92 Z',
  'M300 92 L312 90 L318 96 L306 100 Z',
  // アフリカ
  'M164 66 L186 62 L200 70 L204 84 L196 100 L186 118 L176 128 L168 118 L162 100 L158 84 Z',
  // 北アメリカ
  'M36 26 L74 20 L104 26 L118 38 L112 50 L100 56 L92 68 L84 78 L76 72 L70 60 L58 54 L46 44 L34 38 Z',
  // 中央アメリカ
  'M84 78 L96 76 L104 86 L96 92 L88 86 Z',
  // 南アメリカ
  'M100 96 L118 92 L126 104 L124 122 L116 140 L106 152 L98 142 L96 124 L92 108 Z',
  // オーストラリア
  'M300 118 L326 114 L336 124 L330 138 L312 142 L300 132 Z',
  // ニュージーランド
  'M344 136 L352 132 L354 142 L346 146 Z',
  // グリーンランド
  'M112 14 L136 10 L146 20 L138 32 L120 30 L110 22 Z',
];

async function renderMap() {
  const wrap = $('#map-wrap');
  const my = ++state.reqId;
  wrap.replaceChildren();
  const box = el('div', 'mapbox');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 360 180');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const ns = 'http://www.w3.org/2000/svg';
  // 陸地を先に敷き、その上に経緯線を薄く重ねる（地形が主役・格子は補助）
  const land = document.createElementNS(ns, 'g');
  land.setAttribute('class', 'map-land');
  LAND_PATHS.forEach(d => {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    land.append(p);
  });
  svg.append(land);

  const line = (x1, y1, x2, y2, strong) => {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke', 'currentColor');
    l.setAttribute('stroke-width', strong ? 0.7 : 0.35);
    l.setAttribute('opacity', strong ? 0.35 : 0.16);
    svg.append(l);
  };
  for (let lon = -180; lon <= 180; lon += 30) line(lon + 180, 0, lon + 180, 180, lon === 0);
  for (let lat = -60; lat <= 60; lat += 30) line(0, 90 - lat, 360, 90 - lat, lat === 0);
  box.style.color = 'var(--line-strong)';
  box.append(svg);

  const [data, taps] = await Promise.all([
    getJSON('data/map.json', { soft: true }),
    Taps.stats(), // 無効時は即 null。地図の表示をブロックしない
  ]);
  if (my !== state.reqId) return;
  if (!data) {
    wrap.append(el('p', 'state-body', t('map.empty')));
    return;
  }
  const known = new Set(COUNTRIES.map(c => c.code));
  // ピンのバッジは密集地帯（欧州）で相互に重なり数字が誤読されるため、
  // タップ数上位5か国＋対応国だけに出す。全数値は下の国リスト（主導線）に必ず出る。
  const badged = new Set([
    ...Object.entries(taps?.countries || {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c),
    ...COUNTRIES.map(c => c.code),
  ]);
  const dive = it => {
    if (known.has(it.country)) go({ mode: 'everyone', country: it.country, period: '24h' });
    else {
      Taps.send(it.videoId, it.country);
      window.open(`https://www.youtube.com/shorts/${it.videoId}`.replace('/shorts/', it.isShort ? '/shorts/' : '/watch?v='), '_blank', 'noopener');
    }
  };
  const label = it => known.has(it.country)
    ? t('map.dive', { country: t('country.' + it.country) })
    : `${t('country.' + it.country)}: ${it.title}`;

  data.items.forEach(it => {
    const { x, y } = project(it.lat, it.lon);
    const b = el('button', known.has(it.country) ? 'map-pin is-primary' : 'map-pin');
    b.type = 'button';
    b.style.left = `${clamp(x, 3, 97)}%`; b.style.top = `${clamp(y, 6, 94)}%`;
    b.title = `${t('country.' + it.country) || it.country} — ${it.title}`;
    b.setAttribute('aria-label', label(it));
    /* ピンは地理的に密集するため 44px を確保できない（欧州で必ず重なる）。
       下の国リストが 44px の主たるタップ経路。ピンは副次的な導線として扱う。 */
    b.dataset.secondaryTarget = '1';
    const img = new Image();
    img.src = thumbUrl(it.videoId); img.alt = ''; img.loading = 'lazy';
    b.append(img);
    const tapN = taps?.countries?.[it.country] || 0;
    if (tapN > 0 && badged.has(it.country)) {
      b.classList.add('has-taps');
      b.append(el('span', 'pin-taps', fmtCount(tapN)));
    }
    b.addEventListener('click', () => dive(it));
    box.append(b);
  });
  wrap.append(box);
  // v3 独自指標: 「このアプリから今日◯回飛んだ」。統計が取れないときは行ごと出さない
  if (taps && taps.total > 0) {
    const line = el('p', 'map-residents');
    line.append(el('span', 'residents-dot'), el('span', null, t('taps.today', { n: fmtCount(taps.total) })));
    wrap.append(line);
  }
  wrap.append(el('p', 'map-legend', t('map.subtitle')));

  // 44px を満たす主たる導線（地図はあくまで俯瞰）
  const strip = el('ol', 'map-countries');
  [...data.items]
    .sort((a, b) => (known.has(b.country) - known.has(a.country)) || b.viewCount - a.viewCount)
    .forEach(it => {
      const li = el('li', known.has(it.country) ? 'mc-row is-primary' : 'mc-row');
      const b = el('button', 'mc-btn');
      b.type = 'button';
      b.setAttribute('aria-label', label(it));
      const th = el('span', 'mc-thumb');
      const img = new Image(); img.src = thumbUrl(it.videoId); img.alt = ''; img.loading = 'lazy';
      th.append(img);
      const info = el('span', 'info');
      info.append(el('span', 'mc-country', t('country.' + it.country) || it.country));
      info.append(el('span', 'title', it.title));
      const meta = el('span', 'meta');
      meta.append(el('b', 'views', fmtViews(it.viewCount)));
      const rowTaps = taps?.countries?.[it.country] || 0;
      if (rowTaps > 0) meta.append(el('span', 'dot', '·'), el('span', 'mc-taps', t('taps.count', { n: fmtCount(rowTaps) })));
      if (known.has(it.country)) meta.append(el('span', 'dot', '·'), el('span', null, t('map.dive', { country: it.country })));
      info.append(meta);
      b.append(th, info);
      b.addEventListener('click', () => dive(it));
      li.append(b);
      strip.append(li);
    });
  wrap.append(strip);
}

/* ------------------------------------------------------------------ views */
const VIEWS = { everyone: '#view-everyone', my: '#view-my', tags: '#view-tags', map: '#view-map' };

async function renderCurrentView() {
  for (const [mode, sel] of Object.entries(VIEWS)) $(sel).hidden = mode !== state.mode;
  $$('.mode').forEach(b => {
    const on = b.dataset.mode === state.mode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });
  // どのビューで何が起きても、スケルトンのまま固まらないようにする。
  // （タブ切替のハンドラは go() を await しないので、投げっぱなしだと誰も拾えない）
  try {
    if (state.mode === 'everyone') { syncAxes(); renderFavs(); Favs.recordSoon(); await renderEveryone(); }
    else if (state.mode === 'my')  { await renderMy(); }
    else if (state.mode === 'tags'){ await renderFind(); }
    else if (state.mode === 'map') { await renderMap(); }
  } catch (err) {
    console.error('render failed', err);
    const list = { my: '#my-list', tags: '#find-list' }[state.mode];
    if (list) { const n = $(list); n.replaceChildren(stateNode('error')); endLoading(n); }
    else if (state.mode === 'map') $('#map-wrap').replaceChildren(stateNode('error').firstChild);
  }
}

/* ---------------------------------------------------------------- routing */
function hashOf(s = state) {
  if (s.mode === 'everyone') return `#/everyone/${s.country}/${s.section}/${s.period}/${s.category}/${s.metric}`;
  if (s.mode === 'tags') return `#/tags/${s.country}`;
  return `#/${s.mode}`;
}

function readHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return false;
  const [mode, ...rest] = parts;
  if (!VIEWS[mode]) return false;
  state.mode = mode;
  if (mode === 'everyone') {
    const [country, section, period, category, metric] = rest;
    if (COUNTRIES.some(c => c.code === country)) state.country = country;
    if (SECTIONS.some(s => s.id === section)) state.section = section;
    if (PERIODS.some(p => p.id === period)) state.period = period;
    if (CATEGORIES.some(c => c.id === category)) state.category = category;
    state.metric = metric === 'growth' ? 'growth' : 'published';
  } else if (mode === 'tags' && rest[0] && COUNTRIES.some(c => c.code === rest[0])) {
    state.country = rest[0];
  }
  return true;
}

function normalize() {
  const cat = CATEGORIES.find(c => c.id === state.category);
  if (!cat || !cat.periods.includes(state.period)) state.category = 'all';
  if (state.metric === 'growth' && !growthAvailable()) state.metric = 'published';

  // 収集がまだ届いていない組み合わせは、いちばん近い「あるもの」へ寄せる。
  // 直リンクや保存済みの国で 404 の空振りを見せないため（index.json が無いときは素通し）。
  if (state.index?.datasets && !hasData()) {
    if (!countryHasData(state.country)) state.country = usableCountries()[0].code;
    if (!hasData() && state.category !== 'all') state.category = 'all';
    if (!hasData()) {
      // 1軸ずつ直すと「部門も期間も無い」ときに収束しない。組み合わせ全体を見て、
      // いまの選択にいちばん近いもの（部門一致 > 期間一致 > 並び順）を選ぶ。
      const cands = [];
      for (const s of SECTIONS) {
        for (const p of PERIODS) {
          if (hasData(state.country, s.id, p.id, 'all')) cands.push({ section: s.id, period: p.id });
        }
      }
      const score = c => (c.section === state.section ? 2 : 0) + (c.period === state.period ? 1 : 0);
      const best = cands.sort((a, b) => score(b) - score(a))[0];
      if (best) { state.section = best.section; state.period = best.period; }
    }
  }
}

async function go(patch = {}, { push = true, dir = 0 } = {}) {
  Object.assign(state, patch);
  normalize();
  if (patch.country) LS.set('ytta.country', state.country);
  const h = hashOf();
  if (push && location.hash !== h) location.hash = h;
  if (dir && !state.reduceMotion) {
    const w = $('#list-wrap');
    w.classList.remove('zap-l', 'zap-r');
    void w.offsetWidth;
    w.classList.add(dir > 0 ? 'zap-l' : 'zap-r');
  }
  await renderCurrentView();
}

window.addEventListener('hashchange', () => {
  // go() 自身が書き換えたハッシュなら状態は既に一致している。タイマーで抑えるより確実。
  if (location.hash === hashOf()) return;
  if (readHash()) {
    normalize();
    if (location.hash !== hashOf()) history.replaceState(null, '', hashOf());
    renderCurrentView();
  }
});

/* ------------------------------------------------------------------ swipe */
const AXIS_LISTS = {
  period:   () => PERIODS.map(p => p.id),
  section:  () => SECTIONS.map(s => s.id),
  category: () => CATEGORIES.filter(c => c.periods.includes(state.period)).map(c => c.id),
  country:  () => COUNTRIES.map(c => c.code),
};
const AXIS_KEY = { period: 'period', section: 'section', category: 'category', country: 'country' };

function stepAxis(dir) {
  const axis = state.swipeAxis;
  const list = AXIS_LISTS[axis]();
  const key = AXIS_KEY[axis];
  const i = list.indexOf(state[key]);
  const next = list[clamp(i + dir, 0, list.length - 1)];
  if (next === state[key]) return;
  go({ [key]: next }, { dir });
}

function bindSwipe(node) {
  let x0 = 0, y0 = 0, active = false;
  node.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    active = true; x0 = e.clientX; y0 = e.clientY;
  }, { passive: true });
  node.addEventListener('pointerup', e => {
    if (!active) return;
    active = false;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) stepAxis(dx < 0 ? 1 : -1);
  }, { passive: true });
  node.addEventListener('pointercancel', () => { active = false; }, { passive: true });
}

document.addEventListener('keydown', e => {
  if (state.mode !== 'everyone') return;
  const el0 = e.target instanceof Element ? e.target : null;
  if (el0 && el0.closest('input, select, textarea, [contenteditable]')) return;
  if (e.key === 'ArrowRight') stepAxis(1);
  else if (e.key === 'ArrowLeft') stepAxis(-1);
});

/* ------------------------------------------------------------------ toast */
let toastTimer = 0;
function toast(msg) {
  const n = $('#toast');
  // hidden のまま書き換えるとライブリージョンとして読まれない。先に出してから入れる。
  n.hidden = false;
  requestAnimationFrame(() => { n.textContent = msg; });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { n.hidden = true; n.textContent = ''; }, 2200);
}

/* --------------------------------------------------------------- settings */
function optionRow(labelKey, options, current, onPick) {
  const g = el('div', 'set-group');
  g.append(el('p', 'set-label', t(labelKey)));
  const row = el('div', 'set-opts');
  options.forEach(o => {
    const b = el('button', 'chip' + (o.id === current ? ' is-active' : ''), o.label);
    b.type = 'button';
    // 選ぶとシートを描き直すので、描き直したあと同じ項目にフォーカスを戻すための目印。
    b.dataset.opt = `${labelKey}:${o.id}`;
    b.addEventListener('click', () => onPick(o.id));
    row.append(b);
  });
  g.append(row);
  return g;
}

function openSettings({ focus = true, refocus = null } = {}) {
  const body = $('#sheet-body');
  body.replaceChildren();
  // 選択のたびにシートを描き直す。描き直したら、いま押した項目にフォーカスを戻す。
  const reopen = key => openSettings({ focus: false, refocus: key });

  body.append(optionRow('settings.language', LANGUAGES.map(l => ({ id: l.id, label: l.label })), state.lang,
    async id => { await loadLang(id); applyStatic(); buildAxes(); await renderCurrentView(); reopen(`settings.language:${id}`); }));

  body.append(optionRow('settings.theme',
    [['auto', 'settings.theme.auto'], ['light', 'settings.theme.light'], ['dark', 'settings.theme.dark']]
      .map(([id, k]) => ({ id, label: t(k) })), state.themePref,
    id => { setTheme(id); reopen(`settings.theme:${id}`); }));

  body.append(optionRow('settings.country',
    COUNTRIES.map(c => ({ id: c.code, label: `${c.flag} ${t('country.' + c.code)}` })), state.country,
    id => { go({ country: id }); reopen(`settings.country:${id}`); }));

  body.append(optionRow('settings.swipeAxis',
    ['period', 'section', 'category', 'country'].map(id => ({ id, label: t('settings.swipeAxis.' + id) })),
    state.swipeAxis,
    id => { state.swipeAxis = id; LS.set('ytta.swipeAxis', id); syncAxes(); reopen(`settings.swipeAxis:${id}`); }));

  const g = el('div', 'set-group');
  g.append(el('p', 'set-label', t('settings.reduceMotion')));
  const lab = el('label', 'switch');
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = state.reduceMotion;
  cb.addEventListener('change', () => {
    state.reduceMotion = cb.checked; LS.set('ytta.reduceMotion', cb.checked);
    document.body.classList.toggle('reduce-motion', cb.checked);
  });
  lab.append(cb, el('span', 'switch-track'), el('span', 'switch-label', t('settings.reduceMotion')));
  g.append(lab);
  body.append(g);

  const about = el('div', 'set-group');
  about.append(el('p', 'set-label', t('settings.dataSource')));
  about.append(el('p', 'set-note', state.index?.source === 'mock' ? t('settings.dataSource.mock') : t('settings.dataSource.live')));
  about.append(el('p', 'set-note', t('app.attribution')));
  about.append(el('p', 'set-note', t('app.thirdParty')));
  const link = el('a', 'set-link', t('settings.privacy'));
  link.href = 'privacy.html';
  about.append(link);
  body.append(about);

  $('#sheet-backdrop').hidden = false;
  $('#sheet-settings').hidden = false;
  setBackgroundInert(true);
  // 開いた瞬間は閉じるボタン、描き直しのときは押した項目へ。
  // どちらもしないとフォーカスが body に落ちてキーボード操作が続けられない。
  const back = refocus && $(`#sheet-body [data-opt="${refocus}"]`);
  if (back) back.focus();
  else if (focus) $('#sheet-close').focus();
}

/** シートを開いている間、背後の UI をフォーカス・支援技術の両方から外す。 */
function setBackgroundInert(on) {
  $$('.appbar, .modes, .view, .foot').forEach(n => { n.inert = on; });
}

function closeSettings() {
  setBackgroundInert(false);
  $('#sheet-backdrop').hidden = true;
  $('#sheet-settings').hidden = true;
  $('#btn-settings').focus();
}

/* ------------------------------------------------------------------- boot */
function bindChrome() {
  $$('.mode').forEach(b => b.addEventListener('click', () => go({ mode: b.dataset.mode })));
  $('#btn-settings').addEventListener('click', openSettings);
  $('#sheet-close').addEventListener('click', closeSettings);
  $('#sheet-backdrop').addEventListener('click', closeSettings);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet-settings').hidden) closeSettings(); });
  $('#btn-lang').addEventListener('click', async () => {
    const next = LANGUAGES.find(l => l.id !== state.lang) || LANGUAGES[0];
    await loadLang(next.id);
    applyStatic(); buildAxes(); await renderCurrentView();
  });
  $('#btn-country').addEventListener('click', () => {
    // データのある国だけを巡回する（未収集の国に入ると 404 になるため）
    const codes = usableCountries().map(c => c.code);
    const i = codes.indexOf(state.country);
    go({ country: codes[(i + 1) % codes.length] }, { dir: 1 });
  });
  $('#my-enabled').addEventListener('change', e => {
    Learn.setEnabled(e.target.checked);
    syncLearningSwitch();
    renderMy();
  });
  $('#my-inspect').addEventListener('click', () => {
    const box = $('#my-inspector');
    box.hidden = !box.hidden;
    $('#my-inspect').textContent = t(box.hidden ? 'my.inspector.open' : 'my.inspector.close');
    if (!box.hidden) renderInspector();
  });
  // 検索: 入力のたびに描き直す（データは取得済みなので即時。API は呼ばない）
  let qTimer = 0;
  $('#q').addEventListener('input', e => {
    state.q = e.target.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { syncSearchChrome(); renderEveryone(); }, 120);
  });
  $('#q').addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.q) { e.stopPropagation(); $('#q-clear').click(); }
  });
  $('#q-clear').addEventListener('click', () => {
    state.q = ''; $('#q').value = ''; syncSearchChrome(); renderEveryone(); $('#q').focus();
  });

  // 検索タブ（旧ワードタブ）: 集めたランキング全体を横断して探す
  let fqTimer = 0;
  $('#fq').addEventListener('input', e => {
    find.q = e.target.value;
    clearTimeout(fqTimer);
    fqTimer = setTimeout(() => renderFind(), 160);
  });
  $('#fq-clear').addEventListener('click', () => {
    find.q = ''; $('#fq').value = ''; renderFind(); $('#fq').focus();
  });

  bindSwipe($('#list-wrap'));
  window.addEventListener('online',  () => { state.offline = false; renderCurrentView(); });
  window.addEventListener('offline', () => { state.offline = true;  renderCurrentView(); });
}

function maybeSwipeHint() {
  if (LS.get('ytta.hintSeen', false)) return;
  const hint = el('div', 'hint');
  hint.append(el('span', null, t('hint.swipe', { axis: t('settings.swipeAxis.' + state.swipeAxis) })));
  const b = el('button', null, t('hint.gotIt'));
  b.type = 'button';
  b.addEventListener('click', () => { LS.set('ytta.hintSeen', true); hint.remove(); });
  hint.append(b);
  $('#view-everyone').insertBefore(hint, $('#list-wrap'));
}

function pickLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q && LANGUAGES.some(l => l.id === q)) return q;
  const saved = LS.get('ytta.lang', null);
  if (saved && LANGUAGES.some(l => l.id === saved)) return saved;
  const nav = (navigator.language || '').slice(0, 2);
  return LANGUAGES.some(l => l.id === nav) ? nav : DEFAULT_LANG;
}

async function boot() {
  document.body.classList.toggle('reduce-motion', !!state.reduceMotion);
  resolveTheme();
  await loadLang(pickLang());
  applyStatic();
  buildAxes();
  bindChrome();
  readHash();
  state.index = await getJSON('data/index.json', { soft: true });
  normalize();
  // 未収集の軸を normalize が寄せた場合、URL も実際に見えているものへ合わせる
  // （直リンクを共有したときに、開いた人と同じ場所を指すようにする）
  if (!location.hash || location.hash !== hashOf()) history.replaceState(null, '', hashOf());
  await renderCurrentView();
  maybeSwipeHint();
  if ('serviceWorker' in navigator) {
    // boot() は await を挟むため、ここに来た時点で load が既に発火していることがある。
    // その場合 addEventListener('load') は二度と呼ばれず Service Worker が登録されない。
    const register = () => navigator.serviceWorker.register('sw.js').catch(() => {});
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }
}

boot();

/* テスト（Playwright）から状態を触れるようにする。本番でも害はない。 */
window.__trendzap = { state, go, Learn, t };
