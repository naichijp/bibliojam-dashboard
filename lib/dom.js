// DOMの小道具：要素生成、出典ツールチップ
import { MISSING } from './format.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'src' && tag !== 'img' && tag !== 'script') setSource(el, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function setSource(el, text) {
  if (!text) return el;
  el.dataset.src = Array.isArray(text) ? text.filter(Boolean).join('\n') : text;
  el.classList.add('has-src');
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
  return el;
}

// 数値：未取得なら灰色の「未取得」
export function val(text, src, cls = '') {
  const missing = text === MISSING || text === null || text === undefined;
  return h('span', { class: `val ${cls} ${missing ? 'missing' : ''}`.trim(), src }, missing ? MISSING : text);
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

// ── 出典ツールチップ（マウス・キーボード・タップ） ─────────────────────
let tip = null, current = null, shownAt = 0;

export function initTooltips() {
  if (tip) return;
  tip = h('div', { class: 'tip', role: 'tooltip', id: 'src-tip', hidden: true });
  document.body.append(tip);
  const find = e => (e.target instanceof Element ? e.target.closest('[data-src]') : null);
  document.addEventListener('mouseover', e => { const el = find(e); if (el) show(el); });
  document.addEventListener('mouseout', e => { const el = find(e); if (el && el === current && !el.contains(e.relatedTarget)) hide(); });
  document.addEventListener('focusin', e => { const el = find(e); if (el) show(el); });
  document.addEventListener('focusout', () => hide());
  document.addEventListener('click', e => {
    const el = find(e);
    if (el) { if (current === el && !tip.hidden && Date.now() - shownAt > 400) hide(); else if (current !== el) show(el); }
    else if (!(e.target instanceof Element && e.target.closest('.tip'))) hide();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  window.addEventListener('resize', () => hide());
}

function show(el) {
  if (current !== el) shownAt = Date.now();
  current = el;
  tip.textContent = el.dataset.src;
  tip.hidden = false;
  el.setAttribute('aria-describedby', 'src-tip');
  place(el);
}

function hide() {
  if (!tip) return;
  tip.hidden = true;
  if (current) current.removeAttribute('aria-describedby');
  current = null;
}

function place(el) {
  const r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const w = Math.min(380, vw - 24);
  tip.style.maxWidth = `${w}px`;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(12, Math.min(left, vw - tw - 12));
  let top = r.bottom + 8;
  if (top + th > window.innerHeight - 8 && r.top - th - 8 > 8) top = r.top - th - 8;
  tip.style.left = `${left + window.scrollX}px`;
  tip.style.top = `${top + window.scrollY}px`;
}
