# 标普500监测图 · 情绪与择时指标监测

每日自动更新的美股监测页面：**标普500 收盘概览 + CNN 恐惧与贪婪指数 + VIX 恐慌指数 + TTM PE 估值与历史分位**，并用规则模板自动生成中文解读（综合判断红黄绿灯、投资者操作建议）。

- 纯静态页面 + ECharts，零后端、零数据库
- GitHub Actions 每日定时抓取数据，提交到 `data/daily.json`，GitHub Pages 直接托管
- 数据源全部免费、无需注册 API key（Yahoo Finance / CNN dataviz / CBOE / multpl）

在线示例：部署到 GitHub Pages 后即为 `https://<你的用户名>.github.io/<仓库名>/`

## 页面内容

| 区块 | 指标 | 数据源 |
|---|---|---|
| 今日概览 | 收盘/涨跌额/涨跌幅/开/高/低/成交量 + 1年走势 | Yahoo Finance `^GSPC` |
| 恐惧与贪婪 | CNN 指数（0–100 五区间）+ 120 天历史 | CNN dataviz 官方端点 |
| VIX | 恐慌指数 + 低/中/高波动区间 + 1年历史 | Yahoo `^VIX`，失败回退 CBOE 官方 CSV |
| 估值 | TTM PE（multpl 按已报告盈利口径）+ 近10年月度分位（另附 20 年/全历史分位） | multpl.com |
| 综合判断 | 情绪/波动/估值三维打分 → 红黄绿灯 | 本地规则引擎 |
| 操作建议 | 按灯色生成 3 条中文建议 | 本地规则模板 |

## 快速开始

1. **推送到 GitHub**（新建仓库，比如 `sp500-monitor`，公开或私有均可）：
   ```bash
   git init
   git add .
   git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```
2. **启用 GitHub Pages**：仓库 `Settings → Pages`，`Source` 选 `Deploy from a branch`，`Branch` 选 `main`，`/ (root)`，保存。
3. **立即拉取一次数据**：仓库 `Actions` 页找到 `Update daily snapshot` 工作流 → `Run workflow`（不点也行，每天北京时间 06:30 会自动跑）。
4. 等工作流跑完（约 1 分钟），刷新 `https://<你的用户名>.github.io/<仓库名>/` 即可看到今日数据。

> 仓库里已内置一份 **2026-08-14 的种子快照**（含真实历史序列），页面在首次自动更新前也能正常展示。

## 本地运行

```bash
node scripts/fetch-daily.mjs   # 拉取最新数据并写入 data/daily.json（需要能访问外网）
python -m http.server 8000     # 或任意静态服务器
# 打开 http://localhost:8000
```

> 提示：从某些网络出口（数据中心 IP 等）直连 Yahoo/CNN 可能被拦截，这是出口 IP 的问题；GitHub Actions 的运行环境实测全部数据源可用。

## 目录结构

```
├── index.html                 # 单页仪表盘
├── css/style.css              # 样式（深色主题）
├── js/app.js                  # 渲染逻辑（原生 JS + ECharts）
├── data/daily.json            # 每日快照 + 累积历史（自动维护）
├── scripts/
│   ├── engine.mjs             # 规则引擎：指标 → 中文解读（纯函数）
│   ├── fetch-daily.mjs        # 每日流水线：抓取 4 类数据 → 合并 → 写 JSON
│   └── dev/
│       ├── make-seed.mjs      # 离线生成初始种子快照（仅搭建时用）
│       └── history-input.json # 种子历史输入（仅搭建时用，可删）
└── .github/workflows/update-daily.yml
```

## 规则说明

**恐惧与贪婪**：0–20 极度恐慌 / 21–40 恐慌 / 41–60 中性 / 61–80 贪婪 / 81–100 极度贪婪

**VIX**：< 15 低波动 / 15–25 中性波动 / > 25 高波动（> 35 视为极高波动）

**估值分位**：主口径为**近10年月度分位**（multpl 月度 PE 序列 1871 年至今，取最近 120 个月，含当前月），同时记录近20年与全历史分位供参考：< 30% 较低 / 30–60% 中等 / 60–75% 中等偏高 / > 75% 偏高

**综合判断**：情绪端（F&G 区间 ±1 分）＋ 波动端（VIX 区间 ±0.5~2 分）＋ 估值端（分位区间 ±1~2 分）求和：
- ≥ 1.5 → 绿灯：偏积极
- (-1.5, 1.5) → 黄灯：中性偏谨慎 / 中性观望 / 中性偏防御
- ≤ -1.5 → 红灯：谨慎防守

所有阈值与文案都在 `scripts/engine.mjs` 顶部，可直接调整。

## 容错机制

- 4 个数据源相互独立抓取，单个失败**不影响其他区块**，页面会标记"未更新"徽标
- 失败时沿用上一日快照中的旧值，并在 `sources` 中记录失败原因（可在 `data/daily.json` 查看）
- 历史序列按日期去重合并，SPX/VIX 保留 300 个点，F&G 保留 365 个点，PE 保留 730 个点

## 常见问题

**刷新浏览器就能看到最新数据吗？**
可以。页面直接读取静态文件 `data/daily.json`，GitHub Actions 每天更新它，所以**刷新浏览器即拿到最新数据**，无需重新部署。
- 更新时机：每天北京时间 06:30 左右自动运行（美股收盘后），因此早上刷新看到的是"昨日美股收盘"的完整数据；当天盘中刷新仍是昨日数据（本页面设计为日频快照，不是盘中实时）。
- 偶尔遇到旧数据：浏览器缓存所致，按 `Ctrl+F5` 强制刷新即可（页面请求已带 `no-store`，正常情况下不会发生）。
- 想立即更新：仓库 `Actions` 页手动 `Run workflow`，跑完刷新页面即可。
- 某天数据源全部失败：页面会保留上一日数据并显示"未更新"徽标，不影响浏览。

**PE 数据口径是什么？**
- 数值（主）：multpl.com 的 S&P 500 TTM PE（按已报告 GAAP 盈利计算），与各券商/网站的 operating PE 或 forward PE 口径会有 1~3 倍差异，属正常现象。
- 数值（对照）：卡片上同时展示 **SPY PE(TTM)**（stockanalysis.com）与**席勒 PE / CAPE**（multpl，10 年通胀调整盈利）两个对照口径，便于交叉参考。
- 分位：近10年月度分位为主口径（页面卡片中会同时展示 20 年与全历史分位做参考）。

## 数据源与免责声明

- S&P 500 日线：[Yahoo Finance](https://finance.yahoo.com/quote/%5EGSPC)
- CNN 恐惧与贪婪指数：[CNN Markets](https://www.cnn.com/markets/fear-and-greed)
- VIX：[CBOE](https://www.cboe.com/tradable_products/vix/) / Yahoo Finance
- TTM PE 与历史分位：[multpl.com](https://www.multpl.com/s-p-500-pe-ratio)
- SPY PE 对照：[stockanalysis.com](https://stockanalysis.com/etf/spy/)
- 席勒 PE 对照：[multpl.com/shiller-pe](https://www.multpl.com/shiller-pe)

本项目仅供学习与信息展示，数据可能存在延迟或误差，自动生成的解读不构成任何投资建议。

## 参考的开源项目

- [lingzerg/us-market-risk-forecast](https://github.com/lingzerg/us-market-risk-forecast) — 架构参考（静态页 + GHA 快照 + Pages）
- [AndreasLM03/CNN-Fear-n-Greed-Scraper](https://github.com/AndreasLM03/CNN-Fear-n-Greed-Scraper) — CNN 端点抓取参考
- [dbogdanm/MarketSentiment](https://github.com/dbogdanm/MarketSentiment) — VIX 多源回退链参考
