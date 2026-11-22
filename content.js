(() => {
  if (window.top !== window || window.__headlinePeek) return;
  window.__headlinePeek = true;

  const DEFAULTS = { enabled: true, disabledHosts: [], delay: 450, headlinesOnly: true };
  let settings = { ...DEFAULTS };
  const host = location.hostname;

  chrome.storage.sync.get(DEFAULTS, (s) => (settings = { ...DEFAULTS, ...s }));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const k in changes) settings[k] = changes[k].newValue;
    if (!isActive()) hide(true);
  });

  const isActive = () => settings.enabled && !(settings.disabledHosts || []).includes(host);

  // ---------- Link filtering ----------
  const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|mp4|mp3|zip|rar|exe|dmg|apk)(\?|#|$)/i;
  const NON_ARTICLE = /\/(login|signin|sign-in|register|subscribe|account|newsletter|tag|tags|topic|topics|author|authors|category|search)(\/|\?|$)/i;

  function candidateLink(target) {
    const a = target && target.closest && target.closest("a[href]");
    if (!a || a.closest("[data-headline-peek]")) return null;
    let url;
    try {
      url = new URL(a.href, location.href);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return null;
    if (url.pathname === "/" && !url.search) return null; // home pages
    if (SKIP_EXT.test(url.pathname)) return null;
    if (settings.headlinesOnly && !looksLikeHeadline(a, url)) return null;
    url.hash = "";
    return { a, url: url.href };
  }

  function looksLikeHeadline(a, url) {
    if (a.closest("nav, footer, [role=navigation], [role=menu], [role=contentinfo]")) return false;
    if (NON_ARTICLE.test(url.pathname)) return false;
    if (a.closest("h1,h2,h3,h4,h5,h6") || a.querySelector("h1,h2,h3,h4,h5,h6")) return true;
    const text = (a.innerText || a.getAttribute("aria-label") || a.title || "").trim().replace(/\s+/g, " ");
    const words = text.split(" ").filter(Boolean).length;
    if (text.length >= 20 && words >= 4) return true;
    // Image teaser linking to an article-looking URL
    if (a.querySelector("img, picture") && /[-_/]\w+[-_]\w+[-_]\w+|\d{4,}/.test(url.pathname)) return true;
    return false;
  }

  // ---------- Fetch + extract ----------
  const cache = new Map(); // url -> Promise<data>

  function getPreview(url) {
    if (!cache.has(url)) {
      const p = new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "hp:fetch", url }, (res) => {
          if (chrome.runtime.lastError) return resolve({ error: chrome.runtime.lastError.message });
          if (!res || res.error) return resolve({ error: (res && res.error) || "No response" });
          if (!res.html) return resolve({ error: res.status >= 400 ? `HTTP ${res.status}` : "Not an HTML page" });
          try {
            resolve(extract(res.html, res.finalUrl || url));
          } catch (e) {
            resolve({ error: "Could not read page" });
          }
        });
      });
      cache.set(url, p);
      p.then((d) => d.error && setTimeout(() => cache.delete(url), 30_000));
    }
    return cache.get(url);
  }

  const BOILERPLATE = /(cookie|subscribe|subscription|sign up|sign in|log in|newsletter|all rights reserved|©|advertisement|javascript|your browser|follow us|read more|click here|terms of (use|service)|privacy policy)/i;

  function extract(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const meta = (key) => {
      const el = doc.querySelector(`meta[property="${key}"], meta[name="${key}"], meta[itemprop="${key}"]`);
      const v = el && el.getAttribute("content");
      return v ? v.trim() : "";
    };
    const ld = readJsonLd(doc);

    const title = meta("og:title") || meta("twitter:title") || (ld && ld.headline) || doc.title || "";
    const description = meta("og:description") || meta("twitter:description") || meta("description") || (ld && ld.description) || "";
    let image = meta("og:image") || meta("og:image:url") || meta("og:image:secure_url") || meta("twitter:image") || meta("twitter:image:src") || (ld && ld.image) || "";
    image = safeUrl(image, baseUrl);
    const site = meta("og:site_name") || new URL(baseUrl).hostname.replace(/^www\./, "");
    const published = meta("article:published_time") || (ld && ld.datePublished) || (doc.querySelector("time[datetime]") || {}).getAttribute?.("datetime") || "";
    let author = (ld && ld.author) || meta("author") || meta("article:author") || "";
    if (/^https?:/i.test(author)) author = "";

    const paragraphs = extractParagraphs(doc, ld, description);
    return { title: clean(title), description: clean(description), image, site: clean(site), published, author: clean(author), paragraphs, url: baseUrl };
  }

  function readJsonLd(doc) {
    const ARTICLE = /Article|NewsArticle|ReportageNewsArticle|BlogPosting|AnalysisNewsArticle|OpinionNewsArticle/;
    const queue = [];
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        queue.push(JSON.parse(s.textContent));
      } catch {}
    }
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) { queue.push(...node); continue; }
      if (node["@graph"]) queue.push(...[].concat(node["@graph"]));
      const type = [].concat(node["@type"] || []).join(" ");
      if (ARTICLE.test(type)) {
        const img = [].concat(node.image || [])[0];
        const auth = [].concat(node.author || []).map((x) => (typeof x === "string" ? x : x && x.name)).filter(Boolean).join(", ");
        return {
          headline: node.headline || node.name || "",
          description: node.description || "",
          articleBody: typeof node.articleBody === "string" ? node.articleBody : "",
          datePublished: node.datePublished || "",
          author: auth,
          image: typeof img === "string" ? img : (img && img.url) || "",
        };
      }
    }
    return null;
  }

  function extractParagraphs(doc, ld, description) {
    const LIMIT = 900;
    const out = [];
    let total = 0;
    const push = (t) => {
      t = clean(t);
      if (t.length < 60 || BOILERPLATE.test(t) || out.includes(t)) return false;
      if (description && t === clean(description)) return false;
      out.push(t.length > 450 ? t.slice(0, 450).replace(/\s+\S*$/, "") + "…" : t);
      total += t.length;
      return total >= LIMIT || out.length >= 4;
    };

    if (ld && ld.articleBody && ld.articleBody.length > 200) {
      for (const t of ld.articleBody.split(/\n+/)) if (push(t)) return out;
      if (out.length) return out;
    }

    doc.querySelectorAll("script, style, noscript, nav, footer, header, aside, form, figure, [aria-hidden=true]").forEach((n) => n.remove());
    const container =
      doc.querySelector('[itemprop="articleBody"], [data-testid*="article-body" i], .article-body, .article__body, .story-body, .post-content, .entry-content') ||
      doc.querySelector("article") ||
      doc.querySelector("main, [role=main]") ||
      doc.body;
    if (!container) return out;
    for (const p of container.querySelectorAll("p")) if (push(p.textContent || "")) break;
    return out;
  }

  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

  function safeUrl(u, base) {
    if (!u) return "";
    try {
      const x = new URL(u, base);
      return x.protocol === "https:" || x.protocol === "http:" ? x.href : "";
    } catch {
      return "";
    }
  }

  function formatDate(s) {
    const d = new Date(s);
    if (isNaN(d)) return "";
    const diff = (Date.now() - d) / 1000;
    if (diff >= 0 && diff < 3600) return `${Math.max(1, Math.round(diff / 60))} min ago`;
    if (diff >= 0 && diff < 86400) return `${Math.round(diff / 3600)} h ago`;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  // ---------- UI ----------
  let hostEl, root, card;
  let showTimer = 0, hideTimer = 0, currentUrl = null, currentLink = null, token = 0;

  function ensureUI() {
    if (hostEl && hostEl.isConnected) return;
    hostEl = document.createElement("div");
    hostEl.setAttribute("data-headline-peek", "");
    hostEl.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
    root = hostEl.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${CSS}</style><div class="card" role="dialog" aria-live="polite" hidden></div>`;
    card = root.querySelector(".card");
    card.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    card.addEventListener("mouseleave", () => scheduleHide());
    card.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      if (currentUrl) window.open(currentUrl, e.ctrlKey || e.metaKey ? "_blank" : "_self");
    });
    document.documentElement.appendChild(hostEl);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function renderLoading(url) {
    card.replaceChildren();
    const head = el("div", "site", new URL(url).hostname.replace(/^www\./, ""));
    const sk = el("div", "skeleton");
    sk.append(el("i"), el("i"), el("i", "short"));
    card.append(head, sk);
  }

  function renderData(d) {
    card.replaceChildren();
    if (d.error) {
      card.append(el("div", "site", new URL(currentUrl).hostname.replace(/^www\./, "")), el("div", "err", `No preview: ${d.error}`));
      return;
    }
    if (d.image) {
      const img = el("img", "hero");
      img.referrerPolicy = "no-referrer";
      img.alt = "";
      img.onerror = () => img.remove();
      img.src = d.image;
      card.append(img);
    }
    const body = el("div", "body");
    const metaLine = [d.site, d.author, formatDate(d.published)].filter(Boolean).join(" · ");
    if (metaLine) body.append(el("div", "site", metaLine));
    if (d.title) body.append(el("div", "title", d.title));
    if (d.description) body.append(el("p", "desc", d.description));
    if (d.paragraphs && d.paragraphs.length) {
      const txt = el("div", "text");
      for (const p of d.paragraphs) txt.append(el("p", "", p));
      body.append(txt);
    }
    if (!d.title && !d.description && !(d.paragraphs || []).length) body.append(el("div", "err", "This page didn't expose any preview text."));
    const foot = el("a", "open", "Open article →");
    foot.href = d.url;
    body.append(foot);
    card.append(body);
    // Detect RTL text (Hebrew/Arabic sites)
    card.dir = /[֐-ࣿ]/.test((d.title || "") + (d.description || "")) ? "rtl" : "ltr";
  }

  function position(link) {
    const r = link.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const w = Math.min(380, vw - 16);
    card.style.width = w + "px";
    card.style.maxHeight = "";
    const ch = Math.min(card.offsetHeight || 300, vh - 16);
    let left = Math.min(Math.max(8, r.left), vw - w - 8);
    let top;
    const below = vh - r.bottom - 8, above = r.top - 8;
    if (below >= ch || below >= above) {
      top = r.bottom + 6;
      card.style.maxHeight = Math.max(160, below - 6) + "px";
    } else {
      card.style.maxHeight = Math.max(160, above - 6) + "px";
      top = Math.max(8, r.top - 6 - Math.min(ch, above - 6));
    }
    card.style.left = left + "px";
    card.style.top = top + "px";
  }

  async function show(link, url) {
    ensureUI();
    currentUrl = url;
    currentLink = link;
    const my = ++token;
    renderLoading(url);
    card.hidden = false;
    position(link);
    const data = await getPreview(url);
    if (my !== token || card.hidden) return;
    renderData(data);
    position(link);
    if (data.image) {
      const img = card.querySelector("img.hero");
      img && img.addEventListener("load", () => my === token && position(link), { once: true });
    }
  }

  function hide(immediate) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    const run = () => {
      token++;
      currentUrl = currentLink = null;
      if (card) card.hidden = true;
    };
    immediate ? run() : (hideTimer = setTimeout(run, 0));
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => hide(true), 300);
  }

  document.addEventListener(
    "mouseover",
    (e) => {
      if (!isActive()) return;
      if (hostEl && e.composedPath().includes(hostEl)) return;
      const c = candidateLink(e.target);
      if (!c) return;
      clearTimeout(hideTimer);
      if (c.url === currentUrl && card && !card.hidden) return;
      clearTimeout(showTimer);
      showTimer = setTimeout(() => show(c.a, c.url), settings.delay);
    },
    true
  );

  document.addEventListener(
    "mouseout",
    (e) => {
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      const to = e.relatedTarget;
      if (to && (a.contains(to) || to === hostEl)) return;
      clearTimeout(showTimer);
      showTimer = 0;
      if (card && !card.hidden) scheduleHide();
    },
    true
  );

  document.addEventListener("keydown", (e) => e.key === "Escape" && hide(true), true);
  window.addEventListener("scroll", () => card && !card.hidden && hide(true), { passive: true });
  document.addEventListener("click", (e) => {
    if (hostEl && e.composedPath().includes(hostEl)) return;
    hide(true);
  }, true);

  const CSS = `
  :host { all: initial; }
  .card {
    position: fixed; box-sizing: border-box; overflow: auto; overscroll-behavior: contain;
    background: #fff; color: #1a1a1a; border: 1px solid rgba(0,0,0,.12); border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0,0,0,.22), 0 2px 6px rgba(0,0,0,.08);
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    cursor: pointer; animation: hp-in .12s ease-out; text-align: start;
  }
  .card[hidden] { display: none; }
  @keyframes hp-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .hero { display: block; width: 100%; max-height: 190px; object-fit: cover; border-radius: 12px 12px 0 0; background: #eee; }
  .body { padding: 12px 14px 12px; }
  .card > .site, .card > .err, .card > .skeleton { margin: 12px 14px; }
  .site { font-size: 11.5px; color: #6b6b6b; text-transform: uppercase; letter-spacing: .03em; margin-bottom: 4px; }
  .title { font-size: 16px; font-weight: 700; line-height: 1.3; margin-bottom: 6px; }
  .desc { margin: 0 0 8px; color: #333; font-weight: 500; }
  .text p { margin: 0 0 8px; color: #444; font-size: 13.5px; }
  .err { color: #8a4b00; font-size: 13px; }
  .open { display: inline-block; margin-top: 2px; font-size: 13px; font-weight: 600; color: #1a5fd0; text-decoration: none; }
  .open:hover { text-decoration: underline; }
  .skeleton i { display: block; height: 12px; margin: 8px 0; border-radius: 6px;
    background: linear-gradient(90deg,#eee 0%,#f6f6f6 50%,#eee 100%); background-size: 200% 100%; animation: hp-sh 1s linear infinite; }
  .skeleton i.short { width: 60%; }
  @keyframes hp-sh { from { background-position: 200% 0; } to { background-position: -200% 0; } }
  @media (prefers-color-scheme: dark) {
    .card { background: #1f2023; color: #ececec; border-color: rgba(255,255,255,.12); }
    .site { color: #a0a0a0; } .desc { color: #ddd; } .text p { color: #c8c8c8; }
    .open { color: #7fb0ff; } .err { color: #f0b46a; }
    .skeleton i { background: linear-gradient(90deg,#2b2c30 0%,#36373c 50%,#2b2c30 100%); background-size: 200% 100%; }
  }`;
})();
