# Headline Peek

A Chrome extension that shows a preview card when you hover over a headline link: image, headline, summary, author/date and the article's opening paragraphs.

## Install (developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder.
4. Open a news site and hover over a headline for about half a second.

## Building

`background.js` is generated: it bundles `src/background.js` with the Anthropic SDK. After editing `src/background.js`, run:

```bash
npm install && npm run build
```

## How it works

- `content.js` watches for hovers on links that look like headlines (inside a heading, or with 4+ words of text; nav/footer links and section/tag/login pages are skipped).
- `background.js` fetches the article. It uses your cookies, so sites you're subscribed to preview the full text.
- The page is parsed with `DOMParser` (no scripts run), and the card is built from Open Graph / Twitter meta tags, JSON-LD `NewsArticle` data and the first paragraphs of the article body.
- The card lives in a closed Shadow DOM, so site CSS can't break it. Hebrew/Arabic previews switch to right-to-left.

## TL;DR summaries (optional)

Press **✨ TL;DR** on a preview card to get a 3-bullet summary of the full article from Claude, in the article's language.

1. Create an API key at console.anthropic.com (it needs credit on the account).
2. Click the Headline Peek toolbar icon, paste the key, and press **Save**.
3. Pick a model: **Opus 5.5** (best quality, about $0.02 per summary) or **Haiku 5.5** (about $0.0005 per summary). These are rough estimates for an average article.

Summaries only run when you press the button, never on hover. Each one is saved, so reopening the same article costs nothing.
The key is stored in `chrome.storage.local` in this browser profile (not synced) and is sent only to `api.anthropic.com`.

## Settings (toolbar icon)

- Turn it on or off everywhere, or just for the current site
- "Only headline links": switch off to preview every link
- Hover delay

## Limitations

- It doesn't render the live page. Most news sites block being shown in iframes, so it shows extracted text instead.
- Paywalled articles show only what the site exposes without a subscription (usually the summary).
- Sites that build the page entirely in JavaScript or behind bot protection (e.g. Cloudflare challenges) may show "No preview".
- Each preview is a real request to the site, so it counts as a page view there.
