// 週次レポートと回の詳細で共通に使う部品
import { h, val } from '../lib/dom.js';
import {
  num, weekWindow, firstWeekFor, retentionFor, retentionAverage, diffPt, cleanTs5s, isLongForm,
  cliffsFor, cliffClassJa, dialogFor, epLabel, Q_KEYS, utcDate, isYoutubeApiRow, youtubeApiLabel, youtubeApiCompare,
} from '../lib/metrics.js';
import {
  MISSING, fmtInt, fmtHours, fmtSigned, fmtMinutes, fmtMMSS, fmtDur, fmtWindow, fmtDateTime,
  fmtNum, statusJa, truncate, fmtYMD,
} from '../lib/format.js';
import { retentionChart, chartAvailable } from '../lib/charts.js';
import {
  appleFirstWeekView, appleInputsFor, appleConsumeView, consumeAsOfLabel, fmtConsume, memberName, APPLE_STATUS_JA, APPLE_CONSUME,
} from '../lib/collab.js';

// ── 出典テキスト ─────────────────────────────────────────────────────
export function approvedText(row) {
  if (!row) return '';
  if (row.status && row.status !== 'approved') return `状態: ${statusJa(row.status)}`;
  return row.approved_at ? `承認: ${fmtDateTime(row.approved_at)}` : '承認日時: 不明';
}

export function srcWeek(ix, week, field, extra) {
  const win = weekWindow(ix, week);
  return [
    `出典: weekly_snapshots.${field}（W${week.week_number}・${statusJa(week.status)}）`,
    `集計窓: ${fmtWindow(win)}${win.labelDiffers ? `（週ラベルは ${week.period_start}〜${week.period_end} の旧窓）` : ''}`,
    `取得方法: ${week.source_method || '未記録'}／計数: ${week.count_method || '未記録'}`,
    approvedText(week),
    extra,
  ];
}

export function firstWeekFlag(row) {
  if (!row) return '';
  if (isYoutubeApiRow(row)) return youtubeApiLabel(row);   // 7日分だが Studio の168時間とは窓が違う（CONTRACT 1節）
  if (row.exact_first_week === true) return '初週（公開から7日）';
  if (row.exact_first_week === false) return '初週ではない（参考値）';
  return '初週かどうか未確認';
}

export function srcFW(row, field, extra) {
  if (!row) return ['出典: episode_first_week_metrics（該当行なし）'];
  return [
    `出典: episode_first_week_metrics.${field}（id=${row.id ?? '?'}・${row.platform}${row.video_type ? '/' + row.video_type : ''}・data_type=${row.data_type || '未記録'}）`,
    `期間: ${row.period_start || '未記録'}〜${row.period_end || '未記録'}（${firstWeekFlag(row)}）`,
    approvedText(row),
    row.notes ? `注記: ${truncate(row.notes, 360)}` : '',
    extra,
  ];
}

export function srcRet(ret, field, extra) {
  if (!ret) return ['出典: episode_retention（該当行なし）'];
  return [
    `出典: episode_retention.${field}（EP#${ret.episode_number}・各回の最新approved）`,
    `計測期間: ${ret.measured_period_start || '未記録'}〜${ret.measured_period_end || '未記録'}`,
    `取得方法: ${ret.source_method || '未記録'}${ret.is_interpolated ? '（補間値）' : ''}`,
    approvedText(ret),
    extra,
  ];
}

// ── 小さな部品 ───────────────────────────────────────────────────────
export function insightBox(ins) {
  if (!ins || !ins.text) return null;
  return h('div', { class: 'insight' }, h('strong', null, (ins.label || '示唆:') + ' '), ins.text);
}

export function noteMissing(text = 'この週の文章（notes）はまだありません') {
  return h('p', { class: 'note-missing' }, text);
}

export function sectionHead(kicker, title, subtitle) {
  return h('header', { class: 'sec-head' },
    kicker ? h('p', { class: 'kicker' }, kicker) : null,
    h('h2', null, title),
    subtitle ? h('p', { class: 'sub' }, subtitle) : null);
}

export function chip(text, cls = '') { return h('span', { class: `chip ${cls}`.trim() }, text); }

export function epLink(ix, n) {
  return h('a', { href: `#/episode/${n}`, class: 'ep-link' }, epLabel(ix, n));
}

// ── 初週（4列） ─────────────────────────────────────────────────────
function notePlatforms(section) {
  const out = {};
  for (const p of section?.platforms || []) {
    const l = p.label || '';
    const key = /Shorts/i.test(l) ? 'shorts' : /YouTube/i.test(l) ? 'youtube_long' : /Apple/i.test(l) ? 'apple' : /Spotify/i.test(l) ? 'spotify' : null;
    if (key) out[key] = p;
  }
  return out;
}

function row(label, valueNode, extra) {
  return h('div', { class: 'kv' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, valueNode, extra ? h('span', { class: 'kv-extra' }, extra) : null));
}

function pfColumn(key, title, color, body, noteP, flags = []) {
  return h('section', { class: `pf pf-${key}`, style: { '--pf': color } },
    h('h4', { class: 'pf-title' }, title),
    noteP && noteP.label && noteP.label !== title ? h('p', { class: 'pf-sub' }, `レポートの見出し: ${noteP.label}`) : null,
    flags.length ? h('div', { class: 'chips' }, flags) : null,
    h('div', { class: 'pf-body' }, body),
    noteP && noteP.rows && noteP.rows.length
      ? h('details', { class: 'pf-notes', open: true }, h('summary', null, 'レポート注記'), h('ul', null, noteP.rows.map(r => h('li', null, r))))
      : null);
}

function fwFlags(main) {
  const f = [];
  if (!main) return f;
  if (main.exact_first_week !== true) f.push(chip(firstWeekFlag(main), 'warn'));
  if (main.status === 'approved' && !main.approved_at) f.push(chip('承認日時不明', 'muted'));
  return f;
}

// YouTube の欄：Studio の主の行と、API の参考値の行を並べる（2026-10-14〜 API は参考値。正本は Studio）
function ytApiLine(group) {
  const c = youtubeApiCompare(group);
  if (!c) return null;
  const d = (x, unit, fmt) => (x ? `${fmt(x.api)}${unit}（Studio比 ${fmtSigned(x.diff, unit, unit === '回' ? 0 : 1)}${x.pct !== null ? `・${fmtSigned(x.pct, '%', 1)}` : ''}）` : null);
  const parts = [
    d(c.views, '回', fmtInt),
    d(c.watch_hours, 'h', v => fmtNum(v, 1)),
    c.api.avg_view_min !== null && c.api.avg_view_min !== undefined ? `平均視聴 ${fmtMinutes(c.api.avg_view_min)}` : null,
  ].filter(Boolean);
  return h('div', { class: 'kv-others' }, `${youtubeApiLabel(c.api)}: `,
    val(parts.join('・') || '値なし', srcFW(c.api, 'plays_or_views', '窓の違い：API は太平洋時間の暦日7日（約160時間）、Studio は公開から168時間。差の多くはこの違い（docs/YouTube_API切り替え案.md 2-3）')));
}

function shortsCount(fw) {
  if (fw.shortsVideos.length > 1) return fw.shortsVideos.length;
  const m = String(fw.shorts.main?.notes || '').match(/Shorts[がは]?\s*(\d+)\s*本/);
  return m ? Number(m[1]) : (fw.shorts.main ? 1 : 0);
}

export function firstWeekGrid(ix, n, noteSection) {
  const fw = firstWeekFor(ix, n);
  const np = notePlatforms(noteSection);
  const sp = fw.spotify.main, ap = fw.apple.main, yt = fw.youtube_long.main, sh = fw.shorts.main;

  const spBody = sp ? [
    row('再生数とDL（全PF統合）', val(fmtInt(sp.plays_or_views), srcFW(sp, 'plays_or_views'), 'big'),
      num(sp.vs_standard_pct) !== null ? val(`標準比${fmtSigned(sp.vs_standard_pct, '%', 0)}`, srcFW(sp, 'vs_standard_pct')) : null),
    row('視聴時間', val(fmtHours(sp.watch_hours), srcFW(sp, 'watch_hours'))),
    row('オーディエンス', val(num(sp.listeners) === null ? MISSING : `${fmtInt(sp.listeners)}人`, srcFW(sp, 'listeners'))),
    row('平均視聴時間', val(fmtMinutes(sp.avg_view_min), srcFW(sp, 'avg_view_min'))),
    row('期間', val(`${fmtYMD(sp.period_start)}〜${fmtYMD(sp.period_end)}`, srcFW(sp, 'period_start'))),
  ] : [h('p', { class: 'missing-block' }, 'Spotifyの初週は未取得')];

  const apOthers = fw.apple.others;
  // Apple の手入力（公開版の bundle.apple_inputs）。approved の行があればそちらを優先し、無いときだけ「手入力（未承認）」を出す
  const apView = appleFirstWeekView(ap, appleInputsFor(ix.bundle, n));
  // 平均消費率（全期間）：first_week の Apple 行（approved）の consume_pct を優先、無ければ承認前の手入力（2026-10-14〜 人が入力）
  const cView = appleConsumeView([ap, ...fw.apple.others], appleInputsFor(ix.bundle, n, APPLE_CONSUME));
  const consumeRow = appleConsumeRow(ix, n, cView);
  const apBody = ap ? [
    row('再生数', val(fmtInt(ap.plays_or_views), srcFW(ap, 'plays_or_views'), 'big'),
      ap.data_type === 'first_week' ? '（日別合計）' : '（全期間の値）'),
    num(ap.listeners) !== null ? row('リスナー', val(`${fmtInt(ap.listeners)}人`, srcFW(ap, 'listeners'))) : null,
    consumeRow,
    row('期間', val(ap.period_start ? `${fmtYMD(ap.period_start)}〜${fmtYMD(ap.period_end)}` : MISSING, srcFW(ap, 'period_start'))),
    apOthers.length ? h('div', { class: 'kv-others' }, '別の取り方: ', apOthers.map((o, i) => [i ? '／' : '',
      val(`${o.data_type === 'reference' ? '全期間' : o.data_type || '別行'} 再生${fmtInt(o.plays_or_views)}${num(o.listeners) !== null ? '・リスナー' + fmtInt(o.listeners) : ''}${num(o.consume_pct) !== null ? '・消費率' + fmtConsume(o.consume_pct) : ''}`, srcFW(o, 'plays_or_views'))])) : null,
    h('p', { class: 'pf-caution' }, '72時間遅延のため参考値。他のプラットフォームと順位を比べない。'),
    apView.pending ? h('p', { class: 'kv-others' }, val(`未承認の手入力: 合計${fmtInt(apView.pending.value)}`, srcManual(ix, apView.pending)), '（表示は承認済みの値を優先）') : null,
  ] : apView.manual ? [...manualAppleBody(ix, apView.manual), consumeRow]
    : cView.show !== 'none' ? [h('p', { class: 'missing-block' }, 'Appleの初週の再生は未取得'), consumeRow]
      : [h('p', { class: 'missing-block' }, 'Appleの初週は未取得')];

  const ytBody = yt ? [
    row('視聴回数', val(num(yt.plays_or_views) === null ? MISSING : `${fmtInt(yt.plays_or_views)}回`, srcFW(yt, 'plays_or_views'), 'big')),
    row('CTR', val(num(yt.ctr_pct) === null ? MISSING : `${fmtNum(yt.ctr_pct, 1)}%`, srcFW(yt, 'ctr_pct'))),
    row('総再生時間', val(num(yt.watch_hours) === null ? MISSING : `${fmtNum(yt.watch_hours, 1)}h`, srcFW(yt, 'watch_hours'))),
    row('平均視聴時間', val(fmtMinutes(yt.avg_view_min), srcFW(yt, 'avg_view_min'))),
    num(yt.unique_viewers) !== null ? row('ユニーク視聴者', val(`${fmtInt(yt.unique_viewers)}人`, srcFW(yt, 'unique_viewers'))) : null,
    ytApiLine(fw.youtube_long),
  ] : [h('p', { class: 'missing-block' }, 'YouTube長尺の初週は未取得')];

  const count = shortsCount(fw);
  const shBody = sh ? [
    row(count > 1 ? `視聴回数（${count}本の合算）` : '視聴回数', val(num(sh.plays_or_views) === null ? MISSING : `${fmtInt(sh.plays_or_views)}回`, srcFW(sh, 'plays_or_views'), 'big')),
    row('総再生時間', val(num(sh.watch_hours) === null ? MISSING : `${fmtNum(sh.watch_hours, 1)}h`, srcFW(sh, 'watch_hours'))),
    count > 1
      ? h('p', { class: 'pf-caution' }, '継続率・平均視聴時間は複数本を合算しない。')
      : row('平均視聴時間', val(fmtMinutes(sh.avg_view_min), srcFW(sh, 'avg_view_min'))),
    fw.shortsVideos.length ? h('div', { class: 'kv-others' }, '内訳（youtube_videos）: ',
      fw.shortsVideos.map((v, i) => [i ? '／' : '', val(fmtInt(v.views_week1 ?? v.views_total), [`出典: youtube_videos（${v.video_id}）`, `${v.title || ''}`, v.views_week1 !== null && v.views_week1 !== undefined ? '値: views_week1（7日）' : '値: views_total（累計。7日値なし）'])])) : null,
    ytApiLine(fw.shorts),
  ] : [h('p', { class: 'missing-block' }, 'Shortsの初週は未取得')];

  return h('div', { class: 'pf-grid' },
    pfColumn('spotify', 'Spotify（全PF統合）', '#00CCBA', spBody, np.spotify, fwFlags(sp)),
    pfColumn('apple', 'Apple（参考値）', '#8E6914', apBody, np.apple, ap ? fwFlags(ap) : apView.manual || cView.manual ? [chip('手入力（未承認）', 'warn')] : []),
    pfColumn('yt', 'YouTube長尺', '#C0392B', ytBody, np.youtube_long, fwFlags(yt)),
    pfColumn('shorts', count > 1 ? `YouTube Shorts（${count}本）` : 'YouTube Shorts', '#6A3FA0', shBody, np.shorts, fwFlags(sh)));
}

function srcManual(ix, r) {
  return [
    `出典: apple_manual_inputs（受付ID ${r.id}・${APPLE_STATUS_JA[r.status] || r.status}）。人が Apple Podcasts Connect のトレンドタブで読んだ値`,
    `期間: ${r.period_start || '未記録'}〜${r.period_end || '未記録'}（UTC・公開日から7日）`,
    Array.isArray(r.daily_values) ? `日別: ${r.daily_values.join('・')}（合計 ${fmtInt(r.value)}）` : '日別の内訳なし',
    `入力: ${memberName(ix.bundle, r.entered_by)}・${fmtDateTime(r.entered_at)}`,
    r.source_note ? `出典メモ: ${truncate(r.source_note, 300)}` : '',
    '承認前の値。承認されると episode_first_week_metrics の行に置き換わる',
  ];
}

// 平均消費率の行（承認済み → 手入力（未承認）→ 未取得）
function appleConsumeRow(ix, n, v) {
  if (v.show === 'approved') {
    const r = v.approved;
    const kind = r.data_type === 'reference' ? '全期間の値・取得時点の参考値' : r.data_type === 'first_week' ? '初週の行' : (r.data_type || '別の行');
    return [
      row('平均消費率', val(fmtConsume(r.consume_pct), srcFW(r, 'consume_pct')), `（承認済み・${kind}）`),
      v.pending ? h('p', { class: 'kv-others' }, val(`未承認の手入力: 消費率 ${fmtConsume(v.pending.value)}（${consumeAsOfLabel(v.pending)}）`, srcManualConsume(ix, n, v.pending)), '（表示は承認済みの値を優先）') : null];
  }
  if (v.show === 'manual') {
    const r = v.manual;
    return [
      row('平均消費率', val(fmtConsume(r.value), srcManualConsume(ix, n, r)), `（手入力（未承認）・${consumeAsOfLabel(r)}）`),
      h('p', { class: 'pf-caution' }, '平均消費率は手入力（未承認）。エピソード個別ページの全期間の値で、読んだ日によって変わる。')];
  }
  return row('平均消費率', val(MISSING, ['平均消費率（全期間）は未取得', '2026-10-14〜：配信7日目以降に、エピソード個別ページの全期間の値を人が読んで入れる']));
}

function srcManualConsume(ix, n, r) {
  const pub = utcDate(ix.epByNum.get(n)?.published_at);
  return [
    `出典: apple_manual_inputs（受付ID ${r.id}・${APPLE_STATUS_JA[r.status] || r.status}）。人が Apple Podcasts Connect のエピソード個別ページで読んだ、全期間の平均消費率`,
    `期間: 公開日 ${pub || '未登録'}〜読んだ日 ${r.period_end || '未記録'}（UTC。DBは始まりの日を空で保存する）`,
    `入力: ${memberName(ix.bundle, r.entered_by)}・${fmtDateTime(r.entered_at)}`,
    r.source_note ? `出典メモ: ${truncate(r.source_note, 300)}` : '',
    '承認前の値',
  ];
}

function manualAppleBody(ix, r) {
  return [
    row('再生数', val(fmtInt(r.value), srcManual(ix, r), 'big'), '（日別合計・手入力）'),
    row('期間', val(`${fmtYMD(r.period_start)}〜${fmtYMD(r.period_end)}`, srcManual(ix, r))),
    Array.isArray(r.daily_values) ? row('日別', val(r.daily_values.join('・'), srcManual(ix, r))) : null,
    row('入力', `${memberName(ix.bundle, r.entered_by)}・${fmtDateTime(r.entered_at)}`),
    h('p', { class: 'pf-caution' }, '手入力（未承認）。承認前の参考値で、72時間遅延のこともある。他のプラットフォームと順位を比べない。'),
  ];
}

// ── リテンション ─────────────────────────────────────────────────────
const Q_LABEL = { q1: 'Q1 (25%)', q2: 'Q2 (50%)', q3: 'Q3 (75%)', complete: 'Complete (100%)' };
const Q_COLOR = { q1: '#1B6348', q2: '#4CAF70', q3: '#2471A3', complete: '#C8943C' };

export function retentionBlock(ix, n, noteSection, { avgTo } = {}) {
  const ret = retentionFor(ix, n);
  const ep = ix.epByNum.get(n);
  const long = isLongForm(ix, n);
  const avg = retentionAverage(ix, n, undefined, avgTo ?? n - 1);
  const avgVals = Object.fromEntries(Q_KEYS.map(k => [k, avg.metrics[k].avg]));
  const duration = num(ep?.duration_seconds);
  const ts = cleanTs5s(ret?.ts5s);

  if (!ret) return h('div', { class: 'ret-wrap' }, h('p', { class: 'missing-block' }, `EP#${n} の approved のリテンションは未取得`));

  const typeLabel = noteSection?.type_label || ret.retention_type || null;
  const typeSrc = noteSection?.type_label ? '型ラベルの出典: 週の文章（notes.retention_sections.type_label）' : ret.retention_type ? '型ラベルの出典: episode_retention.retention_type' : '型ラベルは未設定（DB・文章のどちらにもない）';
  const median = ret.median_label || noteSection?.median_label || null;

  const box = h('div', { class: 'chart-box chart-ret' });
  const canvas = h('canvas', { role: 'img', 'aria-label': `EP#${n}のリテンション曲線` });
  box.append(canvas);
  if (!ts.length) box.append(h('p', { class: 'chart-overlay' }, '曲線なし（ts5s 未取得）。Q点と平均だけを表示'));

  const range = avg.n ? `EP#${avg.from}〜#${avg.to}` : null;
  const cards = Q_KEYS.map(k => {
    const v = num(ret[k]);
    const a = avgVals[k];
    const d = diffPt(v, a);
    const note = noteSection?.metrics?.find(m => (k === 'complete' ? /Complete/i : new RegExp(`^${k.toUpperCase()}\\b`)).test(m.label || ''));
    return h('div', { class: 'qcard', style: { '--qc': Q_COLOR[k] } },
      h('p', { class: 'q-label' }, Q_LABEL[k]),
      val(v === null ? MISSING : `${fmtNum(v, 0)}%`, srcRet(ret, k === 'complete' ? 'raw_complete' : `raw_${k}`, k === 'q3' ? 'Q3が空の回は raw_retention の q3 で補う（DB側）' : ''), 'q-val'),
      h('p', { class: `q-diff ${long ? 'neutral' : d === null ? '' : d >= 0 ? 'up' : 'down'}` },
        d === null ? '平均との差: 計算できない' : `${long ? '参考: ' : ''}${fmtSigned(d, 'pt')}（${range}平均${fmtNum(a, 1)}%比・n=${avg.metrics[k].n}）`),
      note && note.note ? h('p', { class: 'q-report' }, `レポート記載: ${note.note}`) : null);
  });

  const side = h('div', { class: 'ret-side' },
    h('div', { class: 'type-badge', src: typeSrc }, typeLabel || '型ラベル未設定'),
    h('div', { class: 'ret-meta' },
      row('中央値', val(median || MISSING, srcRet(ret, 'median_label'))),
      row('Spotify標準比', val(ret.vs_standard || MISSING, srcRet(ret, "raw_retention->>'vs_standard'"))),
      row('尺', val(duration === null ? MISSING : fmtDur(duration), ['出典: episodes.duration_seconds']))),
    long ? h('p', { class: 'pf-caution' }, '倍尺回。Completeの低下は尺による自然な低下として読み、「悪化」とは読まない。平均比は参考。') : null,
    h('div', { class: 'qcards' }, cards));

  const cond = h('p', { class: 'calc-note' },
    avg.n
      ? `平均の計算条件：episode_retention の status=approved（各回の最新1件）、${range}（n=${avg.n}）の単純平均。欠損の回は数えない（Q3が空の回はDB側でraw_retentionから補完済み）。平均は小数1桁に四捨五入してから差を出す。曲線は ts5s（5秒刻み）を階段状に描画。`
      : '平均の計算条件：比較できる過去回（EP#10〜）がない');

  const wrap = h('div', { class: 'ret-wrap' }, h('div', { class: 'ret-grid' }, box, side), cond);
  // canvas はDOMに入ってから描く
  queueMicrotask(() => {
    if (!duration) { box.replaceChildren(h('p', { class: 'missing-block' }, '尺（duration_seconds）が未取得のため曲線を描けない')); return; }
    retentionChart(canvas, {
      ts5s: ts, duration,
      q: Object.fromEntries(Q_KEYS.map(k => [k, num(ret[k])])),
      avg: avg.n ? avgVals : null,
      epText: `EP#${n}`,
      avgText: `過去平均 ${range || ''}（Complete ${fmtNum(avgVals.complete, 1)}%）`,
    });
  });
  return wrap;
}

// ── 崖・対話 ─────────────────────────────────────────────────────────
export function cliffTable(ix, n, label) {
  const rows = cliffsFor(ix, n);
  const head = h('h4', { class: 'tbl-title' }, label || `${epLabel(ix, n)}（${rows.length}件）`);
  if (!rows.length) return h('div', { class: 'cliff-block' }, head, h('p', { class: 'missing-block' }, '崖の記録なし（episode_cliffs 0件）'));
  const src = c => [`出典: episode_cliffs（EP#${n}・#${c.cliff_index}・${c.detection_method || '検出方法未記録'}）`, c.notes ? `注記: ${truncate(c.notes, 300)}` : '', c.srt_excerpt ? `発話: ${truncate(c.srt_excerpt, 200)}` : ''];
  return h('div', { class: 'cliff-block' }, head,
    h('table', { class: 'tbl cliff-tbl' },
      h('thead', null, h('tr', null, ['#', '時刻', '区分', '落差', '変化'].map(t => h('th', null, t)))),
      h('tbody', null, rows.map(c => h('tr', null,
        h('td', { 'data-label': '#' }, String(c.cliff_index ?? '')),
        h('td', { 'data-label': '時刻' }, val(`${fmtMMSS(c.time_start_sec)}-${fmtMMSS(c.time_end_sec)}`, src(c))),
        h('td', { 'data-label': '区分' }, cliffClassJa(c.classification)),
        h('td', { 'data-label': '落差' }, val(num(c.drop_pp) === null ? MISSING : `-${fmtNum(Math.abs(num(c.drop_pp)), 0)}pt`, src(c))),
        h('td', { 'data-label': '変化' }, val(num(c.start_pct) === null ? MISSING : `${fmtNum(c.start_pct, 0)}%→${fmtNum(c.end_pct, 0)}%`, src(c))))))));
}

const FORMAT_JA = { duo: 'duo', solo: 'ソロ', roundtable: 'ラウンドテーブル' };
export function dialogRow(ix, n) {
  const d = dialogFor(ix, n);
  if (!d) return h('div', { class: 'dialog-row' }, h('strong', null, epLabel(ix, n)), h('span', { class: 'missing' }, ' 対話メトリクスは未取得'));
  const src = [`出典: episode_dialog_metrics（EP#${n}）`, d.is_estimated ? '推定値' : '', d.notes ? `注記: ${truncate(d.notes, 300)}` : ''];
  return h('div', { class: 'dialog-row' },
    h('strong', null, `${epLabel(ix, n)}（${FORMAT_JA[d.dialog_format] || d.dialog_format || '形式未記録'}）`),
    d.is_estimated ? chip('推定', 'warn') : null,
    h('span', { class: 'dl' }, '対話開始: ', val(num(d.dialog_start_sec) === null ? MISSING : `${fmtInt(d.dialog_start_sec)}秒`, src)),
    h('span', { class: 'dl' }, `ラリー数(${num(d.rally_window_sec) && num(d.rally_window_sec) !== 480 ? fmtInt(d.rally_window_sec) + '秒' : '8分'}以内): `, val(num(d.rally_count_8min) === null ? MISSING : `${fmtInt(d.rally_count_8min)}回`, src)),
    h('span', { class: 'dl' }, '200秒地点維持率: ', val(num(d.retention_200s_pct) === null ? MISSING : `${fmtNum(d.retention_200s_pct, 0)}%`, src)));
}

export { chartAvailable };
