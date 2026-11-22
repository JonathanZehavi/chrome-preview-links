// Fetches article HTML on behalf of the content script.
// Content scripts are bound by the page's CORS rules; the service worker,
// with host permissions, is not. Parsing happens in the content script
// (service workers have no DOMParser).

const MAX_BYTES = 1_500_000; // article text and meta tags are near the top
const TIMEOUT_MS = 10_000;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "hp:fetch") return false;
  fetchPage(msg.url).then(sendResponse, (err) =>
    sendResponse({ error: err && err.name === "AbortError" ? "Timed out" : String(err && err.message || err) })
  );
  return true; // async response
});

async function fetchPage(url) {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Unsupported URL");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(u.href, {
      signal: ctrl.signal,
      credentials: "include", // use your logins/subscriptions on the site
      redirect: "follow",
      headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" },
    });
    const contentType = res.headers.get("content-type") || "";
    // Reject clearly non-HTML types; otherwise sniff (servers often mislabel pages).
    if (/^(image|video|audio|font)\/|application\/(pdf|json|zip)/i.test(contentType)) {
      ctrl.abort();
      return { finalUrl: res.url, status: res.status, contentType, html: "" };
    }
    let html = await readLimited(res, contentType);
    if (!/html|xml/i.test(contentType) && !/<(!doctype html|html|head|meta|body)[\s>]/i.test(html.slice(0, 4096))) html = "";
    return { finalUrl: res.url, status: res.status, contentType, html };
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(res, contentType) {
  const m = /charset=([^;]+)/i.exec(contentType);
  let decoder;
  try {
    decoder = new TextDecoder(m ? m[1].trim().replace(/["']/g, "") : "utf-8");
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  if (!res.body) return decoder.decode(await res.arrayBuffer());

  const reader = res.body.getReader();
  let out = "";
  let received = 0;
  while (received < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    out += decoder.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return out + decoder.decode();
}
