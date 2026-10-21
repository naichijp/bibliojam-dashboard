// #/week/NN 週次レポート（PPTXの10枚と同じ順）
import { h, val } from '../lib/dom.js';
import {
  num, latestApprovedWeek, weekWindow, wowComparison, pctChange, episodesForWeek, epLabel, shortTitle,
  impressionsForWeek, repeatScreening, kaiyuRate, kaiyuHistory, DEFINITION_CHANGE_WEEK, jstDateTime, isLongForm,
} from '../lib/metrics.js';
import {
  MISSING, fmtInt, fmtHours, fmtSigned, fmtWindow, fmtWindowShort, fmtDur, fmtMD, statusJa, fmtDateTime, cohortJa, fmtYMD,
} from '../lib/format.js';
import { weeklyBars, kaiyuChart } from '../lib/charts.js';
import {
  srcWeek, insightBox, noteMissing, sectionHead, chip, firstWeekGrid, retentionBlock, cliffTable, dialogRow, epLink,
} from './common.js';
import { commentBox, notesPanel, appleEntry, strayCommentsCard } from './collab.js';
import { twoTop, ytDetail, funnel } from './youtube.js';
import { SECTION, sectionKey, weekSectionKeys } from '../lib/collab.js';

// cx：書き込み機能（main.js が作る。ローカル表示では writable=false で「ログインした公開版で使えます」を出す）
export function renderWeek(root, ix, param, cx = null) {
  const latest = latestApprovedWeek(ix);
  const wk = param ? Number(param) : latest?.week_number;
  const week = ix.weekByNum.get(wk);
  root.append(toolbar(ix, wk));
  if (!week) {
    root.append(h('section', { class: 'card' }, h('p', null, `W${param} のデータはありません。上の選択から週を選んでください。`)));
    return;
  }
  const prev = ix.weekByNum.get(wk - 1) || null;
  const notes = ix.notes[String(wk)] || null;
  const eps = episodesForWeek(ix, week);
  const ctx = { ix, week, prev, notes, eps, win: weekWindow(ix, week), cmp: wowComparison(ix, week, prev) };

  const toc = [['cover', '表紙'], ['notes', '文章と承認'], ['summary', 'サマリー'], ['twotop', 'Spotify×YouTube'], ['kpi', '全体KPI（Spotify）'], ['ytdetail', 'YouTube詳細'], ['funnel', '導線'], ['first', '初週'], ['ret', 'リテンション'], ['cliffs', '崖・対話'], ['kaiyu', '回遊'], ['wrap', '示唆と次アクション']];
  root.append(h('nav', { class: 'toc', 'aria-label': 'この週の目次' },
    toc.map(([id, label]) => h('button', { type: 'button', onclick: () => document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, label))));

  // 各節の最後にコメント欄（section_key は lib/collab.js の SECTION）
  const withComments = (el, key) => { if (el && cx) el.append(commentBox(cx, wk, key)); return el; };
  const parts = [
    cover(ctx),
    cx ? notesPanel(cx, ix, week, eps) : null,
    withComments(summary(ctx), SECTION.SUMMARY),
    twoTop(ctx),
    withComments(kpi(ctx), SECTION.KPI),
    ytDetail(ctx),
    funnel(ctx),
    h('div', { id: 'sec-first', class: 'anchor' }), ...eps.map(n => withComments(firstWeekSection(ctx, n, cx), sectionKey(SECTION.FIRST_WEEK, n))),
    eps.length ? null : h('section', { class: 'card' }, h('p', { class: 'missing-block' }, 'この週に公開した回が見つかりません（episodes の公開日で判定）')),
    h('div', { id: 'sec-ret', class: 'anchor' }), ...eps.map(n => withComments(retentionSection(ctx, n, eps.length ? Math.max(...eps) - 1 : undefined), sectionKey(SECTION.RETENTION, n))),
    withComments(cliffs(ctx), SECTION.CLIFFS),
    withComments(kaiyu(ctx), SECTION.KAIYU),
    withComments(wrap(ctx), SECTION.WRAP),
    cx ? strayCommentsCard(cx, wk, weekSectionKeys(eps)) : null];
  root.append(...parts.filter(Boolean));
}

// ── 週の選択 ─────────────────────────────────────────────────────────
function toolbar(ix, wk) {
  const sel = h('select', { id: 'week-select', 'aria-label': '週を選ぶ', onchange: e => { location.hash = `#/week/${e.target.value}`; } },
    [...ix.weeks].reverse().map(w => h('option', { value: w.week_number, selected: w.week_number === wk ? true : null },
      `W${w.week_number}（${fmtYMD(w.period_start)}〜）${w.status === 'approved' ? '' : ' 暫定'}`)));
  const has = n => ix.weekByNum.has(n);
  return h('div', { class: 'toolbar' },
    h('label', { for: 'week-select' }, '週'),
    sel,
    h('a', { class: `btn ${has(wk - 1) ? '' : 'disabled'}`, href: has(wk - 1) ? `#/week/${wk - 1}` : null, 'aria-disabled': has(wk - 1) ? null : 'true' }, '← 前の週'),
    h('a', { class: `btn ${has(wk + 1) ? '' : 'disabled'}`, href: has(wk + 1) ? `#/week/${wk + 1}` : null, 'aria-disabled': has(wk + 1) ? null : 'true' }, '次の週 →'));
}

// ── 1. 表紙 ─────────────────────────────────────────────────────────
function cover({ ix, week, notes, eps, win }) {
  const draft = week.status !== 'approved';
  const noteEps = notes?.cover?.episodes || [];
  const epItems = eps.map(n => {
    const ne = noteEps.find(e => num(e.num) === n);
    const e = ix.epByNum.get(n);
    const pub = e ? jstDateTime(e.published_at) : null;
    return h('li', null,
      h('a', { href: `#/episode/${n}`, class: 'cover-ep' }, `EP#${n}  ${shortTitle(ix, n).text}`),
      ne?.sub ? h('span', { class: 'cover-sub' }, ne.sub) : null,
      h('span', { class: 'cover-meta' },
        `配信: ${ne?.date || (pub ? `${pub.date.replace(/-/g, '.')} ${pub.time} JST` : MISSING)}  |  尺: ${ne?.durLabel || fmtDur(e?.duration_seconds)}  |  ${ne?.format || cohortJa(e?.duration_cohort)}`));
  });
  const dbEps = [week.primary_episode_number, ...(week.secondary_episode_numbers || [])].filter(v => v !== null && v !== undefined);
  return h('section', { id: 'sec-cover', class: 'cover' },
    h('div', { class: 'cover-left' },
      h('p', { class: 'logo' }, h('span', { class: 'logo-b' }, 'BIBLIO'), h('span', { class: 'logo-j' }, ' JAM')),
      h('p', { class: 'tagline' }, '読みたい本が、きっと見つかる！'),
      h('p', { class: 'tagline2' }, '新刊ノンフィクションを語るポッドキャスト')),
    h('div', { class: 'cover-right' },
      h('h1', null, '週次レポート', h('span', { class: 'en' }, 'Weekly Analytics Report')),
      h('div', { class: 'cover-row' },
        h('span', { class: 'week-badge' }, `Week ${week.week_number}`),
        h('span', { class: `status-badge ${draft ? 'draft' : 'final'}` }, draft ? '暫定' : '確定'),
        h('span', { class: 'cover-date' }, notes?.cover?.date_label || `${fmtYMD(week.period_start)} – ${fmtYMD(week.period_end)}`)),
      h('p', { class: 'cover-window', src: srcWeek(ix, week, 'period_start') }, `集計窓: ${fmtWindow(win)}`),
      win.labelDiffers ? h('p', { class: 'cover-window' }, `週ラベル（period）は ${fmtYMD(week.period_start)}〜${fmtYMD(week.period_end)} の旧窓のまま`) : null,
      notes?.cover?.badge ? h('p', { class: 'cover-badge' }, notes.cover.badge) : null,
      draft ? h('p', { class: 'cover-badge draft' }, `暫定：weekly_snapshots.status = ${week.status}。数値は確定前で、前週比は出しません。`) : null,
      h('p', { class: 'cover-h' }, `今週の配信（${eps.length}本）`),
      h('ul', { class: 'cover-eps' }, epItems),
      h('p', { class: 'cover-db', src: ['回の決め方: episodes.published_at（JST）の日付が週ラベル期間に入る回＋週の文章の表紙に載った回', '（2026-10-14方針：窓の数時間前の公開もその週の回。主・secondaryで分けない）'] },
        `DB上の主回: ${dbEps.length ? dbEps.map(n => '#' + n).join('・') : '未記録'}（weekly_snapshots.primary/secondary）`)));
}

// ── 2. エグゼクティブサマリー ────────────────────────────────────────
function summary({ week, notes }) {
  const s = notes?.summary;
  return h('section', { id: 'sec-summary', class: 'card dark' },
    sectionHead('エグゼクティブサマリー', s?.title || `W${week.week_number} エグゼクティブサマリー`, s?.subtitle),
    s?.items?.length
      ? h('div', { class: 'sum-items' }, s.items.map(it => h('article', { class: 'sum-item' },
        h('h3', null, `${it.icon ? it.icon + ' ' : ''}${it.head || ''}`), h('p', null, it.body || ''))))
      : noteMissing(),
    s?.footer ? h('p', { class: 'sec-foot' }, s.footer) : null,
    h('p', { class: 'ai-note' }, '見出し・本文は週の文章（notes）。数値の正本はDBで、この欄の数字は文章の一部として表示しています。'));
}

// ── 3. 全体KPI ──────────────────────────────────────────────────────
function tile(value, unit, desc, color, report) {
  return h('div', { class: 'tile', style: { '--tc': color } },
    h('div', { class: 'tile-v' }, value),
    h('div', { class: 'tile-u' }, unit),
    h('div', { class: 'tile-d' }, desc),
    report ? h('div', { class: 'tile-r' }, `レポート記載: ${report}`) : null);
}

function wowText(ix, cur, prev, cmp, field, fmt, unit = '') {
  if (!cmp.ok) return val('—（比較不可）', ['前週比を出さない理由:', ...cmp.reasons], 'muted');
  const c = pctChange(cur[field], prev[field]);
  if (c === null) return val('—（比較不可）', ['前週の値が未取得、または0'], 'muted');
  return val(`前週${fmt(prev[field])}${unit}から${fmtSigned(c, '%')}`, srcWeek(ix, prev, field, `前週比 = (W${cur.week_number} − W${prev.week_number}) ÷ W${prev.week_number}`));
}

function kpi(ctx) {
  const { ix, week, prev, notes, cmp } = ctx;
  const nt = notes?.kpi;
  const rt = i => nt?.tiles?.[i]?.d || null;
  const plain = v => fmtInt(v);
  const tiles = h('div', { class: 'tiles' },
    tile(val(fmtInt(week.spotify_plays), srcWeek(ix, week, 'spotify_plays')), 'Spotify 再生',
      prev ? wowText(ix, week, prev, cmp, 'spotify_plays', plain) : '—（前週なし）', '#00CCBA', rt(0)),
    tile(val(fmtInt(week.all_platforms_streams), srcWeek(ix, week, 'all_platforms_streams')), '全プラット',
      prev ? wowText(ix, week, prev, cmp, 'all_platforms_streams', plain) : '—（前週なし）', '#009E8E', rt(1)),
    tile(val(fmtHours(week.spotify_listening_hours), srcWeek(ix, week, 'spotify_listening_hours')), '視聴時間',
      prev ? wowText(ix, week, prev, cmp, 'spotify_listening_hours', v => fmtHours(v).replace('h', ''), 'h') : '—（前週なし）', '#C8943C', rt(2)),
    tile(val(fmtInt(week.new_listeners), srcWeek(ix, week, 'new_listeners')), '新規リスナー',
      prev && cmp.ok
        ? val(`前週${fmtInt(prev.new_listeners)}（リピーター${fmtInt(prev.repeat_listeners)}→${fmtInt(week.repeat_listeners)}）`, srcWeek(ix, prev, 'new_listeners'))
        : val('—（比較不可）', ['前週比を出さない理由:', ...(prev ? cmp.reasons : ['前週のデータがない'])], 'muted'),
      '#E05C35', rt(3)));

  // 過去3週
  const hist = [week.week_number - 2, week.week_number - 1, week.week_number].map(n => ix.weekByNum.get(n)).filter(Boolean);
  const table = h('table', { class: 'tbl hist' },
    h('thead', null, h('tr', null, h('th', null, ''), hist.map(w => h('th', { class: w === week ? 'cur' : '' }, `W${w.week_number}${w === week ? '（今週）' : ''}${w.status !== 'approved' ? ' 暫定' : ''}`)))),
    h('tbody', null,
      h('tr', null, h('th', null, 'Spotify再生'), hist.map(w => h('td', { class: w === week ? 'cur' : '' }, val(fmtInt(w.spotify_plays), srcWeek(ix, w, 'spotify_plays'))))),
      h('tr', null, h('th', null, '全プラット'), hist.map(w => h('td', { class: w === week ? 'cur' : '' }, val(fmtInt(w.all_platforms_streams), srcWeek(ix, w, 'all_platforms_streams'))))),
      h('tr', null, h('th', null, '視聴時間'), hist.map(w => h('td', { class: w === week ? 'cur' : '' }, val(fmtHours(w.spotify_listening_hours), srcWeek(ix, w, 'spotify_listening_hours'))))),
      h('tr', null, h('th', null, '配信回'), hist.map(w => h('td', { class: `small ${w === week ? 'cur' : ''}` }, episodesForWeek(ix, w).map(n => `EP#${n}`).join('・') || MISSING))),
      h('tr', null, h('th', null, '集計窓'), hist.map(w => h('td', { class: `small ${w === week ? 'cur' : ''}` }, fmtWindowShort(weekWindow(ix, w)))))));

  // 週次推移（W19以降）
  const rows = ix.weeks.filter(w => w.week_number >= DEFINITION_CHANGE_WEEK && w.week_number <= week.week_number).map(w => ({
    week: w.week_number, sp: num(w.spotify_plays), all: num(w.all_platforms_streams), status: w.status,
    windowLabel: fmtWindowShort(weekWindow(ix, w)),
  }));
  const box = h('div', { class: 'chart-box chart-trend' });
  const canvas = h('canvas', { role: 'img', 'aria-label': `W${DEFINITION_CHANGE_WEEK}からW${week.week_number}までの週次再生数の棒グラフ` });
  box.append(canvas);
  if (rows.length) {
    queueMicrotask(() => weeklyBars(canvas, rows, {
      currentWeek: week.week_number,
      boundaries: [{ at: -0.5, color: '#E05C35', label: '6/11\n定義変更' }],
    }));
  } else {
    box.classList.add('empty');
    box.replaceChildren(h('p', { class: 'missing-block' }, `この週はW${DEFINITION_CHANGE_WEEK}より前（6/11の定義変更前）のため、ここには表示しません。全期間は「推移」画面へ。`));
  }

  return h('section', { id: 'sec-kpi', class: 'card' },
    sectionHead('全体KPI', nt?.title || `W${week.week_number} 全体KPI`, nt?.subtitle || `集計窓: ${fmtWindow(ctx.win)}`),
    tiles,
    h('div', { class: 'tbl-scroll' }, table),
    h('h3', { class: 'h3' }, `週次推移（W${DEFINITION_CHANGE_WEEK}以降・Spotify／全プラット）`),
    box,
    h('p', { class: 'calc-note' }, `W${DEFINITION_CHANGE_WEEK}以降を表示（6/11の再生数定義変更以降）。今週の棒は金色の縁。薄い棒は暫定。全期間は「推移」画面。`),
    nt?.footnotes?.length ? h('ul', { class: 'footnotes' }, nt.footnotes.map(f => h('li', null, f))) : null,
    !notes ? noteMissing() : null);
}

// ── 4. 回ごとの初週 ─────────────────────────────────────────────────
function firstWeekSection({ ix, notes }, n, cx) {
  const ns = notes?.episode_sections?.find(s => num(s.episode_number) === n) || null;
  const e = ix.epByNum.get(n);
  return h('section', { class: 'card' },
    sectionHead(`初週  ${epLabel(ix, n)}`, ns?.title || `${epLabel(ix, n)} の初週`, ns?.subtitle || '配信日から7日間（EP基準）'),
    h('div', { class: 'ep-banner' },
      h('p', { class: 'b1' }, ns?.banner || `EP#${n}  ${shortTitle(ix, n).text}`),
      h('p', { class: 'b2' }, ns?.banner_sub || `${cohortJa(e?.duration_cohort)}  |  尺 ${fmtDur(e?.duration_seconds)}`),
      h('a', { class: 'b-link', href: `#/episode/${n}` }, 'この回の詳細 →')),
    firstWeekGrid(ix, n, ns),
    ns?.footnote ? h('p', { class: 'calc-note' }, ns.footnote) : null,
    insightBox(ns?.insight),
    !ns && notes ? noteMissing('この回の初週の文章はありません') : null,
    cx ? appleEntry(cx, ix, n) : null);
}

// ── 5. 回ごとのリテンション ─────────────────────────────────────────
function retentionSection({ ix, notes }, n, avgTo) {
  const ns = notes?.retention_sections?.find(s => num(s.episode_number) === n) || null;
  return h('section', { class: 'card' },
    sectionHead(`リテンション  ${epLabel(ix, n)}`, ns?.title || `${epLabel(ix, n)} のリテンション`, ns?.subtitle || null),
    isLongForm(ix, n) ? h('div', { class: 'chips' }, chip('倍尺回', 'gold')) : null,
    retentionBlock(ix, n, ns, { avgTo }),
    insightBox(ns?.insight));
}

// ── 6. 崖と対話 ─────────────────────────────────────────────────────
function cliffs({ ix, notes, eps }) {
  const nc = notes?.cliffs;
  return h('section', { id: 'sec-cliffs', class: 'card' },
    sectionHead('崖検出・対話メトリクス', nc?.title || '崖検出と対話メトリクス', nc?.subtitle || '30秒以内に5pt以上の落差を崖とする'),
    h('div', { class: 'cliff-grid' }, eps.map(n => cliffTable(ix, n, nc?.tables?.find(t => num(t.episode_number) === n)?.label))),
    h('h3', { class: 'h3' }, '💬 対話メトリクス'),
    h('div', { class: 'dialog-box' }, eps.map(n => dialogRow(ix, n))),
    nc?.dialog_note ? h('p', { class: 'calc-note' }, nc.dialog_note) : null,
    insightBox(nc?.insight),
    !nc ? noteMissing() : null);
}

// ── 7. 回遊 ─────────────────────────────────────────────────────────
function kaiyu(ctx) {
  const { ix, week, prev, notes, cmp } = ctx;
  const nk = notes?.kaiyu;
  const rt = i => nk?.tiles?.[i]?.d || null;
  const imp = impressionsForWeek(ix, week);
  const impPrev = prev ? impressionsForWeek(ix, prev) : null;
  const impSrc = [
    `出典: csv_extras.daily.impressions（日次CSVの窓内${imp.of}日の合計。${imp.days}日分あり）`,
    `集計窓: ${fmtWindow(imp.window)}`,
    imp.files.length ? `ファイル: ${imp.files.map(f => f.split('/').slice(-2).join('/')).join('、')}` : '',
    imp.dbValue !== null ? `別指標：weekly_snapshots.impressions は Spotify「発見タブ」のインプレッション（${fmtInt(imp.dbValue)}）。日次合計とは別物なのでここには使わない。` : '',
  ];
  let impDesc;
  if (!cmp.ok) impDesc = val('—（比較不可）', ['前週比を出さない理由:', ...cmp.reasons], 'muted');
  else if (imp.value === null || !impPrev || impPrev.value === null) impDesc = val('—（比較不可）', ['日次インプレッションが7日そろっていない週がある'], 'muted');
  else impDesc = val(`W${prev.week_number}の${fmtInt(impPrev.value)}から${fmtSigned(pctChange(imp.value, impPrev.value), '%')}`, [`W${prev.week_number}: 日次CSVの窓内合計 ${fmtInt(impPrev.value)}`]);

  const kr = kaiyuRate(ix, week);
  const krSrc = [
    '回遊率 =（全プラットの週次 − その週の新作の窓内再生）÷ 全プラットの週次',
    `分母: weekly_snapshots.all_platforms_streams = ${fmtInt(kr.den)}`,
    ...kr.parts.map(p => `EP#${p.episode_number}: ${p.from}〜${p.to}（公開UTC日から7日と窓の重なり ${p.days}日）= ${p.plays === null ? '未取得' : fmtInt(p.plays)}（csv_extras.episode_daily・ストリーミング数とダウンロード数）`),
    kr.ok ? `= ${kr.pct}%` : `計算できない: ${kr.reasons.join('／')}`,
  ];
  const krFormula = kr.ok ? `(${fmtInt(kr.den)}${kr.parts.map(p => `−#${p.episode_number}の${fmtInt(p.plays)}`).join('')})/${fmtInt(kr.den)}` : kr.reasons.join('／');
  const mismatch = kr.ok && num(nk?.kaiyu_pct) !== null && num(nk.kaiyu_pct) !== kr.pctInt;
  const histNow = (() => { const r = kaiyuHistory(ix.kaiyu).find(x => x.week === week.week_number); return r ? (r.b ?? r.a) : null; })();

  const fol = num(week.spotify_followers_delta);
  const tiles = h('div', { class: 'tiles' },
    tile(val(`${fmtInt(week.repeat_listeners)}/${fmtInt(week.new_listeners)}`, srcWeek(ix, week, 'repeat_listeners / new_listeners')), 'リピーター/新規',
      `番組全体・W${week.week_number}窓の実測`, '#00CCBA', rt(0)),
    tile(val(fmtInt(imp.value), impSrc), 'インプレッション（日次合計）', impDesc, '#6C757D', rt(1)),
    tile(val(fol === null ? MISSING : fmtSigned(fol, '', 0), srcWeek(ix, week, 'spotify_followers_delta')), 'フォロワー増減',
      val(`${fmtInt(week.spotify_followers_start)} → ${fmtInt(week.spotify_followers_end)}${num(week.spotify_followers_end) === null ? '' : '人'}`, srcWeek(ix, week, 'spotify_followers_start / end')), '#C8943C', rt(2)),
    tile(val(kr.ok ? `${kr.pctInt}%` : MISSING, krSrc), '回遊率（全PF・参考）', krFormula, '#E05C35', rt(3)));

  // 推移グラフ
  const histRows = kaiyuHistory(ix.kaiyu);
  const kh = ix.kaiyu || {};
  const idxOf = w => histRows.findIndex(r => r.week === w);
  const bnd = [];
  const defB = kh.boundaries?.definition_change_2026_06_11 || [18, 19];
  const serB = kh.boundaries?.series_b_start || [29, 30];
  if (idxOf(defB[1]) > 0) bnd.push({ at: idxOf(defB[1]) - 0.5, color: '#E05C35', label: '6/11\n定義変更' });
  if (idxOf(serB[1]) > 0) bnd.push({ at: idxOf(serB[1]) - 0.5, color: '#1B5E50', label: '系列B\n開始', labelY: 40 });
  const box = h('div', { class: 'chart-box chart-kaiyu' });
  const canvas = h('canvas', { role: 'img', 'aria-label': '回遊率の推移（系列Aと系列Bを別の棒で表示）' });
  box.append(canvas);
  if (histRows.length) queueMicrotask(() => kaiyuChart(canvas, histRows, { currentWeek: week.week_number, boundaries: bnd, labels: kh.series_labels, colors: kh.colors }));
  else box.replaceChildren(h('p', { class: 'missing-block' }, '回遊率の過去系列（kaiyu_history）が未取得'));

  // スクリーニング
  const sc = repeatScreening(ix, week);
  const cells = sc.rows.map(r => h('div', { class: `scr ${r.flag ? 'flag' : ''}`, src: [
    `${r.date}：Spotify再生 ${fmtInt(r.plays)}（daily_metrics.spotify_plays）÷ オーディエンス ${fmtInt(r.audience)}（csv_extras.daily.spotify_audience）`,
    r.source ? `CSV: ${r.source.split('/').slice(-2).join('/')}` : 'CSV: なし',
    `視聴時間 ${fmtHours(r.hours)}（daily_metrics.spotify_listening_hours）`,
    `${sc.threshold}倍超で★`,
  ] },
    h('div', { class: 'scr-d' }, fmtMD(r.date)),
    h('div', { class: 'scr-r' }, r.ratioLabel === null ? MISSING : `${r.ratioLabel}${r.flag ? '★' : ''}`),
    h('div', { class: 'scr-x' }, `${fmtInt(r.plays)}/${fmtInt(r.audience)}`),
    h('div', { class: 'scr-h' }, fmtHours(r.hours))));

  return h('section', { id: 'sec-kaiyu', class: 'card' },
    sectionHead('回遊分析', nk?.title || `W${week.week_number} 回遊分析`, nk?.subtitle || '番組全体・週次（各回単体の値ではない）'),
    tiles,
    mismatch ? h('p', { class: 'warn-line' }, `注意: 画面で計算した回遊率 ${kr.pctInt}% と、レポート記載の ${nk.kaiyu_pct}% が一致しません。`,
      h('span', { class: 'warn-sub' }, `過去のレポートは計算方法の見直し（2026-09-30、分子と分母を全PF同士にそろえた）より前の値のことがあります。推移グラフの系列Bは見直し後の値で、W${week.week_number}は ${histNow ?? '—'}%。`)) : null,
    num(nk?.kaiyu_alt) !== null ? h('p', { class: 'calc-note' }, `レポート記載の参考値: ${nk.kaiyu_alt}%（窓の定義どおりに数えた場合。文章の値）`) : null,
    h('h3', { class: 'h3' }, nk?.chart_caption || '回遊率の推移（参考。系列Aと系列Bは別の計算で、連続比較しない）'),
    box,
    kh.chart_footnote ? h('p', { class: 'calc-note pre' }, kh.chart_footnote) : null,
    h('h3', { class: 'h3' }, nk?.screening_caption || `反復再生スクリーニング（Spotify日次：再生数 ÷ オーディエンス。${sc.threshold}倍超=★）`),
    h('div', { class: 'scr-grid' }, cells),
    h('p', { class: 'calc-note' }, `週全体: ${sc.weekRatioLabel === null ? '計算できない（日次がそろっていない）' : sc.weekRatioLabel + '倍'}（窓内のSpotify再生合計 ÷ オーディエンス合計）。各セル：比率／再生/オーディエンス／当日の視聴時間。`),
    h('p', { class: 'calc-note' }, '前週比リテンション（wow_retention_pct）: —（週次では掲載しない運用ルール。CSVの週区切りがリリース影響週と一致しないため）'),
    nk?.footnote ? h('p', { class: 'calc-note' }, nk.footnote) : null,
    insightBox(nk?.insight),
    !nk ? noteMissing() : null);
}

// ── 8. 示唆と次アクション ───────────────────────────────────────────
function wrap({ week, notes }) {
  const w = notes?.wrap;
  return h('section', { id: 'sec-wrap', class: 'card dark' },
    sectionHead('示唆と次アクション', w?.title || '今週の示唆と次アクション', w?.subtitle),
    w ? h('div', { class: 'wrap-grid' },
      h('div', null,
        h('h3', { class: 'h3 cyan' }, '✅ 良かった点'),
        h('ul', { class: 'pos' }, (w.positives || []).map(p => h('li', null, p))),
        h('h3', { class: 'h3 gold' }, '🔧 課題'),
        (w.issues || []).map(i => h('div', { class: 'issue' }, h('p', { class: 'ih' }, i.head), h('p', null, i.body)))),
      h('div', null,
        h('h3', { class: 'h3 gold' }, `来週やること（${(w.nexts || []).length}点）`),
        (w.nexts || []).map(x => h('div', { class: 'next' }, h('p', { class: 'nh' }, `${x.num || ''}  ${x.title || ''}`), h('p', null, x.detail || ''))))) : noteMissing(),
    w?.closing ? h('p', { class: 'closing' }, w.closing) : null,
    w?.footer ? h('p', { class: 'sec-foot' }, w.footer) : null);
}
