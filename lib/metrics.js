// BIBLIO JAM レポートダッシュボード：bundle の集計関数（DOMに依存しない）
// 形は CONTRACT.md 5節。ここでは値を作らない。DBの値を並べ替え・合計・比率にするだけ。
// 欠損は null のまま返し、0で埋めない。

export const COUNT_METHOD = 'plays_30s_threshold';
export const WINDOW_DEFINITION = 'release_influence_utc_thu_wed';
export const DEFINITION_CHANGE_WEEK = 19;          // W19から 6/11定義変更後・リリース影響週
export const DEFINITION_CHANGE_DATE = '2026-06-11';
export const SCREEN_THRESHOLD = 1.5;                // 反復再生スクリーニング（再生÷オーディエンス）
export const RETENTION_AVG_FROM = 10;               // 平均は EP#10 から（当該回−1）まで
export const LONG_FORM = 'long_form';

const DAY = 86400000;

// ── 基本 ────────────────────────────────────────────────────────────
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// 四捨五入（0.5は切り上げ＝+∞方向。PPTXの Math.round と同じ）。浮動小数の誤差を 1e-9 で吸収する。
// 画面の丸めはすべてこの関数を通す。
export function round(v, digits = 1) {
  const n = num(v);
  if (n === null) return null;
  const f = 10 ** digits;
  const r = Number((Math.round(n * f + 1e-9) / f).toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
}

export function isMissing(v) { return num(v) === null; }

export function sum(values) {
  let s = 0;
  for (const v of values) {
    const n = num(v);
    if (n === null) return null;
    s += n;
  }
  return s;
}

// ── 日付（YYYY-MM-DD はUTC暦日として扱う） ───────────────────────────
export function addDays(iso, days) {
  const t = Date.parse(iso + 'T00:00:00Z');
  if (Number.isNaN(t)) return null;
  return new Date(t + days * DAY).toISOString().slice(0, 10);
}

export function dateRange(start, end) {
  const out = [];
  if (!start || !end || start > end) return out;
  for (let d = start; d && d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function utcDate(ts) {
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export function jstDate(ts) {
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : new Date(t + 9 * 3600000).toISOString().slice(0, 10);
}

export function jstDateTime(ts) {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return null;
  const s = new Date(t + 9 * 3600000).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

export function weekdayJa(iso) {
  const t = Date.parse(iso + 'T00:00:00Z');
  return Number.isNaN(t) ? '' : '日月火水木金土'[new Date(t).getUTCDay()];
}

// ── bundle の索引 ────────────────────────────────────────────────────
export function indexBundle(bundle) {
  const db = (bundle && bundle.db) || {};
  const arr = k => (Array.isArray(db[k]) ? db[k] : []);
  const csv = (bundle && bundle.csv) || null;
  const csvArr = k => (csv && Array.isArray(csv[k]) ? csv[k] : []);
  const weeks = [...arr('weeks')].sort((a, b) => a.week_number - b.week_number);
  const episodes = [...arr('episodes')].sort((a, b) => a.episode_number - b.episode_number);
  const ix = {
    bundle, db, csv,
    notes: (bundle && bundle.notes) || {},
    kaiyu: (bundle && bundle.kaiyu_history) || null,
    episodes, weeks,
    windows: arr('week_windows'),
    daily: [...arr('daily')].sort((a, b) => (a.date < b.date ? -1 : 1)),
    firstWeek: arr('first_week'),
    retention: arr('retention'),
    cliffs: arr('cliffs'),
    dialog: arr('dialog'),
    episodeDaily: arr('episode_daily'),
    youtube: arr('youtube_videos'),
    csvDaily: csvArr('daily'),
    csvEpisodeDaily: csvArr('episode_daily'),
    csvConflicts: csvArr('conflicts'),
  };
  ix.epByNum = new Map(episodes.map(e => [e.episode_number, e]));
  ix.weekByNum = new Map(weeks.map(w => [w.week_number, w]));
  ix.windowByNum = new Map(ix.windows.map(w => [w.week_number, w]));
  ix.dailyByDate = new Map(ix.daily.map(d => [d.date, d]));
  ix.csvDailyByDate = new Map(ix.csvDaily.map(d => [d.date, d]));
  ix.csvEpDaily = new Map(ix.csvEpisodeDaily.map(d => [`${d.episode_number}|${d.date}`, d]));
  ix.retByEp = new Map();
  for (const r of ix.retention) {
    if (r.status && r.status !== 'approved') continue;
    const cur = ix.retByEp.get(r.episode_number);
    if (!cur || String(r.created_at || '') > String(cur.created_at || '')) ix.retByEp.set(r.episode_number, r);
  }
  return ix;
}

export function isSample(bundle) {
  return !!(bundle && (bundle.mode === 'fixture' || bundle._fixture_notice));
}

// ── 回のタイトル ─────────────────────────────────────────────────────
// 番組タイトル（episodes.title）から表示用の短縮形を作る。書名『…』があればそれ、
// 「…」だけならそれを『』で囲む。どちらもなければタイトル全体（先頭の #NN は除く）。
export function titleToShort(title) {
  if (!title) return null;
  const t = String(title).replace(/^\s*#\s*\d+\s*/, '').trim();
  const book = t.match(/『[^』]+』/);
  if (book) return book[0];
  const kagi = t.match(/「([^」]+)」/);
  if (kagi) return `『${kagi[1]}』`;
  return t ? `『${t}』` : null;
}

// 短縮タイトル：notes.<週>.cover.episodes[].shortTitle（新しい週を優先）→ episodes.title から作る
export function shortTitle(ix, n) {
  const weeks = Object.keys(ix.notes).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
  for (const w of weeks) {
    const eps = ix.notes[String(w)]?.cover?.episodes;
    if (!Array.isArray(eps)) continue;
    const hit = eps.find(e => num(e.num) === n && e.shortTitle);
    if (hit) return { text: hit.shortTitle, source: `notes W${w}（cover.episodes.shortTitle）` };
  }
  const ep = ix.epByNum.get(n);
  const t = ep ? titleToShort(ep.title) : null;
  return t ? { text: t, source: 'episodes.title から作成' } : { text: '', source: 'タイトル未登録' };
}

export function epLabel(ix, n) {
  return `EP#${n}${shortTitle(ix, n).text}`;
}

export function isLongForm(ix, n) {
  return ix.epByNum.get(n)?.duration_cohort === LONG_FORM;
}

// ── 週 ──────────────────────────────────────────────────────────────
export function latestApprovedWeek(ix) {
  const ws = ix.weeks.filter(w => w.status === 'approved');
  return ws.length ? ws[ws.length - 1] : (ix.weeks[ix.weeks.length - 1] || null);
}

// 週の値が実際に集計された窓。
// window_definition がリリース影響週（UTC木〜水）の週は week_windows の窓、未記録の週（W1〜W22）は
// period_start〜period_end（旧窓・金〜木）。2026-10-14 確認：W1〜W22 の値は period の日次合計と一致し、
// W23・W24 は week_windows の日次合計と一致する（period は旧窓のまま）。
export function weekWindow(ix, week) {
  if (!week) return null;
  const w = ix.windowByNum.get(week.week_number);
  const isNew = week.window_definition === WINDOW_DEFINITION;
  if (isNew && w && w.utc_start && w.utc_end) {
    return { start: w.utc_start, end: w.utc_end, definition: week.window_definition, source: 'week_windows', old: false,
             labelDiffers: w.utc_start !== week.period_start || w.utc_end !== week.period_end, notes: w.notes || null };
  }
  return { start: week.period_start, end: week.period_end, definition: week.window_definition || null,
           source: 'weekly_snapshots.period', old: !isNew, labelDiffers: false, notes: null };
}

// 窓内で daily の値がそろっている日数
export function daysPresent(ix, start, end, field = 'spotify_plays') {
  return dateRange(start, end).filter(d => num(ix.dailyByDate.get(d)?.[field]) !== null).length;
}

export function weekDays(ix, week) {
  if (!week) return null;
  if (num(week.days_present) !== null) return num(week.days_present);   // 契約外の列が来たら優先
  const win = weekWindow(ix, week);
  return win ? daysPresent(ix, win.start, win.end) : null;
}

// 前週比を出してよいか（CONTRACT 表示ルール）
export function wowComparison(ix, cur, prev) {
  const reasons = [];
  if (!cur) return { ok: false, reasons: ['今週のデータがない'] };
  if (!prev) return { ok: false, reasons: ['前週のデータがない'] };
  const lw = `W${prev.week_number}`, cw = `W${cur.week_number}`;
  if (cur.status !== 'approved') reasons.push(`${cw}が承認前（${cur.status || '状態未記録'}）`);
  if (prev.status !== 'approved') reasons.push(`${lw}が承認前（${prev.status || '状態未記録'}）`);
  for (const w of [prev, cur]) {
    const d = weekDays(ix, w);
    if (d !== 7) reasons.push(`W${w.week_number}の日次が7日そろっていない（${d === null ? '不明' : d + '日'}）`);
  }
  if (cur.count_method !== COUNT_METHOD || prev.count_method !== COUNT_METHOD) {
    reasons.push(`計数方法が${COUNT_METHOD}でそろっていない（${lw}: ${prev.count_method || '未記録'} / ${cw}: ${cur.count_method || '未記録'}）`);
  }
  if (!cur.window_definition || !prev.window_definition || cur.window_definition !== prev.window_definition) {
    reasons.push(`窓の定義がそろっていない（${lw}: ${prev.window_definition || '未記録'} / ${cw}: ${cur.window_definition || '未記録'}）`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function pctChange(cur, prev) {
  const c = num(cur), p = num(prev);
  if (c === null || p === null || p === 0) return null;
  return round((c - p) / p * 100, 1);
}

// その週の回：JSTの公開日が週のラベル期間（period_start〜period_end）に入る回
// ＋ notes の表紙に載った回（2026-10-14 方針：窓の数時間前の公開もその週の回。主/secondaryで分けない）
export function episodesForWeek(ix, week) {
  if (!week) return [];
  const set = new Set();
  for (const e of ix.episodes) {
    const d = jstDate(e.published_at);
    if (d && d >= week.period_start && d <= week.period_end) set.add(e.episode_number);
  }
  const noteEps = ix.notes[String(week.week_number)]?.cover?.episodes;
  const order = [];
  if (Array.isArray(noteEps)) for (const e of noteEps) { const n = num(e.num); if (n !== null) { set.add(n); order.push(n); } }
  return [...set].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a - b;
  });
}

export function weekOfEpisode(ix, n) {
  return ix.weeks.filter(w => episodesForWeek(ix, w).includes(n)).map(w => w.week_number);
}

export function weeklySeries(ix, { from = 1, to = Infinity } = {}) {
  return ix.weeks.filter(w => w.week_number >= from && w.week_number <= to);
}

// ── 初週（episode_first_week_metrics） ───────────────────────────────
// YouTube 公式APIで取った行（CONTRACT 1節：notes が「YouTube Analytics API（」で始まる）。
// 2026-10-14〜 当面は参考値（data_type=reference・exact_first_week=false）。正本は Studio の行
const YT_API_HEAD = 'YouTube Analytics API（';
export function isYoutubeApiRow(row) {
  return !!row && row.platform === 'youtube' && String(row.notes || '').startsWith(YT_API_HEAD);
}
// notes の書き出し「…7日合計。約160時間）」から時間を読む（Shorts が複数本なら「159.99〜160」）
export function youtubeApiHours(row) {
  const m = String(row?.notes || '').match(/^YouTube Analytics API（[^）]*?約([\d.]+(?:〜[\d.]+)?)時間）/);
  return m ? m[1] : null;
}
export function youtubeApiLabel(row) {
  const h = youtubeApiHours(row);
  return `API参考値（太平洋時間の7日${h ? `・約${h}時間` : ''}）`;
}

function pickMain(rows) {
  // API の行は参考値なので、Studio の行が1つでもあればそちらを主にする（同点の作成日順で API が勝たないように）
  const score = r => (r.data_type === 'first_week' ? 2 : 0) + (r.exact_first_week ? 1 : 0) - (isYoutubeApiRow(r) ? 10 : 0);
  return [...rows].sort((a, b) => score(b) - score(a) || String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
}

// YouTube の欄で、Studio の主の行と並べる API の行（最新1件）と差。主が API の行なら並べる相手は無い
export function youtubeApiCompare(group) {
  const main = group?.main || null;
  if (!main || isYoutubeApiRow(main)) return null;
  const api = [...(group.others || [])].filter(isYoutubeApiRow)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
  if (!api) return null;
  const diff = (k) => {
    const a = num(api[k]), s = num(main[k]);
    if (a === null || s === null) return null;
    return { api: a, studio: s, diff: round(a - s, 2), pct: s ? round((a - s) / s * 100, 1) : null };
  };
  return { api, studio: main, views: diff('plays_or_views'), watch_hours: diff('watch_hours'), avg_view_min: diff('avg_view_min') };
}

// ── 初週の値が無いときの見込み（2026-10-22〜）──────────────────────────
// 「未取得」を、後から取れるもの（取れる日・JST）と、7日値が取れないものに分けるために使う。
// 取れる日は公開日時からの目安：Spotify・YouTube（Studio）は公開から168時間、
// Apple は公開した UTC 日から7日間の最後の日が終わって72時間後（遅延が抜ける）、
// YouTube API は太平洋時間の7日目の翌日から処理に約3日（2026-10-22 時点の実測）。
const DAY_MS = 86400000;
function jstMonthDay(ms) {
  const s = new Date(ms + 9 * 3600000).toISOString();
  return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
}
export function firstWeekReadyAt(ep, key) {
  const t = Date.parse(ep?.published_at);
  if (Number.isNaN(t)) return null;
  if (key === 'spotify' || key === 'youtube_long' || key === 'shorts') return t + 7 * DAY_MS;
  if (key === 'apple') return Date.parse(utcDate(ep.published_at) + 'T00:00:00Z') + 10 * DAY_MS;
  if (key === 'youtube_api') {
    // 太平洋時間の日付（夏時間 UTC−7 で見る。冬時間との1時間の差は目安の範囲）
    const ptDay = new Date(t - 7 * 3600000).toISOString().slice(0, 10);
    return Date.parse(ptDay + 'T00:00:00Z') + 10 * DAY_MS;
  }
  return null;
}
export function firstWeekLater(ep, key, now = Date.now()) {
  const at = firstWeekReadyAt(ep, key);
  if (at === null) return null;
  return { at, date: jstMonthDay(at), ready: now >= at };
}

export function platformKey(row) {
  if (row.platform === 'spotify') return 'spotify';
  if (row.platform === 'apple') return 'apple';
  if (row.platform === 'youtube') return (row.video_type === 'shorts' || row.is_short === true) ? 'shorts' : 'youtube_long';
  return 'other';
}

export function firstWeekFor(ix, n) {
  const rows = ix.firstWeek.filter(r => r.episode_number === n && (!r.status || r.status === 'approved'));
  const out = {};
  for (const key of ['spotify', 'apple', 'youtube_long', 'shorts']) {
    const g = rows.filter(r => platformKey(r) === key);
    const main = pickMain(g);
    out[key] = { main, others: g.filter(r => r !== main) };
  }
  out.shortsVideos = ix.youtube.filter(v => v.episode_number === n && v.is_short === true);
  out.longVideos = ix.youtube.filter(v => v.episode_number === n && v.is_short !== true);
  return out;
}

// ── リテンション ─────────────────────────────────────────────────────
export const Q_KEYS = ['q1', 'q2', 'q3', 'complete'];

export function retentionFor(ix, n) { return ix.retByEp.get(n) || null; }

// EP#from〜to の approved（各回の最新1件）の単純平均。欠損の回は数えない。
// to の既定は n−1。週次画面は週の最新回−1 を渡す（PPTXは同じ週の回すべてに同じ平均を使う。W36は#37・#38ともEP#10-37）。
export function retentionAverage(ix, n, from = RETENTION_AVG_FROM, to = n - 1) {
  const rows = [...ix.retByEp.values()].filter(r => r.episode_number >= from && r.episode_number <= to);
  const metrics = {};
  for (const k of Q_KEYS) {
    const vals = rows.map(r => num(r[k])).filter(v => v !== null);
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    metrics[k] = { mean, avg: round(mean, 1), n: vals.length, missing: rows.length - vals.length };
  }
  return { from, to, n: rows.length, episodes: rows.map(r => r.episode_number).sort((a, b) => a - b), metrics };
}

// 差は平均を小数1桁に丸めてから計算する（PPTXの diffPt と同じ）
export function diffPt(value, avg) {
  const v = num(value), a = num(avg);
  if (v === null || a === null) return null;
  return round(v - a, 1);
}

export function quartileTimes(durationSec) {
  const d = num(durationSec);
  if (d === null) return null;
  return { q1: d * 0.25, q2: d * 0.5, q3: d * 0.75, complete: d };
}

// 点は [秒, %] が基本。EP#20 だけ {t: 秒, r: %} で入っている（DB_AUDIT_20261014）ので両方読む。値は変えない
export function cleanTs5s(ts) {
  if (!Array.isArray(ts)) return [];
  const seen = new Set();
  const out = [];
  for (const p of ts) {
    const pair = Array.isArray(p) ? p : (p && typeof p === 'object' && 't' in p && 'r' in p) ? [p.t, p.r] : null;
    if (!pair || pair.length < 2) continue;
    const x = num(pair[0]), y = num(pair[1]);
    if (x === null || y === null || seen.has(x)) continue;
    seen.add(x);
    out.push([x, y]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// ── 崖・対話 ─────────────────────────────────────────────────────────
const CLIFF_JA = { early: '早期', mid: '中盤', late: '終盤' };
export function cliffClassJa(c) { return CLIFF_JA[c] || c || '不明'; }

export function cliffsFor(ix, n) {
  return ix.cliffs.filter(c => c.episode_number === n).sort((a, b) => (a.cliff_index ?? 0) - (b.cliff_index ?? 0));
}

export function dialogFor(ix, n) {
  const rows = ix.dialog.filter(d => d.episode_number === n);
  return rows.length ? rows[rows.length - 1] : null;
}

// ── 回遊（番組全体・週次） ───────────────────────────────────────────
// インプレッション：日次CSVの窓内合計（7日そろったときだけ）。weekly_snapshots.impressions は別に返す。
export function impressionsForWeek(ix, week) {
  const win = weekWindow(ix, week);
  if (!win) return null;
  const days = dateRange(win.start, win.end);
  const vals = days.map(d => ix.csvDailyByDate.get(d)?.impressions);
  const present = vals.filter(v => num(v) !== null).length;
  const files = [...new Set(days.map(d => ix.csvDailyByDate.get(d)?.source?.impressions).filter(Boolean))];
  return { value: present === days.length && days.length === 7 ? sum(vals) : null, days: present, of: days.length, files, dbValue: num(week.impressions), window: win };
}

// 反復再生スクリーニング：日別の Spotify再生（daily）÷ Spotifyオーディエンス（CSV）
export function repeatScreening(ix, week, threshold = SCREEN_THRESHOLD) {
  const win = weekWindow(ix, week);
  if (!win) return null;
  const rows = dateRange(win.start, win.end).map(d => {
    const plays = num(ix.dailyByDate.get(d)?.spotify_plays);
    const audience = num(ix.csvDailyByDate.get(d)?.spotify_audience);
    const hours = num(ix.dailyByDate.get(d)?.spotify_listening_hours);
    const ratio = plays !== null && audience ? plays / audience : null;
    return { date: d, plays, audience, hours, ratio, ratioLabel: ratio === null ? null : round(ratio, 2).toFixed(2), flag: ratio !== null && ratio > threshold,
             source: ix.csvDailyByDate.get(d)?.source?.spotify_audience || null };
  });
  const complete = rows.every(r => r.plays !== null && r.audience !== null);
  const sp = sum(rows.map(r => r.plays)), au = sum(rows.map(r => r.audience));
  const weekRatio = complete && au ? sp / au : null;
  return { rows, complete, weekRatio, weekRatioLabel: weekRatio === null ? null : round(weekRatio, 2).toFixed(2), threshold, window: win };
}

// 回遊率＝（全PF週次 − その週の新作の窓内再生）÷ 全PF週次
// 新作：公開UTC日から7日間（初週）が窓と1日でも重なる回。窓内再生はその重なる日の
// 「ストリーミング数とダウンロード数」（EP日次CSV）の合計。
// 例：W35は#36に加えて#37の09-30（公開後9時間）も新作側、W36は#37の10-01〜10-06と#38。
// gen_kaiyuritsu_w36.py の W30〜W36 の値と一致する。
export function newEpisodesInWindow(ix, win) {
  if (!win) return [];
  return ix.episodes.filter(e => {
    const first = utcDate(e.published_at);
    return first && first <= win.end && addDays(first, 6) >= win.start;
  }).map(e => e.episode_number);
}

export function kaiyuRate(ix, week) {
  const win = weekWindow(ix, week);
  const den = num(week?.all_platforms_streams);
  const eps = newEpisodesInWindow(ix, win);
  const parts = [];
  let ok = den !== null && den > 0 && !!win;
  const reasons = [];
  if (den === null) reasons.push('全プラットの週次値が未取得');
  for (const n of eps) {
    const ep = ix.epByNum.get(n);
    const first = ep ? utcDate(ep.published_at) : null;
    if (!first || !win) { ok = false; reasons.push(`EP#${n}の公開日が不明`); continue; }
    const from = first > win.start ? first : win.start;
    const lastOfFirstWeek = addDays(first, 6);
    const to = lastOfFirstWeek < win.end ? lastOfFirstWeek : win.end;
    const days = dateRange(from, to);
    const vals = days.map(d => ix.csvEpDaily.get(`${n}|${d}`)?.streams_and_downloads);
    const missing = days.filter((d, i) => num(vals[i]) === null);
    const plays = missing.length ? null : sum(vals);
    if (missing.length) { ok = false; reasons.push(`EP#${n}の日次（${missing[0]}${missing.length > 1 ? ' ほか' + (missing.length - 1) + '日' : ''}）が未取得`); }
    const files = [...new Set(days.map(d => ix.csvEpDaily.get(`${n}|${d}`)?.source).filter(Boolean))];
    parts.push({ episode_number: n, from, to, days: days.length, plays, files });
  }
  if (!eps.length) { ok = false; reasons.push('窓と初週が重なる回がない'); }
  const newPlays = ok ? sum(parts.map(p => p.plays)) : null;
  const pct = ok ? round((den - newPlays) / den * 100, 1) : null;
  return { ok, pct, pctInt: pct === null ? null : round(pct, 0), den, newPlays, parts, reasons, window: win };
}

export function kaiyuHistory(kh) {
  if (!kh || !Array.isArray(kh.weeks)) return [];
  const nd = kh.no_data || {};
  return kh.weeks.map((w, i) => ({
    week: w,
    a: num(kh.series_a?.[i]),
    b: num(kh.series_b?.[i]),
    noData: nd[String(w)] || null,
  }));
}

// ── データの状態 ─────────────────────────────────────────────────────
function maxOf(rows, key) {
  let m = null;
  for (const r of rows) { const v = r[key]; if (v !== null && v !== undefined && (m === null || v > m)) m = v; }
  return m;
}

function countBy(rows, key) {
  const out = {};
  for (const r of rows) { const k = r[key] ?? '（空）'; out[k] = (out[k] || 0) + 1; }
  return out;
}

export function tableStats(ix) {
  return [
    { table: 'episodes', label: '回', rows: ix.episodes.length, latest: maxOf(ix.episodes.map(e => ({ d: jstDate(e.published_at) })), 'd'), latestLabel: '最新の公開日（JST）' },
    { table: 'weekly_snapshots', key: 'weeks', label: '週次', rows: ix.weeks.length, latest: ix.weeks.length ? `W${ix.weeks[ix.weeks.length - 1].week_number}（${ix.weeks[ix.weeks.length - 1].period_end}）` : null, latestLabel: '最新の週', breakdown: countBy(ix.weeks, 'status') },
    { table: 'week_windows', label: '週の集計窓', rows: ix.windows.length, latest: maxOf(ix.windows, 'utc_end'), latestLabel: '最新の窓の終わり' },
    { table: 'daily_metrics', key: 'daily', label: '日次', rows: ix.daily.length, latest: maxOf(ix.daily, 'date'), latestLabel: '最新日' },
    { table: 'episode_first_week_metrics', key: 'first_week', label: '回の初週', rows: ix.firstWeek.length, latest: maxOf(ix.firstWeek, 'period_end'), latestLabel: '最新の期間の終わり', breakdown: countBy(ix.firstWeek.map(r => ({ k: platformKey(r) })), 'k') },
    { table: 'episode_retention', key: 'retention', label: 'リテンション', rows: ix.retention.length, latest: maxOf(ix.retention, 'measured_period_end'), latestLabel: '最新の計測期間の終わり' },
    { table: 'episode_cliffs', key: 'cliffs', label: '崖', rows: ix.cliffs.length, latest: maxOf(ix.cliffs, 'episode_number') === null ? null : `EP#${maxOf(ix.cliffs, 'episode_number')}`, latestLabel: '最新の回' },
    { table: 'episode_dialog_metrics', key: 'dialog', label: '対話メトリクス', rows: ix.dialog.length, latest: maxOf(ix.dialog, 'episode_number') === null ? null : `EP#${maxOf(ix.dialog, 'episode_number')}`, latestLabel: '最新の回' },
    { table: 'episode_daily_metrics', key: 'episode_daily', label: '回の日次', rows: ix.episodeDaily.length, latest: maxOf(ix.episodeDaily, 'metric_date'), latestLabel: '最新日', breakdown: countBy(ix.episodeDaily.map(r => ({ k: `${r.platform}/${r.status}` })), 'k') },
    { table: 'youtube_videos', label: 'YouTube動画', rows: ix.youtube.length, latest: maxOf(ix.youtube.map(v => ({ d: utcDate(v.published_at) })), 'd'), latestLabel: '最新の公開日' },
    { table: 'csv_extras.daily', key: 'csv.daily', label: 'CSV補助（オーディエンス・インプレッション）', rows: ix.csvDaily.length, latest: maxOf(ix.csvDaily, 'date'), latestLabel: '最新日', csv: true },
    { table: 'csv_extras.episode_daily', key: 'csv.episode_daily', label: 'CSV補助（回の日次）', rows: ix.csvEpisodeDaily.length, latest: maxOf(ix.csvEpisodeDaily, 'date'), latestLabel: '最新日', csv: true },
  ];
}

// 未取得の項目一覧
export function missingItems(ix, { today } = {}) {
  const items = [];
  const add = (area, text, level = 'warn') => items.push({ area, text, level });
  const lastDaily = maxOf(ix.daily, 'date');
  if (!ix.daily.length) add('日次', 'daily_metrics が0件');
  else {
    if (today) {
      const gap = Math.round((Date.parse(today) - Date.parse(lastDaily)) / DAY);
      if (gap > 3) add('日次', `daily_metrics の最新日は ${lastDaily}（${gap}日前）`);
    }
    for (const f of ['spotify_plays', 'all_platforms_streams', 'spotify_listening_hours', 'spotify_followers']) {
      const recent = ix.daily.filter(d => d.date > addDays(lastDaily, -30));
      const miss = recent.filter(d => num(d[f]) === null).map(d => d.date);
      if (miss.length) add('日次', `直近30日で ${f} が空の日: ${miss.length}日（${miss.slice(0, 3).join('・')}${miss.length > 3 ? ' ほか' : ''}）`);
    }
    const dates = ix.daily.map(d => d.date);
    const gaps = [];
    for (let i = 1; i < dates.length; i++) if (addDays(dates[i - 1], 1) !== dates[i]) gaps.push(`${dates[i - 1]}→${dates[i]}`);
    if (gaps.length) add('日次', `日付の抜け: ${gaps.length}か所（${gaps.slice(0, 3).join('、')}${gaps.length > 3 ? ' ほか' : ''}）`);
  }
  const w19 = ix.weeks.filter(w => w.week_number >= DEFINITION_CHANGE_WEEK);
  for (const f of ['spotify_plays', 'all_platforms_streams', 'spotify_listening_hours', 'repeat_listeners', 'new_listeners', 'impressions', 'spotify_followers_delta']) {
    const miss = w19.filter(w => num(w[f]) === null).map(w => `W${w.week_number}`);
    if (miss.length) add('週次', `${f}${f === 'impressions' ? '（Spotify発見タブのインプレッション）' : ''} が空の週: ${miss.join('・')}`);
  }
  const noWin = w19.filter(w => !w.window_definition).map(w => `W${w.week_number}`);
  if (noWin.length) add('週次', `window_definition が未記録の週: ${noWin.join('・')}（前週比は出さない）`, 'info');
  const drafts = ix.weeks.filter(w => w.status !== 'approved').map(w => `W${w.week_number}（${w.status}）`);
  if (drafts.length) add('週次', `承認前の週: ${drafts.join('・')}`, 'info');

  const fromEp = 19;
  for (const e of ix.episodes.filter(e => e.episode_number >= fromEp)) {
    const n = e.episode_number;
    const fw = firstWeekFor(ix, n);
    const core = [['spotify', 'Spotify'], ['apple', 'Apple']].filter(([k]) => !fw[k].main).map(([, l]) => l);
    if (core.length) add('回の初週', `EP#${n}: ${core.join('・')} の初週が未登録`);
    const yt = [['youtube_long', 'YouTube長尺'], ['shorts', 'Shorts']].filter(([k]) => !fw[k].main).map(([, l]) => l);
    if (yt.length) add('回の初週', `EP#${n}: ${yt.join('・')} の初週が未登録（音声回・Now Reading回など作っていない回もある）`, 'info');
    const ret = retentionFor(ix, n);
    if (!ret) add('リテンション', `EP#${n}: approved のリテンションがない`);
    else if (!cleanTs5s(ret.ts5s).length) add('リテンション', `EP#${n}: ts5s（5秒刻みの曲線）が未取得`, 'info');
    if (!cliffsFor(ix, n).length) add('崖', `EP#${n}: episode_cliffs が0件`, 'info');
    if (!dialogFor(ix, n)) add('対話', `EP#${n}: episode_dialog_metrics がない`, 'info');
  }
  if (!ix.youtube.length) add('YouTube', 'youtube_videos が0件');
  else {
    const last = maxOf(ix.youtube.map(v => ({ d: utcDate(v.published_at) })), 'd');
    const lastEp = maxOf(ix.episodes.map(e => ({ d: jstDate(e.published_at) })), 'd');
    if (last && lastEp && last < addDays(lastEp, -14)) add('YouTube', `youtube_videos は ${last} 公開分で止まっている（最新回の公開は ${lastEp}）`);
  }
  if (!ix.episodeDaily.length) add('回の日次', 'episode_daily_metrics が0件', 'info');
  if (!ix.csv) add('CSV補助', 'csv_extras がbundleにない（オーディエンス・インプレッション・回の日次は表示できない）');
  if (ix.csvConflicts.length) add('CSV補助', `取得日によって値が違う日: ${ix.csvConflicts.length}件（新しいフォルダの値を採用）`, 'info');
  if (!ix.kaiyu) add('回遊率', 'kaiyu_history がbundleにない');
  if (!Object.keys(ix.notes).length) add('文章', 'notes（週ごとの文章）が1件もない');
  const missingInputs = Array.isArray(ix.bundle?.missing) ? ix.bundle.missing : [];
  for (const m of missingInputs) add('bundle', `組み立て時に入力がなかった: ${m}`);
  return items;
}
