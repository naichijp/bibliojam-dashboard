// YouTube の詳細（2026-10-22〜。Spotify と YouTube の「2トップ」）。bundle.db.yt（migration_003）を読む純粋な関数。
// 値は YouTube 公式APIの参考値で、日付は太平洋時間の暦日。週はリリース影響週（UTC 木〜水）と同じ暦日を太平洋時間で数える
// （UTC の窓より7〜8時間あとにずれる。画面に注記する）。
import { num, dateRange, weekWindow, round } from './metrics.js';

const toObjects = (cols, rows) => (Array.isArray(rows) ? rows.map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]]))) : []);

export function ytIndex(db) {
  const y = db && db.yt;
  if (!y || !y.columns) return null;
  const c = y.columns;
  const videos = toObjects(c.videos, y.videos);
  const out = {
    videos,
    channel: toObjects(c.channel_daily, y.channel_daily),
    traffic: toObjects(c.traffic_daily, y.traffic_daily),
    videoDaily: toObjects(c.video_daily, y.video_daily),
    reach: toObjects(c.reach_daily, y.reach_daily),
    retention: toObjects(c.retention, y.retention),
    videoTraffic: toObjects(c.video_traffic || [], y.video_traffic || []),
    channelStats: toObjects(c.channel_stats || [], y.channel_stats || []),
    lastDay: y.meta?.last_day_pt || null,
    collectedAt: y.meta?.collected_at || null,
  };
  out.videoById = new Map(videos.map(v => [v.video_id, v]));
  return out;
}

// ix に索引を1回だけ作って持たせる（metrics.js の indexBundle からは呼ばない：循環 import を避ける）
export function Y(ix) {
  if (ix._yt === undefined) ix._yt = ytIndex(ix.db);
  return ix._yt;
}

// 週の太平洋時間の日（UTC の窓と同じ暦日）と、API が処理済みの日数
export function ytWeekDays(ix, week) {
  const win = weekWindow(ix, week);
  if (!win) return null;
  const days = dateRange(win.start, win.end);
  const last = Y(ix)?.lastDay;
  const done = last ? days.filter(d => d <= last) : [];
  return { start: win.start, end: win.end, days, done: done.length, complete: done.length === days.length, lastDay: last };
}

const sum = (rows, k) => rows.reduce((a, r) => a + (num(r[k]) || 0), 0);

// 週の集計（種類別）。値が1日も無ければ null
export function ytWeekSummary(ix, week) {
  const y = Y(ix);
  const wd = ytWeekDays(ix, week);
  if (!y || !wd) return null;
  const inWeek = r => r.day >= wd.start && r.day <= wd.end;
  const ch = y.channel.filter(inWeek);
  if (!ch.length) return { days: wd, empty: true };
  const by = t => ch.filter(r => r.content_type === t);
  const typeOf = id => y.videoById.get(id)?.content_type || null;
  const reach = y.reach.filter(inWeek);
  const reachBy = t => {
    const rs = reach.filter(r => typeOf(r.video_id) === t);
    const imp = sum(rs, 'impressions');
    const clicks = rs.reduce((a, r) => a + (num(r.impressions) || 0) * (num(r.ctr) || 0), 0);
    return { impressions: rs.length ? imp : null, ctr_pct: imp ? round(clicks / imp * 100, 2) : null };
  };
  const part = t => {
    const rs = by(t);
    return {
      views: sum(rs, 'views'), watch_hours: round(sum(rs, 'watch_minutes') / 60, 1), engaged_views: sum(rs, 'engaged_views'),
      ...reachBy(t),
    };
  };
  const long = part('long'), shorts = part('shorts');
  return {
    days: wd, empty: false, long, shorts,
    views: sum(ch, 'views'), watch_hours: round(sum(ch, 'watch_minutes') / 60, 1),
    subscribers_net: sum(ch, 'subscribers_gained') - sum(ch, 'subscribers_lost'),
    subscribers_gained: sum(ch, 'subscribers_gained'), subscribers_lost: sum(ch, 'subscribers_lost'),
  };
}

// 流入経路（種類別・週）。多い順
export const TRAFFIC_JA = {
  SHORTS: 'Shortsフィード', RELATED_VIDEO: '関連動画', YT_SEARCH: 'YouTube検索', SUBSCRIBER: '登録チャンネル・ホーム',
  BROWSE: 'ブラウジング', YT_CHANNEL: 'チャンネルページ', EXT_URL: '外部', NO_LINK_OTHER: '直接・不明',
  PLAYLIST: '再生リスト', YT_OTHER_PAGE: 'YouTubeのほかのページ', SHORTS_CONTENT_LINKS: 'Shortsから本編へのリンク',
  NOTIFICATION: '通知', END_SCREEN: '終了画面', ANNOTATION: 'カード', HASHTAGS: 'ハッシュタグ', SOUND_PAGE: 'サウンドのページ',
  VIDEO_REMIXES: 'リミックス', CAMPAIGN_CARD: 'キャンペーン', ADVERTISING: '広告', LIVE_REDIRECT: 'ライブの転送',
  PRODUCT_PAGE: '商品ページ', IMMERSIVE_LIVE: 'ライブ', YT_PLAYLIST_PAGE: '再生リストのページ',
};
export function ytTraffic(ix, week, type) {
  const y = Y(ix);
  const wd = ytWeekDays(ix, week);
  if (!y || !wd) return [];
  const m = new Map();
  for (const r of y.traffic) {
    if (r.content_type !== type || r.day < wd.start || r.day > wd.end) continue;
    m.set(r.source_type, (m.get(r.source_type) || 0) + (num(r.views) || 0));
  }
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ source: k, label: TRAFFIC_JA[k] || k, views: v, pct: total ? round(v / total * 100, 1) : null }));
}

// 流入経路の表示。長尺では Shorts 内の関連動画リンクを順位にかかわらず先頭に出す。
// API が対象期間を返したがこの経路が無い場合は「記録なし」（未取得とは区別）。
export function trafficDisplayRows(rows, includeShorts = false, limit = 8) {
  if (!includeShorts || !rows.length) return rows.slice(0, limit);
  const key = 'SHORTS_CONTENT_LINKS';
  const shorts = rows.find(r => r.source === key) || { source: key, label: TRAFFIC_JA[key], views: null, pct: null, notReported: true };
  return [shorts, ...rows.filter(r => r.source !== key).slice(0, limit)];
}

// 動画ごとの週の視聴（種類で絞る）。多い順
export function ytVideosInWeek(ix, week, type) {
  const y = Y(ix);
  const wd = ytWeekDays(ix, week);
  if (!y || !wd) return [];
  const m = new Map();
  for (const r of y.videoDaily) {
    if (r.day < wd.start || r.day > wd.end) continue;
    const v = y.videoById.get(r.video_id);
    if (!v || (type && v.content_type !== type)) continue;
    const a = m.get(r.video_id) || { video: v, views: 0, watch_minutes: 0, engaged_views: 0, subscribers_gained: 0 };
    a.views += num(r.views) || 0; a.watch_minutes += num(r.watch_minutes) || 0;
    a.engaged_views += num(r.engaged_views) || 0; a.subscribers_gained += num(r.subscribers_gained) || 0;
    m.set(r.video_id, a);
  }
  return [...m.values()].filter(a => a.views > 0).sort((a, b) => b.views - a.views);
}

// Shorts → 本編の導線（週）：Shorts の視聴と、本編（長尺）の流入のうち「Shorts から本編へのリンク」の視聴
export function shortsFunnel(ix, week) {
  const s = ytWeekSummary(ix, week);
  if (!s || s.empty) return null;
  const toLong = ytTraffic(ix, week, 'long').find(t => t.source === 'SHORTS_CONTENT_LINKS')?.views || 0;
  return {
    shorts_views: s.shorts.views, shorts_engaged: s.shorts.engaged_views, to_long_views: toLong,
    per_1000: s.shorts.views ? round(toLong / s.shorts.views * 1000, 1) : null, long_views: s.long.views,
  };
}

// 回の動画（長尺・Shorts）と、その維持率の曲線
export function ytEpisodeVideos(ix, n) {
  const y = Y(ix);
  if (!y) return [];
  return y.videos.filter(v => v.episode_number === n && v.privacy === 'public')
    .map(v => ({ ...v, retention: y.retention.find(r => r.video_id === v.video_id) || null }));
}

// ── 回ごとの YouTube（2026-10-22〜）────────────────────────────────────
// 太平洋時間の日付（夏時間を含めて Intl で正しく出す）
const PT_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
export function ptDate(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : PT_FMT.format(new Date(t));
}
function addDaysIso(d, n) {
  const t = Date.parse(d + 'T00:00:00Z') + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
function sumDaily(rows, from, to) {
  const rs = rows.filter(r => r.day >= from && r.day <= to);
  return { views: sum(rs, 'views'), watch_hours: round(sum(rs, 'watch_minutes') / 60, 1), engaged_views: sum(rs, 'engaged_views'),
    subscribers_gained: sum(rs, 'subscribers_gained'), days: rs.length };
}
function trafficOf(y, videoId, kind) {
  const rs = y.videoTraffic.filter(r => r.video_id === videoId && r.window_kind === kind);
  if (!rs.length) return null;
  const total = sum(rs, 'views');
  return { start: rs[0].window_start, end: rs[0].window_end, total,
    sources: rs.filter(r => num(r.views) > 0).sort((a, b) => b.views - a.views)
      .map(r => ({ source: r.source_type, label: TRAFFIC_JA[r.source_type] || r.source_type, views: num(r.views), pct: total ? round(num(r.views) / total * 100, 1) : null })) };
}
export function ytEpisodeDetail(ix, n) {
  const y = Y(ix);
  if (!y) return null;
  const vids = y.videos.filter(v => v.episode_number === n && v.privacy === 'public');
  if (!vids.length) return null;
  const one = v => {
    const start = ptDate(v.published_at), end7 = addDaysIso(start, 6);
    const daily = y.videoDaily.filter(r => r.video_id === v.video_id).sort((a, b) => (a.day < b.day ? -1 : 1));
    const reach7 = y.reach.filter(r => r.video_id === v.video_id && r.day >= start && r.day <= end7);
    const imp = sum(reach7, 'impressions');
    const clicks = reach7.reduce((a, r) => a + (num(r.impressions) || 0) * (num(r.ctr) || 0), 0);
    return {
      video: v, start, end7, complete7: !!y.lastDay && end7 <= y.lastDay, daily,
      first7: sumDaily(daily, start, end7), toDate: sumDaily(daily, start, y.lastDay || '9999-12-31'),
      impressions7: reach7.length ? imp : null, ctr7: imp ? round(clicks / imp * 100, 2) : null,
      retention: y.retention.find(r => r.video_id === v.video_id) || null,
      traffic7: trafficOf(y, v.video_id, 'first7'), trafficToDate: trafficOf(y, v.video_id, 'to_date'),
    };
  };
  const long = vids.filter(v => v.content_type === 'long').map(one);
  const shorts = vids.filter(v => v.content_type === 'shorts').map(one);
  const fromShorts = kind => {
    const ts = long.map(l => (kind === 'first7' ? l.traffic7 : l.trafficToDate)).filter(Boolean);
    if (!ts.length) return null;
    return ts.reduce((a, t) => a + (t.sources.find(s => s.source === 'SHORTS_CONTENT_LINKS')?.views || 0), 0);
  };
  return { long, shorts, lastDay: y.lastDay, shortsToLong: { first7: fromShorts('first7'), toDate: fromShorts('to_date') },
    shortsViews7: shorts.reduce((a, s) => a + s.first7.views, 0) };
}
// 維持率の曲線を 0〜100% の点に（audienceWatchRatio×100）
export function ytCurvePoints(ret) {
  return (ret?.points || []).map(p => ({ x: round(p[0] * 100, 1), y: round(p[1] * 100, 1) }));
}
export function ytCurveAt(ret, x) {
  const p = (ret?.points || []).find(q => Math.abs(q[0] - x) < 0.0001);
  return p ? round(p[1] * 100, 1) : null;
}

// ── アカウント全体（2026-10-22〜）─────────────────────────────────────
export function ytChannelLatest(ix) {
  const y = Y(ix);
  if (!y || !y.channelStats.length) return null;
  return y.channelStats[y.channelStats.length - 1];
}
// 週ごとの集計の列（weeks は weekly_snapshots の行の並び）
export function ytWeeklySeries(ix, weeks) {
  return weeks.map(w => ({ week: w.week_number, s: ytWeekSummary(ix, w) })).filter(x => x.s && !x.s.empty);
}
