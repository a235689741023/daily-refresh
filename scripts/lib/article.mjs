/**
 * 文章正文抓取。
 *
 * RSS 的 description 欄位不能當摘要用 —— Google News 給的是標題本身，
 * 其他來源給的是被截斷的第一段。要做出真正的摘要，必須把文章本文抓回來。
 *
 * 兩個步驟：
 *   1. Google News 的連結是 JS 跳轉頁，先用官方的 batchexecute 端點解析出原文網址。
 *   2. 抓原文頁面，抽出正文段落（去掉導覽、廣告、頁尾等雜訊）。
 */

import { fetchText, mapLimit } from "./http.mjs";
import { clean } from "./rss.mjs";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
};

/* ── Google News 跳轉解析 ────────────────────────────────── */

export const isGoogleNews = (url) => /(^|\/\/)news\.google\.com\//.test(url || "");

/**
 * Google News 的 /rss/articles/ 連結不含原文網址，頁面靠 JS 跳轉。
 * 頁面 HTML 裡有 id / timestamp / signature 三個參數，
 * 帶著它們打官方的 batchexecute 端點就能換回真正的文章網址。
 */
export async function resolveGoogleNews(url) {
  const html = await fetchText(url, { headers: HEADERS, timeout: 20000, retries: 1 });

  const id = /data-n-a-id="([^"]+)"/.exec(html)?.[1];
  const ts = /data-n-a-ts="([^"]+)"/.exec(html)?.[1];
  const sg = /data-n-a-sg="([^"]+)"/.exec(html)?.[1];
  if (!id || !ts || !sg) throw new Error("跳轉頁缺少簽章參數");

  const inner = JSON.stringify([
    "garturlreq",
    [["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],
     "X","X",1,[1,1,1],1,1,null,0,0,null,0],
    id, Number(ts), sg,
  ]);
  const payload = JSON.stringify([[["Fbv4je", inner, null, "generic"]]]);

  const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": BROWSER_UA,
    },
    body: "f.req=" + encodeURIComponent(payload),
  });
  if (!res.ok) throw new Error(`batchexecute HTTP ${res.status}`);

  const text = await res.text();
  const real = /\[\\"garturlres\\",\\"(.*?)\\"/.exec(text)?.[1];
  if (!real) throw new Error("回應中找不到原文網址");
  return real.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
}

/* ── 正文抽取 ───────────────────────────────────────────── */

/** 這些區塊裡的文字一定不是正文，先整段拿掉。 */
const NOISE = /<(script|style|noscript|nav|header|footer|aside|form|figure|iframe|svg)\b[\s\S]*?<\/\1>/gi;

/**
 * 段落層級的雜訊。除了訂閱／版權／分享這類老面孔，也擋掉介面提示文字
 * —— Esri 的頁面會把「這個功能不支援手機，請用桌機開啟」寫在 <p> 裡，
 * 混進摘要會很奇怪。
 */
const JUNK =
  /(訂閱|追蹤我們|版權所有|著作權|相關新聞|延伸閱讀|免責聲明|本文不構成|投資建議|加入.*會員|下載.*APP|廣告|請開啟|不支援|Advertisement|Subscribe|Sign up|Sign in|Log in|Read more|Related|Copyright|All rights reserved|Follow us|Share this|cookie|not available for mobile|come back on a desktop|enable JavaScript|your browser|Terms of (Use|Service)|Privacy Policy)/i;

/** 作者列、日期列這類非正文的短行。 */
const BYLINE = /^(By\s+[A-Z]|作者[：:]|文[／/]|撰文|編譯|記者\s)/;

/**
 * 段落尾巴常黏著「詳細資訊請看內頁：https://…」這類導流句，
 * 混進摘要裡很難看，在這裡先清掉。
 */
function tidy(text) {
  return text
    .replace(/(詳細資訊|更多資訊|完整內容|原文連結|延伸閱讀)[^。]{0,12}[：:]\s*\S*/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 從一段 HTML 取出可用的段落文字。 */
function paragraphs(fragment) {
  const seen = new Set();
  const out = [];
  for (const m of fragment.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const t = tidy(clean(m[1], 100000));
    if (t.length < 40 || JUNK.test(t) || BYLINE.test(t)) continue;
    const k = t.slice(0, 50);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * 從 HTML 抽出正文。
 *
 * 用 <p> 標籤當骨架 —— 幾乎所有新聞網站的正文都在 <p> 裡，導覽列與按鈕則不是。
 * 難點在於挑對容器：直接信任第一個命中的 <article> 或 class 名稱很容易抓到
 * 側欄的小片段（CNBC 就是這樣，命中的 div 只有 1KB 且不含正文），所以改成
 * 把幾個候選範圍都試一遍，取段落總字數最多的那個。
 */
export function extractBody(html, { maxChars = 6000 } = {}) {
  const stripped = String(html).replace(NOISE, " ");

  const candidates = [stripped];
  for (const re of [
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<div[^>]+(?:class|id)="[^"]*(?:article-?body|post-content|entry-content|story-body|main-content|RenderKeyPoints|ArticleBody)[^"]*"[^>]*>([\s\S]*)/gi,
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi,
  ]) {
    for (const m of stripped.matchAll(re)) candidates.push(m[1]);
  }

  let best = [];
  let bestLen = 0;
  for (const c of candidates) {
    const ps = paragraphs(c);
    const len = ps.reduce((a, p) => a + p.length, 0);
    // 容器越窄越好，但字數明顯較多時才換 —— 避免被側欄的零星段落拉走
    if (len > bestLen * 1.15) {
      best = ps;
      bestLen = len;
    }
  }

  const out = [];
  let total = 0;
  for (const p of best) {
    out.push(p);
    total += p.length;
    if (total >= maxChars) break;
  }
  return out.join("\n");
}

/**
 * 備援：Jina Reader（r.jina.ai）。
 *
 * ESG Today、Geospatial World 這類站有 Cloudflare 阻擋，換 UA 或補齊瀏覽器
 * 標頭都還是 403。這個免金鑰的公開服務會把頁面轉成乾淨的 markdown，
 * 只在直接抓取失敗時才用，避免不必要地依賴第三方。
 */
/**
 * Reader 是免金鑰的共用服務，平行打會很快被限流（實測同時發四個請求就開始回
 * 403）。所有 Reader 呼叫共用一條序列並保持間隔，寧可慢一點也要拿得到。
 */
let readerChain = Promise.resolve();
function queueReader(fn) {
  const run = readerChain.then(async () => {
    const r = await fn();
    await new Promise((res) => setTimeout(res, 1500));
    return r;
  });
  readerChain = run.then(() => {}, () => {});
  return run;
}

async function viaReader(url) {
  const md = await queueReader(() =>
    fetchText(`https://r.jina.ai/${url}`, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/plain" },
      timeout: 40000,
      retries: 2,
    })
  );

  // 去掉開頭的 Title/URL Source/Published Time 標頭，只留正文
  const start = md.indexOf("Markdown Content:");
  const body = start >= 0 ? md.slice(start + "Markdown Content:".length) : md;

  return body
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, " ")   // 圖片與連結語法
    .replace(/^[#>*\-\s]+$/gm, "")            // 純符號的行
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => tidy(l))
    .filter((l) => l.length >= 40 && !JUNK.test(l) && !BYLINE.test(l))
    .join("\n")
    .slice(0, 6000);
}

/** 抓不到正文時的備援：meta description 至少是編輯寫的，比第一段好。 */
function metaDescription(html) {
  const m =
    /<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i.exec(html) ||
    /<meta[^>]+name="description"[^>]+content="([^"]+)"/i.exec(html);
  return m ? clean(m[1], 400) : "";
}

/**
 * 取得一則條目的正文。
 * @returns {{url:string, body:string, resolved:boolean}}
 */
export async function fetchArticle(item) {
  let url = item.url;
  let resolved = false;

  if (isGoogleNews(url)) {
    url = await resolveGoogleNews(url);
    resolved = true;
  }

  try {
    const html = await fetchText(url, { headers: HEADERS, timeout: 25000, retries: 1 });
    const body = extractBody(html);
    if (body && body.length >= 200) return { url, body, resolved, via: "direct" };

    // 直接抓到了但抽不出足夠正文（多半是靠 JS 渲染），走 Reader 再試一次
    const alt = await viaReader(url).catch((e) => { console.warn(`    Reader 失敗 ${url.slice(0,50)} — ${e.message}`); return ""; });
    return { url, body: alt || body || metaDescription(html), resolved, via: alt ? "reader" : "meta" };
  } catch (err) {
    // 被擋（Cloudflare 之類）就改走 Reader
    try {
      const body = await viaReader(url);
      if (body && body.length >= 200) return { url, body, resolved, via: "reader" };
    } catch { /* Reader 也失敗就往下拋原始錯誤 */ }

    // 正文抓不到不代表白忙一場：還原後的網址仍然比 Google News 的跳轉連結好，
    // 讓使用者點下去直接到原文，所以照樣把 url 帶回去。
    err.url = url;
    err.resolved = resolved;
    throw err;
  }
}

/**
 * 批次取得正文。個別失敗不影響其他條目 —— 抓不到的就保留原本的 RSS 摘要，
 * 寧可摘要品質差一點也不要整則不見。
 */
export async function enrich(items, { concurrency = 4 } = {}) {
  let ok = 0, failed = 0, redirected = 0, readerUsed = 0;

  const out = await mapLimit(items, concurrency, async (item) => {
    try {
      const { url, body, resolved, via } = await fetchArticle(item);
      if (resolved) redirected++;
      if (!body || body.length < 80) throw Object.assign(new Error("正文太短或抽不到"), { url, resolved });
      ok++;
      if (via === "reader") readerUsed++;
      return { ...item, url, body };
    } catch (err) {
      failed++;
      if (err.resolved) redirected++;
      return { ...item, url: err.url || item.url, body: null, bodyError: err.message };
    }
  });

  console.log(`  正文：成功 ${ok}／失敗 ${failed}（${redirected} 則還原原文網址，${readerUsed} 則走 Reader 備援）`);
  return out;
}
