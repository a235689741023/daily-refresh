/**
 * 行情資料：Yahoo Finance chart API（美股指數、VIX、ADR、匯率）
 *          ＋ 證交所／櫃買（台股大盤、三大法人、指標股）。
 * 全部免金鑰。任一來源失敗只會讓該區塊留空，不會中斷整體流程。
 *
 * 註：原本規劃的 Stooq CSV 已加上瀏覽器 JS 驗證，伺服器端取不到，改用
 *     Yahoo Finance 的 chart 端點（非官方文件但長期穩定、免金鑰）。
 */

import { fetchJSON, fetchText } from "./http.mjs";
import { QUOTES, TWSE, TW_WATCH } from "../sources.mjs";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/* ── FRED（聖路易聯準銀行）───────────────────────────────────
 * 官方、免金鑰、無限流的 CSV 端點，涵蓋美股三大指數、VIX 與美元兌台幣。
 * 曾試過 Stooq（已加瀏覽器 JS 驗證）與 Yahoo Finance（很容易 429，
 * 在 CI 的共用 IP 上更明顯），兩者都不適合排程使用。
 */

/** 抓 FRED 序列，回傳 [{date, value}]，已濾掉休市日的 "." 。 */
async function fredSeries(id) {
  const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  const rows = csv.trim().split("\n").slice(1);
  const out = [];
  for (const line of rows) {
    const [date, raw] = line.split(",");
    const v = num(raw);
    if (v !== null) out.push({ date, value: v });
  }
  if (out.length < 2) throw new Error("歷史資料不足");
  return out;
}

/** 由歷史序列組出一張報價卡。 */
function toQuote({ key, name, symbol }, series, spark) {
  const last = series.at(-1);
  const prev = series.at(-2);
  const change = last.value - prev.value;
  return {
    key,
    name,
    symbol,
    date: last.date,
    value: last.value,
    prev: prev.value,
    change,
    changePct: (change / prev.value) * 100,
    spark: series.slice(-spark).map((d) => d.value),
  };
}

export async function quote(spec, { spark = 24 } = {}) {
  try {
    return toQuote(spec, await fredSeries(spec.symbol), spark);
  } catch (err) {
    console.warn(`  ✗ 報價 ${spec.name} (${spec.symbol}) — ${err.message}`);
    return { key: spec.key, name: spec.name, symbol: spec.symbol, error: err.message };
  }
}

/** 台積電 ADR：FRED 沒有個股，改用 stockanalysis 的公開歷史端點。 */
async function adrQuote({ key, name, symbol }, spark = 24) {
  try {
    const json = await fetchJSON(
      `https://stockanalysis.com/api/symbol/s/${encodeURIComponent(symbol)}/history`,
      { headers: { "User-Agent": BROWSER_UA } }
    );
    const rows = json?.data?.data;
    if (!Array.isArray(rows) || rows.length < 2) throw new Error("歷史資料不足");
    // 回傳為新到舊，翻轉成舊到新
    const series = rows
      .map((r) => ({ date: r.t, value: num(r.c) }))
      .filter((d) => d.value !== null)
      .reverse();
    return toQuote({ key, name, symbol }, series, spark);
  } catch (err) {
    console.warn(`  ✗ 報價 ${name} (${symbol}) — ${err.message}`);
    return { key, name, symbol, error: err.message };
  }
}

export async function usMarkets() {
  const [indices, vix] = await Promise.all([
    Promise.all(QUOTES.us.map((q) => quote(q))),
    quote(QUOTES.vix),
  ]);
  return { indices, vix, sentiment: vixMood(vix?.value) };
}

/** 依你的 prompt：VIX >30 高恐慌、<15 低波動。 */
function vixMood(v) {
  if (!Number.isFinite(v)) return null;
  if (v >= 30) return { level: "高恐慌", note: "市場處於避險狀態，波動放大" };
  if (v >= 20) return { level: "偏緊張", note: "不確定性升高，留意回檔" };
  if (v >= 15) return { level: "中性", note: "波動度處於常態區間" };
  return { level: "低波動", note: "市場自滿，留意突發事件的放大效果" };
}

/* ── 台股 ──────────────────────────────────────────────────── */

/** 民國日期（1150721）轉西元顯示。 */
const rocDate = (s) => {
  const m = /^(\d{3})(\d{2})(\d{2})$/.exec(String(s || ""));
  return m ? `${+m[1] + 1911}-${m[2]}-${m[3]}` : null;
};

/** 證交所 MI_INDEX：取加權指數（發行量加權股價指數）。 */
async function twseIndex() {
  const rows = await fetchJSON(TWSE.index);
  const taiex = rows.find((r) => String(r.指數 || "").includes("發行量加權股價指數"));
  if (!taiex) throw new Error("找不到加權指數");

  const down = String(taiex.漲跌 || "").trim() === "-";
  const pts = Math.abs(num(taiex.漲跌點數) ?? 0);
  const pct = Math.abs(num(taiex.漲跌百分比) ?? 0);

  return {
    key: "taiex",
    name: "加權指數",
    date: rocDate(taiex.日期),
    value: num(taiex.收盤指數),
    change: down ? -pts : pts,
    changePct: down ? -pct : pct,
  };
}

/**
 * 三大法人買賣金額統計。TWSE OpenAPI 已移除 BFI82U，改用官網 rwd 端點。
 * 遇到假日／休市會回 stat != OK，往前找最近的交易日。
 */
async function twseFlows() {
  const fmt = (d) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

  for (let back = 0; back < 7; back++) {
    const d = new Date(Date.now() - back * 86400000);
    const json = await fetchJSON(
      `https://www.twse.com.tw/rwd/zh/fund/BFI82U?dayDate=${fmt(d)}&type=day&response=json`,
      { headers: { "User-Agent": BROWSER_UA, Referer: "https://www.twse.com.tw/" } }
    );
    if (json.stat !== "OK" || !Array.isArray(json.data)) continue;

    // 欄位：單位名稱、買進金額、賣出金額、買賣差額（單位：元）
    const yi = (row) => (row ? +((num(row[3]) ?? 0) / 1e8).toFixed(1) : null);
    const find = (kw) => json.data.find((r) => String(r[0]).includes(kw));

    const dealerSelf = find("自營商(自行買賣)");
    const dealerHedge = find("自營商(避險)");
    const dealerTotal =
      dealerSelf || dealerHedge
        ? +(((num(dealerSelf?.[3]) ?? 0) + (num(dealerHedge?.[3]) ?? 0)) / 1e8).toFixed(1)
        : null;

    const foreign = yi(find("外資及陸資(不含外資自營商)") || find("外資"));
    const trust = yi(find("投信"));

    return {
      date: rocDate(json.date) || json.date,
      foreign,
      trust,
      dealer: dealerTotal,
      total:
        foreign !== null && trust !== null && dealerTotal !== null
          ? +(foreign + trust + dealerTotal).toFixed(1)
          : null,
      unit: "億元",
    };
  }
  throw new Error("近七日都取不到三大法人資料");
}

/** 證交所 STOCK_DAY_ALL：取指標股收盤。 */
async function twseWatchlist() {
  const rows = await fetchJSON(TWSE.stocks);
  const byCode = new Map(rows.map((r) => [r.Code, r]));
  return TW_WATCH.map(({ code, name }) => {
    const r = byCode.get(code);
    if (!r) return { code, name, error: "查無資料" };
    const value = num(r.ClosingPrice);
    const change = num(r.Change);
    const base = value !== null && change !== null ? value - change : null;
    return {
      code,
      name,
      value,
      change,
      changePct: base ? (change / base) * 100 : null,
    };
  });
}

/** 櫃買中心：以主板個股漲跌家數作為櫃買市場溫度。 */
async function tpexBreadth() {
  const rows = await fetchJSON(TWSE.tpex);
  if (!Array.isArray(rows) || !rows.length) throw new Error("櫃買資料為空");
  const changes = rows.map((r) => num(r.Change)).filter((v) => v !== null);
  const up = changes.filter((v) => v > 0).length;
  const down = changes.filter((v) => v < 0).length;
  return {
    key: "otc",
    name: "櫃買市場",
    date: rocDate(rows[0]?.Date),
    breadth: { up, down, flat: changes.length - up - down, total: changes.length },
  };
}

export async function twMarkets() {
  const settle = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
      console.warn(`  ✗ ${label} — ${err.message}`);
      return null;
    }
  };
  const [taiex, flows, watch, otc, adr, fx] = await Promise.all([
    settle("加權指數", twseIndex),
    settle("三大法人", twseFlows),
    settle("指標股", twseWatchlist),
    settle("櫃買", tpexBreadth),
    adrQuote(QUOTES.link[0]),
    quote(QUOTES.link[1]),
  ]);
  return { taiex, flows, watch, otc, adr, fx };
}

/**
 * 加權指數沒有免金鑰的歷史來源，所以走勢圖由自己累積：
 * 每天把當日收盤 append 進 history，保留最近 60 個交易日。
 */
export function appendTaiexHistory(history, taiex) {
  const list = Array.isArray(history) ? [...history] : [];
  if (!taiex?.date || !Number.isFinite(taiex.value)) return list;
  if (list.at(-1)?.date === taiex.date) list[list.length - 1] = { date: taiex.date, value: taiex.value };
  else list.push({ date: taiex.date, value: taiex.value });
  return list.slice(-60);
}

/* ── 台股聯動判讀（依你 prompt 的步驟 6） ────────────────────── */

export function linkage(us, tw) {
  const parts = [];

  const adr = tw?.adr;
  if (Number.isFinite(adr?.changePct)) {
    const p = adr.changePct;
    const dir = p > 0.8 ? "偏強開" : p < -0.8 ? "偏弱開" : "平盤附近";
    parts.push({
      label: "台積電 ADR",
      value: `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`,
      note: `預估台股今日開盤傾向${dir}`,
    });
  }

  const ndq = us?.indices?.find((i) => i.key === "ndq");
  const dji = us?.indices?.find((i) => i.key === "dji");
  if (Number.isFinite(ndq?.changePct) && Number.isFinite(dji?.changePct)) {
    const techLed = Math.abs(ndq.changePct) > Math.abs(dji.changePct);
    parts.push({
      label: "美台連動性",
      value: techLed ? "高" : "中低",
      note: techLed
        ? "美股由科技／半導體帶動，台股電子權值連動性高"
        : "美股漲跌主因非科技板塊，台股連動性相對有限",
    });
  }

  if (Number.isFinite(tw?.fx?.value)) {
    const weaker = tw.fx.change > 0; // USDTWD 上升 = 台幣貶值
    parts.push({
      label: "新台幣",
      value: tw.fx.value.toFixed(3),
      note: weaker ? "台幣走貶，對出口廠商匯兌偏利多" : "台幣走升，出口廠商匯兌壓力增加",
    });
  }

  if (tw?.flows?.total !== null && tw?.flows?.total !== undefined) {
    const t = tw.flows.total;
    parts.push({
      label: "三大法人合計",
      value: `${t >= 0 ? "+" : ""}${t} 億`,
      note: t >= 0 ? "法人資金淨流入，籌碼面偏多" : "法人資金淨流出，留意賣壓",
    });
  }

  return parts;
}
