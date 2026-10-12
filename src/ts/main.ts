import { User } from 'firebase/auth';
import { loginWithGoogle, logout, onAuthChange } from './auth';
import { submitFeedback } from './feedback';
import { SAMPLE_GEARS } from './samples';
import {
  createGear, createMany, deleteGear, markReviewed, markUsed, MAX_GEARS, parseTags,
  safeUrl, setPinned, SLOTS, subscribeGears, updateGear,
} from './store';
import { Gear, GearData, Slot } from './types';
import { closeOverlay, iconEl, openOverlay, showToast, textEl } from './ui';

// ============================================================
// 固定アイコン（開発者定義のSVGのみ。ユーザー入力は含めない）
// ============================================================
const svg = (inner: string, size = 18): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const SLOT_PATHS: Record<Slot, string> = {
  weapon: '<path d="M52 8 H56 V12 L28 40 L24 36 Z"/><path d="M16 32 L32 48"/><path d="M22 42 L12 52"/><circle cx="10" cy="54" r="3"/>',
  armor: '<path d="M32 8 L52 15 V30 C52 43 44 51 32 56 C20 51 12 43 12 30 V15 Z"/><path d="M32 18 V46"/><path d="M22 28 H42"/>',
  item: '<path d="M26 8 H38"/><path d="M28 8 V22 L16 46 C14 51 17 56 22 56 H42 C47 56 50 51 48 46 L36 22 V8"/><path d="M19 40 H45"/>',
  tome: '<path d="M10 14 C18 12 26 13 32 18 C38 13 46 12 54 14 V50 C46 48 38 49 32 54 C26 49 18 48 10 50 Z"/><path d="M32 18 V54"/>',
};
const ICON = {
  copy: '<rect x="20" y="20" width="32" height="34" rx="5"/><path d="M14 44 H12 C10 44 8 42 8 40 V14 C8 12 10 10 12 10 H38 C40 10 42 12 42 14 V16"/>',
  link: '<path d="M28 36 C31 40 37 40 40 37 L50 27 C53 24 53 18 50 15 C47 12 41 12 38 15 L34 19"/><path d="M36 28 C33 24 27 24 24 27 L14 37 C11 40 11 46 14 49 C17 52 23 52 26 49 L30 45"/>',
  star: '<path d="M32 8 L39.5 24 L57 26.2 L44.2 38.2 L47.6 55.5 L32 47 L16.4 55.5 L19.8 38.2 L7 26.2 L24.5 24 Z"/>',
  check: '<path d="M14 34 L26 46 L50 20"/>',
  rust: '<circle cx="32" cy="32" r="22"/><path d="M32 20 V34"/><circle cx="32" cy="43" r="1.5" fill="currentColor" stroke="none"/>',
};

const SLOT_LABEL: Record<Slot, string> = { weapon: '武器', armor: '防具', item: '道具', tome: '魔導書' };
const SLOT_DESC: Record<Slot, string> = {
  weapon: '攻めのスキル（フレームワーク・思考法・交渉術）',
  armor: '守りの心得（仕事の原則・失敗の教訓・メンタル）',
  item: 'すぐ使える道具（テンプレ・定型文・フレーズ）',
  tome: '知識の源（ビジネス書・記事・セミナーの学び）',
};
const SLOT_EXAMPLE: Record<Slot, { title: string; copy: string; body: string }> = {
  weapon: { title: '例：PREP法で話す', copy: '例：結論は〜です。理由は〜', body: '例：結論→理由→具体例→結論の順で話す。報告や会議の発言で使う…' },
  armor: { title: '例：悪い報告ほど早く', copy: '', body: '例：トラブルは小さいうちに共有する。隠すほど傷が広がる…' },
  item: { title: '例：日程調整メールの定型文', copy: '例：以下の日程でご都合はいかがでしょうか。', body: '例：候補は3つ以上出す。所要時間も書く…' },
  tome: { title: '例：『イシューからはじめよ』の学び', copy: '', body: '例：解く前に、本当に解くべき問いかを見極める…' },
};

const slotIcon = (slot: Slot, size = 18): string => svg(SLOT_PATHS[slot], size);

// ============================================================
// 熟練度・さび・ランク
// ============================================================
const MAX_LEVEL = 10;
const DAY = 24 * 60 * 60 * 1000;
const RUST_DAYS = 90;
const HEAVY_RUST_DAYS = 180;

/** Lv n に必要な使用回数は n(n-1)/2（Lv2=1回, Lv3=3回, Lv5=10回, Lv10=45回） */
function levelOf(useCount: number): number {
  let lv = 1;
  while (lv < MAX_LEVEL && useCount >= ((lv + 1) * lv) / 2) lv += 1;
  return lv;
}

function usesToNext(useCount: number): number {
  const lv = levelOf(useCount);
  return lv >= MAX_LEVEL ? 0 : ((lv + 1) * lv) / 2 - useCount;
}

type Rust = 'none' | 'rusty' | 'heavy';
function rustOf(g: Gear, now = Date.now()): Rust {
  const days = (now - g.reviewedAt) / DAY;
  if (days >= HEAVY_RUST_DAYS) return 'heavy';
  if (days >= RUST_DAYS) return 'rusty';
  return 'none';
}
const RUST_LABEL: Record<Rust, string> = { none: '', rusty: 'さびてきた', heavy: 'さびついた' };

function rankOf(totalLevel: number): string {
  if (totalLevel >= 80) return '伝説の戦士';
  if (totalLevel >= 40) return '歴戦の戦士';
  if (totalLevel >= 15) return '一人前の戦士';
  return '見習い戦士';
}

function daysAgo(ms: number): string {
  if (!ms) return 'まだ';
  const d = Math.floor((Date.now() - ms) / DAY);
  if (d <= 0) return '今日';
  if (d === 1) return '昨日';
  return `${d}日前`;
}

function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ============================================================
// パスワードらしき入力の検出（保存前に注意する）
// ============================================================
const SECRET_PATTERN = /(パスワード|ﾊﾟｽﾜｰﾄﾞ|password|passwd|pass|pwd|pw|暗証番号|pin|秘密鍵|api\s*key|token)\s*[:：=＝]\s*\S+/i;
const looksSecret = (...texts: string[]): boolean => texts.some((t) => SECRET_PATTERN.test(t));

// ============================================================
// DOM
// ============================================================
function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

const els = {
  login: $('login-screen'),
  app: $('app'),
  btnLogin: $<HTMLButtonElement>('btn-google-login'),
  btnLogout: $<HTMLButtonElement>('btn-logout'),
  userInfo: $('user-info'),
  userAvatar: $<HTMLImageElement>('user-avatar'),
  userName: $('user-name'),
  tabs: Array.from(document.querySelectorAll<HTMLButtonElement>('.tabs__btn')),
  views: Array.from(document.querySelectorAll<HTMLElement>('.view')),
  // ポーチ
  search: $<HTMLInputElement>('input-search'),
  slotBar: $('slot-bar'),
  sort: $<HTMLSelectElement>('select-sort'),
  summary: $('summary'),
  loading: $('loading'),
  list: $('gear-list'),
  emptyFirst: $('empty-first'),
  emptyMatch: $('empty-match'),
  // 点検
  checkDate: $('check-date'),
  checkProgress: $('check-progress'),
  checkBar: $<HTMLElement>('check-bar-fill'),
  checkList: $('check-list'),
  checkEmpty: $('check-empty'),
  checkDone: $('check-done'),
  btnCheckReset: $<HTMLButtonElement>('btn-check-reset'),
  // ステータス
  statusRank: $('status-rank'),
  statusTotal: $('status-total'),
  statusLevel: $('status-level'),
  statusSlots: $('status-slots'),
  statusAdvice: $('status-advice'),
  statusRusty: $('status-rusty'),
  statusRustyEmpty: $('status-rusty-empty'),
  // 詳細
  detailOverlay: $('detail-overlay'),
  detailSlot: $('detail-slot'),
  detailTitle: $('detail-title'),
  detailMeta: $('detail-meta'),
  detailLevel: $('detail-level'),
  detailRust: $('detail-rust'),
  detailCopyRow: $('detail-copy-row'),
  detailCopyText: $('detail-copy-text'),
  detailUrlRow: $('detail-url-row'),
  detailUrl: $<HTMLAnchorElement>('detail-url'),
  detailBodySection: $('detail-body-section'),
  detailBody: $('detail-body'),
  detailTags: $('detail-tags'),
  btnDetailCopy: $<HTMLButtonElement>('btn-detail-copy'),
  btnDetailUsed: $<HTMLButtonElement>('btn-detail-used'),
  btnDetailReview: $<HTMLButtonElement>('btn-detail-review'),
  btnDetailPin: $<HTMLButtonElement>('btn-detail-pin'),
  btnDetailEdit: $<HTMLButtonElement>('btn-detail-edit'),
  btnDetailDelete: $<HTMLButtonElement>('btn-detail-delete'),
  // 編集
  editorOverlay: $('editor-overlay'),
  editorForm: $<HTMLFormElement>('editor-form'),
  editorTitle: $('editor-title'),
  editorSlot: $('editor-slot'),
  editorSlotDesc: $('editor-slot-desc'),
  inputTitle: $<HTMLInputElement>('input-title'),
  inputCopy: $<HTMLInputElement>('input-copy'),
  inputUrl: $<HTMLInputElement>('input-url'),
  inputBody: $<HTMLTextAreaElement>('input-body'),
  inputTags: $<HTMLInputElement>('input-tags'),
  inputPinned: $<HTMLInputElement>('input-pinned'),
  secretWarning: $('secret-warning'),
  btnEditorSave: $<HTMLButtonElement>('btn-editor-save'),
  // ダイアログ
  secretOverlay: $('secret-dialog-overlay'),
  discardOverlay: $('discard-dialog-overlay'),
  confirmOverlay: $('confirm-dialog-overlay'),
  confirmText: $('confirm-dialog-text'),
  btnConfirmDelete: $<HTMLButtonElement>('btn-confirm-delete'),
  feedbackOverlay: $('feedback-modal-overlay'),
  feedbackMessage: $<HTMLTextAreaElement>('input-feedback-message'),
  btnFeedbackSend: $<HTMLButtonElement>('btn-feedback-send'),
};

// ============================================================
// 状態
// ============================================================
type View = 'pouch' | 'check' | 'status';
type Filter = 'all' | 'pinned' | Slot;
type SortKey = 'use' | 'recent' | 'new' | 'rust' | 'name';

const state = {
  uid: '',
  gears: [] as Gear[],
  loaded: false,
  view: 'pouch' as View,
  filter: 'all' as Filter,
  query: '',
  sort: 'use' as SortKey,
  detailId: '',
  editingId: '', // '' は新規
  editorSlot: 'item' as Slot,
  editorSnapshot: '',
  deleteId: '',
  busy: false,
  unsubscribe: null as (() => void) | null,
};

const findGear = (id: string): Gear | undefined => state.gears.find((g) => g.id === id);

// ============================================================
// 出陣前点検（チェック状態は端末内に日付ごとに保存）
// ============================================================
const checkKey = (): string => `shutsujin-check:${state.uid}:${todayKey()}`;

function loadChecked(): string[] {
  try {
    const raw = localStorage.getItem(checkKey());
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveChecked(ids: string[]): void {
  try {
    localStorage.setItem(checkKey(), JSON.stringify(ids));
  } catch {
    // 保存できない環境（プライベートモード等）では、この画面を開いている間だけ有効
  }
}

let checkedMemory: string[] = [];

// ============================================================
// 操作
// ============================================================
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function useGear(g: Gear): void {
  const before = levelOf(g.useCount);
  markUsed(state.uid, g.id)
    .then(() => {
      if (levelOf(g.useCount + 1) > before) showToast(`「${g.title}」の熟練度が Lv${before + 1} に上がった！`);
    })
    .catch(() => showToast('熟練度を記録できませんでした'));
}

async function copyGear(g: Gear): Promise<void> {
  if (!g.copyText) return;
  const ok = await copyToClipboard(g.copyText);
  if (!ok) {
    showToast('コピーできませんでした');
    return;
  }
  showToast('コピーしました');
  useGear(g);
}

function openGearUrl(g: Gear): void {
  if (!g.url) return;
  useGear(g);
}

async function togglePin(g: Gear): Promise<void> {
  try {
    await setPinned(state.uid, g.id, !g.pinned);
    showToast(g.pinned ? '装備を外しました' : '装備しました（出陣前点検に並びます）');
  } catch {
    showToast('保存できませんでした。通信状況を確認してください');
  }
}

// ============================================================
// 描画：共通パーツ
// ============================================================
function slotChip(slot: Slot): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `slot-chip slot-chip--${slot}`;
  chip.appendChild(iconEl(slotIcon(slot, 14), 'slot-chip__icon'));
  chip.appendChild(document.createTextNode(SLOT_LABEL[slot]));
  return chip;
}

function levelBadge(g: Gear): HTMLElement {
  const lv = levelOf(g.useCount);
  return textEl('span', `lv-badge${lv >= MAX_LEVEL ? ' is-max' : ''}`, lv >= MAX_LEVEL ? 'Lv10 極' : `Lv${lv}`);
}

function iconButton(icon: string, label: string, className: string, onClick: (e: Event) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.appendChild(iconEl(svg(icon, 16), 'icon-btn__icon'));
  b.appendChild(textEl('span', 'icon-btn__label', label));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return b;
}

// ============================================================
// 描画：ポーチ（一覧）
// ============================================================
function renderSlotBar(): void {
  const counts: Record<string, number> = { all: state.gears.length, pinned: state.gears.filter((g) => g.pinned).length };
  SLOTS.forEach((s) => (counts[s] = state.gears.filter((g) => g.slot === s).length));
  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'すべて' },
    ...SLOTS.map((s) => ({ key: s as Filter, label: SLOT_LABEL[s] })),
    { key: 'pinned', label: '装備中' },
  ];
  els.slotBar.replaceChildren(
    ...filters.map(({ key, label }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `filter-chip${state.filter === key ? ' is-active' : ''}`;
      b.setAttribute('aria-pressed', String(state.filter === key));
      if (key !== 'all' && key !== 'pinned') b.appendChild(iconEl(slotIcon(key, 14), 'filter-chip__icon'));
      if (key === 'pinned') b.appendChild(iconEl(svg(ICON.star, 14), 'filter-chip__icon'));
      b.appendChild(document.createTextNode(label));
      b.appendChild(textEl('span', 'filter-chip__count', String(counts[key])));
      b.addEventListener('click', () => {
        state.filter = key;
        render();
      });
      return b;
    }),
  );
}

function visibleGears(): Gear[] {
  const q = state.query.trim().toLowerCase();
  const list = state.gears.filter((g) => {
    if (state.filter === 'pinned' && !g.pinned) return false;
    if (state.filter !== 'all' && state.filter !== 'pinned' && g.slot !== state.filter) return false;
    if (!q) return true;
    return [g.title, g.copyText, g.body, g.url, ...g.tags].some((t) => t.toLowerCase().includes(q));
  });
  const byName = (a: Gear, b: Gear) => a.title.localeCompare(b.title, 'ja');
  const sorters: Record<SortKey, (a: Gear, b: Gear) => number> = {
    use: (a, b) => Number(b.pinned) - Number(a.pinned) || b.useCount - a.useCount || b.lastUsedAt - a.lastUsedAt || byName(a, b),
    recent: (a, b) => b.lastUsedAt - a.lastUsedAt || b.createdAt - a.createdAt,
    new: (a, b) => b.createdAt - a.createdAt,
    rust: (a, b) => a.reviewedAt - b.reviewedAt,
    name: byName,
  };
  return list.sort(sorters[state.sort]);
}

function gearCard(g: Gear): HTMLElement {
  const li = document.createElement('li');
  li.className = `gear-card gear-card--${g.slot}`;

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'gear-card__main';
  main.setAttribute('aria-label', `${g.title}の詳細を開く`);
  main.addEventListener('click', () => openDetail(g.id));

  main.appendChild(iconEl(slotIcon(g.slot, 26), 'gear-card__icon'));
  const info = document.createElement('div');
  info.className = 'gear-card__info';

  const top = document.createElement('div');
  top.className = 'gear-card__top';
  top.appendChild(textEl('span', 'gear-card__slot', SLOT_LABEL[g.slot]));
  top.appendChild(levelBadge(g));
  if (g.pinned) top.appendChild(textEl('span', 'pin-badge', '装備中'));
  const rust = rustOf(g);
  if (rust !== 'none') top.appendChild(textEl('span', `rust-badge rust-badge--${rust}`, RUST_LABEL[rust]));
  info.appendChild(top);

  info.appendChild(textEl('p', 'gear-card__title', g.title));
  if (g.copyText) info.appendChild(textEl('p', 'gear-card__copy', g.copyText));
  else if (g.body) info.appendChild(textEl('p', 'gear-card__body', g.body.replace(/\s+/g, ' ')));
  if (g.tags.length) {
    const tags = document.createElement('div');
    tags.className = 'tag-list';
    g.tags.forEach((t) => tags.appendChild(textEl('span', 'tag', `#${t}`)));
    info.appendChild(tags);
  }
  main.appendChild(info);
  li.appendChild(main);

  const actions = document.createElement('div');
  actions.className = 'gear-card__actions';
  if (g.copyText) actions.appendChild(iconButton(ICON.copy, 'コピー', 'icon-btn', () => void copyGear(g)));
  if (g.url) {
    const a = document.createElement('a');
    a.className = 'icon-btn';
    a.href = g.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = '開く';
    a.appendChild(iconEl(svg(ICON.link, 16), 'icon-btn__icon'));
    a.appendChild(textEl('span', 'icon-btn__label', '開く'));
    a.addEventListener('click', () => openGearUrl(g));
    actions.appendChild(a);
  }
  const pin = iconButton(ICON.star, g.pinned ? '外す' : '装備', `icon-btn icon-btn--pin${g.pinned ? ' is-on' : ''}`, () => void togglePin(g));
  pin.setAttribute('aria-pressed', String(g.pinned));
  actions.appendChild(pin);
  li.appendChild(actions);
  return li;
}

function renderPouch(): void {
  renderSlotBar();
  els.loading.classList.toggle('hidden', state.loaded);
  if (!state.loaded) return;

  const list = visibleGears();
  els.list.replaceChildren(...list.map(gearCard));
  const none = state.gears.length === 0;
  els.emptyFirst.classList.toggle('hidden', !none);
  els.emptyMatch.classList.toggle('hidden', none || list.length > 0);

  const pinned = state.gears.filter((g) => g.pinned).length;
  const rusty = state.gears.filter((g) => rustOf(g) !== 'none').length;
  els.summary.textContent = none
    ? ''
    : `装備 ${state.gears.length}件（装備中 ${pinned}）${rusty ? `・手入れ待ち ${rusty}` : ''}`;
}

// ============================================================
// 描画：出陣前点検
// ============================================================
function renderCheck(): void {
  const d = new Date();
  els.checkDate.textContent = `${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`;
  const pinned = state.gears.filter((g) => g.pinned).sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || b.useCount - a.useCount);
  const ids = new Set(pinned.map((g) => g.id));
  const checked = checkedMemory.filter((id) => ids.has(id));

  els.checkEmpty.classList.toggle('hidden', !state.loaded || pinned.length > 0);
  els.checkList.replaceChildren(
    ...pinned.map((g) => {
      const li = document.createElement('li');
      const isChecked = checked.includes(g.id);
      li.className = `check-item${isChecked ? ' is-checked' : ''}`;

      const box = document.createElement('button');
      box.type = 'button';
      box.className = 'check-item__box';
      box.setAttribute('aria-pressed', String(isChecked));
      box.setAttribute('aria-label', `${g.title}を${isChecked ? '未点検に戻す' : '点検済みにする'}`);
      box.appendChild(iconEl(svg(ICON.check, 18), 'check-item__mark'));
      box.addEventListener('click', () => {
        checkedMemory = isChecked ? checkedMemory.filter((id) => id !== g.id) : [...checkedMemory, g.id];
        saveChecked(checkedMemory);
        renderCheck();
      });
      li.appendChild(box);

      const body = document.createElement('button');
      body.type = 'button';
      body.className = 'check-item__body';
      body.addEventListener('click', () => openDetail(g.id));
      body.appendChild(slotChip(g.slot));
      body.appendChild(textEl('span', 'check-item__title', g.title));
      if (g.copyText) body.appendChild(textEl('span', 'check-item__sub', g.copyText));
      else if (g.body) body.appendChild(textEl('span', 'check-item__sub', g.body.replace(/\s+/g, ' ')));
      li.appendChild(body);
      return li;
    }),
  );

  const total = pinned.length;
  const done = checked.length;
  els.checkProgress.textContent = total ? `${done} / ${total}` : '';
  els.checkBar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  els.checkDone.classList.toggle('hidden', !(total > 0 && done === total));
  els.btnCheckReset.classList.toggle('hidden', done === 0);
}

// ============================================================
// 描画：ステータス
// ============================================================
function renderStatus(): void {
  const gears = state.gears;
  const totalLevel = gears.reduce((s, g) => s + levelOf(g.useCount), 0);
  els.statusRank.textContent = rankOf(totalLevel);
  els.statusTotal.textContent = String(gears.length);
  els.statusLevel.textContent = String(totalLevel);

  const counts = SLOTS.map((s) => gears.filter((g) => g.slot === s));
  const maxCount = Math.max(1, ...counts.map((c) => c.length));
  els.statusSlots.replaceChildren(
    ...SLOTS.map((slot, i) => {
      const list = counts[i];
      const lv = list.reduce((s, g) => s + levelOf(g.useCount), 0);
      const row = document.createElement('li');
      row.className = `stat-row stat-row--${slot}`;
      const head = document.createElement('div');
      head.className = 'stat-row__head';
      head.appendChild(slotChip(slot));
      head.appendChild(textEl('span', 'stat-row__desc', SLOT_DESC[slot]));
      row.appendChild(head);
      const bar = document.createElement('div');
      bar.className = 'stat-row__bar';
      const fill = document.createElement('span');
      fill.className = 'stat-row__fill';
      fill.style.width = `${Math.round((list.length / maxCount) * 100)}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(textEl('span', 'stat-row__num', `${list.length}件・熟練度合計 Lv${lv}`));
      return row;
    }),
  );

  // 手薄な枠のアドバイス
  let advice = '';
  if (gears.length === 0) {
    advice = 'まずはポーチに装備を1つ入れてみましょう。最近読んだビジネス書の学びや、よく使うフレームワークがおすすめです。';
  } else {
    const minCount = Math.min(...counts.map((c) => c.length));
    const weak = SLOTS.filter((_, i) => counts[i].length === minCount);
    const tips: Record<Slot, string> = {
      weapon: 'ロジカルシンキング・交渉術・プレゼンの型など、仕事を前に進める「武器」を足しましょう。',
      armor: '仕事の原則・失敗から学んだ教訓・ストレスとの付き合い方など、自分を守る「防具」を足しましょう。',
      item: 'メールの定型文・会議で使える質問・資料のテンプレなど、すぐ取り出せる「道具」を足しましょう。',
      tome: 'ビジネス書・記事・セミナーで得た学びなど、知識の源になる「魔導書」を足しましょう。',
    };
    advice = minCount === maxCount ? '4つの枠がバランスよくそろっています。この調子で使い込んで熟練度を上げましょう。' : `手薄な枠：${weak.map((s) => SLOT_LABEL[s]).join('・')}。${tips[weak[0]]}`;
  }
  els.statusAdvice.textContent = advice;

  const rusty = gears.filter((g) => rustOf(g) !== 'none').sort((a, b) => a.reviewedAt - b.reviewedAt);
  els.statusRustyEmpty.classList.toggle('hidden', rusty.length > 0);
  els.statusRusty.replaceChildren(
    ...rusty.slice(0, 20).map((g) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rust-item';
      b.addEventListener('click', () => openDetail(g.id));
      b.appendChild(slotChip(g.slot));
      b.appendChild(textEl('span', 'rust-item__title', g.title));
      const r = rustOf(g);
      b.appendChild(textEl('span', `rust-badge rust-badge--${r}`, `${RUST_LABEL[r]}（${daysAgo(g.reviewedAt)}）`));
      li.appendChild(b);
      return li;
    }),
  );
}

function renderDetail(): void {
  if (!state.detailId) return;
  const g = findGear(state.detailId);
  if (!g) {
    closeOverlay(els.detailOverlay);
    state.detailId = '';
    return;
  }
  els.detailSlot.replaceChildren(slotChip(g.slot));
  els.detailTitle.textContent = g.title;
  els.detailMeta.textContent = `使った回数 ${g.useCount}回・最後に使った日 ${daysAgo(g.lastUsedAt)}・最後の手入れ ${daysAgo(g.reviewedAt)}`;

  const lv = levelOf(g.useCount);
  const next = usesToNext(g.useCount);
  els.detailLevel.replaceChildren(
    levelBadge(g),
    textEl('span', 'detail__level-text', lv >= MAX_LEVEL ? '使いこなしています。熟練度は最大です' : `あと${next}回使うと Lv${lv + 1}`),
  );

  const rust = rustOf(g);
  els.detailRust.classList.toggle('hidden', rust === 'none');
  els.detailRust.textContent = rust === 'none' ? '' : `${RUST_LABEL[rust]}：${daysAgo(g.reviewedAt)}から見直していません。内容を読み返して身についているか確かめ、「手入れした」を押しましょう。`;

  els.detailCopyRow.classList.toggle('hidden', !g.copyText);
  els.detailCopyText.textContent = g.copyText;

  const url = safeUrl(g.url);
  els.detailUrlRow.classList.toggle('hidden', !url);
  els.detailUrl.href = url || '#';
  els.detailUrl.textContent = url;

  els.detailBodySection.classList.toggle('hidden', !g.body);
  els.detailBody.textContent = g.body;
  els.detailTags.replaceChildren(...g.tags.map((t) => textEl('span', 'tag', `#${t}`)));

  els.btnDetailPin.textContent = g.pinned ? '装備を外す' : '装備する';
  els.btnDetailPin.classList.toggle('is-on', g.pinned);
}

function render(): void {
  els.tabs.forEach((t) => {
    const on = t.dataset.view === state.view;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  });
  els.views.forEach((v) => v.classList.toggle('hidden', v.dataset.view !== state.view));
  if (state.view === 'pouch') renderPouch();
  if (state.view === 'check') renderCheck();
  if (state.view === 'status') renderStatus();
  renderDetail();
}

// ============================================================
// 詳細
// ============================================================
function openDetail(id: string): void {
  state.detailId = id;
  renderDetail();
  openOverlay(els.detailOverlay);
}

function closeDetail(): void {
  state.detailId = '';
  closeOverlay(els.detailOverlay);
}

// ============================================================
// 編集
// ============================================================
function readEditor(): GearData {
  return {
    slot: state.editorSlot,
    title: els.inputTitle.value,
    copyText: els.inputCopy.value,
    url: els.inputUrl.value.trim(),
    body: els.inputBody.value,
    tags: parseTags(els.inputTags.value),
    pinned: els.inputPinned.checked,
  };
}

function renderEditorSlot(): void {
  els.editorSlot.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) => {
    const on = b.dataset.slot === state.editorSlot;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  els.editorSlotDesc.textContent = SLOT_DESC[state.editorSlot];
  const ex = SLOT_EXAMPLE[state.editorSlot];
  els.inputTitle.placeholder = ex.title;
  els.inputCopy.placeholder = ex.copy || '例：よく使う定型文';
  els.inputBody.placeholder = ex.body;
}

function updateSecretWarning(): void {
  els.secretWarning.classList.toggle('hidden', !looksSecret(els.inputTitle.value, els.inputCopy.value, els.inputBody.value));
}

function openEditor(id = ''): void {
  const g = id ? findGear(id) : undefined;
  state.editingId = g ? g.id : '';
  els.editorTitle.textContent = g ? '装備を編集' : '装備をポーチに入れる';
  state.editorSlot = g ? g.slot : state.filter !== 'all' && state.filter !== 'pinned' ? state.filter : 'item';
  els.inputTitle.value = g ? g.title : '';
  els.inputCopy.value = g ? g.copyText : '';
  els.inputUrl.value = g ? g.url : '';
  els.inputBody.value = g ? g.body : '';
  els.inputTags.value = g ? g.tags.join(', ') : '';
  els.inputPinned.checked = g ? g.pinned : false;
  els.inputTitle.classList.remove('is-invalid');
  els.inputUrl.classList.remove('is-invalid');
  renderEditorSlot();
  updateSecretWarning();
  state.editorSnapshot = JSON.stringify(readEditor());
  openOverlay(els.editorOverlay);
  window.setTimeout(() => els.inputTitle.focus(), 50);
}

function requestCloseEditor(): void {
  if (JSON.stringify(readEditor()) !== state.editorSnapshot) {
    openOverlay(els.discardOverlay);
    return;
  }
  closeOverlay(els.editorOverlay);
}

function validateEditor(): GearData | null {
  const data = readEditor();
  let ok = true;
  els.inputTitle.classList.toggle('is-invalid', !data.title.trim());
  if (!data.title.trim()) {
    showToast('名前を入力してください');
    ok = false;
  }
  const badUrl = data.url !== '' && !safeUrl(data.url);
  els.inputUrl.classList.toggle('is-invalid', badUrl);
  if (ok && badUrl) {
    showToast('URLは http:// または https:// で始まる形で入力してください');
    ok = false;
  }
  if (!ok) return null;
  return data;
}

async function saveEditor(data: GearData): Promise<void> {
  if (state.busy) return;
  if (!state.editingId && state.gears.length >= MAX_GEARS) {
    showToast(`装備は${MAX_GEARS}件までです`);
    return;
  }
  state.busy = true;
  els.btnEditorSave.disabled = true;
  try {
    if (state.editingId) {
      await updateGear(state.uid, state.editingId, data);
      showToast('装備を手入れしました');
    } else {
      await createGear(state.uid, data);
      showToast('ポーチに入れました');
    }
    closeOverlay(els.editorOverlay);
  } catch {
    showToast('保存できませんでした。通信状況を確認してください');
  } finally {
    state.busy = false;
    els.btnEditorSave.disabled = false;
  }
}

let pendingSave: GearData | null = null;

// ============================================================
// イベント
// ============================================================
els.btnLogin.addEventListener('click', () => {
  els.btnLogin.disabled = true;
  loginWithGoogle()
    .catch((e: { code?: string }) => {
      if (e && e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        showToast('ログインできませんでした。もう一度お試しください');
      }
    })
    .finally(() => (els.btnLogin.disabled = false));
});

els.btnLogout.addEventListener('click', () => {
  logout().catch(() => showToast('ログアウトできませんでした'));
});

els.tabs.forEach((t) =>
  t.addEventListener('click', () => {
    state.view = (t.dataset.view as View) || 'pouch';
    if (state.view === 'check') checkedMemory = loadChecked();
    render();
    window.scrollTo({ top: 0 });
  }),
);

els.search.addEventListener('input', () => {
  state.query = els.search.value;
  renderPouch();
});
els.sort.addEventListener('change', () => {
  state.sort = els.sort.value as SortKey;
  renderPouch();
});

$('btn-fab').addEventListener('click', () => openEditor());
$('btn-empty-new').addEventListener('click', () => openEditor());
$('btn-check-go').addEventListener('click', () => {
  state.view = 'pouch';
  render();
});
$('btn-clear-filter').addEventListener('click', () => {
  state.filter = 'all';
  state.query = '';
  els.search.value = '';
  renderPouch();
});

const btnSamples = $<HTMLButtonElement>('btn-add-samples');
btnSamples.addEventListener('click', async () => {
  if (state.busy) return;
  state.busy = true;
  btnSamples.disabled = true;
  try {
    await createMany(state.uid, SAMPLE_GEARS);
    showToast('サンプルの装備を4つ入れました');
  } catch {
    showToast('サンプルを追加できませんでした');
  } finally {
    state.busy = false;
    btnSamples.disabled = false;
  }
});

els.btnCheckReset.addEventListener('click', () => {
  checkedMemory = [];
  saveChecked(checkedMemory);
  renderCheck();
});

// 詳細
$('btn-detail-close').addEventListener('click', closeDetail);
els.btnDetailCopy.addEventListener('click', () => {
  const g = findGear(state.detailId);
  if (g) void copyGear(g);
});
els.detailUrl.addEventListener('click', () => {
  const g = findGear(state.detailId);
  if (g) openGearUrl(g);
});
els.btnDetailUsed.addEventListener('click', () => {
  const g = findGear(state.detailId);
  if (!g) return;
  useGear(g);
  showToast('使った記録をつけました');
});
els.btnDetailReview.addEventListener('click', async () => {
  const g = findGear(state.detailId);
  if (!g || state.busy) return;
  state.busy = true;
  els.btnDetailReview.disabled = true;
  try {
    await markReviewed(state.uid, g.id);
    showToast('手入れしました。ピカピカです');
  } catch {
    showToast('保存できませんでした');
  } finally {
    state.busy = false;
    els.btnDetailReview.disabled = false;
  }
});
els.btnDetailPin.addEventListener('click', () => {
  const g = findGear(state.detailId);
  if (g) void togglePin(g);
});
els.btnDetailEdit.addEventListener('click', () => {
  const id = state.detailId;
  closeDetail();
  openEditor(id);
});
els.btnDetailDelete.addEventListener('click', () => {
  const g = findGear(state.detailId);
  if (!g) return;
  state.deleteId = g.id;
  els.confirmText.textContent = `「${g.title}」をポーチから削除します。削除すると元に戻せません。`;
  openOverlay(els.confirmOverlay);
});

// 削除確認
$('btn-confirm-cancel').addEventListener('click', () => closeOverlay(els.confirmOverlay));
els.btnConfirmDelete.addEventListener('click', async () => {
  if (!state.deleteId || state.busy) return;
  state.busy = true;
  els.btnConfirmDelete.disabled = true;
  try {
    await deleteGear(state.uid, state.deleteId);
    closeOverlay(els.confirmOverlay);
    closeDetail();
    showToast('削除しました');
  } catch {
    showToast('削除できませんでした');
  } finally {
    state.deleteId = '';
    state.busy = false;
    els.btnConfirmDelete.disabled = false;
  }
});

// 編集フォーム
els.editorSlot.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) =>
  b.addEventListener('click', () => {
    state.editorSlot = b.dataset.slot as Slot;
    renderEditorSlot();
  }),
);
[els.inputTitle, els.inputCopy, els.inputBody].forEach((el) => el.addEventListener('input', updateSecretWarning));
$('btn-editor-close').addEventListener('click', requestCloseEditor);
$('btn-editor-cancel').addEventListener('click', requestCloseEditor);
els.editorForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = validateEditor();
  if (!data) return;
  if (looksSecret(data.title, data.copyText, data.body)) {
    pendingSave = data;
    openOverlay(els.secretOverlay);
    return;
  }
  void saveEditor(data);
});

// パスワード警告
$('btn-secret-back').addEventListener('click', () => {
  pendingSave = null;
  closeOverlay(els.secretOverlay);
  els.inputBody.focus();
});
$('btn-secret-save').addEventListener('click', () => {
  closeOverlay(els.secretOverlay);
  if (pendingSave) void saveEditor(pendingSave);
  pendingSave = null;
});

// 破棄確認
$('btn-discard-cancel').addEventListener('click', () => closeOverlay(els.discardOverlay));
$('btn-discard-ok').addEventListener('click', () => {
  closeOverlay(els.discardOverlay);
  closeOverlay(els.editorOverlay);
});

// フィードバック
$('feedback-btn').addEventListener('click', () => {
  openOverlay(els.feedbackOverlay);
  window.setTimeout(() => els.feedbackMessage.focus(), 50);
});
$('btn-feedback-close').addEventListener('click', () => closeOverlay(els.feedbackOverlay));
els.btnFeedbackSend.addEventListener('click', async () => {
  const message = els.feedbackMessage.value.trim();
  if (!message) {
    showToast('内容を入力してください');
    return;
  }
  if (els.btnFeedbackSend.disabled) return;
  els.btnFeedbackSend.disabled = true;
  const ok = await submitFeedback(message);
  els.btnFeedbackSend.disabled = false;
  if (ok) {
    els.feedbackMessage.value = '';
    closeOverlay(els.feedbackOverlay);
    showToast('送信しました。ありがとうございます');
  } else {
    showToast('送信できませんでした。時間をおいてお試しください');
  }
});

// 背景クリック・Escで閉じる（編集中は破棄確認を挟む）
const overlayClosers: [HTMLElement, () => void][] = [
  [els.detailOverlay, closeDetail],
  [els.editorOverlay, requestCloseEditor],
  [els.feedbackOverlay, () => closeOverlay(els.feedbackOverlay)],
  [els.confirmOverlay, () => closeOverlay(els.confirmOverlay)],
  [els.discardOverlay, () => closeOverlay(els.discardOverlay)],
  [els.secretOverlay, () => closeOverlay(els.secretOverlay)],
];
overlayClosers.forEach(([overlay, close]) =>
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  }),
);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // 手前に重なるダイアログから順に閉じる
  const order = [els.secretOverlay, els.discardOverlay, els.confirmOverlay, els.feedbackOverlay, els.editorOverlay, els.detailOverlay];
  const top = order.find((o) => o.classList.contains('is-open'));
  const entry = overlayClosers.find(([o]) => o === top);
  if (entry) entry[1]();
});

// ============================================================
// 認証
// ============================================================
onAuthChange((user: User | null) => {
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }
  [els.detailOverlay, els.editorOverlay, els.confirmOverlay, els.discardOverlay, els.secretOverlay].forEach(closeOverlay);

  if (!user) {
    state.uid = '';
    state.gears = [];
    state.loaded = false;
    els.app.classList.add('hidden');
    els.login.classList.remove('hidden');
    els.userInfo.classList.add('hidden');
    return;
  }

  state.uid = user.uid;
  state.loaded = false;
  checkedMemory = loadChecked();
  els.login.classList.add('hidden');
  els.app.classList.remove('hidden');
  els.userInfo.classList.remove('hidden');
  els.userName.textContent = user.displayName || '';
  if (user.photoURL && safeUrl(user.photoURL)) {
    els.userAvatar.src = user.photoURL;
    els.userAvatar.classList.remove('hidden');
  } else {
    els.userAvatar.classList.add('hidden');
  }
  render();

  state.unsubscribe = subscribeGears(
    user.uid,
    (gears) => {
      state.gears = gears;
      state.loaded = true;
      render();
    },
    () => {
      state.loaded = true;
      render();
      showToast('データを読み込めませんでした。再読み込みしてください');
    },
  );
});
