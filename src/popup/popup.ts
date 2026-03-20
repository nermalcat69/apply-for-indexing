import type { IndexingState, Message, UrlEntry, UrlStatus } from '../types';

let isPolling = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// DOM refs
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const sitemapInput = el<HTMLInputElement>('sitemap-url');
const fetchBtn = el<HTMLButtonElement>('fetch-btn');
const startBtn = el<HTMLButtonElement>('start-btn');
const stopBtn = el<HTMLButtonElement>('stop-btn');
const clearBtn = el<HTMLButtonElement>('clear-btn');
const statusSection = el<HTMLDivElement>('status-section');
const progressBar = el<HTMLDivElement>('progress-bar');
const progressText = el<HTMLSpanElement>('progress-text');
const currentUrlEl = el<HTMLParagraphElement>('current-url');
const urlList = el<HTMLDivElement>('url-list');
const fetchStatus = el<HTMLParagraphElement>('fetch-status');
const instructions = el<HTMLDivElement>('instructions');

function sendMsg<R = unknown>(message: Message): Promise<R> {
  return chrome.runtime.sendMessage(message);
}

const STATUS_ICON: Record<UrlStatus, string> = {
  pending: '&#9203;',
  processing: '&#128260;',
  submitted: '&#9989;',
  'already-indexed': '&#128217;',
  error: '&#10060;',
  'not-eligible': '&#128683;',
};

const STATUS_LABEL: Record<UrlStatus, string> = {
  pending: 'Pending',
  processing: 'Processing...',
  submitted: 'Submitted',
  'already-indexed': 'Already Indexed',
  error: 'Error',
  'not-eligible': 'Not Eligible',
};

function renderUrlEntry(entry: UrlEntry): string {
  const icon = STATUS_ICON[entry.status] ?? '&bull;';
  const label = STATUS_LABEL[entry.status] ?? entry.status;
  const msg = entry.message
    ? `<span class="url-entry__message">${entry.message}</span>`
    : '';
  return `
    <div class="url-entry url-entry--${entry.status}">
      <span class="url-entry__icon">${icon}</span>
      <div class="url-entry__content">
        <span class="url-entry__url" title="${entry.url}">${entry.url}</span>
        <span class="url-entry__label">${label}</span>
        ${msg}
      </div>
    </div>
  `;
}

function updateUI(state: IndexingState): void {
  const total = state.urls.length;
  const processed = state.urls.filter(
    (u) => u.status !== 'pending' && u.status !== 'processing'
  ).length;
  const submitted = state.urls.filter((u) => u.status === 'submitted').length;
  const alreadyIndexed = state.urls.filter((u) => u.status === 'already-indexed').length;
  const errors = state.urls.filter(
    (u) => u.status === 'error' || u.status === 'not-eligible'
  ).length;
  const pending = state.urls.filter((u) => u.status === 'pending').length;

  // Instructions
  if (total > 0) {
    instructions.style.display = 'none';
    statusSection.style.display = 'flex';
  } else {
    instructions.style.display = 'flex';
    statusSection.style.display = 'none';
  }

  if (total > 0) {
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `${processed} / ${total} (${pct}%)`;

    el('stat-submitted').textContent = String(submitted);
    el('stat-indexed').textContent = String(alreadyIndexed);
    el('stat-errors').textContent = String(errors);
    el('stat-pending').textContent = String(pending);

    const processing = state.urls.find((u) => u.status === 'processing');
    if (processing) {
      currentUrlEl.textContent = `Processing: ${processing.url}`;
      currentUrlEl.style.display = 'block';
    } else if (state.isRunning) {
      currentUrlEl.textContent = 'Waiting before next URL...';
      currentUrlEl.style.display = 'block';
    } else {
      currentUrlEl.style.display = 'none';
    }

    // Show last 10 processed entries (most recent first)
    const processedEntries = state.urls
      .filter((u) => u.status !== 'pending')
      .slice(-10)
      .reverse();
    urlList.innerHTML = processedEntries.map(renderUrlEntry).join('');
  }

  // Button states
  startBtn.disabled = total === 0 || state.isRunning;
  stopBtn.disabled = !state.isRunning;
  fetchBtn.disabled = state.isRunning;
  clearBtn.disabled = state.isRunning;

  if (state.isRunning) {
    startBtn.textContent = 'Running...';
  } else if (total > 0 && processed === total) {
    startBtn.textContent = 'Completed';
  } else if (total > 0) {
    startBtn.textContent = `Start Indexing (${total} URLs)`;
  } else {
    startBtn.textContent = 'Start Indexing';
  }

  // Polling
  if (state.isRunning && !isPolling) {
    startPolling();
  } else if (!state.isRunning && isPolling) {
    stopPolling();
  }
}

async function loadState(): Promise<void> {
  const state = await sendMsg<IndexingState>({ type: 'GET_STATE' });
  updateUI(state);
}

function startPolling(): void {
  if (isPolling) return;
  isPolling = true;
  pollTimer = setInterval(loadState, 1000);
}

function stopPolling(): void {
  isPolling = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Event handlers
fetchBtn.addEventListener('click', async () => {
  const url = sitemapInput.value.trim();
  if (!url) {
    fetchStatus.textContent = 'Please enter a sitemap URL';
    fetchStatus.className = 'fetch-status fetch-status--error';
    return;
  }

  fetchBtn.disabled = true;
  fetchBtn.textContent = 'Fetching...';
  fetchStatus.textContent = 'Fetching sitemap...';
  fetchStatus.className = 'fetch-status';

  try {
    const result = await sendMsg<{ success: boolean; count?: number; error?: string }>({
      type: 'FETCH_SITEMAP',
      payload: { url },
    });

    if (result.success) {
      fetchStatus.textContent = `Loaded ${result.count} URLs (max 100)`;
      fetchStatus.className = 'fetch-status fetch-status--success';
      await loadState();
    } else {
      fetchStatus.textContent = `Error: ${result.error}`;
      fetchStatus.className = 'fetch-status fetch-status--error';
    }
  } catch (e) {
    fetchStatus.textContent = `Error: ${(e as Error).message}`;
    fetchStatus.className = 'fetch-status fetch-status--error';
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Fetch';
  }
});

startBtn.addEventListener('click', async () => {
  const result = await sendMsg<{ success: boolean; error?: string }>({
    type: 'START_INDEXING',
  });

  if (!result.success) {
    fetchStatus.textContent = `Error: ${result.error}`;
    fetchStatus.className = 'fetch-status fetch-status--error';
    return;
  }

  await loadState();
  startPolling();
});

stopBtn.addEventListener('click', async () => {
  await sendMsg({ type: 'STOP_INDEXING' });
  await loadState();
  stopPolling();
});

clearBtn.addEventListener('click', async () => {
  stopPolling();
  await sendMsg({ type: 'CLEAR_STATE' });
  sitemapInput.value = '';
  fetchStatus.textContent = '';
  fetchStatus.className = 'fetch-status';
  await loadState();
});

// Listen for push updates from background
chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === 'STATE_UPDATE') {
    updateUI(message.payload as IndexingState);
  }
});

// Init
loadState();
