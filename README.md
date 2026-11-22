# Headline Peek

A Chrome extension that shows a preview card when you hover over a headline link: image, headline, summary, author/date and the article's opening paragraphs.

## Install (developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder.
4. Open a news site and hover over a headline for about half a second.

## How it works

- `content.js` watches for hovers on links that look like headlines (inside a heading, or with 4+ words of text; nav/footer links and section/tag/login pages are skipped).
- `background.js` fetches the article. It uses your cookies, so sites you're subscribed to preview the full text.
- The page is parsed with `DOMParser` (no scripts run), and the card is built from Open Graph / Twitter meta tags, JSON-LD `NewsArticle` data and the first paragraphs of the article body.
- The card lives in a closed Shadow DOM, so site CSS can't break it. Hebrew/Arabic previews switch to right-to-left.

## Settings (toolbar icon)

- Turn it on or off everywhere, or just for the current site
- "Only headline links": switch off to preview every link
- Hover delay

## Limitations

- It doesn't render the live page. Most news sites block being shown in iframes, so it shows extracted text instead.
- Paywalled articles show only what the site exposes without a subscription (usually the summary).
- Sites that build the page entirely in JavaScript or behind bot protection (e.g. Cloudflare challenges) may show "No preview".
- Each preview is a real request to the site, so it counts as a page view there.
