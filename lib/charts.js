// グラフ（Chart.js 4.4.1 の UMD を index.html で読み込み、window.Chart を使う）
// 境界線・数値ラベル・斜線（データなし）・Q点の注記は、外部プラグインを使わずここで描く。
import { fmtMMSS } from './format.js';
import { round } from './metrics.js';

export const COLORS = {
  spotify: '#4DD0C4', all: '#00897B', current: '#F0A500', boundary: '#E05C35',
  seriesA: '#4DD0C4', seriesB: '#1B5E50', curve: '#1B5E50', curveFill: 'rgba(126,200,184,0.35)',
  avg: '#999999', q1: '#1B6348', q2: '#4CAF70', q3: '#2471A3', complete: '#C8943C',
  gray: '#6C757D', grid: '#DDDDDD', ink: '#333333', gold: '#C8943C',
};
const FONT = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif';

const registry = new Set();
let configured = false;

export function chartAvailable() { return typeof window !== 'undefined' && !!window.Chart; }

function setup() {
  if (configured || !chartAvailable()) return;
  const C = window.Chart;
  C.defaults.font.family = FONT;
  C.defaults.font.size = 11;
  C.defaults.color = COLORS.ink;
  C.defaults.animation = false;
  C.defaults.maintainAspectRatio = false;
  C.defaults.responsive = true;
  C.register(valueLabels, vLines, hatchBlocks, qMarkers, annotations);
  configured = true;
}

export function destroyCharts() {
  for (const c of registry) c.destroy();
  registry.clear();
}

function create(canvas, config) {
  setup();
  if (!chartAvailable()) {
    const box = canvas.parentElement;
    if (box) box.replaceChildren(Object.assign(document.createElement('p'), { className: 'chart-error', textContent: 'グラフを表示できません（Chart.js を読み込めませんでした。ネットワークを確認してください）' }));
    return null;
  }
  const chart = new window.Chart(canvas, config);
  registry.add(chart);
  return chart;
}

function narrow(chart) { return chart.width < 520; }

// ── インラインプラグイン ───────────────────────────────────────────────
// 棒の上に数値。null は「未取得」を縦書きで小さく（棒が細いときは省略）。
const valueLabels = {
  id: 'bjValueLabels',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.enabled) return;
    const { ctx } = chart;
    const yScale = chart.scales.y;
    ctx.save();
    ctx.textAlign = 'center';
    chart.data.datasets.forEach((ds, di) => {
      if (opts.datasets && !opts.datasets.includes(di)) return;
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      meta.data.forEach((el, i) => {
        const v = ds.data[i];
        const w = el.width || 0;
        if (w < (opts.minWidth ?? 10)) return;
        const size = Math.max(8, Math.min(11, w * 0.55));
        ctx.font = `${size}px ${FONT}`;
        if (v === null || v === undefined || Number.isNaN(v)) {
          if (!opts.nullText || ds.skipNull) return;
          const base = yScale.getPixelForValue(Math.max(0, yScale.min));
          ctx.fillStyle = COLORS.gray;
          ctx.save();
          ctx.translate(el.x, base - 4);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(opts.nullText, 0, 0);
          ctx.restore();
          return;
        }
        const text = opts.format ? opts.format(v) : String(v);
        ctx.fillStyle = COLORS.ink;
        if (v < 0) { ctx.textBaseline = 'top'; ctx.fillText(text, el.x, el.y + 2); }
        else { ctx.textBaseline = 'bottom'; ctx.fillText(text, el.x, el.y - 2); }
      });
    });
    ctx.restore();
  },
};

// 縦の境界線。at はx軸の値（カテゴリ軸なら 18.5 のような小数のインデックスも可）。
const vLines = {
  id: 'bjVLines',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !Array.isArray(opts.lines)) return;
    const { ctx, chartArea } = chart;
    const x = chart.scales.x;
    ctx.save();
    for (const line of opts.lines) {
      const px = x.getPixelForValue(line.at);
      if (!Number.isFinite(px) || px < chartArea.left - 1 || px > chartArea.right + 1) continue;
      ctx.strokeStyle = line.color || COLORS.boundary;
      ctx.lineWidth = line.width || 1.5;
      ctx.setLineDash(line.dash || [5, 4]);
      ctx.beginPath();
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      if (line.label) {
        const lines = String(line.label).split('\n');
        ctx.font = `bold 10px ${FONT}`;
        const tw = Math.max(...lines.map(t => ctx.measureText(t).width));
        const right = px + 4 + tw + 6 > chartArea.right;
        const bx = right ? px - 4 - tw - 6 : px + 4;
        const by = chartArea.top + (line.labelY ?? 4);
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fillRect(bx, by, tw + 6, lines.length * 13 + 4);
        ctx.strokeStyle = line.color || COLORS.boundary;
        ctx.lineWidth = 0.8;
        ctx.strokeRect(bx, by, tw + 6, lines.length * 13 + 4);
        ctx.fillStyle = line.color || COLORS.boundary;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        lines.forEach((t, k) => ctx.fillText(t, bx + 3, by + 3 + k * 13));
      }
    }
    ctx.restore();
  },
};

// データなしの週：斜線の帯＋ラベル（回遊率グラフ）
const hatchBlocks = {
  id: 'bjHatch',
  beforeDatasetsDraw(chart, _args, opts) {
    if (!opts || !Array.isArray(opts.blocks) || !opts.blocks.length) return;
    const { ctx, chartArea } = chart;
    const x = chart.scales.x;
    const band = (x.getPixelForValue(1) - x.getPixelForValue(0)) * 0.62;
    const pattern = makeHatch(ctx);
    ctx.save();
    for (const b of opts.blocks) {
      const px = x.getPixelForValue(b.index);
      ctx.fillStyle = 'rgba(229,229,224,0.75)';
      ctx.fillRect(px - band / 2, chartArea.top, band, chartArea.bottom - chartArea.top);
      if (pattern) { ctx.fillStyle = pattern; ctx.fillRect(px - band / 2, chartArea.top, band, chartArea.bottom - chartArea.top); }
      ctx.strokeStyle = '#AAAAAA';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(px - band / 2, chartArea.top, band, chartArea.bottom - chartArea.top);
      if (band >= 9) {
        ctx.fillStyle = '#777777';
        ctx.font = `${Math.min(11, band * 0.7)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const y0 = chart.scales.y.getPixelForValue(opts.labelAt ?? 4);
        [...String(b.label)].forEach((ch, k) => ctx.fillText(ch, px, y0 + k * 12));
      }
    }
    ctx.restore();
  },
};

function makeHatch(ctx) {
  try {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(120,120,120,0.45)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 8); g.lineTo(8, 0); g.stroke();
    return ctx.createPattern(c, 'repeat');
  } catch { return null; }
}

// リテンション：Q1/Q2/Q3/Complete の縦線と「Q1 80%」の注記
const qMarkers = {
  id: 'bjQMarkers',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !Array.isArray(opts.markers)) return;
    const { ctx, chartArea } = chart;
    const x = chart.scales.x, y = chart.scales.y;
    ctx.save();
    for (const m of opts.markers) {
      const px = x.getPixelForValue(m.x);
      ctx.strokeStyle = m.color;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(px, chartArea.top); ctx.lineTo(px, chartArea.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      if (m.y === null || m.y === undefined) continue;
      const py = y.getPixelForValue(m.y);
      ctx.fillStyle = m.color;
      ctx.font = `bold ${narrow(chart) ? 10 : 11}px ${FONT}`;
      ctx.textBaseline = 'bottom';
      const atRight = px > chartArea.right - 30;
      ctx.textAlign = atRight ? 'right' : 'center';
      const tx = atRight ? px - 3 : px;
      // 狭い画面では Complete の注記を点の下に置き、Q3 と重ならないようにする
      const below = atRight && narrow(chart);
      ctx.textBaseline = below ? 'top' : 'bottom';
      const ty = below ? Math.min(chartArea.bottom - 14, py + 8) : Math.max(chartArea.top + 12, py - 8);
      ctx.fillText(`${narrow(chart) && m.label === 'Complete' ? 'C' : m.label} ${m.y}%`, tx, ty);
    }
    ctx.restore();
  },
};

// ── 週次の棒（Spotify・全プラット） ─────────────────────────────────────
// rows: [{ week, sp, all, status }]
export function weeklyBars(canvas, rows, { currentWeek = null, boundaries = [], showValues = true, metric = 'plays' } = {}) {
  const labels = rows.map(r => `W${r.week}`);
  const edge = rows.map(r => (r.week === currentWeek ? COLORS.current : 'rgba(0,0,0,0)'));
  const edgeW = rows.map(r => (r.week === currentWeek ? 2.5 : 0));
  const alpha = (hex, draft) => (draft ? hex + '88' : hex);
  const series = metric === 'plays'
    ? [{ key: 'sp', label: 'Spotify', color: COLORS.spotify }, { key: 'all', label: '全プラット', color: COLORS.all }]
    : metric === 'hours'
      ? [{ key: 'hours', label: '視聴時間（h）', color: COLORS.gold }]
      : metric === 'listeners'
        ? [{ key: 'repeat', label: 'リピーター', color: COLORS.spotify }, { key: 'new', label: '新規', color: '#E05C35' }]
        : [{ key: 'fol', label: 'フォロワー増減', color: COLORS.all }];
  const datasets = series.map(s => ({
    label: s.label,
    data: rows.map(r => r[s.key]),
    backgroundColor: rows.map(r => alpha(s.color, r.status !== 'approved')),
    borderColor: edge, borderWidth: edgeW,
    barPercentage: 0.9, categoryPercentage: 0.8,
  }));
  const fmt = metric === 'hours' ? v => round(v, 1).toFixed(1) : v => String(v);
  return create(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      scales: {
        x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0, font: { size: 10 } } },
        y: { beginAtZero: true, grace: '12%', grid: { color: COLORS.grid } },
      },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { boxWidth: 12 } },
        tooltip: { callbacks: {
          title: items => {
            const r = rows[items[0].dataIndex];
            return `W${r.week}${r.status !== 'approved' ? '（暫定）' : ''}${r.windowLabel ? '  ' + r.windowLabel : ''}`;
          },
          label: item => `${item.dataset.label}: ${item.raw === null || item.raw === undefined ? '未取得' : fmt(item.raw)}`,
          footer: items => rows[items[0].dataIndex].note || '',
        } },
        bjValueLabels: { enabled: showValues, format: fmt, minWidth: 9, nullText: '未取得' },
        bjVLines: { lines: boundaries },
      },
    },
  });
}

// ── リテンション曲線 ─────────────────────────────────────────────────
export function retentionChart(canvas, { ts5s, duration, q, avg, epText, avgText }) {
  const D = duration;
  const T = { q1: D * 0.25, q2: D * 0.5, q3: D * 0.75, complete: D };
  const datasets = [];
  if (ts5s && ts5s.length) {
    datasets.push({
      type: 'line', label: epText, data: ts5s.map(([x, y]) => ({ x, y })),
      stepped: true, borderColor: COLORS.curve, borderWidth: 2, pointRadius: 0, pointHitRadius: 4,
      fill: 'origin', backgroundColor: COLORS.curveFill, order: 2,
    });
  }
  if (avg && avg.q1 !== null) {
    datasets.push({
      type: 'line', label: avgText,
      data: [{ x: 0, y: 100 }, { x: T.q1, y: avg.q1 }, { x: T.q2, y: avg.q2 }, { x: T.q3, y: avg.q3 }, { x: T.complete, y: avg.complete }].filter(p => p.y !== null),
      borderColor: COLORS.avg, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: 'origin',
      backgroundColor: 'rgba(153,153,153,0.10)', order: 3,
    });
  }
  const qs = [['q1', 'Q1', COLORS.q1], ['q2', 'Q2', COLORS.q2], ['q3', 'Q3', COLORS.q3], ['complete', 'Complete', COLORS.complete]];
  datasets.push({
    type: 'scatter', label: 'Q1/Q2/Q3/Complete（Spotify表示値）',
    data: qs.map(([k]) => ({ x: T[k], y: q[k] })).filter(p => p.y !== null && p.y !== undefined),
    pointBackgroundColor: qs.filter(([k]) => q[k] !== null && q[k] !== undefined).map(([, , c]) => c),
    pointBorderColor: '#fff', pointRadius: 5, pointHoverRadius: 6, order: 1,
  });
  return create(canvas, {
    data: { datasets },
    options: {
      parsing: false,
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      scales: {
        x: {
          type: 'linear', min: 0, max: D, grid: { color: 'rgba(0,0,0,0.04)' },
          afterBuildTicks: s => { s.ticks = [0, T.q1, T.q2, T.q3, D].map(v => ({ value: v })); },
          ticks: { autoSkip: false, maxRotation: 0, font: { size: 10 },
            callback: v => {
              if (v === 0) return 'Start';
              const lab = v === T.q1 ? 'Q1(25%)' : v === T.q2 ? 'Q2(50%)' : v === T.q3 ? 'Q3(75%)' : 'Complete';
              return [lab, fmtMMSS(v)];
            } },
        },
        y: {
          min: 0, max: 108, grid: { color: '#CCCCCC' },
          afterBuildTicks: s => { s.ticks = [0, 25, 50, 75, 100].map(v => ({ value: v })); },
          ticks: { callback: v => `${v}%` },
        },
      },
      plugins: {
        legend: { position: 'bottom', align: 'start', labels: { boxWidth: 14, filter: it => it.text && !it.text.startsWith('Q1/') } },
        tooltip: { callbacks: {
          title: items => fmtMMSS(items[0].raw.x),
          label: item => `${item.dataset.label}: ${item.raw.y}%`,
        } },
        bjQMarkers: { markers: qs.map(([k, label, color]) => ({ x: T[k], y: q[k] ?? null, label, color })) },
      },
    },
  });
}

// ── 回遊率の推移（系列A/Bを別の棒にし、線でつながない） ─────────────────────
// hist: [{ week, a, b, noData }]
export function kaiyuChart(canvas, hist, { currentWeek, boundaries = [], labels: names = {}, colors = {} }) {
  const cA = colors.series_a || COLORS.seriesA, cB = colors.series_b || COLORS.seriesB;
  const labels = hist.map(r => `W${r.week}`);
  const edge = hist.map(r => (r.week === currentWeek ? COLORS.current : 'rgba(0,0,0,0)'));
  const edgeW = hist.map(r => (r.week === currentWeek ? 2 : 0));
  const mk = (key, label, color) => ({
    label, data: hist.map(r => (r.noData ? null : r[key])), backgroundColor: color,
    borderColor: edge, borderWidth: edgeW, grouped: false, barPercentage: 0.62, categoryPercentage: 1, skipNull: true,
  });
  return create(canvas, {
    type: 'bar',
    data: { labels, datasets: [mk('a', names.series_a || 'Spotify同士（W24まで）', cA), mk('b', names.series_b || '全PF同士（W30から再計算）', cB)] },
    options: {
      scales: {
        x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 45, minRotation: 0, font: { size: 10 } } },
        y: { min: -20, max: 80, grid: { color: COLORS.grid }, ticks: { callback: v => `${v}%` } },
      },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { boxWidth: 12 } },
        tooltip: { callbacks: {
          label: item => (item.raw === null ? '' : `${item.dataset.label}: ${item.raw}%`),
        } },
        bjValueLabels: { enabled: true, format: v => `${v}%`, minWidth: 9 },
        bjVLines: { lines: boundaries },
        bjHatch: { blocks: hist.map((r, i) => (r.noData ? { index: i, label: r.noData } : null)).filter(Boolean), labelAt: 10 },
      },
    },
  });
}

// ── 折れ線（日次・フォロワー） ─────────────────────────────────────────
// labels: 日付文字列、series: [{ label, data, color, dash }]
export function lineChart(canvas, labels, series, { boundaries = [], yTitle = '', beginAtZero = true, tickFormat = null } = {}) {
  return create(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: series.map(s => ({
        label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.color,
        borderWidth: 1.6, pointRadius: labels.length > 60 ? 0 : 2, pointHitRadius: 6, spanGaps: false,
        borderDash: s.dash || [], tension: 0,
      })),
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 8, maxRotation: 0, font: { size: 10 },
          callback(v) { const d = this.getLabelForValue(v); return d ? d.slice(5).replace('-', '/') : d; } } },
        y: { beginAtZero, grid: { color: COLORS.grid }, title: { display: !!yTitle, text: yTitle },
          ticks: tickFormat ? { callback: tickFormat } : {} },
      },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: item => `${item.dataset.label}: ${item.raw === null || item.raw === undefined ? '未取得' : item.raw}` } },
        bjVLines: { lines: boundaries },
      },
    },
  });
}

// ── 回の比較（棒） ────────────────────────────────────────────────────
// rows: [{ label, value, long }]
export function compareBars(canvas, rows, { unit = '', title = '' } = {}) {
  return create(canvas, {
    type: 'bar',
    data: {
      labels: rows.map(r => r.label),
      datasets: [{
        label: title, data: rows.map(r => r.value),
        backgroundColor: rows.map(r => (r.long ? COLORS.gold : COLORS.all)),
        borderColor: rows.map(r => (r.current ? COLORS.current : 'rgba(0,0,0,0)')), borderWidth: rows.map(r => (r.current ? 2.5 : 0)),
      }],
    },
    options: {
      scales: {
        x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0, font: { size: 10 } } },
        y: { beginAtZero: true, grace: '10%', grid: { color: COLORS.grid } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          title: items => rows[items[0].dataIndex].full || rows[items[0].dataIndex].label,
          label: item => `${title}: ${item.raw === null ? '未取得' : item.raw + unit}${rows[item.dataIndex].long ? '（倍尺回）' : ''}`,
        } },
        bjValueLabels: { enabled: true, format: v => `${v}${unit}`, minWidth: 14, nullText: '未取得' },
      },
    },
  });
}

// ── 月次の図（gen_monthly_charts_2026-09-24.py の色・図の種類を踏襲） ─────────────────
// 注記：横の区間線（前期・当期の平均）、任意の文字、折れ線の点の上の数値、棒の斜線（比べない回）
const annotations = {
  id: 'bjAnnot',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts) return;
    const { ctx, chartArea } = chart;
    const x = chart.scales.x;
    ctx.save();
    for (const seg of opts.segments || []) {
      const y = chart.scales[seg.axis || 'y'];
      if (!y || seg.value === null || seg.value === undefined) continue;
      const py = y.getPixelForValue(seg.value);
      const x0 = Math.max(chartArea.left, x.getPixelForValue(seg.from));
      const x1 = Math.min(chartArea.right, x.getPixelForValue(seg.to));
      ctx.strokeStyle = seg.color; ctx.lineWidth = seg.width || 1.5; ctx.globalAlpha = seg.alpha ?? 0.85;
      ctx.setLineDash(seg.dash || [6, 4]);
      ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (seg.label) {
        ctx.font = `10px ${FONT}`;
        const tw = ctx.measureText(seg.label).width;
        const tx = seg.labelAt === 'start' ? x0 + 2 : x1 - tw - 4;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(tx - 2, py - 15, tw + 4, 13);
        ctx.fillStyle = seg.labelColor || seg.color;
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(seg.label, tx, py - 3);
      }
    }
    for (const t of opts.texts || []) {
      if (t.minWidth && chart.width < t.minWidth) continue;
      const px = x.getPixelForValue(t.x);
      const py = t.y === undefined ? chartArea.top + (t.dy ?? 2) : chart.scales[t.axis || 'y'].getPixelForValue(t.y) - (t.dy ?? 4);
      ctx.font = `${t.bold ? 'bold ' : ''}${t.size || 10}px ${FONT}`;
      ctx.fillStyle = t.color || COLORS.ink;
      const baseline = t.baseline || (t.y === undefined ? 'top' : 'bottom');
      ctx.textAlign = t.align || 'center'; ctx.textBaseline = baseline;
      const lines = String(t.text).split('\n');
      const off = baseline === 'bottom' ? -(lines.length - 1) * 12 : 0;
      lines.forEach((line, k) => ctx.fillText(line, px, py + off + k * 12));
    }
    for (const pl of opts.pointLabels || []) {
      const meta = chart.getDatasetMeta(pl.dataset);
      if (!meta || meta.hidden) continue;
      ctx.font = `bold ${pl.size || 10}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      meta.data.forEach((el, i) => {
        const v = chart.data.datasets[pl.dataset].data[i];
        const raw = v && typeof v === 'object' ? v.y : v;
        if (raw === null || raw === undefined) return;
        const text = pl.format ? pl.format(raw, i) : String(raw);
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fillRect(el.x - tw / 2 - 2, el.y - 20, tw + 4, 14);
        ctx.fillStyle = pl.color || COLORS.ink;
        ctx.fillText(text, el.x, el.y - 7);
      });
    }
    for (const hb of opts.hatchBars || []) {
      const meta = chart.getDatasetMeta(hb.dataset ?? 0);
      const el = meta?.data?.[hb.index];
      if (!el) continue;
      const pattern = makeHatch(ctx);
      const w = el.width || 0, top = Math.min(el.y, el.base), hgt = Math.abs(el.base - el.y);
      if (pattern) { ctx.fillStyle = pattern; ctx.fillRect(el.x - w / 2, top, w, hgt); }
    }
    ctx.restore();
  },
};

const monthLegend = { position: 'bottom', align: 'start', labels: { boxWidth: 12 } };

// p3 週次トレンド：前期・当期の Spotify／全PF の棒。当期は金の縁、除外の注記がある週は赤の縁。
// rows: [{ label, sp, all, isCur, flag }]、avg: { prevSp, prevAll, curSp, curAll }
export function monthWeeklyChart(canvas, rows, { prevCount = 0, avg = {}, prevLabel = '前期', curLabel = '当期', flagNote = null } = {}) {
  const edge = rows.map(r => (r.flag ? '#C0392B' : r.isCur ? COLORS.current : 'rgba(0,0,0,0)'));
  const edgeW = rows.map(r => (r.flag ? 3 : r.isCur ? 2.5 : 0));
  const n = rows.length;
  const seg = (from, to, value, color, dash, label) => ({ from, to, value, color, dash, label, labelAt: 'start' });
  const segments = [];
  if (prevCount) {
    segments.push(seg(-0.5, prevCount - 0.5, avg.prevSp, COLORS.spotify, [6, 4], null));
    segments.push(seg(-0.5, prevCount - 0.5, avg.prevAll, COLORS.all, [6, 4], null));
  }
  if (n > prevCount) {
    segments.push(seg(prevCount - 0.5, n - 0.5, avg.curSp, COLORS.spotify, [2, 3], null));
    segments.push(seg(prevCount - 0.5, n - 0.5, avg.curAll, COLORS.all, [2, 3], null));
  }
  const texts = [];
  if (prevCount) texts.push({ x: (prevCount - 1) / 2, text: prevLabel, color: '#777777' });
  if (n > prevCount) texts.push({ x: prevCount + (n - prevCount - 1) / 2, text: curLabel, color: '#B07A00', bold: true });
  const flagIdx = rows.findIndex(r => r.flag);
  if (flagIdx >= 0 && flagNote) texts.push({ x: flagIdx, y: Math.max(rows[flagIdx].sp ?? 0, rows[flagIdx].all ?? 0), dy: 18, text: flagNote, color: '#C0392B', size: 9, bold: true, minWidth: 520 });
  return create(canvas, {
    type: 'bar',
    data: { labels: rows.map(r => r.label), datasets: [
      { label: 'Spotify', data: rows.map(r => r.sp), backgroundColor: COLORS.spotify, borderColor: edge, borderWidth: edgeW, barPercentage: 0.9, categoryPercentage: 0.8 },
      { label: '全プラット', data: rows.map(r => r.all), backgroundColor: COLORS.all, borderColor: edge, borderWidth: edgeW, barPercentage: 0.9, categoryPercentage: 0.8 },
    ] },
    options: {
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, font: { size: 10 } } }, y: { beginAtZero: true, grace: '22%', grid: { color: COLORS.grid } } },
      plugins: {
        legend: monthLegend,
        tooltip: { callbacks: { title: items => rows[items[0].dataIndex].title || rows[items[0].dataIndex].label, label: item => `${item.dataset.label}: ${item.raw ?? '未取得'}`, footer: items => rows[items[0].dataIndex].note || '' } },
        bjValueLabels: { enabled: true, minWidth: 8, nullText: '未取得' },
        bjVLines: { lines: prevCount && n > prevCount ? [{ at: prevCount - 0.5, color: '#BBBBBB', dash: [], width: 1.2 }] : [] },
        bjAnnot: { segments, texts },
      },
    },
  });
}

// p4 左：インプレッション（棒）と CVR（折れ線、右軸）。rows: [{ label, impressions, cvr, isPrev }]
export function discoveryRollChart(canvas, rows) {
  return create(canvas, {
    data: { labels: rows.map(r => r.label), datasets: [
      { type: 'bar', label: 'インプレッション（過去30日）', data: rows.map(r => r.impressions), backgroundColor: rows.map(r => (r.isPrev ? '#B0BEC5' : '#1B5E50')), yAxisID: 'y', order: 2, barPercentage: 0.7 },
      { type: 'line', label: 'CVR（%）', data: rows.map(r => r.cvr), borderColor: COLORS.gold, backgroundColor: COLORS.gold, yAxisID: 'y2', pointRadius: 4, borderWidth: 2, order: 1, spanGaps: false },
    ] },
    options: {
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, font: { size: 10 } } },
        y: { beginAtZero: true, grace: '20%', grid: { color: COLORS.grid }, ticks: { callback: v => Number(v).toLocaleString('en-US') } },
        y2: { position: 'right', beginAtZero: true, grace: '35%', grid: { display: false }, ticks: { callback: v => `${v}%` } },
      },
      plugins: {
        legend: monthLegend,
        tooltip: { callbacks: { title: items => rows[items[0].dataIndex].title || rows[items[0].dataIndex].label, label: item => `${item.dataset.label}: ${item.raw === null || item.raw === undefined ? '未取得' : item.datasetIndex === 0 ? Number(item.raw).toLocaleString('en-US') : item.raw + '%'}` } },
        bjValueLabels: { enabled: true, datasets: [0], format: v => Number(v).toLocaleString('en-US'), minWidth: 18, nullText: '未取得' },
        bjAnnot: { pointLabels: [{ dataset: 1, format: v => `CVR ${v}%`, color: '#8A5F1C', size: 9 }] },
      },
    },
  });
}

// p4 右：期間内の日次インプレッション。rows: [{ date, value, pub }]、weeks: [{ label, sum, from, to }]（index）
export function dailyImpressionChart(canvas, rows, weeks = []) {
  const texts = weeks.map(w => ({ x: (w.from + w.to) / 2, text: `${w.label}  計${w.sum === null ? '未取得' : Number(w.sum).toLocaleString('en-US')}`, color: '#555555', size: 9 }));
  for (let i = 0; i < rows.length; i++) if (rows[i].pub && rows[i].value !== null) texts.push({ x: i, y: rows[i].value, text: rows[i].pub, color: '#1B5E50', size: 9, bold: true });
  return create(canvas, {
    type: 'bar',
    data: { labels: rows.map(r => r.date), datasets: [{ label: '日次インプレッション', data: rows.map(r => r.value), backgroundColor: rows.map(r => (r.pub ? '#16A085' : '#7EC8B8')), barPercentage: 0.85, categoryPercentage: 0.95 }] },
    options: {
      scales: {
        x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, font: { size: 9 }, callback(v, i) { return i % 7 === 0 ? rows[i].date.slice(5).replace('-', '/') : ''; } } },
        y: { beginAtZero: true, grace: '18%', grid: { color: COLORS.grid } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: items => `${rows[items[0].dataIndex].date}（UTC）${rows[items[0].dataIndex].pub ? '  ' + rows[items[0].dataIndex].pub + ' 公開日' : ''}`, label: item => `インプレッション: ${item.raw === null ? '未取得' : Number(item.raw).toLocaleString('en-US')}` } },
        bjVLines: { lines: weeks.slice(1).map(w => ({ at: w.from - 0.5, color: '#CCCCCC', dash: [], width: 1 })) },
        bjAnnot: { texts },
      },
    },
  });
}

// p6 YouTube 長尺の7日視聴回数。rows: [{ label, views, top, hatch }]、前期平均（破線）・中央値（点線）
export function youtubeMonthChart(canvas, rows, { avg = null, median = null } = {}) {
  const n = rows.length;
  const segments = [];
  if (avg !== null) segments.push({ from: -0.5, to: n - 0.5, value: avg, color: '#8D6E63', dash: [6, 4], label: `前期平均 ${round(avg, 0)}` });
  if (median !== null) segments.push({ from: -0.5, to: n - 0.5, value: median, color: '#8D6E63', dash: [2, 3], label: `前期中央値 ${round(median, 1)}`, labelAt: 'start' });
  return create(canvas, {
    type: 'bar',
    data: { labels: rows.map(r => r.label), datasets: [{ label: '視聴回数（長尺・7日）', data: rows.map(r => r.views), backgroundColor: rows.map(r => (r.top ? '#E64A19' : '#FF7043')), barPercentage: 0.6 }] },
    options: {
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, font: { size: 10 } } }, y: { beginAtZero: true, grace: '18%', grid: { color: COLORS.grid } } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: items => rows[items[0].dataIndex].title || '', label: item => `視聴回数: ${item.raw === null ? '未取得' : item.raw + '回'}`, footer: items => rows[items[0].dataIndex].note || '' } },
        bjValueLabels: { enabled: true, format: v => `${v}回`, minWidth: 12, nullText: '未取得' },
        bjAnnot: { segments, hatchBars: rows.map((r, i) => (r.hatch ? { dataset: 0, index: i } : null)).filter(Boolean) },
      },
    },
  });
}

// p14 Apple：再生数（棒）と平均消費率（点、右軸）。rows: [{ label, plays, consume }]
export function appleMonthChart(canvas, rows) {
  // 月次スクリプトは再生数の軸を 0〜60（再生は20前後）、消費率を 0〜120% にして点と棒が重ならないようにしている
  const maxPlays = Math.max(1, ...rows.map(r => r.plays ?? 0));
  const yMax = Math.ceil(maxPlays * 2.7 / 10) * 10;
  return create(canvas, {
    data: { labels: rows.map(r => r.label), datasets: [
      { type: 'bar', label: '再生数（UTC7日合計）', data: rows.map(r => r.plays), backgroundColor: '#80CBC4', yAxisID: 'y', order: 2, barPercentage: 0.5 },
      { type: 'line', label: '平均消費率（取得時点の参考値）', data: rows.map(r => r.consume), borderColor: '#F57C00', backgroundColor: '#F57C00', showLine: false, pointRadius: 6, yAxisID: 'y2', order: 1 },
    ] },
    options: {
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, font: { size: 10 } } },
        y: { beginAtZero: true, max: yMax, grid: { color: COLORS.grid } },
        y2: { position: 'right', min: 0, max: 120, grid: { display: false }, ticks: { callback: v => `${v}%` } },
      },
      plugins: {
        legend: monthLegend,
        tooltip: { callbacks: { label: item => `${item.dataset.label}: ${item.raw === null || item.raw === undefined ? (item.datasetIndex ? '取れない' : '未取得') : item.raw + (item.datasetIndex ? '%' : '')}` } },
        bjValueLabels: { enabled: true, datasets: [0], minWidth: 10, nullText: '未取得' },
        bjAnnot: { pointLabels: [{ dataset: 1, format: v => `${v}%`, color: '#F57C00' }],
                   texts: rows.map((r, i) => (r.consume === null && r.plays !== null ? { x: i, y: r.plays, dy: 14, text: '消費率は\n取れない', color: '#8A8A8A', size: 9 } : null)).filter(Boolean) },
      },
    },
  });
}
