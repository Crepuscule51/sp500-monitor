// ============================================================================
// fetch-daily.mjs — 每日数据流水线（GitHub Actions 定时运行，Node 22+，零第三方依赖）
//
//   1. 标普500 日线（开/高/低/收/量 + 1年历史）  Yahoo Finance ^GSPC
//   2. CNN 恐惧与贪婪指数（当日值 + 120 天历史）  CNN dataviz 官方端点
//   3. VIX                                Yahoo ^VIX，失败回退 CBOE 官方 CSV
//   4. TTM PE + 历史百分位                  multpl.com（meta + 逐年表）
//   5. 规则引擎生成中文解读（engine.mjs）
//   然后合并写入 data/daily.json（累积历史、单源失败保留旧值并标记 stale）
// ============================================================================

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSummary } from "./engine.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = path.join(ROOT, "data", "daily.json");

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json, text/html, text/csv, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

async function getText(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function getJSON(url) {
  return JSON.parse(await getText(url));
}

const round2 = (n) => Math.round(n * 100) / 100;
const fmtDate = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- 数据源抓取

async function fetchSpx() {
  const data = await getJSON(
    "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=1y&interval=1d&events=history"
  );
  const res = data.chart.result[0];
  const q = res.indicators.quote[0];
  const ts = res.timestamp || [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close[i] == null || q.open[i] == null) continue;
    bars.push({
      date: fmtDate(ts[i]),
      open: round2(q.open[i]),
      high: round2(q.high[i]),
      low: round2(q.low[i]),
      close: round2(q.close[i]),
      volume: q.volume[i] != null ? Math.round(q.volume[i]) : null,
    });
  }
  if (bars.length < 2) throw new Error("SPX 数据不足");
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  return {
    asOf: last.date,
    open: last.open,
    high: last.high,
    low: last.low,
    close: last.close,
    prevClose: prev.close,
    change: round2(last.close - prev.close),
    changePct: round2(((last.close - prev.close) / prev.close) * 100),
    volume: last.volume,
    history: bars,
  };
}

async function fetchFng() {
  const data = await getJSON("https://production.dataviz.cnn.io/index/fearandgreed/graphdata");
  const fg = data.fear_and_greed;
  if (fg.score == null) throw new Error("CNN 返回无 score");
  const history = (fg.history || [])
    .filter((h) => h.date && h.value != null)
    .slice(-120)
    .map((h) => ({ date: h.date.slice(0, 10), value: Math.round(h.value) }));
  return { value: Math.round(fg.score), rating: fg.rating || null, history };
}

async function fetchVix() {
  try {
    const data = await getJSON(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=1y&interval=1d&events=history"
    );
    const res = data.chart.result[0];
    const q = res.indicators.quote[0];
    const ts = res.timestamp || [];
    const hist = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.close[i] == null) continue;
      hist.push({ date: fmtDate(ts[i]), value: round2(q.close[i]) });
    }
    if (!hist.length) throw new Error("VIX 数据不足");
    return { value: hist[hist.length - 1].value, history: hist };
  } catch (e) {
    // 回退：CBOE 官方每日 VIX 历史 CSV
    const csv = await getText("https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv");
    const lines = csv.trim().split(/\r?\n/).filter(Boolean);
    const last = lines[lines.length - 1].split(","); // Date, Open, High, Low, Close
    const value = round2(parseFloat(last[4]));
    if (!Number.isFinite(value)) throw new Error(`CBOE CSV 解析失败: ${lines[lines.length - 1]}`);
    return { value, history: null, note: "CBOE CSV 回退" };
  }
}

async function fetchPe() {
  const html = await getText("https://www.multpl.com/s-p-500-pe-ratio");
  const m = html.match(/Current S&P 500 PE Ratio is ([0-9.]+)/);
  const ttmPe = m ? parseFloat(m[1]) : null;
  if (ttmPe == null || !Number.isFinite(ttmPe)) throw new Error("multpl 当前 PE 解析失败");
  let percentile = null;
  try {
    const table = await getText("https://www.multpl.com/s-p-500-pe-ratio/table/by-year");
    // 限定 #datatable 表格区域，逐年行取「Jan 1, YYYY」对应的值（剥离 HTML 标签与实体）
    const mTable = table.match(/<table id="datatable">([\s\S]*?)<\/table>/);
    if (mTable) {
      const yearly = [];
      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
      let row;
      while ((row = rowRe.exec(mTable[1])) !== null) {
        const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
        if (cells.length < 2) continue;
        const dateTxt = cells[0].replace(/<[^>]+>/g, "").trim();
        if (!/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}$/.test(dateTxt)) continue;
        const valTxt = cells[1].replace(/<[^>]+>/g, "").replace(/&#x2002;/g, " ").replace(/†/g, "").trim();
        const val = parseFloat(valTxt);
        if (Number.isFinite(val)) yearly.push(val);
      }
      if (yearly.length) {
        const below = yearly.filter((v) => v <= ttmPe).length;
        percentile = round2((below / yearly.length) * 100);
      }
    }
  } catch {
    // 百分位计算失败不致命，保留 null（前端用自身累积历史兜底）
  }
  return { ttmPe, percentile };
}

// ---------------------------------------------------------------- 合并与写入

function mergeHistory(existing, incoming, cap) {
  const map = new Map();
  for (const it of existing || []) if (it && it.date) map.set(it.date, it);
  for (const it of incoming || []) if (it && it.date) map.set(it.date, it); // incoming 覆盖
  const arr = [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  return arr.slice(-cap);
}

async function attempt(fn, label, url) {
  try {
    const r = await fn();
    return { ok: true, value: r, entry: { label, status: "ok", url } };
  } catch (e) {
    return { ok: false, value: null, entry: { label, status: `failed: ${e.message}`, url } };
  }
}

async function main() {
  let prev = { spx: null, fng: null, vix: null, pe: null, history: {} };
  try {
    prev = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch {
    /* 首次运行无历史文件 */
  }

  const urls = {
    spx: "https://finance.yahoo.com/quote/%5EGSPC",
    fng: "https://www.cnn.com/markets/fear-and-greed",
    vix: "https://finance.yahoo.com/quote/%5EVIX",
    pe: "https://www.multpl.com/s-p-500-pe-ratio",
  };

  const [spxR, fngR, vixR, peR] = await Promise.all([
    attempt(fetchSpx, "S&P 500 (Yahoo ^GSPC)", urls.spx),
    attempt(fetchFng, "CNN Fear & Greed (dataviz)", urls.fng),
    attempt(fetchVix, "VIX (Yahoo ^VIX / CBOE CSV)", urls.vix),
    attempt(fetchPe, "S&P 500 TTM PE (multpl)", urls.pe),
  ]);

  const spx = spxR.ok ? spxR.value : prev.spx;
  const fng = fngR.ok ? fngR.value : prev.fng;
  const vix = vixR.ok ? vixR.value : prev.vix;
  // PE 字段级合并：新值取新的，缺失字段（如百分位解析失败）沿用上一日
  const pe = peR.ok
    ? { ttmPe: peR.value.ttmPe ?? prev.pe?.ttmPe ?? null, percentile: peR.value.percentile ?? prev.pe?.percentile ?? null }
    : prev.pe;

  const asOf = spx?.asOf || prev.asOf || new Date().toISOString().slice(0, 10);
  const hist = prev.history || {};

  const daily = {
    updatedAt: new Date().toISOString(),
    asOf,
    spx: spx
      ? {
          open: spx.open, high: spx.high, low: spx.low, close: spx.close,
          prevClose: spx.prevClose, change: spx.change, changePct: spx.changePct, volume: spx.volume,
        }
      : prev.spx,
    fng: fng ? { value: fng.value, rating: fng.rating ?? null } : prev.fng,
    vix: vix ? { value: vix.value } : prev.vix,
    pe: pe ? { ttmPe: pe.ttmPe, percentile: pe.percentile } : prev.pe,
    history: {
      spx: mergeHistory(hist.spx, spx?.history, 300),
      vix: mergeHistory(hist.vix, vix?.history, 300),
      fng: mergeHistory(hist.fng, fng?.history, 365),
      pe: mergeHistory(hist.pe, pe?.ttmPe != null ? [{ date: asOf, value: pe.ttmPe, percentile: pe.percentile }] : null, 730),
    },
    summary: buildSummary({ spx, fng, vix, pe }),
    sources: [spxR.entry, fngR.entry, vixR.entry, peR.entry],
    stale: { spx: !spxR.ok, fng: !fngR.ok, vix: !vixR.ok, pe: !peR.ok },
  };

  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(daily, null, 2) + "\n", "utf8");

  const s = daily.summary;
  console.log("== 标普500监测图 · 每日快照 ==");
  console.log(`asOf        : ${daily.asOf}`);
  console.log(`S&P 500     : ${daily.spx?.close} (${daily.spx?.changePct}%)  量 ${daily.spx?.volume}`);
  console.log(`F&G         : ${daily.fng?.value}  ${daily.fng?.rating ?? ""}`);
  console.log(`VIX         : ${daily.vix?.value}`);
  console.log(`TTM PE      : ${daily.pe?.ttmPe}  (分位 ${daily.pe?.percentile}%)`);
  console.log(`信号         : ${s.signal?.label}  (score ${s.score})`);
  console.log(`行情描述     : ${s.marketLine}`);
  console.log(`结论         : ${s.conclusion}`);
  console.log("sources:");
  for (const e of daily.sources) console.log(`  [${e.status}] ${e.label}`);

  const allFailed = !spxR.ok && !fngR.ok && !vixR.ok && !peR.ok && !prev.asOf;
  process.exit(allFailed ? 1 : 0);
}

main().catch((e) => {
  console.error("流水线失败:", e);
  process.exit(1);
});
