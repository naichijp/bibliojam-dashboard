// 読み先の切り替え。画面は bundle（CONTRACT.md 5節）を1つ受け取るだけにする。
//   ?mode=local（既定）  … data/bundle.json。無いときだけ ../tests/fixtures/sample_bundle.json（サンプルデータ）
//                           fixture は app/ の外に置く（本番に出さない）。report-dashboard/ を配信して /app/ を開いたときだけ届く
//   ?mode=remote         … config.js の Supabase にログイン（既定はGoogle。config の LOGIN_METHODS で 'email' も足せる）し rpc('dashboard_bundle')
//   ?mode=mock           … 手元の画面確認用の擬似RPC（app/dev/mockrpc.js）。data/bundle.json をもとに、書き込みはメモリだけ。
//                           localhost・127.0.0.1・[::1] のときだけ有効。公開先では無視して remote になる（app/dev/ は公開の一式にも入らない）。
//                           &role=viewer|editor|owner（既定 editor）、&mock_hide_apple=38（その回の Apple 初週 approved を外して手入力の表示を試す）
// ?mode が無いとき：localhost・127.0.0.1 では local、それ以外（公開先）では remote。
// Supabase JS はリモートモードのときだけ読み込む。
// 戻り値の client は書き込みRPC用（remote は supabase-js の client、mock は擬似RPC、local は null）。

export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
// 改ざん検知（SRI）。jsDelivr の公表値と、配信ファイルから計算した値が一致することを 2026-10-14 に確認
export const SUPABASE_JS_INTEGRITY = 'sha256-hZaWX+kY5lZgChtWjToWj1wNPSKmAIhrtvRKZVXbAec=';

export class SetupError extends Error {
  constructor(message, { title = '設定が必要です', steps = [], detail = '', action = null } = {}) {
    super(message);
    this.name = 'SetupError';
    this.title = title;
    this.steps = steps;
    this.detail = detail;
    this.action = action;   // 'relogin' なら画面に「ログアウトして別のアカウントで入る」を出す
  }
}

export class LoginRequired extends Error {
  constructor(client, info) {
    super('ログインが必要です');
    this.name = 'LoginRequired';
    this.client = client;
    this.info = info;
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '']);

export function resolveMode(search, hostname) {
  const local = LOCAL_HOSTS.has(hostname);
  const m = new URLSearchParams(search || '').get('mode');
  if (m === 'remote' || m === 'local') return m;
  if (m === 'mock') return local ? 'mock' : 'remote';   // 擬似RPCは手元だけ。公開先では使わせない
  return local ? 'local' : 'remote';
}

export function currentMode() {
  return resolveMode(location.search, location.hostname);
}

// ログイン後に戻るURL。公開先ではクエリなし、手元で試すときは ?mode=remote を残す
function returnUrl() {
  const q = LOCAL_HOSTS.has(location.hostname) ? '?mode=remote' : '';
  return `${location.origin}${location.pathname}${q}`;
}

export async function loadBundle() {
  const mode = currentMode();
  if (mode === 'remote') return loadRemote();
  if (mode === 'mock') return loadMock();
  return loadLocal();
}

// ── ローカル ────────────────────────────────────────────────────────
async function fetchJson(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path} を読めませんでした（HTTP ${res.status}）`);
  try { return await res.json(); }
  catch (e) { throw new Error(`${path} がJSONとして読めません（${e.message}）`); }
}

async function loadLocal() {
  const real = await fetchJson('data/bundle.json');
  if (real) return { bundle: real, meta: { mode: 'local', path: 'data/bundle.json', sample: real.mode === 'fixture' } };
  // 本物があるときは fixture を読まない
  const sample = await fetchJson('../tests/fixtures/sample_bundle.json').catch(() => null);
  if (sample) return { bundle: sample, meta: { mode: 'local', path: 'tests/fixtures/sample_bundle.json', sample: true } };
  throw new SetupError('表示するデータがありません', {
    title: 'データがありません',
    steps: [
      'tools/build.py で app/data/bundle.json を作る（CONTRACT.md 5節）',
      '開発中のサンプル表示は report-dashboard/ を配信して /app/ を開く（tests/fixtures/sample_bundle.json を読む）',
    ],
  });
}

// ── 擬似RPC（手元の画面確認用。?mode=mock） ─────────────────────────
let mockClient = null;

async function loadMock() {
  if (!LOCAL_HOSTS.has(location.hostname)) throw new SetupError('擬似RPCは手元（localhost）だけで使えます', { title: '?mode=mock は使えません' });
  if (!mockClient) {
    const base = await fetchJson('data/bundle.json');
    if (!base) throw new SetupError('擬似RPCのもとになる data/bundle.json がありません', { title: 'データがありません', steps: ['tools/build.py で app/data/bundle.json を作る'] });
    const { createMockClient } = await import('./dev/mockrpc.js');
    const q = new URLSearchParams(location.search);
    const hideApple = (q.get('mock_hide_apple') || '').split(',').map(Number).filter(Number.isFinite);
    mockClient = createMockClient(base, { role: q.get('role') || 'editor', hideApple });
    window.__bjMock = mockClient.mock;   // コンソールから failNext('revision_conflict') などで失敗を試せる
  }
  const { data, error } = await mockClient.rpc('dashboard_bundle');
  if (error) throw new Error(`擬似RPCが失敗しました: ${error.message}`);
  return { bundle: data, meta: { mode: 'mock', path: 'mock rpc dashboard_bundle()（app/data/bundle.json をもとにした擬似RPC・書き込みはメモリだけ）', sample: false, user: data.viewer?.email || null }, client: mockClient };
}

// ── リモート（Supabase） ─────────────────────────────────────────────
async function readConfig() {
  let cfg;
  try { cfg = await import('./config.js'); }
  catch {
    throw new SetupError('config.js がありません', {
      title: 'リモート表示の設定がまだありません',
      steps: [
        'app/config.example.js を app/config.js にコピーする',
        'SUPABASE_URL と SUPABASE_ANON_KEY（公開用のanonキー）を書く。service_role キーは絶対に書かない',
        'DB側に public.dashboard_bundle() とメンバー一覧が必要（2026-10-14時点で未作成）',
      ],
    });
  }
  const url = (cfg.SUPABASE_URL || '').trim();
  const key = (cfg.SUPABASE_ANON_KEY || '').trim();
  if (!url || !key || url.includes('YOUR-PROJECT') || key.includes('YOUR-ANON-KEY')) {
    throw new SetupError('config.js の値が未設定です', {
      title: 'Supabase の接続先が未設定です',
      steps: ['app/config.js の SUPABASE_URL と SUPABASE_ANON_KEY を書く（いまは見本の値のまま）'],
    });
  }
  const methods = (Array.isArray(cfg.LOGIN_METHODS) ? cfg.LOGIN_METHODS : ['google']).filter(m => m === 'google' || m === 'email');
  return { url, key, rpc: cfg.RPC_NAME || 'dashboard_bundle', methods: methods.length ? methods : ['google'] };
}

function loadScript(src, integrity) {
  return new Promise((resolve, reject) => {
    if (window.supabase && window.supabase.createClient) return resolve();
    const s = document.createElement('script');
    s.src = src;
    if (integrity) s.integrity = integrity;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Supabase JS を読み込めませんでした（ネットワークを確認してください）'));
    document.head.append(s);
  });
}

let client = null;

async function getClient() {
  if (client) return client;
  const cfg = await readConfig();
  await loadScript(SUPABASE_JS, SUPABASE_JS_INTEGRITY);
  client = window.supabase.createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
  client.__rpcName = cfg.rpc;
  client.__loginMethods = cfg.methods;
  return client;
}

function cleanAuthParams() {
  const url = new URL(location.href);
  let changed = false;
  for (const k of ['code', 'error', 'error_code', 'error_description']) {
    if (url.searchParams.has(k)) { url.searchParams.delete(k); changed = true; }
  }
  if (/access_token=|refresh_token=|error_description=/.test(url.hash)) { url.hash = '#/week'; changed = true; }
  if (changed) history.replaceState(null, '', url.toString());
}

async function loadRemote() {
  const sb = await getClient();
  const { data: { session } } = await sb.auth.getSession();
  cleanAuthParams();
  if (!session) throw new LoginRequired(sb, { methods: sb.__loginMethods });
  const { data, error } = await sb.rpc(sb.__rpcName);
  if (error) {
    const msg = `${error.code || ''} ${error.message || ''}`;
    // 関数が無いときは PGRST202。書き込み系の PT404（no_notes_for_week など）と混同しないよう、404 という文字では判定しない
    if (/PGRST202|could not find the function/i.test(msg)) {
      throw new SetupError('dashboard_bundle() がまだありません', {
        title: 'DB側の準備がまだです',
        steps: ['Supabase に public.dashboard_bundle() を作る（sql/bundle_select.sql と同じ本体。適用は内藤さんの承認後）'],
        detail: msg.trim(),
      });
    }
    // RPC はエラーの種類を message に入れて返す（sql/migration_001_dashboard.sql の raise exception）
    if (/not_signed_in|session_revoked|JWT expired|invalid JWT/i.test(msg)) {
      await sb.auth.signOut().catch(() => {});
      throw new LoginRequired(sb, { methods: sb.__loginMethods, reason: 'ログインの有効期限が切れたか、ログアウトされています。もう一度ログインしてください。' });
    }
    if (/not_a_member|provider_not_allowed|member_binding_mismatch/i.test(msg)) {
      throw new SetupError('閲覧の権限がありません', {
        title: 'このアカウントはメンバー一覧にありません',
        steps: [
          `ログイン中のアカウント: ${session.user?.email || '不明'}`,
          '別のGoogleアカウントで入る場合は、下の「ログアウトして別のアカウントで入る」を押す',
          'このアカウントで見る必要がある場合は、番組の管理者にメンバー一覧への追加を頼む',
        ],
        detail: msg.trim(),
        action: 'relogin',
      });
    }
    if (/42501|permission denied/i.test(msg)) {
      throw new SetupError('権限がありません', {
        title: 'データを読む権限がありません',
        steps: ['DB側の権限設定を確認する（docs/APPLY_CHECKLIST_migration_001.md）'],
        detail: msg.trim(),
        action: 'relogin',
      });
    }
    throw new Error(`データを取得できませんでした: ${msg.trim()}`);
  }
  const bundle = typeof data === 'string' ? JSON.parse(data) : data;
  return { bundle, meta: { mode: 'remote', path: `rpc ${sb.__rpcName}()`, sample: false, user: session.user?.email || null }, client: sb };
}

// Googleでログイン。戻り先は Supabase の Redirect URLs に登録したものだけが使える
export async function signInWithGoogle(sb) {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnUrl() } });
  if (error) throw new Error(error.message || 'Googleのログイン画面を開けませんでした');
}

// メールのリンク。Supabase標準のメール送信はTeamメンバーにしか届かないので、使うならカスタムSMTPが要る（docs/AUTH_AND_HOSTING.md）
export async function sendMagicLink(sb, email) {
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: returnUrl(), shouldCreateUser: false } });
  if (error) throw new Error(error.message || 'ログインリンクを送れませんでした');
}

export async function signOut() {
  if (client) await client.auth.signOut();
}
