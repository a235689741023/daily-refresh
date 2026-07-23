#!/usr/bin/env node
/**
 * 每日抓取主流程。由 GitHub Actions 在台北時間每天 06:30 執行。
 *
 *   node scripts/fetch-all.mjs          正常抓取並寫入 public/data/
 *   DRY_RUN=1 node scripts/fetch-all.mjs  抓取但不寫檔（除錯用）
 *   ONLY=esg,tw node scripts/fetch-all.mjs  只跑指定領域
 *
 * 設計原則：任何單一來源失敗都不會讓整個流程掛掉。如果某個領域完全抓不到
 * 東西，會保留上一次的資料而不是寫入空檔案 —— 早上開啟時寧可看到昨天的
 * 內容，也不要看到一片空白。
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DOMAINS } from "./sources.mjs";
import { fetchFeeds, curate, ago } from "./lib/rss.mjs";
import { usMarkets, twMarkets, linkage, appendTaiexHistory } from "./lib/markets.mjs";
import * as ai from "./lib/summarize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "data");
const DRY = process.env.DRY_RUN === "1";
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;

const now = new Date();
const stamp = now.toISOString();
const taipei = now.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });

/** 寫檔；抓不到資料時保留舊檔。 */
async function save(name, payload, { minItems = 1 } = {}) {
  const file = path.join(OUT, name);
  const count = payload.items?.length ?? (payload.us || payload.tw ? 1 : 0);

  if (count < minItems && existsSync(file)) {
    const prev = JSON.parse(await readFile(file, "utf8"));
    console.warn(`  ! ${name} 本次無有效資料，保留上次結果（${prev.updated}）`);
    return;
  }
  if (DRY) {
    console.log(`  · [DRY] ${name} — ${count} 筆`);
    return;
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`  → ${name} 已寫入（${count} 筆）`);
}

/** 加上相對時間，前端就不必自己算。 */
const withAgo = (items) => items.map((it) => ({ ...it, ago: ago(it.published, now.getTime()) }));

/* ── 新聞類領域 ─────────────────────────────────────────────── */

async function runNewsDomain(key, marketContext = null) {
  const cfg = DOMAINS[key];
  console.log(`\n▍${cfg.title}`);

  const { items: raw, errors } = await fetchFeeds(cfg.feeds);
  let picked;

  if (cfg.groups) {
    // 地理資訊／AI 各自獨立挑選，避免其中一邊被另一邊洗版
    picked = cfg.groups.flatMap((g) =>
      curate(
        raw.filter((it) => it.group === g),
        { keep: Math.ceil(cfg.keep / cfg.groups.length) }
      )
    );
  } else {
    picked = curate(raw, { keep: cfg.keep });
  }

  console.log(`  共 ${raw.length} 則，篩選後保留 ${picked.length} 則`);

  const analysis = await ai.analyze(key, picked, marketContext);
  const { items, digest, watch } = ai.merge(picked, analysis);

  await save(`${key}.json`, {
    domain: key,
    title: cfg.title,
    updated: stamp,
    updatedLocal: taipei,
    digest,
    watch,
    items: withAgo(items),
    errors,
  });

  return picked.length;
}

/* ── 行情 ───────────────────────────────────────────────────── */

async function runMarkets() {
  console.log("\n▍行情資料");
  const [us, tw] = await Promise.all([usMarkets(), twMarkets()]);
  const link = linkage(us, tw);

  // 加權指數沒有免金鑰的歷史來源，走勢圖靠每日累積
  const histFile = path.join(OUT, "markets.json");
  const prevHist = existsSync(histFile)
    ? JSON.parse(await readFile(histFile, "utf8")).tw?.taiexHistory
    : null;
  tw.taiexHistory = appendTaiexHistory(prevHist, tw.taiex);
  if (tw.taiex) tw.taiex.spark = tw.taiexHistory.map((d) => d.value);

  await save(
    "markets.json",
    { updated: stamp, updatedLocal: taipei, us, tw, linkage: link },
    { minItems: 0 }
  );

  return { us, tw, link };
}

/* ── 主流程 ─────────────────────────────────────────────────── */

async function main() {
  console.log(`Daily Refresh 抓取開始 — ${taipei}（台北時間）`);
  console.log(ai.enabled() ? "判讀層：啟用（Claude API）" : "判讀層：略過（未設定 ANTHROPIC_API_KEY）");

  const want = (k) => !ONLY || ONLY.has(k);
  const markets = want("us") || want("tw") ? await runMarkets() : null;

  const results = {};
  if (want("esg")) results.esg = await runNewsDomain("esg");
  if (want("geo")) results.geo = await runNewsDomain("geo");
  if (want("us")) {
    results.us = await runNewsDomain("us", markets ? { 美股行情: markets.us } : null);
  }
  if (want("tw")) {
    results.tw = await runNewsDomain(
      "tw",
      markets ? { 台股行情: markets.tw, 美股前一日: markets.us, 聯動判讀: markets.link } : null
    );
  }

  // 首頁用的索引檔
  if (!ONLY) {
    await save(
      "index.json",
      {
        updated: stamp,
        updatedLocal: taipei,
        counts: results,
        domains: Object.entries(DOMAINS).map(([k, v]) => ({ key: k, title: v.title })),
      },
      { minItems: 0 }
    );
  }

  const total = Object.values(results).reduce((a, b) => a + b, 0);
  console.log(`\n完成 — 共 ${total} 則`);
  if (total === 0) {
    console.error("所有領域都沒抓到資料，請檢查網路或來源是否失效");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("抓取流程發生未預期錯誤：", err);
  process.exit(1);
});
