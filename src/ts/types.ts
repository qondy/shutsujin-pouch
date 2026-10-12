/** 武器（攻め）/ 防具（守り）/ 道具（アイテム）/ 魔導書（知識） */
export type Slot = 'weapon' | 'armor' | 'item' | 'tome';

/** 装備（会社の情報1件）の入力内容 */
export interface GearData {
  slot: Slot;
  title: string;
  copyText: string; // ワンタップでコピーする内容（内線番号・メールアドレスなど）
  url: string; // 社内システムや資料のURL（http/https のみ）
  body: string; // 手順・ルール・説明など
  tags: string[];
  pinned: boolean; // 装備中（出陣前点検の対象）
}

export interface Gear extends GearData {
  id: string;
  useCount: number; // 使った回数（熟練度）
  lastUsedAt: number; // 0 は未使用
  reviewedAt: number; // 最後に手入れ（見直し）した日時
  createdAt: number;
  updatedAt: number;
}
