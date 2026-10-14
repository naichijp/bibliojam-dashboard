// #/month/<窓終了日> 月次レポート（9月月次PPTXの16枚と同じ順）・#/months 月の一覧
// 数値は lib/monthly.js が bundle から計算する。月次PPTXの文章は「レポート記載」として添える（週次画面と同じ扱い）。
import { h, val } from '../lib/dom.js';
import { num, round, shortTitle as weekShortTitle, titleToShort, jstDateTime, utcDate, Q_KEYS } from '../lib/metrics.js';
import {
  MISSING, fmtInt, fmtNum, fmtHours, fmtSigned, fmtDur, fmtMD, fmtYMD, fmtMMSS, statusJa,
} from '../lib/format.js';
import {
  listMonths, defaultMonthKey, getMonth, monthNotes, monthRule, classifySlides, slideParagraphs, monthExclusions, AREA_JA,
  weekBasis, monthWeekly, monthFirstWeek, monthDiscovery, monthYouTube, monthApple, monthRetention, monthAudience,
  monthRanking, monthDataStatus, MONTH_STATUS_JA, AUD_GROUPS, hasMonthly,
} from '../lib/monthly.js';
import { monthWeeklyChart, discoveryRollChart, dailyImpressionChart, youtubeMonthChart, appleMonthChart, retentionChart } from '../lib/charts.js';
import { sectionHead, chip, cliffTable, srcWeek, srcFW, srcRet } from './common.js';

const pct1 = v => (num(v) === null ? MISSING : `${fmtSigned(v, '%')}`);
const avg1 = v => (num(v) === null ? MISSING : fmtNum(v, 1));
const rng = list => (list && list.length ? (list.length === 1 ? `${list[0]}` : `${list[0]}〜${list.at(-1)}`) : MISSING);
const wks = list => (list && list.length ? `W${list[0]}${list.length > 1 ? `〜W${list.at(-1)}` : ''}` : MISSING);
const epsTxt = list => (list && list.length ? `EP#${list[0]}${list.length > 1 ? `〜#${list.at(-1)}` : ''}` : MISSING);
// 短縮タイトル：題に『書名』があればそれ（月次スクリプトの SHORT_TITLE と同じ短さ）、無ければ週次と同じ決め方
function shortTitle(ix, n) {
  const t = ix.epByNum.get(n)?.title || '';
  return /『[^』]+』/.test(t) ? { text: titleToShort(t) } : weekShortTitle(ix, n);
}
const epLabel = (ix, n) => `EP#${n}${shortTitle(ix, n).text}`;
const md = iso => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : MISSING);

// ── 一覧 ────────────────────────────────────────────────────────────
export function renderMonths(root, ix) {
  root.append(h('header', { class: 'page-head' }, h('h1', null, '月次レポート'),
    h('p', { class: 'sub' }, '月ごとの集計窓・対象週・対象回（month_windows）。数値は各月の画面で bundle から計算します。')));
  if (!hasMonthly(ix)) { root.append(h('section', { class: 'card' }, h('p', { class: 'missing-block' }, 'bundle に month_windows がありません（tools/build.py で組み立て直してください）。'))); return; }
  const def = defaultMonthKey(ix);
  const rows = [...listMonths(ix)].reverse();
  root.append(h('section', { class: 'card' },
    sectionHead('一覧', `月次 ${rows.length}件`, `既定で開く月：${def}（status が proposed でない最新の月）`),
    h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl resp months-tbl' },
      h('thead', null, h('tr', null, ['月（表紙の終わり）', '表紙の期間（JST）', 'UTCの窓', '対象週', '対象回', '前期', '状態', '文章'].map(t => h('th', null, t)))),
      h('tbody', null, rows.map(({ key, mw, statusJa: st, hasNotes }) => h('tr', { class: mw.status === 'proposed' ? 'proposed' : '' },
        h('td', { 'data-label': '月' }, h('a', { href: `#/month/${key}` }, key), key === def ? chip('既定', 'gold') : null),
        h('td', { 'data-label': '表紙' }, mw.cover_label_jst || MISSING),
        h('td', { 'data-label': 'UTCの窓', class: 'small' }, mw.utc_start ? `${fmtYMD(mw.utc_start)}〜${fmtYMD(mw.utc_end)}` : '記録なし（移行前）'),
        h('td', { 'data-label': '対象週' }, wks(mw.weeks)),
        h('td', { 'data-label': '対象回' }, epsTxt(mw.episodes)),
        h('td', { 'data-label': '前期', class: 'small' }, mw.prev_weeks ? `${wks(mw.prev_weeks)}・${epsTxt(mw.prev_episodes)}` : 'なし'),
        h('td', { 'data-label': '状態' }, statusChip(mw)),
        h('td', { 'data-label': '文章', class: 'small' }, hasNotes ? 'あり' : mw.status === 'proposed' ? '—（PPTXなし）' : 'なし')))))),
    monthRule(ix) ? h('p', { class: 'calc-note' }, `決め方：${monthRule(ix)}`) : null));
}

function statusChip(mw) {
  if (mw.status === 'proposed') return chip('予定（未確定）', 'warn');
  if (mw.status === 'superseded') return chip(`差し替え済み（→ ${mw.superseded_by || '?'}）`, 'muted');
  return chip('確定（FINAL）', '');
}

// ── 月の画面 ─────────────────────────────────────────────────────────
export function renderMonth(root, ix, param) {
  if (!hasMonthly(ix)) { renderMonths(root, ix); return; }
  const key = param || defaultMonthKey(ix);
  root.append(toolbar(ix, key));
  const mw = getMonth(ix, key);
  if (!mw) { root.append(h('section', { class: 'card' }, h('p', null, `${param} の月次はありません。上の選択から月を選んでください。`))); return; }
  const notes = monthNotes(ix, key);
  const slides = classifySlides(notes);
  const ctx = {
    ix, key, mw, notes, slides,
    ex: monthExclusions(ix, key), basis: weekBasis(ix, key),
    weekly: monthWeekly(ix, key), fw: monthFirstWeek(ix, key), disc: monthDiscovery(ix, key), yt: monthYouTube(ix, key),
    apple: monthApple(ix, key), ret: monthRetention(ix, key), aud: monthAudience(ix, key), rank: monthRanking(ix, key),
  };
  const toc = [['cover', '表紙'], ['judge', '窓と判断'], ['summary', 'サマリー'], ['weekly', '週次'], ['disc', '発見'], ['deep', '深堀り'], ['yt', 'YouTube'],
    ['heat', 'リテンション'], ['hypo', '仮説・次月'], ['apple', 'Apple'], ['aud', 'オーディエンス'], ['rank', '累積ランキング']];
  root.append(h('nav', { class: 'toc', 'aria-label': 'この月の目次' },
    toc.map(([id, label]) => h('button', { type: 'button', onclick: () => document.getElementById(`sec-m-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, label))));
  const parts = [
    cover(ctx), judge(ctx), summary(ctx), weekly(ctx), discovery(ctx), deep(ctx), youtube(ctx), heatmap(ctx),
    ...(mw.episodes || []).map(n => epRetention(ctx, n)),
    hypotheses(ctx), other(ctx), appendix(ctx), apple(ctx), audience(ctx), ranking(ctx)];
  root.append(...parts.filter(Boolean));
}

function toolbar(ix, key) {
  const ms = listMonths(ix);
  const idx = ms.findIndex(m => m.key === key);
  const prev = idx > 0 ? ms[idx - 1] : null, next = idx >= 0 && idx < ms.length - 1 ? ms[idx + 1] : null;
  const sel = h('select', { id: 'month-select', 'aria-label': '月を選ぶ', onchange: e => { location.hash = `#/month/${e.target.value}`; } },
    [...ms].reverse().map(m => h('option', { value: m.key, selected: m.key === key ? true : null },
      `${m.mw.cover_label_jst || m.key}${m.status === 'final' ? '' : `（${m.statusJa}）`}`)));
  return h('div', { class: 'toolbar' },
    h('label', { for: 'month-select' }, '月'), sel,
    h('a', { class: `btn ${prev ? '' : 'disabled'}`, href: prev ? `#/month/${prev.key}` : null, 'aria-disabled': prev ? null : 'true' }, '← 前の月'),
    h('a', { class: `btn ${next ? '' : 'disabled'}`, href: next ? `#/month/${next.key}` : null, 'aria-disabled': next ? null : 'true' }, '次の月 →'),
    h('a', { class: 'btn', href: '#/months' }, '一覧'));
}

// ── 共通部品 ─────────────────────────────────────────────────────────
function slideBox(slide, { open = false, human = false } = {}) {
  if (!slide) return null;
  const { heading, analysis, rest } = slideParagraphs(slide);
  // 短い段落（タイルの数字・ラベル・バッジ）は1行にまとめ、長い段落は箇条書きにする（順番は保つ）
  const longs = rest.filter(t => t.length > 24), shorts = rest.filter(t => t.length <= 24);
  return h('details', { class: `report ${human ? 'human' : ''}`, open: open ? true : null },
    h('summary', null, `レポート記載（月次PPTX p${slide.index}${heading ? '：' + heading : ''}）`),
    human ? h('p', { class: 'report-note' }, '人の分析・判断です。月次PPTXの文章をそのまま表示しています（画面では再計算していません）。') : null,
    analysis.map(t => h('p', { class: 'report-analysis' }, t)),
    longs.length ? h('ul', { class: 'report-rest' }, longs.map(t => h('li', null, t))) : null,
    shorts.length ? h('p', { class: 'report-short' }, shorts.join('　｜　')) : null);
}

function reportBoxes(slides, opts) {
  if (!slides || !slides.length) return null;
  return h('div', { class: 'report-wrap' }, slides.map(s => slideBox(s, opts)));
}

function noReport(ctx, what = 'このページ') {
  if (ctx.mw.status === 'proposed') return h('p', { class: 'note-missing' }, `予定の月のため月次PPTXの文章はありません（${what}）。`);
  if (!ctx.notes) return h('p', { class: 'note-missing' }, 'この月の月次PPTXの文章（notes_monthly）は bundle にありません。');
  return h('p', { class: 'note-missing' }, `この月の月次PPTXに${what}に当たるスライドはありません。`);
}

function exclusionList(list, { title = '除外・感度分析の判断（month_windows.exclusions）' } = {}) {
  if (!list || !list.length) return null;
  return h('div', { class: 'excl' },
    h('p', { class: 'excl-h' }, title),
    h('ul', null, list.map(e => h('li', null,
      h('strong', null, `除外：${e.item}`), ` — ${e.decision}`,
      h('span', { class: 'excl-src' }, `（出典 ${e.sourceLabel}）`),
      h('span', { class: 'excl-fx' }, effectText(e))))));
}

function effectText(e) {
  const f = e.effect;
  if (!f) return '画面の扱い：表示のみ（計算は変えない）';
  if (f.type === 'adjust') return `画面の扱い：${f.period === 'prev' ? '前期' : '当期'}の全PF合計から${f.amount}回を除いた週平均も出す（除外しない値と併記。${f.amount}回はDBに無く、月次スクリプトの定数）`;
  if (f.type === 'exclude_eps' && e.area === 'youtube_prev') return `画面の扱い：前期平均・中央値から ${f.eps.map(n => 'EP#' + n).join('・')} を除く（除かない値も併記）`;
  if (f.type === 'exclude_eps') return `画面の扱い：前期平均から ${f.eps.map(n => 'EP#' + n).join('・')} を除いた値とも比べる（除かない値も併記）`;
  if (f.type === 'flag_eps') return `画面の扱い：${f.eps.map(n => 'EP#' + n).join('・')} に注記を付ける（棒は斜線）`;
  return '画面の扱い：表示のみ';
}

function tile(value, unit, desc, color, extra) {
  return h('div', { class: 'tile', style: { '--tc': color } },
    h('div', { class: 'tile-v' }, value), h('div', { class: 'tile-u' }, unit), h('div', { class: 'tile-d' }, desc), extra || null);
}

function chartBox(cls, label, draw) {
  const box = h('div', { class: `chart-box ${cls}` });
  const canvas = h('canvas', { role: 'img', 'aria-label': label });
  box.append(canvas);
  queueMicrotask(() => { if (canvas.isConnected) draw(canvas); });
  return box;
}

function proposedNote(ctx) {
  return ctx.mw.status === 'proposed' ? h('p', { class: 'warn-line' }, '予定（未確定）の月です。取れていないデータは「未取得」と表示し、0で埋めません。') : null;
}

// ── p1 表紙 ─────────────────────────────────────────────────────────
function cover({ ix, key, mw, notes, weekly }) {
  const final = mw.status === 'final';
  const approved = weekly.cur.rows.filter(r => r.status === 'approved').length;
  const epItems = (mw.episodes || []).map(n => {
    const e = ix.epByNum.get(n);
    const pub = e ? jstDateTime(e.published_at) : null;
    return h('li', null,
      h('a', { href: `#/episode/${n}`, class: 'cover-ep' }, `EP#${n}  ${shortTitle(ix, n).text}`),
      h('span', { class: 'cover-meta' }, `配信: ${pub ? `${pub.date.replace(/-/g, '.')} ${pub.time} JST（UTC ${utcDate(e.published_at)}）` : MISSING}  |  尺: ${fmtDur(e?.duration_seconds)}`));
  });
  // 月次PPTXの表紙と同じ FINAL／PREVIEW。予定の月と、確定前の週が残る月は PREVIEW
  const allApproved = approved === (mw.weeks || []).length;
  const badge = mw.status === 'proposed' ? ['PREVIEW・予定（未確定）', 'draft'] : mw.status === 'superseded' ? ['FINAL（差し替え済み）', 'draft']
    : allApproved ? ['FINAL', 'final'] : ['PREVIEW（確定前の週あり）', 'draft'];
  return h('section', { id: 'sec-m-cover', class: 'cover' },
    h('div', { class: 'cover-left' },
      h('p', { class: 'logo' }, h('span', { class: 'logo-b' }, 'BIBLIO'), h('span', { class: 'logo-j' }, ' JAM')),
      h('p', { class: 'tagline' }, '読みたい本が、きっと見つかる！'),
      h('p', { class: 'tagline2' }, '新刊ノンフィクションを語るポッドキャスト')),
    h('div', { class: 'cover-right' },
      h('h1', null, '月次レポート', h('span', { class: 'en' }, 'Monthly Analytics Report')),
      h('div', { class: 'cover-row' },
        h('span', { class: 'week-badge' }, mw.cover_label_jst || key),
        h('span', { class: `status-badge ${badge[1]}` }, badge[0])),
      h('p', { class: 'cover-window' }, mw.utc_start
        ? `集計窓: リリース影響週 UTC ${fmtYMD(mw.utc_start)}〜${fmtYMD(mw.utc_end)}（表紙は UTC の各日に1日足した JST 表記）`
        : `集計期間: ${mw.cover_label_jst}（リリース影響週への移行前。UTC の窓の記録なし）`),
      h('p', { class: 'cover-window' }, `対象週: ${wks(mw.weeks)}（${(mw.weeks || []).length}週・確定 ${approved}/${(mw.weeks || []).length}）　前期: ${mw.prev_weeks ? `${wks(mw.prev_weeks)}・${epsTxt(mw.prev_episodes)}` : 'なし'}`),
      mw.status === 'superseded' ? h('p', { class: 'cover-badge draft' }, `この版は ${mw.superseded_by} 版に延長されました。比較・推移には `, h('a', { href: `#/month/${mw.superseded_by}` }, `${mw.superseded_by} 版`), ' を使います。') : null,
      mw.status === 'proposed' ? h('p', { class: 'cover-badge' }, '予定（未確定）：これまでの決め方を当てはめた案です。月次PPTXはまだありません。') : null,
      h('p', { class: 'cover-h' }, `対象回（${(mw.episodes || []).length}本）`),
      h('ul', { class: 'cover-eps' }, epItems),
      mw.episodes_note ? h('p', { class: 'cover-db' }, mw.episodes_note) : null,
      h('p', { class: 'cover-db' }, mw.pptx ? `月次PPTX: ${mw.pptx.split('/').pop()}${notes ? `（文章は ${notes.extractor || '抽出'}・${fmtYMD(notes.extracted_at)} 抽出）` : ''}` : '月次PPTX: なし'),
      final && !notes ? h('p', { class: 'cover-db' }, '文章（notes_monthly）が bundle にありません') : null));
}

// ── 窓と判断（month_windows のうち人の判断・期間のずれ） ───────────────
function judge({ ix, key, mw, ex, basis }) {
  const status = mw.status === 'proposed' ? monthDataStatus(ix, key) : null;
  return h('section', { id: 'sec-m-judge', class: 'card' },
    sectionHead('窓と判断', 'この月の集計窓・週の値の取り方・除外の判断', '出典は month_windows.json（月次スクリプトの文字列・定数と完成PPTXの文字から写したもの）'),
    h('dl', { class: 'meta-list' },
      h('dt', null, '週の値'), h('dd', null, h('strong', null, basis.label), h('span', { class: 'small' }, `　決め方: ${basis.how}。${basis.reason}`), h('span', { class: 'excl-src' }, `（出典 ${basis.sourceLabel}）`)),
      h('dt', null, '定義'), h('dd', null, mw.week_definition || 'リリース影響週への移行前（記録なし）')),
    mw.data_windows?.length ? h('div', { class: 'excl' }, h('p', { class: 'excl-h' }, '窓と期間が違うデータ（data_windows）'),
      h('ul', null, mw.data_windows.map(d => h('li', null, h('strong', null, d.item), ` — ${d.window}${d.note ? `（${d.note}）` : ''}`, h('span', { class: 'excl-src' }, `（出典 ${d.source?.file ? d.source.file.split('/').pop() + ':' + d.source.line : '記録なし'}）`))))) : null,
    exclusionList(ex) || h('p', { class: 'small' }, '除外・感度分析の判断: この月の記録はありません。'),
    mw.caveats?.length ? h('div', { class: 'excl' }, h('p', { class: 'excl-h' }, '注意（caveats）'), h('ul', null, mw.caveats.map(c => h('li', null, c)))) : null,
    mw.proposal ? h('div', { class: 'excl proposal' }, h('p', { class: 'excl-h' }, '予定の窓の決め方と、決めること（proposal）'),
      h('p', null, mw.proposal.how), h('ul', null, (mw.proposal.to_decide || []).map(t => h('li', null, t)))) : null,
    status ? h('div', { class: 'excl' }, h('p', { class: 'excl-h' }, 'データのそろい具合（10/14 時点の bundle）'),
      h('ul', { class: 'miss' }, status.map(s => h('li', null, h('span', { class: `lv ${s.ok ? 'info' : 'warn'}` }, s.ok ? 'あり' : '未取得'), `${s.area}：${s.text}`)))) : null);
}

// ── p2 サマリー ─────────────────────────────────────────────────────
function summary(ctx) {
  const { ix, mw, weekly: w, fw, disc, aud, slides } = ctx;
  const adjPrev = w.adjustments.find(a => a.period === 'prev');
  const adjCur = w.adjustments.find(a => a.period === 'cur');
  const allSrc = [`出典: ${w.basis.label}`, ...w.cur.rows.map(r => `W${r.week}: ${fmtInt(r.all)}（${r.source}）`), `合計 ÷ ${w.cur.n}週 = 週平均`];
  const allDesc = [
    w.cur.allAvg === null ? `週平均: ${MISSING}（${w.cur.missing.map(n => 'W' + n).join('・')}が未取得）` : `週平均${avg1(round(w.cur.allAvg, 1))}`,
    w.prev ? `（前期比${w.allPct === null ? MISSING : pct1(w.allPct)}` : '（前期なし',
    adjPrev ? `。前期の${adjPrev.amount}回除外で${pct1(adjPrev.pct)}` : '',
    adjCur ? `。当期の${adjCur.amount}回除外の感度分析 ${avg1(adjCur.adjAvgLabel)}（${pct1(adjCur.pct)}）` : '',
    '）'].join('');
  const fol = w.followers;
  const roll = disc.last;
  const tiles = h('div', { class: 'tiles tiles5' },
    tile(val(String((mw.episodes || []).length), ['出典: month_windows.episodes（窓内に公開した回）']), 'エピソード配信', epsTxt(mw.episodes), '#00CCBA'),
    tile(val(fmtInt(w.cur.allSum), allSrc), '全プラットフォーム合計', allDesc, '#009E8E'),
    tile(val(fol.delta === null ? MISSING : fmtSigned(fol.delta, '', 0), [`出典: weekly_snapshots W${fol.startWeek}.spotify_followers_start → W${fol.endWeek}.spotify_followers_end`]), 'Spotify フォロワー増加',
      `${fmtInt(fol.start)}→${fmtInt(fol.end)}人（W${fol.startWeek}開始→W${fol.endWeek}終了）`, '#C8943C'),
    tile(val(fw.curAvg.avg === null ? MISSING : avg1(round(fw.curAvg.avg, 1)), ['出典: episode_first_week_metrics（Spotify・全PF統合、各回の主行）', ...fw.cur.map(r => `EP#${r.ep}: ${fmtInt(r.value)}${r.row && !r.exact ? '（7日確定ではない）' : ''}`)]), 'EP初週平均(全PF)',
      fw.curAvg.avg === null ? `${MISSING}（${fw.curAvg.missing.map(n => 'EP#' + n).join('・')}が未登録）` : `${fw.curAvg.n}本平均。${fw.prevAvg ? `前期${avg1(round(fw.prevAvg.avg, 1))}比${pct1(fw.pct)}` : '前期なし'}`, '#E05C35'),
    tile(val(roll?.cvr === null || roll?.cvr === undefined ? MISSING : `${roll.cvr}%`, roll ? srcWeek(ix, ix.weekByNum.get(roll.week) || { week_number: roll.week }, 'discovery_cvr_pct', '各週の取得時点の過去30日（発見タブ）') : ['当期の週がない']), '発見CVR',
      disc.before && roll ? `前回${disc.before.cvr ?? MISSING}%（W${disc.before.week}）から。インプレッション${fmtInt(disc.before.impressions)}→${fmtInt(roll.impressions)}` : MISSING, '#6C757D'));

  const ratio = w.ratioCur, ratioP = w.ratioPrev;
  const ref = h('ul', { class: 'ref-list' },
    h('li', null, '参考値（窓と期間が違う）: インプレッション ', val(fmtInt(disc.monthly.impressions), [`出典: monthly_reference ${mw.report_month || '（report_month なし）'}.disc_impressions`, disc.monthly.period ? `期間: ${disc.monthly.period.start}〜${disc.monthly.period.end}（取得時点の過去30日）` : '']),
      '・CVR ', val(disc.monthly.cvr === null ? MISSING : `${disc.monthly.cvr}%`, [`出典: monthly_reference ${mw.report_month || ''}.disc_cvr_pct`]),
      disc.monthly.period ? `（直近30日・${disc.monthly.period.label}）` : '（この月の monthly_reference に発見の値なし）'),
    h('li', null, '新規リスナー ', val(aud.new.value === null ? MISSING : `${fmtInt(aud.new.value)}人`, [`出典: monthly_reference ${mw.report_month || ''}.aud_new_listeners`, aud.period ? `カスタム期間 UTC ${aud.period.start}〜${aud.period.end}` : '']),
      aud.period ? `（UTC ${md(aud.period.start)}–${md(aud.period.end)}）` : '',
      aud.prevMonth?.new !== null && aud.prevMonth?.new !== undefined ? `。前回（${aud.prevMonth.key}）は${fmtInt(aud.prevMonth.new)}人` : ''),
    h('li', null, '再生÷日次ユニーク ', val(ratio.ratioLabel === null ? MISSING : `${ratio.ratioLabel}倍`, ['Spotify の日次再生（daily_metrics）の窓内合計 ÷ 日次オーディエンス（csv_extras.daily.spotify_audience）の窓内合計', `${ratio.present}/${ratio.of}日そろい`]),
      ratioP ? `（前期${ratioP.ratioLabel === null ? MISSING : ratioP.ratioLabel + '倍'}）` : ''));
  return h('section', { id: 'sec-m-summary', class: 'card' },
    sectionHead('サマリー', slides.summary[0] ? slides.summary[0].texts[0] : '月次サマリー',
      `集計期間: ${wks(mw.weeks)}${mw.utc_start ? ` = リリース影響週 UTC ${fmtYMD(mw.utc_start)}〜${fmtYMD(mw.utc_end)}` : ''}  |  ${epsTxt(mw.episodes)} 配信`),
    proposedNote(ctx), tiles, ref,
    exclusionList(ctx.ex.filter(e => e.area === 'weekly' && e.effect?.type === 'adjust'), { title: '除外（感度分析）' }),
    reportBoxes(slides.summary, { open: true }) || noReport(ctx, 'サマリー'));
}

// ── p3 週次トレンド ─────────────────────────────────────────────────
function weekly(ctx) {
  const { ix, mw, weekly: w, slides } = ctx;
  const allRows = [...(w.prev ? w.prev.rows.map(r => ({ ...r, isCur: false })) : []), ...w.cur.rows.map(r => ({ ...r, isCur: true }))];
  const adj = w.adjustments;
  const flagWeek = adj.find(a => a.week !== null)?.week ?? null;
  const flagNote = adj.length && flagWeek !== null ? `${adj[0].date ? md(adj[0].date) : ''}に${adj[0].amount}回\n（${adj[0].period === 'prev' ? '前期' : '当期'}・除外の判断）` : null;
  const chartRows = allRows.map(r => ({
    label: `W${r.week}`, sp: r.sp, all: r.all, isCur: r.isCur, flag: r.week === flagWeek,
    title: `W${r.week}（${r.isCur ? '当期' : '前期'}）${r.window ? `  ${r.window.old ? '旧窓' : 'UTC'} ${r.window.start}〜${r.window.end}` : ''}`,
    note: [r.status && r.status !== 'approved' ? `状態: ${statusJa(r.status)}` : '', r.differs ? `別の取り方: ${r.alt.label} ${r.alt.sp}/${r.alt.all}` : '', !r.exists ? '未登録' : ''].filter(Boolean).join('／'),
  }));
  const canDraw = allRows.some(r => r.sp !== null || r.all !== null);
  const chart = canDraw ? chartBox('chart-mweekly', `${wks(mw.prev_weeks || [])}と${wks(mw.weeks)}の週次再生数`, c => monthWeeklyChart(c, chartRows, {
    prevCount: w.prev ? w.prev.rows.length : 0,
    avg: { prevSp: w.prev?.spAvg ?? null, prevAll: w.prev?.allAvg ?? null, curSp: w.cur.spAvg, curAll: w.cur.allAvg },
    prevLabel: w.prev ? `前期 ${wks(mw.prev_weeks)}` : '', curLabel: `当期 ${wks(mw.weeks)}`, flagNote,
  })) : h('p', { class: 'missing-block' }, '週の値が未取得');

  const legend = h('p', { class: 'calc-note' }, `破線＝前期週平均（Spotify ${w.prev ? avg1(round(w.prev.spAvg, 1)) : MISSING}・全PF ${w.prev ? avg1(round(w.prev.allAvg, 1)) : MISSING}）　点線＝当期週平均（Spotify ${avg1(round(w.cur.spAvg, 1))}・全PF ${avg1(round(w.cur.allAvg, 1))}）。当期の棒は金の縁${flagWeek !== null ? `、W${flagWeek}の赤い縁は除外の判断がある週` : ''}。`);
  const table = h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl resp' },
    h('thead', null, h('tr', null, ['週', '区分', '窓', 'Spotify', '全PF', '別の取り方', '状態'].map(t => h('th', null, t)))),
    h('tbody', null, allRows.map(r => h('tr', { class: r.isCur ? 'cur-row' : '' },
      h('td', { 'data-label': '週' }, h('a', { href: `#/week/${r.week}` }, `W${r.week}`)),
      h('td', { 'data-label': '区分' }, r.isCur ? '当期' : '前期'),
      h('td', { 'data-label': '窓', class: 'small' }, r.window ? `${r.window.old ? '旧窓' : 'UTC'} ${fmtMD(r.window.start, false)}–${fmtMD(r.window.end, false)}` : MISSING),
      h('td', { 'data-label': 'Spotify' }, val(fmtInt(r.sp), [r.source, r.row ? srcWeek(ix, r.row, 'spotify_plays')[3] : ''])),
      h('td', { 'data-label': '全PF' }, val(fmtInt(r.all), [r.source])),
      h('td', { 'data-label': '別の取り方', class: 'small' }, r.alt && (r.differs || r.alt.sp === null) ? `${r.alt.label}: ${fmtInt(r.alt.sp)}/${fmtInt(r.alt.all)}` : '同じ'),
      h('td', { 'data-label': '状態' }, r.exists ? statusJa(r.status) : '未登録'))))));

  const avgLine = (p, label) => (p ? h('li', null, `${label}（${wks(p.weeks)}・${p.n}週）: Spotify `, val(p.spAvg === null ? MISSING : avg1(round(p.spAvg, 1)), [`合計 ${fmtInt(p.spSum)} ÷ ${p.n}週`]),
    '・全PF ', val(p.allAvg === null ? MISSING : avg1(round(p.allAvg, 1)), [`合計 ${fmtInt(p.allSum)} ÷ ${p.n}週`]),
    `（合計 ${fmtInt(p.spSum)}／${fmtInt(p.allSum)}）`, p.missing.length ? `　未取得: ${p.missing.map(n => 'W' + n).join('・')}` : '') : null);
  const ratio = w.ratioCur, rp = w.ratioPrev;
  const ratioLine = h('li', null, '再生÷日次ユニーク: ', val(ratio.ratioLabel === null ? MISSING : `${ratio.ratioLabel}倍`, [`窓内 ${ratio.of}日の Spotify 再生合計 ÷ 日次オーディエンス合計（${ratio.present}日そろい）`]),
    rp ? `（前期${rp.ratioLabel === null ? MISSING : rp.ratioLabel + '倍'}）` : '',
    `。${ratio.threshold}倍超は${ratio.of}日中${ratio.over === null ? MISSING : ratio.over + '日'}${rp ? `（前期${rp.over === null ? MISSING : rp.over + '日'}）` : ''}`,
    ratio.max ? `。最も高い日は ${md(ratio.max.date)}（UTC）の ${ratio.max.plays}再生／${ratio.max.audience}人（${round(ratio.max.ratio, 2)}倍）` : '');
  return h('section', { id: 'sec-m-weekly', class: 'card' },
    sectionHead('週次トレンド', slides.weekly[0]?.texts[0] || '週次再生数トレンド  [Spotify／全PF]', `${w.prev ? wks(mw.prev_weeks) + '（前期）・' : ''}${wks(mw.weeks)}（当期）  |  週の値: ${w.basis.label}`),
    proposedNote(ctx), chart, canDraw ? legend : null,
    h('ul', { class: 'ref-list' },
      avgLine(w.cur, '当期週平均'), avgLine(w.prev, '前期週平均'),
      w.prev ? h('li', null, `前期比（週平均どうし）: Spotify ${pct1(w.spPct)}・全PF ${pct1(w.allPct)}`) : null,
      ...adj.map(a => h('li', { class: 'adj' }, `除外の感度分析：${a.period === 'prev' ? '前期' : '当期'}${a.week !== null ? `W${a.week}` : ''}の${a.date ? md(a.date) + 'の' : ''}${a.amount}回を除いた${a.period === 'prev' ? '前期' : '当期'}週平均(全PF) `,
        val(avg1(a.adjAvgLabel), [`(${a.period === 'prev' ? '前期' : '当期'}合計 − ${a.amount}) ÷ 週数`, `${a.amount}回は bundle に無い値（${a.sourceLabel}）`]), `（${a.period === 'prev' ? '当期と比べて' : '前期比'} ${pct1(a.pct)}）。除外しない値は上の行`)),
      w.cur.complete ? h('li', null, `当期の全PFの幅: ${w.cur.allMin}〜${w.cur.allMax}`) : null,
      ratioLine),
    h('p', { class: 'calc-note' }, `週の値の取り方: ${w.basis.label}（${w.basis.how}）。${w.basis.reason}（出典 ${w.basis.sourceLabel}）。週数が違う月どうしは合計でなく週平均で比べる。`),
    table,
    exclusionList(ctx.ex.filter(e => e.area === 'weekly')),
    reportBoxes(slides.weekly) || noReport(ctx, '週次トレンド'));
}

// ── p4 発見 ─────────────────────────────────────────────────────────
function discovery(ctx) {
  const { ix, mw, disc: d, slides } = ctx;
  const rollRows = d.roll.map(r => ({ label: `W${r.week}${r.isPrev ? '（前回）' : ''}`, impressions: r.impressions, cvr: r.cvr, isPrev: r.isPrev,
    title: `W${r.week}${r.window ? '  取得時点の過去30日 ' + r.window : '  過去30日（期間の記録なし）'}` }));
  const hasRoll = d.roll.some(r => r.impressions !== null || r.cvr !== null);
  const pubIdx = new Map();
  const dRows = d.daily.map(r => ({ date: r.date, value: r.value, pub: d.pub.has(r.date) ? `#${d.pub.get(r.date)}` : null }));
  const wkBlocks = d.perWeek.map(pw => ({ label: `W${pw.week}`, sum: pw.sum, from: dRows.findIndex(r => r.date === pw.start), to: dRows.findIndex(r => r.date === pw.end) })).filter(b => b.from >= 0 && b.to >= 0);
  void pubIdx;
  const srcList = ['home', 'search', 'library', 'other'].map(k => [k, { home: 'ホーム', search: '検索', library: 'ライブラリ', other: 'その他' }[k]]);
  return h('section', { id: 'sec-m-disc', class: 'card' },
    sectionHead('発見', slides.discovery[0]?.texts[0] || '発見インプレッションとCVR  [Spotify]',
      `過去30日${d.monthly.period ? `（${d.monthly.period.label}・${d.mw.weeks?.length ? 'W' + d.mw.weeks.at(-1) : ''}取得時点）` : ''}｜インプレッション${fmtInt(d.last?.impressions)}${d.before ? `（前回 W${d.before.week} ${fmtInt(d.before.impressions)}から${pct1(d.lastChangePct)}）` : ''}→ CVR${d.last?.cvr ?? MISSING}${d.last?.cvr !== null && d.last?.cvr !== undefined ? '%' : ''}｜期間内の日次インプレッション合計${fmtInt(d.dailySum)}`),
    proposedNote(ctx),
    h('div', { class: 'two-col' },
      h('div', null,
        h('h3', { class: 'h3' }, 'インプレッションとCVR（各週取得時点の過去30日）'),
        hasRoll ? chartBox('chart-mroll', '各週取得時点のインプレッションとCVR', c => discoveryRollChart(c, rollRows)) : h('p', { class: 'missing-block' }, 'この月の週に発見タブの値（weekly_snapshots.impressions・discovery_cvr_pct）が未取得'),
        h('p', { class: 'calc-note' }, `出典: weekly_snapshots.impressions・discovery_cvr_pct（取得時点の過去30日。窓の値ではない）。過去30日の期間が残っているのは月次で使った週だけ（${d.roll.filter(r => r.window).map(r => `W${r.week} ${r.window}`).join('・') || 'なし'}）。「前回」は一つ前の月次${d.beforeFrom ? `（${d.beforeFrom}）` : ''}の最後の週。`)),
      h('div', null,
        h('h3', { class: 'h3' }, `日次インプレッション（UTC ${md(d.daily[0]?.date)}〜${md(d.daily.at(-1)?.date)}・合計${fmtInt(d.dailySum)}）`),
        d.dailyPresent ? chartBox('chart-mdaily', '期間内の日次インプレッション', c => dailyImpressionChart(c, dRows, wkBlocks)) : h('p', { class: 'missing-block' }, `日次インプレッションは未取得（日次CSVは ${fmtYMD(ix.csvDaily.find(r => r.impressions !== null)?.date)} から）`),
        h('p', { class: 'calc-note' }, `出典: csv_extras.daily.impressions（日次CSV。同じ日は新しいフォルダの値）。${d.dailyPresent}/${d.daily.length}日そろい。濃い棒＝対象回の公開日（UTC）。${d.top2.length ? `期間最多の2日: ${d.top2.map(t => `${md(t.date)} ${fmtInt(t.value)}`).join('・')}` : ''}`))),
    h('h3', { class: 'h3' }, '流入経路（過去30日）'),
    d.srcAny ? h('div', { class: 'hbars' }, srcList.map(([k, label]) => hbar(label, d.src[k], d.monthly.impressions, `${fmtInt(d.src[k])}${d.monthly.impressions && d.src[k] !== null ? `（${round(d.src[k] / d.monthly.impressions * 100, 1)}%）` : ''}`, '#1B5E50',
      [`出典: monthly_reference ${mw.report_month}.src_${k}`, d.srcRows[k] ? `期間: ${d.srcRows[k].period_start}〜${d.srcRows[k].period_end}` : '']))) : h('p', { class: 'missing-block' }, '流入経路は未取得（この月の monthly_reference に記録がない）'),
    d.homeShare !== null ? h('p', { class: 'calc-note' }, `ホームの割合: ${d.homeShare}%（ホーム ÷ 過去30日のインプレッション ${fmtInt(d.monthly.impressions)}）。発見タブは過去30/60/90日しか選べず、窓末の当日に取らないと後から取れない（窓とずれる）。`) : null,
    reportBoxes(slides.discovery) || noReport(ctx, '発見'));
}

function hbar(label, value, max, text, color, src) {
  const v = num(value), m = num(max);
  const w = v === null || !m ? 0 : Math.max(0.5, Math.min(100, v / m * 100));
  return h('div', { class: 'hbar' },
    h('span', { class: 'hbar-l' }, label),
    h('span', { class: 'hbar-t' }, h('span', { class: 'hbar-f', style: { width: `${w}%`, background: color } })),
    val(v === null ? MISSING : text, src, 'hbar-v'));
}

// ── p5 深堀り（人の分析） ───────────────────────────────────────────
function deep(ctx) {
  const { slides } = ctx;
  return h('section', { id: 'sec-m-deep', class: 'card' },
    sectionHead('深堀り', slides.deep[0]?.texts[0] || '深堀り', '照合メモ（ts5s×発話）にもとづく人の分析。各回の曲線と崖は下のリテンションの節で DB から描いています。'),
    reportBoxes(slides.deep, { open: true, human: true }) || noReport(ctx, '深堀り'),
    exclusionList(ctx.ex.filter(e => e.area === 'deep')));
}

// ── p6 YouTube 長尺 ─────────────────────────────────────────────────
function youtube(ctx) {
  const { ix, mw, yt, slides } = ctx;
  const top = yt.top.views?.ep;
  const rows = yt.cur.map(r => ({ label: `EP#${r.ep}`, views: r.views, top: r.ep === top, hatch: (r.row && !r.exact) || r.flags.length > 0,
    title: `${epLabel(ix, r.ep)}  CTR ${r.ctr ?? MISSING}%・7日IMP ${r.imp7 === null ? MISSING : '約' + fmtInt(r.imp7)}`,
    note: [r.row && !r.exact ? '7日確定ではない（参考値）' : '', ...r.flags.map(f => f.decision)].filter(Boolean).join('／') }));
  const hasAny = yt.cur.some(r => r.views !== null);
  const ps = yt.prevStats, pa = yt.prevStatsAll;
  const callout = (r, value, label) => (r ? h('div', { class: 'callout' }, h('span', { class: 'callout-v' }, value), h('span', { class: 'callout-l' }, `#${r.ep} ${label}`)) : null);
  return h('section', { id: 'sec-m-yt', class: 'card' },
    sectionHead('YouTube', slides.youtube[0]?.texts[0] || 'YouTube 分析（長尺動画）', `${wks(mw.weeks)}  |  ※${epsTxt(mw.episodes)}・Shorts除く。7日値（episode_first_week_metrics の youtube・long）`),
    proposedNote(ctx),
    h('div', { class: 'callouts' },
      callout(yt.top.imp, yt.top.imp ? `約${fmtInt(yt.top.imp.imp7)}` : '', 'インプレッション（当月最多）'),
      callout(yt.top.ctr, yt.top.ctr ? `${yt.top.ctr.ctr}%` : '', 'CTR（当月最高）'),
      callout(yt.top.watch, yt.top.watch ? `${fmtNum(yt.top.watch.watch, 2)}h` : '', '最多視聴時間（7日確定）')),
    hasAny ? chartBox('chart-myt', 'YouTube長尺の7日視聴回数', c => youtubeMonthChart(c, rows, { avg: ps.avg, median: ps.median })) : h('p', { class: 'missing-block' }, 'YouTube長尺の値が未取得'),
    h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl resp' },
      h('thead', null, h('tr', null, ['回', '視聴回数', 'CTR', '7日インプレッション', '視聴時間', '期間・確定'].map(t => h('th', null, t)))),
      h('tbody', null, yt.cur.map(r => h('tr', null,
        h('td', { 'data-label': '回' }, h('a', { href: `#/episode/${r.ep}` }, epLabel(ix, r.ep)), r.flags.length ? chip('比べない／注記', 'warn') : null),
        h('td', { 'data-label': '視聴回数' }, val(r.views === null ? MISSING : `${fmtInt(r.views)}回`, srcFW(r.row, 'plays_or_views'))),
        h('td', { 'data-label': 'CTR' }, val(r.ctr === null ? MISSING : `${r.ctr}%`, srcFW(r.row, 'ctr_pct'))),
        h('td', { 'data-label': '7日IMP' }, val(r.imp7 === null ? MISSING : `約${fmtInt(r.imp7)}`, r.impRow ? [`出典: youtube_impressions（${r.impRow.metric_key}・${r.impRow.period_kind}・${r.impRow.period_start}〜${r.impRow.period_end}）`, r.impRow.note || ''] : ['youtube_impressions に7日値なし', r.impNote ? `文字の記録（reviewer_note）: ${r.impNote}` : ''])),
        h('td', { 'data-label': '視聴時間' }, val(r.watch === null ? MISSING : `${fmtNum(r.watch, 2)}h`, srcFW(r.row, 'watch_hours'))),
        h('td', { 'data-label': '期間', class: 'small' }, r.row ? `${fmtYMD(r.row.period_start)}〜${fmtYMD(r.row.period_end)}・${r.exact ? '7日確定' : '7日確定ではない'}` : MISSING)))))),
    mw.prev_episodes ? h('ul', { class: 'ref-list' },
      h('li', null, `前期平均（${ps.eps.map(n => '#' + n).join('・') || 'なし'}・${ps.n}本）: `, val(ps.avg === null ? MISSING : fmtInt(ps.avg), ['出典: episode_first_week_metrics（youtube・long の各回の主行）']),
        `　前期中央値: ${ps.median === null ? MISSING : fmtNum(ps.median, 1)}`, yt.excluded.length ? `（除外: ${yt.excluded.flatMap(e => e.effect.eps).map(n => 'EP#' + n).join('・')}）` : ''),
      yt.excluded.length ? h('li', null, `除外しない前期平均（${pa.eps.map(n => '#' + n).join('・')}・${pa.n}本）: ${pa.avg === null ? MISSING : fmtInt(pa.avg)}　中央値: ${pa.median === null ? MISSING : fmtNum(pa.median, 1)}`) : null) : null,
    yt.nonExact.length ? h('p', { class: 'calc-note' }, `${yt.nonExact.map(n => 'EP#' + n).join('・')} は7日確定の値ではない（参考値。棒は斜線）。当月最多・最高は7日確定の回の中で選んでいます。`) : null,
    exclusionList(ctx.ex.filter(e => e.area === 'youtube' || e.area === 'youtube_prev')),
    reportBoxes(slides.youtube) || noReport(ctx, 'YouTube'));
}

// ── p7 リテンションのヒートマップ ────────────────────────────────────
function heatColor(v) {
  if (v === null) return ['#555555', '#DDDDDD'];
  if (v >= 70) return ['#4CAF50', '#FFFFFF'];
  if (v >= 60) return ['#8BC34A', '#333333'];
  if (v >= 50) return ['#FF9800', '#FFFFFF'];
  if (v >= 40) return ['#FF5722', '#FFFFFF'];
  return ['#F44336', '#FFFFFF'];
}

function heatmap(ctx) {
  const { ix, mw, ret, slides } = ctx;
  const cell = (v, src) => { const [bg, fg] = heatColor(v); return h('td', { class: 'heat-c', style: { background: bg, color: fg } }, val(v === null ? MISSING : `${fmtNum(v, 0)}%`, src)); };
  const avgRow = (label, a) => (a ? h('tr', { class: 'heat-avg' }, h('th', { scope: 'row' }, label), Q_KEYS.map(k => h('td', null, a.metrics[k].avg === null ? MISSING : `${fmtNum(a.metrics[k].avg, 1)}%`)), h('td', { class: 'small' }, `n=${a.n}${Q_KEYS.some(k => a.metrics[k].missing) ? '（欠損あり）' : ''}`)) : null);
  const exEps = ret.excluded.flatMap(e => e.effect.eps);
  return h('section', { id: 'sec-m-heat', class: 'card' },
    sectionHead('リテンション', slides.heatmap[0]?.texts[0] || `Spotify リテンション全体サマリー  [${epsTxt(mw.episodes)}]`, '出典: episode_retention（approved・各回の最新1件）。型は retention_type'),
    proposedNote(ctx),
    h('div', { class: 'heat-wrap' }, h('table', { class: 'heat' },
      h('thead', null, h('tr', null, ['EP', 'Q1 (25%)', 'Q2 (50%)', 'Q3 (75%)', 'Complete (100%)', '型'].map(t => h('th', null, t)))),
      h('tbody', null,
        ret.rows.map(r => h('tr', null,
          h('th', { scope: 'row' }, h('a', { href: `#sec-m-ep-${r.ep}`, onclick: e => { e.preventDefault(); document.getElementById(`sec-m-ep-${r.ep}`)?.scrollIntoView({ behavior: 'smooth' }); } }, `EP#${r.ep}`), h('span', { class: 'heat-t' }, shortTitle(ix, r.ep).text)),
          ...Q_KEYS.map(k => cell(r[k], srcRet(r.ret, k === 'complete' ? 'raw_complete' : `raw_${k}`))),
          h('td', { class: 'heat-type' }, r.type || '型ラベル未設定'))),
        avgRow(`当期平均（${epsTxt(mw.episodes)}）`, ret.cur),
        avgRow(`前期平均（${epsTxt(mw.prev_episodes)}・全${ret.prev?.n ?? 0}本）`, ret.prev),
        ret.prevEx ? avgRow(`前期平均（${exEps.map(n => 'EP#' + n).join('・')}を除く${ret.prevEx.n}本）`, ret.prevEx) : null,
        ret.diff ? h('tr', { class: 'heat-avg diff' }, h('th', { scope: 'row' }, `差（当期 − ${ret.diffBase === 'excluded' ? '除いた前期' : '前期'}。丸めた平均どうし）`), Q_KEYS.map(k => h('td', null, ret.diff[k] === null ? MISSING : fmtSigned(ret.diff[k], 'pt'))), h('td', null, '')) : null))),
    h('p', { class: 'heat-legend' }, [['70%以上', 70], ['60-69%', 60], ['50-59%', 50], ['40-49%', 40], ['40%未満', 0]].map(([l, v]) => { const [bg, fg] = heatColor(v); return h('span', { style: { background: bg, color: fg } }, l); })),
    h('p', { class: 'calc-note' }, '平均は各回の値の単純平均を小数1桁に四捨五入。差は丸めた平均どうしの差。倍尺回の Complete 低下は尺による自然な低下として読み、「悪化」とは読まない。'),
    exclusionList(ctx.ex.filter(e => e.area === 'retention_prev')),
    reportBoxes(slides.heatmap) || noReport(ctx, 'リテンション全体'));
}

// ── p8〜p11 回ごとのリテンション ─────────────────────────────────────
function epRetention(ctx, n) {
  const { ix, ret, slides } = ctx;
  const r = ret.rows.find(x => x.ep === n);
  const e = ix.epByNum.get(n);
  const slide = slides.epret.get(n) || null;
  const qColor = { q1: '#1B5E50', q2: '#16A085', q3: '#2471A3', complete: '#C8943C' };
  const qLabel = { q1: 'Q1 (25%)', q2: 'Q2 (50%)', q3: 'Q3 (75%)', complete: 'Complete (100%)' };
  const body = !r?.ret ? h('p', { class: 'missing-block' }, `EP#${n} の approved のリテンションは未取得`) : h('div', { class: 'ret-grid' },
    r.duration ? chartBox('chart-ret', `EP#${n}のリテンション曲線`, c => retentionChart(c, { ts5s: r.ts5s, duration: r.duration, q: Object.fromEntries(Q_KEYS.map(k => [k, r[k]])), avg: null, epText: `EP#${n}` }))
      : h('p', { class: 'missing-block' }, '尺（duration_seconds）が未取得のため曲線を描けない'),
    h('div', { class: 'ret-side' },
      h('div', { class: 'type-badge', src: 'episode_retention.retention_type' }, r.type || '型ラベル未設定'),
      h('div', { class: 'ret-meta' },
        h('div', { class: 'kv' }, h('span', { class: 'k' }, '尺'), h('span', { class: 'v' }, val(r.duration === null ? MISSING : fmtMMSS(r.duration), ['出典: episodes.duration_seconds']))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, '中央視聴時間'), h('span', { class: 'v' }, val(r.medianLabel || MISSING, srcRet(r.ret, 'median_label')), r.medianSec !== null && r.duration && r.medianSec >= r.duration * 0.93 ? '（ほぼ全尺）' : '')),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Spotify標準比'), h('span', { class: 'v' }, val(r.vsStd || MISSING, srcRet(r.ret, num(r.ret.vs_standard_complete_pct) !== null ? "raw_retention->>'vs_standard_complete_pct'" : "raw_retention->>'vs_standard'"))))),
      r.ts5s.length ? null : h('p', { class: 'pf-caution' }, '曲線なし（ts5s 未取得）。Q点だけを表示'),
      r.longForm ? h('p', { class: 'pf-caution' }, '倍尺回。Complete の低下は尺による自然な低下として読む。') : null,
      h('div', { class: 'qcards' }, Q_KEYS.map(k => h('div', { class: 'qcard', style: { '--qc': qColor[k] } },
        h('p', { class: 'q-label' }, qLabel[k]), val(r[k] === null ? MISSING : `${fmtNum(r[k], 0)}%`, srcRet(r.ret, k === 'complete' ? 'raw_complete' : `raw_${k}`), 'q-val'))))));
  return h('section', { id: `sec-m-ep-${n}`, class: 'card' },
    sectionHead(`リテンション  ${epLabel(ix, n)}`, `EP#${n}  リテンション分析  [Spotify]`, `${e?.title ? e.title.replace(/^\s*#\s*\d+\s*/, '') : ''}  |  尺: ${fmtMMSS(e?.duration_seconds)}  |  中央視聴時間: ${r?.medianLabel || MISSING}`),
    body,
    r?.ret ? h('div', { class: 'cliff-grid' }, cliffTable(ix, n, `崖（episode_cliffs・${r.cliffs.length}件）`)) : null,
    r?.ret ? h('p', { class: 'calc-note' }, `曲線は ts5s（5秒刻み・${r.ts5s.length}点）を階段状に描画。崖の時刻と落差は DB、その区間で何を話していたかは照合メモ（人の読み取り）。`) : null,
    slide ? slideBox(slide, { open: true }) : noReport(ctx, `EP#${n} の回のページ`));
}

// ── p12 仮説・次月の実験（人の分析） ────────────────────────────────
function hypotheses(ctx) {
  const { slides } = ctx;
  return h('section', { id: 'sec-m-hypo', class: 'card dark-lite' },
    sectionHead('仮説・次月', slides.hypotheses[0]?.texts[0] || '過去回での仮説確認と、次月の検証', '人の判断（実験の判定・次月の実験・運用メモ）。月次PPTXの文章をそのまま表示'),
    reportBoxes(slides.hypotheses, { open: true, human: true }) || noReport(ctx, '仮説・次月の実験'));
}

// 割り当てられなかったスライド（古い月の補足など）。捨てない
function other(ctx) {
  const { slides } = ctx;
  if (!slides.other.length) return null;
  return h('section', { id: 'sec-m-other', class: 'card' },
    sectionHead('その他', 'この月だけのスライド', '9月月次の16枚の並びに当てはまらないスライド。月次PPTXの文章をそのまま表示'),
    reportBoxes(slides.other, { human: true }));
}

// ── p13 APPENDIX ────────────────────────────────────────────────────
function appendix(ctx) {
  const s = ctx.slides.appendix[0];
  return h('section', { class: 'card appendix' },
    h('p', { class: 'kicker' }, s ? s.texts[0] : 'APPENDIX'),
    h('h2', null, s?.texts[1] || 'Apple分析（公開7日）・オーディエンス属性・EP累積ランキング'),
    h('p', { class: 'sub' }, s?.texts[2] || '本編の結論を補強する詳細データ集'));
}

// ── p14 Apple ───────────────────────────────────────────────────────
function apple(ctx) {
  const { ix, mw, apple: a, slides } = ctx;
  const rows = a.rows.map(r => ({ label: `EP#${r.ep}`, plays: r.plays ?? r.playsAny, consume: r.consume }));
  const any = a.rows.some(r => r.plays !== null || r.playsAny !== null);
  const methodJa = r => (r.method === 'daily_sum' ? '公開日からUTC 7日の日別合計' : r.method ? `参考値（${r.main?.data_type || '種類未記録'}・${r.main?.exact_first_week ? '7日' : '7日確定ではない'}）` : MISSING);
  return h('section', { id: 'sec-m-apple', class: 'card' },
    sectionHead('Apple（APPENDIX）', slides.apple[0]?.texts[0] || 'Apple Podcasts 分析（公開7日）', `${mw.cover_label_jst}  |  再生数＝${a.allExact ? 'UTC7日合計' : '取得方法は回ごと（下の表）'}／消費率＝取得時点の参考値`),
    proposedNote(ctx),
    any ? chartBox('chart-mapple', 'Apple Podcastsの再生数と平均消費率', c => appleMonthChart(c, rows)) : h('p', { class: 'missing-block' }, 'Appleの値が未取得'),
    h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl resp' },
      h('thead', null, h('tr', null, ['回', '再生数', '取り方', '日別（UTC）', '消費率（参考）'].map(t => h('th', null, t)))),
      h('tbody', null, a.rows.map(r => h('tr', null,
        h('td', { 'data-label': '回' }, h('a', { href: `#/episode/${r.ep}` }, epLabel(ix, r.ep))),
        h('td', { 'data-label': '再生数' }, val(fmtInt(r.plays ?? r.playsAny), r.exact ? srcFW(r.exact, 'plays_or_views') : srcFW(r.main, 'plays_or_views'))),
        h('td', { 'data-label': '取り方', class: 'small' }, methodJa(r)),
        h('td', { 'data-label': '日別', class: 'small' }, r.daily.length ? val(`${r.daily.map(d => d.value ?? '?').join('+')} = ${fmtInt(r.dailySum)}`, [`出典: apple_daily（ap_plays_daily）${r.totalRow ? `・合計行 ${r.totalRow.period_start}〜${r.totalRow.period_end} = ${fmtInt(r.total)}` : ''}`, r.windowOk === false ? '注意: 合計行の期間が公開日から7日になっていない' : '期間: 公開日の UTC 日付から7日', r.outside.length ? `窓外の日（参考・足さない）: ${r.outside.map(o => `${o.date} ${o.value}`).join('、')}` : '']) : '—'),
        h('td', { 'data-label': '消費率' }, val(r.consume === null ? '取れない' : `${fmtNum(r.consume, r.consume % 1 ? 1 : 0)}%`, r.ref ? srcFW(r.ref, 'consume_pct') : ['reference 行なし'], r.consume === null ? 'muted' : ''))))))),
    h('p', { class: 'pf-caution' }, 'Appleは72時間遅延のため参考値。他のプラットフォームと順位を比べない。月次で遡及修正しない（2026-09-16 決定）。'),
    exclusionList(ctx.ex.filter(e => e.area === 'apple')),
    reportBoxes(slides.apple) || noReport(ctx, 'Apple'));
}

// ── p15 オーディエンス ──────────────────────────────────────────────
function audience(ctx) {
  const { mw, aud: a, slides } = ctx;
  const colors = { gender: ['#1B5E50', '#C8943C', '#7EC8B8', '#CCCCCC'], age: ['#16A085'], platform: ['#2471A3'], country: ['#C8943C'] };
  const panel = g => {
    const def = AUD_GROUPS[g];
    const items = a.groups[g];
    return h('div', { class: 'aud-panel' }, h('h4', null, g === 'age' && a.topAge ? `年齢（${a.topAge.label}歳が最大層）` : def.label),
      h('div', { class: 'hbars' }, items.map((it, i) => hbar(it.label, it.value, 100, `${it.value}%${it.derived ? '（計算）' : ''}`, colors[g][i] || colors[g][0],
        it.derived ? ['100 − 日本 − 米国（monthly_reference にその他の行が無い月。月次スクリプトのコメントどおり）'] : [`出典: monthly_reference ${mw.report_month}.${it.row?.metric_key || '（行なし）'}`, it.row ? `期間: ${it.row.period_start}〜${it.row.period_end}` : '']))));
  };
  return h('section', { id: 'sec-m-aud', class: 'card' },
    sectionHead('オーディエンス（APPENDIX）', slides.audience[0]?.texts[0] || 'オーディエンス分析  [Spotify]',
      a.period ? `UTC ${fmtYMD(a.period.start)}〜${fmtYMD(a.period.end)}（monthly_reference の期間）  |  リピーター${fmtInt(a.repeat.value)}人・新規${fmtInt(a.new.value)}人${a.total.value !== null ? `（合計${fmtInt(a.total.value)}人）` : ''}` : 'この月の monthly_reference にオーディエンスの値なし'),
    proposedNote(ctx),
    a.any ? h('div', { class: 'aud-grid' }, ['gender', 'age', 'platform', 'country'].map(panel)) : h('p', { class: 'missing-block' }, `未取得（${mw.report_month ? `monthly_reference ${mw.report_month} にオーディエンスの行がない` : 'この月の report_month が無い（approved の monthly_reference が無い）'}）`),
    a.any ? h('p', { class: 'calc-note' }, `${a.a3559 !== null ? `35-59歳の合計 ${a.a3559}%。` : ''}${a.prevMonth?.new !== null && a.prevMonth?.new !== undefined ? `前回（${a.prevMonth.key}${a.prevMonth.period ? `・UTC ${md(a.prevMonth.period.start)}–${md(a.prevMonth.period.end)}` : ''}）はリピーター${fmtInt(a.prevMonth.repeat)}人・新規${fmtInt(a.prevMonth.new)}人。期間の取り方が違う月どうしは参考比較。` : ''}オーディエンスは後日でもカスタム期間で取れる。`) : null,
    reportBoxes(slides.audience) || noReport(ctx, 'オーディエンス'));
}

// ── p16 累積ランキング ──────────────────────────────────────────────
function ranking(ctx) {
  const { ix, mw, rank: r, slides } = ctx;
  let body;
  if (!r.ok) body = h('p', { class: 'missing-block' }, `未取得（${r.reason}）。bundle にある累計スナップショット: ${r.dates.join('・') || 'なし'}`);
  else if (r.mode === 'increment') {
    const max = Math.max(1, ...r.top.map(x => x.delta));
    body = [
      h('div', { class: 'hbars rank' },
        r.top.map((x, i) => hbar(`#${x.ep} ${shortTitle(ix, x.ep).text}`, x.delta, max * 1.15, `+${x.delta}（累計${x.to}）`, i === 0 ? '#F0A500' : '#607D8B',
          [`出典: episode_cumulative_snapshots（spotify・approved）`, `${r.from}: ${x.from} → ${r.to}: ${x.to}`])),
        r.rest.length ? hbar(`その他${r.rest.length}本`, r.restAvg, max * 1.15, `平均+${fmtNum(r.restAvg, 1)}（各+${r.restMin}〜+${r.restMax}）`, '#B0BEC5', ['上位10本以外の増分の単純平均']) : null),
      h('p', { class: 'calc-note' }, `既配信${r.backEps.length}本（#${r.backEps[0]}〜#${r.backEps.at(-1)}、窓の開始より前に公開）の増分（${r.from}→${r.to}の${r.days}日間）。${r.missing.length ? `スナップショットが無い回: ${r.missing.map(n => '#' + n).join('・')}。` : ''}月次窓と期間が違う（窓末の累計は後から取れない。出典 ${r.sourceLabel}）。`),
      h('p', { class: 'calc-note' }, `当月配信の回（参考・${r.to}時点の累計）: ${r.cur.map(c => `#${c.ep} ${c.to === null ? MISSING : c.to}`).join('　')}`),
      r.ratio?.max ? h('p', { class: 'calc-note' }, `増分の期間に Spotify の再生÷日次オーディエンスが最も高かった日: ${md(r.ratio.max.date)}（UTC）${r.ratio.max.plays}回／${r.ratio.max.audience}人（${fmtNum(r.ratio.max.ratio, 1)}倍）。EP別の日次内訳は bundle に無い。`) : null,
    ];
  } else {
    const max = Math.max(1, ...r.top.map(x => x.to));
    const curSet = new Set(mw.episodes || []);
    body = [
      h('div', { class: 'hbars rank' }, r.top.map((x, i) => hbar(`#${x.ep} ${shortTitle(ix, x.ep).text}`, x.to, max * 1.15, `${x.to}${curSet.has(x.ep) ? '（当月配信）' : ''}`, curSet.has(x.ep) ? '#F0A500' : '#607D8B', [`出典: episode_cumulative_snapshots（spotify・${r.at}・approved）`]))),
      h('p', { class: 'calc-note' }, `${r.at}時点の累計の順位（${r.list.length}本）。増分の起点になる前回のスナップショットが bundle に無いため、前月比の増分は出せない。`),
    ];
  }
  return h('section', { id: 'sec-m-rank', class: 'card' },
    sectionHead('累積ランキング（APPENDIX）', slides.ranking[0]?.texts[0] || 'エピソード別 累積再生数ランキング', r.ok && r.mode === 'increment' ? `既配信${r.backEps.length}EPの増分・上位10本（${r.from}→${r.to}の${r.days}日間）` : r.ok ? `${r.at}時点の累計` : ''),
    proposedNote(ctx), body,
    exclusionList(ctx.ex.filter(e => e.area === 'ranking')),
    reportBoxes(slides.ranking) || noReport(ctx, '累積ランキング'));
}
