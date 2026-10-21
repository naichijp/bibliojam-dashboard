// Spotify と YouTube の「2トップ」・YouTube の詳細・本編への導線（2026-10-22〜）
import { h, val } from '../lib/dom.js';
import { num, pctChange, epLabel } from '../lib/metrics.js';
import { MISSING, fmtInt, fmtHours, fmtSigned, fmtNum } from '../lib/format.js';
import { Y, ytWeekDays, ytWeekSummary, ytTraffic, ytVideosInWeek, shortsFunnel, ytEpisodeVideos } from '../lib/youtube.js';
import { srcWeek, sectionHead, chip } from './common.js';

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
    h('p', { class: 'tt-note' }, 'リリース影響週（UTC 木〜水）。数値の正本（承認済み）。'));
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
function trafficList(rows, title) {
  if (!rows.length) return h('div', { class: 'yt-traffic' }, h('h4', null, title), h('p', { class: 'missing-block' }, 'この週の流入経路はまだありません'));
  return h('div', { class: 'yt-traffic' }, h('h4', null, title),
    h('ul', { class: 'bars' }, rows.slice(0, 8).map(r => h('li', null,
      h('span', { class: 'bar-k' }, r.label),
      h('span', { class: 'bar' }, h('span', { class: 'bar-fill', style: { width: `${Math.max(2, r.pct || 0)}%` } })),
      h('span', { class: 'bar-v' }, `${fmtInt(r.views)}（${fmtNum(r.pct, 1)}%）`)))));
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
    h('div', { class: 'yt-traffic-grid' }, trafficList(ytTraffic(ix, week, 'long'), '長尺の流入経路'), trafficList(ytTraffic(ix, week, 'shorts'), 'Shorts の流入経路')),
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
  const sns = (name, key) => h('section', { class: `fn-col fn-${key}` },
    h('h3', { class: 'fn-title' }, name),
    h('p', { class: 'missing-block' }, `${name} の数値はまだつないでいません（取り方を決めてから。表示回数・エンゲージメント・プロフィールやリンクへの移動・フォロワーの増減を並べる予定）`));
  return h('section', { id: 'sec-funnel', class: 'card' },
    sectionHead('本編への導線', `W${week.week_number} の入口：Shorts と SNS`, 'Shorts を先頭に、X・Instagram と並べて比べる（Shorts は SNS ではないが、本編への導線として一番重く扱う）'),
    h('div', { class: 'fn-grid' }, shortsCard, sns('X', 'x'), sns('Instagram', 'ig')));
}

// ── 回の詳細：YouTube の動画と維持率 ─────────────────────────────────
export function episodeYoutube(ix, n) {
  if (!Y(ix)) return null;
  const vids = ytEpisodeVideos(ix, n);
  if (!vids.length) return null;
  const at = (pts, x) => {
    const p = (pts || []).find(q => Math.abs(q[0] - x) < 0.0001);
    return p ? `${fmtNum(p[1] * 100, 0)}%` : MISSING;
  };
  return h('section', { class: 'card' },
    sectionHead('YouTube（API）', `${epLabel(ix, n)} の YouTube 動画`, '維持率は公開から7日（太平洋時間の暦日）の audienceWatchRatio。Shorts はループで100%を超えることがある'),
    h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl small' },
      h('thead', null, h('tr', null, h('th', null, '種類'), h('th', null, '題名'), h('th', null, '公開'), h('th', null, '25%'), h('th', null, '50%'), h('th', null, '75%'), h('th', null, '終わり'))),
      h('tbody', null, vids.map(v => h('tr', null,
        h('td', null, v.content_type === 'shorts' ? 'Shorts' : '長尺'),
        h('td', { class: 'ttl' }, cleanTitle(v)),
        h('td', null, String(v.published_at).slice(0, 10)),
        ...[0.25, 0.5, 0.75, 1].map(x => h('td', null, v.retention ? val(at(v.retention.points, x), srcYt(ix, `yt_retention_curve（${v.video_id}）`, null, `太平洋時間 ${v.retention.window_start}〜${v.retention.window_end}`)) : MISSING))))))));
}
