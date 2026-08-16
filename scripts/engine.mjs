// ============================================================================
// engine.mjs — 规则引擎：把当日指标映射为结构化中文解读（纯函数，无网络）
// 阈值与文案风格对齐「标普500监测图」参考样例
// ============================================================================

export const FNG_BANDS = [
  { min: 0, max: 20, label: "极度恐慌", tone: -1 },
  { min: 21, max: 40, label: "恐慌", tone: -0.5 },
  { min: 41, max: 60, label: "中性", tone: 0 },
  { min: 61, max: 80, label: "贪婪", tone: 1 },
  { min: 81, max: 100, label: "极度贪婪", tone: -1 }, // 过热 → 谨慎
];

const FNG_BAND_TEXT = {
  极度恐慌: '当前处于"极度恐慌"区间，恐慌情绪浓厚，历史上极端恐慌区域往往对应中期布局窗口，可保持关注但不宜急于抄底。',
  恐慌: '当前处于"恐慌"区间，市场情绪偏冷，风险偏好受抑，观望为主。',
  中性: '当前处于"中性"区间，市场情绪平稳，无明显方向倾向。',
  贪婪: '当前处于"贪婪"区间，市场风险偏好回升，投资者情绪偏暖，但需警惕追高风险。',
  极度贪婪: '当前处于"极度贪婪"区间，市场情绪过热，需高度警惕回调与情绪反转风险。',
};

export function fngBand(value) {
  if (value == null) return null;
  for (const b of FNG_BANDS) if (value >= b.min && value <= b.max) return b;
  return null;
}

function vixBand(value) {
  if (value == null) return null;
  if (value < 15) return { label: "低波动", tone: 0.5, text: "VIX处于低波动区间，表明市场短期系统性恐慌有限，波动预期偏低。" };
  if (value <= 25) return { label: "中性波动", tone: 0, text: "VIX处于中性波动区间，市场波动预期处于正常水平。" };
  if (value <= 35) return { label: "高波动", tone: -1, text: "VIX处于高波动区间，市场恐慌情绪升温，需注意波动放大风险。" };
  return { label: "极高波动", tone: -2, text: "VIX处于极端高位，市场恐慌升温明显，系统性风险需高度警惕。" };
}

function peBand(pct) {
  if (pct == null) return null;
  if (pct < 30) return { label: "较低", tone: 1 };
  if (pct < 60) return { label: "中等", tone: 0 };
  if (pct < 75) return { label: "中等偏高", tone: -1 };
  return { label: "偏高", tone: -2 };
}

const PE_TEXT = {
  较低: "估值处于历史较低水平，安全边际相对充足，中长期配置性价比提升。",
  中等: "估值处于历史中等水平，整体不算极端，保持中性即可。",
  中等偏高: "估值处于历史中等偏高水平，继续追高的性价比一般。",
  偏高: "估值处于历史偏高水平，安全边际不足，需警惕估值回归风险。",
};

const PE_SUMMARY = {
  较低: "当前标普500TTM PE为{pe}，近10年分位为{pct}%，整体估值不高，安全边际相对充足。",
  中等: "当前标普500TTM PE为{pe}，近10年分位为{pct}%，整体估值处于合理区间。",
  中等偏高: "当前标普500TTM PE为{pe}，近10年分位为{pct}%，整体不算极端昂贵，但安全边际一般。",
  偏高: "当前标普500TTM PE为{pe}，近10年分位为{pct}%，整体估值偏贵，需防范估值回归风险。",
};

function marketLine(spx) {
  if (!spx || spx.changePct == null) return null;
  const pct = spx.changePct;
  let line;
  if (pct >= 0.5) line = "明显上涨，整体偏强运行，市场做多情绪活跃";
  else if (pct >= 0.1) line = "小幅上涨，整体偏强震荡，市场情绪回暖";
  else if (pct > -0.1) line = "基本平盘，多空力量均衡，市场方向不明";
  else if (pct > -0.5) line = "小幅下跌，整体偏弱震荡，市场观望情绪较浓";
  else line = "明显下跌，整体弱势运行，市场情绪承压";
  // 量能修饰
  const vols = (spx.history || []).slice(-21).map((h) => h.volume).filter((v) => v != null);
  if (vols.length >= 11) {
    const avg = vols.slice(0, -1).reduce((a, b) => a + b, 0) / (vols.length - 1);
    const ratio = vols[vols.length - 1] / avg;
    if (ratio > 1.3) line += "，成交明显放量";
    else if (ratio < 0.7) line += "，成交明显缩量";
  }
  return line;
}

function signalFrom(score) {
  if (score >= 1.5) return { color: "green", label: "绿灯：偏积极" };
  if (score > 0) return { color: "yellow", label: "黄灯：中性偏谨慎" };
  if (score === 0) return { color: "yellow", label: "黄灯：中性观望" };
  if (score > -1.5) return { color: "yellow", label: "黄灯：中性偏防御" };
  return { color: "red", label: "红灯：谨慎防守" };
}

const ADVICE = {
  green: [
    "当前信号偏积极，可维持既有仓位，逢回调适度分批参与。",
    "中长期投资者可正常定投或分批布局，避免一次性重仓追高。",
    "关注情绪是否过热（恐惧贪婪指数高于80）或估值分位显著抬升，出现时及时止盈部分仓位。",
  ],
  yellow: [
    "控制追高冲动，注意仓位管理。",
    "如为中长期投资者，可采用分批布局或定投方式参与，避免一次性重仓。",
    "持续跟踪情绪与估值变化，若后续情绪继续升温或估值进一步抬升，需更加谨慎。",
  ],
  red: [
    "以防守为主，控制总仓位，避免在恐慌初期盲目抄底。",
    "等待情绪与波动指标出现边际改善（如 VIX 见顶回落、恐惧贪婪指数脱离极度恐慌）后再分批参与。",
    "中长期投资者可坚持定投纪律，但宜降低单次投入金额，留足安全垫。",
  ],
};

const DIM_WORDS = {
  emotion: { hot: "偏暖", mid: "中性", cold: "偏冷" },
  vol: { low: "不高", mid: "正常", high: "偏高" },
};

/**
 * 生成当日完整解读
 * @param {{spx:object, fng:object, vix:object, pe:object}} d
 */
export function buildSummary(d) {
  const { spx, fng, vix, pe } = d;
  const fngB = fngBand(fng && fng.value);
  const vixB = vixBand(vix && vix.value);
  const peB = peBand(pe && pe.percentile);

  const score = (fngB ? fngB.tone : 0) + (vixB ? vixB.tone : 0) + (peB ? peB.tone : 0);
  const signal = signalFrom(score);

  // —— 三个维度的摘要句 ——
  const dimensions = [];
  if (fngB) {
    dimensions.push({
      name: "情绪端",
      tone: fngB.tone > 0.4 ? "偏暖" : fngB.tone < -0.4 ? "偏冷" : "中性",
      text:
        fngB.tone > 0.4 ? "市场情绪偏暖，风险偏好有所提升。" :
        fngB.tone < -0.4 ? "市场情绪偏冷，风险偏好承压，观望情绪上升。" :
        "市场情绪中性，方向不明。",
    });
  }
  if (vixB) {
    dimensions.push({
      name: "波动端",
      tone: vixB.tone > 0 ? "偏低" : vixB.tone < 0 ? "偏高" : "中性",
      text:
        vixB.tone > 0 ? "短期恐慌有限，市场波动预期较低。" :
        vixB.tone < 0 ? "波动预期抬升，需防范脉冲式下跌。" :
        "波动预期处于正常水平。",
    });
  }
  if (peB) {
    dimensions.push({
      name: "估值端",
      tone: peB.tone > 0 ? "偏低" : peB.tone < 0 ? "偏高" : "中性",
      text: PE_TEXT[peB.label] || "",
    });
  } else if (pe && pe.ttmPe != null) {
    dimensions.push({
      name: "估值端",
      tone: "暂缺",
      text: "估值历史分位数据暂缺，今日不参与综合打分。",
    });
  }

  // —— 综合结论 ——
  const emotionWord = fngB ? (fngB.tone > 0.4 ? DIM_WORDS.emotion.hot : fngB.tone < -0.4 ? DIM_WORDS.emotion.cold : DIM_WORDS.emotion.mid) : null;
  const volWord = vixB ? (vixB.tone > 0 ? DIM_WORDS.vol.low : vixB.tone < 0 ? DIM_WORDS.vol.high : DIM_WORDS.vol.mid) : null;
  const valWord = peB ? `处于${peB.label}水平` : null;

  let conclusion;
  const valPhrase = valWord ? `估值${valWord}` : "估值数据暂缺";
  if (signal.color === "green") {
    conclusion = `当前市场情绪${emotionWord ?? "中性"}、波动${volWord ?? "正常"}，${valPhrase}，整体信号偏积极，但需注意情绪过热与追高风险，可保持既有配置节奏，逢回调适度参与。`;
  } else if (signal.color === "red") {
    conclusion = `当前市场情绪${emotionWord ?? "偏冷"}、波动${volWord ?? "偏高"}，${valPhrase}，整体风险大于机会，建议以防守为主、控制仓位，等待信号改善后再行参与。`;
  } else {
    conclusion = `当前市场情绪${emotionWord ?? "中性"}、波动${volWord ?? "正常"}，但${valPhrase}，整体更适合保持中性偏谨慎态度，耐心观察，避免盲目追高。`;
  }

  // —— 估值段落（带具体数字） ——
  const valuationText =
    pe && pe.ttmPe != null
      ? pe.percentile != null
        ? (PE_SUMMARY[peB?.label] || "").replace("{pe}", pe.ttmPe.toFixed(2)).replace("{pct}", pe.percentile.toFixed(2))
        : `当前标普500TTM PE为${pe.ttmPe.toFixed(2)}，PE历史分位暂缺。`
      : null;

  const fngText = fngB ? FNG_BAND_TEXT[fngB.label] : null;
  const vixText = vixB ? vixB.text : null;

  return {
    marketLine: marketLine(spx),
    signal,
    score: Math.round(score * 10) / 10,
    dimensions,
    fngText,
    vixText,
    valuationText,
    conclusion,
    advice: ADVICE[signal.color],
  };
}
