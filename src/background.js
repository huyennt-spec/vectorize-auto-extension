// Theo dõi file tải về sau khi content script bấm DOWNLOAD, báo lại cho đúng tab khi tải xong,
// đếm số file đã tải, và giữ quyền dùng do quản trị Today cấp (kiểm tra với máy chủ Today).
importScripts('shared.js', 'today-config.js', 'today.js');

const VEC_URL_RX = /^(blob:)?https:\/\/([a-z0-9-]+\.)*vectorizer\.ai(\/|$)/i;
const CLAIM_WINDOW_MS = 60 * 1000; // File về trong vòng 60 giây sau khi bấm thì tính là của ảnh đó
const ANY_URL_WINDOW_MS = 15 * 1000; // File từ địa chỉ lạ chỉ tính nếu về trong 15 giây
const DUP_WINDOW_MS = 2 * 60 * 1000; // File trùng địa chỉ với file vừa tải trong bấy lâu → bản trùng

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

// Cho phép trang tự tải nhiều file liên tiếp. Nếu không, từ file thứ hai Chrome giữ file lại và hỏi
// "Tải xuống nhiều tệp" — cửa sổ đang thu nhỏ nên bạn không thấy để bấm Cho phép.
function allowAutomaticDownloads() {
  for (const primaryPattern of PAGE_PATTERNS) {
    try {
      chrome.contentSettings?.automaticDownloads?.set({ primaryPattern, setting: 'allow' }, () => void chrome.runtime.lastError);
    } catch {}
  }
}
chrome.runtime.onStartup.addListener(allowAutomaticDownloads);

chrome.runtime.onInstalled.addListener(async () => {
  allowAutomaticDownloads();
  const tabs = await chrome.tabs.query({ url: PAGE_PATTERNS });
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES }).catch(() => {});
  }
});

function notifyTab(tabId, msg) {
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

// ---------- Quyền dùng (máy chủ Today quyết định) ----------
// Lưu kết quả kiểm tra gần nhất. Kiểm tra lại mỗi 5 phút, khi đăng nhập/đăng xuất, và khi trang hỏi
// mà kết quả đã cũ hơn 1 phút. Mất mạng: dùng tạm kết quả "được phép" gần nhất trong 12 giờ.
const ACCESS_KEY = 'todayAccess';
const ACCESS_FRESH_MS = 60 * 1000;
const OFFLINE_GRACE_MS = 12 * 60 * 60 * 1000;
let accessCheck = null;

async function refreshAccess() {
  const { [ACCESS_KEY]: prev } = await chrome.storage.local.get(ACCESS_KEY);
  let next;
  try {
    next = await TodayClient.checkAccess();
  } catch (e) {
    if (e.code === 'network' && prev?.allowed && Date.now() - (prev.verifiedAt || 0) < OFFLINE_GRACE_MS) {
      next = { ...prev, offline: true };
    } else {
      next = { allowed: false, reason: e.code === 'network' ? 'offline' : 'error', error: e.code || String(e), user: prev?.user };
    }
  }
  next.checkedAt = Date.now();
  if (next.allowed && !next.offline) delete next.offline;
  await chrome.storage.local.set({ [ACCESS_KEY]: next });
  if (!prev || prev.allowed !== next.allowed || prev.reason !== next.reason) broadcastAccess(next);
  return next;
}

function getAccess(force = false) {
  accessCheck ??= (async () => {
    const { [ACCESS_KEY]: cached } = await chrome.storage.local.get(ACCESS_KEY);
    if (!force && cached && Date.now() - (cached.checkedAt || 0) < ACCESS_FRESH_MS) return cached;
    return refreshAccess();
  })().finally(() => { accessCheck = null; });
  return accessCheck;
}

async function broadcastAccess(access) {
  const tabs = await chrome.tabs.query({ url: PAGE_PATTERNS }).catch(() => []);
  for (const tab of tabs) notifyTab(tab.id, { type: 'va:access', access });
}

// Tạo một lần (tạo lại mỗi lần service worker thức dậy sẽ đẩy lùi giờ chạy mãi).
chrome.alarms.get('today-access').then((a) => a || chrome.alarms.create('today-access', { periodInMinutes: 5 }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'today-access') refreshAccess(); });

// Trang của chính extension (popup, trang Tài khoản & Quản trị — trang này mở trong tab nên có sender.tab).
const EXT_ORIGIN = chrome.runtime.getURL('');
const fromExtensionPage = (sender) => (sender.url || '').startsWith(EXT_ORIGIN);

// Tin nhắn từ popup / trang cài đặt.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!fromExtensionPage(sender)) return;
  if (msg?.type === 'va:today:signin') {
    TodayClient.signIn(msg.username, msg.password)
      .then(() => getAccess(true))
      .then((access) => sendResponse({ ok: true, access }),
        (e) => sendResponse({ ok: false, error: e.code || String(e), text: TodayClient.errorText(e) }));
    return true;
  }
  if (msg?.type === 'va:today:signout') {
    TodayClient.signOut().then(() => getAccess(true)).then((access) => sendResponse({ ok: true, access }));
    return true;
  }
  if (msg?.type === 'va:today:access') {
    getAccess(!!msg.force).then((access) => sendResponse(access));
    return true;
  }
});

// Việc đang làm của từng tab được giữ ở đây (không phụ thuộc bộ nhớ của trang), nên
// trang có chuyển đi đâu trong cùng cửa sổ thì vẫn nhớ đang chờ tải ảnh nào.
const jobKey = (tabId) => `job:${tabId}`;

// Mã của lần mở trình duyệt này: ảnh còn sót trong hàng chờ từ lần trước sẽ bị bỏ.
async function getBootId() {
  let { bootId } = await chrome.storage.session.get('bootId');
  if (!bootId) {
    bootId = crypto.randomUUID();
    await chrome.storage.session.set({ bootId });
  }
  return bootId;
}

async function setJob(tabId, job) {
  if (job) await chrome.storage.session.set({ [jobKey(tabId)]: job });
  else await chrome.storage.session.remove(jobKey(tabId));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined || fromExtensionPage(sender)) return;
  if (msg?.type === 'va:access:get') {
    getAccess(!!msg.force).then((access) => sendResponse(access), () => sendResponse({ allowed: false, reason: 'error' }));
    return true;
  }
  if (msg?.type === 'va:hello') {
    serial(async () => ({
      tabId,
      bootId: await getBootId(),
      job: (await chrome.storage.session.get(jobKey(tabId)))[jobKey(tabId)] || null,
      ends: (await chrome.storage.session.get('ends')).ends || [],
    })).then((r) => sendResponse(r), () => sendResponse({ tabId, bootId: '', job: null }));
    return true;
  }
  if (msg?.type === 'va:ended') { // Lý do kết thúc các ảnh gần đây (để tìm lỗi)
    chrome.storage.session.set({ ends: msg.ends }).catch(() => {});
    return;
  }
  if (msg?.type === 'va:minimize') {
    chrome.windows.update(sender.tab.windowId, { state: 'minimized' }).catch(() => {});
    return;
  }
  if (msg?.type === 'va:job:set') {
    serial(() => setJob(tabId, msg.job)).finally(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'va:clicked') {
    serial(async () => {
      const { pending } = await getState();
      pending[tabId] = { at: Date.now(), jobId: msg.job.id, name: msg.job.name };
      await chrome.storage.session.set({ pending });
      await setJob(tabId, msg.job);
    }).finally(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => serial(() => setJob(tabId, null)));

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
  const url = item.finalUrl || item.url;
  const { claimed = [] } = await chrome.storage.session.get('claimed');
  const recent = claimed.filter((c) => now - c.at < DUP_WINDOW_MS);
  if (!best) {
    await chrome.storage.session.set({ pending, claimed: recent });
    // Lưới an toàn: cùng file của một ảnh vừa tải (vd. các lần bấm Chrome giữ lại rồi thả ra một lúc)
    // → huỷ bản trùng để không có "tên (1).svg".
    if (fromVectorizer && url && recent.some((c) => c.url === url)) {
      chrome.downloads.cancel(item.id).then(() => chrome.downloads.erase({ id: item.id })).catch(() => {});
    }
    return;
  }
  delete pending[best.tabId];
  dlmap[item.id] = { tabId: best.tabId, jobId: best.jobId };
  recent.push({ url, jobId: best.jobId, at: now });
  await chrome.storage.session.set({ pending, dlmap, claimed: recent });
  notifyTab(best.tabId, { type: 'va:dlStarted', jobId: best.jobId });
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
  // Xong việc: xoá luôn ở đây, phòng khi trang đang chuyển nên không nhận được tin nhắn.
  const key = jobKey(m.tabId);
  const { [key]: job } = await chrome.storage.session.get(key);
  if (job?.id === m.jobId) await setJob(m.tabId, null);
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
  TodayClient.reportDownload(); // Cho trang quản trị biết số file đã tải
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
