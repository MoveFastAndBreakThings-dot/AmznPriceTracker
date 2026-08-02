# Amazon Price Watcher

A Chrome extension (Manifest V3) that tracks a single Amazon.ca product and
emails/notifies you once when it hits your target price. Built to track the
Samsung 24" FHD IPS Monitor (Model LS24F320GANXZA, ASIN `B0BF3JLKY2`), but
works for any Amazon.ca product URL.

---

## What it does

- Checks the product's price on Amazon.ca every 60 minutes, in the background,
  as long as Chrome is running.
- Sends an **hourly status email** with the current price every time it checks
  (while the price is still above target).
- Sends a **one-time alert email + desktop notification** the moment the price
  drops to or below your target.
- **Stops itself automatically** after the alert fires — no repeat spam.
- Popup UI shows live status: current price, progress bar toward target, time
  until next check, and check count.

---

## Why a Chrome extension (and not a headless scraper)

An earlier version of this used a Playwright headless-browser script polling
Amazon.ca directly. Amazon's bot detection blocked it immediately with a
"click to continue shopping" interstitial — no CAPTCHA-solving or stealth
evasion was attempted or will be added, by design.

A browser extension fetches the same URL using the extension's real network
context inside your actual Chrome install (real cookies, real TLS/HTTP
fingerprint, no automation flags). It is not guaranteed to be immune to
blocking either — if Amazon starts blocking the extension's `fetch()` calls
too, the fallback is a content script that only runs when you have the
product tab open yourself (a real page navigation, not a background request).
See [Troubleshooting](#troubleshooting) below.

---

## File structure

```
chrome-extension/
├── manifest.json     Extension config (MV3): permissions, background worker, popup
├── background.js       Service worker: alarm scheduling, price fetch/parse, email, notifications
├── config.js            Real EmailJS credentials (gitignored, you create this)
├── config.example.js    Placeholder template for config.js (committed)
├── popup.html            Popup UI markup + styles
├── popup.js              Popup logic: reads/writes chrome.storage, talks to background.js
├── icon128.png            Toolbar/notification icon
└── README.md              This file
```

No build step. No `node_modules`. Load the folder directly into Chrome.

---

## Installation

1. Open `chrome://extensions` in Chrome.
2. Toggle **Developer mode** on (top-right corner).
3. Click **Load unpacked**.
4. Select the `chrome-extension` folder (Windows path:
   `E:\crazy\tracker\chrome-extension`).
5. The extension appears as "Amazon Price Watcher." Pin it to the toolbar via
   the puzzle-piece icon if you want quick access.

To reload after any code change: go back to `chrome://extensions` and click
the circular reload icon on the extension's card.

---

## Configuration

### Target product and price

Set directly in the popup UI — no code editing needed:

- **Product URL** — defaults to `https://www.amazon.ca/dp/B0BF3JLKY2`.
- **Target price (CAD)** — defaults to `89.99`.

Change either field before clicking **Start** to track a different product or
price. Only one product is tracked at a time; starting a new one overwrites
the previous tracking config.

### Email delivery (EmailJS)

Emails are sent via [EmailJS](https://www.emailjs.com), a service that lets
client-side apps (like a browser extension) send email through a connected
Gmail account without exposing a password or running a backend server. Free
tier: 200 emails/month.

Credentials live in `config.js`, which is **gitignored** and never committed
— `background.js` loads it via `importScripts("config.js")`. A placeholder
template, `config.example.js`, is committed instead.

To set up EmailJS from scratch:

1. Sign up free at emailjs.com.
2. **Email Services** → Add New Service → Gmail → connect your Gmail account
   (OAuth popup, click Allow). Copy the **Service ID**.
3. **Email Templates** → Create New Template with:
   - To Email: `{{to_email}}`
   - Subject: `{{subject}}`
   - Body: `{{message}}`
   Copy the **Template ID** (shown on the template's own page, not the list
   view).
4. **Account** → **General** → copy the **Public Key**.
5. Copy `config.example.js` to `config.js` in this same folder and fill in
   your Service ID, Template ID, Public Key, and notification email:

   ```js
   const EMAILJS_SERVICE_ID = "service_xxxxxxx";
   const EMAILJS_TEMPLATE_ID = "template_xxxxxxx";
   const EMAILJS_PUBLIC_KEY = "xxxxxxxxxxxxxxx";
   const NOTIFY_EMAIL = "you@example.com";
   ```

6. Reload the extension at `chrome://extensions`.

If `config.js` is missing, the service worker will throw on `importScripts`
and nothing will run — that's the expected failure mode for a fresh clone
until you create the file.

---

## How it works internally

### Scheduling

`chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 })` fires an alarm
every hour. The service worker wakes on each alarm (MV3 service workers are
event-driven and don't need to stay resident) and runs `checkPrice()`.

### Price parsing

`checkPrice()` does a plain `fetch()` of the product URL and searches the raw
HTML text with two fallback regex patterns, in order:

1. `class="a-offscreen">$XXX.XX<` — the hidden accessible price span Amazon
   usually renders regardless of A/B-tested layout.
2. `a-price-whole` + `a-price-fraction` split spans, joined into a decimal.

If neither matches, the check is logged as a failure (`lastResult` in
storage) and nothing is emailed for that cycle — it just retries next hour.

### State

Everything lives in `chrome.storage.local`:

| Key | Meaning |
|---|---|
| `url`, `targetPrice` | Current tracking config |
| `active` | Whether checks are still running |
| `lastPrice`, `lastChecked`, `lastResult` | Most recent check outcome |
| `baselinePrice` | Price recorded on the first successful check after Start — used to compute the progress bar |
| `checkCount` | Number of successful checks this tracking run |

### One-shot alert behavior

When a check finds `price <= targetPrice`:

1. A desktop notification fires (`chrome.notifications.create`).
2. A "PRICE DROP ALERT" email is sent via EmailJS.
3. `active` is set to `false` and the alarm is cleared — no further checks or
   emails happen until you manually click **Start** again.

---

## Troubleshooting

**Popup shows "Could not find price on page."**
Amazon likely served a bot-check interstitial instead of the real product
page (this happened during development with the headless-scraper version).
Check the browser's extension service worker console
(`chrome://extensions` → "service worker" link under the extension → DevTools
Console) for details. If this keeps happening, the fetch-from-background
approach may need to move to a content-script model that only runs while you
have the tab open — ask for that fallback if needed.

**No emails arriving.**
- Confirm the EmailJS Service ID / Template ID / Public Key in `background.js`
  match your EmailJS dashboard exactly.
- Check EmailJS dashboard → **Email History** for delivery/failure logs.
- Check spam folder.
- Confirm you haven't exceeded the free tier's 200 emails/month.

**"Active: no" right after clicking Start.**
Means Stop was clicked afterward, or the popup was closed before the Start
message finished processing. Click Start again and leave the popup open a
moment before closing.

**Checks stop happening.**
The service worker only runs while Chrome itself is open (doesn't need to be
the focused window, but the Chrome process must be running). Alarms persist
across Chrome restarts as long as the extension isn't disabled/removed.

---

## Known limitations

- Single product tracked at a time.
- No retry backoff — a failed check just waits for the next hourly alarm.
- No CAPTCHA-solving or anti-bot evasion layer, intentionally. If Amazon
  blocks the extension's background fetches the same way it blocked the
  headless scraper, this will start failing and needs the content-script
  fallback described above.
- EmailJS free tier caps at 200 emails/month (24 hourly checks/day ≈ 720/month
  if left running continuously without hitting target — budget accordingly,
  or expect emails to stop once the cap is hit).
