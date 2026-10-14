// #/status データの状態
import { h } from '../lib/dom.js';
import { tableStats, missingItems, jstDate } from '../lib/metrics.js';
import { fmtInt, fmtDateTime, MISSING } from '../lib/format.js';
import { sectionHead } from './common.js';

export function renderStatus(root, ix, meta) {
  const b = ix.bundle || {};
  const today = jstDate(new Date().toISOString());
  root.append(h('header', { class: 'page-head' }, h('h1', null, 'データの状態'), h('p', { class: 'sub' }, `各テーブルの件数・最新日付と、未取得の項目。今日（JST）: ${today}`)));

  root.append(h('section', { class: 'card' },
    sectionHead('bundle', '読み込んだデータ', null),
    h('dl', { class: 'meta-list' },
      h('dt', null, '読み先'), h('dd', null, `${meta.mode === 'remote' ? 'リモート' : 'ローカル'}：${meta.path}${meta.user ? `（${meta.user}）` : ''}`),
      h('dt', null, '種類'), h('dd', null, meta.sample ? 'サンプルデータ（fixture）' : (b.mode || '記録なし')),
      h('dt', null, 'bundleの生成'), h('dd', null, b.built_at ? fmtDateTime(b.built_at) : MISSING),
      h('dt', null, 'DB書き出し'), h('dd', null, `${b.db?.generated_at ? fmtDateTime(b.db.generated_at) : MISSING}（${b.db?.source || '出典未記録'}・schema ${b.db?.schema_version ?? '?'}）`),
      h('dt', null, 'CSV補助'), h('dd', null, ix.csv ? `${ix.csv.generated_at ? fmtDateTime(ix.csv.generated_at) : '生成時刻なし'}・取得フォルダ${(ix.csv.folders || []).length}件・ファイル${(ix.csv.files || []).length}件` : '未取得'),
      h('dt', null, '週の文章'), h('dd', null, Object.keys(ix.notes).length ? Object.keys(ix.notes).map(w => `W${w}`).join('・') : 'なし'),
      h('dt', null, '回遊率の系列'), h('dd', null, ix.kaiyu ? `${ix.kaiyu.source_script || '出典未記録'}（W${ix.kaiyu.weeks?.[0]}〜W${ix.kaiyu.weeks?.[ix.kaiyu.weeks.length - 1]}）` : '未取得'),
      b._fixture_notice ? h('dt', null, '注意') : null, b._fixture_notice ? h('dd', null, b._fixture_notice) : null)));

  const stats = tableStats(ix);
  root.append(h('section', { class: 'card' },
    sectionHead('テーブル', 'テーブルごとの件数と最新日付', 'bundle に入っている範囲。DBの全テーブルではない（YouTube日次・SNS などは CONTRACT 外で、ここでは確認できない）'),
    h('div', { class: 'tbl-scroll' },
      h('table', { class: 'tbl resp' },
        h('thead', null, h('tr', null, ['テーブル', '内容', '件数', '最新', '内訳'].map(t => h('th', null, t)))),
        h('tbody', null, stats.map(s => h('tr', { class: s.rows ? '' : 'empty' },
          h('td', { 'data-label': 'テーブル' }, h('code', null, s.table)),
          h('td', { 'data-label': '内容' }, s.label),
          h('td', { 'data-label': '件数' }, s.rows ? fmtInt(s.rows) : h('span', { class: 'missing' }, '0件')),
          h('td', { 'data-label': '最新' }, s.latest ? `${s.latest}（${s.latestLabel}）` : h('span', { class: 'missing' }, MISSING)),
          h('td', { 'data-label': '内訳', class: 'small' }, s.breakdown ? Object.entries(s.breakdown).map(([k, v]) => `${k}: ${v}`).join('／') : null)))))),
    Array.isArray(b.db?.table_stats) ? extraStats(b.db.table_stats) : null));

  const items = missingItems(ix, { today });
  const groups = {};
  for (const it of items) (groups[it.area] = groups[it.area] || []).push(it);
  root.append(h('section', { class: 'card' },
    sectionHead('未取得', `未取得・要確認の項目（${items.length}件）`, '0や推測で埋めずに画面へ「未取得」と出している項目の一覧。「情報」は運用上そうなっているもの。'),
    items.length ? Object.entries(groups).map(([area, list]) => h('div', { class: 'miss-group' },
      h('h3', { class: 'h3' }, area),
      h('ul', { class: 'miss' }, list.map(it => h('li', { class: it.level }, h('span', { class: `lv ${it.level}` }, it.level === 'warn' ? '要確認' : '情報'), it.text))))) : h('p', null, '未取得の項目はありません')));

  if (ix.csvConflicts.length) {
    root.append(h('section', { class: 'card' },
      sectionHead('CSV', `取得日で値が違った日（${ix.csvConflicts.length}件）`, '新しい取得フォルダの値を採用。黙って上書きせず記録している'),
      h('div', { class: 'tbl-scroll' },
        h('table', { class: 'tbl resp' },
          h('thead', null, h('tr', null, ['日付', '項目', '値（取得フォルダ）', '採用'].map(t => h('th', null, t)))),
          h('tbody', null, ix.csvConflicts.slice(0, 60).map(c => h('tr', null,
            h('td', { 'data-label': '日付' }, c.date),
            h('td', { 'data-label': '項目' }, c.field),
            h('td', { 'data-label': '値', class: 'small' }, (c.values || []).map(v => `${v.value}（${v.folder}）`).join('、')),
            h('td', { 'data-label': '採用' }, c.adopted ? `${c.adopted.value}（${c.adopted.folder}）` : (c.values?.[0] ? `${c.values[0].value}（${c.values[0].folder}）` : '')))))))));
  }
}

function extraStats(rows) {
  return h('details', { class: 'data-table' }, h('summary', null, 'DB側の追加情報（table_stats）'),
    h('ul', null, rows.map(r => h('li', null, Object.entries(r).map(([k, v]) => `${k}: ${v}`).join('／')))));
}
