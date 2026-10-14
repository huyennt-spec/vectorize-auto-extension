// Popup: đăng nhập tài khoản Today, xem quyền dùng do quản trị cấp, bật/tắt các bước tự động.
const $ = (id) => document.getElementById(id);
const T = TodayClient.TEXT;
const keys = Object.keys(VA.DEFAULTS);
const views = ['viewLoading', 'viewLogin', 'viewNoServer', 'viewMain'];
const show = (id) => views.forEach((v) => { $(v).hidden = v !== id; });
const send = (msg) => chrome.runtime.sendMessage(msg);

$('version').textContent = `v${chrome.runtime.getManifest().version}`;

// Màu nhãn quyền theo lý do.
const CHIP = {
  ok: ['ok', 'Được phép'], offline: ['warn', 'Ngoại tuyến'], disabled: ['warn', 'Tạm tắt'],
  outdated: ['warn', 'Cần cập nhật'], 'not-granted': ['warn', 'Chưa cấp quyền'],
  blocked: ['bad', 'Bị chặn'], locked: ['bad', 'Bị khoá'], expired: ['bad', 'Hết hạn'],
  'no-profile': ['bad', 'Chưa cấp tài khoản'], error: ['warn', 'Lỗi kiểm tra'],
};

function render(access) {
  if (!access || access.reason === 'not-configured') return show('viewNoServer');
  if (access.reason === 'not-signed-in') return show('viewLogin');
  show('viewMain');
  const u = access.user || {};
  $('avatar').textContent = (u.displayName || u.username || '?').trim().charAt(0).toUpperCase();
  $('displayName').textContent = u.displayName || u.username || '';
  const meta = [u.username && `@${u.username}`, T.roles[u.role], u.isAdmin && 'Quản trị'].filter(Boolean);
  if (u.expiresAt) meta.push(`hạn ${new Date(u.expiresAt).toLocaleDateString('vi-VN')}`);
  $('userMeta').textContent = meta.join(' · ');
  const reason = access.offline ? 'offline' : access.reason;
  const [cls, label] = CHIP[reason] || ['warn', reason];
  $('accessChip').className = `chip ${cls}`;
  $('accessChip').textContent = label;
  // Lý do không dùng được, hoặc lời nhắn của quản trị.
  const notice = !access.allowed || access.offline ? T.reasons[reason] || reason : access.message;
  $('notice').hidden = !notice;
  $('notice').textContent = notice || '';
  $('notice').className = `notice ${access.allowed ? (access.offline ? '' : 'info') : 'bad'}`;
  $('settingsCard').classList.toggle('locked', !access.allowed);
  for (const k of keys) $(k).disabled = !access.allowed || (k !== 'enabled' && !$('enabled').checked);
  $('openAdmin').hidden = !u.isAdmin;
}

// ---------- Đăng nhập / đăng xuất ----------
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginBtn').disabled = true;
  $('loginError').textContent = '';
  const r = await send({ type: 'va:today:signin', username: $('username').value, password: $('password').value })
    .catch((err) => ({ ok: false, text: String(err) }));
  $('loginBtn').disabled = false;
  if (!r.ok) {
    $('loginError').textContent = r.text || 'Đăng nhập không được';
    return;
  }
  $('password').value = '';
  render(r.access);
});

$('signOut').addEventListener('click', async () => {
  const r = await send({ type: 'va:today:signout' });
  render(r.access);
});

const openOptions = (hash) => {
  chrome.tabs.create({ url: chrome.runtime.getURL(`options/options.html${hash}`) });
  window.close();
};
$('openAccount').addEventListener('click', () => openOptions('#account'));
$('openAdmin').addEventListener('click', () => openOptions('#admin'));

// ---------- Cài đặt tự động ----------
chrome.storage.sync.get(VA.DEFAULTS).then((s) => {
  for (const k of keys) $(k).checked = s[k];
});
for (const k of keys) {
  $(k).addEventListener('change', (e) => {
    chrome.storage.sync.set({ [k]: e.target.checked });
    if (k === 'enabled') for (const o of keys) if (o !== 'enabled') $(o).disabled = !e.target.checked;
  });
}

chrome.storage.local.get('stats').then(({ stats = {} }) => {
  const today = new Date().toLocaleDateString('sv');
  $('today').textContent = stats.day === today ? stats.today || 0 : 0;
  $('total').textContent = stats.total || 0;
  if (stats.lastName) {
    const at = new Date(stats.lastAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    $('last').textContent = `Gần nhất: ${stats.lastName} (${at})`;
  }
});

// ---------- Trạng thái trên trang đang mở (cửa sổ hiện tại). Chưa chạy thì chèn script ngay. ----------
const { matches: PAGE_PATTERNS, js: CONTENT_FILES } = chrome.runtime.getManifest().content_scripts[0];
const ask = (tabId, msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => null);
function setStatus(text, cls) {
  $('status').textContent = text;
  $('pageDot').className = `dot ${cls}`;
}

async function pageStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [onPage] = tab ? await chrome.tabs.query({ url: PAGE_PATTERNS, windowId: tab.windowId, active: true }) : [];
  if (!onPage) return setStatus('Mở trang làm việc để xem trạng thái', '');
  let pong = await ask(tab.id, { type: 'va:ping' });
  if (!pong) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES }).catch(() => {});
    pong = await ask(tab.id, { type: 'va:ping' });
  }
  if (!pong) return setStatus('Chưa chạy được trên trang này — tải lại trang (F5)', 'off');
  if (!pong.allowed) return setStatus('Trên trang này: đang tạm dừng (không có quyền)', 'off');
  setStatus(`Đang chạy trên trang này${pong.waiting ? ` · ${pong.waiting} ảnh chờ` : ''}`, 'on');
  $('debug').hidden = false;
  $('debug').addEventListener('click', async () => {
    const report = await ask(tab.id, { type: 'va:debug' });
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 1));
      $('debug').textContent = 'Đã chép — dán gửi cho người hỗ trợ';
    } catch {
      $('debug').textContent = 'Không chép được';
    }
  });
}

// Lần đầu: hiện ngay kết quả đã lưu, rồi hỏi lại máy chủ.
(async () => {
  const { todayAccess } = await chrome.storage.local.get('todayAccess');
  if (todayAccess) render(todayAccess);
  render(await send({ type: 'va:today:access', force: true }).catch(() => todayAccess));
  pageStatus();
})();
