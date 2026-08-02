const ALARM_NAME = "priceCheck";

// config.js is gitignored and holds real values; config.example.js is the
// committed template. Copy it to config.js and fill in your own EmailJS
// credentials before loading the extension.
importScripts("config.js");

async function sendEmail(subject, message) {
  try {
    const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: {
          to_email: NOTIFY_EMAIL,
          subject,
          message,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("EmailJS send failed:", response.status, body);
    }
  } catch (err) {
    console.error("EmailJS send error:", err);
  }
}

// Multiple patterns tried in order against the raw HTML text, since Amazon
// occasionally A/B tests the price markup.
const PRICE_PATTERNS = [
  /class="a-offscreen">\s*\$?([\d,]+\.\d{2})\s*</,
  /class="a-price-whole">([\d,]+)\.?<\/span>[\s\S]{0,80}?class="a-price-fraction">(\d{2})</,
];

function parsePrice(html) {
  let match = PRICE_PATTERNS[0].exec(html);
  if (match) {
    return parseFloat(match[1].replace(/,/g, ""));
  }

  match = PRICE_PATTERNS[1].exec(html);
  if (match) {
    const whole = match[1].replace(/,/g, "");
    const fraction = match[2];
    return parseFloat(`${whole}.${fraction}`);
  }

  return null;
}

async function checkPrice() {
  const { url, targetPrice, active } = await chrome.storage.local.get([
    "url",
    "targetPrice",
    "active",
  ]);

  if (!active || !url || targetPrice == null) {
    return;
  }

  const timestamp = new Date().toISOString();

  try {
    const response = await fetch(url, { credentials: "omit" });
    const html = await response.text();
    const price = parsePrice(html);

    if (price === null) {
      await chrome.storage.local.set({
        lastChecked: timestamp,
        lastResult: "Could not find price on page",
      });
      return;
    }

    const existing = await chrome.storage.local.get(["baselinePrice", "checkCount"]);

    await chrome.storage.local.set({
      lastChecked: timestamp,
      lastPrice: price,
      lastResult: `Checked OK: $${price.toFixed(2)}`,
      baselinePrice: existing.baselinePrice ?? price,
      checkCount: (existing.checkCount || 0) + 1,
    });

    if (price <= targetPrice) {
      chrome.notifications.create(`price-drop-${Date.now()}`, {
        type: "basic",
        iconUrl: "icon128.png",
        title: "Price Drop Alert",
        message: `Price is now $${price.toFixed(2)} CAD (target was $${targetPrice.toFixed(
          2
        )}). Tracking stopped.`,
        priority: 2,
        requireInteraction: true,
      });

      await sendEmail(
        "PRICE DROP ALERT - Amazon Price Watcher",
        `Target reached! Current price: $${price.toFixed(2)} CAD (target was $${targetPrice.toFixed(
          2
        )}).\n\nProduct: ${url}\n\nTracking has stopped.`
      );

      // One-time alert: stop checking so it never fires again.
      await chrome.storage.local.set({ active: false });
      await chrome.alarms.clear(ALARM_NAME);
    } else {
      await sendEmail(
        "Amazon Price Watcher - Hourly Update",
        `Current price: $${price.toFixed(2)} CAD\nTarget price: $${targetPrice.toFixed(
          2
        )}\n\nProduct: ${url}\n\nStill watching, will alert when target is reached.`
      );
    }
  } catch (err) {
    await chrome.storage.local.set({
      lastChecked: timestamp,
      lastResult: `Error: ${err.message}`,
    });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkPrice();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "START_TRACKING") {
    chrome.storage.local
      .set({
        url: message.url,
        targetPrice: message.targetPrice,
        active: true,
        lastResult: "Tracking started",
        baselinePrice: null,
        checkCount: 0,
      })
      .then(async () => {
        await chrome.alarms.clear(ALARM_NAME);
        chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
        await checkPrice(); // run one check immediately for instant feedback
        sendResponse({ ok: true });
      });
    return true; // keep sendResponse alive for the async chain
  }

  if (message.type === "STOP_TRACKING") {
    chrome.storage.local.set({ active: false }).then(async () => {
      await chrome.alarms.clear(ALARM_NAME);
      sendResponse({ ok: true });
    });
    return true;
  }
});
