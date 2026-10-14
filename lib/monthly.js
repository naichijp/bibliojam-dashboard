// BIBLIO JAM レポートダッシュボード：月次の集計関数（DOMに依存しない）
// 形は CONTRACT.md 6節。月の窓（集計期間・対象週・対象回・前期・除外の判断）は bundle.month_windows、
// 文章は bundle.notes_monthly。数値は bundle.db・bundle.csv から計算する（ここで値を作らない・書き写さない）。
// 欠損は null のまま返し、0で埋めない。丸めは metrics.round（四捨五入）だけを使う。
import {
  num, round, sum, addDays, dateRange, utcDate, pctChange, firstWeekFor, retentionFor, cleanTs5s, cliffsFor,
  weekWindow, WINDOW_DEFINITION, SCREEN_THRESHOLD, Q_KEYS,
} from './metrics.js';

export const MONTH_STATUS_JA = { final: '確定', superseded: '差し替え済み', proposed: '予定（未確定）' };
export const BASIS_JA = {
  release_influence: 'リリース影響週（daily を week_windows の UTC 窓で合計）',
  weekly_snapshots: 'weekly_snapshots の週の値（旧の週区切り）',
  same: 'weekly_snapshots の週の値（リリース影響週の日次合計と一致）',
};

// ── 索引（ix ごとに1回だけ作る） ─────────────────────────────────────
const cache = new WeakMap();
function mx(ix) {
  let m = cache.get(ix);
  if (m) return m;
  const b = ix.bundle || {};
  const db = ix.db || {};
  const arr = k => (Array.isArray(db[k]) ? db[k] : []);
  const months = [...((b.month_windows && Array.isArray(b.month_windows.months)) ? b.month_windows.months : [])]
    .sort((a, c) => (a.month_key < c.month_key ? -1 : a.month_key > c.month_key ? 1 : 0));
  const mref = new Map();
  for (const r of arr('monthly_reference')) {
    if (r.status && r.status !== 'approved') continue;
    if (!mref.has(r.report_month)) mref.set(r.report_month, new Map());
    mref.get(r.report_month).set(r.metric_key, r);
  }
  const cum = new Map();   // platform → date → ep → row
  for (const r of arr('cumulative')) {
    if (r.status && r.status !== 'approved') continue;
    if (!cum.has(r.platform)) cum.set(r.platform, new Map());
    const byDate = cum.get(r.platform);
    if (!byDate.has(r.snapshot_date)) byDate.set(r.snapshot_date, new Map());
    byDate.get(r.snapshot_date).set(r.episode_number, r);
  }
  m = {
    months,
    byKey: new Map(months.map(x => [x.month_key, x])),
    notes: (b.notes_monthly && typeof b.notes_monthly === 'object') ? b.notes_monthly : {},
    rule: b.month_windows?.rule || null,
    hasWindows: !!b.month_windows,
    mref,
    cum,
    appleDaily: arr('apple_daily'),
    ytImp: arr('youtube_impressions'),
    hasMonthlyArrays: ['monthly_reference', 'cumulative', 'apple_daily', 'youtube_impressions'].every(k => Array.isArray(db[k])),
  };
  cache.set(ix, m);
  return m;
}

// ── 月の一覧・既定 ───────────────────────────────────────────────────
export function listMonths(ix) {
  const m = mx(ix);
  return m.months.map(mw => ({
    key: mw.month_key, mw, status: mw.status, statusJa: MONTH_STATUS_JA[mw.status] || mw.status || '状態未記録',
    hasNotes: !!m.notes[mw.month_key],
  }));
}

export function hasMonthly(ix) { return mx(ix).months.length > 0; }

// 既定：status が proposed でない最新の月
export function defaultMonthKey(ix) {
  const ms = mx(ix).months.filter(x => x.status !== 'proposed');
  return ms.length ? ms[ms.length - 1].month_key : (mx(ix).months.at(-1)?.month_key || null);
}

export function getMonth(ix, key) { return mx(ix).byKey.get(key) || null; }
export function monthNotes(ix, key) { return mx(ix).notes[key] || null; }
export function monthRule(ix) { return mx(ix).rule; }

// 一つ前の確定月（前回比の相手。superseded と proposed は飛ばす）
export function previousFinalMonth(ix, key) {
  const ms = mx(ix).months.filter(x => x.status === 'final' && x.month_key < key);
  return ms.length ? ms[ms.length - 1] : null;
}

// ── 出典の表記 ──────────────────────────────────────────────────────
export function sourceLabel(src) {
  if (!src) return '出典の記録なし';
  if (src.file) return `${String(src.file).split('/').pop()}:${src.line}「${src.text}」`;
  if (src.notes) return `月次PPTX p${src.slide}「${src.text}」`;
  return String(src.text || '出典の記録なし');
}

// ── スライドの割り当て（月によってスライド構成が違うので、各スライドの最初の段落で見分ける） ──
// 割り当てられなかったスライドは other に入れて捨てない。
export function classifySlides(notes) {
  const out = { cover: [], summary: [], weekly: [], discovery: [], deep: [], youtube: [], heatmap: [], epret: new Map(),
    hypotheses: [], appendix: [], apple: [], audience: [], ranking: [], other: [] };
  for (const s of notes?.slides || []) {
    const t = String(s.texts?.[0] || s.title || '');
    let m;
    if (s.index === 1 || /^月次レポート/.test(t)) out.cover.push(s);
    else if (s.index === 2) out.summary.push(s);
    else if (/週次再生数トレンド/.test(t)) out.weekly.push(s);
    else if ((m = t.match(/^EP#(\d+)\s+リテンション分析/))) out.epret.set(Number(m[1]), s);
    else if (/リテンション全体サマリー/.test(t)) out.heatmap.push(s);
    else if (/^深堀り/.test(t)) out.deep.push(s);
    else if (/YouTube/.test(t)) out.youtube.push(s);
    else if (/発見|ディスカバリー|ファネル/.test(t)) out.discovery.push(s);
    else if (/^(APPENDIX|付録)$/.test(t.trim())) out.appendix.push(s);
    else if (/Apple/.test(t)) out.apple.push(s);
    else if (/オーディエンス/.test(t)) out.audience.push(s);
    else if (/ランキング/.test(t)) out.ranking.push(s);
    else if (/仮説|実験|次のステップ|全体まとめ/.test(t)) out.hypotheses.push(s);
    else out.other.push(s);
  }
  return out;
}

// 文中の「分析:」「示唆:」で始まる段落（解説文）と、それ以外（見出し・数字・ラベル）を分ける
export function slideParagraphs(slide) {
  const texts = (slide?.texts || []).slice(1);
  const analysis = texts.filter(t => /^(分析|示唆)\s*[:：]/.test(t));
  return { heading: slide?.texts?.[0] || slide?.title || '', analysis, rest: texts.filter(t => !analysis.includes(t)) };
}

// ── 除外・感度分析の判断（month_windows.exclusions。人の判断） ─────────
// 画面の計算に反映できるものは effect に構造化する。反映しないものも表示はする。
function areaOf(item) {
  const s = String(item || '');
  if (/^(前期比|週平均|前月比|W\d+|注記)/.test(s)) return 'weekly';
  if (/^YouTube\s*前期/.test(s)) return 'youtube_prev';
  if (/^YouTube/.test(s)) return 'youtube';
  if (/^リテンション/.test(s)) return 'retention_prev';
  if (/^Apple/.test(s)) return 'apple';
  if (/^累積/.test(s)) return 'ranking';
  if (/^深堀り/.test(s)) return 'deep';
  return 'other';
}

export const AREA_JA = { weekly: '週次・前期比', youtube_prev: 'YouTube前期', youtube: 'YouTube', retention_prev: 'リテンション前期比較', apple: 'Apple', ranking: '累積ランキング', deep: '深堀り', other: 'その他' };

export function monthExclusions(ix, key) {
  const mw = getMonth(ix, key);
  if (!mw) return [];
  const year = (mw.utc_start || mw.jst_start || key).slice(0, 4);
  return (mw.exclusions || []).map((x, i) => {
    const area = areaOf(x.item);
    const decision = String(x.decision || '');
    const text = String(x.source?.text || '');
    let effect = null;
    const adj = text.match(/\bADJ(_PREV)?\s*=\s*(\d+)/);
    if (area === 'weekly' && adj) {
      const period = adj[1] ? 'prev' : 'cur';
      const wk = decision.match(/W(\d+)/);
      const md = decision.match(/(\d{2})\/(\d{2})/);
      effect = { type: 'adjust', period, amount: Number(adj[2]), week: wk ? Number(wk[1]) : null,
                 date: md ? `${year}-${md[1]}-${md[2]}` : null };
      if (effect.week === null && effect.date) {
        const w = (period === 'prev' ? mw.prev_weeks : mw.weeks || []).find(n => {
          const win = ix.windowByNum.get(n);
          return win && win.utc_start <= effect.date && effect.date <= win.utc_end;
        });
        effect.week = w ?? null;
      }
    } else if (area === 'youtube_prev') {
      const eps = [...decision.matchAll(/EP#(\d+)\s*は[^。]*?除外/g)].map(m => Number(m[1]));
      if (eps.length) effect = { type: 'exclude_eps', eps };
    } else if (area === 'retention_prev') {
      const eps = [...decision.matchAll(/（EP#(\d+)）を含むため、これを除いた/g)].map(m => Number(m[1]));
      if (eps.length) effect = { type: 'exclude_eps', eps };
    } else if (area === 'youtube') {
      const eps = [...decision.matchAll(/EP#(\d+)/g)].map(m => Number(m[1]));
      if (eps.length) effect = { type: 'flag_eps', eps };
    }
    return { index: i, item: x.item, decision, source: x.source || null, sourceLabel: sourceLabel(x.source), area, effect };
  });
}

function exclusionsOf(ix, key, area, type) {
  return monthExclusions(ix, key).filter(e => e.area === area && (!type || e.effect?.type === type));
}

// ── 週の値の取り方（W14〜W22 は weekly_snapshots とリリース影響週の値が違う） ─────────
// 出典で決める：①data_windows の「週次推移の値」②caveats の「weekly_snapshots（旧の週区切り）」
// ③月次PPTXの文字「リリース影響週(UTC木〜水)で再集計」④全週がリリース影響週で集計済み（＝両者一致）
// ⑤どれも無い（移行前の月）→ weekly_snapshots
export function weekBasis(ix, key) {
  const mw = getMonth(ix, key);
  if (!mw) return null;
  const weeks = [...(mw.prev_weeks || []), ...(mw.weeks || [])];
  const dw = (mw.data_windows || []).find(d => d.item === '週次推移の値' && /リリース影響週/.test(d.window || ''));
  if (dw) return { basis: 'release_influence', label: BASIS_JA.release_influence, how: '月の窓（data_windows「週次推移の値」）',
                   reason: [dw.window, dw.note].filter(Boolean).join('。'), source: dw.source, sourceLabel: sourceLabel(dw.source) };
  const cv = (mw.caveats || []).find(c => /weekly_snapshots（旧の週区切り）/.test(c));
  if (cv) return { basis: 'weekly_snapshots', label: BASIS_JA.weekly_snapshots, how: '月の窓（caveats）', reason: cv, source: null, sourceLabel: `month_windows.caveats「${cv}」` };
  const notes = monthNotes(ix, key);
  for (const s of notes?.slides || []) {
    const t = (s.texts || []).find(x => /リリース影響週\(UTC木〜水\)で再集計/.test(x));
    if (t) {
      const src = { notes: `data/notes/monthly/${key}.json`, slide: s.index, text: t.match(/[^｜|]*リリース影響週\(UTC木〜水\)で再集計[^｜|]*/)?.[0].trim() || t };
      return { basis: 'release_influence', label: BASIS_JA.release_influence, how: '月次PPTXの文字', reason: src.text, source: src, sourceLabel: sourceLabel(src) };
    }
  }
  // 登録済みの週がすべてリリース影響週で集計済みで、月の窓もリリース影響週（予定の月は未登録の週があってよい）
  const existing = weeks.filter(n => ix.weekByNum.has(n));
  const allNew = existing.length > 0 && existing.every(n => ix.weekByNum.get(n).window_definition === WINDOW_DEFINITION)
    && (existing.length === weeks.length || mw.week_definition === WINDOW_DEFINITION);
  if (allNew) {
    const missing = weeks.filter(n => !ix.weekByNum.has(n));
    return { basis: 'same', label: BASIS_JA.same, how: '全週の window_definition',
             reason: `${existing.length === weeks.length ? '全週' : '登録済みの週'}（W${existing[0]}〜W${existing.at(-1)}）の weekly_snapshots.window_definition が ${WINDOW_DEFINITION}。週の値はリリース影響週の日次合計と同じ${missing.length ? `（${missing.map(n => 'W' + n).join('・')}は未登録）` : ''}`,
             source: null, sourceLabel: 'weekly_snapshots.window_definition' };
  }
  return { basis: 'weekly_snapshots', label: BASIS_JA.weekly_snapshots, how: '既定（出典に記載なし）', reason: 'リリース影響週への移行前の月次。出典に週の値の取り方の記載がないため、当時の週次（weekly_snapshots）の値で計算した', source: null, sourceLabel: '出典に記載なし' };
}

// その週を daily の UTC 窓（week_windows）で合計した値。7日そろわなければ null
function riSums(ix, n) {
  const win = ix.windowByNum.get(n);
  if (!win || !win.utc_start || !win.utc_end) return null;
  const days = dateRange(win.utc_start, win.utc_end);
  const sp = days.map(d => num(ix.dailyByDate.get(d)?.spotify_plays));
  const al = days.map(d => num(ix.dailyByDate.get(d)?.all_platforms_streams));
  const present = days.filter((d, i) => sp[i] !== null && al[i] !== null).length;
  const ok = present === days.length && days.length === 7;
  return { sp: ok ? sum(sp) : null, all: ok ? sum(al) : null, days: present, of: days.length, start: win.utc_start, end: win.utc_end };
}

export function weekValues(ix, n, basis) {
  const w = ix.weekByNum.get(n) || null;
  const ri = riSums(ix, n);
  const ws = w ? { sp: num(w.spotify_plays), all: num(w.all_platforms_streams) } : null;
  const useRI = basis === 'release_influence';
  const use = useRI ? ri : ws;
  const alt = useRI ? ws : ri;
  const win = useRI || basis === 'same'
    ? (ri ? { start: ri.start, end: ri.end, old: false } : null)
    : (w ? weekWindow(ix, w) : null);
  const differs = !!(use && alt && (use.sp !== alt.sp || use.all !== alt.all) && alt.sp !== null && alt.all !== null);
  return {
    week: n, exists: !!w, status: w?.status || null, row: w,
    sp: use ? use.sp : null, all: use ? use.all : null,
    alt: alt ? { sp: alt.sp, all: alt.all, label: useRI ? 'weekly_snapshots（旧の週区切り）' : 'リリース影響週（daily の UTC 窓合計）' } : null,
    differs, window: win, basis,
    source: useRI ? `daily_metrics を week_windows W${n}（UTC ${ri?.start || '?'}〜${ri?.end || '?'}）で合計（${ri ? ri.days : 0}/7日）` : `weekly_snapshots W${n}`,
  };
}

export function periodTotals(ix, weeks, basis) {
  const rows = (weeks || []).map(n => weekValues(ix, n, basis));
  const missing = rows.filter(r => r.sp === null || r.all === null).map(r => r.week);
  const notApproved = rows.filter(r => r.exists && r.status !== 'approved').map(r => r.week);
  const complete = rows.length > 0 && missing.length === 0;
  const n = rows.length;
  const spSum = complete ? sum(rows.map(r => r.sp)) : null;
  const allSum = complete ? sum(rows.map(r => r.all)) : null;
  const allVals = rows.map(r => r.all).filter(v => v !== null);
  return {
    weeks: weeks || [], rows, n, missing, notApproved, complete,
    spSum, allSum,
    spAvg: spSum === null ? null : spSum / n,
    allAvg: allSum === null ? null : allSum / n,
    allMin: complete ? Math.min(...allVals) : null,
    allMax: complete ? Math.max(...allVals) : null,
    differs: rows.filter(r => r.differs).map(r => r.week),
  };
}

// ── 窓の日付（週の窓をつなげる） ─────────────────────────────────────
function periodDays(ix, weeks, basis, mw) {
  const out = [];
  const weekRanges = [];
  for (const n of weeks || []) {
    const w = ix.weekByNum.get(n);
    const win = ix.windowByNum.get(n);
    let start = null, end = null, guessed = false;
    if (basis !== 'weekly_snapshots' && win?.utc_start) { start = win.utc_start; end = win.utc_end; }
    else if (basis === 'weekly_snapshots' && w) { const ww = weekWindow(ix, w); start = ww.start; end = ww.end; }
    else if (mw?.utc_start && mw.weeks?.includes(n)) {   // 窓が未登録の週（予定の月）：月の窓から7日ずつ
      const i = mw.weeks.indexOf(n);
      start = addDays(mw.utc_start, i * 7); end = addDays(start, 6); guessed = true;
    }
    weekRanges.push({ week: n, start, end, guessed });
    if (start && end) out.push(...dateRange(start, end));
  }
  return { days: out, weekRanges };
}

// 反復再生スクリーニング：日別の Spotify 再生（daily）÷ 日次オーディエンス（CSV）
export function repeatRatio(ix, days, threshold = SCREEN_THRESHOLD) {
  const rows = days.map(d => {
    const plays = num(ix.dailyByDate.get(d)?.spotify_plays);
    const audience = num(ix.csvDailyByDate.get(d)?.spotify_audience);
    const ratio = plays !== null && audience ? plays / audience : null;
    return { date: d, plays, audience, ratio, flag: ratio !== null && ratio > threshold };
  });
  const complete = rows.length > 0 && rows.every(r => r.plays !== null && r.audience !== null);
  const plays = complete ? sum(rows.map(r => r.plays)) : null;
  const audience = complete ? sum(rows.map(r => r.audience)) : null;
  const ratio = complete && audience ? plays / audience : null;
  let max = null;
  for (const r of rows) if (r.ratio !== null && (!max || r.ratio > max.ratio)) max = r;
  return {
    rows, complete, plays, audience, ratio, ratioLabel: ratio === null ? null : round(ratio, 2).toFixed(2),
    over: complete ? rows.filter(r => r.flag).length : null, of: rows.length, max, threshold,
    present: rows.filter(r => r.plays !== null && r.audience !== null).length,
  };
}

// ── p2・p3 週次（合計・週平均・前期比・感度分析・フォロワー・再生÷日次ユニーク） ─────────
export function monthWeekly(ix, key) {
  const mw = getMonth(ix, key);
  if (!mw) return null;
  const basis = weekBasis(ix, key);
  const cur = periodTotals(ix, mw.weeks, basis.basis);
  const prev = mw.prev_weeks ? periodTotals(ix, mw.prev_weeks, basis.basis) : null;
  const spPct = prev ? pctChange(cur.spAvg, prev.spAvg) : null;
  const allPct = prev ? pctChange(cur.allAvg, prev.allAvg) : null;
  const adjustments = exclusionsOf(ix, key, 'weekly', 'adjust').map(e => {
    const base = e.effect.period === 'prev' ? prev : cur;
    const adjAvg = base && base.allSum !== null ? (base.allSum - e.effect.amount) / base.n : null;
    const pct = e.effect.period === 'prev'
      ? (cur.allAvg === null || adjAvg === null ? null : pctChange(cur.allAvg, adjAvg))
      : (prev && prev.allAvg !== null && adjAvg !== null ? pctChange(adjAvg, prev.allAvg) : null);
    return { ...e, amount: e.effect.amount, period: e.effect.period, week: e.effect.week, date: e.effect.date, adjAvg, adjAvgLabel: round(adjAvg, 1), pct };
  });
  const notes = exclusionsOf(ix, key, 'weekly').filter(e => e.effect?.type !== 'adjust');
  const fStartRow = ix.weekByNum.get(mw.weeks?.[0]);
  const fEndRow = ix.weekByNum.get(mw.weeks?.at(-1));
  const fStart = num(fStartRow?.spotify_followers_start), fEnd = num(fEndRow?.spotify_followers_end);
  const followers = { start: fStart, end: fEnd, delta: fStart !== null && fEnd !== null ? fEnd - fStart : null,
    startWeek: mw.weeks?.[0], endWeek: mw.weeks?.at(-1) };
  const dCur = periodDays(ix, mw.weeks, basis.basis, mw);
  const dPrev = mw.prev_weeks ? periodDays(ix, mw.prev_weeks, basis.basis, null) : null;
  return {
    mw, basis, cur, prev, spPct, allPct, adjustments, notes, followers,
    ratioCur: repeatRatio(ix, dCur.days), ratioPrev: dPrev ? repeatRatio(ix, dPrev.days) : null,
    daysCur: dCur, daysPrev: dPrev,
  };
}

// ── p2 EP初週（Spotify・全PF統合） ───────────────────────────────────
function epFirstWeekRows(ix, eps) {
  return (eps || []).map(n => {
    const m = firstWeekFor(ix, n).spotify.main;
    return { ep: n, value: num(m?.plays_or_views), row: m || null, exact: !!(m && m.data_type === 'first_week' && m.exact_first_week === true) };
  });
}

function avgOf(rows) {
  const have = rows.filter(r => r.value !== null);
  const missing = rows.filter(r => r.value === null).map(r => r.ep);
  const all = rows.length > 0 && missing.length === 0;
  return { n: rows.length, missing, complete: all, sum: all ? sum(have.map(r => r.value)) : null, avg: all ? sum(have.map(r => r.value)) / rows.length : null };
}

export function monthFirstWeek(ix, key) {
  const mw = getMonth(ix, key);
  if (!mw) return null;
  const cur = epFirstWeekRows(ix, mw.episodes);
  const prev = mw.prev_episodes ? epFirstWeekRows(ix, mw.prev_episodes) : null;
  const a = avgOf(cur), p = prev ? avgOf(prev) : null;
  return { cur, prev, curAvg: a, prevAvg: p, pct: p && a.avg !== null && p.avg !== null ? pctChange(a.avg, p.avg) : null,
           nonExact: [...cur, ...(prev || [])].filter(r => r.row && !r.exact).map(r => r.ep) };
}

// ── p4 発見（各週取得時点の過去30日・流入経路・日次インプレッション） ─────────
const SRC_KEYS = ['home', 'search', 'library', 'other'];
function canonicalRefKey(k) {
  let s = String(k);
  s = s.replace(/^audience_platform_/, 'plat_').replace(/^aud_platform_apple_podcast_pct$/, 'plat_apple_pct').replace(/^aud_platform_/, 'plat_');
  s = s.replace(/^audience_/, 'aud_');
  s = s.replace(/^traffic_(home|search|library|other)_impressions$/, 'src_$1').replace(/^disc_route_(home|search|library|other)_impressions$/, 'src_$1');
  s = s.replace(/^discovery_impressions$/, 'disc_impressions');
  return s;
}

// report_month の monthly_reference を、月ごとの名前の違いをそろえて引く
export function monthReference(ix, reportMonth) {
  const m = mx(ix).mref.get(reportMonth);
  const out = new Map();
  if (!m) return out;
  for (const [k, r] of m) out.set(canonicalRefKey(k), { ...r, canonical: canonicalRefKey(k) });
  return out;
}

function md(iso) { return iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}` : null; }

export function monthDiscovery(ix, key) {
  const mw = getMonth(ix, key);
  if (!mw) return null;
  const basis = weekBasis(ix, key);
  const ref = mw.report_month ? monthReference(ix, mw.report_month) : new Map();
  // 各週取得時点の過去30日。「前回」＝一つ前の月次（差し替え済みの版を含む）の最後の週。無ければ前期の最後の週
  const prevReport = mx(ix).months.filter(x => x.status !== 'proposed' && x.month_key < key).at(-1) || null;
  const beforeWeek = prevReport?.weeks?.length ? prevReport.weeks.at(-1) : (mw.prev_weeks?.length ? mw.prev_weeks.at(-1) : null);
  const lastPrev = beforeWeek !== null && !(mw.weeks || []).includes(beforeWeek) ? beforeWeek : null;
  const wkList = [...(lastPrev !== null ? [lastPrev] : []), ...(mw.weeks || [])];
  // その週を最後の週とする確定月の monthly_reference に、取得時点の過去30日の期間が残っている
  const winByWeek = new Map();
  for (const other of mx(ix).months) {
    if (other.status !== 'final' || !other.report_month || !other.weeks?.length) continue;
    const r = monthReference(ix, other.report_month).get('disc_impressions');
    if (r && r.period_start && r.period_end) winByWeek.set(other.weeks.at(-1), { label: `${md(r.period_start)}–${md(r.period_end)}`, row: r, month: other.month_key });
  }
  const roll = wkList.map(n => {
    const w = ix.weekByNum.get(n);
    const win = winByWeek.get(n) || null;
    return { week: n, isPrev: n === lastPrev, impressions: num(w?.impressions), cvr: num(w?.discovery_cvr_pct), status: w?.status || null,
             window: win?.label || null, windowSource: win ? `monthly_reference ${win.row.report_month}（${win.month} 月次）の disc_impressions の期間` : null,
             refValueMatches: win ? num(win.row.metric_value_num) === num(w?.impressions) : null };
  });
  const cur = roll.filter(r => !r.isPrev);
  const last = cur.at(-1) || null;
  const before = beforeWeek !== null ? roll.find(r => r.week === beforeWeek) || null : null;
  const impRef = ref.get('disc_impressions') || null, cvrRef = ref.get('disc_cvr_pct') || null;
  const srcRows = Object.fromEntries(SRC_KEYS.map(k => [k, ref.get(`src_${k}`) || null]));
  const src = Object.fromEntries(SRC_KEYS.map(k => [k, num(srcRows[k]?.metric_value_num)]));
  const impVal = num(impRef?.metric_value_num);
  const srcAny = SRC_KEYS.some(k => src[k] !== null);
  const homeShare = src.home !== null && impVal ? round(src.home / impVal * 100, 0) : null;
  // 期間内の日次インプレッション（日次CSV）
  const { days, weekRanges } = periodDays(ix, mw.weeks, basis.basis === 'weekly_snapshots' ? 'weekly_snapshots' : 'release_influence', mw);
  const daily = days.map(d => ({ date: d, value: num(ix.csvDailyByDate.get(d)?.impressions), source: ix.csvDailyByDate.get(d)?.source?.impressions || null }));
  const present = daily.filter(r => r.value !== null).length;
  const complete = daily.length > 0 && present === daily.length;
  const top2 = complete ? [...daily].sort((a, b) => b.value - a.value || (a.date < b.date ? 1 : -1)).slice(0, 2).sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
  const pub = new Map();
  for (const n of mw.episodes || []) { const e = ix.epByNum.get(n); const d = e ? utcDate(e.published_at) : null; if (d) pub.set(d, n); }
  const perWeek = weekRanges.map(w => {
    const vals = daily.filter(r => w.start && r.date >= w.start && r.date <= w.end).map(r => r.value);
    return { week: w.week, start: w.start, end: w.end, guessed: w.guessed, sum: vals.length === 7 && vals.every(v => v !== null) ? sum(vals) : null };
  });
  return {
    mw, roll, last, before, beforeFrom: prevReport ? prevReport.month_key : null,
    lastChangePct: last && before ? pctChange(last.impressions, before.impressions) : null,
    monthly: { impressions: impVal, impRow: impRef, cvr: num(cvrRef?.metric_value_num), cvrRow: cvrRef,
               period: impRef ? { start: impRef.period_start, end: impRef.period_end, label: `${md(impRef.period_start)}–${md(impRef.period_end)}` } : null },
    src, srcRows, srcAny, homeShare,
    daily, dailyComplete: complete, dailyPresent: present, dailySum: complete ? sum(daily.map(r => r.value)) : null, top2, pub, perWeek,
    files: [...new Set(daily.map(r => r.source).filter(Boolean))],
  };
}

// ── p6 YouTube 長尺（7日値・CTR・7日インプレッション・前期平均と中央値） ─────────
function ytImpressions(ix, n) {
  const rows = mx(ix).ytImp.filter(r => r.episode_number === n && r.period_kind === 'release_week');
  rows.sort((a, b) => String(a.collected_at || '').localeCompare(String(b.collected_at || '')));
  return rows.length ? rows[rows.length - 1] : null;
}

function ytRow(ix, n) {
  const m = firstWeekFor(ix, n).youtube_long.main;
  const imp = ytImpressions(ix, n);
  return {
    ep: n, row: m || null, views: num(m?.plays_or_views), ctr: num(m?.ctr_pct), watch: num(m?.watch_hours),
    exact: !!(m && m.data_type === 'first_week' && m.exact_first_week === true),
    imp7: num(imp?.metric_value_num), impRow: imp, impNote: m?.reviewer_note || null,
  };
}

function median(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

function statsOf(rows) {
  const vals = rows.map(r => r.views).filter(v => v !== null);
  return { n: vals.length, eps: rows.filter(r => r.views !== null).map(r => r.ep), avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, median: median(vals) };
}

export function monthYouTube(ix, key) {
  const mw = getMonth(ix, key);
  if (!mw) return null;
  const cur = (mw.episodes || []).map(n => ytRow(ix, n));
  const flags = exclusionsOf(ix, key, 'youtube', 'flag_eps');
  for (const r of cur) r.flags = flags.filter(f => f.effect.eps.includes(r.ep));
  const prevAll = (mw.prev_episodes || []).map(n => ytRow(ix, n));
  const excl = exclusionsOf(ix, key, 'youtube_prev', 'exclude_eps');
  const exEps = new Set(excl.flatMap(e => e.effect.eps));
  const prevUsed = prevAll.filter(r => !exEps.has(r.ep));
  const exact = cur.filter(r => r.exact && r.views !== null);
  const maxBy = (list, k) => list.filter(r => r[k] !== null).reduce((m, r) => (!m || r[k] > m[k] ? r : m), null);
  return {
    mw, cur, prevAll, prevUsed, excluded: excl, flags,
    prevStats: statsOf(prevUsed), prevStatsAll: statsOf(prevAll),
    top: { imp: maxBy(exact, 'imp7'), ctr: maxBy(exact, 'ctr'), watch: maxBy(exact, 'watch'), views: maxBy(exact, 'views') },
    nonExact: cur.filter(r => r.row && !r.exact).map(r => r.ep),
  };
}

// ── p14 Apple（公開日から UTC 7日の日別合計・取得時点の消費率） ─────────
export function monthApple(ix, key) {
  const mw = getMonth(ix, key);
  if (!mw) return null;
  const ad = mx(ix).appleDaily;
  const rows = (mw.episodes || []).map(n => {
    const fw = ix.firstWeek.filter(r => r.episode_number === n && r.platform === 'apple' && (!r.status || r.status === 'approved'));
    const exact = fw.filter(r => r.data_type === 'first_week' && r.exact_first_week === true).at(-1) || null;
    const ref = fw.filter(r => r.data_type === 'reference').at(-1) || null;
    const main = firstWeekFor(ix, n).apple.main;
    const tot = ad.filter(r => r.episode_number === n && r.metric_key === 'ap_plays' && r.period_kind === 'release_week').at(-1) || null;
    let daily = [];
    if (tot) {
      daily = ad.filter(r => r.episode_number === n && r.metric_key === 'ap_plays_daily' && r.period_start >= tot.period_start && r.period_start <= tot.period_end)
        .map(r => ({ date: r.period_start, value: num(r.metric_value_num), note: r.note || null }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    }
    const outside = tot ? ad.filter(r => r.episode_number === n && r.metric_key === 'ap_plays_daily' && (r.period_start < tot.period_start || r.period_start > tot.period_end)).map(r => ({ date: r.period_start, value: num(r.metric_value_num) })) : [];
    const pubDay = utcDate(ix.epByNum.get(n)?.published_at);
    return {
      ep: n, exact, ref, main,
      plays: exact ? num(exact.plays_or_views) : null,
      playsAny: num(main?.plays_or_views), method: exact ? 'daily_sum' : main ? (main.data_type || 'unknown') : null,
      total: tot ? num(tot.metric_value_num) : null, totalRow: tot, daily, outside,
      dailySum: daily.length && daily.every(d => d.value !== null) ? sum(daily.map(d => d.value)) : null,
      windowOk: tot ? (tot.period_start === pubDay && dateRange(tot.period_start, tot.period_end).length === 7) : null,
      consume: num(ref?.consume_pct), refPlays: num(ref?.plays_or_views),
    };
  });
  return { mw, rows, exclusions: exclusionsOf(ix, key, 'apple'),
           allExact: rows.length > 0 && rows.every(r => r.plays !== null), noConsume: rows.filter(r => r.consume === null).map(r => r.ep) };
}

// ── p7〜p11 リテンション（Q値・型・前期平均・Now Reading 除外） ─────────
function retAvg(ix, eps) {
  const rows = (eps || []).map(n => ({ ep: n, ret: retentionFor(ix, n) }));
  const metrics = {};
  for (const k of Q_KEYS) {
    const vals = rows.map(r => num(r.ret?.[k])).filter(v => v !== null);
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    metrics[k] = { mean, avg: round(mean, 1), n: vals.length, missing: rows.length - vals.length };
  }
  return { eps: eps || [], n: rows.length, metrics };
}

export function vsStandardLabel(ret) {
  if (!ret) return null;
  const v = num(ret.vs_standard_complete_pct);
  if (v !== null) return `${v > 0 ? '+' : ''}${v}%`;
  const s = ret.vs_standard;
  if (!s) return null;
  if (s === '普通') return '「普通」';
  const m = String(s).match(/(\d+(?:\.\d+)?)%\s*(高い|低い)/);
  if (m) return `${m[2] === '高い' ? '+' : '-'}${m[1]}%`;
  return String(s);
}

export function monthRetention(ix, key) {
  const mw = getMonth(ix, key);
  if (!mw) return null;
  const rows = (mw.episodes || []).map(n => {
    const ret = retentionFor(ix, n);
    const ep = ix.epByNum.get(n);
    return { ep: n, ret, q1: num(ret?.q1), q2: num(ret?.q2), q3: num(ret?.q3), complete: num(ret?.complete),
             type: ret?.retention_type || null, duration: num(ep?.duration_seconds), medianSec: num(ret?.median_seconds), medianLabel: ret?.median_label || null,
             ts5s: cleanTs5s(ret?.ts5s), cliffs: cliffsFor(ix, n), vsStd: vsStandardLabel(ret), longForm: ep?.duration_cohort === 'long_form' };
  });
  const excl = exclusionsOf(ix, key, 'retention_prev', 'exclude_eps');
  const exEps = new Set(excl.flatMap(e => e.effect.eps));
  const cur = retAvg(ix, mw.episodes);
  const prev = mw.prev_episodes ? retAvg(ix, mw.prev_episodes) : null;
  const prevEx = mw.prev_episodes && exEps.size ? retAvg(ix, mw.prev_episodes.filter(n => !exEps.has(n))) : null;
  const base = prevEx || prev;
  const diff = base ? Object.fromEntries(Q_KEYS.map(k => [k, cur.metrics[k].avg === null || base.metrics[k].avg === null ? null : round(cur.metrics[k].avg - base.metrics[k].avg, 1)])) : null;
  const nowReading = (mw.prev_episodes || []).filter(n => /Now Reading/.test(ix.epByNum.get(n)?.genre || ''));
  return { mw, rows, cur, prev, prevEx, excluded: excl, diff, diffBase: prevEx ? 'excluded' : prev ? 'all' : null, nowReadingPrev: nowReading };
}

// ── p15 オーディエンス（カスタム期間） ───────────────────────────────
export const AUD_GROUPS = {
  gender: { label: '性別', keys: [['male', '男性'], ['female', '女性'], ['nonbinary', 'ノンバイナリー'], ['unspecified', '未指定']], prefix: 'aud_gender_' },
  age: { label: '年齢', keys: [['0_17', '-17'], ['18_22', '18-22'], ['23_27', '23-27'], ['28_34', '28-34'], ['35_44', '35-44'], ['45_59', '45-59'], ['60plus', '60+'], ['unknown', '不明']], prefix: 'aud_age_' },
  platform: { label: 'プラットフォーム', keys: [['spotify', 'Spotify'], ['apple', 'Apple'], ['overcast', 'Overcast'], ['web', 'Web'], ['other', 'その他']], prefix: 'plat_' },
  country: { label: '地域', keys: [['japan', '日本'], ['us', '米国'], ['other', 'その他']], prefix: 'aud_country_' },
};

export function monthAudience(ix, key) {
  const mw = getMonth(ix, key);
  if (!mw) return null;
  const ref = mw.report_month ? monthReference(ix, mw.report_month) : new Map();
  const groups = {};
  let any = false;
  for (const [g, def] of Object.entries(AUD_GROUPS)) {
    groups[g] = def.keys.map(([k, label]) => {
      const r = ref.get(`${def.prefix}${k}_pct`);
      if (r) any = true;
      return { key: k, label, value: num(r?.metric_value_num), row: r || null, derived: false };
    });
  }
  // 地域の「その他」が無い月は 100−日本−米国（月次スクリプトのコメントどおり）
  const c = groups.country;
  const other = c.find(x => x.key === 'other');
  const jp = c.find(x => x.key === 'japan').value, us = c.find(x => x.key === 'us').value;
  if (other.value === null && jp !== null && us !== null) { other.value = round(100 - jp - us, 1); other.derived = true; }
  const count = k => ({ value: num(ref.get(k)?.metric_value_num), row: ref.get(k) || null });
  const anyRow = [...ref.values()].find(r => /^aud_|^plat_/.test(r.canonical)) || null;
  const prevM = previousFinalMonth(ix, key);
  const prevRef = prevM?.report_month ? monthReference(ix, prevM.report_month) : new Map();
  const age = groups.age;
  const topAge = age.filter(a => a.value !== null && a.key !== 'unknown').reduce((m, a) => (!m || a.value > m.value ? a : m), null);
  const a3559 = (() => { const a = age.find(x => x.key === '35_44').value, b = age.find(x => x.key === '45_59').value; return a !== null && b !== null ? round(a + b, 1) : null; })();
  return {
    mw, any, groups, repeat: count('aud_repeat_listeners'), new: count('aud_new_listeners'), total: count('aud_total'),
    period: anyRow ? { start: anyRow.period_start, end: anyRow.period_end } : null,
    prevMonth: prevM ? { key: prevM.month_key, repeat: num(prevRef.get('aud_repeat_listeners')?.metric_value_num), new: num(prevRef.get('aud_new_listeners')?.metric_value_num),
                         period: prevRef.get('aud_new_listeners') ? { start: prevRef.get('aud_new_listeners').period_start, end: prevRef.get('aud_new_listeners').period_end } : null } : null,
    topAge, a3559,
  };
}

// ── p16 累積ランキング（2つのスナップショットの差） ─────────────────────
export function monthRanking(ix, key, platform = 'spotify') {
  const mw = getMonth(ix, key);
  if (!mw) return null;
  const snaps = mx(ix).cum.get(platform) || new Map();
  const dates = [...snaps.keys()].sort();
  const dw = (mw.data_windows || []).find(d => d.item === '累積ランキング');
  const m = dw ? String(dw.window || '').match(/(\d{4}-\d{2}-\d{2})\s*→\s*(\d{4}-\d{2}-\d{2})/) : null;
  const winStart = mw.utc_start || mw.jst_start;
  const backEps = ix.episodes.filter(e => { const d = utcDate(e.published_at); return d && winStart && d < winStart; }).map(e => e.episode_number);
  if (m) {
    const [from, to] = [m[1], m[2]];
    const s0 = snaps.get(from), s1 = snaps.get(to);
    const base = { mw, mode: 'increment', from, to, days: Math.round((Date.parse(to) - Date.parse(from)) / 86400000), source: dw.source, sourceLabel: sourceLabel(dw.source), window: dw.window, dates, backEps };
    if (!s0 || !s1) return { ...base, ok: false, reason: `${!s0 ? from : to} のスナップショット（episode_cumulative_snapshots・approved）が bundle に無い` };
    const inc = backEps.map(e => {
      const a = num(s0.get(e)?.cumulative_plays), b = num(s1.get(e)?.cumulative_plays);
      return { ep: e, from: a, to: b, delta: a !== null && b !== null ? b - a : null };
    });
    const have = inc.filter(r => r.delta !== null).sort((x, y) => y.delta - x.delta || y.ep - x.ep);
    const missing = inc.filter(r => r.delta === null).map(r => r.ep);
    const top = have.slice(0, 10), rest = have.slice(10);
    const rd = rest.map(r => r.delta);
    const cur = (mw.episodes || []).map(e => ({ ep: e, to: num(s1.get(e)?.cumulative_plays) }));
    return { ...base, ok: true, inc: have, missing, top, rest, restMin: rd.length ? Math.min(...rd) : null, restMax: rd.length ? Math.max(...rd) : null,
             restAvg: rd.length ? rd.reduce((a, b) => a + b, 0) / rd.length : null, cur,
             ratio: repeatRatio(ix, dateRange(from, addDays(to, -1))) };
  }
  // 増分の期間の記録が無い月：窓末（または翌日〜2日後）のスナップショットがあれば、その日の累計の順位
  const end = mw.utc_end || mw.jst_end;
  const near = end ? dates.filter(d => d >= end && d <= addDays(end, 2)) : [];
  const at = near.length ? near[0] : (mw.jst_end && snaps.has(mw.jst_end) ? mw.jst_end : null);
  if (!at) return { mw, mode: 'none', ok: false, dates, backEps, reason: `増分の期間の記録が無く、窓末（${end || '不明'}）近くの累計スナップショットも無い` };
  const s = snaps.get(at);
  const eps = [...s.keys()].sort((a, b) => a - b);
  const list = eps.map(e => ({ ep: e, to: num(s.get(e)?.cumulative_plays) })).filter(r => r.to !== null).sort((x, y) => y.to - x.to || y.ep - x.ep);
  return { mw, mode: 'cumulative', ok: true, at, list, top: list.slice(0, 10), rest: list.slice(10), dates, backEps };
}

// ── 月のデータのそろい具合（予定の月で「未取得」を並べる） ─────────────────
export function monthDataStatus(ix, key) {
  const mw = getMonth(ix, key);
  if (!mw) return null;
  const items = [];
  const add = (area, text, ok) => items.push({ area, text, ok });
  for (const n of mw.weeks || []) {
    const w = ix.weekByNum.get(n);
    if (!w) add('週次', `W${n}：weekly_snapshots が未登録`, false);
    else if (w.status !== 'approved') add('週次', `W${n}：承認前（${w.status}）`, false);
    else add('週次', `W${n}：確定`, true);
    if (!ix.windowByNum.get(n)) add('週次', `W${n}：week_windows（集計窓）が未登録`, false);
  }
  for (const n of mw.episodes || []) {
    const fw = firstWeekFor(ix, n);
    for (const [k, l] of [['spotify', 'Spotify初週'], ['apple', 'Apple初週'], ['youtube_long', 'YouTube長尺']]) if (!fw[k].main) add('回', `EP#${n}：${l}が未登録`, false);
    if (!retentionFor(ix, n)) add('回', `EP#${n}：リテンション（approved）が未登録`, false);
  }
  if (mw.report_month) {
    const ref = monthReference(ix, mw.report_month);
    if (!ref.size) add('月次', `monthly_reference（${mw.report_month}）が未登録`, false);
  } else add('月次', 'monthly_reference の report_month が未設定（発見・オーディエンスは未取得）', false);
  return items;
}
