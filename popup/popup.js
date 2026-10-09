const keys = Object.keys(VA.DEFAULTS);
const opts = document.getElementById('opts');

chrome.storage.sync.get(VA.DEFAULTS).then((s) => {
  for (const k of keys) document.getElementById(k).checked = s[k];
  opts.disabled = !s.enabled;
});

for (const k of keys) {
  document.getElementById(k).addEventListener('change', (e) => {
    chrome.storage.sync.set({ [k]: e.target.checked });
    if (k === 'enabled') opts.disabled = !e.target.checked;
  });
}

chrome.storage.local.get('stats').then(({ stats = {} }) => {
  const today = new Date().toLocaleDateString('sv');
  document.getElementById('today').textContent = stats.day === today ? stats.today || 0 : 0;
  document.getElementById('total').textContent = stats.total || 0;
  if (stats.lastName) {
    const at = new Date(stats.lastAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('last').textContent = `Gần nhất: ${stats.lastName} (${at})`;
  }
});

// Trạng thái trên trang đang mở (cửa sổ hiện tại). Chưa chạy thì chèn script ngay.
const statusEl = document.getElementById('status');
const debugBtn = document.getElementById('debug');
const { matches: PAGE_PATTERNS, js: CONTENT_FILES } = chrome.runtime.getManifest().content_scripts[0];
const ask = (tabId, msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => null);

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = `status ${cls}`;
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [onPage] = tab ? await chrome.tabs.query({ url: PAGE_PATTERNS, windowId: tab.windowId, active: true }) : [];
  if (!onPage) return setStatus('Mở trang làm việc rồi bấm lại icon này để xem trạng thái.', '');
  let pong = await ask(tab.id, { type: 'va:ping' });
  if (!pong) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES }).catch(() => {});
    pong = await ask(tab.id, { type: 'va:ping' });
  }
  if (!pong) return setStatus('✗ Chưa chạy được trên trang này. Hãy tải lại trang (F5).', 'off');
  setStatus('✓ Đang chạy trên trang này', 'on');
  debugBtn.hidden = false;
  debugBtn.addEventListener('click', async () => {
    const report = await ask(tab.id, { type: 'va:debug' });
    const text = JSON.stringify(report, null, 1);
    try {
      await navigator.clipboard.writeText(text);
      debugBtn.textContent = 'Đã chép, dán gửi cho người hỗ trợ';
    } catch {
      debugBtn.textContent = 'Không chép được';
    }
  });
})();
