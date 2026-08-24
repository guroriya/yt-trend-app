/* ==========================================================================
   TrendZap — app.js
   素の ES モジュール。ビルド工程なし。設定は js/config.js の1箇所だけ。
   データ契約は docs/SCHEMA.md。仕様は docs/ORDER.md。
   ========================================================================== */

import {
  COUNTRIES, SECTIONS, PERIODS, CATEGORIES, LANGUAGES, DEFAULT_LANG,
  MAP_COUNTRIES, AD_EVERY, RETENTION, LEARNING, datasetPath,
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
  country: LS.get('ytta.country', COUNTRIES[0].code),
  section: 'video',
  period: '24h',
  category: 'all',
  metric: 'published',
  lang: DEFAULT_LANG,
  themePref: LS.get('ytta.theme', 'auto'),
  swipeAxis: LS.get('ytta.swipeAxis', 'period'),
  reduceMotion: LS.get('ytta.reduceMotion', false),
  index: null,
  offline: !navigator.onLine,
  reqId: 0,
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
  if (memCache.has(path)) return memCache.get(path);
  const p = fetch(path, { cache: 'no-cache' }).then(r => {
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return r.json();
  });
  memCache.set(path, p);
  try { return await p; }
  catch (err) { memCache.delete(path); if (soft) return null; throw err; }
}

const listPath = (s = state) => datasetPath(s.country, s.section, s.period, s.category, s.metric);

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

function cardNode(item, { hero = false, why = null } = {}) {
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
    col.append(el('span', 'rank', String(item.rank)), deltaNode(item));
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
    line.append(el('span', 'hero-badge', t('card.hero')), deltaNode(item));
    info.append(line);
  }
  info.append(el('span', 'title', item.title));
  info.append(el('span', 'chan', item.channelTitle));
  const meta = el('span', 'meta');
  meta.append(el('b', 'views', fmtViews(item.viewCount)), el('span', 'dot', '·'), el('span', null, fmtAgo(item.publishedAt)));
  info.append(meta);
  if (why && why.length) info.append(el('span', 'why', t('my.matched', { reason: why.join(' · ') })));
  a.append(info);

  a.addEventListener('click', () => Learn.record(item, 'open'));
  li.append(a);
  li.__item = item;
  return li;
}

function adNode(slot) {
  const li = el('li', 'card card-ad');
  li.dataset.adSlot = slot;
  const wrap = el('div', 'card-link');
  const box = el('div', 'ad-box');
  box.append(el('span', 'ad-tag', t('ad.label')), el('span', 'ad-thumb'), el('span', null, t('ad.placeholder')));
  wrap.append(box);
  li.append(wrap);
  return li;
}

function skeletonList(target, n = 8) {
  target.replaceChildren();
  for (let i = 0; i < n; i++) {
    const li = el('li', 'card card-skel');
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

/* ------------------------------------------------------------------- axes */
function buildAxes() {
  // 期間
  const pa = $('#axis-periods');
  pa.replaceChildren();
  PERIODS.forEach(p => {
    const b = el('button', 'chip', t(`period.${p.id}`));
    b.type = 'button'; b.role = 'tab'; b.dataset.period = p.id;
    b.addEventListener('click', () => go({ period: p.id }));
    pa.append(b);
  });
  // 部門
  const sa = $('#axis-sections');
  sa.replaceChildren();
  SECTIONS.forEach(s => {
    const b = el('button', null, t(`section.${s.id}`));
    b.type = 'button'; b.role = 'tab'; b.dataset.section = s.id;
    b.addEventListener('click', () => go({ section: s.id }));
    sa.append(b);
  });
  // カテゴリ
  const ca = $('#axis-categories');
  ca.replaceChildren();
  CATEGORIES.forEach(c => {
    const b = el('button', 'chip', t(`category.${c.id}`));
    b.type = 'button'; b.role = 'tab'; b.dataset.category = c.id;
    b.addEventListener('click', () => go({ category: c.id }));
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
  $$('#axis-periods .chip').forEach(b => {
    const on = b.dataset.period === state.period;
    b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
  });
  $$('#axis-sections button').forEach(b => {
    const on = b.dataset.section === state.section;
    b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
  });
  $$('#axis-categories .chip').forEach(b => {
    const cat = CATEGORIES.find(c => c.id === b.dataset.category);
    const usable = cat.periods.includes(state.period);
    b.hidden = !usable;
    const on = usable && b.dataset.category === state.category;
    b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
  });
  const showMetric = growthAvailable('24h') || growthAvailable(state.period);
  $('#axis-metric-row').hidden = !showMetric;
  $$('#axis-metric button').forEach(b => {
    const on = b.dataset.metric === state.metric;
    b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
    b.disabled = b.dataset.metric === 'growth' && !growthAvailable();
  });
  const c = COUNTRIES.find(x => x.code === state.country) || COUNTRIES[0];
  $('#country-flag').textContent = c.flag;
  $('#country-code').textContent = c.code;
  $('#btn-country').setAttribute('aria-label', `${t('settings.country')}: ${t('country.' + c.code)}`);
}

/* --------------------------------------------------------------- statusbar */
function renderStatus(data) {
  const bar = $('#statusbar');
  bar.replaceChildren();
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
  skeletonList(list, 8);
  renderStatus(null);
  let data = null;
  try {
    data = await getJSON(listPath());
  } catch {
    if (my !== state.reqId) return;
    list.replaceChildren(stateNode('error'));
    renderStatus(null);
    return;
  }
  if (my !== state.reqId) return;
  paintRanking(list, data.items, { hero: true });
  renderStatus(data);
}

function paintRanking(list, items, { hero = false, why = false } = {}) {
  list.replaceChildren();
  if (!items || !items.length) { list.append(stateNode('empty')); return; }
  let sinceAd = 0, slot = 0;
  items.forEach((item, i) => {
    list.append(cardNode(item, { hero: hero && i === 0, why: why ? item.__why : null }));
    sinceAd++;
    if (sinceAd === AD_EVERY && i !== items.length - 1) { list.append(adNode(++slot)); sinceAd = 0; }
  });
  observeCards(list);
}

/* ---------------------------------------------------------------- my view */
async function renderMy() {
  const list = $('#my-list');
  skeletonList(list, 6);
  $('#my-enabled').checked = Learn.load().enabled;
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
    return;
  }
  // 候補プール: いまの国の主要リストをまとめて読む（キャッシュ済みなら即返る）
  const wanted = [];
  for (const s of SECTIONS) for (const p of ['24h', 'week', 'month']) {
    wanted.push(datasetPath(state.country, s.id, p, 'all'));
  }
  const pools = await Promise.all(wanted.map(p => getJSON(p, { soft: true })));
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
  paintRanking(list, top, { hero: false, why: true });
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

/* -------------------------------------------------------------- tags view */
async function renderTags() {
  const list = $('#tag-list');
  list.replaceChildren();
  const data = await getJSON(`data/tags-${state.country}.json`, { soft: true });
  if (!data || !data.items?.length) {
    const li = el('li'); const box = el('div', 'state');
    box.append(el('p', 'state-title', t('tags.empty')));
    li.append(box); list.append(li); return;
  }
  const max = data.items[0].score || 1;
  data.items.forEach(it => {
    const li = el('li', 'tagrow');
    li.append(el('span', 'tagrank', String(it.rank)));
    li.append(el('span', 'tagterm', it.term));
    const bar = el('span', 'tagbar'); const fill = el('span');
    fill.style.width = `${clamp((it.score / max) * 100, 6, 100)}%`;
    bar.append(fill); li.append(bar);
    li.append(el('span', 'tagcount', t('tags.count', { n: it.count })));
    list.append(li);
  });
}

/* --------------------------------------------------------------- map view */
function project(lat, lon) { return { x: (lon + 180) / 360 * 100, y: (90 - lat) / 180 * 100 }; }

async function renderMap() {
  const wrap = $('#map-wrap');
  wrap.replaceChildren();
  const box = el('div', 'mapbox');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 360 180');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const ns = 'http://www.w3.org/2000/svg';
  const line = (x1, y1, x2, y2, strong) => {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke', 'currentColor');
    l.setAttribute('stroke-width', strong ? 1 : 0.5);
    l.setAttribute('opacity', strong ? 0.5 : 0.25);
    svg.append(l);
  };
  for (let lon = -180; lon <= 180; lon += 30) line(lon + 180, 0, lon + 180, 180, lon === 0);
  for (let lat = -60; lat <= 60; lat += 30) line(0, 90 - lat, 360, 90 - lat, lat === 0);
  box.style.color = 'var(--line-strong)';
  box.append(svg);

  const data = await getJSON('data/map.json', { soft: true });
  if (!data) {
    wrap.append(el('p', 'state-body', t('map.empty')));
    return;
  }
  const known = new Set(COUNTRIES.map(c => c.code));
  const dive = it => {
    if (known.has(it.country)) go({ mode: 'everyone', country: it.country, period: '24h' });
    else window.open(`https://www.youtube.com/shorts/${it.videoId}`.replace('/shorts/', it.isShort ? '/shorts/' : '/watch?v='), '_blank', 'noopener');
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
    b.addEventListener('click', () => dive(it));
    box.append(b);
  });
  wrap.append(box);
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
  if (state.mode === 'everyone') { syncAxes(); await renderEveryone(); }
  else if (state.mode === 'my')  { await renderMy(); }
  else if (state.mode === 'tags'){ await renderTags(); }
  else if (state.mode === 'map') { await renderMap(); }
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
}

let navLock = false;
async function go(patch = {}, { push = true, dir = 0 } = {}) {
  Object.assign(state, patch);
  normalize();
  if (patch.country) LS.set('ytta.country', state.country);
  const h = hashOf();
  if (push && location.hash !== h) { navLock = true; location.hash = h; setTimeout(() => { navLock = false; }, 0); }
  if (dir && !state.reduceMotion) {
    const w = $('#list-wrap');
    w.classList.remove('zap-l', 'zap-r');
    void w.offsetWidth;
    w.classList.add(dir > 0 ? 'zap-l' : 'zap-r');
  }
  await renderCurrentView();
}

window.addEventListener('hashchange', () => {
  if (navLock) return;
  if (readHash()) { normalize(); renderCurrentView(); }
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
  n.textContent = msg; n.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { n.hidden = true; }, 2200);
}

/* --------------------------------------------------------------- settings */
function optionRow(labelKey, options, current, onPick) {
  const g = el('div', 'set-group');
  g.append(el('p', 'set-label', t(labelKey)));
  const row = el('div', 'set-opts');
  options.forEach(o => {
    const b = el('button', 'chip' + (o.id === current ? ' is-active' : ''), o.label);
    b.type = 'button';
    b.addEventListener('click', () => onPick(o.id));
    row.append(b);
  });
  g.append(row);
  return g;
}

function openSettings() {
  const body = $('#sheet-body');
  body.replaceChildren();

  body.append(optionRow('settings.language', LANGUAGES.map(l => ({ id: l.id, label: l.label })), state.lang,
    async id => { await loadLang(id); applyStatic(); buildAxes(); await renderCurrentView(); openSettings(); }));

  body.append(optionRow('settings.theme',
    [['auto', 'settings.theme.auto'], ['light', 'settings.theme.light'], ['dark', 'settings.theme.dark']]
      .map(([id, k]) => ({ id, label: t(k) })), state.themePref,
    id => { setTheme(id); openSettings(); }));

  body.append(optionRow('settings.country',
    COUNTRIES.map(c => ({ id: c.code, label: `${c.flag} ${t('country.' + c.code)}` })), state.country,
    id => { go({ country: id }); openSettings(); }));

  body.append(optionRow('settings.swipeAxis',
    ['period', 'section', 'category', 'country'].map(id => ({ id, label: t('settings.swipeAxis.' + id) })),
    state.swipeAxis,
    id => { state.swipeAxis = id; LS.set('ytta.swipeAxis', id); openSettings(); }));

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
  $('#sheet-close').focus();
}

function closeSettings() {
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
    const codes = COUNTRIES.map(c => c.code);
    go({ country: codes[(codes.indexOf(state.country) + 1) % codes.length] });
  });
  $('#my-enabled').addEventListener('change', e => { Learn.setEnabled(e.target.checked); });
  $('#my-inspect').addEventListener('click', () => {
    const box = $('#my-inspector');
    box.hidden = !box.hidden;
    $('#my-inspect').textContent = t(box.hidden ? 'my.inspector.open' : 'my.inspector.close');
    if (!box.hidden) renderInspector();
  });
  bindSwipe($('#list-wrap'));
  window.addEventListener('online',  () => { state.offline = false; renderCurrentView(); });
  window.addEventListener('offline', () => { state.offline = true;  renderCurrentView(); });
}

function maybeSwipeHint() {
  if (LS.get('ytta.hintSeen', false)) return;
  const hint = el('div', 'hint');
  hint.append(el('span', null, t('hint.swipe')));
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
  if (!location.hash) history.replaceState(null, '', hashOf());
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
