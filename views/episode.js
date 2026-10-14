// #/episode/NN 回の詳細
import { h, val } from '../lib/dom.js';
import { num, jstDateTime, epLabel, shortTitle, weekOfEpisode, isLongForm, utcDate } from '../lib/metrics.js';
import { fmtInt, fmtDur, cohortJa, fmtNum, fmtYMD, fmtMinutes, MISSING } from '../lib/format.js';
import { sectionHead, firstWeekGrid, retentionBlock, cliffTable, dialogRow, insightBox, chip } from './common.js';
import { appleEntry } from './collab.js';

export function renderEpisode(root, ix, param, cx = null) {
  const n = Number(param);
  const e = ix.epByNum.get(n);
  const nums = ix.episodes.map(x => x.episode_number);
  const i = nums.indexOf(n);
  root.append(h('div', { class: 'toolbar' },
    h('a', { class: 'btn', href: '#/episodes' }, '← 回の一覧'),
    i > 0 ? h('a', { class: 'btn', href: `#/episode/${nums[i - 1]}` }, `EP#${nums[i - 1]}`) : null,
    i >= 0 && i < nums.length - 1 ? h('a', { class: 'btn', href: `#/episode/${nums[i + 1]}` }, `EP#${nums[i + 1]}`) : null));
  if (!e) { root.append(h('section', { class: 'card' }, h('p', null, `EP#${param} は episodes にありません。`))); return; }

  const pub = jstDateTime(e.published_at);
  const weeks = weekOfEpisode(ix, n);
  // この回に触れた週の文章（新しい週を優先）
  const noteWeeks = Object.keys(ix.notes).map(Number).sort((a, b) => b - a);
  const findNote = key => {
    for (const w of noteWeeks) {
      const s = ix.notes[String(w)]?.[key]?.find?.(x => num(x.episode_number) === n);
      if (s) return { w, s };
    }
    return null;
  };
  const fwNote = findNote('episode_sections');
  const retNote = findNote('retention_sections');

  root.append(h('section', { class: 'card ep-head' },
    h('p', { class: 'kicker' }, `EP#${n}`),
    h('h1', null, shortTitle(ix, n).text || `EP#${n}`),
    h('p', { class: 'full-title', src: ['出典: episodes.title', `短縮タイトル: ${shortTitle(ix, n).source}`] }, e.title || MISSING),
    h('div', { class: 'chips' },
      chip(`公開 ${pub ? `${fmtYMD(pub.date)} ${pub.time} JST` : MISSING}`),
      chip(`尺 ${fmtDur(e.duration_seconds)}`),
      chip(cohortJa(e.duration_cohort), isLongForm(ix, n) ? 'gold' : ''),
      e.has_guest ? chip('ゲスト回') : null,
      e.genre ? chip(e.genre, 'muted') : null),
    h('p', { class: 'sub' }, '週次レポート: ', weeks.length ? weeks.map((w, k) => [k ? '・' : '', h('a', { href: `#/week/${w}` }, `W${w}`)]) : 'この回を含む週がまだない')));

  root.append(h('section', { class: 'card' },
    sectionHead('初週', `${epLabel(ix, n)} の初週`, fwNote ? `文章は W${fwNote.w} の週次レポートから` : '配信日から7日間（EP基準）'),
    firstWeekGrid(ix, n, fwNote?.s),
    fwNote?.s?.footnote ? h('p', { class: 'calc-note' }, fwNote.s.footnote) : null,
    insightBox(fwNote?.s?.insight),
    cx ? appleEntry(cx, ix, n) : null));

  root.append(h('section', { class: 'card' },
    sectionHead('リテンション', `${epLabel(ix, n)} のリテンション`, retNote?.s?.subtitle || null),
    retentionBlock(ix, n, retNote?.s),
    insightBox(retNote?.s?.insight)));

  root.append(h('section', { class: 'card' },
    sectionHead('崖・対話', '崖検出と対話メトリクス', '30秒以内に5pt以上の落差を崖とする'),
    cliffTable(ix, n),
    h('div', { class: 'dialog-box' }, dialogRow(ix, n))));

  root.append(youtubeSection(ix, n));
}

function youtubeSection(ix, n) {
  const vids = ix.youtube.filter(v => v.episode_number === n);
  const last = ix.youtube.reduce((m, v) => (utcDate(v.published_at) && (!m || utcDate(v.published_at) > m) ? utcDate(v.published_at) : m), null);
  const lastEp = ix.youtube.reduce((m, v) => (num(v.episode_number) !== null && (m === null || v.episode_number > m) ? v.episode_number : m), null);
  const head = sectionHead('YouTube', 'YouTube動画（youtube_videos）',
    `動画台帳は ${last ? fmtYMD(last) : '—'} 公開分（EP#${lastEp ?? '—'}）まで。EP#${(lastEp ?? 0) + 1}以降のYouTubeは、上の「初週」の youtube 行（episode_first_week_metrics）だけ。`);
  if (!vids.length) {
    return h('section', { class: 'card' }, head, h('p', { class: 'missing-block' }, 'この回の動画は youtube_videos にありません（未取得）。'));
  }
  const src = v => [`出典: youtube_videos（video_id=${v.video_id}）`, v.title || ''];
  return h('section', { class: 'card' }, head,
    h('div', { class: 'tbl-scroll' },
      h('table', { class: 'tbl resp' },
        h('thead', null, h('tr', null, ['種類', '公開', '累計視聴', '7日視聴', '累計再生時間', 'CTR', '平均視聴', '登録者増'].map(t => h('th', null, t)))),
        h('tbody', null, vids.map(v => h('tr', null,
          h('td', { 'data-label': '種類' }, v.is_short ? 'Shorts' : '長尺'),
          h('td', { 'data-label': '公開' }, fmtYMD(utcDate(v.published_at))),
          h('td', { 'data-label': '累計視聴' }, val(fmtInt(v.views_total), src(v))),
          h('td', { 'data-label': '7日視聴' }, val(fmtInt(v.views_week1), src(v))),
          h('td', { 'data-label': '累計再生時間' }, val(num(v.watch_hours_total) === null ? MISSING : `${fmtNum(v.watch_hours_total, 1)}h`, src(v))),
          h('td', { 'data-label': 'CTR' }, val(num(v.ctr_pct) === null ? MISSING : `${fmtNum(v.ctr_pct, 1)}%`, src(v))),
          h('td', { 'data-label': '平均視聴' }, val(fmtMinutes(v.avg_view_duration_min), src(v))),
          h('td', { 'data-label': '登録者増' }, val(fmtInt(v.subscribers_gained), src(v)))))))));
}
