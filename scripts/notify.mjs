// ============================================================================
// notify.mjs — 每日微信推送（Server酱 / sct.ftqq.com）
//
// 两种用法：
//   1. 被 fetch-daily.mjs 调用：新交易日数据生成后自动推送（asOf 变化才推）
//   2. 单独运行：node scripts/notify.mjs --force   （强制推送，用于测试）
//
// 环境变量：
//   SERVERCHAN_KEY   Server酱 SendKey（sct.ftqq.com 微信扫码登录获取）
//                    未配置时静默跳过，不影响流水线
// ============================================================================

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = path.join(ROOT, "data", "daily.json");

const r2 = (v, d = 2) => (v == null ? "--" : Number(v).toFixed(d));
const vol = (v) => {
  if (v == null) return "--";
  if (v >= 1e8) return (v / 1e8).toFixed(2) + " 亿股";
  if (v >= 1e4) return (v / 1e4).toFixed(1) + " 万股";
  return String(Math.round(v)) + " 股";
};
const sign = (pct) => (pct == null ? "--" : pct > 0 ? `▲+${r2(pct)}%` : pct < 0 ? `▼${r2(Math.abs(pct))}%` : "—0.00%");

const FNG_LABEL = (v) => {
  if (v == null) return "--";
  if (v <= 20) return "极度恐慌";
  if (v <= 40) return "恐慌";
  if (v <= 60) return "中性";
  if (v <= 80) return "贪婪";
  return "极度贪婪";
};

/** 由 daily.json 生成微信日报（Markdown） */
export function buildDigest(d) {
  const s = d.summary || {};
  const sig = s.signal || {};
  const fmt = (v) => (v == null ? "--" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  const spx = d.spx || {};
  const ndx = d.ndx || {};
  const pe = d.pe || {};

  const title = `标普500&纳指100 ${d.asOf || "--"} ${sig.label ? sig.label.split("：")[0] : "--"}`;

  const lines = [];
  lines.push(`> 数据截至 ${d.asOf || "--"} 美股收盘`);

  lines.push(`## 标普500  ${fmt(spx.close)} ${sign(spx.changePct)}`);
  lines.push(`- 涨跌 ${r2(spx.change)} ｜ 开 ${fmt(spx.open)} / 高 ${fmt(spx.high)} / 低 ${fmt(spx.low)} / 量 ${vol(spx.volume)}`);
  if (s.marketLine) lines.push(`- ${s.marketLine}`);

  lines.push(`## 纳指100  ${fmt(ndx.close)} ${sign(ndx.changePct)}`);
  lines.push(`- 涨跌 ${r2(ndx.change)} ｜ 开 ${fmt(ndx.open)} / 高 ${fmt(ndx.high)} / 低 ${fmt(ndx.low)} / 量 ${vol(ndx.volume)}`);
  if (s.ndxLine) lines.push(`- ${s.ndxLine}`);

  lines.push("## 情绪与波动");
  lines.push(`- 恐惧贪婪：${d.fng?.value ?? "--"}（${FNG_LABEL(d.fng?.value)}）`);
  lines.push(`- VIX：${r2(d.vix?.value)}（标普500） ｜ VXN：${r2(d.vxn?.value)}（纳指100）`);

  lines.push("## 估值");
  const peParts = [`标普500 PE ${r2(pe.ttmPe)}`, pe.percentile != null ? `近10年分位 ${r2(pe.percentile, 1)}%` : null].filter(Boolean);
  lines.push(`- ${peParts.join(" ｜ ")}`);
  const alt = [pe.spyPe != null ? `SPY ${r2(pe.spyPe)}` : null, pe.qqqPe != null ? `QQQ ${r2(pe.qqqPe)}（纳指100）` : null, pe.cape != null ? `席勒 ${r2(pe.cape)}` : null].filter(Boolean);
  if (alt.length) lines.push(`- 对照：${alt.join(" · ")}`);

  lines.push(`## 综合判断：${sig.label || "--"}${s.score != null ? `（${s.score}）` : ""}`);
  for (const dim of s.dimensions || []) lines.push(`- ${dim.name}${dim.tone}：${dim.text}`);
  if (s.conclusion) lines.push(`\n**${s.conclusion}**`);
  if (s.advice && s.advice.length) {
    lines.push("\n**操作建议**：");
    s.advice.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
  }

  lines.push(`\n---\n更新时间 ${d.updatedAt ? new Date(d.updatedAt).toLocaleString("zh-CN", { hour12: false }) : "--"} ｜ 自动生成，不构成投资建议`);

  return { title, desp: lines.join("\n") };
}

/** 调用 Server酱发送 */
export async function sendServerChan(key, title, desp) {
  const body = new URLSearchParams({ title, desp });
  const r = await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(key)}.send`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(25000),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.code !== 0) {
    throw new Error(`ServerChan 返回异常: HTTP ${r.status} ${JSON.stringify(j)}`);
  }
  return j;
}

// ---- 独立运行模式：node scripts/notify.mjs [--force] ----
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

export async function notifyFromFile({ force = false } = {}) {
  const key = process.env.SERVERCHAN_KEY || "";
  if (!key) {
    console.log("未配置 SERVERCHAN_KEY（仓库 Secrets），跳过微信推送");
    return { skipped: true };
  }
  const daily = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  const { title, desp } = buildDigest(daily);
  if (!force) {
    const staleDays = Math.round((Date.now() - new Date(daily.updatedAt).getTime()) / 86400000);
    if (staleDays > 2) {
      console.log(`快照已 ${staleDays} 天未更新，跳过推送（--force 可强制）`);
      return { skipped: true };
    }
  }
  await sendServerChan(key, title, desp);
  console.log("微信推送成功:", title);
  return { skipped: false, title };
}

if (isCli) {
  const force = process.argv.includes("--force");
  notifyFromFile({ force }).catch((e) => {
    console.error("推送失败:", e.message);
    process.exit(1);
  });
}
