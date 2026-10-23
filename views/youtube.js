// Spotify と YouTube の「2トップ」・YouTube の詳細・本編への導線（2026-10-22〜）
import { h, val } from '../lib/dom.js';
import { num, pctChange, epLabel } from '../lib/metrics.js';
import { MISSING, fmtInt, fmtHours, fmtSigned, fmtNum, fmtMinutes } from '../lib/format.js';
import { Y, ytWeekDays, ytWeekSummary, ytTraffic, ytVideosInWeek, shortsFunnel, ytEpisodeDetail, ytCurvePoints, ytCurveAt, ytChannelLatest, ytWeeklySeries, trafficDisplayRows } from '../lib/youtube.js';
import { firstWeekFor, retentionFor, cleanTs5s, youtubeApiCompare } from '../lib/metrics.js';
import { retentionCompareChart, dailyStackBars } from '../lib/charts.js';
import { srcWeek, sectionHead, chip, srcFW } from './common.js';
import { snsWeek, snsValueText } from '../lib/sns.js';

// 題名の末尾のハッシュタグ（#books など）を外す。回番号の「#41」は残す
const cleanTitle = v => String(v.title || v.video_id).replace(/(^|\s)#(?!\d)[^\s#]+/g, '').replace(/\s+/g, ' ').trim();

const API_NOTE = 'YouTube 公式API（Analytics・Reporting）の参考値。日付は太平洋時間の暦日で、週はリリース影響週と同じ暦日（UTC の窓より7〜8時間あと）';

function srcYt(ix, table, wd, extra) {
  const y = Y(ix);
  return [
    `出典: ${table}（${API_NOTE}）`,
    wd ? `期間: 太平洋時間 ${wd.start}〜${wd.end}（処理済み ${wd.done}/${wd.days.length}日。API の最終処理日 ${wd.lastDay || '不明'}）` : '',
    y?.collectedAt ? `取得: ${y.collectedAt}` : '',
    extra,
  ];
}

function cmpText(cur, prev, fmt = fmtInt, unit = '') {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
  const c = pctChange(cur, prev);
  return c === null ? `前週${fmt(prev)}${unit}` : `前週${fmt(prev)}${unit}から${fmtSigned(c, '%')}`;
}

function kvRow(label, value, sub) {
  return h('div', { class: 'tt-row' }, h('span', { class: 'tt-k' }, label), h('span', { class: 'tt-v' }, value), sub ? h('span', { class: 'tt-s' }, sub) : null);
}

function coverageChip(wd) {
  if (!wd) return null;
  return wd.complete ? chip(`7日分そろい（太平洋時間 ${wd.start}〜${wd.end}）`, '')
    : chip(`途中：${wd.done}/${wd.days.length}日（API は太平洋時間 ${wd.lastDay || '?'} まで処理済み）`, 'warn');
}

// ── 2トップ：週の全体を Spotify と YouTube で並べる ─────────────────────
export function twoTop(ctx) {
  const { ix, week, prev } = ctx;
  const s = ytWeekSummary(ix, week);
  const p = prev ? ytWeekSummary(ix, prev) : null;
  const pOk = p && !p.empty && p.days.complete;
  const sp = h('section', { class: 'tt-col tt-spotify' },
    h('h3', { class: 'tt-title' }, 'Spotify'),
    kvRow('Spotify 再生', val(fmtInt(week.spotify_plays), srcWeek(ix, week, 'spotify_plays')), prev ? cmpText(num(week.spotify_plays), num(prev.spotify_plays)) : null),
    kvRow('全プラットフォーム', val(fmtInt(week.all_platforms_streams), srcWeek(ix, week, 'all_platforms_streams')), prev ? cmpText(num(week.all_platforms_streams), num(prev.all_platforms_streams)) : null),
    kvRow('視聴時間', val(fmtHours(week.spotify_listening_hours), srcWeek(ix, week, 'spotify_listening_hours')), prev ? cmpText(num(week.spotify_listening_hours), num(prev.spotify_listening_hours), v => fmtNum(v, 1), 'h') : null),
    kvRow('フォロワー増減', val(num(week.spotify_followers_delta) === null ? MISSING : fmtSigned(week.spotify_followers_delta, '', 0), srcWeek(ix, week, 'spotify_followers_delta')),
      num(week.spotify_followers_end) !== null ? `計${fmtInt(week.spotify_followers_end)}人` : null),
    h('p', { class: 'tt-note' }, `リリース影響週（UTC 木〜水）。数値の正本（${week.status === 'approved' ? '承認済み' : '暫定・未承認'}）。`));
  let yt;
  if (!Y(ix)) {
    yt = h('section', { class: 'tt-col tt-youtube' }, h('h3', { class: 'tt-title' }, 'YouTube'),
      h('p', { class: 'missing-block' }, 'YouTube の詳細データがまだありません（migration_003 の適用と初回の取り込み待ち）'));
  } else if (!s || s.empty) {
    yt = h('section', { class: 'tt-col tt-youtube' }, h('h3', { class: 'tt-title' }, 'YouTube'),
      h('p', { class: 'missing-block' }, `この週の YouTube の日次はまだありません（API は太平洋時間 ${Y(ix).lastDay || '?'} まで）`));
  } else {
    const wd = s.days;
    yt = h('section', { class: 'tt-col tt-youtube' },
      h('h3', { class: 'tt-title' }, 'YouTube', ' ', coverageChip(wd)),
      kvRow('長尺の視聴', val(fmtInt(s.long.views), srcYt(ix, 'yt_channel_daily（種類=long）', wd)), pOk ? cmpText(s.long.views, p.long.views) : null),
      kvRow('Shorts の視聴', val(fmtInt(s.shorts.views), srcYt(ix, 'yt_channel_daily（種類=shorts）', wd)), pOk ? cmpText(s.shorts.views, p.shorts.views) : null),
      kvRow('総再生時間', val(`${fmtNum(s.watch_hours, 1)}h`, srcYt(ix, 'yt_channel_daily', wd, '長尺・Shorts・その他の合計')),
        pOk ? cmpText(s.watch_hours, p.watch_hours, v => fmtNum(v, 1), 'h') : null),
      kvRow('登録者の増減', val(fmtSigned(s.subscribers_net, '', 0), srcYt(ix, 'yt_channel_daily', wd, `増 ${s.subscribers_gained}・減 ${s.subscribers_lost}`)), null),
      kvRow('長尺の表示回数', val(s.long.impressions === null ? MISSING : fmtInt(s.long.impressions), srcYt(ix, 'yt_reach_daily（回に結び付いた長尺）', wd)),
        s.long.ctr_pct !== null ? `CTR ${fmtNum(s.long.ctr_pct, 1)}%` : null),
      h('p', { class: 'tt-note' }, 'API の参考値（太平洋時間の暦日）。回ごとの初週の正本は Studio の値。'));
  }
  return h('section', { id: 'sec-twotop', class: 'card' },
    sectionHead('Spotify × YouTube', `W${week.week_number} の全体を2つ並べて見る`, 'Spotify と YouTube を同じ重さで見る（2026-10-22〜）。YouTube の前週比は、前週の7日分がそろっているときだけ出す'),
    h('div', { class: 'tt-grid' }, sp, yt));
}

// ── YouTube の詳細 ──────────────────────────────────────────────────
function trafficList(rows, title, includeShorts = false) {
  if (!rows.length) return h('div', { class: 'yt-traffic' }, h('h4', null, title), h('p', { class: 'missing-block' }, 'この週の流入経路はまだありません'));
  return h('div', { class: 'yt-traffic' }, h('h4', null, title),
    h('ul', { class: 'bars' }, trafficDisplayRows(rows, includeShorts).map(r => h('li', { class: r.source === 'SHORTS_CONTENT_LINKS' ? 'hl' : '' },
      h('span', { class: 'bar-k' }, r.label),
      h('span', { class: 'bar' }, h('span', { class: 'bar-fill', style: { width: `${Math.max(2, r.pct || 0)}%` } })),
      h('span', { class: 'bar-v' }, r.notReported ? '記録なし（API）' : `${fmtInt(r.views)}回（${fmtNum(r.pct, 1)}%）`)))));
}

export function ytDetail(ctx) {
  const { ix, week, prev } = ctx;
  if (!Y(ix)) return null;
  const s = ytWeekSummary(ix, week);
  if (!s || s.empty) return null;
  const p = prev ? ytWeekSummary(ix, prev) : null;
  const pOk = p && !p.empty;
  const wd = s.days;
  const cell = (v, fmt = fmtInt) => (v === null || v === undefined ? MISSING : fmt(v));
  const row = (label, f, fmt) => h('tr', null, h('th', null, label),
    h('td', null, val(cell(f(s.long), fmt), srcYt(ix, 'yt_channel_daily・yt_reach_daily', wd))),
    h('td', null, val(cell(f(s.shorts), fmt), srcYt(ix, 'yt_channel_daily・yt_reach_daily', wd))),
    h('td', { class: 'muted' }, pOk ? `${cell(f(p.long), fmt)} ／ ${cell(f(p.shorts), fmt)}` : '—'));
  const table = h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, h('th', null, ''), h('th', null, '長尺'), h('th', null, 'Shorts'), h('th', null, `前週（長尺／Shorts）${pOk && !p.days.complete ? '・途中' : ''}`))),
    h('tbody', null,
      row('視聴回数', x => x.views),
      row('総再生時間', x => x.watch_hours, v => `${fmtNum(v, 1)}h`),
      row('エンゲージビュー', x => x.engaged_views),
      row('表示回数', x => x.impressions),
      row('CTR', x => x.ctr_pct, v => `${fmtNum(v, 1)}%`)));
  const top = ytVideosInWeek(ix, week, 'long').slice(0, 6);
  const topList = top.length ? h('table', { class: 'tbl small' },
    h('thead', null, h('tr', null, h('th', null, '長尺'), h('th', null, '回'), h('th', null, '視聴'), h('th', null, '総再生時間'))),
    h('tbody', null, top.map(a => h('tr', null,
      h('td', { class: 'ttl' }, cleanTitle(a.video)),
      h('td', null, a.video.episode_number ? `EP#${a.video.episode_number}` : '—'),
      h('td', null, val(fmtInt(a.views), srcYt(ix, `yt_video_daily（${a.video.video_id}）`, wd))),
      h('td', null, `${fmtNum(a.watch_minutes / 60, 1)}h`))))) : h('p', { class: 'missing-block' }, '動画ごとの日次がまだありません');
  return h('section', { id: 'sec-ytdetail', class: 'card' },
    sectionHead('YouTube の詳細', `W${week.week_number} の YouTube（長尺と Shorts）`, `太平洋時間 ${wd.start}〜${wd.end}・API の参考値`),
    h('div', { class: 'chips' }, coverageChip(wd)),
    h('div', { class: 'tbl-scroll' }, table),
    h('p', { class: 'calc-note' }, '表示回数・CTR は Reporting API の日次（回に結び付いた動画の合計。CTR は表示回数で重み付け）。Shorts の表示回数は Shorts フィードの表示を含まないことがある。'),
    h('div', { class: 'yt-traffic-grid' }, trafficList(ytTraffic(ix, week, 'long'), '長尺の流入経路', true), trafficList(ytTraffic(ix, week, 'shorts'), 'Shorts の流入経路')),
    h('h3', { class: 'h3' }, 'この週によく見られた長尺'),
    h('div', { class: 'tbl-scroll' }, topList));
}

// ── 本編への導線（YouTube Shorts を先頭に、SNS と並べる） ─────────────────
export function funnel(ctx) {
  const { ix, week } = ctx;
  const f = Y(ix) ? shortsFunnel(ix, week) : null;
  const wd = Y(ix) ? ytWeekDays(ix, week) : null;
  const shorts = f ? ytVideosInWeek(ix, week, 'shorts') : [];
  const shortsCard = h('section', { class: 'fn-col fn-shorts' },
    h('h3', { class: 'fn-title' }, 'YouTube Shorts', ' ', chip('本編への導線の主役', '')),
    f ? [
      kvRow('Shorts の視聴', val(fmtInt(f.shorts_views), srcYt(ix, 'yt_channel_daily（種類=shorts）', wd))),
      kvRow('エンゲージビュー', val(fmtInt(f.shorts_engaged), srcYt(ix, 'yt_channel_daily（種類=shorts）', wd))),
      kvRow('Shorts → 本編', val(`${fmtInt(f.to_long_views)}回`, srcYt(ix, 'yt_traffic_daily（長尺・SHORTS_CONTENT_LINKS）', wd, '本編（長尺）の視聴のうち、流入経路が「Shorts から本編へのリンク」のもの')),
        f.per_1000 !== null ? `Shorts 1000回あたり ${fmtNum(f.per_1000, 1)}回` : null),
      shorts.length ? h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl small' },
        h('thead', null, h('tr', null, h('th', null, 'Shorts'), h('th', null, '回'), h('th', null, '視聴'), h('th', null, 'エンゲージ'))),
        h('tbody', null, shorts.slice(0, 10).map(a => h('tr', null,
          h('td', { class: 'ttl' }, cleanTitle(a.video)),
          h('td', null, a.video.episode_number ? `EP#${a.video.episode_number}` : '—'),
          h('td', null, val(fmtInt(a.views), srcYt(ix, `yt_video_daily（${a.video.video_id}）`, wd))),
          h('td', null, fmtInt(a.engaged_views))))))) : null,
    ] : h('p', { class: 'missing-block' }, 'YouTube の詳細データがまだありません'));
  const SNS_HOW = {
    instagram: 'Instagram 公式API（Insights）。週は UTC の日（リリース影響週と同じ）。自動の画面読み取りは規約で禁止のため使わない',
    x: '月曜の確定セッションで Claude がアナリティクス画面から読んだ値（2026-10-22 内藤さん決定。X の規約の懸念は承知のうえ）。画面の日付は JST',
  };
  const sns = (name, key, platform) => {
    const w = snsWeek(ix, week.week_number, platform);
    let body;
    if (!w) body = h('p', { class: 'missing-block' }, `${name} の数字はまだ入っていません（migration_004 の適用と最初の取得待ち）`);
    else if (w.empty) body = h('p', { class: 'missing-block later' }, platform === 'x'
      ? 'この週の X はまだ読んでいません（月曜の確定セッションで読む）'
      : 'この週の Instagram はまだ取っていません（月曜の確定セッションで API から取る）');
    else body = [
      ...w.rows.map(r => kvRow(r.label, val(snsValueText(r.row), [`出典: sns_weekly_metrics（${platform}・${r.key}）`, SNS_HOW[platform],
        `期間: ${r.row.period_start}〜${r.row.period_end}（${r.row.timezone}）`, `取得: ${r.row.collected_at}`, r.row.note || '']))),
      w.others.length ? h('p', { class: 'kv-others' }, 'そのほか: ', w.others.map(o => `${o.metric_key} ${snsValueText(o)}`).join('・')) : null,
      h('p', { class: 'tt-note' }, platform === 'x' ? '画面から読んだ値（参考）。' : 'API の値。100人未満では出ない指標がある。'),
    ];
    return h('section', { class: `fn-col fn-${key}` }, h('h3', { class: 'fn-title' }, name), body);
  };
  return h('section', { id: 'sec-funnel', class: 'card' },
    sectionHead('本編への導線', `W${week.week_number} の入口：Shorts と SNS`, 'Shorts を先頭に、X・Instagram と並べて比べる（Shorts は SNS ではないが、本編への導線として一番重く扱う）'),
    h('div', { class: 'fn-grid' }, shortsCard, sns('X', 'x', 'x'), sns('Instagram', 'ig', 'instagram')));
}

// ── 回の詳細：Spotify と YouTube を並べる（2026-10-22〜）─────────────────────
const pctTxt = v => (v === null || v === undefined ? MISSING : `${fmtNum(v, 0)}%`);
export function episodeCompare(ix, n) {
  const d = ytEpisodeDetail(ix, n);
  const fw = firstWeekFor(ix, n, { includeProvisional: true });
  const ret = retentionFor(ix, n, { includeProvisional: true });
  const ep = ix.epByNum.get(n);
  const sp = fw.spotify.main, yts = fw.youtube_long.main;
  const L = d?.long?.[0] || null;
  const dur = num(ep?.duration_seconds);
  const sTs = cleanTs5s(ret?.ts5s);
  const spCurve = dur && sTs.length ? sTs.map(([x, y]) => ({ x: Math.min(100, Math.round(x / dur * 1000) / 10), y })) : [];
  const ytCurve = L ? ytCurvePoints(L.retention) : [];
  const shCurve = d?.shorts?.[0] ? ytCurvePoints(d.shorts[0].retention) : [];
  const r = (label, a, b, note) => h('tr', null, h('th', null, label), h('td', null, a), h('td', null, b), h('td', { class: 'small muted' }, note || ''));
  const apiNote = L && !L.complete7 ? `API は太平洋時間 ${d.lastDay} まで（7日に届いていない）` : 'API は太平洋時間の暦日7日（約160時間）';
  const table = h('table', { class: 'tbl cmp' },
    h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Spotify'), h('th', null, 'YouTube 長尺'), h('th', null, ''))),
    h('tbody', null,
      r('初週の再生・視聴', val(sp ? fmtInt(sp.plays_or_views) : MISSING, sp ? srcFW(sp, 'plays_or_views') : []),
        val(yts ? `${fmtInt(yts.plays_or_views)}回` : L ? `${fmtInt(L.first7.views)}回（API）` : MISSING, yts ? srcFW(yts, 'plays_or_views') : []),
        'Spotify は全PF統合の「再生数とダウンロード数」。YouTube は Studio の7日（無ければ API）'),
      r('初週の視聴時間', val(sp ? fmtHours(sp.watch_hours) : MISSING, sp ? srcFW(sp, 'watch_hours') : []),
        val(yts && num(yts.watch_hours) !== null ? `${fmtNum(yts.watch_hours, 1)}h` : L ? `${fmtNum(L.first7.watch_hours, 1)}h（API）` : MISSING, yts ? srcFW(yts, 'watch_hours') : [])),
      r('平均視聴時間', val(sp ? fmtMinutes(sp.avg_view_min) : MISSING, sp ? srcFW(sp, 'avg_view_min') : []),
        (() => { const c = youtubeApiCompare(fw.youtube_long); const a = c ? num(c.api.avg_view_min) : null;
          return val(a !== null ? `${fmtMinutes(a)}（API）` : MISSING, a !== null ? srcFW(c.api, 'avg_view_min', 'YouTube API の7日の averageViewDuration（参考値）') : ['Studio は7日ちょうどの平均視聴時間が出ない。API の参考値は月曜の確定セッションで取る']); })()),
      r('50%地点に残る割合', val(pctTxt(num(ret?.q2)), ['Spotify：Q2（尺の50%）']), val(pctTxt(L ? ytCurveAt(L.retention, 0.5) : null), ['YouTube：audienceWatchRatio（尺の50%）'])),
      r('最後まで残る割合', val(pctTxt(num(ret?.complete)), ['Spotify：Complete']), val(pctTxt(L ? ytCurveAt(L.retention, 1) : null), ['YouTube：audienceWatchRatio（尺の100%）']),
        '同じ「割合」でも数え方が違う（Spotify は聴いた人、YouTube は視聴回数あたり）ので目安'),
      r('表示回数・CTR（7日）', '—', val(L && L.impressions7 !== null ? `${fmtInt(L.impressions7)}回・${fmtNum(L.ctr7, 1)}%` : MISSING, ['Reporting API の日次の和（CTR は表示回数で重み付け）'])),
      r('Shorts からの流入', '—', val(d?.shortsToLong?.first7 !== null && d?.shortsToLong?.first7 !== undefined ? `7日 ${fmtInt(d.shortsToLong.first7)}回` : d?.shortsToLong?.toDate !== null && d?.shortsToLong?.toDate !== undefined ? `公開から ${fmtInt(d.shortsToLong.toDate)}回` : MISSING,
        ['本編（長尺）の視聴のうち、流入経路が「Shorts から本編へのリンク」のもの（API）']),
        d?.shortsToLong?.toDate !== null && d?.shortsToLong?.toDate !== undefined ? `公開から ${fmtInt(d.shortsToLong.toDate)}回（太平洋時間 ${d.lastDay} まで）` : '')));
  const box = h('div', { class: 'chart-box chart-ret' });
  const canvas = h('canvas', { role: 'img', 'aria-label': `EP#${n} の Spotify と YouTube のリテンション` });
  box.append(canvas);
  if (spCurve.length || ytCurve.length) queueMicrotask(() => retentionCompareChart(canvas, { spotify: spCurve, youtube: ytCurve, shorts: shCurve }));
  else box.replaceChildren(h('p', { class: 'missing-block' }, 'リテンションの曲線がまだありません（Spotify の ts5s・YouTube の API の曲線のどちらも無い）'));
  return h('section', { class: 'card' },
    sectionHead('Spotify × YouTube', `${epLabel(ix, n)} を2つ並べて見る`, apiNote),
    (ret?.status === 'provisional' || sp?.status === 'provisional' || yts?.status === 'provisional') ? h('p', { class: 'pf-caution' }, '暫定・未承認の取得値を含みます。7日未満の回は速報です。') : null,
    h('div', { class: 'tbl-scroll' }, table),
    h('h3', { class: 'h3' }, 'リテンションの重ね合わせ（横軸は尺に対する位置）'),
    box,
    h('p', { class: 'calc-note' }, 'Spotify は ts5s（聴いた人のうち、その位置まで聴いていた割合）。YouTube は audienceWatchRatio（視聴回数あたり、その位置が見られた割合。巻き戻し・ループで100%を超えることがある）。数え方が違うので、形（どこで下がるか）を比べる。'));
}

// ── 回の詳細：YouTube の動画ごと（日別・流入経路・Shorts） ─────────────────
function trafficBars(t, title) {
  if (!t) return h('div', { class: 'yt-traffic' }, h('h4', null, title), h('p', { class: 'missing-block' }, 'まだありません'));
  return h('div', { class: 'yt-traffic' }, h('h4', null, `${title}（太平洋時間 ${t.start}〜${t.end}・計${fmtInt(t.total)}回）`),
    h('ul', { class: 'bars' }, trafficDisplayRows(t.sources, true).map(r => h('li', { class: r.source === 'SHORTS_CONTENT_LINKS' ? 'hl' : '' },
      h('span', { class: 'bar-k' }, r.label),
      h('span', { class: 'bar' }, h('span', { class: 'bar-fill', style: { width: `${Math.max(2, r.pct || 0)}%` } })),
      h('span', { class: 'bar-v' }, r.notReported ? '記録なし（API）' : `${fmtInt(r.views)}回（${fmtNum(r.pct, 1)}%）`)))));
}
export function episodeYoutube(ix, n) {
  const d = ytEpisodeDetail(ix, n);
  if (!d) return null;
  const all = [...d.long, ...d.shorts];
  const start = all.map(x => x.start).sort()[0];
  const days = [];
  for (let i = 0; i < 28; i++) { const t = Date.parse(start + 'T00:00:00Z') + i * 86400000; const k = new Date(t).toISOString().slice(0, 10); if (d.lastDay && k > d.lastDay) break; days.push(k); }
  const series = [
    { label: '長尺', color: '#C0392B', data: days.map(k => d.long.reduce((a, l) => a + (num(l.daily.find(r => r.day === k)?.views) || 0), 0)) },
    { label: 'Shorts', color: '#6A3FA0', data: days.map(k => d.shorts.reduce((a, l) => a + (num(l.daily.find(r => r.day === k)?.views) || 0), 0)) },
  ];
  const box = h('div', { class: 'chart-box' });
  const canvas = h('canvas', { role: 'img', 'aria-label': `EP#${n} の YouTube の日別視聴` });
  box.append(canvas);
  if (days.length) queueMicrotask(() => dailyStackBars(canvas, { labels: days.map(k => k.slice(5).replace('-', '/')), series, yLabel: '視聴回数' }));
  const L = d.long[0];
  const vrow = x => h('tr', null,
    h('td', null, x.video.content_type === 'shorts' ? 'Shorts' : '長尺'),
    h('td', { class: 'ttl' }, cleanTitle(x.video)),
    h('td', null, x.start),
    h('td', null, x.complete7 ? fmtInt(x.first7.views) : `${fmtInt(x.first7.views)}（途中）`),
    h('td', null, fmtInt(x.toDate.views)),
    h('td', null, `${fmtNum(x.toDate.watch_hours, 1)}h`),
    h('td', null, fmtInt(x.toDate.engaged_views)),
    h('td', null, fmtInt(x.toDate.subscribers_gained)),
    h('td', null, pctTxt(ytCurveAt(x.retention, 0.5))),
    h('td', null, pctTxt(ytCurveAt(x.retention, 1))));
  return h('section', { class: 'card' },
    sectionHead('YouTube の詳細', `${epLabel(ix, n)} の YouTube`, `API の参考値（太平洋時間の日）。最終処理日 ${d.lastDay || '不明'}`),
    h('h3', { class: 'h3' }, '公開からの日別視聴（最大28日）'), box,
    h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl small' },
      h('thead', null, h('tr', null, ['種類', '題名', '公開（PT）', '7日の視聴', '公開からの視聴', '総再生時間', 'エンゲージ', '登録者の増', '50%地点', '終わり'].map(t => h('th', null, t)))),
      h('tbody', null, all.map(vrow)))),
    h('p', { class: 'calc-note' }, '50%地点・終わりは公開から7日の audienceWatchRatio（Shorts はループで100%を超える）。'),
    L ? h('div', { class: 'yt-traffic-grid' }, trafficBars(L.traffic7, '長尺の流入経路・7日'), trafficBars(L.trafficToDate, '長尺の流入経路・公開から')) : null,
    h('p', { class: 'calc-note' }, `色付きの「Shortsから本編へのリンク」は、Shorts 内の関連動画リンクからこの本編への直接流入。APIに該当経路が無い期間は「記録なし」と表示（Shortsフィードの視聴とは別）。Shorts の7日の視聴 ${fmtInt(d.shortsViews7)}回に対して、本編への流入は7日 ${d.shortsToLong.first7 ?? '—'}回・公開から ${d.shortsToLong.toDate ?? '—'}回。`));
}

// ── 推移：YouTube のアカウント全体（2026-10-22〜）──────────────────────
export function ytAccountCard(ix) {
  if (!Y(ix)) return null;
  const latest = ytChannelLatest(ix);
  const weeks = ix.weeks.slice(-12);
  const ser = ytWeeklySeries(ix, weeks);
  const box = h('div', { class: 'chart-box' });
  const canvas = h('canvas', { role: 'img', 'aria-label': 'YouTube の週ごとの視聴（長尺・Shorts）' });
  box.append(canvas);
  if (ser.length) queueMicrotask(() => dailyStackBars(canvas, {
    labels: ser.map(x => `W${x.week}${x.s.days.complete ? '' : '（途中）'}`),
    series: [{ label: '長尺', color: '#C0392B', data: ser.map(x => x.s.long.views) }, { label: 'Shorts', color: '#6A3FA0', data: ser.map(x => x.s.shorts.views) }],
    yLabel: '視聴回数' }));
  const tbl = h('table', { class: 'tbl small' },
    h('thead', null, h('tr', null, ['週', '長尺の視聴', 'Shortsの視聴', '総再生時間', '登録者の増減', '長尺の表示', 'CTR', 'Shorts→本編'].map(t => h('th', null, t)))),
    h('tbody', null, ser.slice().reverse().map(({ week, s }) => {
      // 流入経路・表示回数は取り始めより前の週を「—」にする（0 と区別する）
      const tStart = Y(ix).traffic.reduce((m, r) => (!m || r.day < m ? r.day : m), null);
      const rStart = Y(ix).reach.reduce((m, r) => (!m || r.day < m ? r.day : m), null);
      const toLong = tStart && s.days.start >= tStart ? fmtInt(ytTraffic(ix, ix.weekByNum.get(week), 'long').find(t => t.source === 'SHORTS_CONTENT_LINKS')?.views || 0) : '—';
      const noReach = !rStart || s.days.start < rStart;
      return h('tr', null,
        h('td', null, `W${week}${s.days.complete ? '' : `（${s.days.done}/7日）`}`),
        h('td', null, fmtInt(s.long.views)), h('td', null, fmtInt(s.shorts.views)), h('td', null, `${fmtNum(s.watch_hours, 1)}h`),
        h('td', null, fmtSigned(s.subscribers_net, '', 0)),
        h('td', null, noReach || s.long.impressions === null ? '—' : fmtInt(s.long.impressions)),
        h('td', null, noReach || s.long.ctr_pct === null ? '—' : `${fmtNum(s.long.ctr_pct, 1)}%`),
        h('td', null, toLong));
    })));
  return h('section', { class: 'card' },
    sectionHead('YouTube アカウント全体', 'チャンネルの登録者と週ごとの視聴', 'API の参考値（太平洋時間の日）。週はリリース影響週と同じ暦日'),
    h('div', { class: 'tiles' },
      h('div', { class: 'tile', style: { '--tc': '#C0392B' } }, h('div', { class: 'tile-v' }, latest?.subscriber_count === null || !latest ? MISSING : fmtInt(latest.subscriber_count)), h('div', { class: 'tile-u' }, '登録者'), h('div', { class: 'tile-d' }, latest ? `${latest.captured_on} 時点（YouTube 側で丸めた値）` : '未取得')),
      h('div', { class: 'tile', style: { '--tc': '#C0392B' } }, h('div', { class: 'tile-v' }, latest ? fmtInt(latest.view_count) : MISSING), h('div', { class: 'tile-u' }, '総視聴回数'), h('div', { class: 'tile-d' }, 'チャンネル開設から')),
      h('div', { class: 'tile', style: { '--tc': '#6A3FA0' } }, h('div', { class: 'tile-v' }, latest ? fmtInt(latest.video_count) : MISSING), h('div', { class: 'tile-u' }, '公開動画'), h('div', { class: 'tile-d' }, '長尺と Shorts の合計'))),
    h('h3', { class: 'h3' }, '週ごとの視聴（直近12週）'), box,
    h('div', { class: 'tbl-scroll' }, tbl),
    h('p', { class: 'calc-note' }, '登録者の増減は YouTube Analytics の日次（増−減）の週の合計。登録者数の現在値は Data API（取った日ごとに残す）。表示回数・CTR は回に結び付いた長尺の合計。「—」は取り始めより前の週（流入経路は 9/1、表示回数は 9/14 から）。'));
}
