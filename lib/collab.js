// 書き込み機能（コメント・Appleの手入力・文章の編集と承認）のロジック。DOMに依存しない。
// RPCは注入したクライアントの rpc(name, args) で呼ぶ（supabase-js の client、または手元の ?mode=mock の擬似RPC）。
// 戻りは supabase-js と同じ { data, error }。error は PostgREST の { code, message, details, hint }。
// 引数・戻り・エラーの正本：CONTRACT.md 5節「RPC」、docs/APPLY_CHECKLIST_migration_001.md 付録A・B、
// sql/migration_001_dashboard.sql の public.dashboard_* 関数。
import { num, addDays, utcDate, dateRange } from './metrics.js';

// ── 権限 ─────────────────────────────────────────────────────────────
export const ROLES = ['viewer', 'editor', 'owner'];
export const ROLE_JA = { viewer: '閲覧', editor: '編集', owner: 'オーナー' };

export function roleAtLeast(role, min) {
  const a = ROLES.indexOf(role), b = ROLES.indexOf(min);
  return a >= 0 && b >= 0 && a >= b;
}

export function roleLabel(role) {
  return ROLE_JA[role] ? `${ROLE_JA[role]}（${role}）` : (role || '不明');
}

// 画面で使うのは「ログインした公開版」（remote）と、手元の擬似RPC（mock）だけ。ローカル表示は読むだけ。
export const LOCAL_ONLY = 'ログインした公開版で使えます';

export function collabContext(bundle, meta) {
  const mode = meta?.mode || 'local';
  const writable = (mode === 'remote' || mode === 'mock') && !!bundle?.viewer;
  const viewer = bundle?.viewer || null;
  return { mode, writable, viewer, role: writable ? (viewer?.role || null) : null };
}

// 週ごとにできること。理由（reasons）は押せないときに画面へ出す文。
export function capabilities(ctx, { weekRow = null, notesMeta = null } = {}) {
  const off = { canComment: false, canEditNotes: false, canApprove: false, canSubmitApple: false,
    showApple: !ctx?.writable, showApprove: false,
    reasons: { comment: LOCAL_ONLY, edit: LOCAL_ONLY, approve: LOCAL_ONLY, apple: LOCAL_ONLY } };
  if (!ctx || !ctx.writable) return off;
  const role = ctx.role;
  const isMember = ROLES.includes(role);
  const editor = roleAtLeast(role, 'editor');
  const owner = role === 'owner';
  const approved = notesMeta?.status === 'approved';
  const reasons = { comment: null, edit: null, approve: null, apple: null };
  if (!isMember) reasons.comment = 'メンバーの権限が確認できません。ログインし直してください。';
  if (!editor) reasons.edit = '文章の編集は「編集（editor）」以上の権限が必要です。';
  else if (approved && !owner) reasons.edit = '承認済みの週は、オーナー（owner）だけが直せます。';
  if (!owner) reasons.approve = '承認はオーナー（owner）だけができます。';
  else if (!notesMeta) reasons.approve = 'この週の文章はまだ保存されていません。先に保存してください。';
  else if (approved) reasons.approve = 'この週の文章は承認済みです。';
  else if (weekRow && weekRow.status !== 'approved') reasons.approve = `この週の数値（weekly_snapshots）がまだ確定（approved）していません（いま: ${weekRow.status || '状態未記録'}）。数値の承認が先です。`;
  if (!editor) reasons.apple = 'Appleの入力は「編集（editor）」以上の権限が必要です。';
  return {
    canComment: !reasons.comment,
    canEditNotes: !reasons.edit,
    canApprove: !reasons.approve,
    canSubmitApple: !reasons.apple,
    showApple: editor,          // editor 以上だけにフォームを出す（viewer には出さない）
    showApprove: owner,
    reasons,
  };
}

// ── コメントの欄（section_key） ──────────────────────────────────────
// DB の制約：^[a-z0-9][a-z0-9_.:-]{0,63}$（private.report_comments.section_key）。
// 週次画面の節と1対1。回ごとの節（初週・リテンション）は「<種類>:<回番号>」。
export const SECTION_KEY_RE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
export const SECTION = Object.freeze({
  SUMMARY: 'summary',          // エグゼクティブサマリー
  KPI: 'kpi',                  // 全体KPI
  FIRST_WEEK: 'first_week',    // 各回の初週 → first_week:38
  RETENTION: 'retention',      // 各回のリテンション → retention:38
  CLIFFS: 'cliffs',            // 崖検出・対話メトリクス
  KAIYU: 'kaiyu',              // 回遊分析
  WRAP: 'wrap',                // 示唆と次アクション
});
const PER_EPISODE = new Set([SECTION.FIRST_WEEK, SECTION.RETENTION]);
export const SECTION_LABEL = {
  summary: 'サマリー', kpi: '全体KPI', first_week: '初週', retention: 'リテンション',
  cliffs: '崖と対話', kaiyu: '回遊', wrap: '示唆と次アクション',
};

export function sectionKey(kind, episodeNumber) {
  if (!Object.values(SECTION).includes(kind)) throw new Error(`知らない節: ${kind}`);
  if (!PER_EPISODE.has(kind)) return kind;
  const n = num(episodeNumber);
  if (n === null || !Number.isInteger(n) || n < 0 || n > 999) throw new Error(`回番号が正しくない: ${episodeNumber}`);
  return `${kind}:${n}`;
}

export function parseSectionKey(key) {
  if (typeof key !== 'string' || !SECTION_KEY_RE.test(key)) return null;
  const m = key.match(/^([a-z_]+)(?::(\d{1,3}))?$/);
  if (!m || !Object.values(SECTION).includes(m[1])) return null;
  if (PER_EPISODE.has(m[1]) !== (m[2] !== undefined)) return null;
  return { kind: m[1], episode: m[2] === undefined ? null : Number(m[2]) };
}

export function sectionLabel(key) {
  const p = parseSectionKey(key);
  if (!p) return `その他（${key}）`;
  return p.episode === null ? SECTION_LABEL[p.kind] : `EP#${p.episode}の${SECTION_LABEL[p.kind]}`;
}

// 週次画面の並び（表紙は除く）
export function weekSectionKeys(eps) {
  const list = Array.isArray(eps) ? eps : [];
  return [SECTION.SUMMARY, SECTION.KPI,
    ...list.map(n => sectionKey(SECTION.FIRST_WEEK, n)),
    ...list.map(n => sectionKey(SECTION.RETENTION, n)),
    SECTION.CLIFFS, SECTION.KAIYU, SECTION.WRAP];
}

// ── コメントの表示 ───────────────────────────────────────────────────
const byTime = (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || (num(a.id) ?? 0) - (num(b.id) ?? 0);

export function commentsFor(bundle, week, key) {
  const all = Array.isArray(bundle?.comments) ? bundle.comments : [];
  const rows = all.filter(c => num(c.week_number) === num(week) && c.section_key === key).sort(byTime);
  return { open: rows.filter(c => !c.resolved_at), resolved: rows.filter(c => !!c.resolved_at) };
}

// 画面のどの欄にも当たらないコメント（将来の欄・手で入れたもの）。捨てずに別に出す
export function strayComments(bundle, week, knownKeys) {
  const known = new Set(knownKeys);
  const all = Array.isArray(bundle?.comments) ? bundle.comments : [];
  return all.filter(c => num(c.week_number) === num(week) && !known.has(c.section_key)).sort(byTime);
}

export function memberName(bundle, email, fallback) {
  if (fallback) return fallback;
  const m = (Array.isArray(bundle?.members) ? bundle.members : []).find(x => x.email === email);
  return m?.display_name || email || '名前未登録';
}

export function canResolve(viewer, comment) {
  if (!viewer || !comment || comment.resolved_at) return false;
  return comment.author_email === viewer.email || roleAtLeast(viewer.role, 'editor');
}

const charLen = s => [...s].length;   // DBの length() と同じく文字数（コードポイント）で数える

export function validateCommentBody(body) {
  const value = String(body ?? '').trim();
  if (!value) return { ok: false, value, message: 'コメントを書いてから投稿してください。' };
  const n = charLen(value);
  if (n > 4000) return { ok: false, value, message: `コメントは4000文字までです（いま${n}文字）。` };
  return { ok: true, value, length: n };
}

// ── エラーの出し分け（付録A） ────────────────────────────────────────
// 種類は message で見分ける（42501 は複数の意味で使う）。action：relogin（ログインし直す）・reload（読み直す）・admin（管理者へ）
const ERRORS = {
  not_signed_in: { message: 'ログインが切れています。ログインし直してください。', action: 'relogin' },
  session_revoked: { message: 'このログインは無効になっています（ログアウト済み）。ログインし直してください。', action: 'relogin' },
  provider_not_allowed: { message: 'Googleでログインしてください（ほかの方法のログインでは書き込めません）。', action: 'relogin' },
  not_a_member: { message: 'このアカウントはメンバー一覧にありません。番組の管理者に連絡してください。', action: 'admin' },
  member_binding_mismatch: { message: 'メンバーの登録が別のアカウントに結び付いています。管理者に結び付け直しを頼んでください。', action: 'admin' },
  insufficient_role: { message: 'この操作をする権限がありません。', action: null },
  approved_week_locked: { message: '承認済みの週は、オーナー（owner）だけが直せます。', action: null },
  batch_owned_by_other: { message: 'ほかの人の入力の束には加えられません。もう一度送ってください。', action: null },
  no_notes_for_week: { message: 'この週の文章がまだ保存されていません。先に保存してから承認してください。', action: 'reload' },
  comment_not_found: { message: 'コメントが見つかりません（消された可能性があります）。読み直してください。', action: 'reload' },
  revision_conflict: { message: 'ほかの人が先に保存しました。読み直してください。', action: 'reload' },
  duplicate: { message: '同じ入力がほぼ同時に2回送られました。読み直して、入っているか確かめてください。', action: 'reload' },
  notes_too_large: { message: '文章が大きすぎて保存できません（上限 512KiB）。', action: null },
  comment_limit_reached: { message: 'この週のコメントが上限（500件）に達しました。整理は管理者に頼んでください。', action: 'admin' },
  weekly_snapshot_not_approved: { message: 'この週の数値（weekly_snapshots）がまだ確定（approved）していないため、文章を承認できません。数値の承認が先です。', action: null },
  invalid_week: { message: '週の番号が正しくありません。', action: null },
  invalid_expected_revision: { message: '版の番号が正しくありません。読み直してください。', action: 'reload' },
  invalid_notes: { message: '文章のデータの形が正しくありません（画面の不具合）。', action: null },
  week_mismatch: { message: '文章の週番号と保存先の週が違います（画面の不具合）。', action: null },
  unknown_week: { message: 'この週はDBに登録されていません（week_windows・weekly_snapshots のどちらにもない）。', action: null },
  invalid_section_key: { message: 'コメント欄の名前が正しくありません（画面の不具合）。', action: null },
  invalid_body: { message: 'コメントは1〜4000文字で書いてください。', action: null },
  invalid_episode_number: { message: '回の番号が正しくありません。', action: null },
  invalid_metric: { message: '指標の名前が正しくありません（画面の不具合）。', action: null },
  daily_values_only_for_first_week: { message: '日別の値は初週の合計にだけ付けられます（画面の不具合）。', action: null },
  invalid_daily_values: { message: '日別の値は、公開日（UTC）から7日分を0以上の整数で入れてください。', action: null },
  daily_sum_mismatch: { message: '日別の値の合計と、合計の値が一致しません。', action: null },
  invalid_value: { message: '値が正しくありません（再生は0以上の整数、平均消費率は0〜100）。', action: null },
  invalid_period_end: { message: '期間の終わりが未来の日付です（UTC）。その日が来てから入力してください。', action: null },
  source_note_too_long: { message: '出典メモは1000文字までです。', action: null },
  daily_needs_single_day: { message: '日別の値は1日ずつ入れてください。', action: null },
  date_outside_episode_range: { message: '日付が公開日から60日の範囲の外です。', action: null },
  first_week_needs_7_days: { message: '初週は公開日（UTC）から7日間です。', action: null },
  first_week_window_mismatch: { message: '期間が公開日（UTC）からの7日間と合っていません。', action: 'reload' },
  function_missing: { message: 'DB側にこの機能（関数）がまだありません。管理者に連絡してください。', action: 'admin' },
  network: { message: 'DBに接続できませんでした。ネットワークを確かめて、もう一度送ってください。', action: null },
  local_only: { message: `この機能は${LOCAL_ONLY}。`, action: null },
  busy: { message: '送信中です。終わるまでお待ちください。', action: null },
};
// DB の hint（期待する値の例）をそのまま添えると分かりやすいもの
const HINT_USEFUL = new Set(['first_week_needs_7_days', 'invalid_daily_values', 'invalid_expected_revision']);
const KNOWN = Object.keys(ERRORS).filter(k => !['duplicate', 'function_missing', 'network', 'local_only', 'busy'].includes(k));

function parseDetail(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/([a-z_.]+)=([^\s]+)/g)) out[m[1]] = m[2];
  return out;
}

export function describeError(err, { fn = '' } = {}) {
  const e = err || {};
  const code = String(e.code || '');
  const message = String(e.message || e || '');
  const details = e.details == null ? '' : String(e.details);
  const hint = e.hint == null ? '' : String(e.hint);
  let kind = KNOWN.find(k => new RegExp(`(^|[^a-z_])${k}([^a-z_]|$)`).test(message)) || null;
  if (!kind) {
    if (/permission denied for function/i.test(message) || /JWT expired|invalid JWT|PGRST301/i.test(`${code} ${message}`)) kind = 'not_signed_in';
    else if (code === 'PGRST202' || /could not find the function/i.test(message)) kind = 'function_missing';
    else if (code === '23505' || /duplicate key value/i.test(message)) kind = 'duplicate';
    else if (code === 'PT409') kind = 'revision_conflict';
    else if (/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(message)) kind = 'network';
  }
  const base = kind ? ERRORS[kind] : { message: `保存できませんでした（${message || code || '原因不明'}）。`, action: null };
  let text = base.message;
  let detail = '';
  if (kind === 'insufficient_role') {
    const d = parseDetail(details);
    if (fn === 'dashboard_resolve_comment') text = 'このコメントを解決にできるのは、書いた本人か「編集（editor）」以上の人です。';
    else if (d.required) text = `この操作には「${roleLabel(d.required)}」以上の権限が必要です（あなたは ${roleLabel(d.actual)}）。`;
  } else if (kind === 'revision_conflict') {
    let d = null;
    try { d = JSON.parse(details); } catch { d = null; }
    if (d && typeof d === 'object') {
      const parts = [];
      if (d.current_revision != null) parts.push(`いまの版: ${d.current_revision}`);
      if (d.updated_by) parts.push(`保存した人: ${d.updated_by}`);
      if (d.updated_at) parts.push(`保存日時: ${jstText(d.updated_at)}`);
      detail = parts.join('　');
    }
  } else if (kind === 'notes_too_large') {
    const d = parseDetail(details);
    if (d.bytes) detail = `いまの大きさ ${Number(d.bytes).toLocaleString('en-US')} バイト／上限 ${Number(d.limit || 524288).toLocaleString('en-US')} バイト`;
  } else if (kind === 'comment_limit_reached') {
    const d = parseDetail(details);
    if (d.week) detail = `W${d.week}・上限 ${d.limit || 500}件`;
  } else if (['daily_sum_mismatch', 'date_outside_episode_range', 'first_week_window_mismatch', 'unknown_week', 'week_mismatch'].includes(kind)) {
    detail = details;
  } else if (!kind || kind === 'function_missing' || kind === 'duplicate') {
    detail = [code, details].filter(Boolean).join(' ');
  }
  if (!detail && hint && HINT_USEFUL.has(kind)) detail = hint;
  return { kind: kind || 'unknown', message: text, detail, action: base.action, code, raw: message };
}

function jstText(ts) {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return String(ts);
  const s = new Date(t + 9 * 3600000).toISOString();
  return `${s.slice(0, 10).replace(/-/g, '/')} ${s.slice(11, 16)} JST`;
}

export function localError(kind, extra = {}) {
  return { kind, message: ERRORS[kind]?.message || kind, detail: '', action: ERRORS[kind]?.action || null, code: '', raw: kind, ...extra };
}

// submit_apple の warnings（保存はできたが確認が要る点）
export const APPLE_WARNINGS = {
  episode_not_registered: 'この回はまだDBの回の一覧（episodes）にありません。承認のときに回の登録を確かめます。',
  daily_values_missing: '日別の内訳がありません。承認のときに日別との照合ができません。',
  reference_value_includes_later_episodes_possible: 'エピソード一覧の参考値は、あとの回の分が混ざることがあります。',
  within_72h_apple_delay: '期間の終わりから72時間たっていません。Appleの遅延で、あとから値が増えることがあります（月曜の確定セッションで入れ直すと確実）。',
};

// 平均消費率（consume_pct）のとき。DB は consume_pct にも「エピソード一覧の参考値」の注意を返すが、
// 消費率はエピソード個別ページの全期間の値を読む決まり（2026-10-14）なので、読み方の確認として出す
const APPLE_WARNINGS_BY_METRIC = {
  consume_pct: {
    reference_value_includes_later_episodes_possible: 'エピソード一覧ではなく、エピソード個別ページの「全期間」の平均消費率を読んだか確かめてください（一覧の値は期間の取り方が違います）。',
    within_72h_apple_delay: '読んだ日から72時間たっていません。Appleの遅延で直近の再生がまだ入っておらず、全期間の平均があとで少し動くことがあります。',
  },
};

export function describeWarnings(list, { metric = null } = {}) {
  const own = APPLE_WARNINGS_BY_METRIC[metric] || {};
  return (Array.isArray(list) ? list : []).map(code => ({ code, message: own[code] || APPLE_WARNINGS[code] || `確認が要る点: ${code}` }));
}

// ── Apple の初週 ─────────────────────────────────────────────────────
export const APPLE_FIRST_WEEK = 'first_week_plays';
export const APPLE_MAX = 1000000;

// 公開日（UTC の日付）から7日間。dates は UTC 日付 7つ
export function appleWindow(episode) {
  const start = episode?.published_at ? utcDate(episode.published_at) : null;
  if (!start) return null;
  const end = addDays(start, 6);
  return { start, end, dates: dateRange(start, end) };
}

export function todayUtc(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10);
}

// 全角数字・空白を直す（日本語入力で打った「１２」も受け付ける）
export function normalizeDigits(text) {
  return String(text ?? '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[\s,，]/g, '');
}

// 入力の検証。values は文字列7つ（画面の入力欄のまま）。errors が空なら送れる
export function validateAppleForm({ window: win, values, note = '', today = todayUtc() } = {}) {
  const errors = [];
  const cautions = [];
  if (!win || !Array.isArray(win.dates) || win.dates.length !== 7) {
    return { ok: false, daily: null, total: null, errors: [{ field: 'window', message: '公開日（UTC）が未登録のため、初週の7日間が決まりません。回の登録が先です。' }], cautions };
  }
  const vals = Array.isArray(values) ? values : [];
  const daily = [];
  win.dates.forEach((d, i) => {
    const raw = normalizeDigits(vals[i]);
    if (raw === '') { errors.push({ field: 'day', index: i, date: d, message: `${md(d)} が空です。読めない日は推測で埋めず、送らずにおいてください。` }); daily.push(null); return; }
    if (!/^\d+$/.test(raw)) { errors.push({ field: 'day', index: i, date: d, message: `${md(d)} は0以上の整数で入れてください（「${String(vals[i]).trim()}」は使えません）。` }); daily.push(null); return; }
    const v = Number(raw);
    if (v > APPLE_MAX) { errors.push({ field: 'day', index: i, date: d, message: `${md(d)} の値が大きすぎます（上限 ${APPLE_MAX.toLocaleString('en-US')}）。` }); daily.push(null); return; }
    daily.push(v);
  });
  const filled = daily.filter(v => v !== null).length;
  const total = filled === 7 ? daily.reduce((a, b) => a + b, 0) : null;
  if (total !== null && total > APPLE_MAX) errors.push({ field: 'total', message: `合計が大きすぎます（上限 ${APPLE_MAX.toLocaleString('en-US')}）。` });
  const noteText = String(note ?? '').trim();
  if (charLen(noteText) > 1000) errors.push({ field: 'note', message: `出典メモは1000文字までです（いま${charLen(noteText)}文字）。` });
  if (win.end > addDays(today, 1)) errors.push({ field: 'window', message: `期間の終わり（UTC ${win.end}）がまだ来ていません。その日が過ぎてから入力してください。` });
  else if (win.end > addDays(today, -3)) cautions.push('7日目（UTC）から72時間たっていません。Appleの遅延で値があとから増えることがあります。月曜の確定セッションで入れると確実です。');
  return { ok: errors.length === 0, daily: errors.length ? null : daily, total, errors, cautions, note: noteText, filled };
}

function md(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
}

// dashboard_submit_apple の引数。batch_id は送らない（DB側で新しく作る）。value は日別の合計を明示する
export function appleSubmitArgs({ episode_number, window: win, daily, note }) {
  return {
    episode_number: Number(episode_number),
    metric: APPLE_FIRST_WEEK,
    value: daily.reduce((a, b) => a + b, 0),
    period_start: win.start,
    period_end: win.end,
    source_note: note ? String(note).trim() || null : null,
    daily_values: [...daily],
  };
}

// その回の Apple の手入力（新しい順）。metric の既定は初週の再生
export function appleInputsFor(bundle, n, metric = APPLE_FIRST_WEEK) {
  const rows = Array.isArray(bundle?.apple_inputs) ? bundle.apple_inputs : [];
  return rows.filter(r => num(r.episode_number) === num(n) && r.metric === metric)
    .sort((a, b) => String(b.entered_at || '').localeCompare(String(a.entered_at || '')) || (num(b.id) ?? 0) - (num(a.id) ?? 0));
}

const PENDING = new Set(['submitted', 'promoted']);
export const APPLE_STATUS_JA = { submitted: '未承認', promoted: '未承認（登録準備済み）', rejected: '却下', withdrawn: '取り下げ（入れ直し）' };

// 表示に使う値：first_week に approved の Apple 行があればそれ。無ければ承認前の手入力（「手入力（未承認）」）
export function appleFirstWeekView(approvedMain, inputs) {
  const pending = (Array.isArray(inputs) ? inputs : []).find(r => PENDING.has(r.status)) || null;
  if (approvedMain) return { show: 'approved', approved: approvedMain, manual: null, pending };
  if (pending) return { show: 'manual', approved: null, manual: pending, pending };
  return { show: 'none', approved: null, manual: null, pending: null };
}

// ── Apple の平均消費率（全期間） ─────────────────────────────────────
// 2026-10-14 決定：人が Apple Podcasts Connect のエピソード個別ページで、全期間の平均消費率を配信7日目以降に読んで入れる。
// 日別の値は無いので daily_values は送らない。期間は「読んだ日までの全期間」＝ period_start：公開日（UTC）、period_end：読んだ日（UTC・未来不可）。
// DB（dashboard_submit_apple）は consume_pct の period_start を null にして保存する（エピソード一覧の参考値と同じ扱い）。読んだ日は period_end に残る。
export const APPLE_CONSUME = 'consume_pct';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 消費率の表示（小数があれば1桁、無ければ整数）
export function fmtConsume(v) {
  const n = num(v);
  if (n === null) return '—';
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? String(r) : r.toFixed(1)}%`;
}

// 全角の数字・小数点・％ を直す（「４７．５％」も受け付ける）。空白と末尾の % は外す。
// カンマは外さない（「47,5」を 475 と読まないため。数でない入力として止める）
export function normalizePct(text) {
  return String(text ?? '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[．。]/g, '.').replace(/[\s]/g, '').replace(/[%％]$/, '');
}

function validIsoDate(s) {
  if (!ISO_DATE_RE.test(String(s || ''))) return false;
  return addDays(s, 0) === s;   // 2026-02-30 などを弾く
}

// 入力の検証。value は文字列（画面の入力欄のまま）、readDate は読んだ日（UTC の YYYY-MM-DD）。errors が空なら送れる
export function validateConsumeForm({ episode = null, value, readDate, note = '', today = todayUtc() } = {}) {
  const errors = [];
  const cautions = [];
  const pub = episode?.published_at ? utcDate(episode.published_at) : null;
  if (!pub) errors.push({ field: 'window', message: '公開日（UTC）が未登録のため、全期間の始まりが決まりません。回の登録が先です。' });
  const raw = normalizePct(value);
  let v = null;
  if (raw === '') errors.push({ field: 'value', message: '平均消費率が空です。読めないときは推測で埋めず、送らずにおいてください。' });
  else if (!/^\d+(\.\d+)?$/.test(raw)) errors.push({ field: 'value', message: `平均消費率は0〜100の数で入れてください（「${String(value).trim()}」は使えません。小数点は「.」）。` });
  else if (/\.\d{2,}$/.test(raw)) errors.push({ field: 'value', message: '平均消費率の小数は1桁までです（例: 47.5）。' });
  else {
    v = Number(raw);
    if (v > 100) { errors.push({ field: 'value', message: `平均消費率は100%までです（いま ${raw}）。` }); v = null; }
  }
  const d = String(readDate ?? '').trim();
  if (!d) errors.push({ field: 'date', message: '読んだ日（UTC）を選んでください。' });
  else if (!validIsoDate(d)) errors.push({ field: 'date', message: `読んだ日の形が正しくありません（「${d}」。YYYY-MM-DD）。` });
  else if (d > today) errors.push({ field: 'date', message: `読んだ日（UTC ${d}）が未来の日付です。日本時間の朝9時より前は、UTCではまだ前の日です。` });
  else if (pub && d < pub) errors.push({ field: 'date', message: `読んだ日（UTC ${d}）が公開日（UTC ${pub}）より前です。` });
  else if (pub && d < addDays(pub, 6)) cautions.push(`配信7日目（UTC ${md(addDays(pub, 6))}）より前に読んだ値です。決めた取り方（7日目以降に、全期間の値を読む）と違います。`);
  const noteText = String(note ?? '').trim();
  if (charLen(noteText) > 1000) errors.push({ field: 'note', message: `出典メモは1000文字までです（いま${charLen(noteText)}文字）。` });
  const ok = errors.length === 0;
  return { ok, value: ok ? v : null, readDate: ok ? d : null, periodStart: pub, errors, cautions, note: noteText };
}

// dashboard_submit_apple の引数（消費率）。daily_values と batch_id は送らない
export function consumeSubmitArgs({ episode_number, periodStart, readDate, value, note }) {
  return {
    episode_number: Number(episode_number),
    metric: APPLE_CONSUME,
    value: Number(value),
    period_start: periodStart,
    period_end: readDate,
    source_note: note ? String(note).trim() || null : null,
  };
}

// 表示に使う消費率：first_week の Apple 行（approved）に consume_pct があればそれ（主の行を優先、無ければ新しい行）。
// 無ければ承認前の手入力のうち、読んだ日が最も新しいもの（「手入力（未承認）・◯月◯日時点の全期間」）
// approvedRows は [主の行, ...別の行]（firstWeekFor の apple.main と apple.others。どれも approved）
export function appleConsumeView(approvedRows, inputs) {
  const list = (Array.isArray(approvedRows) ? approvedRows : [approvedRows]).filter(r => r && (!r.status || r.status === 'approved'));
  const withPct = list.filter(r => num(r.consume_pct) !== null);
  const newest = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || (num(b.id) ?? 0) - (num(a.id) ?? 0);
  const main = Array.isArray(approvedRows) ? approvedRows[0] : approvedRows;
  const approved = main && withPct.includes(main) ? main : [...withPct].sort(newest)[0] || null;
  const pending = (Array.isArray(inputs) ? inputs : []).filter(r => r.metric === APPLE_CONSUME && PENDING.has(r.status))
    .sort((a, b) => String(b.period_end || '').localeCompare(String(a.period_end || '')) || String(b.entered_at || '').localeCompare(String(a.entered_at || '')) || (num(b.id) ?? 0) - (num(a.id) ?? 0))[0] || null;
  if (approved) return { show: 'approved', approved, manual: null, pending };
  if (pending) return { show: 'manual', approved: null, manual: pending, pending };
  return { show: 'none', approved: null, manual: null, pending: null };
}

// 「10月14日時点の全期間」（読んだ日＝period_end。UTC）
export function consumeAsOfLabel(row) {
  const d = row?.period_end;
  if (!d || !ISO_DATE_RE.test(String(d).slice(0, 10))) return '読んだ日の記録なし';
  const [, m, dd] = String(d).slice(0, 10).split('-').map(Number);
  return `${m}月${dd}日時点の全期間`;
}

// ── 週の文章（notes） ────────────────────────────────────────────────
// 画面から書き換えてよい欄（CONTRACT.md 3節「手で書く週」）。数値の欄（kpi.tiles・platforms・metrics など）は触らない。
export const EDITABLE_PATHS = [
  'summary.title', 'summary.subtitle', 'summary.items[].icon/head/body', 'summary.footer',
  'episode_sections[].insight.text',
  'retention_sections[].type_label', 'retention_sections[].insight.text',
  'cliffs.insight.text', 'cliffs.dialog_note',
  'kaiyu.insight.text',
  'wrap.title', 'wrap.subtitle', 'wrap.positives[]', 'wrap.issues[].head/body', 'wrap.nexts[].num/title/detail', 'wrap.closing', 'wrap.footer',
];

const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const str = v => (v === null || v === undefined ? '' : String(v));

export function notesMetaFor(bundle, week) {
  return bundle?.notes_meta?.[String(week)] || null;
}

function sectionEps(eps, list) {
  const out = [];
  for (const n of eps || []) if (num(n) !== null && !out.includes(num(n))) out.push(num(n));
  for (const s of list || []) { const n = num(s?.episode_number); if (n !== null && !out.includes(n)) out.push(n); }
  return out;
}

// 編集フォームの中身（文字列だけ）。notes が無い週は空欄
export function editableModel(notes, eps = []) {
  const n = notes || {};
  const s = n.summary || {};
  const w = n.wrap || {};
  const epList = sectionEps(eps, n.episode_sections);
  const retList = sectionEps(eps, n.retention_sections);
  const findSec = (list, e) => (list || []).find(x => num(x?.episode_number) === e) || null;
  return {
    summary: {
      title: str(s.title), subtitle: str(s.subtitle), footer: str(s.footer),
      items: (Array.isArray(s.items) ? s.items : []).map(it => ({ icon: str(it?.icon), head: str(it?.head), body: str(it?.body) })),
    },
    episodes: epList.map(e => ({ episode_number: e, insight: str(findSec(n.episode_sections, e)?.insight?.text) })),
    retention: retList.map(e => {
      const r = findSec(n.retention_sections, e);
      return { episode_number: e, type_label: str(r?.type_label), insight: str(r?.insight?.text) };
    }),
    cliffs: { insight: str(n.cliffs?.insight?.text), dialog_note: str(n.cliffs?.dialog_note) },
    kaiyu: { insight: str(n.kaiyu?.insight?.text) },
    wrap: {
      title: str(w.title), subtitle: str(w.subtitle), closing: str(w.closing), footer: str(w.footer),
      positives: (Array.isArray(w.positives) ? w.positives : []).map(str),
      issues: (Array.isArray(w.issues) ? w.issues : []).map(i => ({ head: str(i?.head), body: str(i?.body) })),
      nexts: (Array.isArray(w.nexts) ? w.nexts : []).map(x => ({ num: str(x?.num), title: str(x?.title), detail: str(x?.detail) })),
    },
  };
}

// 空欄のままの欄は、元が null／無しなら元のまま（'' に変えない）
function setText(obj, key, value) {
  const v = String(value ?? '').replace(/\r\n?/g, '\n');
  if (v === '' && (obj[key] === null || obj[key] === undefined)) return;
  obj[key] = v;
}

function setInsight(sec, text, label) {
  const v = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!sec.insight || typeof sec.insight !== 'object') {
    if (v === '') return;
    sec.insight = { label, text: v };
    return;
  }
  sec.insight.text = v;
  if (!sec.insight.label) sec.insight.label = label;
}

// 元の notes に、編集フォームの文字だけを書き戻した新しい notes（元は変えない）
// 元に無い欄（節・並び）は、書いた中身があるときだけ作る（何も書かなければ元と同じ）
const filled = v => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.values(v).some(filled);
  return true;
};
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

function applyList(target, key, items, fields, blank) {
  const had = Array.isArray(target[key]);
  if (!had && !(items || []).length) return;
  const old = had ? target[key] : [];
  target[key] = (items || []).map((it, i) => {
    const b = isObj(old[i]) ? old[i] : { ...blank };
    for (const k of fields) setText(b, k, it[k]);
    return b;
  });
}

export function applyModel(notes, model) {
  const out = clone(notes) || {};
  const m = model || {};
  if (m.summary && (isObj(out.summary) || filled(m.summary))) {
    if (!isObj(out.summary)) out.summary = {};
    for (const k of ['title', 'subtitle', 'footer']) setText(out.summary, k, m.summary[k]);
    applyList(out.summary, 'items', m.summary.items, ['icon', 'head', 'body'], { icon: '', head: '', body: '' });
  }
  if (m.episodes) {
    for (const e of m.episodes) {
      const list = Array.isArray(out.episode_sections) ? out.episode_sections : null;
      let sec = list ? list.find(x => num(x?.episode_number) === e.episode_number) : null;
      if (!sec) {
        if (!String(e.insight ?? '')) continue;
        sec = { episode_number: e.episode_number, title: null, subtitle: null, platforms: [], footnote: null, insight: null };
        if (!list) out.episode_sections = [];
        out.episode_sections.push(sec);
      }
      setInsight(sec, e.insight, '示唆:');
    }
  }
  if (m.retention) {
    for (const r of m.retention) {
      const list = Array.isArray(out.retention_sections) ? out.retention_sections : null;
      let sec = list ? list.find(x => num(x?.episode_number) === r.episode_number) : null;
      if (!sec) {
        if (!String(r.insight ?? '') && !String(r.type_label ?? '')) continue;
        sec = { episode_number: r.episode_number, title: null, subtitle: null, type_label: null, metrics: [], insight: null };
        if (!list) out.retention_sections = [];
        out.retention_sections.push(sec);
      }
      setText(sec, 'type_label', r.type_label);
      setInsight(sec, r.insight, '分析:');
    }
  }
  if (m.cliffs && (isObj(out.cliffs) || filled(m.cliffs))) {
    if (!isObj(out.cliffs)) out.cliffs = { title: null, subtitle: null, tables: [], dialog_lines: [], dialog_note: null, insight: null };
    setText(out.cliffs, 'dialog_note', m.cliffs.dialog_note);
    setInsight(out.cliffs, m.cliffs.insight, '示唆:');
  }
  if (m.kaiyu && (isObj(out.kaiyu) || filled(m.kaiyu))) {
    if (!isObj(out.kaiyu)) out.kaiyu = { title: null, subtitle: null, tiles: [], screening: [], footnote: null, insight: null };
    setInsight(out.kaiyu, m.kaiyu.insight, '示唆:');
  }
  if (m.wrap && (isObj(out.wrap) || filled(m.wrap))) {
    if (!isObj(out.wrap)) out.wrap = {};
    for (const k of ['title', 'subtitle', 'closing', 'footer']) setText(out.wrap, k, m.wrap[k]);
    if (Array.isArray(out.wrap.positives) || (m.wrap.positives || []).length) {
      out.wrap.positives = (m.wrap.positives || []).map(p => String(p ?? '').replace(/\r\n?/g, '\n'));
    }
    applyList(out.wrap, 'issues', m.wrap.issues, ['head', 'body'], { head: '', body: '' });
    applyList(out.wrap, 'nexts', m.wrap.nexts, ['num', 'title', 'detail'], { num: '', title: '', detail: '' });
  }
  return out;
}

// 文章がまだ無い週の雛形（tools/new_week_notes.py と同じ形。数値の欄は空）
export function newWeekNotes(week, { episodes = [], dbGeneratedAt = null, writtenBy = null, now = new Date() } = {}) {
  const jst = new Date(new Date(now).getTime() + 9 * 3600000).toISOString().slice(0, 19) + '+09:00';
  const eps = episodes.map(e => num(e.num)).filter(n => n !== null);
  return {
    week_number: Number(week),
    source_script: null,
    source_sha256: null,
    written_at: jst,
    review: { basis: null, status: 'draft', db_generated_at: dbGeneratedAt, written_by: writtenBy, approved_by: null, approved_at: null },
    cover: { episodes: episodes.map(e => ({ num: num(e.num), shortTitle: e.shortTitle || null, title: e.title || null, date: e.date || null })) },
    summary: { title: null, subtitle: null, items: [0, 1, 2, 3].map(() => ({ icon: '', head: '', body: '' })), footer: null },
    kpi: { title: null, subtitle: null, tiles: [], history: [], footnotes: [] },
    episode_sections: eps.map(n => ({ episode_number: n, title: null, subtitle: null, platforms: [], footnote: null, insight: { label: '示唆:', text: '' } })),
    retention_sections: eps.map(n => ({ episode_number: n, title: null, subtitle: null, type_label: null, metrics: [], insight: { label: '分析:', text: '' } })),
    cliffs: { title: null, subtitle: null, tables: [], dialog_lines: [], dialog_note: null, insight: { label: '示唆:', text: '' } },
    kaiyu: { title: null, subtitle: null, tiles: [], screening: [], footnote: null, insight: { label: '示唆:', text: '' } },
    wrap: { title: '今週の示唆と次アクション', positives: ['', '', ''], issues: [{ head: '', body: '' }],
      nexts: ['①', '②', '③'].map(x => ({ num: x, title: '', detail: '' })), closing: null },
    constants: {},
    unmapped: [],
  };
}

// キーの順序によらない同値判定（DB は jsonb で比べる）
export function sameJson(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && sameJson(a[k], b[k]));
}

export const NOTES_LIMIT = 524288;
export function notesBytes(notes) {
  return new TextEncoder().encode(JSON.stringify(notes)).length;
}

// ── RPC をまとめる係 ─────────────────────────────────────────────────
// client: { rpc(name, args) → Promise<{data, error}> }（null ならローカル表示）
// getBundle(): 画面が持っている bundle（ここで comments・notes・notes_meta を書き換える）
// reload(): bundle を読み直す（Apple の送信後に呼ぶ）
export function createCollab({ client, getBundle, reload = null } = {}) {
  const inflight = new Set();

  async function call(key, fn, args) {
    if (!client) return { ok: false, error: localError('local_only') };
    if (inflight.has(key)) return { ok: false, error: localError('busy') };
    inflight.add(key);
    try {
      let res;
      try { res = await client.rpc(fn, args); }
      catch (e) { return { ok: false, error: describeError(e, { fn }) }; }
      if (res && res.error) return { ok: false, error: describeError(res.error, { fn }) };
      let data = res ? res.data : null;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch { /* そのまま */ } }
      if (!data || typeof data !== 'object') return { ok: false, error: { kind: 'bad_response', message: 'DBから想定外の返事がありました。読み直してください。', detail: '', action: 'reload', code: '', raw: '' } };
      return { ok: true, data };
    } finally {
      inflight.delete(key);
    }
  }

  const bundle = () => getBundle();

  return {
    isBusy: key => inflight.has(key),
    keys: {
      comment: (week, key) => `comment:${week}:${key}`,
      resolve: id => `resolve:${id}`,
      notes: week => `notes:${week}`,
      apple: n => `apple:${n}`,
      appleConsume: n => `apple-consume:${n}`,
    },

    async addComment(week, key, body) {
      const v = validateCommentBody(body);
      if (!v.ok) return { ok: false, error: { kind: 'invalid_input', message: v.message, detail: '', action: null } };
      if (!SECTION_KEY_RE.test(String(key || ''))) return { ok: false, error: localError('invalid_section_key') };
      const r = await call(`comment:${week}:${key}`, 'dashboard_add_comment', { week: Number(week), section_key: key, body: v.value });
      if (!r.ok) return r;
      const b = bundle();
      if (b) {
        if (!Array.isArray(b.comments)) b.comments = [];
        b.comments.push({ resolved_at: null, resolved_by: null, ...r.data });
      }
      return { ok: true, comment: r.data };
    },

    async resolveComment(id) {
      const r = await call(`resolve:${id}`, 'dashboard_resolve_comment', { comment_id: Number(id) });
      if (!r.ok) return r;
      const c = (bundle()?.comments || []).find(x => num(x.id) === num(id));
      if (c) { c.resolved_at = r.data.resolved_at; c.resolved_by = r.data.resolved_by; }
      return { ok: true, data: r.data };
    },

    // 保存：expected_revision は bundle の notes_meta（無ければ新規の 0）。成功したら戻り値の revision で置き換える
    async saveNotes(week, notes) {
      const wk = String(week);
      if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return { ok: false, error: localError('invalid_notes') };
      const bytes = notesBytes(notes);
      if (bytes > NOTES_LIMIT) return { ok: false, error: { ...localError('notes_too_large'), detail: `いまの大きさ ${bytes.toLocaleString('en-US')} バイト／上限 ${NOTES_LIMIT.toLocaleString('en-US')} バイト` } };
      const meta = notesMetaFor(bundle(), wk);
      const expected = meta ? num(meta.revision) ?? 0 : 0;
      const r = await call(`notes:${wk}`, 'dashboard_save_notes', { week: Number(week), notes, expected_revision: expected });
      if (!r.ok) return r;
      const d = r.data;
      const b = bundle();
      if (b) {
        if (!d.unchanged) { if (!b.notes) b.notes = {}; b.notes[wk] = notes; }
        if (!b.notes_meta) b.notes_meta = {};
        const approved = d.status === 'approved';
        b.notes_meta[wk] = {
          ...(meta || {}),
          status: d.status, revision: d.revision, updated_by: d.updated_by, updated_at: d.updated_at,
          approved_at: approved ? (meta?.approved_at ?? null) : null,
          approved_by: approved ? (meta?.approved_by ?? null) : null,
        };
      }
      return { ok: true, data: d, unchanged: !!d.unchanged };
    },

    // 承認：画面で見ていた版（notes_meta.revision）だけを承認する。承認で revision が1つ進むので、戻り値で置き換える
    async approveWeek(week) {
      const wk = String(week);
      const meta = notesMetaFor(bundle(), wk);
      if (!meta) return { ok: false, error: localError('no_notes_for_week') };
      const r = await call(`notes:${wk}`, 'dashboard_approve_week', { week: Number(week), expected_revision: num(meta.revision) });
      if (!r.ok) return r;
      const d = r.data;
      const b = bundle();
      if (b) {
        b.notes_meta[wk] = { ...meta, revision: d.revision, status: d.status, approved_at: d.approved_at, approved_by: d.approved_by,
          ...(d.already_approved ? {} : { updated_by: d.approved_by ?? meta.updated_by }) };
      }
      return { ok: true, data: d, alreadyApproved: !!d.already_approved };
    },

    // Apple の初週。送る前に検証し、送ったら bundle を読み直す
    async submitApple({ episode_number, window: win, values, note, today } = {}) {
      const v = validateAppleForm({ window: win, values, note, today });
      if (!v.ok) return { ok: false, error: { kind: 'invalid_input', message: v.errors[0].message, detail: v.errors.length > 1 ? `ほか${v.errors.length - 1}件` : '', action: null, errors: v.errors } };
      const args = appleSubmitArgs({ episode_number, window: win, daily: v.daily, note: v.note });
      const r = await call(`apple:${episode_number}`, 'dashboard_submit_apple', args);
      if (!r.ok) return r;
      let reloadError = null;
      if (reload) {
        try { await reload(); }
        catch (e) { reloadError = `送信はできましたが、読み直しに失敗しました（${e && e.message || e}）。ページを再読み込みしてください。`; }
      }
      return { ok: true, data: r.data, args, warnings: describeWarnings(r.data.warnings), withdrawn: r.data.withdrawn_ids || [], reloadError };
    },

    // Apple の平均消費率（全期間）。初週の再生とは別に送る（片方だけでもよい）。送る前に検証し、送ったら bundle を読み直す
    async submitAppleConsume({ episode_number, episode, value, readDate, note, today } = {}) {
      const v = validateConsumeForm({ episode, value, readDate, note, today });
      if (!v.ok) return { ok: false, error: { kind: 'invalid_input', message: v.errors[0].message, detail: v.errors.length > 1 ? `ほか${v.errors.length - 1}件` : '', action: null, errors: v.errors } };
      const args = consumeSubmitArgs({ episode_number, periodStart: v.periodStart, readDate: v.readDate, value: v.value, note: v.note });
      const r = await call(`apple-consume:${episode_number}`, 'dashboard_submit_apple', args);
      if (!r.ok) return r;
      let reloadError = null;
      if (reload) {
        try { await reload(); }
        catch (e) { reloadError = `送信はできましたが、読み直しに失敗しました（${e && e.message || e}）。ページを再読み込みしてください。`; }
      }
      return { ok: true, data: r.data, args, cautions: v.cautions, warnings: describeWarnings(r.data.warnings, { metric: APPLE_CONSUME }), withdrawn: r.data.withdrawn_ids || [], reloadError };
    },
  };
}
