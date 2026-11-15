// 出陣ビルドの画面部分（index.html の data-view="build" と #build-overlay とセットで動く）。
// ユーザー入力（装備名・タグ・ビルド名）は textContent / value だけで表示する。
import { Gear, Slot } from './types';
import { SLOTS } from './store';
import {
  Build, GearIds, MAX_BUILDS, MAX_BUILD_NAME, SYNERGY_TEXT, analyze, createBuild, deleteBuild, emptyGearIds,
  randomIds, sortieBuild, subscribeBuilds, synergyGrade, updateBuild,
} from './builds';
import { RARITY, rarityLabelText } from './wakuwaku';

export interface BuildDeps {
  getUid: () => string;
  getGears: () => Gear[];
  slotLabel: Record<Slot, string>;
  slotIcon: (slot: Slot, size?: number) => string;
  levelOf: (useCount: number) => number;
  isRusty: (g: Gear) => boolean;
  showToast: (message: string) => void;
  openOverlay: (el: HTMLElement) => void;
  closeOverlay: (el: HTMLElement) => void;
  /** 出陣後に出陣前点検の画面へ移る */
  goCheck: () => void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

function el(tag: string, className = '', text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function initBuilds(deps: BuildDeps): { setUser: (uid: string | null) => void; render: () => void } {
  const listEl = $('build-list');
  const emptyEl = $('build-empty');
  const summaryEl = $('build-summary');
  const overlay = $('build-overlay');
  const form = $<HTMLFormElement>('build-form');
  const titleEl = $('build-editor-title');
  const nameInput = $<HTMLInputElement>('build-name');
  const slotsWrap = $('build-slots');
  const previewEl = $('build-preview');
  const oddsEl = $('build-odds');
  const confirmOverlay = $('build-confirm-overlay');
  const confirmText = $('build-confirm-text');

  let builds: Build[] = [];
  let unsubscribe: (() => void) | null = null;
  let editingId = '';
  let deleteId = '';
  let busy = false;
  const selects = new Map<Slot, HTMLSelectElement>();

  // ---- 編集フォームの枠（装備を選ぶ） ----
  for (const slot of SLOTS) {
    const row = el('div', `build-slot build-slot--${slot}`);
    const label = document.createElement('label');
    label.className = 'build-slot__label';
    const ic = el('span', 'build-slot__icon');
    ic.innerHTML = deps.slotIcon(slot, 20); // 固定SVG（ユーザー入力は含まない）
    label.append(ic, document.createTextNode(deps.slotLabel[slot]));
    const select = document.createElement('select');
    select.className = 'build-slot__select';
    select.id = `build-slot-${slot}`;
    label.htmlFor = select.id;
    select.addEventListener('change', updatePreview);
    selects.set(slot, select);
    row.append(label, select);
    slotsWrap.append(row);
  }

  function fillOptions(): void {
    const gears = deps.getGears();
    for (const slot of SLOTS) {
      const select = selects.get(slot)!;
      const keep = select.value;
      select.textContent = '';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '（空き）';
      select.append(none);
      const pool = gears
        .filter((g) => g.slot === slot)
        .sort((a, b) => deps.levelOf(b.useCount) - deps.levelOf(a.useCount) || a.title.localeCompare(b.title, 'ja'));
      for (const g of pool) {
        const o = document.createElement('option');
        o.value = g.id;
        o.textContent = `${g.title}（Lv${deps.levelOf(g.useCount)}）`;
        select.append(o);
      }
      select.value = pool.some((g) => g.id === keep) ? keep : '';
    }
  }

  function currentIds(): GearIds {
    const ids = emptyGearIds();
    for (const slot of SLOTS) ids[slot] = selects.get(slot)!.value;
    return ids;
  }

  function setIds(ids: GearIds): void {
    for (const slot of SLOTS) selects.get(slot)!.value = ids[slot];
    updatePreview();
  }

  function describe(ids: GearIds): HTMLElement {
    const a = analyze(ids, deps.getGears(), deps.levelOf, deps.isRusty);
    const wrap = el('div', 'build-info');
    const grade = synergyGrade(a);
    wrap.append(el('span', `build-pill build-pill--${grade}`, SYNERGY_TEXT[grade]));
    wrap.append(el('span', 'build-pill', `ビルドパワー ${a.power}`));
    if (a.full) wrap.append(el('span', 'build-pill build-pill--full', 'フル装備'));
    if (a.rustCount > 0) wrap.append(el('span', 'build-pill build-pill--rust', `さび ${a.rustCount}`));
    if (a.sharedTags.length > 0) {
      const tags = el('div', 'build-tags');
      tags.append(el('span', 'build-tags__label', '共通のタグ'));
      for (const t of a.sharedTags.slice(0, 5)) tags.append(el('span', 'build-tag', `#${t}`));
      wrap.append(tags);
    } else if (a.gears.length >= 2) {
      wrap.append(el('p', 'build-hint', '装備に同じタグをつけると、相性が上がります。'));
    }
    return wrap;
  }

  function updatePreview(): void {
    previewEl.textContent = '';
    previewEl.append(describe(currentIds()));
  }

  // ---- 一覧 ----
  function render(): void {
    const gears = deps.getGears();
    summaryEl.textContent = builds.length > 0
      ? `${builds.length}個のビルド。出陣すると、そのビルドの装備だけが「装備中」になります。`
      : '';
    listEl.textContent = '';
    emptyEl.classList.toggle('hidden', builds.length > 0);
    $('btn-build-new').toggleAttribute('disabled', gears.length === 0);
    $('btn-build-random').toggleAttribute('disabled', gears.length === 0);
    const byId = new Map(gears.map((g) => [g.id, g]));

    for (const b of builds) {
      const card = el('li', 'build-card');
      const head = el('div', 'build-card__head');
      head.append(el('div', 'build-card__name', b.name));
      if (b.sortieCount > 0) head.append(el('span', 'build-card__count', `出陣 ${b.sortieCount}回`));
      card.append(head);

      const grid = el('div', 'build-card__grid');
      for (const slot of SLOTS) {
        const cell = el('div', `build-cell build-cell--${slot}`);
        const ic = el('span', 'build-cell__icon');
        ic.innerHTML = deps.slotIcon(slot, 16);
        const g = byId.get(b.gearIds[slot]);
        const text = b.gearIds[slot] === '' ? '空き' : g ? g.title : '（なくなった装備）';
        const name = el('span', `build-cell__name${g ? '' : ' is-empty'}`, text);
        cell.append(ic, name);
        grid.append(cell);
      }
      card.append(grid, describe(b.gearIds));

      const actions = el('div', 'build-card__actions');
      const go = el('button', 'btn btn--primary btn--sm', 'このビルドで出陣');
      (go as HTMLButtonElement).type = 'button';
      go.dataset.track = 'build_sortie';
      go.addEventListener('click', () => void sortie(b));
      const edit = el('button', 'btn btn--ghost btn--sm', '編集');
      (edit as HTMLButtonElement).type = 'button';
      edit.addEventListener('click', () => openEditor(b));
      const del = el('button', 'btn btn--ghost btn--sm is-danger', '削除');
      (del as HTMLButtonElement).type = 'button';
      del.addEventListener('click', () => {
        deleteId = b.id;
        confirmText.textContent = `ビルド「${b.name}」を削除します。装備そのものは消えません。`;
        deps.openOverlay(confirmOverlay);
      });
      actions.append(go, edit, del);
      card.append(actions);
      listEl.append(card);
    }
  }

  async function sortie(b: Build): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const n = await sortieBuild(deps.getUid(), b, deps.getGears());
      deps.showToast(`「${b.name}」で出陣！ ${n}個の装備を装備中にしました`);
      deps.goCheck();
    } catch {
      deps.showToast('出陣の準備に失敗しました。通信環境を確認してください');
    } finally {
      busy = false;
    }
  }

  // ---- 編集 ----
  function openEditor(b?: Build, random = false): void {
    editingId = b?.id ?? '';
    fillOptions();
    titleEl.textContent = b ? 'ビルドを編集' : random ? 'おまかせ編成' : '新しいビルドを組む';
    nameInput.value = b?.name ?? (random ? 'おまかせビルド' : '');
    oddsEl.textContent = '';
    if (b) setIds(b.gearIds);
    else if (random) rollRandom();
    else setIds(emptyGearIds());
    deps.openOverlay(overlay);
    if (!random) nameInput.focus({ preventScroll: true });
  }

  function rollRandom(): void {
    const ids = randomIds(deps.getGears(), deps.isRusty);
    setIds(ids);
    const a = analyze(ids, deps.getGears(), deps.levelOf, deps.isRusty);
    const grade = synergyGrade(a);
    const rarity = grade === 'high' ? 'super' : grade === 'mid' ? 'rare' : 'common';
    oddsEl.textContent = `${rarityLabelText(rarity)} の編成です。${grade === 'high' ? '相性が良い、めずらしい組み合わせ！' : '気に入らなければ、引き直せます。'}（めやす: 共通タグ2つ以上=${RARITY.super.label} / 1つ=${RARITY.rare.label}。未使用・さびた装備が少し出やすくなっています）`;
    if (rarity === 'super') deps.showToast('相性◎のレア編成が出ました！');
  }

  $('btn-build-new').addEventListener('click', () => {
    if (builds.length >= MAX_BUILDS) { deps.showToast(`ビルドは${MAX_BUILDS}個までです`); return; }
    openEditor();
  });
  $('btn-build-random').addEventListener('click', () => {
    if (builds.length >= MAX_BUILDS) { deps.showToast(`ビルドは${MAX_BUILDS}個までです`); return; }
    openEditor(undefined, true);
  });
  $('btn-build-reroll').addEventListener('click', rollRandom);
  $('btn-build-close').addEventListener('click', () => deps.closeOverlay(overlay));
  $('btn-build-cancel').addEventListener('click', () => deps.closeOverlay(overlay));
  nameInput.maxLength = MAX_BUILD_NAME;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const name = nameInput.value.trim();
    if (!name) { deps.showToast('ビルドの名前を入力してください'); nameInput.focus(); return; }
    const ids = currentIds();
    if (SLOTS.every((s) => !ids[s])) { deps.showToast('装備を1つ以上選んでください'); return; }
    busy = true;
    try {
      if (editingId) await updateBuild(deps.getUid(), editingId, { name, gearIds: ids });
      else await createBuild(deps.getUid(), { name, gearIds: ids });
      deps.closeOverlay(overlay);
      deps.showToast('ビルドを保存しました');
    } catch {
      deps.showToast('保存できませんでした。通信環境を確認してください');
    } finally {
      busy = false;
    }
  });

  $('btn-build-confirm-cancel').addEventListener('click', () => deps.closeOverlay(confirmOverlay));
  $('btn-build-confirm-delete').addEventListener('click', async () => {
    if (!deleteId || busy) return;
    busy = true;
    try {
      await deleteBuild(deps.getUid(), deleteId);
      deps.closeOverlay(confirmOverlay);
      deps.showToast('ビルドを削除しました');
    } catch {
      deps.showToast('削除できませんでした');
    } finally {
      deleteId = '';
      busy = false;
    }
  });

  function setUser(uid: string | null): void {
    unsubscribe?.();
    unsubscribe = null;
    builds = [];
    deps.closeOverlay(overlay);
    deps.closeOverlay(confirmOverlay);
    if (!uid) { render(); return; }
    unsubscribe = subscribeBuilds(
      uid,
      (list) => { builds = list; render(); },
      () => deps.showToast('ビルドを読み込めませんでした。再読み込みしてください'),
    );
  }

  return { setUser, render };
}
