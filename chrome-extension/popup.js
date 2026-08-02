const urlInput = document.getElementById("url");
const targetPriceInput = document.getElementById("targetPrice");
const badge = document.getElementById("badge");
const priceDisplay = document.getElementById("priceDisplay");
const priceDelta = document.getElementById("priceDelta");
const progressFill = document.getElementById("progressFill");
const metaTarget = document.getElementById("metaTarget");
const metaChecked = document.getElementById("metaChecked");
const metaNext = document.getElementById("metaNext");
const metaCount = document.getElementById("metaCount");
const resultLine = document.getElementById("resultLine");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

const DEFAULT_URL = "https://www.amazon.ca/dp/B0BF3JLKY2";
const DEFAULT_TARGET = 89.99;
const ALARM_NAME = "priceCheck";

function formatChecked(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCountdown(scheduledTime) {
  if (!scheduledTime) return "—";
  const diffMs = scheduledTime - Date.now();
  if (diffMs <= 0) return "any moment";
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

async function renderStatus(data) {
  const isActive = !!data.active;

  badge.innerHTML = isActive
    ? '<span class="pulse"></span>Active'
    : '<span class="pulse"></span>Stopped';
  badge.className = `badge ${isActive ? "active" : "inactive"}`;

  priceDisplay.textContent = data.lastPrice != null ? `$${data.lastPrice.toFixed(2)}` : "—";

  metaTarget.textContent = data.targetPrice != null ? `$${data.targetPrice.toFixed(2)}` : "—";
  metaChecked.textContent = formatChecked(data.lastChecked);
  metaCount.textContent = data.checkCount || 0;

  // Delta + progress bar, based on the first price ever recorded this run.
  if (data.lastPrice != null && data.targetPrice != null && data.baselinePrice != null) {
    const remaining = data.lastPrice - data.targetPrice;
    if (remaining <= 0) {
      priceDelta.textContent = "target reached";
      priceDelta.className = "price-delta close";
    } else {
      priceDelta.textContent = `$${remaining.toFixed(2)} to go`;
      priceDelta.className = remaining <= (data.baselinePrice - data.targetPrice) * 0.15
        ? "price-delta close"
        : "price-delta";
    }

    const span = data.baselinePrice - data.targetPrice;
    const progressed = data.baselinePrice - data.lastPrice;
    const pct = span > 0 ? Math.min(100, Math.max(0, (progressed / span) * 100)) : 0;
    progressFill.style.width = `${pct}%`;
  } else {
    priceDelta.textContent = "";
    progressFill.style.width = "0%";
  }

  if (data.lastResult) {
    resultLine.style.display = "block";
    resultLine.textContent = data.lastResult;
    resultLine.className = `result-line ${
      data.lastResult.startsWith("Error") || data.lastResult.startsWith("Could not") ? "error" : ""
    }`;
  } else {
    resultLine.style.display = "none";
  }

  if (isActive) {
    const alarm = await chrome.alarms.get(ALARM_NAME);
    metaNext.textContent = alarm ? formatCountdown(alarm.scheduledTime) : "—";
  } else {
    metaNext.textContent = "—";
  }
}

async function loadState() {
  const data = await chrome.storage.local.get([
    "url",
    "targetPrice",
    "active",
    "lastChecked",
    "lastPrice",
    "lastResult",
    "baselinePrice",
    "checkCount",
  ]);

  urlInput.value = data.url || DEFAULT_URL;
  targetPriceInput.value = data.targetPrice ?? DEFAULT_TARGET;
  await renderStatus(data);
}

startBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  const targetPrice = parseFloat(targetPriceInput.value);

  if (!url || Number.isNaN(targetPrice)) {
    resultLine.style.display = "block";
    resultLine.className = "result-line error";
    resultLine.textContent = "Enter a valid URL and target price.";
    return;
  }

  startBtn.disabled = true;
  resultLine.style.display = "block";
  resultLine.className = "result-line";
  resultLine.textContent = "Running first check...";

  chrome.runtime.sendMessage({ type: "START_TRACKING", url, targetPrice }, () => {
    startBtn.disabled = false;
    loadState();
  });
});

stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "STOP_TRACKING" }, () => {
    loadState();
  });
});

loadState();
