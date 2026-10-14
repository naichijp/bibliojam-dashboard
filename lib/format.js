// 表示用の整形（DOMに依存しない）。未取得は 0 にせず「未取得」と出す。
import { num, round, weekdayJa } from './metrics.js';
// 丸めは metrics.round（四捨五入）を通してから桁をそろえる。toFixed だけに任せない。

export const MISSING = '未取得';

export function fmtInt(v) {
  const n = round(v, 0);
  return n === null ? MISSING : n.toLocaleString('en-US');
}

export function fmtNum(v, digits = 1) {
  const n = round(v, digits);
  if (n === null) return MISSING;
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// DBの小数をそのまま（末尾0は落とす）
export function fmtPlain(v) {
  const n = round(v, 2);
  return n === null ? MISSING : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function fmtHours(v) {
  const n = round(v, 2);
  return n === null ? MISSING : `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}h`;
}

export function fmtPct(v, digits = 0) {
  const n = round(v, digits);
  return n === null ? MISSING : `${n.toFixed(digits)}%`;
}

export function fmtSigned(v, unit = '', digits = 1) {
  const n = round(v, digits);
  if (n === null) return '—';
  const s = n.toFixed(digits);
  return `${n > 0 ? '+' : ''}${s}${unit}`;
}

// 秒 → 「22分16秒」
export function fmtDur(sec) {
  const n = num(sec);
  if (n === null) return MISSING;
  const s = round(n, 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}時間${m}分${r}秒` : `${m}分${String(r).padStart(2, '0')}秒`;
}

// 秒 → 「22:16」（1時間以上は H:MM:SS）
export function fmtMMSS(sec) {
  const n = num(sec);
  if (n === null) return MISSING;
  const s = round(n, 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? h + ':' : ''}${mm}:${String(r).padStart(2, '0')}`;
}

// 分（小数）→「29分24秒」
export function fmtMinutes(min) {
  const n = num(min);
  return n === null ? MISSING : fmtDur(n * 60);
}

// 2026-10-01 → 10/1(木)
export function fmtMD(iso, withDow = true) {
  if (!iso) return MISSING;
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}${withDow ? `(${weekdayJa(iso)})` : ''}`;
}

export function fmtYMD(iso) {
  if (!iso) return MISSING;
  return iso.slice(0, 10).replace(/-/g, '/');
}

// 集計窓の表示：UTC 10/1(木)〜10/7(水)（JST 10/1 09:00〜10/8 08:59）
export function fmtWindow(win) {
  if (!win || !win.start || !win.end) return MISSING;
  if (win.old) return `${fmtMD(win.start)}〜${fmtMD(win.end)}（旧窓・金〜木）`;
  const [ey, em, ed] = win.end.split('-').map(Number);
  const next = new Date(Date.UTC(ey, em - 1, ed + 1)).toISOString().slice(0, 10);
  return `UTC ${fmtMD(win.start)}〜${fmtMD(win.end)}（JST ${fmtMD(win.start, false)} 09:00〜${fmtMD(next, false)} 08:59）`;
}

export function fmtWindowShort(win) {
  if (!win || !win.start || !win.end) return MISSING;
  return `${win.old ? '旧窓' : 'UTC'} ${fmtMD(win.start, false)}–${fmtMD(win.end, false)}`;
}

export function fmtDateTime(ts) {
  if (!ts) return MISSING;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return String(ts);
  const s = new Date(t + 9 * 3600000).toISOString();
  return `${s.slice(0, 10).replace(/-/g, '/')} ${s.slice(11, 16)} JST`;
}

export function cohortJa(c) {
  return { standard: '通常', long_form: '倍尺', short_corner: 'ショートコーナー' }[c] || (c || '未設定');
}

export function statusJa(s) {
  return { approved: '確定', provisional: '暫定', draft: '暫定' }[s] || (s ? `暫定（${s}）` : '状態未記録');
}

export function truncate(text, max = 400) {
  if (!text) return '';
  const t = String(text);
  return t.length > max ? t.slice(0, max) + '…' : t;
}
