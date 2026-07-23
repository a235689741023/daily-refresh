# Daily Refresh

手機用的個人晨間簡報 PWA。每天早上一次看完四個領域的最新動態，外加三個輕鬆的小區塊。

- **永續 ESG**｜**地理資訊・AI**｜**美股**｜**台股** — 每日自動抓取，每則附原文連結
- **今日豆單** — 50 支世界手沖豆輪替，搭配 27 段互動咖啡風味輪猜風味
- **今日德諺** — 32 句德文諺語，可用裝置語音唸出
- **肌群連連看** — 22 個重訓動作、21 組肌群的雙圖版解剖圖，答對後展開協同肌鏈

---

## 快速開始

```bash
npm install
npm run fetch     # 抓一次資料到 public/data/
npm run serve     # 本機預覽，手機連同一個 Wi-Fi 即可開
```

`npm run serve` 會印出區網網址，用手機瀏覽器打開後選「加入主畫面」，就會以全螢幕獨立 App 的方式運作。

---

## 部署到 GitHub Pages

1. 把這個資料夾推到一個 GitHub repo。
2. repo 的 **Settings → Pages → Source** 選 **GitHub Actions**。
3. 完成。`.github/workflows/daily.yml` 會在台北時間 **每天 06:30 與 12:30** 自動抓取並重新部署，也可以在 Actions 頁面手動觸發。

抓下來的資料會 commit 回 repo，一方面留下歷史，一方面當作下次抓取失敗時的備援。

### 選配：加上 AI 判讀

不設定也能正常運作，只是每則新聞少了「為何重要」、也不會有「今日重點摘要」。

在 repo 的 **Settings → Secrets and variables → Actions** 新增 secret `ANTHROPIC_API_KEY`，
抓取流程就會多跑一層 Claude 判讀（`scripts/lib/summarize.mjs`），依照四個領域各自的分析師人設產出：

- 今日重點摘要（3–5 句）
- 每則的「為何重要／市場影響」
- 值得追蹤的議題

本機測試時 `export ANTHROPIC_API_KEY=...` 再跑 `npm run fetch` 即可。

---

## 摘要怎麼產生的

RSS 的 `description` 欄位**不能**當摘要用：Google News 給的是標題本身，其他來源給的是被截斷的第一段。所以摘要一律重新產生：

1. **還原原文網址** — Google News 的連結是 JS 跳轉頁，用它官方的 batchexecute 端點換回真正的文章網址（順帶讓卡片連結直接指向原文）。
2. **抓回文章正文** — 抓原文頁面，用 `<p>` 標籤當骨架抽出正文。難點在挑對容器：直接信任第一個命中的 `<article>` 很容易抓到側欄碎片，所以改成把幾個候選範圍都試一遍、取段落總字數最多的那個。被 Cloudflare 擋或前端渲染的站，退而使用 Jina Reader（免金鑰，序列化呼叫避免限流）。
3. **產生摘要** —
   - 有 `ANTHROPIC_API_KEY`：Claude 讀正文寫 2–3 句繁中摘要＋「為何重要」，正文抓不到的條目則開放 `web_fetch` 讓模型自己去讀。
   - 沒有 key：從正文取開頭的完整句子，**斷在句號**而不是切在第 160 個字元。小數點（3.57 億）、縮寫（U.S.、J.P.）、網域都不會被誤判成句尾。

抓不到正文又沒有 API key 時，`summary` 留空，前端只顯示標題——這比把標題再貼一次當摘要誠實。實測覆蓋率約 **88%**（40 則中 35 則有真摘要）。

---

## 資料來源

每個來源都獨立 try/catch，任何一個掛掉都不影響其他來源；若某個領域整批抓不到，會保留上一次的資料而不是寫入空檔案。

| 領域 | 來源 |
|---|---|
| ESG | Trellis、ESG News、ESG Today、環境資訊中心、CSRone，加上碳費／CSRD／CBAM 等關鍵字追蹤 |
| 地理資訊・AI | ArcGIS、Geospatial World、Google Maps Platform、GIS Lounge｜Anthropic、OpenAI、Google DeepMind、Google AI、MIT Tech Review、NVIDIA |
| 美股 | CNBC Markets／Economy、MarketWatch、Yahoo Finance、Reuters、Bloomberg |
| 台股 | 鉅亨網、中央社財經、經濟日報、MoneyDJ，加上台積電與外資籌碼追蹤 |

**行情資料**（皆免金鑰）：

| 資料 | 來源 |
|---|---|
| S&P 500、Nasdaq、道瓊、VIX、美元／台幣 | FRED（聖路易聯準銀行官方 CSV） |
| 加權指數、三大法人買賣超、指標股 | 台灣證券交易所 |
| 櫃買市場漲跌家數 | 證券櫃檯買賣中心 |
| 台積電 ADR | stockanalysis.com |

幾個選型上的取捨，寫下來免得日後重踩：

- **Stooq**（原本的首選）已加上瀏覽器 JS 驗證，伺服器端取不到，改用 FRED。
- **Yahoo Finance** 的 chart 端點很容易回 429，在 CI 的共用 IP 上更明顯，因此只在 FRED 沒有的項目上使用。
- **ESG Today、Esri ArcGIS Blog** 的官方 feed 被 Cloudflare 擋；**環境資訊中心、Anthropic** 沒有公開 feed；**MoneyDJ** 的 feed XML 不合規會解析失敗。這五個改由 Google News 的 `site:` 查詢取得，條目仍然連回各媒體原文。
- **加權指數的走勢圖** 沒有免金鑰的歷史來源，改由 `public/data/markets.json` 每天累積收盤價（保留 60 個交易日）。剛部署時線圖會比較短，跑幾天就完整了。

---

## 專案結構

```
.github/workflows/daily.yml   每日排程：抓取 → commit → 部署
scripts/
  sources.mjs                 所有來源的註冊表（要增刪來源改這裡）
  fetch-all.mjs               主流程
  serve.mjs                   本機預覽伺服器
  lib/
    http.mjs                  逾時、重試、併發控制
    rss.mjs                   RSS 解析、清洗、去重、依權重與新鮮度排序
    markets.mjs               FRED / 證交所 / 櫃買 / ADR 與台股聯動判讀
    summarize.mjs             選配的 Claude 判讀層
public/
  index.html  styles.css  js/app.js
  manifest.webmanifest  sw.js  icons/
  data/
    esg|geo|us|tw.json        每日抓取產出
    markets.json              行情
    beans.json                50 支咖啡豆
    proverbs.json             32 句德文諺語
    exercises.json            22 個重訓動作
```

---

## 日常維護

**加一個新聞來源** — 編輯 `scripts/sources.mjs`，在對應領域的 `feeds` 加一行。`weight` 越大排序越前面（1–10），`tag` 是卡片上的標籤。沒有官方 feed 的媒體可以用檔案上方的 `gnews("site:example.com")` 輔助函式。

**加咖啡豆／諺語／動作** — 直接編輯 `public/data/` 底下對應的 JSON，不必動程式碼。

- 咖啡豆的 `notes` 必須是風味輪上的 27 個子風味之一，答案才對得上（風味輪定義在 `app.js` 的 `WHEEL`）。
- 動作的 `m`（主動肌）與 `sec`（協同肌）必須是 `app.js` 中 `MUSCLES` 的 id，`exercises.json` 頂端有完整清單。

**驗證資料一致性**：

```bash
node -e '
const fs=require("fs"),app=fs.readFileSync("public/js/app.js","utf8");
const wb=app.slice(app.indexOf("const WHEEL = ["),app.indexOf("let ANSWERS"));
const fl=new Set([...wb.matchAll(/subs:\[([^\]]+)\]/g)].flatMap(m=>m[1].split(",").map(s=>s.replace(/["\s]/g,""))));
const ids=new Set([...app.matchAll(/\{id:"(\w+)", n:"/g)].map(m=>m[1]));
JSON.parse(fs.readFileSync("public/data/beans.json")).beans.forEach(b=>b.notes.forEach(n=>fl.has(n)||console.log("風味對不上:",b.name,n)));
JSON.parse(fs.readFileSync("public/data/exercises.json")).exercises.forEach(x=>[x.m,...x.sec].forEach(i=>ids.has(i)||console.log("肌群 id 無效:",x.n,i)));
console.log("檢查完成");'
```

**只重抓單一領域**：`ONLY=tw npm run fetch`
**抓但不寫檔（除錯）**：`npm run fetch:dry`

---

## 已知限制

- 顯示用的字體目前走系統襯線字（Palatino／宋體），還沒把 Cinzel 這類雕刻感字型打包進 repo。要換的話把字型檔放進 `public/fonts/`，在 `styles.css` 的 `--serif` 前面加上 `@font-face`。
- 解剖圖的座標是手工繪製的 SVG 路徑，比例若要微調，改 `app.js` 中 `MUSCLES` 陣列的 `d` 與 `fib`。
- Google News 取得的條目，連結是 Google 的跳轉網址（點了會導到原文）。程式會優先抽出內嵌的原始網址，抽不到才保留跳轉連結。
