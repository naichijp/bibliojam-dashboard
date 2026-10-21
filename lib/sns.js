// SNS（X・Instagram）の週の数字（2026-10-22〜。migration_004 の db.sns。縦持ち）。純粋な関数
import { num } from './metrics.js';

// 導線の欄に出す順（ここに無い指標は「そのほか」にまとめる）
export const SNS_METRICS = {
  instagram: [
    ['views', '表示（ビュー）'], ['reach', 'リーチ'], ['accounts_engaged', '反応したアカウント'],
    ['total_interactions', 'インタラクション'], ['profile_links_taps', 'プロフィールのリンクのタップ'],
    ['follows', '新しいフォロワー'], ['unfollows', 'フォロー解除'], ['followers_end', 'フォロワー（取得時点）'], ['posts', '投稿'],
  ],
  x: [
    ['impressions', 'インプレッション'], ['engagements', 'エンゲージメント'], ['engagement_rate', 'エンゲージメント率'],
    ['profile_visits', 'プロフィールへのアクセス'], ['link_clicks', 'リンクのクリック'], ['new_follows', '新しいフォロワー'],
    ['unfollows', 'フォロー解除'], ['followers_end', 'フォロワー（読んだ時点）'], ['posts', '投稿'],
  ],
};

export function snsRows(ix) {
  const r = ix.db && Array.isArray(ix.db.sns) ? ix.db.sns : null;
  return r;
}

// その週・その媒体の行を、表示する順に並べる。{rows: [{key,label,row}], others: [row], period, source} か null
export function snsWeek(ix, weekNumber, platform) {
  const all = snsRows(ix);
  if (!all) return null;
  const rows = all.filter(r => r.week_number === weekNumber && r.platform === platform);
  if (!rows.length) return { rows: [], others: [], empty: true };
  const byKey = new Map(rows.map(r => [r.metric_key, r]));
  const order = SNS_METRICS[platform] || [];
  const known = new Set(order.map(([k]) => k));
  return {
    empty: false,
    rows: order.filter(([k]) => byKey.has(k)).map(([key, label]) => ({ key, label, row: byKey.get(key) })),
    others: rows.filter(r => !known.has(r.metric_key)),
    period: { start: rows[0].period_start, end: rows[0].period_end, timezone: rows[0].timezone },
    source: rows[0].source,
  };
}

export function snsValueText(row) {
  if (!row) return null;
  if (row.value_text) return row.value_text;
  const v = num(row.value);
  return v === null ? null : v.toLocaleString('en-US');
}
