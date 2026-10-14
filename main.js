// BIBLIO JAM レポートダッシュボード v1：起動とハッシュルーティング
import { loadBundle, SetupError, LoginRequired, sendMagicLink, signInWithGoogle, signOut, currentMode } from './datasource.js';

// 手元（localhost）で開いたときだけ、ローカルデータへの切り替えリンクを出す
const LOCAL_PREVIEW = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);
import { indexBundle, isSample } from './lib/metrics.js';
import { h, clear, initTooltips } from './lib/dom.js';
import { fmtDateTime } from './lib/format.js';
import { destroyCharts } from './lib/charts.js';
import { renderWeek } from './views/week.js';
import { renderTrends } from './views/trends.js';
import { renderEpisodes } from './views/episodes.js';
import { renderEpisode } from './views/episode.js';
import { renderStatus } from './views/status.js';
import { renderMonth, renderMonths } from './views/month.js';
import { createCollab, collabContext, roleLabel, ROLES } from './lib/collab.js';

const app = document.getElementById('app');
const state = { ix: null, meta: null, client: null, cx: null };

// 書き込み機能の文脈（views/collab.js が使う）。ローカル表示では writable=false
function makeCx() {
  const base = collabContext(state.ix.bundle, state.meta);
  const cx = {
    ...base,
    flash: state.cx?.flash || new Map(),
    editing: null,
    bundle: () => state.ix.bundle,
    ix: () => state.ix,
    rerender: opts => route({ keepScroll: true, ...(opts || {}) }),
    refreshData,
    // 読み直し：書きかけの編集は捨てる（古い版の上に書き戻さない）
    reload: async () => {
      cx.editing = null; cx.setDirty(false);
      try { await refreshData(); } catch (e) { showLoadError(e); return; }
      route({ keepScroll: true });
    },
    relogin: async () => { await signOut().catch(() => {}); location.reload(); },
    setDirty: on => { window.onbeforeunload = on ? e => { e.preventDefault(); e.returnValue = ''; return ''; } : null; },
  };
  cx.collab = createCollab({ client: base.writable ? state.client : null, getBundle: () => state.ix.bundle, reload: refreshData });
  return cx;
}

// bundle を読み直す（Apple の送信後など）。画面の描き直しは呼び出し側
async function refreshData() {
  const { bundle, meta, client } = await loadBundle();
  state.ix = indexBundle(bundle);
  state.meta = meta;
  state.client = client || null;
  // client は同じもの（supabase-js の client・擬似RPC はどちらも使い回し）。権限などの文脈だけ更新する
  Object.assign(state.cx, collabContext(bundle, meta));
}

const NAV = [
  ['week', '週次レポート'],
  ['month', '月次'],
  ['trends', '推移'],
  ['episodes', '回'],
  ['status', 'データの状態'],
];

function fixtureWeeks() {
  return state.ix.weeks.filter(w => String(w.notes || '').startsWith('fixture')).map(w => w.week_number);
}

function shell() {
  clear(app);
  const sample = state.meta.sample || isSample(state.ix.bundle);
  const header = h('header', { class: 'top' },
    h('div', { class: 'top-in' },
      h('a', { class: 'brand', href: '#/week' }, h('span', { class: 'logo-b' }, 'BIBLIO'), h('span', { class: 'logo-j' }, ' JAM'), h('span', { class: 'brand-sub' }, 'レポート')),
      h('nav', { class: 'nav', 'aria-label': '画面' }, NAV.map(([k, t]) => h('a', { href: `#/${k}`, 'data-nav': k }, t))),
      state.cx?.writable && state.cx.viewer ? h('span', { class: 'who', title: state.cx.viewer.email || '' }, `${state.cx.viewer.display_name || state.cx.viewer.email}・${roleLabel(state.cx.viewer.role)}`) : null,
      state.meta.mode === 'remote' ? h('button', { type: 'button', class: 'btn small ghost', onclick: async () => { await signOut(); location.reload(); } }, 'ログアウト') : null));
  const mockBanner = state.meta.mode === 'mock'
    ? h('div', { class: 'banner mock', role: 'note' },
      h('strong', null, '擬似RPC（?mode=mock）'),
      ' 手元の画面確認用です。書き込みはメモリだけで、DBには送りません（ページを再読み込みすると消えます）。権限を切り替える: ',
      ROLES.map((r, i) => [i ? '・' : '', h('a', { href: `${location.pathname}?mode=mock&role=${r}${location.hash}` }, roleLabel(r))]))
    : null;
  const banner = sample
    ? h('div', { class: 'banner sample', role: 'note' },
      h('strong', null, 'サンプルデータ'),
      ` を表示しています（${state.meta.path}）。本物の app/data/bundle.json が置かれると自動でそちらを読みます。`,
      fixtureWeeks().length ? `${fixtureWeeks().map(n => 'W' + n).join('・')}は暫定表示の確認用の架空の行です。` : '')
    : null;
  const view = h('main', { id: 'view', class: 'view', tabindex: '-1' });
  const foot = h('footer', { class: 'foot' },
    h('p', null, `データ: ${state.meta.path}　|　bundle生成: ${state.ix.bundle.built_at ? fmtDateTime(state.ix.bundle.built_at) : '記録なし'}　|　DB書き出し: ${state.ix.db.generated_at ? fmtDateTime(state.ix.db.generated_at) : '記録なし'}`),
    h('p', null, '数値の正本は Supabase（bibliojam-analytics / private）。画面は値を書き写さず、bundle の値をそのまま表示しています。数値にカーソルを合わせる（タップする）と出典が出ます。'));
  app.append(...[header, mockBanner, banner, view, foot].filter(Boolean));
}

function route({ keepScroll = false, focus = null } = {}) {
  if (!state.ix) return;
  const y = window.scrollY;
  destroyCharts();
  const view = document.getElementById('view');
  clear(view);
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const page = parts[0] || 'week';
  const navKey = page === 'episode' ? 'episodes' : page === 'months' ? 'month' : page;
  for (const a of document.querySelectorAll('[data-nav]')) a.classList.toggle('on', a.dataset.nav === navKey);
  try {
    if (page === 'week') { renderWeek(view, state.ix, parts[1], state.cx); document.title = `BIBLIO JAM 週次レポート${parts[1] ? ' W' + parts[1] : ''}`; }
    else if (page === 'month') { renderMonth(view, state.ix, parts[1]); document.title = `BIBLIO JAM 月次レポート${parts[1] ? ' ' + parts[1] : ''}`; }
    else if (page === 'months') { renderMonths(view, state.ix); document.title = 'BIBLIO JAM 月次の一覧'; }
    else if (page === 'trends') { renderTrends(view, state.ix); document.title = 'BIBLIO JAM 推移'; }
    else if (page === 'episodes') { renderEpisodes(view, state.ix); document.title = 'BIBLIO JAM 回の一覧'; }
    else if (page === 'episode') { renderEpisode(view, state.ix, parts[1], state.cx); document.title = `BIBLIO JAM EP#${parts[1]}`; }
    else if (page === 'status') { renderStatus(view, state.ix, state.meta); document.title = 'BIBLIO JAM データの状態'; }
    else { location.replace('#/week'); return; }
  } catch (e) {
    console.error(e);
    view.append(h('section', { class: 'card error' }, h('h2', null, '表示中にエラーが起きました'), h('pre', null, String(e && e.stack || e))));
  }
  if (!keepScroll) { window.scrollTo(0, 0); return; }
  // 書き込みの後の描き直し：位置を保ち、知らせを出した欄が見えるようにする
  window.scrollTo(0, y);
  if (focus) requestAnimationFrame(() => document.getElementById(focus)?.scrollIntoView({ block: 'nearest' }));
}

function onHashChange() {
  if (state.cx?.editing?.dirty && !window.confirm('保存していない文章があります。移動すると消えます。移動しますか？')) {
    history.replaceState(null, '', state.lastHash || '#/week');
    return;
  }
  if (state.cx) { state.cx.editing = null; state.cx.setDirty(false); }
  state.lastHash = location.hash;
  route();
}

function renderSetup(err) {
  clear(app);
  app.append(h('section', { class: 'card setup' },
    h('p', { class: 'kicker' }, 'BIBLIO JAM レポート'),
    h('h1', null, err.title || '設定が必要です'),
    h('p', null, err.message),
    err.steps?.length ? h('ol', null, err.steps.map(s => h('li', null, s))) : null,
    err.detail ? h('pre', null, err.detail) : null,
    err.action === 'relogin' ? h('p', null, h('button', {
      type: 'button', class: 'btn primary',
      onclick: async () => { await signOut().catch(() => {}); location.reload(); },
    }, 'ログアウトして別のアカウントで入る')) : null,
    currentMode() === 'remote' && LOCAL_PREVIEW ? h('p', null, h('a', { href: `${location.pathname}?mode=local` }, 'ローカルのデータで見る（?mode=local）')) : null));
}

function renderLogin(err) {
  clear(app);
  const methods = err.info?.methods || ['google'];
  const msg = h('p', { class: 'login-msg', role: 'status' });

  const google = methods.includes('google') ? h('button', {
    type: 'button', class: 'btn primary',
    onclick: async () => {
      msg.textContent = 'Googleのログイン画面を開いています…';
      try { await signInWithGoogle(err.client); }
      catch (x) { msg.textContent = `開けませんでした：${x.message}`; }
    },
  }, 'Googleでログイン') : null;

  let form = null;
  if (methods.includes('email')) {
    const input = h('input', { type: 'email', id: 'login-email', required: true, autocomplete: 'email', placeholder: 'name@example.com' });
    form = h('form', {
      class: 'login-form',
      onsubmit: async e => {
        e.preventDefault();
        msg.textContent = '送信しています…';
        try { await sendMagicLink(err.client, input.value.trim()); msg.textContent = 'ログイン用のリンクをメールで送りました。メールのリンクを開くと、この画面に戻ってデータが表示されます。'; }
        catch (x) { msg.textContent = `送れませんでした：${x.message}（メンバー一覧に登録されたアドレスか確認してください）`; }
      },
    },
    h('label', { for: 'login-email' }, 'メールアドレス'),
    input,
    h('button', { type: 'submit', class: google ? 'btn ghost' : 'btn primary' }, 'ログインリンクを送る'));
  }

  app.append(h('section', { class: 'card setup' },
    h('p', { class: 'kicker' }, 'BIBLIO JAM レポート'),
    h('h1', null, 'ログイン'),
    err.info?.reason ? h('p', { class: 'login-msg' }, err.info.reason) : null,
    h('p', null, google
      ? '番組メンバーだけが見られます。メンバー一覧に登録したGoogleアカウントでログインしてください。パスワードはこの画面に入力しません。'
      : '番組メンバーだけが見られます。登録済みのメールアドレスに、ログイン用のリンクを送ります。'),
    google, form, msg,
    LOCAL_PREVIEW ? h('p', null, h('a', { href: `${location.pathname}?mode=local` }, 'ローカルのデータで見る（?mode=local）')) : null));
}

function renderFatal(e) {
  clear(app);
  app.append(h('section', { class: 'card error' }, h('h1', null, 'データを読み込めませんでした'), h('p', null, String(e && e.message || e)),
    h('p', null, 'python3 -m http.server で app/ を配信しているか確認してください（file:// では読み込めません）。')));
}

async function boot() {
  initTooltips();
  try {
    const { bundle, meta, client } = await loadBundle();
    state.ix = indexBundle(bundle);
    state.meta = meta;
    state.client = client || null;
    state.cx = makeCx();
    state.lastHash = location.hash;
    shell();
    route();
    window.addEventListener('hashchange', onHashChange);
  } catch (e) {
    showLoadError(e);
  }
}

function showLoadError(e) {
  if (e instanceof LoginRequired) renderLogin(e);
  else if (e instanceof SetupError) renderSetup(e);
  else { console.error(e); renderFatal(e); }
}

boot();
