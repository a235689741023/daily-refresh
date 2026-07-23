/**
 * 資訊來源註冊表
 *
 * 每個來源都有 weight（排序權重，數字越大越優先）與 tag（顯示標籤）。
 * 任何一個來源失敗都不會影響其他來源 —— fetch-all.mjs 逐一 try/catch。
 *
 * Google News RSS 用於補足沒有官方 feed 的媒體（CSRone、Reuters、Bloomberg 等），
 * 它會回傳跳轉連結，lib/rss.mjs 會嘗試還原成原始網址。
 */

const gnews = (q, { hl = "zh-TW", gl = "TW", ceid = "TW:zh-Hant" } = {}) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;

const gnewsEN = (q) => gnews(q, { hl: "en-US", gl: "US", ceid: "US:en" });

export const DOMAINS = {
  /* ── 1. ESG 永續 ───────────────────────────────────────────── */
  esg: {
    title: "永續 ESG",
    keep: 10,
    feeds: [
      { name: "Trellis",       url: "https://trellis.net/feed/",       tag: "國際", weight: 8 },
      { name: "ESG News",      url: "https://esgnews.com/feed/",        tag: "國際", weight: 6 },
      // 以下來源沒有可用的官方 feed（Cloudflare 阻擋或未提供），改由 Google News 取得。
      // 條目仍會連回各媒體原文，只是探索路徑不同。
      { name: "ESG Today",     url: gnewsEN("site:esgtoday.com"),               tag: "國際", weight: 9 },
      { name: "環境資訊中心",   url: gnews("site:e-info.org.tw"),                 tag: "台灣", weight: 8 },
      { name: "CSRone",        url: gnews("site:csrone.com"),                   tag: "台灣", weight: 7 },
      { name: "台灣永續政策",   url: gnews("碳費 OR 碳交易 OR 永續報告書 OR 淨零 台灣"), tag: "台灣", weight: 7 },
      { name: "國際法規",       url: gnewsEN("CSRD OR CBAM OR \"IFRS S2\" OR ISSB sustainability disclosure"), tag: "法規", weight: 8 },
      { name: "永續人才",       url: gnews("永續 人才 OR 職缺 OR ESG 人力"),        tag: "人才", weight: 4 },
    ],
  },

  /* ── 2. 地理資訊 & AI ─────────────────────────────────────── */
  geo: {
    title: "地理資訊・AI",
    keep: 12,
    groups: ["gis", "ai"],
    feeds: [
      // 空間資訊
      { name: "ArcGIS Blog",        url: gnewsEN("site:esri.com arcgis"),                 tag: "平台", group: "gis", weight: 9 },
      { name: "Geospatial World",   url: "https://geospatialworld.net/feed/",             tag: "產業", group: "gis", weight: 8 },
      { name: "Google Maps Blog",   url: "https://blog.google/products/maps/rss/",        tag: "平台", group: "gis", weight: 7 },
      { name: "GIS Lounge",         url: "https://www.gislounge.com/feed/",               tag: "應用", group: "gis", weight: 5 },
      { name: "GIS × AI 研究",      url: gnewsEN("geospatial AI OR \"spatial AI\" OR \"remote sensing\" foundation model"), tag: "研究", group: "gis", weight: 7 },

      // 人工智慧
      { name: "Anthropic",          url: gnewsEN("site:anthropic.com"),                   tag: "模型", group: "ai", weight: 9 },
      { name: "OpenAI",             url: "https://openai.com/news/rss.xml",               tag: "模型", group: "ai", weight: 9 },
      { name: "Google DeepMind",    url: "https://deepmind.google/blog/rss.xml",          tag: "模型", group: "ai", weight: 8 },
      { name: "Google AI Blog",     url: "https://blog.google/technology/ai/rss/",        tag: "模型", group: "ai", weight: 7 },
      { name: "MIT Tech Review",    url: "https://www.technologyreview.com/topic/artificial-intelligence/feed/", tag: "趨勢", group: "ai", weight: 8 },
      { name: "NVIDIA Blog",        url: "https://blogs.nvidia.com/feed/",                tag: "基建", group: "ai", weight: 6 },
      { name: "AI 政策",            url: gnewsEN("AI regulation OR \"AI Act\" OR AI policy"), tag: "政策", group: "ai", weight: 6 },
    ],
  },

  /* ── 3. 美股 ──────────────────────────────────────────────── */
  us: {
    title: "美股",
    keep: 10,
    feeds: [
      { name: "CNBC Markets",  url: "https://www.cnbc.com/id/10000664/device/rss/rss.html",       tag: "大盤", weight: 9 },
      { name: "CNBC Economy",  url: "https://www.cnbc.com/id/20910258/device/rss/rss.html",       tag: "總經", weight: 8 },
      { name: "MarketWatch",   url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", tag: "大盤", weight: 8 },
      { name: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex",                    tag: "個股", weight: 6 },
      { name: "Reuters 財經",  url: gnewsEN("site:reuters.com stock market OR Federal Reserve"),  tag: "總經", weight: 8 },
      { name: "Bloomberg",     url: gnewsEN("site:bloomberg.com markets OR earnings"),            tag: "大盤", weight: 7 },
      { name: "財報",          url: gnewsEN("earnings beat OR earnings miss guidance S&P 500"),   tag: "財報", weight: 6 },
    ],
  },

  /* ── 4. 台股 ──────────────────────────────────────────────── */
  tw: {
    title: "台股",
    keep: 10,
    feeds: [
      { name: "鉅亨網 台股",   url: "https://news.cnyes.com/rss/v1/news/category/tw_stock", tag: "大盤", weight: 9 },
      { name: "鉅亨網 頭條",   url: "https://news.cnyes.com/rss/v1/news/category/headline", tag: "焦點", weight: 7 },
      { name: "中央社 財經",   url: "https://feeds.feedburner.com/rsscna/finance",          tag: "總經", weight: 8 },
      { name: "經濟日報 股市", url: "https://money.udn.com/rssfeed/news/1001/5591?ch=money", tag: "個股", weight: 8 },
      // MoneyDJ 的 feed XML 不合規（屬性間缺空白）會解析失敗，改由 Google News 取得
      { name: "MoneyDJ",       url: gnews("site:moneydj.com 台股"),                        tag: "籌碼", weight: 6 },
      { name: "台積電動向",    url: gnews("台積電 OR 2330 法人 OR 目標價"),                  tag: "權值", weight: 8 },
      { name: "外資籌碼",      url: gnews("外資 買超 OR 賣超 台股 三大法人"),                 tag: "籌碼", weight: 7 },
    ],
  },
};

/* ── 行情資料來源（非 RSS） ─────────────────────────────────── */

// 行情來源，symbol 為 FRED 序列代號（聯準會官方 CSV、免金鑰、不限流）。
// 曾評估 Stooq（已加瀏覽器 JS 驗證）與 Yahoo Finance（很容易 429，在 CI 的
// 共用 IP 上更明顯），兩者都不適合排程使用。
export const QUOTES = {
  us: [
    { key: "spx", name: "S&P 500", symbol: "SP500" },
    { key: "ndq", name: "Nasdaq",  symbol: "NASDAQCOM" },
    { key: "dji", name: "Dow 30",  symbol: "DJIA" },
  ],
  vix: { key: "vix", name: "VIX", symbol: "VIXCLS" },
  // 台股聯動用：台積電 ADR（stockanalysis）與美元兌台幣（FRED）
  link: [
    { key: "tsm",    name: "台積電 ADR", symbol: "TSM" },
    { key: "usdtwd", name: "美元／台幣", symbol: "DEXTAUS" },
  ],
};

// 證交所 / 櫃買（官方、免金鑰、JSON）
export const TWSE = {
  // 大盤指數收盤（含發行量加權股價指數）
  index:  "https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX",
  // 每日收盤行情（全部股票）—— 用來取台積電等指標股
  stocks: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  // 櫃買中心 主板每日收盤
  tpex:   "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
  // 三大法人買賣金額統計：OpenAPI 已無此端點，改用官網 rwd 端點（見 markets.mjs）
};

// 台股指標股（依你的 prompt：台積電必追，其餘視當日熱點）
export const TW_WATCH = [
  { code: "2330", name: "台積電" },
  { code: "2454", name: "聯發科" },
  { code: "2317", name: "鴻海" },
];
