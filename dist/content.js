// src/content/content.ts
var TIMEOUT_MS = 15e3;
var POLL_INTERVAL_MS = 300;
var isProcessing = false;
async function waitFor(condition, timeoutMs = TIMEOUT_MS, intervalMs = POLL_INTERVAL_MS) {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (condition()) {
        resolve(true);
        return;
      }
      if (Date.now() - startTime > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function setNativeInputValue(input, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function findUrlInspectionInput() {
  const selectors = [
    'input[aria-label*="Inspect any URL"]',
    'input[placeholder*="Inspect any URL"]',
    'input[aria-label*="URL"]',
    'input[class*="url"]',
    'input[class*="inspection"]'
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.offsetParent !== null) return el;
  }
  const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
  for (const input of Array.from(inputs)) {
    if (input.offsetParent !== null) {
      const placeholder = input.placeholder?.toLowerCase() ?? "";
      const ariaLabel = input.getAttribute("aria-label")?.toLowerCase() ?? "";
      if (placeholder.includes("url") || ariaLabel.includes("url") || placeholder.includes("inspect") || ariaLabel.includes("inspect")) {
        return input;
      }
    }
  }
  return null;
}
function findRequestIndexingButton() {
  const wrapper = document.querySelector('[data-event-action="request-indexing"]');
  if (wrapper) {
    const btn = wrapper.querySelector('[role="button"][aria-disabled="false"]');
    if (btn) return btn;
    if (wrapper.getAttribute("aria-disabled") !== "true") return wrapper;
  }
  const roleButtons = document.querySelectorAll('[role="button"]');
  for (const btn of Array.from(roleButtons)) {
    const label = btn.getAttribute("aria-label")?.toLowerCase() ?? "";
    const disabled = btn.getAttribute("aria-disabled");
    if (label.includes("request indexing") && disabled !== "true") {
      return btn;
    }
  }
  const labelSpans = document.querySelectorAll(".cTsG4, .ZaflVd");
  for (const span of Array.from(labelSpans)) {
    if (span.textContent?.trim().toLowerCase() === "request indexing") {
      let el = span;
      while (el && el !== document.body) {
        if (el.getAttribute("role") === "button" && el.getAttribute("aria-disabled") !== "true") {
          return el;
        }
        el = el.parentElement;
      }
    }
  }
  return null;
}
function isAlreadyIndexed() {
  const text = document.body.innerText.toLowerCase();
  return text.includes("url is on google") || text.includes("url is indexed") || text.includes("indexed, not submitted") || text.includes("submitted and indexed");
}
function isNotEligible() {
  const text = document.body.innerText.toLowerCase();
  return text.includes("url is not on google") === false && (text.includes("not eligible") || text.includes("noindex") || text.includes("blocked by") || text.includes("crawl anomaly") || text.includes("redirect error") || text.includes("not found (404)"));
}
function hasInspectionResults() {
  if (document.querySelector('[data-event-action="request-indexing"]')) return true;
  if (findRequestIndexingButton()) return true;
  if (isAlreadyIndexed()) return true;
  const text = document.body.innerText.toLowerCase();
  return text.includes("url is on google") || text.includes("url is not on google") || text.includes("coverage") || text.includes("not eligible") || text.includes("noindex") || text.includes("discovered") || text.includes("crawled");
}
function isRateLimited() {
  const text = document.body.innerText.toLowerCase();
  return text.includes("quota") || text.includes("too many requests") || text.includes("rate limit");
}
async function submitUrlForInspection(url) {
  const input = findUrlInspectionInput();
  if (!input) {
    throw new Error(
      "Could not find URL inspection input. Make sure you are on a Google Search Console property page."
    );
  }
  input.focus();
  setNativeInputValue(input, "");
  setNativeInputValue(input, url);
  await sleep(200);
  const enterEvent = (type) => new KeyboardEvent(type, {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  });
  input.dispatchEvent(enterEvent("keydown"));
  input.dispatchEvent(enterEvent("keypress"));
  input.dispatchEvent(enterEvent("keyup"));
  const form = input.closest("form");
  if (form) {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }
}
function gscClick(el) {
  el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}
async function clickDismiss() {
  const byDialogAction = document.querySelector('[data-mdc-dialog-action="ok"]');
  if (byDialogAction) {
    gscClick(byDialogAction);
    await sleep(200);
    return;
  }
  const byAriaLabel = document.querySelector(
    '[aria-label="Dismiss"], [aria-label="Got it"], [aria-label="Close"], [aria-label="OK"]'
  );
  if (byAriaLabel) {
    gscClick(byAriaLabel);
    await sleep(200);
    return;
  }
  const dismissTexts = ["dismiss", "got it", "ok", "close"];
  for (const el of Array.from(document.querySelectorAll('[role="button"], button'))) {
    if (dismissTexts.includes(el.textContent?.trim().toLowerCase() ?? "")) {
      gscClick(el);
      await sleep(200);
      return;
    }
  }
}
async function processUrl(url) {
  try {
    await submitUrlForInspection(url);
  } catch (e) {
    return { status: "error", message: e.message };
  }
  const resultsLoaded = await waitFor(hasInspectionResults, 15e3);
  if (!resultsLoaded) {
    return { status: "error", message: "Timed out waiting for inspection results to load" };
  }
  await sleep(500);
  if (isRateLimited()) {
    return { status: "error", message: "Rate limit reached. Stop and try again later." };
  }
  if (isAlreadyIndexed()) {
    return { status: "already-indexed", message: "URL is already indexed by Google" };
  }
  if (isNotEligible()) {
    return { status: "not-eligible", message: "URL is not eligible for indexing" };
  }
  const requestBtn = findRequestIndexingButton();
  if (!requestBtn) {
    return {
      status: "error",
      message: 'Could not find "Request Indexing" button. URL may not be eligible.'
    };
  }
  gscClick(requestBtn);
  const dismissAppeared = await waitFor(
    () => document.querySelector('[data-mdc-dialog-action="ok"]'),
    2e4,
    300
  );
  if (!dismissAppeared) {
    return { status: "error", message: "Timed out waiting for Dismiss dialog" };
  }
  await clickDismiss();
  return { status: "submitted", message: "Indexing requested successfully" };
}
function isContextValid() {
  return !!chrome.runtime?.id;
}
function safeSendMessage(message) {
  if (!isContextValid()) return;
  chrome.runtime.sendMessage(message).catch(() => {
  });
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PROCESS_URL") {
    if (isProcessing) {
      sendResponse({ success: false, error: "Already processing a URL" });
      return true;
    }
    const { url } = message.payload;
    isProcessing = true;
    processUrl(url).then((result) => {
      isProcessing = false;
      safeSendMessage({ type: "URL_RESULT", payload: { url, ...result } });
      sendResponse({ success: true });
    }).catch((err) => {
      isProcessing = false;
      safeSendMessage({ type: "URL_RESULT", payload: { url, status: "error", message: String(err) } });
      sendResponse({ success: false });
    });
    return true;
  }
});
safeSendMessage({ type: "CONTENT_READY" });
//# sourceMappingURL=content.js.map
