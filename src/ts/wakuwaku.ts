// ワクワク演出の共通部品（全アプリ共通で流用する）。
// ・ランク（経験値 → レベル・称号・次までの進み具合）
// ・レア度つきの抽選（コモン / レア / スーパーレア）
// ・演出（紙吹雪。動きを減らす設定のときは出さない）
// データの保存はしない。表示用の計算と演出だけを担当する。

// ============================================================
// ランク
// ============================================================
export interface RankDef {
  name: string;
  /** このランクになるのに必要な累計経験値 */
  min: number;
}

export interface RankState {
  /** 0始まりの段階 */
  index: number;
  /** 表示用のレベル（1始まり） */
  level: number;
  rank: RankDef;
  next: RankDef | null;
  xp: number;
  /** 現在のランクに入ってからの経験値 */
  into: number;
  /** 現在のランクから次のランクまでの幅（最高ランクは 0） */
  span: number;
  /** 0〜1 */
  ratio: number;
}

export function rankOf(xp: number, ranks: RankDef[]): RankState {
  let index = 0;
  for (let i = 0; i < ranks.length; i += 1) {
    if (xp >= ranks[i].min) index = i;
  }
  const rank = ranks[index];
  const next = ranks[index + 1] ?? null;
  const into = xp - rank.min;
  const span = next ? next.min - rank.min : 0;
  const ratio = next ? Math.min(1, into / span) : 1;
  return { index, level: index + 1, rank, next, xp, into, span, ratio };
}

// ============================================================
// レア度つきの抽選
// ============================================================
export type Rarity = 'common' | 'rare' | 'super';

export interface RarityMeta {
  label: string;
  stars: number;
  /** 出る確率（合計100） */
  percent: number;
}

export const RARITY: Record<Rarity, RarityMeta> = {
  common: { label: 'コモン', stars: 1, percent: 60 },
  rare: { label: 'レア', stars: 2, percent: 32 },
  super: { label: 'スーパーレア', stars: 3, percent: 8 },
};

export function rollRarity(rand: () => number = Math.random): Rarity {
  const r = rand() * 100;
  if (r < RARITY.super.percent) return 'super';
  if (r < RARITY.super.percent + RARITY.rare.percent) return 'rare';
  return 'common';
}

export function pickOne<T>(items: readonly T[], rand: () => number = Math.random): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(rand() * items.length)];
}

export function rarityLabelText(rarity: Rarity): string {
  const meta = RARITY[rarity];
  return `${'★'.repeat(meta.stars)} ${meta.label}`;
}

export function rarityOddsText(): string {
  return `確率: コモン${RARITY.common.percent}% / レア${RARITY.rare.percent}% / スーパーレア${RARITY.super.percent}%`;
}

// ============================================================
// 演出
// ============================================================
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const CONFETTI_COLORS = ['#f5c9a0', '#e8975a', '#dc6f28', '#f1c40f', '#27ae60', '#3498db', '#9b59b6'];

/** 画面上部から紙吹雪を降らせる（約1.6秒）。動きを減らす設定のときは何もしない */
export function celebrate(count = 28): void {
  if (prefersReducedMotion()) return;
  document.querySelectorAll('.waku-confetti').forEach((el) => el.remove()); // 連続で重ならないように
  const layer = document.createElement('div');
  layer.className = 'waku-confetti';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement('span');
    piece.className = 'waku-confetti__piece';
    piece.style.setProperty('--x', `${Math.round(Math.random() * 100)}vw`);
    piece.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 120)}px`);
    piece.style.setProperty('--delay', `${Math.round(Math.random() * 300)}ms`);
    piece.style.setProperty('--rot', `${Math.round(Math.random() * 720 - 360)}deg`);
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    layer.append(piece);
  }
  document.body.append(layer);
  window.setTimeout(() => layer.remove(), 2000);
}
