import { GearData } from './types';

export const SAMPLE_GEARS: GearData[] = [
  {
    slot: 'weapon',
    title: '経費精算のやり方',
    copyText: '',
    url: '',
    body: '1. 経費システムにログイン\n2. 「新規申請」→ 領収書の写真を添付\n3. 承認者は直属の上司を選ぶ\n※ 締め日は毎月25日',
    tags: ['申請', '経理'],
    pinned: true,
  },
  {
    slot: 'armor',
    title: '情報持ち出しのルール',
    copyText: '',
    url: '',
    body: '・社外への資料送付はメール添付ではなく共有リンクで\n・USBメモリの使用は禁止\n・カフェでの作業時は覗き見防止フィルターを付ける',
    tags: ['セキュリティ'],
    pinned: false,
  },
  {
    slot: 'item',
    title: '情報システム部（PCトラブル）',
    copyText: '内線 1234',
    url: '',
    body: '平日 9:00〜18:00。PCが起動しないときはまず電話で。',
    tags: ['連絡先', '困ったとき'],
    pinned: true,
  },
  {
    slot: 'tome',
    title: '「ヨミ」= 売上見込み',
    copyText: '',
    url: '',
    body: '営業会議でよく出てくる言葉。「ヨミが立つ」= 受注がほぼ確実、という意味。',
    tags: ['社内用語'],
    pinned: false,
  },
];
