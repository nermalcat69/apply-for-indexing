import type { Message, ProcessUrlPayload, UrlStatus } from '../types';

const TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 300;

let isProcessing = false;

function findElementByText<T extends Element>(
  selector: string,
  text: string,
  exact = false
): T | null {
  const elements = document.querySelectorAll<T>(selector);
  const lowerText = text.toLowerCase();
  for (const el of Array.from(elements)) {
    const elText = el.textContent?.trim().toLowerCase() ?? '';
    if (exact ? elText === lowerText : elText.includes(lowerText)) {
      return el;
    }
  }
  return null;
}

async function waitFor(
  condition: () => boolean | null | undefined | Element,
  timeoutMs: number = TIMEOUT_MS,
  intervalMs: number = POLL_INTERVAL_MS
): Promise<boolean> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Simulate user typing in a React/Angular controlled input */
function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function findUrlInspectionInput(): HTMLInputElement | null {
  const selectors = [
    'input[aria-label*="Inspect any URL"]',
    'input[placeholder*="Inspect any URL"]',
    'input[aria-label*="URL"]',
    'input[class*="url"]',
    'input[class*="inspection"]',
  ];

  for (const selector of selectors) {
    const el = document.querySelector<HTMLInputElement>(selector);
    if (el && el.offsetParent !== null) return el;
  }

  // Fallback: find visible text inputs in a form/header area
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type])');
  for (const input of Array.from(inputs)) {
    if (input.offsetParent !== null) {
      const placeholder = input.placeholder?.toLowerCase() ?? '';
      const ariaLabel = input.getAttribute('aria-label')?.toLowerCase() ?? '';
      if (
        placeholder.includes('url') ||
        ariaLabel.includes('url') ||
        placeholder.includes('inspect') ||
        ariaLabel.includes('inspect')
      ) {
        return input;
      }
    }
  }

  return null;
}

/**
 * Find the "Request Indexing" button in GSC.
 * GSC renders it as <div role="button" aria-label="Request indexing…" aria-disabled="false">
 * wrapped in a <span data-event-action="request-indexing">.
 */
function findRequestIndexingButton(): Element | null {
  // Most reliable: Google's own event-action attribute on the wrapper span
  const wrapper = document.querySelector('[data-event-action="request-indexing"]');
  if (wrapper) {
    // The actual clickable element is the [role="button"] inside it
    const btn = wrapper.querySelector('[role="button"][aria-disabled="false"]');
    if (btn) return btn;
    // Wrapper itself might be the clickable target
    if (wrapper.getAttribute('aria-disabled') !== 'true') return wrapper;
  }

  // Fallback: any [role="button"] whose aria-label contains "request indexing"
  const roleButtons = document.querySelectorAll('[role="button"]');
  for (const btn of Array.from(roleButtons)) {
    const label = btn.getAttribute('aria-label')?.toLowerCase() ?? '';
    const disabled = btn.getAttribute('aria-disabled');
    if (label.includes('request indexing') && disabled !== 'true') {
      return btn;
    }
  }

  // Last resort: walk up from the visible span text ".cTsG4" (Request indexing label)
  const labelSpans = document.querySelectorAll('.cTsG4, .ZaflVd');
  for (const span of Array.from(labelSpans)) {
    if (span.textContent?.trim().toLowerCase() === 'request indexing') {
      let el: Element | null = span;
      while (el && el !== document.body) {
        if (
          el.getAttribute('role') === 'button' &&
          el.getAttribute('aria-disabled') !== 'true'
        ) {
          return el;
        }
        el = el.parentElement;
      }
    }
  }

  return null;
}

function isAlreadyIndexed(): boolean {
  const text = document.body.innerText.toLowerCase();
  return (
    text.includes('url is on google') ||
    text.includes('url is indexed') ||
    text.includes('indexed, not submitted') ||
    text.includes('submitted and indexed')
  );
}

function isNotEligible(): boolean {
  const text = document.body.innerText.toLowerCase();
  return (
    text.includes('url is not on google') === false &&
    (text.includes('not eligible') ||
      text.includes('noindex') ||
      text.includes('blocked by') ||
      text.includes('crawl anomaly') ||
      text.includes('redirect error') ||
      text.includes('not found (404)'))
  );
}

function hasInspectionResults(): boolean {
  // The request-indexing wrapper is the clearest signal the results panel has rendered
  if (document.querySelector('[data-event-action="request-indexing"]')) return true;
  if (findRequestIndexingButton()) return true;
  if (isAlreadyIndexed()) return true;

  const text = document.body.innerText.toLowerCase();
  return (
    text.includes('url is on google') ||
    text.includes('url is not on google') ||
    text.includes('coverage') ||
    text.includes('not eligible') ||
    text.includes('noindex') ||
    text.includes('discovered') ||
    text.includes('crawled')
  );
}

function isRateLimited(): boolean {
  const text = document.body.innerText.toLowerCase();
  return text.includes('quota') || text.includes('too many requests') || text.includes('rate limit');
}

async function submitUrlForInspection(url: string): Promise<void> {
  const input = findUrlInspectionInput();
  if (!input) {
    throw new Error(
      'Could not find URL inspection input. Make sure you are on a Google Search Console property page.'
    );
  }

  input.focus();
  setNativeInputValue(input, '');
  setNativeInputValue(input, url);
  await sleep(200);

  // Press Enter
  const enterEvent = (type: string) =>
    new KeyboardEvent(type, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    });

  input.dispatchEvent(enterEvent('keydown'));
  input.dispatchEvent(enterEvent('keypress'));
  input.dispatchEvent(enterEvent('keyup'));

  // Try form submit as fallback
  const form = input.closest('form');
  if (form) {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }
}

function gscClick(el: Element): void {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('mousedown',   { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('pointerup',   { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('mouseup',     { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('click',       { bubbles: true, cancelable: true }));
}

async function clickDismiss(): Promise<void> {
  // Primary: Material Design dialog action attribute (data-mdc-dialog-action="ok")
  const byDialogAction = document.querySelector<HTMLElement>('[data-mdc-dialog-action="ok"]');
  if (byDialogAction) {
    gscClick(byDialogAction);
    await sleep(200);
    return;
  }

  // Fallback: aria-label
  const byAriaLabel = document.querySelector<HTMLElement>(
    '[aria-label="Dismiss"], [aria-label="Got it"], [aria-label="Close"], [aria-label="OK"]'
  );
  if (byAriaLabel) {
    gscClick(byAriaLabel);
    await sleep(200);
    return;
  }

  // Fallback: visible text
  const dismissTexts = ['dismiss', 'got it', 'ok', 'close'];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[role="button"], button'))) {
    if (dismissTexts.includes(el.textContent?.trim().toLowerCase() ?? '')) {
      gscClick(el);
      await sleep(200);
      return;
    }
  }
}

async function processUrl(url: string): Promise<{ status: UrlStatus; message: string }> {
  // Step 1: Submit URL for inspection
  try {
    await submitUrlForInspection(url);
  } catch (e) {
    return { status: 'error', message: (e as Error).message };
  }

  // Step 2: Wait for results to load
  const resultsLoaded = await waitFor(hasInspectionResults, 15000);

  if (!resultsLoaded) {
    return { status: 'error', message: 'Timed out waiting for inspection results to load' };
  }

  await sleep(500);

  // Step 3: Check if rate limited
  if (isRateLimited()) {
    return { status: 'error', message: 'Rate limit reached. Stop and try again later.' };
  }

  // Step 4: Check if already indexed
  if (isAlreadyIndexed()) {
    return { status: 'already-indexed', message: 'URL is already indexed by Google' };
  }

  // Step 5: Check not eligible
  if (isNotEligible()) {
    return { status: 'not-eligible', message: 'URL is not eligible for indexing' };
  }

  // Step 6: Find and click "Request Indexing"
  const requestBtn = findRequestIndexingButton();
  if (!requestBtn) {
    return {
      status: 'error',
      message: 'Could not find "Request Indexing" button. URL may not be eligible.',
    };
  }

  gscClick(requestBtn);

  // Step 7: Wait directly for the Dismiss dialog to appear (up to 90s — GSC tests the live URL first)
  const dismissAppeared = await waitFor(
    () => document.querySelector<HTMLElement>('[data-mdc-dialog-action="ok"]'),
    20000,
    300
  );

  if (!dismissAppeared) {
    return { status: 'error', message: 'Timed out waiting for Dismiss dialog' };
  }

  await clickDismiss();

  return { status: 'submitted', message: 'Indexing requested successfully' };
}

/** Returns false if the extension has been reloaded and this context is stale. */
function isContextValid(): boolean {
  return !!chrome.runtime?.id;
}

function safeSendMessage(message: Message): void {
  if (!isContextValid()) return;
  chrome.runtime.sendMessage(message).catch(() => {});
}

// Listen for messages from the background service worker
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'PROCESS_URL') {
    if (isProcessing) {
      sendResponse({ success: false, error: 'Already processing a URL' });
      return true;
    }

    const { url } = message.payload as ProcessUrlPayload;
    isProcessing = true;

    processUrl(url)
      .then((result) => {
        isProcessing = false;
        safeSendMessage({ type: 'URL_RESULT', payload: { url, ...result } });
        sendResponse({ success: true });
      })
      .catch((err) => {
        isProcessing = false;
        safeSendMessage({ type: 'URL_RESULT', payload: { url, status: 'error', message: String(err) } });
        sendResponse({ success: false });
      });

    return true; // keep channel open for async
  }
});

// Notify background that content script is ready
safeSendMessage({ type: 'CONTENT_READY' });
