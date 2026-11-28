// 「今日意識すること」の今日の分。お気に入りが多いときだけ、今日は3つに絞る。
// 選んだ内容は端末内に日付ごとに保存する（保存できない環境では、開いている間だけ有効）。

export const TODAY_LIMIT = 3;

export function loadToday(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, TODAY_LIMIT) : [];
  } catch {
    return [];
  }
}

export function saveToday(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // 保存できない環境では、この画面を開いている間だけ有効
  }
}

export function shuffle<T>(list: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 削除や解除でいなくなった分を、残りのお気に入りからおまかせで補う */
export function fillToday(current: readonly string[], favoriteIds: readonly string[]): string[] {
  const kept = current.filter((id) => favoriteIds.includes(id)).slice(0, TODAY_LIMIT);
  const rest = shuffle(favoriteIds.filter((id) => !kept.includes(id)));
  return [...kept, ...rest].slice(0, TODAY_LIMIT);
}

/** 引き直し。意識できた分は残し、それ以外はなるべく今と違うものに入れ替える */
export function redrawToday(current: readonly string[], favoriteIds: readonly string[], done: readonly string[]): string[] {
  const kept = current.filter((id) => done.includes(id) && favoriteIds.includes(id));
  const others = favoriteIds.filter((id) => !kept.includes(id));
  const fresh = shuffle(others.filter((id) => !current.includes(id)));
  const old = shuffle(others.filter((id) => current.includes(id)));
  return [...kept, ...fresh, ...old].slice(0, TODAY_LIMIT);
}
