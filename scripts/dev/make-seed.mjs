// ============================================================================
// make-seed.mjs — 离线生成初始 data/daily.json（仅首次搭建用，不联网）
// 数据来源：
//   2026-08-14 当日指标：用户提供的样例快照（收盘 7785.76 等）
//   历史序列：FRED 官方 SP500 / VIXCLS 日线（从上游开源项目快照提取，真实数据）
// 首次 GitHub Actions 运行后，data/daily.json 会被真实每日数据接管。
// ============================================================================

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSummary } from "../engine.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_FILE = path.join(ROOT, "data", "daily.json");
const INPUT_FILE = path.join(ROOT, "scripts", "dev", "history-input.json");

const input = JSON.parse((await fs.readFile(INPUT_FILE, "utf8")).replace(/^\uFEFF/, ""));

// 2026-08-14（用户样例，与 FRED 当日收盘 7785.76 一致）
const spx = {
  asOf: "2026-08-14",
  open: 7806.6,
  high: 7810.01,
  low: 7776.31,
  close: 7785.76,
  prevClose: 7798.99,
  change: -13.23,
  changePct: -0.17,
  volume: 2210000000, // 22.10亿股
  history: input.sp500.map((r) => ({ date: r.date, close: r.close })),
};
const vix = { value: 14.25, history: [...input.vix.map((r) => ({ date: r.date, value: r.value })), { date: "2026-08-14", value: 14.25 }] };
const fng = { value: 65, rating: "Greed", history: [] };
// 2026-08-16 实测 multpl.com（as-reported TTM PE，近10年月度分位为主口径）：
// 当前 PE 30.00 → 近10年 91.67% / 近20年 90.83% / 全历史(1871至今, 1868个月) 97.27%
const pe = { ttmPe: 30.0, percentile: 91.67, percentile20y: 90.83, percentileAll: 97.27, percentileWindow: "10y" };

const daily = {
  updatedAt: new Date().toISOString(),
  asOf: "2026-08-14",
  spx: {
    open: spx.open, high: spx.high, low: spx.low, close: spx.close,
    prevClose: spx.prevClose, change: spx.change, changePct: spx.changePct, volume: spx.volume,
  },
  fng: { value: fng.value, rating: fng.rating },
  vix: { value: vix.value },
  pe: { ttmPe: pe.ttmPe, percentile: pe.percentile, percentile20y: pe.percentile20y, percentileAll: pe.percentileAll, percentileWindow: pe.percentileWindow },
  history: {
    spx: spx.history,
    vix: vix.history,
    fng: [],
    pe: [],
  },
  summary: buildSummary({ spx, fng, vix, pe }),
  sources: [
    { label: "种子快照 2026-08-14（用户样例 + FRED SP500/VIXCLS 真实历史）", status: "seed", url: "" },
  ],
  stale: { spx: false, fng: false, vix: false, pe: false },
};

await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
await fs.writeFile(DATA_FILE, JSON.stringify(daily, null, 2) + "\n", "utf8");

console.log("种子数据已生成 →", DATA_FILE);
console.log("信号:", daily.summary.signal.label, "| 行情:", daily.summary.marketLine);
console.log("结论:", daily.summary.conclusion);
console.log("建议:", daily.summary.advice.join(" / "));
console.log(`历史点数: SPX=${daily.history.spx.length} VIX=${daily.history.vix.length} F&G=${daily.history.fng.length} PE=${daily.history.pe.length}`);
