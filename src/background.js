// Theo dõi file tải về sau khi content script bấm DOWNLOAD, báo lại cho đúng tab
// khi tải xong (để tab tự quay về trang chính) và đếm số file đã tải.
importScripts('shared.js');

const VEC_URL_RX = /^(blob:)?https:\/\/([a-z0-9-]+\.)*vectorizer\.ai(\/|$)/i;
const CLAIM_WINDOW_MS = 60 * 1000; // File về trong vòng 60 giây sau khi bấm thì tính là của ảnh đó
const ANY_URL_WINDOW_MS = 15 * 1000; // File từ địa chỉ lạ chỉ tính nếu về trong 15 giây

// Service worker có thể bị tắt bất cứ lúc nào nên trạng thái lưu ở storage.session.
// Các thao tác đọc-sửa-ghi chạy lần lượt để không ghi đè lẫn nhau.
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

async function getState() {
  const { pending = {}, dlmap = {} } = await chrome.storage.session.get(['pending', 'dlmap']);
  return { pending, dlmap };
}

const basename = (p) => (p || '').split(/[\\/]/).pop();

// Khi vừa cài/cập nhật extension: chèn script vào các trang đang mở sẵn (kể cả cửa sổ app),
// để không phải đóng app mở lại.
const PAGE_PATTERNS = chrome.runtime.getManifest().content_scripts[0].matches;
const CONTENT_FILES = chrome.runtime.getManifest().content_scripts[0].js;

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: PAGE_PATTERNS });
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES }).catch(() => {});
  }
});

function notifyTab(tabId, msg) {
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'va:clicked' || !sender.tab) return;
  serial(async () => {
    const { pending } = await getState();
    pending[sender.tab.id] = { at: Date.now(), jobId: msg.jobId, name: msg.name };
    await chrome.storage.session.set({ pending });
  }).finally(() => sendResponse({ ok: true }));
  return true;
});

chrome.downloads.onCreated.addListener((item) => serial(async () => {
  const { pending, dlmap } = await getState();
  const fromVectorizer = [item.url, item.finalUrl, item.referrer].some((u) => u && VEC_URL_RX.test(u));
  const now = Date.now();
  let best = null;
  for (const [tabId, p] of Object.entries(pending)) {
    const age = now - p.at;
    if (age > CLAIM_WINDOW_MS) { delete pending[tabId]; continue; }
    if (!fromVectorizer && age > ANY_URL_WINDOW_MS) continue;
    if (!best || p.at > best.at) best = { ...p, tabId: Number(tabId) };
  }
  if (!best) {
    await chrome.storage.session.set({ pending });
    return;
  }
  delete pending[best.tabId];
  dlmap[item.id] = { tabId: best.tabId, jobId: best.jobId };
  await chrome.storage.session.set({ pending, dlmap });
  if (item.state === 'complete') await finish(item.id, 'complete');
}));

chrome.downloads.onChanged.addListener((delta) => {
  const state = delta.state?.current;
  if (state === 'complete' || state === 'interrupted') {
    serial(() => finish(delta.id, state, delta.error?.current));
  }
});

async function finish(downloadId, state, error) {
  const { dlmap } = await getState();
  const m = dlmap[downloadId];
  if (!m) return;
  delete dlmap[downloadId];
  await chrome.storage.session.set({ dlmap });
  const [item] = await chrome.downloads.search({ id: downloadId });
  const filename = basename(item?.filename);
  if (state === 'complete') {
    await bumpStats(filename);
    notifyTab(m.tabId, { type: 'va:dlComplete', jobId: m.jobId, filename });
  } else {
    notifyTab(m.tabId, { type: 'va:dlFailed', jobId: m.jobId, error: error || item?.error });
  }
}

async function bumpStats(filename) {
  const today = new Date().toLocaleDateString('sv'); // YYYY-MM-DD theo giờ máy
  const { stats = {} } = await chrome.storage.local.get('stats');
  const sameDay = stats.day === today;
  await chrome.storage.local.set({
    stats: {
      total: (stats.total || 0) + 1,
      day: today,
      today: (sameDay ? stats.today || 0 : 0) + 1,
      lastName: filename,
      lastAt: Date.now(),
    },
  });
}
