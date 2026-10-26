// #/episodes 回の一覧と比較
import { h, val } from '../lib/dom.js';
import { num, firstWeekFor, retentionFor, jstDate, shortTitle, epLabel, isLongForm, platformKey } from '../lib/metrics.js';
import { fmtInt, fmtPct, fmtMMSS, cohortJa, MISSING, fmtYMD } from '../lib/format.js';
import { compareBars, destroyCharts } from '../lib/charts.js';
import { sectionHead, srcFW, srcRet } from './common.js';

const PREF_KEY = 'bj-dashboard-episodes';
function loadPref() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } }
function savePref(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* 保存できなくても動く */ } }

const COLS = [
  { key: 'ep', label: '回', sort: r => r.n },
  { key: 'pub', label: '公開日（JST）', sort: r => r.pub || '' },
  { key: 'dur', label: '尺', sort: r => r.dur ?? -1 },
  { key: 'cohort', label: '区分', sort: r => r.cohort || '' },
  { key: 'sp', label: 'Spotify初週', sort: r => r.sp ?? -1, metric: true, unit: '' },
  { key: 'ap', label: 'Apple（参考）', sort: r => r.ap ?? -1 },
  { key: 'yt', label: 'YouTube長尺', sort: r => r.yt ?? -1, metric: true, unit: '回' },
  { key: 'sh', label: 'Shorts', sort: r => r.sh ?? -1, metric: true, unit: '回' },
  { key: 'q1', label: 'Q1', sort: r => r.q1 ?? -1, metric: true, unit: '%' },
  { key: 'complete', label: 'Complete', sort: r => r.complete ?? -1, metric: true, unit: '%' },
];

function rowsOf(ix) {
  return ix.episodes.map(e => {
    const n = e.episode_number;
    const fw = firstWeekFor(ix, n);
    const ret = retentionFor(ix, n);
    return {
      n, e, fw, ret,
      pub: jstDate(e.published_at), dur: num(e.duration_seconds), cohort: e.duration_cohort,
      sp: num(fw.spotify.main?.plays_or_views), ap: num(fw.apple.main?.plays_or_views),
      yt: num(fw.youtube_long.main?.plays_or_views), sh: num(fw.shorts.main?.plays_or_views),
      q1: num(ret?.q1), complete: num(ret?.complete), long: isLongForm(ix, n),
      // Shorts を作らないと決めた回（status=unavailable の行）は「なし」と出す（未取得と分ける）
      // bundle は approved／provisional の行だけなので、回の詳細（common.js laterBlock）と同じく Now Reading 回で判定する
      shNone: ix.firstWeek.find(r => r.episode_number === n && r.status === 'unavailable' && platformKey(r) === 'shorts')
        || ((e.genre === 'Now Reading' || /今、読んでいる本/.test(e.title || '')) ? { now_reading: true } : null),
    };
  });
}

export function renderEpisodes(root, ix) {
  const pref = { sort: 'ep', dir: -1, cohort: 'all', metric: 'sp', from: 19, ...loadPref() };
  const all = rowsOf(ix);
  const tableCard = h('section', { class: 'card' });
  const chartCard = h('section', { class: 'card' });
  root.append(
    h('header', { class: 'page-head' }, h('h1', null, '回の一覧と比較'), h('p', { class: 'sub' }, '初週の各プラットフォーム・Complete・尺。見出しを押すと並べ替え。Appleは参考値のため比較グラフには入れない。')),
    chartCard, tableCard);

  const redraw = () => {
    destroyCharts();
    const rows = all.filter(r => pref.cohort === 'all' || r.cohort === pref.cohort);
    drawChart(chartCard, ix, rows, pref, redraw);
    drawTable(tableCard, ix, rows, pref, redraw);
    savePref(pref);
  };
  redraw();
}

function drawChart(card, ix, rows, pref, redraw) {
  const col = COLS.find(c => c.key === pref.metric) || COLS[4];
  const shown = rows.filter(r => r.n >= pref.from).sort((a, b) => a.n - b.n);
  const box = h('div', { class: 'chart-box chart-compare' });
  const canvas = h('canvas', { role: 'img', 'aria-label': `${col.label}の回別比較` });
  box.append(canvas);
  card.replaceChildren(
    sectionHead('比較', `${col.label}（EP#${pref.from}以降）`, '金色＝倍尺回（Completeの低下は尺による。悪化とは読まない）。未取得の回は棒なし。'),
    h('div', { class: 'controls' },
      h('label', null, '指標 ', h('select', { onchange: e => { pref.metric = e.target.value; redraw(); } },
        COLS.filter(c => c.metric).map(c => h('option', { value: c.key, selected: c.key === pref.metric ? true : null }, c.label)))),
      h('label', null, '表示 ', h('select', { onchange: e => { pref.from = Number(e.target.value); redraw(); } },
        [[0, '全回'], [19, 'EP#19以降'], [30, 'EP#30以降']].map(([v, t]) => h('option', { value: v, selected: v === pref.from ? true : null }, t)))),
      h('label', null, '区分 ', h('select', { onchange: e => { pref.cohort = e.target.value; redraw(); } },
        [['all', 'すべて'], ['standard', '通常'], ['long_form', '倍尺'], ['short_corner', 'ショートコーナー']].map(([v, t]) => h('option', { value: v, selected: v === pref.cohort ? true : null }, t))))),
    box);
  queueMicrotask(() => compareBars(canvas, shown.map(r => ({ label: `#${r.n}`, full: epLabel(ix, r.n), value: r[col.key], long: r.long })), { unit: col.unit, title: col.label }));
}

function drawTable(card, ix, rows, pref, redraw) {
  const col = COLS.find(c => c.key === pref.sort) || COLS[0];
  const sorted = [...rows].sort((a, b) => {
    const x = col.sort(a), y = col.sort(b);
    return (x < y ? -1 : x > y ? 1 : 0) * pref.dir;
  });
  const th = c => h('th', { scope: 'col' }, h('button', { type: 'button', class: 'sort', 'aria-sort': c.key === pref.sort ? (pref.dir > 0 ? 'ascending' : 'descending') : null,
    onclick: () => { if (pref.sort === c.key) pref.dir *= -1; else { pref.sort = c.key; pref.dir = c.key === 'ep' || c.key === 'pub' ? -1 : -1; } redraw(); } },
  c.label, c.key === pref.sort ? (pref.dir > 0 ? ' ▲' : ' ▼') : ''));
  card.replaceChildren(
    sectionHead('一覧', `回の一覧（${rows.length}回）`, '各数値にカーソルを合わせると出典。初週は公開から7日間（各プラットフォームの取り方は詳細画面へ）。'),
    h('div', { class: 'tbl-scroll' },
      h('table', { class: 'tbl resp ep-table' },
        h('thead', null, h('tr', null, COLS.map(th))),
        h('tbody', null, sorted.map(r => h('tr', { class: r.long ? 'long' : '' },
          h('td', { 'data-label': '回' }, h('a', { href: `#/episode/${r.n}` }, `EP#${r.n}`), h('span', { class: 'ep-st' }, shortTitle(ix, r.n).text)),
          h('td', { 'data-label': '公開日（JST）' }, r.pub ? fmtYMD(r.pub) : MISSING),
          h('td', { 'data-label': '尺' }, val(fmtMMSS(r.dur), ['出典: episodes.duration_seconds'])),
          h('td', { 'data-label': '区分' }, cohortJa(r.cohort)),
          h('td', { 'data-label': 'Spotify初週' }, val(fmtInt(r.sp), srcFW(r.fw.spotify.main, 'plays_or_views'))),
          h('td', { 'data-label': 'Apple（参考）', class: 'muted-cell' }, val(fmtInt(r.ap), srcFW(r.fw.apple.main, 'plays_or_views', '参考値。順位比較しない'))),
          h('td', { 'data-label': 'YouTube長尺' }, val(fmtInt(r.yt), srcFW(r.fw.youtube_long.main, 'plays_or_views'))),
          h('td', { 'data-label': 'Shorts' }, r.sh === null && r.shNone ? val('なし', r.shNone.now_reading ? ['2026-10-09 決定：Now Reading回はShortsを作らない', '判定: episodes.genre または題名「今、読んでいる本」'] : srcFW(r.shNone, 'status', 'この回はShortsを作っていない')) : val(fmtInt(r.sh), srcFW(r.fw.shorts.main, 'plays_or_views'))),
          h('td', { 'data-label': 'Q1' }, val(r.q1 === null ? MISSING : fmtPct(r.q1), srcRet(r.ret, 'raw_q1'))),
          h('td', { 'data-label': 'Complete' }, val(r.complete === null ? MISSING : fmtPct(r.complete), srcRet(r.ret, 'raw_complete', r.long ? '倍尺回' : '')))))))));
}
