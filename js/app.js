/* ============================================================================
   标普500监测图 — 渲染逻辑（原生 JS + ECharts）
   读取同源 data/daily.json（由 GitHub Actions 每日更新）
   ========================================================================== */

"use strict";

const $ = (id) => document.getElementById(id);

const FMT = {
  n: (v, d = 2) => (v == null ? "--" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })),
  int: (v) => (v == null ? "--" : Math.round(v).toLocaleString("en-US")),
  vol: (v) => {
    if (v == null) return "--";
    if (v >= 1e8) return (v / 1e8).toFixed(2) + " 亿股";
    if (v >= 1e4) return (v / 1e4).toFixed(1) + " 万股";
    return FMT.int(v) + " 股";
  },
  date: (iso) => {
    if (!iso) return "--";
    const d = new Date(iso.slice(0, 10) + "T00:00:00");
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  },
  dt: (iso) => {
    if (!iso) return "--";
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  },
};

const FNG_BANDS = [
  { min: 0, max: 20, label: "极度恐慌", color: "var(--fng-1)" },
  { min: 21, max: 40, label: "恐慌", color: "var(--fng-2)" },
  { min: 41, max: 60, label: "中性", color: "var(--fng-3)" },
  { min: 61, max: 80, label: "贪婪", color: "var(--fng-4)" },
  { min: 81, max: 100, label: "极度贪婪", color: "var(--fng-5)" },
];

const AXIS = {
  axisLine: { lineStyle: { color: "#2b3346" } },
  axisLabel: { color: "#8b93a7", fontSize: 11 },
  splitLine: { lineStyle: { color: "rgba(43,51,70,.5)" } },
};

let charts = [];
function makeChart(id, option) {
  const el = $(id);
  if (typeof echarts === "undefined") {
    el.outerHTML = '<div class="chart-empty">图表库加载失败（需联网加载 ECharts CDN）</div>';
    return;
  }
  const c = echarts.init(el);
  c.setOption(option);
  charts.push(c);
}

function renderHistoryChart(id, series, { name, color, markLines = [], height }) {
  if (!series || !series.length) {
    $(id).outerHTML = '<div class="chart-empty">历史数据积累中（首次定时任务运行后自动填充）</div>';
    return;
  }
  const dates = series.map((p) => p.date);
  const values = series.map((p) => (p.close != null ? p.close : p.value));
  makeChart(id, {
    grid: { left: 8, right: 8, top: 14, bottom: 2, containLabel: false },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1a2030",
      borderColor: "#2b3346",
      textStyle: { color: "#e6e9f0", fontSize: 12 },
      formatter: (ps) => {
        const p = ps[0];
        return `${p.axisValue}<br/><span style="color:${color}">●</span> ${name}: <b>${p.value}</b>`;
      },
    },
    xAxis: { type: "category", data: dates, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false } },
    yAxis: { type: "value", scale: true, ...AXIS, splitLine: { show: false } },
    series: [
      {
        type: "line", data: values, name,
        symbol: "none", smooth: true,
        lineStyle: { width: 1.6, color },
        areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: color + "33" }, { offset: 1, color: color + "00" }] } },
        markLine: markLines.length
          ? {
              symbol: "none",
              label: { color: "#8b93a7", fontSize: 10, position: "insideEndTop" },
              lineStyle: { type: "dashed", color: "#4b5563" },
              data: markLines,
            }
          : undefined,
      },
    ],
  });
}

function upDown(pct) {
  if (pct == null) return { cls: "", arrow: "", text: "--" };
  if (pct > 0) return { cls: "up", arrow: "▲", text: `+${FMT.n(pct)}%` };
  if (pct < 0) return { cls: "down", arrow: "▼", text: `${FMT.n(pct)}%` };
  return { cls: "", arrow: "—", text: "0.00%" };
}

/* ---------------------------------------------------------------- 各区块渲染 */

function renderHeader(d) {
  const isSeed = (d.sources || []).some((s) => s.status === "seed");
  const staleCount = d.stale ? Object.values(d.stale).filter(Boolean).length : 0;
  let badges = "";
  if (isSeed) badges += '<span class="badge seed">初始种子数据</span>';
  if (staleCount) badges += `<span class="badge stale">${staleCount} 个数据源未更新</span>`;
  $("subline").innerHTML = `情绪与择时指标监测 · 数据截至 <b>${FMT.date(d.asOf)}</b> 美股收盘 ${badges}`;
}

function renderOverview(d) {
  const s = d.spx || {};
  const ud = upDown(s.changePct);
  $("spx-tag").textContent = "1年走势 · Yahoo";
  $("ov-close").textContent = FMT.n(s.close, 2);
  const ch = $("ov-change");
  ch.className = "ov-change " + ud.cls;
  ch.innerHTML = `${ud.arrow} ${FMT.n(s.change, 2)} (${ud.text})`;
  $("ov-trend").textContent = s.changePct > 0 ? "上涨" : s.changePct < 0 ? "下跌" : "平盘";

  const stats = [
    ["开盘", FMT.n(s.open, 2)],
    ["最高", FMT.n(s.high, 2)],
    ["最低", FMT.n(s.low, 2)],
    ["成交量", FMT.vol(s.volume)],
  ];
  $("ov-stats").innerHTML = stats.map(([k, v]) => `<div class="ov-stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");

  $("ov-line").textContent = d.summary?.marketLine || "";
  renderHistoryChart("chart-spx", d.history?.spx, {
    name: "S&P 500",
    color: "#60a5fa",
    markLines: [{ yAxis: s.close, label: { formatter: "收盘" } }],
  });
}

function renderNdx(d) {
  const s = d.ndx || {};
  const ud = upDown(s.changePct);
  $("ndx-tag").textContent = "1年走势 · Yahoo";
  $("ndx-close").textContent = FMT.n(s.close, 2);
  const ch = $("ndx-change");
  ch.className = "ov-change " + ud.cls;
  ch.innerHTML = `${ud.arrow} ${FMT.n(s.change, 2)} (${ud.text})`;
  $("ndx-trend").textContent = s.changePct > 0 ? "上涨" : s.changePct < 0 ? "下跌" : "平盘";

  const stats = [
    ["开盘", FMT.n(s.open, 2)],
    ["最高", FMT.n(s.high, 2)],
    ["最低", FMT.n(s.low, 2)],
    ["成交量", FMT.vol(s.volume)],
  ];
  $("ndx-stats").innerHTML = stats.map(([k, v]) => `<div class="ov-stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");

  $("ndx-line").textContent = d.summary?.ndxLine || "";
  renderHistoryChart("chart-ndx", d.history?.ndx, {
    name: "NASDAQ 100",
    color: "#34d399",
    markLines: [{ yAxis: s.close, label: { formatter: "收盘" } }],
  });
}

function renderFng(d) {
  const f = d.fng || {};
  const v = f.value;
  const band = FNG_BANDS.find((b) => v != null && v >= b.min && v <= b.max);
  $("fng-rating").textContent = v == null ? "--" : `${v} · ${band ? band.label : ""}`;
  $("fng-rating").style.color = band ? band.color : "";
  $("fng-bands").innerHTML = FNG_BANDS.map(
    (b) => `<div style="background:${b.color};${band && band.label === b.label ? "outline:2px solid #fff;outline-offset:1px" : ""}">${b.min}-${b.max}<br/>${b.label}</div>`
  ).join("");
  $("fng-text").textContent = d.summary?.fngText || "";

  if (v != null && typeof echarts !== "undefined") {
    makeChart("gauge-fng", {
      series: [
        {
          type: "gauge",
          startAngle: 210,
          endAngle: -30,
          min: 0,
          max: 100,
          radius: "95%",
          center: ["50%", "62%"],
          progress: { show: false },
          axisLine: {
            lineStyle: {
              width: 20,
              color: [
                [0.2, "#c0392b"],
                [0.4, "#e67e22"],
                [0.6, "#f4d03f"],
                [0.8, "#52be80"],
                [1, "#1e8449"],
              ],
            },
          },
          pointer: { length: "58%", width: 5, itemStyle: { color: "#e6e9f0" } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          anchor: { show: true, size: 10, itemStyle: { color: "#e6e9f0" } },
          title: { show: false },
          detail: {
            valueAnimation: true,
            offsetCenter: [0, "8%"],
            fontSize: 30,
            fontWeight: 700,
            color: "#e6e9f0",
            formatter: (val) => val.toFixed(0),
          },
          data: [{ value: v }],
        },
      ],
    });
  } else if (typeof echarts === "undefined") {
    $("gauge-fng").outerHTML = '<div class="chart-empty">图表库加载失败</div>';
  }

  renderHistoryChart("chart-fng", d.history?.fng, {
    name: "恐惧贪婪",
    color: "#f4d03f",
    markLines: [
      { yAxis: 25, label: { formatter: "恐慌 25" } },
      { yAxis: 45, label: { formatter: "45" } },
      { yAxis: 55, label: { formatter: "55" } },
      { yAxis: 75, label: { formatter: "贪婪 75" } },
    ],
  });
}

function renderVix(d) {
  const v = d.vix?.value;
  const band = v == null ? null : v < 15 ? { label: "低波动", cls: "low" } : v <= 25 ? { label: "中性波动", cls: "mid" } : { label: "高波动", cls: "high" };
  $("vix-num").innerHTML = v == null ? "--" : `${FMT.n(v, 2)} <small>点</small>`;
  const chip = $("vix-chip");
  chip.textContent = band ? band.label : "--";
  chip.className = "chip " + (band ? band.cls : "");
  $("vix-text").textContent = d.summary?.vixText || "";
  renderHistoryChart("chart-vix", d.history?.vix, { name: "VIX", color: "#c084fc" });
}

function renderVxn(d) {
  const v = d.vxn?.value;
  const band = v == null ? null : v < 22 ? { label: "低波动", cls: "low" } : v <= 35 ? { label: "中性波动", cls: "mid" } : { label: "高波动", cls: "high" };
  $("vxn-num").innerHTML = v == null ? "--" : `${FMT.n(v, 2)} <small>点</small>`;
  const chip = $("vxn-chip");
  chip.textContent = band ? band.label : "--";
  chip.className = "chip " + (band ? band.cls : "");
  $("vxn-text").textContent = d.summary?.vxnText || "";
  renderHistoryChart("chart-vxn", d.history?.vxn, { name: "VXN", color: "#fb923c" });
}

function renderPe(d) {
  const p = d.pe || {};
  $("pe-num").innerHTML = p.ttmPe == null ? "--" : `${FMT.n(p.ttmPe, 2)} <small>倍</small>`;
  const pct = p.percentile;
  if (pct != null) {
    $("pe-bar-fill").style.width = Math.max(1, Math.min(100, pct)) + "%";
    $("pe-pct").textContent = `近10年分位 ${FMT.n(pct, 1)}%`;
  } else {
    $("pe-pct").textContent = "近10年分位 --";
  }
  const more = [
    p.percentile20y != null ? `20年分位 ${FMT.n(p.percentile20y, 1)}%` : null,
    p.percentileAll != null ? `全历史分位 ${FMT.n(p.percentileAll, 1)}%` : null,
  ].filter(Boolean);
  $("pe-more").textContent = more.length ? more.join(" · ") : "";
  // 多口径对照（辅助来源，缺失时自动隐藏）
  const alt = [
    p.spyPe != null ? `对照 · SPY PE(TTM) ${FMT.n(p.spyPe, 2)}` : null,
    p.cape != null ? `席勒PE ${FMT.n(p.cape, 2)}` : null,
  ].filter(Boolean);
  $("pe-alt").textContent = alt.length ? `对照口径 · ${alt.join(" · ")}（stockanalysis / multpl）` : "";
  $("pe-text").textContent = d.summary?.valuationText || "";
  renderHistoryChart("chart-pe", d.history?.pe, {
    name: "TTM PE",
    color: "#38bdf8",
    markLines: [{ yAxis: d.history?.pe?.length ? d.history.pe[d.history.pe.length - 1].value : undefined, label: { formatter: "最新" } }].filter((m) => m.yAxis != null),
  });
}

function renderNdxPe(d) {
  const q = d.pe?.qqqPe;
  $("ndx-pe-num").innerHTML = q == null ? "--" : `${FMT.n(q, 2)} <small>倍</small>`;
  renderHistoryChart("chart-qqq-pe", d.history?.qqqPe, {
    name: "QQQ PE(TTM)",
    color: "#22d3ee",
    markLines: [{ yAxis: q, label: { formatter: "最新" } }].filter((m) => m.yAxis != null),
  });
}

function renderSignal(d) {
  const s = d.summary || {};
  const sig = s.signal || {};
  const banner = $("signal");
  banner.className = "signal-banner " + (sig.color || "yellow");
  $("signal-label").textContent = sig.label || "--";
  $("signal-score").textContent = s.score != null ? `综合得分 ${s.score}` : "";

  const toneCls = (t) => (t === "偏暖" || t === "偏低" ? "warm" : t === "偏冷" || t === "偏高" ? "cold" : "neutral");
  $("dims").innerHTML = (s.dimensions || [])
    .map(
      (dim) => `
        <div class="dim">
          <span class="name">${dim.name}</span>
          <span class="tone ${toneCls(dim.tone)}">${dim.tone}</span>
          <span style="color:var(--muted)">${dim.text}</span>
        </div>`
    )
    .join("");
  $("conclusion").textContent = s.conclusion || "";
}

function renderAdvice(d) {
  const list = d.summary?.advice || [];
  $("advice").innerHTML = list.map((t, i) => `<li data-n="${i + 1}">${t}</li>`).join("");
}

function renderFooter(d) {
  const links = [
    ["S&P 500 · Yahoo Finance", "https://finance.yahoo.com/quote/%5EGSPC"],
    ["NASDAQ 100 · Yahoo Finance", "https://finance.yahoo.com/quote/%5ENDX"],
    ["CNN 恐惧与贪婪", "https://www.cnn.com/markets/fear-and-greed"],
    ["VIX · CBOE", "https://www.cboe.com/tradable_products/vix/"],
    ["TTM PE · multpl", "https://www.multpl.com/s-p-500-pe-ratio"],
  ];
  $("footer-links").innerHTML =
    links.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`).join("") +
    `<span>数据快照更新时间：${FMT.dt(d.updatedAt)}</span>`;
}

/* ---------------------------------------------------------------- 入口 */

async function main() {
  let data;
  try {
    const r = await fetch("data/daily.json", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    const box = $("errbox");
    box.style.display = "block";
    box.innerHTML =
      `无法加载数据（data/daily.json）。请确认已部署包含该文件的静态站点，或先手动运行 GitHub Actions 中的 <b>Update daily snapshot</b> 工作流。<br/>` +
      `<span style="opacity:.7">详情：${e.message}</span>`;
    $("subline").textContent = "情绪与择时指标监测 · 数据加载失败";
    return;
  }

  $("main").style.display = "grid";
  // 每个区块独立渲染：单点失败只影响该卡片，不影响其他（容错）
  const renderers = [renderHeader, renderOverview, renderNdx, renderFng, renderVix, renderVxn, renderPe, renderNdxPe, renderSignal, renderAdvice, renderFooter];
  for (const fn of renderers) {
    try {
      fn(data);
    } catch (e) {
      console.error("渲染失败:", fn.name, e);
    }
  }

  window.addEventListener("resize", () => charts.forEach((c) => c.resize()));
}

main();
