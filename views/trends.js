// #/trends 推移（週次・日次・フォロワー）
import { h, val } from '../lib/dom.js';
import { num, weekWindow, DEFINITION_CHANGE_WEEK, DEFINITION_CHANGE_DATE, WINDOW_DEFINITION, addDays } from '../lib/metrics.js';
import { fmtInt, fmtHours, fmtSigned, fmtWindowShort, statusJa, MISSING } from '../lib/format.js';
import { weeklyBars, lineChart, destroyCharts } from '../lib/charts.js';
import { sectionHead, srcWeek } from './common.js';
import { ytAccountCard } from './youtube.js';

const PREF_KEY = 'bj-dashboard-trends';
function loadPref() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } }
function savePref(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* 保存できなくても動く */ } }


export function renderTrends(root, ix) {
  const pref = { wRange: 'all', wMetric: 'plays', dRange: '90', dMetric: 'plays', ...loadPref() };

  const weeklyCard = h('section', { class: 'card' });
  const dailyCard = h('section', { class: 'card' });
  const folCard = h('section', { class: 'card' });
  root.append(
    h('header', { class: 'page-head' }, h('h1', null, '推移'), h('p', { class: 'sub' }, '週次・日次・フォロワーの推移。数値はDBの値（daily_metrics・weekly_snapshots）。')),
    weeklyCard, dailyCard, folCard);
  const ytHost = h('div');   // 2026-10-22〜：YouTube のアカウント全体（destroyCharts で消えるので redraw のたびに作り直す）
  root.append(ytHost);

  const redraw = () => {
    destroyCharts();
    drawWeekly(weeklyCard, ix, pref, redraw);
    drawDaily(dailyCard, ix, pref, redraw);
    drawFollowers(folCard, ix, pref, redraw);
    const yt = ytAccountCard(ix);
    ytHost.replaceChildren(...(yt ? [yt] : []));
    savePref(pref);
  };
  redraw();
}

function seg(options, current, onPick, label) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': label },
    options.map(([v, t]) => h('button', { type: 'button', class: v === current ? 'on' : '', 'aria-pressed': v === current ? 'true' : 'false', onclick: () => onPick(v) }, t)));
}

function oldWindowWeeks(ix) {
  return ix.weeks.filter(w => w.window_definition !== WINDOW_DEFINITION).map(w => w.week_number);
}

function drawWeekly(card, ix, pref, redraw) {
  const last = ix.weeks.length ? ix.weeks[ix.weeks.length - 1].week_number : 0;
  const from = pref.wRange === 'w19' ? DEFINITION_CHANGE_WEEK : pref.wRange === '12' ? Math.max(1, last - 11) : 1;
  const ws = ix.weeks.filter(w => w.week_number >= from);
  const rows = ws.map(w => ({
    week: w.week_number, status: w.status,
    sp: num(w.spotify_plays), all: num(w.all_platforms_streams), hours: num(w.spotify_listening_hours),
    repeat: num(w.repeat_listeners), new: num(w.new_listeners), fol: num(w.spotify_followers_delta),
    windowLabel: fmtWindowShort(weekWindow(ix, w)),
    note: [w.status !== 'approved' ? `状態: ${statusJa(w.status)}` : '', w.window_definition !== WINDOW_DEFINITION ? '旧窓（金〜木）の値' : '', w.count_method ? '' : '旧定義（6/11以前）の再生数'].filter(Boolean).join('／'),
  }));
  const idx = rows.findIndex(r => r.week === DEFINITION_CHANGE_WEEK);
  const old = oldWindowWeeks(ix);
  const lastOld = old.length ? Math.max(...old) : null;
  const idxNew = lastOld !== null ? rows.findIndex(r => r.week === lastOld + 1) : -1;
  const labelDiff = ix.weeks.filter(w => weekWindow(ix, w).labelDiffers).map(w => w.week_number);
  const boundaries = [];
  if (idx >= 0) boundaries.push({ at: idx - 0.5, color: '#E05C35', label: '6/11\n定義変更' });
  if (idxNew > 0 && idxNew !== idx) boundaries.push({ at: idxNew - 0.5, color: '#6C757D', label: `W${lastOld + 1}から\nUTC木〜水`, labelY: 42 });

  const box = h('div', { class: 'chart-box chart-trend-all' });
  const canvas = h('canvas', { role: 'img', 'aria-label': '週次推移の棒グラフ' });
  box.append(canvas);
  card.replaceChildren(
    sectionHead('週次', `週次推移（W${from}〜W${last}）`, 'リリース影響週（UTC木〜水）。当週＝金色の縁、暫定＝薄い棒、未取得＝棒なし'),
    h('div', { class: 'controls' },
      seg([['all', '全期間'], ['w19', `W${DEFINITION_CHANGE_WEEK}以降`], ['12', '直近12週']], pref.wRange, v => { pref.wRange = v; redraw(); }, '期間'),
      seg([['plays', '再生数'], ['hours', '視聴時間'], ['listeners', '新規・リピーター'], ['fol', 'フォロワー増減']], pref.wMetric, v => { pref.wMetric = v; redraw(); }, '指標')),
    box,
    h('ul', { class: 'footnotes' },
      h('li', null, `W1〜W${DEFINITION_CHANGE_WEEK - 1}は 6/11 の再生数定義変更（30秒以上＝1再生）より前の値。W${DEFINITION_CHANGE_WEEK}以降と同じ物差しで比べない。`),
      lastOld !== null ? h('li', null, `W1〜W${lastOld}は旧窓（金〜木）の値（window_definition 未記録）。W${lastOld + 1}以降はUTC木〜水のリリース影響週。`,
        labelDiff.length ? `${labelDiff.map(n => 'W' + n).join('・')} は週ラベル（period）が旧窓のまま、値はUTC木〜水（week_windows）で集計されている。` : '') : null,
      h('li', null, '前週比はこの画面では出さない（週次レポート画面で、承認・7日・計数方法・窓の定義がそろう週だけ出す）。')),
    weekTable(ix, ws));
  if (rows.length) queueMicrotask(() => weeklyBars(canvas, rows, { currentWeek: null, boundaries, showValues: rows.length <= 20 || canvas.parentElement.clientWidth > 900, metric: pref.wMetric }));
}

function weekTable(ix, ws) {
  return h('details', { class: 'data-table' },
    h('summary', null, `週次の表（${ws.length}週）`),
    h('div', { class: 'tbl-scroll' },
      h('table', { class: 'tbl resp' },
        h('thead', null, h('tr', null, ['週', '窓', '状態', 'Spotify', '全PF', '視聴時間', '新規', 'リピーター', 'フォロワー'].map(t => h('th', null, t)))),
        h('tbody', null, [...ws].reverse().map(w => h('tr', null,
          h('td', { 'data-label': '週' }, h('a', { href: `#/week/${w.week_number}` }, `W${w.week_number}`)),
          h('td', { 'data-label': '窓', class: 'small' }, fmtWindowShort(weekWindow(ix, w))),
          h('td', { 'data-label': '状態' }, statusJa(w.status)),
          h('td', { 'data-label': 'Spotify' }, val(fmtInt(w.spotify_plays), srcWeek(ix, w, 'spotify_plays'))),
          h('td', { 'data-label': '全PF' }, val(fmtInt(w.all_platforms_streams), srcWeek(ix, w, 'all_platforms_streams'))),
          h('td', { 'data-label': '視聴時間' }, val(fmtHours(w.spotify_listening_hours), srcWeek(ix, w, 'spotify_listening_hours'))),
          h('td', { 'data-label': '新規' }, val(fmtInt(w.new_listeners), srcWeek(ix, w, 'new_listeners'))),
          h('td', { 'data-label': 'リピーター' }, val(fmtInt(w.repeat_listeners), srcWeek(ix, w, 'repeat_listeners'))),
          h('td', { 'data-label': 'フォロワー' }, val(num(w.spotify_followers_delta) === null ? MISSING : fmtSigned(w.spotify_followers_delta, '', 0), srcWeek(ix, w, 'spotify_followers_delta')))))))));
}

function dailyRange(ix, range) {
  const last = ix.daily.length ? ix.daily[ix.daily.length - 1].date : null;
  if (!last || range === 'all') return ix.daily;
  const from = addDays(last, -(Number(range) - 1));
  return ix.daily.filter(d => d.date >= from);
}

function drawDaily(card, ix, pref, redraw) {
  const rows = dailyRange(ix, pref.dRange);
  const labels = rows.map(d => d.date);
  const series = pref.dMetric === 'hours'
    ? [{ label: '視聴時間（h）', data: rows.map(d => num(d.spotify_listening_hours)), color: '#C8943C' }]
    : [{ label: 'Spotify再生', data: rows.map(d => num(d.spotify_plays)), color: '#4DD0C4' },
       { label: '全プラット', data: rows.map(d => num(d.all_platforms_streams)), color: '#00897B' }];
  const bIdx = labels.indexOf(DEFINITION_CHANGE_DATE);
  const box = h('div', { class: 'chart-box chart-daily' });
  const canvas = h('canvas', { role: 'img', 'aria-label': '日次推移の折れ線グラフ' });
  box.append(canvas);
  const nullSp = rows.filter(d => num(d.spotify_plays) === null).length;
  card.replaceChildren(
    sectionHead('日次', `日次推移（${labels[0] || MISSING}〜${labels[labels.length - 1] || MISSING}）`, '出典: daily_metrics（日付はUTC暦日）'),
    h('div', { class: 'controls' },
      seg([['30', '30日'], ['90', '90日'], ['all', '全期間']], pref.dRange, v => { pref.dRange = v; redraw(); }, '期間'),
      seg([['plays', '再生数'], ['hours', '視聴時間']], pref.dMetric, v => { pref.dMetric = v; redraw(); }, '指標')),
    box,
    h('ul', { class: 'footnotes' },
      bIdx >= 0 ? h('li', null, '6/11 の点線より前の Spotify 再生は旧定義。') : null,
      nullSp ? h('li', null, `Spotify再生が空（未取得）の日: ${nullSp}日。線は途切れて表示し、0にはしない。`) : null));
  if (rows.length) queueMicrotask(() => lineChart(canvas, labels, series, { boundaries: bIdx >= 0 ? [{ at: bIdx, color: '#E05C35', label: '6/11 定義変更' }] : [] }));
}

function drawFollowers(card, ix, pref) {
  const rows = dailyRange(ix, pref.dRange);
  const labels = rows.map(d => d.date);
  const box = h('div', { class: 'chart-box chart-daily' });
  const canvas = h('canvas', { role: 'img', 'aria-label': 'Spotifyフォロワー数の推移' });
  box.append(canvas);
  const vals = rows.map(d => num(d.spotify_followers));
  const present = vals.filter(v => v !== null);
  card.replaceChildren(
    sectionHead('フォロワー', 'Spotifyフォロワー数の推移', '出典: daily_metrics.spotify_followers（期間は日次と同じ切り替え）'),
    box,
    h('p', { class: 'calc-note' }, present.length
      ? `期間内: ${fmtInt(present[0])} → ${fmtInt(present[present.length - 1])}人。空の日 ${vals.length - present.length}日（未取得。線は途切れる）。`
      : 'この期間のフォロワー数は未取得'));
  if (present.length) queueMicrotask(() => lineChart(canvas, labels, [{ label: 'フォロワー', data: vals, color: '#C8943C' }], { beginAtZero: false }));
}
