/**
 * 選配的判讀層：把當日抓到的原始條目交給 Claude，依你原本 prompt 的架構
 * 產生「今日重點摘要」與每則的「為何重要／市場影響」。
 *
 * 沒有設定 ANTHROPIC_API_KEY 時整層會被跳過，管線照常輸出標題與摘要，
 * 只是少了判讀段落 —— 抓取永遠不會因為這層失敗而中斷。
 */

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-8";

export const enabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** 各領域的分析師人設，取自你先前寫的三段 prompt。 */
const PERSONA = {
  esg: `你是一位永續發展（ESG／sustainability）領域的每日簡報分析師。聚焦台灣，以及永續領域的領頭國家（歐盟、德國、北歐、日本、美國、新加坡）。
關注面向：政策與法規（碳費、碳交易、CBAM、IFRS S1/S2、CSRD、GRI）、產業動態（淨零承諾、綠能、循環經濟、供應鏈永續）、永續人才與職缺趨勢、新興概念與方法論、指標性事件與爭議。`,

  geo: `你是一位同時熟悉 AI 技術與地理資訊（GIS／Geospatial）的科技情報分析師。
關注面向：AI 龍頭企業（OpenAI、Anthropic、Google DeepMind、Meta AI、Microsoft、NVIDIA、xAI）的重要發布與研究突破；LLM、多模態、AI Agent、AI 基礎設施進展；科技領袖的重要發言；AI 政策與監管；GIS 平台動態（Esri／ArcGIS、Google Maps Platform、HERE、Mapbox）；遙測、無人機、衛星技術；智慧城市與數位孿生。
特別留意「GIS × AI 交會處」的動態，這是使用者最關心的部分。`,

  us: `你是一位美股每日動態分析師。依消息面、技術面、基本面、籌碼情緒面、總體經濟面五個面向判讀當日美股。
關注：具市場影響力的重大新聞、財報（EPS 實際 vs 預期、營收、展望）、聯準會官員發言與政策訊號、地緣政治事件、板塊強弱輪動。`,

  tw: `你是一位台股每日動態分析師，同時熟悉美股對台股的聯動效應。
關注：台積電等權值股動向、三大法人籌碼、產業族群輪動、台幣匯率對出口廠商的影響，以及前一日美股走勢對今日台股開盤的推估。
判讀連動性時請區分：美股若由科技／半導體領漲，台股連動性高；若由金融、能源等傳統產業帶動，連動性較低。`,
};

const SCHEMA = {
  type: "object",
  properties: {
    digest: {
      type: "string",
      description: "今日重點摘要，3–5 句繁體中文，點出當天最值得關注的 2–3 件事",
    },
    watch: {
      type: "array",
      description: "值得追蹤：未來幾天可能發展的議題，2–4 條",
      items: { type: "string" },
    },
    items: {
      type: "array",
      description: "對應輸入條目的判讀，順序與 index 一致",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "對應輸入條目的編號" },
          why: {
            type: "string",
            description: "為何重要／市場影響，一到兩句繁體中文，具體且避免空話",
          },
        },
        required: ["index", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["digest", "watch", "items"],
  additionalProperties: false,
};

/**
 * @param {string} domain  esg | geo | us | tw
 * @param {Array}  items   curate() 後的條目
 * @param {object} extra   行情等補充脈絡（美股／台股用）
 */
export async function analyze(domain, items, extra = null) {
  if (!enabled() || !items.length) return null;

  const client = new Anthropic();
  const today = new Date().toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" });

  const list = items
    .map((it, i) => `[${i}] ${it.title}\n    來源：${it.source}｜${it.summary || "（無摘要）"}`)
    .join("\n");

  const context = extra
    ? `\n\n今日行情數據（供判讀參考）：\n${JSON.stringify(extra, null, 2)}`
    : "";

  const system = `${PERSONA[domain]}

以繁體中文撰寫。每則判讀簡潔扼要，一到兩句，說明「為何重要」而不是複述標題。
不確定的事情不要編造；若某則資訊不足以判讀，就誠實寫出它的侷限。`;

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `今天是 ${today}。以下是過去 24 小時內抓取到的條目，請依你的分析架構產出重點摘要、每則的判讀，以及值得追蹤的議題。

${list}${context}`,
        },
      ],
    });

    if (res.stop_reason === "refusal") {
      console.warn(`  ✗ 判讀 ${domain} — 模型婉拒回應`);
      return null;
    }

    const text = res.content.find((b) => b.type === "text")?.text;
    if (!text) return null;
    const parsed = JSON.parse(text);
    console.log(`  ✓ 判讀 ${domain} — 摘要 + ${parsed.items?.length ?? 0} 則`);
    return parsed;
  } catch (err) {
    console.warn(`  ✗ 判讀 ${domain} — ${err.message}`);
    return null;
  }
}

/** 把判讀結果併回條目上。 */
export function merge(items, analysis) {
  if (!analysis) return { items, digest: null, watch: [] };
  const byIndex = new Map((analysis.items || []).map((a) => [a.index, a.why]));
  return {
    items: items.map((it, i) => ({ ...it, why: byIndex.get(i) || null })),
    digest: analysis.digest || null,
    watch: analysis.watch || [],
  };
}
