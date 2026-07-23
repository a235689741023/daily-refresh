/** 共用的網路存取工具：逾時、重試、友善 UA。 */

const UA =
  "Mozilla/5.0 (compatible; DailyRefreshBot/1.0; +https://github.com/) Node/" +
  process.versions.node;

export async function fetchText(url, { timeout = 20000, retries = 2, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: { "User-Agent": UA, Accept: "*/*", ...headers },
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${res.statusText}`);
        err.status = res.status;
        err.retryAfter = Number(res.headers.get("retry-after")) || null;
        throw err;
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        // 被限流時退得久一點；其他錯誤線性退避即可
        const wait =
          err.status === 429 || err.status === 503
            ? (err.retryAfter ? err.retryAfter * 1000 : 2500 * (attempt + 1))
            : 600 * (attempt + 1);
        await sleep(wait);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function fetchJSON(url, opts) {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`回應不是合法 JSON：${url}`);
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 併發上限，避免一次打爆所有來源。 */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}
