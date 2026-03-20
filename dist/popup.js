// src/popup/popup.ts
var isPolling = false;
var pollTimer = null;
var el = (id) => document.getElementById(id);
var sitemapInput = el("sitemap-url");
var fetchBtn = el("fetch-btn");
var startBtn = el("start-btn");
var stopBtn = el("stop-btn");
var clearBtn = el("clear-btn");
var statusSection = el("status-section");
var progressBar = el("progress-bar");
var progressText = el("progress-text");
var currentUrlEl = el("current-url");
var urlList = el("url-list");
var fetchStatus = el("fetch-status");
var instructions = el("instructions");
function sendMsg(message) {
  return chrome.runtime.sendMessage(message);
}
var STATUS_ICON = {
  pending: "&#9203;",
  processing: "&#128260;",
  submitted: "&#9989;",
  "already-indexed": "&#128217;",
  error: "&#10060;",
  "not-eligible": "&#128683;"
};
var STATUS_LABEL = {
  pending: "Pending",
  processing: "Processing...",
  submitted: "Submitted",
  "already-indexed": "Already Indexed",
  error: "Error",
  "not-eligible": "Not Eligible"
};
function renderUrlEntry(entry) {
  const icon = STATUS_ICON[entry.status] ?? "&bull;";
  const label = STATUS_LABEL[entry.status] ?? entry.status;
  const msg = entry.message ? `<span class="url-entry__message">${entry.message}</span>` : "";
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
function updateUI(state) {
  const total = state.urls.length;
  const processed = state.urls.filter(
    (u) => u.status !== "pending" && u.status !== "processing"
  ).length;
  const submitted = state.urls.filter((u) => u.status === "submitted").length;
  const alreadyIndexed = state.urls.filter((u) => u.status === "already-indexed").length;
  const errors = state.urls.filter(
    (u) => u.status === "error" || u.status === "not-eligible"
  ).length;
  const pending = state.urls.filter((u) => u.status === "pending").length;
  if (total > 0) {
    instructions.style.display = "none";
    statusSection.style.display = "flex";
  } else {
    instructions.style.display = "flex";
    statusSection.style.display = "none";
  }
  if (total > 0) {
    const pct = total > 0 ? Math.round(processed / total * 100) : 0;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `${processed} / ${total} (${pct}%)`;
    el("stat-submitted").textContent = String(submitted);
    el("stat-indexed").textContent = String(alreadyIndexed);
    el("stat-errors").textContent = String(errors);
    el("stat-pending").textContent = String(pending);
    const processing = state.urls.find((u) => u.status === "processing");
    if (processing) {
      currentUrlEl.textContent = `Processing: ${processing.url}`;
      currentUrlEl.style.display = "block";
    } else if (state.isRunning) {
      currentUrlEl.textContent = "Waiting before next URL...";
      currentUrlEl.style.display = "block";
    } else {
      currentUrlEl.style.display = "none";
    }
    const processedEntries = state.urls.filter((u) => u.status !== "pending").slice(-10).reverse();
    urlList.innerHTML = processedEntries.map(renderUrlEntry).join("");
  }
  startBtn.disabled = total === 0 || state.isRunning;
  stopBtn.disabled = !state.isRunning;
  fetchBtn.disabled = state.isRunning;
  clearBtn.disabled = state.isRunning;
  if (state.isRunning) {
    startBtn.textContent = "Running...";
  } else if (total > 0 && processed === total) {
    startBtn.textContent = "Completed";
  } else if (total > 0) {
    startBtn.textContent = `Start Indexing (${total} URLs)`;
  } else {
    startBtn.textContent = "Start Indexing";
  }
  if (state.isRunning && !isPolling) {
    startPolling();
  } else if (!state.isRunning && isPolling) {
    stopPolling();
  }
}
async function loadState() {
  const state = await sendMsg({ type: "GET_STATE" });
  updateUI(state);
}
function startPolling() {
  if (isPolling) return;
  isPolling = true;
  pollTimer = setInterval(loadState, 1e3);
}
function stopPolling() {
  isPolling = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
fetchBtn.addEventListener("click", async () => {
  const url = sitemapInput.value.trim();
  if (!url) {
    fetchStatus.textContent = "Please enter a sitemap URL";
    fetchStatus.className = "fetch-status fetch-status--error";
    return;
  }
  fetchBtn.disabled = true;
  fetchBtn.textContent = "Fetching...";
  fetchStatus.textContent = "Fetching sitemap...";
  fetchStatus.className = "fetch-status";
  try {
    const result = await sendMsg({
      type: "FETCH_SITEMAP",
      payload: { url }
    });
    if (result.success) {
      fetchStatus.textContent = `Loaded ${result.count} URLs (max 100)`;
      fetchStatus.className = "fetch-status fetch-status--success";
      await loadState();
    } else {
      fetchStatus.textContent = `Error: ${result.error}`;
      fetchStatus.className = "fetch-status fetch-status--error";
    }
  } catch (e) {
    fetchStatus.textContent = `Error: ${e.message}`;
    fetchStatus.className = "fetch-status fetch-status--error";
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = "Fetch";
  }
});
startBtn.addEventListener("click", async () => {
  const result = await sendMsg({
    type: "START_INDEXING"
  });
  if (!result.success) {
    fetchStatus.textContent = `Error: ${result.error}`;
    fetchStatus.className = "fetch-status fetch-status--error";
    return;
  }
  await loadState();
  startPolling();
});
stopBtn.addEventListener("click", async () => {
  await sendMsg({ type: "STOP_INDEXING" });
  await loadState();
  stopPolling();
});
clearBtn.addEventListener("click", async () => {
  stopPolling();
  await sendMsg({ type: "CLEAR_STATE" });
  sitemapInput.value = "";
  fetchStatus.textContent = "";
  fetchStatus.className = "fetch-status";
  await loadState();
});
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "STATE_UPDATE") {
    updateUI(message.payload);
  }
});
loadState();
//# sourceMappingURL=popup.js.map
