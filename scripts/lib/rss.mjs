/** RSS 解析、清洗、去重、排序。 */

import Parser from "rss-parser";
import { fetchText, mapLimit } from "./http.mjs";

const parser = new Parser({
  timeout: 20000,
  customFields: { item: [["content:encoded", "contentEncoded"], ["dc:creator", "creator"]] },
});

/** 移除 HTML 標籤與多餘空白，截斷到指定長度。 */
export function clean(html = "", max = 160) {
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/[，、,；;]\S*$/, "") + "…";
}

/**
 * Google News 的連結是跳轉網址。優先取用 item 內嵌的原始連結，
 * 取不到就保留跳轉網址（仍然點得開）。
 */
function resolveLink(item) {
  const raw = item.link || "";
  if (!raw.includes("news.google.com")) return raw;
  // Google News 有時把原文網址放在描述的 <a href> 裡
  const m = /<a[^>]+href="(https?:\/\/(?!news\.google)[^"]+)"/i.exec(item.content || "");
  return m ? m[1] : raw;
}

/** Google News 標題結尾常帶「 - 媒體名」，抽出來當真正的來源。 */
function splitGNewsTitle(title, fallback) {
  const m = /^(.*)\s+-\s+([^-]{2,30})$/.exec(title || "");
  if (m) return { title: m[1].trim(), source: m[2].trim() };
  return { title: (title || "").trim(), source: fallback };
}

/** 抓單一 feed，回傳標準化的條目陣列。任何錯誤都往上拋，由呼叫端記錄。 */
export async function fetchFeed(feed) {
  const xml = await fetchText(feed.url, { timeout: 20000, retries: 1 });
  const parsed = await parser.parseString(xml);
  const isG = feed.url.includes("news.google.com");

  return (parsed.items || []).map((item) => {
    const { title, source } = isG
      ? splitGNewsTitle(item.title, feed.name)
      : { title: (item.title || "").trim(), source: feed.name };

    const published = item.isoDate || item.pubDate || null;
    return {
      title,
      summary: clean(item.contentSnippet || item.contentEncoded || item.content || item.summary || ""),
      url: resolveLink(item),
      source,
      tag: feed.tag || "",
      group: feed.group || null,
      weight: feed.weight ?? 5,
      published: published ? new Date(published).toISOString() : null,
    };
  });
}

/** 抓一組 feed，個別失敗不影響整體。回傳 { items, errors }。 */
export async function fetchFeeds(feeds, { concurrency = 5 } = {}) {
  const errors = [];
  const results = await mapLimit(feeds, concurrency, async (feed) => {
    try {
      const items = await fetchFeed(feed);
      console.log(`  ✓ ${feed.name} — ${items.length} 則`);
      return items;
    } catch (err) {
      console.warn(`  ✗ ${feed.name} — ${err.message}`);
      errors.push({ source: feed.name, url: feed.url, message: err.message });
      return [];
    }
  });
  return { items: results.flat(), errors };
}

/** 標題正規化，用於偵測不同媒體報導同一則新聞。 */
const norm = (s) =>
  s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "").slice(0, 40);

/**
 * 過濾近 N 小時、去除重複、依「權重 + 新鮮度」排序，取前 keep 則。
 * 若近 N 小時的量不足（假日、來源異常），自動放寬時間窗，但無論如何都不放行
 * 超過 maxAgeDays 的條目 —— 這是硬性上限，避免來源異常時把好幾年前的頁面
 * （例如 Google News 查到的常駐產品頁）當成新聞漏出來。
 */
export function curate(items, { hours = 30, keep = 10, minItems = 4, maxAgeDays = 7 } = {}) {
  const seenUrl = new Set();
  const seenTitle = new Set();

  const dedupe = (list) =>
    list.filter((it) => {
      if (!it.title || !it.url) return false;
      const t = norm(it.title);
      if (t.length < 6) return false;
      if (seenUrl.has(it.url) || seenTitle.has(t)) return false;
      seenUrl.add(it.url);
      seenTitle.add(t);
      return true;
    });

  const within = (h) => {
    const cutoff = Date.now() - h * 3600 * 1000;
    return items.filter((it) => !it.published || new Date(it.published).getTime() >= cutoff);
  };

  let pool = within(hours);
  // 假日或來源異常時放寬視窗，寧可舊一點也不要開天窗
  for (const h of [48, 72, 120]) {
    if (pool.length >= minItems) break;
    pool = within(h);
  }
  if (pool.length < minItems) pool = items;

  // 硬性新鮮度上限：任何路徑（含上面的最終備援）都不放行過舊的條目。
  // 無日期的條目視為未知、放行；有日期且超過 maxAgeDays 的一律擋掉。
  const maxAgeMs = maxAgeDays * 86400 * 1000;
  pool = pool.filter(
    (it) => !it.published || Date.now() - new Date(it.published).getTime() <= maxAgeMs
  );

  const now = Date.now();
  const scored = dedupe(pool).map((it) => {
    const ageH = it.published ? (now - new Date(it.published).getTime()) / 3600000 : 48;
    // 權重為主、新鮮度為輔：24 小時內幾乎不扣分，越舊扣越多
    const freshness = Math.max(0, 10 - Math.max(0, ageH - 24) / 6);
    return { ...it, _score: it.weight * 2 + freshness };
  });

  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, keep).map(({ _score, weight, ...rest }) => rest);
}

/** 相對時間文字（繁中）。 */
export function ago(iso, now = Date.now()) {
  if (!iso) return "";
  const diff = (now - new Date(iso).getTime()) / 1000;
  if (diff < 90) return "剛剛";
  if (diff < 3600) return `${Math.round(diff / 60)} 分鐘前`;
  if (diff < 86400) return `${Math.round(diff / 3600)} 小時前`;
  const d = Math.round(diff / 86400);
  return d === 1 ? "昨日" : `${d} 天前`;
}
