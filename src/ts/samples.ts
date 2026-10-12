import { GearData } from './types';

export const SAMPLE_GEARS: GearData[] = [
  {
    slot: 'weapon',
    title: 'PREP法で話す',
    copyText: '',
    url: '',
    body: '結論（Point）→ 理由（Reason）→ 具体例（Example）→ 結論（Point）の順で話す。\n報告・会議での発言・メールの書き出しで使う。最初の一文で結論を言い切るのがコツ。',
    tags: ['話し方', '報告'],
    pinned: true,
  },
  {
    slot: 'armor',
    title: '悪い報告ほど早く',
    copyText: '',
    url: '',
    body: 'トラブルやミスは、小さいうちに上司やチームへ共有する。\n「事実 → 影響 → 対応案」の順に伝えると、責められるより一緒に考えてもらえる。',
    tags: ['報連相', '仕事の原則'],
    pinned: true,
  },
  {
    slot: 'item',
    title: '日程調整メールの定型文',
    copyText: 'ご都合のよい日時を、以下の候補からお知らせいただけますでしょうか。',
    url: '',
    body: '候補は3つ以上出し、所要時間とオンライン／対面を書き添える。',
    tags: ['メール', 'テンプレ'],
    pinned: false,
  },
  {
    slot: 'tome',
    title: '『イシューからはじめよ』の学び',
    copyText: '',
    url: '',
    body: '作業量で勝負する前に、「本当に答えを出すべき問い（イシュー）」かどうかを見極める。\n明日の会議の議題を、この問いの形に書き直してみる。',
    tags: ['ビジネス書', '思考法'],
    pinned: false,
  },
];
