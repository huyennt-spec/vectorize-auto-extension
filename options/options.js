// Trang Tài khoản & Quản trị. Mọi quyền thật do rules của máy chủ Today kiểm tra; trang này chỉ hiện
// đúng chức năng cho đúng người. Không chèn dữ liệu người dùng bằng innerHTML.
const $ = (id) => document.getElementById(id);
const T = TodayClient.TEXT;
const send = (msg) => chrome.runtime.sendMessage(msg);
let access = null;
let data = null; // Dữ liệu quản trị: { users, access, usage, config }

$('version').textContent = `v${chrome.runtime.getManifest().version}`;
$('appVersion').textContent = chrome.runtime.getManifest().version;

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}

let toastTimer = 0;
function toast(text, bad = false) {
  $('toast').textContent = text;
  $('toast').className = `toast${bad ? ' bad' : ''}`;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}

// ---------- Thẻ tab ----------
function selectTab() {
  const want = location.hash === '#admin' && access?.user?.isAdmin ? 'admin' : 'account';
  for (const a of $('tabs').querySelectorAll('a')) a.classList.toggle('active', a.dataset.tab === want);
  $('tab-account').hidden = want !== 'account';
  $('tab-admin').hidden = want !== 'admin';
  if (want === 'admin' && !data) loadAdmin();
}
addEventListener('hashchange', selectTab);

// ---------- Tài khoản ----------
const CHIP = {
  ok: ['ok', 'Được phép dùng'], offline: ['warn', 'Ngoại tuyến'], disabled: ['warn', 'Đang tạm tắt'],
  outdated: ['warn', 'Cần cập nhật'], 'not-granted': ['warn', 'Chưa được cấp quyền'],
  blocked: ['bad', 'Bị chặn'], locked: ['bad', 'Tài khoản bị khoá'], expired: ['bad', 'Hết hạn'],
  'no-profile': ['bad', 'Chưa cấp tài khoản'], error: ['warn', 'Lỗi kiểm tra'],
};

function renderAccount(a) {
  access = a;
  const signedIn = a && !['not-signed-in', 'not-configured'].includes(a.reason);
  $('loginCard').hidden = !a || a.reason !== 'not-signed-in';
  $('noServerCard').hidden = !a || a.reason !== 'not-configured';
  $('accountCard').hidden = !signedIn;
  $('adminTab').hidden = !a?.user?.isAdmin;
  if (signedIn) {
    const u = a.user || {};
    $('avatar').textContent = (u.displayName || u.username || '?').trim().charAt(0).toUpperCase();
    $('displayName').textContent = u.displayName || u.username || '';
    const meta = [u.username && `@${u.username}`, T.roles[u.role], u.isAdmin && 'Quản trị'].filter(Boolean);
    if (u.expiresAt) meta.push(`hạn dùng ${new Date(u.expiresAt).toLocaleDateString('vi-VN')}`);
    $('userMeta').textContent = meta.join(' · ');
    const reason = a.offline ? 'offline' : a.reason;
    const [cls, label] = CHIP[reason] || ['warn', reason];
    $('accessChip').className = `chip ${cls}`;
    $('accessChip').textContent = label;
    const notice = !a.allowed || a.offline ? T.reasons[reason] || reason : a.message;
    $('notice').hidden = !notice;
    $('notice').textContent = notice || '';
    $('notice').className = `notice ${a.allowed ? (a.offline ? '' : 'info') : 'bad'}`;
    $('checkedAt').textContent = a.checkedAt ? new Date(a.checkedAt).toLocaleString('vi-VN') : '—';
  }
  selectTab();
}

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
  data = null;
  renderAccount(r.access);
});
$('signOut').addEventListener('click', async () => {
  data = null;
  renderAccount((await send({ type: 'va:today:signout' })).access);
});
$('recheck').addEventListener('click', async () => {
  renderAccount(await send({ type: 'va:today:access', force: true }));
  toast('Đã kiểm tra lại quyền');
});

// ---------- Quản trị ----------
const day = () => new Date().toLocaleDateString('sv');
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '');
const toDateInput = (ms) => (ms ? new Date(ms).toLocaleDateString('sv') : '');
const fromDateInput = (v) => (v ? new Date(`${v}T23:59:59`).getTime() : null);

async function run(action, ok) {
  try {
    await action();
    if (ok) toast(ok);
    await loadAdmin(true);
  } catch (e) {
    toast(TodayClient.errorText(e), true);
  }
}

async function loadAdmin(quiet = false) {
  if (!quiet) $('membersSummary').textContent = 'Đang tải…';
  $('adminError').textContent = '';
  try {
    data = await TodayClient.admin.overview();
  } catch (e) {
    $('adminError').textContent = TodayClient.errorText(e);
    $('membersSummary').textContent = '';
    return;
  }
  const c = data.config;
  $('cfgEnabled').checked = c.enabled !== false;
  $('cfgDefault').value = c.defaultAllow === false ? 'deny' : 'allow';
  $('cfgMinVersion').value = c.minVersion || '';
  $('cfgMessage').value = c.message || '';
  renderMembers();
}

function renderMembers() {
  if (!data) return;
  const q = $('search').value.trim().toLowerCase();
  const defAllow = data.config.defaultAllow !== false;
  const rows = Object.entries(data.users)
    .map(([uid, u]) => ({ uid, ...(u || {}) }))
    .filter((u) => !q || `${u.displayName || ''} ${u.username || ''}`.toLowerCase().includes(q))
    .sort((a, b) => String(a.displayName || a.username).localeCompare(String(b.displayName || b.username), 'vi'));
  let allowedCount = 0;
  const body = $('members');
  body.replaceChildren(...rows.map((u) => {
    const grant = data.access[u.uid];
    const us = data.usage[u.uid] || {};
    const active = u.status === 'active';
    const expired = u.expiresAt && u.expiresAt < Date.now();
    const canUse = active && !expired && data.config.enabled !== false && (grant === true || (grant !== false && defAllow));
    if (canUse) allowedCount++;
    const me = u.uid === access?.user?.uid;

    const accessSel = el('select', { class: 'input', onchange: (e) => run(
      () => TodayClient.admin.setAccess(u.uid, e.target.value === 'default' ? null : e.target.value === 'allow'),
      'Đã cập nhật quyền Auto Click') },
    el('option', { value: 'default', text: `Theo mặc định (${defAllow ? 'được dùng' : 'không'})` }),
    el('option', { value: 'allow', text: 'Cho phép' }),
    el('option', { value: 'deny', text: 'Chặn' }));
    accessSel.value = grant === true ? 'allow' : grant === false ? 'deny' : 'default';

    const expiry = el('input', { class: 'input', type: 'date', value: toDateInput(u.expiresAt), onchange: (e) => run(
      () => TodayClient.admin.setExpiry(u.uid, fromDateInput(e.target.value)), 'Đã cập nhật hạn dùng') });

    const statusBtn = el('button', {
      class: `btn btn-sm${active ? ' btn-danger' : ''}`, text: active ? 'Khoá' : 'Mở khoá', disabled: me,
      title: me ? 'Không tự khoá chính mình' : '',
      onclick: () => run(() => TodayClient.admin.setStatus(u.uid, active ? 'locked' : 'active'),
        active ? 'Đã khoá tài khoản' : 'Đã mở khoá tài khoản'),
    });

    return el('tr', {},
      el('td', {}, el('div', { class: 'member' },
        el('div', { class: 'avatar', text: String(u.displayName || u.username || '?').charAt(0).toUpperCase() }),
        el('div', {}, el('div', { class: 'nm', text: u.displayName || u.username || u.uid },
          me ? el('span', { class: 'badge me', text: 'bạn' }) : null),
        el('div', { class: 'un', text: u.username ? `@${u.username}` : u.uid })))),
      el('td', {}, el('span', { class: 'badge', text: T.roles[u.role] || u.role || '—' })),
      el('td', {}, el('div', { class: 'cell-actions' },
        el('span', { class: `chip ${active ? 'ok' : 'bad'}`, text: active ? 'Hoạt động' : 'Đã khoá' }), statusBtn)),
      el('td', {}, el('div', { class: 'cell-actions' }, expiry,
        expired ? el('span', { class: 'chip bad', text: 'Hết hạn' }) : null)),
      el('td', {}, el('div', { class: 'cell-actions' }, accessSel,
        el('span', { class: `chip ${canUse ? 'ok' : 'bad'}`, text: canUse ? 'Dùng được' : 'Không dùng được' }))),
      el('td', {}, el('div', { class: 'usage' },
        el('div', {}, 'Hôm nay ', el('b', { text: String(us.days?.[day()] || 0) }), ' · Tổng ', el('b', { text: String(us.total || 0) })),
        el('div', { class: 'dim', text: us.lastSeen ? `Online ${fmtTime(us.lastSeen)}${us.version ? ` · v${us.version}` : ''}` : 'Chưa dùng' }))));
  }));
  const total = Object.keys(data.users).length;
  $('membersSummary').textContent = `${total} thành viên · ${allowedCount}${q ? ' (trong kết quả lọc)' : ''} đang dùng được Auto Click`;
}

$('search').addEventListener('input', renderMembers);
$('reload').addEventListener('click', () => loadAdmin());

$('saveConfig').addEventListener('click', () => {
  const minVersion = $('cfgMinVersion').value.trim();
  if (minVersion && !/^\d+(\.\d+){0,2}$/.test(minVersion)) return toast('Phiên bản dạng 2.0.0', true);
  return run(async () => {
    await TodayClient.admin.setConfig({
      enabled: $('cfgEnabled').checked,
      defaultAllow: $('cfgDefault').value === 'allow',
      minVersion,
      message: $('cfgMessage').value.trim().slice(0, 300),
    });
    $('configSaved').textContent = `Đã lưu lúc ${new Date().toLocaleTimeString('vi-VN')}`;
  }, 'Đã lưu cài đặt chung');
});

$('createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('createError').textContent = '';
  $('createBtn').disabled = true;
  try {
    await TodayClient.admin.createMember({
      username: $('newUsername').value, displayName: $('newDisplayName').value, password: $('newPassword').value,
      role: $('newRole').value, expiresAt: fromDateInput($('newExpiry').value),
    });
    e.target.reset();
    toast('Đã tạo tài khoản');
    await loadAdmin(true);
  } catch (err) {
    $('createError').textContent = TodayClient.errorText(err);
  } finally {
    $('createBtn').disabled = false;
  }
});

// Lần đầu: hiện ngay kết quả đã lưu, rồi hỏi lại máy chủ.
(async () => {
  const { todayAccess } = await chrome.storage.local.get('todayAccess');
  if (todayAccess) renderAccount(todayAccess);
  renderAccount(await send({ type: 'va:today:access', force: true }).catch(() => todayAccess));
})();
