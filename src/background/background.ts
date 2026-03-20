import type {
  IndexingState,
  Message,
  FetchSitemapPayload,
  UrlResultPayload,
  UrlEntry,
} from '../types';

const DEFAULT_STATE: IndexingState = {
  sitemapUrl: '',
  urls: [],
  currentIndex: 0,
  isRunning: false,
};

const DELAY_BETWEEN_URLS_MS = 3000;
const MAX_URLS = 100;

async function getState(): Promise<IndexingState> {
  const result = await chrome.storage.local.get('indexingState');
  return result['indexingState'] ?? { ...DEFAULT_STATE };
}

async function setState(state: IndexingState): Promise<void> {
  await chrome.storage.local.set({ indexingState: state });
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', payload: state }).catch(() => {
    // Popup might not be open
  });
}

/** Extract all <loc>...</loc> text values from XML using regex.
 *  Safe for service workers which have no DOMParser. */
function extractLocs(xml: string): string[] {
  const results: string[] = [];
  const locRegex = /<loc[^>]*>([\s\S]*?)<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = locRegex.exec(xml)) !== null) {
    const url = match[1]!.trim()
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    if (url) results.push(url);
  }
  return results;
}

async function parseSitemapXml(text: string): Promise<string[]> {
  const isSitemapIndex = /<sitemapindex[\s>]/i.test(text);

  if (isSitemapIndex) {
    // Each <loc> inside a <sitemap> block is a child sitemap URL
    const childSitemapUrls = extractLocs(text);
    const childUrls: string[] = [];
    for (const childUrl of childSitemapUrls) {
      if (childUrls.length >= MAX_URLS) break;
      try {
        const urls = await fetchSitemapUrls(childUrl);
        childUrls.push(...urls);
      } catch (e) {
        console.error(`[AutoIndex] Failed to fetch child sitemap ${childUrl}:`, e);
      }
    }
    return childUrls.slice(0, MAX_URLS);
  }

  // Regular urlset — every <loc> is a page URL
  return extractLocs(text).slice(0, MAX_URLS);
}

async function fetchSitemapUrls(url: string): Promise<string[]> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const text = await response.text();
  return parseSitemapXml(text);
}

async function findGscTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({
    url: 'https://search.google.com/search-console/*',
  });
  return tabs[0] ?? null;
}

async function processNextUrl(): Promise<void> {
  const state = await getState();

  if (!state.isRunning) return;

  if (state.currentIndex >= state.urls.length) {
    await setState({ ...state, isRunning: false, completedAt: Date.now() });
    return;
  }

  const entry = state.urls[state.currentIndex];
  if (!entry) return;

  // Mark current as processing
  const updatedUrls = [...state.urls];
  updatedUrls[state.currentIndex] = { ...entry, status: 'processing' };
  await setState({ ...state, urls: updatedUrls });

  const tab = await findGscTab();
  if (!tab?.id) {
    // No GSC tab open, retry after a delay
    console.warn('[AutoIndex] No GSC tab found, retrying in 5s...');
    setTimeout(() => processNextUrl(), 5000);
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'PROCESS_URL',
      payload: { url: entry.url, index: state.currentIndex },
    });
  } catch {
    // Content script not injected yet, inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      await new Promise((r) => setTimeout(r, 1000));
      await chrome.tabs.sendMessage(tab.id, {
        type: 'PROCESS_URL',
        payload: { url: entry.url, index: state.currentIndex },
      });
    } catch (e2) {
      console.error('[AutoIndex] Failed to send message to content script:', e2);
      // Mark as error and move on
      const s = await getState();
      const urls2 = [...s.urls];
      urls2[s.currentIndex] = {
        ...urls2[s.currentIndex]!,
        status: 'error',
        message: 'Could not connect to GSC tab',
        processedAt: Date.now(),
      };
      await setState({ ...s, urls: urls2, currentIndex: s.currentIndex + 1 });
      setTimeout(() => processNextUrl(), DELAY_BETWEEN_URLS_MS);
    }
  }
}

chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse) => {
    (async () => {
      switch (message.type) {
        case 'FETCH_SITEMAP': {
          const { url } = message.payload as FetchSitemapPayload;
          try {
            const urls = await fetchSitemapUrls(url);
            if (urls.length === 0) {
              sendResponse({ success: false, error: 'No URLs found in sitemap' });
              return;
            }
            const entries: UrlEntry[] = urls.map((u) => ({
              url: u,
              status: 'pending',
            }));
            const state = await getState();
            await setState({
              ...state,
              sitemapUrl: url,
              urls: entries,
              currentIndex: 0,
              isRunning: false,
              completedAt: undefined,
              startedAt: undefined,
            });
            sendResponse({ success: true, count: urls.length });
          } catch (e) {
            sendResponse({ success: false, error: (e as Error).message });
          }
          break;
        }

        case 'START_INDEXING': {
          const state = await getState();
          if (state.urls.length === 0) {
            sendResponse({ success: false, error: 'No URLs loaded. Fetch a sitemap first.' });
            return;
          }
          // Find the first pending URL index
          const firstPending = state.urls.findIndex(
            (u) => u.status === 'pending' || u.status === 'processing'
          );
          const startIndex = firstPending === -1 ? 0 : firstPending;
          await setState({
            ...state,
            isRunning: true,
            startedAt: Date.now(),
            currentIndex: startIndex,
          });
          processNextUrl();
          sendResponse({ success: true });
          break;
        }

        case 'STOP_INDEXING': {
          const state = await getState();
          // Mark any processing URL back to pending
          const urls = state.urls.map((u) =>
            u.status === 'processing' ? { ...u, status: 'pending' as const } : u
          );
          await setState({ ...state, isRunning: false, urls });
          sendResponse({ success: true });
          break;
        }

        case 'GET_STATE': {
          const state = await getState();
          sendResponse(state);
          break;
        }

        case 'CLEAR_STATE': {
          await setState({ ...DEFAULT_STATE });
          sendResponse({ success: true });
          break;
        }

        case 'URL_RESULT': {
          const { url, status, message: msg } = message.payload as UrlResultPayload;
          const state = await getState();
          const urls = state.urls.map((entry) =>
            entry.url === url
              ? { ...entry, status, message: msg, processedAt: Date.now() }
              : entry
          );
          const nextIndex = state.currentIndex + 1;
          await setState({ ...state, urls, currentIndex: nextIndex });

          if (state.isRunning) {
            setTimeout(() => processNextUrl(), DELAY_BETWEEN_URLS_MS);
          }
          break;
        }
      }
    })();
    return true; // async response
  }
);

export {};
