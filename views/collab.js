// 書き込み機能の画面部品：コメント欄・文章の編集と承認・Appleの初週の手入力。
// ロジック（引数の組み立て・検証・エラーの出し分け・revision の置き換え）は lib/collab.js。ここは表示と操作だけ。
// cx（main.js が作る）：{ writable, mode, viewer, role, collab, bundle(), ix(), rerender(), reload(), refreshData(), relogin(), flash, editing }
import { h, clear } from '../lib/dom.js';
import { firstWeekFor, epLabel, shortTitle, jstDate, utcDate, addDays } from '../lib/metrics.js';
import { fmtDateTime, fmtMD, fmtYMD, fmtInt } from '../lib/format.js';
import {
  LOCAL_ONLY, capabilities, commentsFor, strayComments, memberName, canResolve, validateCommentBody, sectionLabel,
  notesMetaFor, editableModel, applyModel, newWeekNotes, sameJson, roleLabel, roleAtLeast,
  appleWindow, appleInputsFor, appleFirstWeekView, validateAppleForm, normalizeDigits, todayUtc, APPLE_STATUS_JA,
  APPLE_CONSUME, appleConsumeView, validateConsumeForm, normalizePct, fmtConsume, consumeAsOfLabel,
} from '../lib/collab.js';

let uid = 0;
const nextId = p => `${p}-${++uid}`;

function takeFlash(cx, key) {
  const f = cx?.flash?.get(key) || null;
  if (f) cx.flash.delete(key);
  return f;
}

// 送信中の見た目（ボタンを押せなくし、文言を替える）
function busy(btn, on, text) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = text || '送信中…'; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; btn.removeAttribute('aria-busy'); }
}

export function errorBox(cx, e, { reloadLabel = '読み直す' } = {}) {
  if (!e) return null;
  return h('div', { class: 'cx-msg error', role: 'alert' },
    h('p', { class: 'cx-msg-main' }, e.message),
    e.detail ? h('p', { class: 'cx-detail' }, e.detail) : null,
    Array.isArray(e.errors) && e.errors.length > 1 ? h('ul', { class: 'cx-list' }, e.errors.map(x => h('li', null, x.message))) : null,
    e.action === 'relogin' ? h('button', { type: 'button', class: 'btn small', onclick: () => cx.relogin() }, 'ログインし直す') : null,
    e.action === 'reload' ? h('button', { type: 'button', class: 'btn small', onclick: () => cx.reload() }, reloadLabel) : null,
    e.action === 'admin' && !/管理者/.test(e.message) ? h('p', { class: 'cx-detail' }, '番組の管理者（オーナー）に連絡してください。') : null);
}

function okBox(text, extra = []) {
  return h('div', { class: 'cx-msg ok', role: 'status' }, h('p', { class: 'cx-msg-main' }, text), extra.length ? h('ul', { class: 'cx-list' }, extra.map(x => h('li', null, x))) : null);
}

// ── コメント欄 ───────────────────────────────────────────────────────
export function commentBox(cx, week, key) {
  const wrap = h('div', { class: 'cmt', 'data-section-key': key });
  if (!cx?.writable) {
    wrap.append(h('p', { class: 'cx-off' }, `💬 コメント — ${LOCAL_ONLY}`));
    return wrap;
  }
  const draw = (keep = {}) => {
    const b = cx.bundle();
    const { open, resolved } = commentsFor(b, week, key);
    const caps = capabilities(cx);
    const ta = h('textarea', { id: nextId('cmt'), rows: 3, placeholder: 'この欄へのコメント（メンバー全員に見えます。4000文字まで）', 'aria-label': `${sectionLabel(key)}へのコメント` });
    ta.value = keep.text || '';
    const count = h('span', { class: 'cmt-count' });
    const updateCount = () => {
      const n = [...ta.value.trim()].length;
      count.textContent = `${n.toLocaleString('en-US')} / 4,000`;
      count.classList.toggle('over', n > 4000);
    };
    ta.addEventListener('input', updateCount);
    updateCount();
    const btn = h('button', { type: 'submit', class: 'btn primary small' }, '投稿');
    const msg = h('div', { class: 'cmt-msg', 'aria-live': 'polite' }, keep.flash ? okBox(keep.flash) : null);
    const form = h('form', {
      class: 'cmt-form',
      onsubmit: async ev => {
        ev.preventDefault();
        if (btn.disabled) return;
        const v = validateCommentBody(ta.value);
        if (!v.ok) { msg.replaceChildren(errorBox(cx, { message: v.message })); ta.focus(); return; }
        busy(btn, true); ta.readOnly = true; form.setAttribute('aria-busy', 'true');
        const r = await cx.collab.addComment(week, key, ta.value);
        busy(btn, false); ta.readOnly = false; form.removeAttribute('aria-busy');
        if (r.ok) draw({ open: true, flash: '投稿しました。' });
        else msg.replaceChildren(errorBox(cx, r.error));
      },
    }, ta, h('div', { class: 'cmt-actions' }, count, btn), msg);
    if (!caps.canComment) { ta.disabled = true; btn.disabled = true; msg.replaceChildren(h('p', { class: 'cx-detail' }, caps.reasons.comment)); }

    const item = c => commentItem(cx, c, keepOpen => draw({ open: true, text: ta.value, ...keepOpen }), msg);
    const summaryText = open.length || resolved.length
      ? `💬 コメント（未解決 ${open.length}${resolved.length ? `・解決済み ${resolved.length}` : ''}）`
      : '💬 コメントを書く';
    const box = h('details', { class: 'cmt-box', open: keep.open || open.length > 0 ? true : null },
      h('summary', null, summaryText),
      open.length ? h('ol', { class: 'cmt-list' }, open.map(item)) : null,
      resolved.length ? h('details', { class: 'cmt-resolved' }, h('summary', null, `解決済み ${resolved.length}件`), h('ol', { class: 'cmt-list' }, resolved.map(item))) : null,
      form);
    clear(wrap).append(box);
  };
  draw();
  return wrap;
}

function commentItem(cx, c, redraw, msg) {
  const b = cx.bundle();
  const name = memberName(b, c.author_email, c.author_name);
  let btn = null;
  if (canResolve(cx.viewer, c)) {
    btn = h('button', {
      type: 'button', class: 'btn small',
      onclick: async () => {
        if (btn.disabled) return;
        busy(btn, true, '処理中…');
        const r = await cx.collab.resolveComment(c.id);
        busy(btn, false);
        if (r.ok) redraw({ flash: '解決済みにしました。' });
        else msg.replaceChildren(errorBox(cx, r.error));
      },
    }, '解決にする');
  }
  return h('li', { class: `cmt-item ${c.resolved_at ? 'resolved' : ''}`.trim() },
    h('p', { class: 'cmt-meta' },
      h('strong', null, name),
      h('time', { datetime: c.created_at }, fmtDateTime(c.created_at)),
      btn),
    h('p', { class: 'cmt-body' }, c.body),
    c.resolved_at ? h('p', { class: 'cmt-res' }, `解決: ${memberName(b, c.resolved_by)}・${fmtDateTime(c.resolved_at)}`) : null);
}

// 画面のどの欄にも当たらないコメント
export function strayCommentsCard(cx, week, knownKeys) {
  if (!cx?.writable) return null;
  const rows = strayComments(cx.bundle(), week, knownKeys);
  if (!rows.length) return null;
  const msg = h('div', { class: 'cmt-msg', 'aria-live': 'polite' });
  return h('section', { class: 'card' },
    h('header', { class: 'sec-head' }, h('p', { class: 'kicker' }, 'コメント'), h('h2', null, 'この週のその他のコメント'),
      h('p', { class: 'sub' }, '画面のどの欄にも当たらない section_key のコメント。捨てずにここに出しています。')),
    h('ol', { class: 'cmt-list' }, rows.map(c => {
      const li = commentItem(cx, c, () => cx.rerender(), msg);
      li.prepend(h('p', { class: 'cmt-key' }, `欄: ${c.section_key}`));
      return li;
    })),
    msg);
}

// ── 週の文章：状態・編集・承認 ───────────────────────────────────────
function notesStatusText(cx, meta, hasNotes) {
  const b = cx.bundle();
  if (!cx.writable) return hasNotes ? '文章: ファイルの写し（ローカル表示）' : '文章: この週の文章はまだありません';
  if (!meta) return hasNotes ? '文章: 版の記録なし' : '文章: この週の文章はまだDBにありません';
  if (meta.status === 'approved') return `文章: 承認済み（版 ${meta.revision}）・承認 ${memberName(b, meta.approved_by)}・${fmtDateTime(meta.approved_at)}`;
  return `文章: 下書き（版 ${meta.revision}）・最終保存 ${memberName(b, meta.updated_by)}・${fmtDateTime(meta.updated_at)}`;
}

export function notesPanel(cx, ix, week, eps) {
  const wk = week.week_number;
  const card = h('section', { id: 'sec-notes', class: 'card notes-panel' });
  const draw = () => {
    const b = cx.bundle();
    const meta = cx.writable ? notesMetaFor(b, wk) : null;
    const notes = ix.notes[String(wk)] || null;
    const caps = capabilities(cx, { weekRow: week, notesMeta: meta });
    const flash = takeFlash(cx, `notes:${wk}`);
    const editing = cx.editing && cx.editing.week === wk;
    const status = h('p', { class: `ne-status ${meta?.status === 'approved' ? 'approved' : meta ? 'draft' : ''}`.trim() }, notesStatusText(cx, meta, !!notes));
    const msg = h('div', { class: 'ne-msg', 'aria-live': 'polite' }, flash ? (flash.error ? errorBox(cx, flash.error) : okBox(flash.text)) : null);

    const actions = h('div', { class: 'ne-actions-top' });
    if (!cx.writable) {
      actions.append(h('p', { class: 'cx-off' }, `✏️ 文章の編集と承認 — ${LOCAL_ONLY}`));
    } else {
      // 「文章を編集」は editor 以上、「この週を承認」は owner だけに出す（viewer には出さない）
      const editorUp = roleAtLeast(cx.role, 'editor');
      if (!editing && editorUp) {
        const editBtn = h('button', { type: 'button', class: 'btn', disabled: caps.canEditNotes ? null : true, onclick: () => openEditor(cx, ix, week, eps) }, '文章を編集');
        actions.append(editBtn);
      }
      if (caps.showApprove && !editing) {
        const apBtn = h('button', { type: 'button', class: 'btn primary', disabled: caps.canApprove ? null : true, onclick: () => confirmApprove() }, 'この週を承認');
        actions.append(apBtn);
      }
      const reason = !editing && editorUp && (!caps.canEditNotes ? caps.reasons.edit : (caps.showApprove && !caps.canApprove ? caps.reasons.approve : null));
      if (reason) actions.append(h('p', { class: 'cx-detail' }, reason));
    }
    const confirmBox = h('div', { class: 'ne-confirm' });
    const confirmApprove = () => {
      const m = notesMetaFor(cx.bundle(), wk);
      const yes = h('button', { type: 'button', class: 'btn primary' }, '承認する');
      const no = h('button', { type: 'button', class: 'btn', onclick: () => confirmBox.replaceChildren() }, 'やめる');
      yes.addEventListener('click', async () => {
        if (yes.disabled) return;
        busy(yes, true, '承認中…'); no.disabled = true;
        const r = await cx.collab.approveWeek(wk);
        busy(yes, false); no.disabled = false;
        if (r.ok) {
          cx.flash.set(`notes:${wk}`, { text: r.alreadyApproved ? `W${wk} はすでに承認済みでした（版 ${r.data.revision}）。` : `W${wk} の文章を承認しました（版 ${r.data.revision}）。` });
          cx.rerender({ focus: 'sec-notes' });
        } else {
          confirmBox.replaceChildren(errorBox(cx, r.error));
        }
      });
      confirmBox.replaceChildren(h('div', { class: 'cx-msg warn', role: 'group', 'aria-label': '承認の確認' },
        h('p', { class: 'cx-msg-main' }, `W${wk} の文章（版 ${m?.revision ?? '?'}）を承認します。`),
        h('p', { class: 'cx-detail' }, '承認すると、オーナー以外はこの週の文章を直せなくなります。数値の承認（weekly_snapshots）とは別です。'),
        h('div', { class: 'cx-row' }, yes, no)));
      yes.focus();
    };

    clear(card).append(...[
      h('header', { class: 'sec-head' }, h('p', { class: 'kicker' }, '週の文章'), h('h2', null, `W${wk} の文章と承認`),
        h('p', { class: 'sub' }, '見出し・示唆・次アクションなどの文章（notes）。数値はDBから出すので、ここでは編集しません。')),
      status,
      cx.writable && cx.viewer ? h('p', { class: 'cx-detail' }, `ログイン中: ${cx.viewer.display_name || cx.viewer.email}（${roleLabel(cx.viewer.role)}）`) : null,
      actions, confirmBox, msg,
      editing ? notesEditor(cx, ix, week, eps, draw) : null].filter(Boolean));
  };
  card.redraw = draw;
  draw();
  return card;
}

function openEditor(cx, ix, week, eps) {
  const wk = week.week_number;
  const b = cx.bundle();
  const existing = ix.notes[String(wk)] || null;
  const base = existing || newWeekNotes(wk, {
    episodes: eps.map(n => {
      const e = ix.epByNum.get(n);
      return { num: n, shortTitle: shortTitle(ix, n).text || null, title: e?.title || null, date: e ? (jstDate(e.published_at) || '').replace(/-/g, '.') : null };
    }),
    dbGeneratedAt: b?.db?.generated_at || null,
    writtenBy: cx.viewer?.display_name || cx.viewer?.email || null,
  });
  cx.editing = { week: wk, base, isNew: !existing, model: editableModel(base, eps), dirty: false };
  cx.rerender({ focus: 'sec-notes' });
}

function markDirty(cx) {
  if (cx.editing && !cx.editing.dirty) { cx.editing.dirty = true; cx.setDirty?.(true); }
}

function textField(cx, label, obj, key, { multiline = false, rows = 3, hint = null, small = false } = {}) {
  const id = nextId('ne');
  const input = multiline
    ? h('textarea', { id, rows, class: small ? 'small' : null })
    : h('input', { id, type: 'text', class: small ? 'small' : null, autocomplete: 'off' });
  input.value = obj[key] ?? '';
  input.addEventListener('input', () => { obj[key] = input.value; markDirty(cx); });
  return h('div', { class: `ne-field ${small ? 'small' : ''}`.trim() },
    h('label', { for: id }, label), input, hint ? h('p', { class: 'ne-hint' }, hint) : null);
}

// 並びの欄（項目を足す・消す）
function listField(cx, title, arr, make, render) {
  const box = h('div', { class: 'ne-list' });
  const draw = () => {
    clear(box).append(
      h('p', { class: 'ne-list-title' }, `${title}（${arr.length}）`),
      ...arr.map((item, i) => h('div', { class: 'ne-item' },
        h('div', { class: 'ne-item-head' }, h('span', null, `${i + 1}`),
          h('button', { type: 'button', class: 'btn small', 'aria-label': `${title}の${i + 1}番目を消す`, onclick: () => { arr.splice(i, 1); markDirty(cx); draw(); } }, '消す')),
        render(item, i, arr))),
      h('button', { type: 'button', class: 'btn small', onclick: () => { arr.push(make()); markDirty(cx); draw(); } }, `＋ ${title}を足す`));
  };
  draw();
  return box;
}

function notesEditor(cx, ix, week, eps, redrawPanel) {
  const wk = week.week_number;
  const ed = cx.editing;
  const m = ed.model;
  const meta = notesMetaFor(cx.bundle(), wk);
  const epName = n => epLabel(ix, n);

  const save = h('button', { type: 'submit', class: 'btn primary' }, '保存');
  const cancel = h('button', { type: 'button', class: 'btn' }, 'やめる');
  const msg = h('div', { class: 'ne-msg', 'aria-live': 'polite' });

  cancel.addEventListener('click', () => {
    if (ed.dirty && !window.confirm('保存していない変更があります。破棄して閉じますか？')) return;
    cx.editing = null; cx.setDirty?.(false);
    redrawPanel();
  });

  const form = h('form', {
    class: 'ne-form',
    onsubmit: async ev => {
      ev.preventDefault();
      if (save.disabled) return;
      const next = applyModel(ed.base, m);
      if (sameJson(next, ed.base)) {
        msg.replaceChildren(okBox(ed.isNew ? 'まだ何も書かれていません。書いてから保存してください。' : '変更がありません（保存しませんでした）。'));
        return;
      }
      busy(save, true, '保存中…'); cancel.disabled = true; form.setAttribute('aria-busy', 'true');
      const r = await cx.collab.saveNotes(wk, next);
      busy(save, false); cancel.disabled = false; form.removeAttribute('aria-busy');
      if (r.ok) {
        cx.editing = null; cx.setDirty?.(false);
        cx.flash.set(`notes:${wk}`, { text: r.unchanged ? '中身がDBの版と同じだったため、書き込みませんでした。' : `保存しました（版 ${r.data.revision}・下書き）。${meta?.status === 'approved' ? '承認は外れました。' : ''}` });
        cx.rerender({ focus: 'sec-notes' });
      } else {
        msg.replaceChildren(errorBox(cx, r.error, { reloadLabel: '読み直す（書きかけの文章は消えます）' }));
      }
    },
  },
  meta?.status === 'approved' ? h('div', { class: 'cx-msg warn' }, h('p', { class: 'cx-msg-main' }, '承認済みの週です。保存すると承認が外れて下書きに戻ります（承認した版は履歴に残ります）。')) : null,
  ed.isNew ? h('div', { class: 'cx-msg warn' }, h('p', { class: 'cx-msg-main' }, 'この週の文章はまだありません。雛形（tools/new_week_notes.py と同じ形）から書き始めます。')) : null,

  h('fieldset', null, h('legend', null, 'サマリー'),
    textField(cx, 'タイトル', m.summary, 'title', { hint: '空のときは「W〇〇 エグゼクティブサマリー」と表示' }),
    textField(cx, 'サブタイトル', m.summary, 'subtitle'),
    listField(cx, '項目', m.summary.items, () => ({ icon: '', head: '', body: '' }), it => [
      textField(cx, 'アイコン', it, 'icon', { small: true }),
      textField(cx, '見出し', it, 'head'),
      textField(cx, '本文', it, 'body', { multiline: true, rows: 3 })]),
    textField(cx, '下の注記（footer）', m.summary, 'footer', { multiline: true, rows: 2 })),

  h('fieldset', null, h('legend', null, '各回の初週（示唆）'),
    m.episodes.length ? m.episodes.map(e => textField(cx, epName(e.episode_number), e, 'insight', { multiline: true, rows: 4 })) : h('p', { class: 'ne-hint' }, 'この週の回がありません')),

  h('fieldset', null, h('legend', null, 'リテンション（型ラベルと分析）'),
    m.retention.length ? m.retention.map(r => h('div', { class: 'ne-group' },
      h('p', { class: 'ne-group-title' }, epName(r.episode_number)),
      textField(cx, '型ラベル', r, 'type_label', { hint: '週次PPTXの型ラベルの言い方に合わせる（汎用の分類を当てない）' }),
      textField(cx, '分析', r, 'insight', { multiline: true, rows: 4 }))) : h('p', { class: 'ne-hint' }, 'この週の回がありません')),

  h('fieldset', null, h('legend', null, '崖と対話'),
    textField(cx, '対話メトリクスの注記（dialog_note）', m.cliffs, 'dialog_note', { multiline: true, rows: 2 }),
    textField(cx, '示唆', m.cliffs, 'insight', { multiline: true, rows: 4 })),

  h('fieldset', null, h('legend', null, '回遊'),
    textField(cx, '示唆', m.kaiyu, 'insight', { multiline: true, rows: 4 })),

  h('fieldset', null, h('legend', null, '示唆と次アクション'),
    textField(cx, 'タイトル', m.wrap, 'title'),
    textField(cx, 'サブタイトル', m.wrap, 'subtitle'),
    // 良かった点は文字列の並び（配列の添字にそのまま書く）
    listField(cx, '良かった点', m.wrap.positives, () => '', (_, i, arr) => textField(cx, '内容', arr, i, { multiline: true, rows: 2 })),
    listField(cx, '課題', m.wrap.issues, () => ({ head: '', body: '' }), it => [
      textField(cx, '見出し', it, 'head'),
      textField(cx, '本文', it, 'body', { multiline: true, rows: 3 })]),
    listField(cx, '来週やること', m.wrap.nexts, () => ({ num: '', title: '', detail: '' }), it => [
      textField(cx, '番号', it, 'num', { small: true }),
      textField(cx, '見出し', it, 'title'),
      textField(cx, '内容', it, 'detail', { multiline: true, rows: 3 })]),
    textField(cx, '締めの一文（closing）', m.wrap, 'closing', { multiline: true, rows: 2 }),
    textField(cx, '下の注記（footer）', m.wrap, 'footer', { multiline: true, rows: 2 })),

  h('div', { class: 'ne-bar' },
    h('div', { class: 'cx-row' }, save, cancel,
      h('span', { class: 'ne-hint' }, `保存先: W${wk}・${meta ? `版 ${meta.revision} の続き` : '新規'}`)),
    msg));
  return form;
}

// ── Apple の初週の手入力（再生・平均消費率） ─────────────────────────
// 再生（公開日からUTC 7日の日別）と平均消費率（全期間）は別々に送れる（片方だけでもよい）
const chipTextOf = v => (v.show === 'approved' ? (v.pending ? '承認済みあり・未承認の手入力あり' : '承認済みの値あり') : v.show === 'manual' ? '手入力（未承認）あり' : '未入力');
const chipClassOf = v => (v.show === 'none' ? 'warn' : v.show === 'manual' ? 'gold' : 'muted');

export function appleEntry(cx, ix, n) {
  const id = `apple-entry-${n}`;
  if (!cx?.writable) return h('p', { class: 'cx-off ap-off' }, `🍎 Appleの初週（再生・平均消費率）を入力 — ${LOCAL_ONLY}`);
  const caps = capabilities(cx);
  if (!caps.showApple) return null;   // viewer には出さない
  const b = cx.bundle();
  const ep = ix.epByNum.get(n) || null;
  const win = appleWindow(ep);
  const inputs = appleInputsFor(b, n);
  const fwApple = firstWeekFor(ix, n).apple;
  const view = appleFirstWeekView(fwApple.main, inputs);
  const cInputs = appleInputsFor(b, n, APPLE_CONSUME);
  const cView = appleConsumeView([fwApple.main, ...fwApple.others], cInputs);
  const flash = takeFlash(cx, `apple:${n}`);
  const cFlash = takeFlash(cx, `apple-consume:${n}`);

  const details = h('details', { class: 'ap-entry', id, open: flash || cFlash ? true : null },
    h('summary', null, '🍎 Appleの初週を入力',
      h('span', { class: `chip ${chipClassOf(view)}` }, `再生: ${chipTextOf(view)}`),
      h('span', { class: `chip ${chipClassOf(cView)}` }, `平均消費率: ${chipTextOf(cView)}`)));

  if (!win) {
    details.append(h('p', { class: 'missing-block' }, `EP#${n} の公開日（episodes.published_at）が未登録のため、初週の7日間が決まりません。回の登録が先です。`));
    return details;
  }

  const today = todayUtc();
  const prefill = view.pending?.daily_values || [];
  const inputsEls = win.dates.map((d, i) => {
    const el = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', id: `${id}-d${i}`, class: 'ap-day', 'aria-describedby': `${id}-total` });
    if (prefill[i] !== undefined && prefill[i] !== null) el.value = String(prefill[i]);
    return el;
  });
  const total = h('p', { class: 'ap-total', id: `${id}-total`, 'aria-live': 'polite' });
  const note = h('textarea', { id: `${id}-note`, rows: 2, placeholder: '例: トレンドタブ・再生回数・エピソード別・過去60日・この回のみ。窓の後の日まで足した合計と一覧の「今期間」が一致' });
  if (view.pending?.source_note) note.value = view.pending.source_note;
  const cautionBox = h('div', { class: 'ap-cautions' });
  const errBox = h('div', { class: 'ap-errors', 'aria-live': 'polite' });
  const send = h('button', { type: 'submit', class: 'btn primary' }, 'Appleの初週を送る');
  const msg = h('div', { class: 'ap-msg', 'aria-live': 'polite' },
    flash ? (flash.error ? errorBox(cx, flash.error) : okBox(flash.text, flash.extra || [])) : null);

  const recalc = (showErrors = false) => {
    const v = validateAppleForm({ window: win, values: inputsEls.map(x => x.value), note: note.value, today });
    const filled = inputsEls.filter(x => normalizeDigits(x.value) !== '').length;
    total.textContent = v.total !== null
      ? `合計（自動）: ${fmtInt(v.total)}`
      : `合計（自動）: —（7日分そろっていません。入力 ${filled}/7日）`;
    const bad = new Set(v.errors.filter(e => e.field === 'day' && (showErrors || normalizeDigits(inputsEls[e.index].value) !== '')).map(e => e.index));
    inputsEls.forEach((el, i) => { if (bad.has(i)) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); });
    cautionBox.replaceChildren(...v.cautions.map(c => h('p', { class: 'pf-caution' }, c)));
    const shown = showErrors ? v.errors : v.errors.filter(e => e.field !== 'day' || bad.has(e.index));
    errBox.replaceChildren(...(shown.length ? [h('ul', { class: 'cx-list error' }, shown.map(e => h('li', null, e.message)))] : []));
    return v;
  };
  inputsEls.forEach(el => el.addEventListener('input', () => recalc(false)));
  note.addEventListener('input', () => recalc(false));

  const form = h('form', {
    class: 'ap-form', novalidate: true,
    onsubmit: async ev => {
      ev.preventDefault();
      if (send.disabled) return;
      const v = recalc(true);
      if (!v.ok) { msg.replaceChildren(); const first = inputsEls.find(x => x.getAttribute('aria-invalid') === 'true'); (first || send).focus(); return; }
      busy(send, true); form.setAttribute('aria-busy', 'true');
      inputsEls.forEach(x => { x.readOnly = true; }); note.readOnly = true;
      const r = await cx.collab.submitApple({ episode_number: n, window: win, values: inputsEls.map(x => x.value), note: note.value, today });
      busy(send, false); form.removeAttribute('aria-busy');
      inputsEls.forEach(x => { x.readOnly = false; }); note.readOnly = false;
      if (r.ok) {
        const extra = [...r.warnings.map(w => `確認: ${w.message}`)];
        if (r.withdrawn.length) extra.push(`前の未承認の入力（受付ID ${r.withdrawn.join('・')}）は、入れ直しのため取り下げになりました。`);
        if (r.reloadError) extra.push(r.reloadError);
        cx.flash.set(`apple:${n}`, { text: `送信しました（受付ID ${r.data.id}・合計 ${fmtInt(r.data.value)}・${APPLE_STATUS_JA[r.data.status] || r.data.status}）。承認されるまでは「手入力（未承認）」と表示します。`, extra });
        cx.rerender({ focus: id });
      } else {
        msg.replaceChildren(errorBox(cx, r.error));
      }
    },
  },
  h('h4', { class: 'ap-sub' }, '初週の再生（公開日からUTC 7日の日別）'),
  h('p', { class: 'ap-window' }, `公開日（UTC）: ${fmtYMD(win.start)} → 初週の窓 UTC ${fmtMD(win.start)}〜${fmtMD(win.end)}（7日間）`),
  view.show === 'approved'
    ? h('p', { class: 'pf-caution' }, `承認済みの値（再生 ${fmtInt(view.approved.plays_or_views)}・${view.approved.data_type === 'first_week' ? '日別合計' : '全期間の値'}）があります。表示はそちらを優先します。入れ直すのは誤りに気づいたときだけ。`)
    : null,
  h('details', { class: 'ap-how' }, h('summary', null, '読み方（Apple Podcasts Connect）'),
    h('ol', null,
      h('li', null, 'トレンドタブを開き、指標「再生回数」と「エピソード別」を選ぶ。期間は「過去60日」（週の表示は月〜日区切りで窓と合わないので使わない）。'),
      h('li', null, '一覧でこの回だけにチェックを入れ、折れ線の点にカーソルを合わせて、下の7日（UTCの日付）の値を読む。'),
      h('li', null, '読めない日は推測で埋めない（7日分そろうまで送らない）。値が小さく隠れるときは、ほかの回を重ねると読めることがある。'),
      h('li', null, 'Appleは最大72時間遅れる。7日目から72時間たった後（月曜の確定セッション）に入れると確実。'))),
  h('div', { class: 'ap-days' }, win.dates.map((d, i) => h('div', { class: 'ap-day-cell' },
    h('label', { for: inputsEls[i].id }, `${fmtMD(d)}`, h('span', { class: 'ap-dn' }, `${i + 1}日目`)), inputsEls[i]))),
  total, errBox, cautionBox,
  h('div', { class: 'ne-field' }, h('label', { for: note.id }, '出典メモ（任意・1000文字まで）'), note),
  h('div', { class: 'cx-row' }, send, h('span', { class: 'ne-hint' }, '受付台帳に入るだけで、正本（DBの初週）には承認後に入ります。')),
  msg);
  details.append(...[form, appleHistory(b, inputs), ...consumeForm(cx, ep, n, cView, cInputs, cFlash)].filter(Boolean));
  recalc(false);
  return details;
}

// 平均消費率（全期間）の入力。読んだ日（UTC）を選び、期間は公開日（UTC）〜読んだ日として送る
function consumeForm(cx, ep, n, view, inputs, flash) {
  const b = cx.bundle();
  const id = `apple-consume-${n}`;
  const today = todayUtc();
  const pub = utcDate(ep.published_at);
  const day7 = addDays(pub, 6);
  const pct = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', id: `${id}-v`, class: 'ap-day ap-pct', placeholder: '例: 47.5', 'aria-describedby': `${id}-period` });
  const date = h('input', { type: 'date', id: `${id}-d`, class: 'ap-day ap-date', min: pub, max: today, value: today, 'aria-describedby': `${id}-period` });
  const period = h('p', { class: 'ap-total', id: `${id}-period`, 'aria-live': 'polite' });
  const note = h('textarea', { id: `${id}-note`, rows: 2, placeholder: '例: エピソード個別ページ・全期間の平均消費率。配信9日目に読んだ' });
  const cautionBox = h('div', { class: 'ap-cautions' });
  const errBox = h('div', { class: 'ap-errors', 'aria-live': 'polite' });
  const send = h('button', { type: 'submit', class: 'btn primary' }, 'Appleの平均消費率を送る');
  const msg = h('div', { class: 'ap-msg', 'aria-live': 'polite' },
    flash ? (flash.error ? errorBox(cx, flash.error) : okBox(flash.text, flash.extra || [])) : null);

  const recalc = (showErrors = false) => {
    const v = validateConsumeForm({ episode: ep, value: pct.value, readDate: date.value, note: note.value, today });
    const d = String(date.value || '').trim();
    period.textContent = v.ok
      ? `送る値: ${fmtConsume(v.value)}（UTC ${fmtMD(pub)}〜${fmtMD(v.readDate)} の全期間）`
      : `期間: UTC ${fmtMD(pub)}（公開日）〜${/^\d{4}-\d{2}-\d{2}$/.test(d) ? fmtMD(d) : '読んだ日'}（読んだ日）の全期間`;
    const filledV = normalizePct(pct.value) !== '', filledD = d !== '';
    const shown = v.errors.filter(e => showErrors || (e.field === 'value' && filledV) || (e.field === 'date' && filledD) || e.field === 'note' || e.field === 'window');
    const badV = shown.some(e => e.field === 'value'), badD = shown.some(e => e.field === 'date');
    if (badV) pct.setAttribute('aria-invalid', 'true'); else pct.removeAttribute('aria-invalid');
    if (badD) date.setAttribute('aria-invalid', 'true'); else date.removeAttribute('aria-invalid');
    cautionBox.replaceChildren(...v.cautions.map(c => h('p', { class: 'pf-caution' }, c)));
    errBox.replaceChildren(...(shown.length ? [h('ul', { class: 'cx-list error' }, shown.map(e => h('li', null, e.message)))] : []));
    return v;
  };
  for (const el of [pct, date, note]) el.addEventListener('input', () => recalc(false));
  date.addEventListener('change', () => recalc(false));

  const form = h('form', {
    class: 'ap-form ap-consume', novalidate: true,
    onsubmit: async ev => {
      ev.preventDefault();
      if (send.disabled) return;
      const v = recalc(true);
      if (!v.ok) { msg.replaceChildren(); ([pct, date].find(x => x.getAttribute('aria-invalid') === 'true') || send).focus(); return; }
      busy(send, true); form.setAttribute('aria-busy', 'true');
      for (const el of [pct, date, note]) el.readOnly = true;
      const r = await cx.collab.submitAppleConsume({ episode_number: n, episode: ep, value: pct.value, readDate: date.value, note: note.value, today });
      busy(send, false); form.removeAttribute('aria-busy');
      for (const el of [pct, date, note]) el.readOnly = false;
      if (r.ok) {
        const extra = [...(r.cautions || []).map(c => `注意: ${c}`), ...r.warnings.map(w => `確認: ${w.message}`)];
        if (r.withdrawn.length) extra.push(`同じ読んだ日の前の未承認の入力（受付ID ${r.withdrawn.join('・')}）は、入れ直しのため取り下げになりました。`);
        if (r.reloadError) extra.push(r.reloadError);
        cx.flash.set(`apple-consume:${n}`, { text: `送信しました（受付ID ${r.data.id}・平均消費率 ${fmtConsume(r.data.value)}・${consumeAsOfLabel(r.data)}（UTC）・${APPLE_STATUS_JA[r.data.status] || r.data.status}）。承認されるまでは「手入力（未承認）」と表示します。`, extra });
        cx.rerender({ focus: `apple-entry-${n}` });
      } else {
        msg.replaceChildren(errorBox(cx, r.error));
      }
    },
  },
  h('h4', { class: 'ap-sub' }, '平均消費率（全期間）'),
  h('p', { class: 'ap-window' }, `配信7日目（UTC ${fmtMD(day7)}）以降に、エピソード個別ページの全期間の平均消費率を読む`),
  view.show === 'approved'
    ? h('p', { class: 'pf-caution' }, `承認済みの値（平均消費率 ${fmtConsume(view.approved.consume_pct)}）があります。表示はそちらを優先します。入れ直すのは誤りに気づいたときだけ。`)
    : null,
  h('details', { class: 'ap-how' }, h('summary', null, '読み方（Apple Podcasts Connect）'),
    h('ol', null,
      h('li', null, 'この回のエピソード個別ページを開き、期間を全期間にして「平均消費率」（%）を読む。'),
      h('li', null, 'エピソード一覧の値は使わない（期間の取り方が違う）。'),
      h('li', null, `配信7日目（UTC ${fmtMD(day7)}）以降に読む。読んだ日（UTC）を下で選ぶ。日本時間の朝9時より前は、UTCではまだ前の日。`),
      h('li', null, '小数があれば1桁まで入れる。読めないときは推測で埋めない（送らない）。'))),
  h('div', { class: 'ap-consume-row' },
    h('div', { class: 'ap-day-cell' }, h('label', { for: pct.id }, '平均消費率（%）', h('span', { class: 'ap-dn' }, '0〜100・小数1桁まで')), pct),
    h('div', { class: 'ap-day-cell' }, h('label', { for: date.id }, '読んだ日（UTC）', h('span', { class: 'ap-dn' }, `既定は今日（UTC ${fmtMD(today)}）`)), date)),
  period, errBox, cautionBox,
  h('div', { class: 'ne-field' }, h('label', { for: note.id }, '出典メモ（任意・1000文字まで）'), note),
  h('div', { class: 'cx-row' }, send, h('span', { class: 'ne-hint' }, '再生とは別に送ります（片方だけでもよい）。受付台帳に入るだけで、正本（DBの初週）には承認後に入ります。')),
  msg);
  recalc(false);
  return [form, consumeHistory(b, inputs)];
}

function consumeHistory(b, inputs) {
  if (!inputs.length) return null;
  return h('div', { class: 'ap-history' }, h('p', { class: 'ne-list-title' }, 'これまでの入力（平均消費率）'),
    h('ul', null, inputs.map(r => h('li', { class: `ap-h-${r.status}` },
      `${fmtDateTime(r.entered_at)}・${memberName(b, r.entered_by)}・平均消費率 ${fmtConsume(r.value)}（${consumeAsOfLabel(r)}）`,
      `・${APPLE_STATUS_JA[r.status] || r.status}`,
      r.review_note ? `・${r.review_note}` : ''))));
}

function appleHistory(b, inputs) {
  if (!inputs.length) return null;
  return h('div', { class: 'ap-history' }, h('p', { class: 'ne-list-title' }, 'これまでの入力（初週の再生）'),
    h('ul', null, inputs.map(r => h('li', { class: `ap-h-${r.status}` },
      `${fmtDateTime(r.entered_at)}・${memberName(b, r.entered_by)}・合計 ${fmtInt(r.value)}`,
      Array.isArray(r.daily_values) ? `（日別 ${r.daily_values.join('・')}）` : '（日別なし）',
      `・${APPLE_STATUS_JA[r.status] || r.status}`,
      r.review_note ? `・${r.review_note}` : ''))));
}

