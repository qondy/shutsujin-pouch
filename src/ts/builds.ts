// 出陣ビルド: 4つの枠（武器・防具・道具・魔導書）に装備を1つずつ組んで保存する。
// データ: users/{uid}/builds/{id}
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, increment, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { Gear, Slot } from './types';
import { SLOTS } from './store';

export const MAX_BUILD_NAME = 30;
export const MAX_BUILDS = 30;

export type GearIds = Record<Slot, string>;

export interface Build {
  id: string;
  name: string;
  /** 枠ごとの装備ID。空き枠は '' */
  gearIds: GearIds;
  sortieCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface BuildInput {
  name: string;
  gearIds: GearIds;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export const emptyGearIds = (): GearIds => ({ weapon: '', armor: '', item: '', tome: '' });

function cleanIds(v: unknown): GearIds {
  const src = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out = emptyGearIds();
  for (const s of SLOTS) out[s] = str(src[s], 40);
  return out;
}

function fromDoc(id: string, d: Record<string, unknown>): Build {
  return {
    id,
    name: str(d.name, MAX_BUILD_NAME) || '（無題のビルド）',
    gearIds: cleanIds(d.gearIds),
    sortieCount: Math.floor(num(d.sortieCount)),
    createdAt: num(d.createdAt),
    updatedAt: num(d.updatedAt),
  };
}

const buildsCol = (uid: string) => collection(db, 'users', uid, 'builds');
const buildDoc = (uid: string, id: string) => doc(db, 'users', uid, 'builds', id);

export function subscribeBuilds(uid: string, onData: (builds: Build[]) => void, onError: (e: Error) => void): () => void {
  return onSnapshot(
    buildsCol(uid),
    (snap) => onData(snap.docs.map((s) => fromDoc(s.id, s.data())).sort((a, b) => b.updatedAt - a.updatedAt)),
    onError,
  );
}

export async function createBuild(uid: string, input: BuildInput): Promise<void> {
  const now = Date.now();
  await addDoc(buildsCol(uid), {
    name: input.name.trim().slice(0, MAX_BUILD_NAME),
    gearIds: cleanIds(input.gearIds),
    sortieCount: 0,
    createdAt: now,
    updatedAt: now,
  });
}

export function updateBuild(uid: string, id: string, input: BuildInput): Promise<void> {
  return updateDoc(buildDoc(uid, id), {
    name: input.name.trim().slice(0, MAX_BUILD_NAME),
    gearIds: cleanIds(input.gearIds),
    updatedAt: Date.now(),
  });
}

export function deleteBuild(uid: string, id: string): Promise<void> {
  return deleteDoc(buildDoc(uid, id));
}

/** このビルドで出陣: ビルドの装備だけを「装備中」にして、出陣回数を1つ増やす */
export async function sortieBuild(uid: string, build: Build, gears: Gear[]): Promise<number> {
  const ids = new Set(SLOTS.map((s) => build.gearIds[s]).filter(Boolean));
  const batch = writeBatch(db);
  let equipped = 0;
  const now = Date.now();
  for (const g of gears) {
    const want = ids.has(g.id);
    if (want) equipped += 1;
    if (g.pinned !== want) batch.update(doc(db, 'users', uid, 'gears', g.id), { pinned: want, updatedAt: now });
  }
  batch.update(buildDoc(uid, build.id), { sortieCount: increment(1) });
  await batch.commit();
  return equipped;
}

// ============================================================
// 相性・ビルドパワー・おまかせ編成（表示用の計算）
// ============================================================
export interface BuildAnalysis {
  gears: Gear[];
  full: boolean;
  sharedTags: string[];
  power: number;
  rustCount: number;
}

export function analyze(
  ids: GearIds,
  allGears: Gear[],
  levelOf: (useCount: number) => number,
  isRusty: (g: Gear) => boolean,
): BuildAnalysis {
  const byId = new Map(allGears.map((g) => [g.id, g]));
  const gears = SLOTS.map((s) => byId.get(ids[s])).filter((g): g is Gear => Boolean(g));
  const count = new Map<string, number>();
  for (const g of gears) {
    for (const t of new Set(g.tags.map((x) => x.toLowerCase()))) count.set(t, (count.get(t) ?? 0) + 1);
  }
  const sharedTags = [...count.entries()].filter(([, n]) => n >= 2).map(([t]) => t);
  return {
    gears,
    full: gears.length === SLOTS.length,
    sharedTags,
    power: gears.reduce((sum, g) => sum + levelOf(g.useCount), 0),
    rustCount: gears.filter(isRusty).length,
  };
}

export type SynergyGrade = 'high' | 'mid' | 'low';

export function synergyGrade(a: BuildAnalysis): SynergyGrade {
  if (a.sharedTags.length >= 2) return 'high';
  if (a.sharedTags.length === 1) return 'mid';
  return 'low';
}

export const SYNERGY_TEXT: Record<SynergyGrade, string> = {
  high: '相性◎',
  mid: '相性○',
  low: '相性△',
};

/** 未使用・さびた装備ほど出やすい重みつきの抽選で、枠ごとに1つずつ選ぶ */
export function randomIds(
  allGears: Gear[],
  isRusty: (g: Gear) => boolean,
  rand: () => number = Math.random,
): GearIds {
  const out = emptyGearIds();
  for (const slot of SLOTS) {
    const pool = allGears.filter((g) => g.slot === slot);
    if (pool.length === 0) continue;
    const weights = pool.map((g) => 1 + (g.lastUsedAt === 0 ? 2 : 0) + (isRusty(g) ? 2 : 0));
    let r = rand() * weights.reduce((a, b) => a + b, 0);
    let pick = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i += 1) {
      r -= weights[i];
      if (r < 0) { pick = pool[i]; break; }
    }
    out[slot] = pick.id;
  }
  return out;
}
