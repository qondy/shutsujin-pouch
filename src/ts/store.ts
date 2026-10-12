import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, increment, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { Gear, GearData, Slot } from './types';

export const MAX_TITLE = 60;
export const MAX_COPY = 200;
export const MAX_URL = 500;
export const MAX_BODY = 3000;
export const MAX_TAGS = 8;
export const MAX_TAG = 20;
export const MAX_GEARS = 500;

export const SLOTS: Slot[] = ['weapon', 'armor', 'item', 'tome'];

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const safeSlot = (v: unknown): Slot => (SLOTS.includes(v as Slot) ? (v as Slot) : 'item');

/** http/https のURLだけを許可する（javascript: などを弾く） */
export function safeUrl(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s || s.length > MAX_URL) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

/** 「交渉, 会議、思考法」のような入力をタグ配列にする */
export function parseTags(v: string): string[] {
  const out: string[] = [];
  v.split(/[,、，\s]+/).forEach((t) => {
    const tag = t.replace(/^#/, '').trim().slice(0, MAX_TAG);
    if (tag && !out.includes(tag) && out.length < MAX_TAGS) out.push(tag);
  });
  return out;
}

function normTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return parseTags(v.filter((t) => typeof t === 'string').join(','));
}

function sanitize(data: GearData): GearData {
  return {
    slot: safeSlot(data.slot),
    title: data.title.trim().slice(0, MAX_TITLE),
    copyText: data.copyText.trim().slice(0, MAX_COPY),
    url: safeUrl(data.url),
    body: data.body.slice(0, MAX_BODY),
    tags: normTags(data.tags),
    pinned: data.pinned === true,
  };
}

function fromDoc(id: string, d: Record<string, unknown>): Gear {
  const createdAt = num(d.createdAt);
  return {
    id,
    slot: safeSlot(d.slot),
    title: str(d.title, MAX_TITLE) || '（無題の装備）',
    copyText: str(d.copyText, MAX_COPY),
    url: safeUrl(d.url),
    body: str(d.body, MAX_BODY),
    tags: normTags(d.tags),
    pinned: d.pinned === true,
    useCount: Math.floor(num(d.useCount)),
    lastUsedAt: num(d.lastUsedAt),
    reviewedAt: num(d.reviewedAt) || createdAt,
    createdAt,
    updatedAt: num(d.updatedAt),
  };
}

const gearsCol = (uid: string) => collection(db, 'users', uid, 'gears');
const gearDoc = (uid: string, id: string) => doc(db, 'users', uid, 'gears', id);

export function subscribeGears(
  uid: string,
  onData: (gears: Gear[]) => void,
  onError: (e: Error) => void,
): () => void {
  return onSnapshot(
    gearsCol(uid),
    (snap) => onData(snap.docs.map((s) => fromDoc(s.id, s.data()))),
    onError,
  );
}

export async function createGear(uid: string, data: GearData): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(gearsCol(uid), {
    ...sanitize(data),
    useCount: 0,
    lastUsedAt: 0,
    reviewedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

/** 編集して保存したら、その時点で手入れ済みとみなす */
export function updateGear(uid: string, id: string, data: GearData): Promise<void> {
  const now = Date.now();
  return updateDoc(gearDoc(uid, id), { ...sanitize(data), reviewedAt: now, updatedAt: now });
}

export function setPinned(uid: string, id: string, pinned: boolean): Promise<void> {
  return updateDoc(gearDoc(uid, id), { pinned, updatedAt: Date.now() });
}

export function markReviewed(uid: string, id: string): Promise<void> {
  return updateDoc(gearDoc(uid, id), { reviewedAt: Date.now() });
}

/** コピー・リンクを開く・「使った」で熟練度を上げる */
export function markUsed(uid: string, id: string): Promise<void> {
  return updateDoc(gearDoc(uid, id), { useCount: increment(1), lastUsedAt: Date.now() });
}

export function deleteGear(uid: string, id: string): Promise<void> {
  return deleteDoc(gearDoc(uid, id));
}

export async function createMany(uid: string, list: GearData[]): Promise<void> {
  const batch = writeBatch(db);
  const now = Date.now();
  list.forEach((data, i) => {
    batch.set(doc(gearsCol(uid)), {
      ...sanitize(data),
      useCount: 0,
      lastUsedAt: 0,
      reviewedAt: now,
      createdAt: now + i,
      updatedAt: now + i,
    });
  });
  await batch.commit();
}
