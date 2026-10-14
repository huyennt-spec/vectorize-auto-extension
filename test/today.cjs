// Quản lý của hệ thống Today: rules máy chủ, quyền dùng trong extension, popup và trang quản trị.
// Chạy trên máy chủ giả lập (Firebase Emulator) — xem test/today-server.cjs.
// Chạy: npm install && node test/today.cjs
const assert = require('assert');
const { launch, sleep, waitFor, HOME, today } = require('./harness.cjs');

const { db, token, users, createUser } = today;
const uid = (name) => users[name].uid;
const denied = (r, what) => assert.ok([401, 403].includes(r.status), `${what}: phải bị từ chối (HTTP ${r.status})`);
const allowed = (r, what) => assert.ok(r.ok, `${what}: phải được phép (HTTP ${r.status} ${JSON.stringify(r.data)})`);
const DAY = new Date().toLocaleDateString('sv');

(async () => {
  await today.ready();
  await createUser('khoa', { profile: { status: 'locked' } });
  await createUser('hethan', { profile: { expiresAt: Date.now() - 60 * 1000 } });
  await createUser('chuacap', { profile: null });
  const tk = {};
  for (const n of ['quantri', 'tester', 'khoa', 'hethan', 'chuacap']) tk[n] = await token(n);

  // ===================== 1. Rules máy chủ =====================
  // Khách chưa đăng nhập: không đọc được gì của Today mới; các nhánh cũ (Today v5) vẫn như trước.
  denied(await db('GET', 'users', undefined, null), 'khách đọc users');
  denied(await db('GET', 'apps/autoclick/config', undefined, null), 'khách đọc config');
  denied(await db('PUT', `apps/autoclick/access/${uid('tester')}`, true, null), 'khách tự cấp quyền');
  allowed(await db('GET', 'system_config', undefined, null), 'nhánh cũ system_config');

  // Thành viên: chỉ xem được của mình, không tự cấp quyền / mở khoá / sửa cài đặt.
  const me = tk.tester;
  allowed(await db('GET', `users/${uid('tester')}`, undefined, me), 'xem hồ sơ mình');
  denied(await db('GET', 'users', undefined, me), 'xem danh sách thành viên');
  denied(await db('GET', `users/${uid('khoa')}`, undefined, me), 'xem hồ sơ người khác');
  denied(await db('PATCH', `users/${uid('tester')}`, { status: 'active', expiresAt: 9e12 }, me), 'tự gia hạn');
  denied(await db('PUT', `apps/autoclick/access/${uid('tester')}`, true, me), 'tự cấp quyền');
  allowed(await db('GET', `apps/autoclick/access/${uid('tester')}`, undefined, me), 'xem quyền của mình');
  denied(await db('GET', 'apps/autoclick/access', undefined, me), 'xem quyền cả đội');
  allowed(await db('GET', 'apps/autoclick/config', undefined, me), 'đọc cài đặt chung');
  denied(await db('PATCH', 'apps/autoclick/config', { enabled: true }, me), 'sửa cài đặt chung');
  denied(await db('PUT', `admins/${uid('tester')}`, true, me), 'tự làm quản trị');
  allowed(await db('PATCH', `apps/autoclick/usage/${uid('tester')}`, { total: { '.sv': { increment: 1 } } }, me), 'báo số file của mình');
  denied(await db('PATCH', `apps/autoclick/usage/${uid('khoa')}`, { total: 5 }, me), 'ghi số liệu người khác');
  denied(await db('PATCH', `apps/autoclick/usage/${uid('tester')}`, { hack: 1 }, me), 'ghi trường lạ');
  denied(await db('PATCH', `apps/autoclick/usage/${uid('tester')}`, { total: -1 }, me), 'ghi số âm');
  // Tài khoản khoá / hết hạn / chưa có hồ sơ: không đọc cài đặt, không ghi số liệu.
  for (const n of ['khoa', 'hethan', 'chuacap']) {
    denied(await db('GET', 'apps/autoclick/config', undefined, tk[n]), `${n} đọc cài đặt`);
    denied(await db('PATCH', `apps/autoclick/usage/${uid(n)}`, { total: 1 }, tk[n]), `${n} ghi số liệu`);
  }
  // Quản trị: quản lý được mọi thứ của Auto Click và thành viên, nhưng không tự thêm quản trị.
  const ad = tk.quantri;
  allowed(await db('GET', 'users', undefined, ad), 'quản trị xem thành viên');
  allowed(await db('PUT', `apps/autoclick/access/${uid('khoa')}`, false, ad), 'quản trị chặn');
  denied(await db('PUT', `apps/autoclick/access/${uid('khoa')}`, 'yes', ad), 'giá trị quyền sai kiểu');
  allowed(await db('DELETE', `apps/autoclick/access/${uid('khoa')}`, undefined, ad), 'quản trị bỏ chặn');
  allowed(await db('PATCH', 'apps/autoclick/config', { enabled: true, defaultAllow: true, minVersion: '', message: '' }, ad), 'quản trị lưu cài đặt');
  denied(await db('PATCH', 'apps/autoclick/config', { minVersion: 'abc' }, ad), 'phiên bản sai dạng');
  denied(await db('PATCH', 'apps/autoclick/config', { other: 1 }, ad), 'trường cài đặt lạ');
  denied(await db('PATCH', `users/${uid('tester')}`, { role: 'boss' }, ad), 'vai trò không có');
  denied(await db('PATCH', `users/${uid('tester')}`, { status: 'whatever' }, ad), 'trạng thái không có');
  denied(await db('PUT', `admins/${uid('tester')}`, true, ad), 'thêm quản trị từ extension');
  allowed(await db('GET', 'apps/autoclick/usage', undefined, ad), 'quản trị xem số liệu');
  await db('DELETE', 'apps/autoclick/usage');
  console.log('✔ 1. Rules máy chủ: thành viên không tự cấp quyền, quản trị quản lý được, nhánh cũ giữ nguyên');

  // ===================== 2. Quyền dùng trong extension =====================
  const t = await launch({ signIn: null });
  const { sw, page, downloads, context } = t;
  const extId = new URL(sw.url()).host;
  const access = (force = true) => sw.evaluate((f) => getAccess(f), force);
  const ping = () => sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://vectorizer.ai/*' });
    return chrome.tabs.sendMessage(tab.id, { type: 'va:ping' });
  });
  // Thả ảnh nhỏ (không có Pre-Crop); không có quyền thì trang chạy như thường nhưng không ai bấm DOWNLOAD.
  const dropNoAuto = async (name) => {
    const n = downloads.length;
    await page.goto(HOME);
    await sleep(500);
    await t.drop(name);
    await page.waitForURL(/\/images\//, { timeout: 8000 });
    await sleep(5000);
    assert.strictEqual(downloads.length, n, `không được tải: ${downloads.join(', ')}`);
    assert.strictEqual(await t.hasJob(), false, 'không được nhận việc');
  };
  const dropAuto = async (name) => {
    const n = downloads.length;
    await page.goto(HOME);
    await sleep(500);
    await t.drop(name);
    await t.expectDownloads(n + 1, 20000, name);
    assert.strictEqual(downloads[n], name.replace(/\.png$/, '.svg'));
  };

  // Chưa trỏ máy chủ (bản cài chưa có Web API key): không dùng được.
  assert.strictEqual((await access()).reason, 'not-configured');
  await sw.evaluate((s) => chrome.storage.local.set({ todayServer: s }), today.SERVER);
  assert.strictEqual((await access()).reason, 'not-signed-in');
  // Địa chỉ máy chủ lạ (không phải máy này) bị bỏ qua: không ai trỏ được extension sang máy chủ khác.
  await sw.evaluate((s) => chrome.storage.local.set({ todayServer: { ...s, databaseURL: 'https://evil.example' } }), today.SERVER);
  assert.strictEqual((await access()).reason, 'not-configured');
  await sw.evaluate((s) => chrome.storage.local.set({ todayServer: s }), today.SERVER);
  await dropNoAuto('small-chua-dang-nhap.png');
  assert.strictEqual((await ping()).allowed, false);
  console.log('✔ 2. Chưa đăng nhập: không bấm gì, trang chạy như thường');

  // Đăng nhập sai / đúng.
  const signIn = (u, p) => sw.evaluate(([a, b]) => TodayClient.signIn(a, b).then(() => getAccess(true),
    (e) => ({ error: e.code, text: TodayClient.errorText(e) })), [u, p]);
  assert.deepStrictEqual(await signIn('tester', 'sai-mat-khau'),
    { error: 'wrong-credentials', text: 'Sai tên đăng nhập hoặc mật khẩu' });
  const a1 = await signIn('tester', users.tester.password);
  assert.strictEqual(a1.allowed, true);
  assert.strictEqual(a1.user.displayName, 'Người thử');
  await waitFor(async () => (await ping()).allowed, 3000, 'trang nhận quyền');
  await dropAuto('small-duoc-phep.png');
  await waitFor(async () => (await db('GET', `apps/autoclick/usage/${uid('tester')}`)).data?.total === 1, 5000, 'máy chủ đếm file');
  const usage = (await db('GET', `apps/autoclick/usage/${uid('tester')}`)).data;
  assert.strictEqual(usage.days[DAY], 1);
  assert.ok(usage.lastSeen > 0 && usage.version, 'báo lần dùng gần nhất');
  console.log('✔ 3. Đăng nhập: được dùng, máy chủ ghi số file đã tải');

  // Quản trị chặn → trang dừng ngay (không đợi tải lại trang).
  await db('PUT', `apps/autoclick/access/${uid('tester')}`, false);
  assert.strictEqual((await access()).reason, 'blocked');
  await waitFor(async () => !(await ping()).allowed, 3000, 'trang nhận lệnh chặn');
  await dropNoAuto('small-bi-chan.png');
  console.log('✔ 4. Quản trị chặn: không dùng được');

  // Chặn giữa chừng: ảnh đang xử lý thì dừng, không tải.
  await db('DELETE', `apps/autoclick/access/${uid('tester')}`);
  assert.strictEqual((await access()).allowed, true);
  await page.goto(HOME);
  await sleep(500);
  const before = downloads.length;
  await t.drop('small-giua-chung.png');
  await page.waitForURL(/\/images\//, { timeout: 8000 });
  assert.ok(await t.hasJob(), 'đang làm ảnh');
  await db('PUT', `apps/autoclick/access/${uid('tester')}`, false);
  await access();
  await waitFor(async () => !(await t.hasJob()), 3000, 'dừng ảnh đang làm');
  await sleep(5000);
  assert.strictEqual(downloads.length, before, 'không được tải sau khi bị chặn');
  await db('DELETE', `apps/autoclick/access/${uid('tester')}`);
  console.log('✔ 5. Bị chặn giữa chừng: dừng ngay ảnh đang làm');

  // Cài đặt chung của quản trị.
  const cases = [
    [{ enabled: false, message: 'Bảo trì tối nay' }, 'disabled'],
    [{ enabled: true, minVersion: '99.0.0' }, 'outdated'],
    [{ minVersion: '2.0.0', defaultAllow: false }, 'not-granted'],
  ];
  for (const [conf, reason] of cases) {
    await db('PATCH', 'apps/autoclick/config', conf);
    const a = await access();
    assert.strictEqual(a.reason, reason, JSON.stringify(conf));
    assert.strictEqual(a.allowed, false);
  }
  await db('PUT', `apps/autoclick/access/${uid('tester')}`, true); // Cấp riêng khi mặc định là không
  assert.strictEqual((await access()).allowed, true);
  await dropAuto('small-cap-rieng.png');
  await db('PUT', 'apps/autoclick/config', { enabled: true, defaultAllow: true, message: 'Chào cả đội' });
  await db('DELETE', `apps/autoclick/access/${uid('tester')}`);
  assert.strictEqual((await access()).message, 'Chào cả đội');
  console.log('✔ 6. Tắt cả đội / bắt cập nhật / mặc định không cho dùng / cấp riêng');

  // Tài khoản Today bị khoá, hết hạn.
  await db('PATCH', `users/${uid('tester')}`, { status: 'locked' });
  assert.strictEqual((await access()).reason, 'locked');
  await db('PATCH', `users/${uid('tester')}`, { status: 'active', expiresAt: Date.now() - 1000 });
  assert.strictEqual((await access()).reason, 'expired');
  await db('DELETE', `users/${uid('tester')}/expiresAt`);
  assert.strictEqual((await access()).allowed, true);
  console.log('✔ 7. Tài khoản bị khoá / hết hạn: không dùng được');

  // Mất mạng: đang được phép thì dùng tạm (tối đa 12 giờ), đang bị chặn thì vẫn chặn.
  const goOffline = () => sw.evaluate((s) => chrome.storage.local.set({ todayServer: { ...s, databaseURL: 'http://127.0.0.1:9' } }), today.SERVER);
  const goOnline = () => sw.evaluate((s) => chrome.storage.local.set({ todayServer: s }), today.SERVER);
  await goOffline();
  let a = await access();
  assert.strictEqual(a.allowed, true);
  assert.strictEqual(a.offline, true);
  await sw.evaluate(() => chrome.storage.local.get('todayAccess').then(({ todayAccess }) =>
    chrome.storage.local.set({ todayAccess: { ...todayAccess, verifiedAt: Date.now() - 13 * 3600 * 1000 } })));
  a = await access();
  assert.strictEqual(a.allowed, false);
  assert.strictEqual(a.reason, 'offline');
  await goOnline();
  await db('PUT', `apps/autoclick/access/${uid('tester')}`, false);
  assert.strictEqual((await access()).reason, 'blocked');
  await goOffline();
  assert.strictEqual((await access()).allowed, false, 'đang bị chặn thì mất mạng vẫn chặn');
  await goOnline();
  await db('DELETE', `apps/autoclick/access/${uid('tester')}`);
  assert.strictEqual((await access()).allowed, true);
  console.log('✔ 8. Mất mạng: được phép thì dùng tạm 12 giờ, bị chặn thì vẫn chặn');

  // Phiên đăng nhập: token hết hạn tự làm mới; phiên bị thu hồi → đăng xuất.
  await sw.evaluate(() => chrome.storage.local.get('todaySession').then(({ todaySession: s }) =>
    chrome.storage.local.set({ todaySession: { ...s, expiresAt: 0 } })));
  assert.strictEqual((await access()).allowed, true);
  const s1 = await sw.evaluate(() => chrome.storage.local.get('todaySession').then((r) => r.todaySession));
  assert.ok(s1.expiresAt > Date.now() + 10 * 60 * 1000, 'đã làm mới token');
  await sw.evaluate(() => chrome.storage.local.get('todaySession').then(({ todaySession: s }) =>
    chrome.storage.local.set({ todaySession: { ...s, expiresAt: 0, refreshToken: 'thu-hoi' } })));
  assert.strictEqual((await access()).reason, 'not-signed-in');
  assert.strictEqual(await sw.evaluate(() => chrome.storage.local.get('todaySession').then((r) => r.todaySession || null)), null);
  console.log('✔ 9. Token tự làm mới; phiên bị thu hồi thì đăng xuất');

  // ===================== 3. Popup =====================
  const popup = await context.newPage();
  popup.on('pageerror', (e) => console.log('  [popup lỗi]', e.message));
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForSelector('#viewLogin:not([hidden])');
  await popup.fill('#username', 'tester');
  await popup.fill('#password', 'sai');
  await popup.click('#loginBtn');
  await waitFor(async () => (await popup.textContent('#loginError')).includes('Sai tên'), 5000, 'báo sai mật khẩu');
  await popup.fill('#password', users.tester.password);
  await popup.click('#loginBtn');
  await popup.waitForSelector('#viewMain:not([hidden])');
  assert.strictEqual(await popup.textContent('#accessChip'), 'Được phép');
  assert.strictEqual(await popup.textContent('#displayName'), 'Người thử');
  assert.strictEqual(await popup.textContent('#notice'), 'Chào cả đội');
  assert.strictEqual(await popup.isEnabled('#enabled'), true);
  assert.strictEqual(await popup.isVisible('#openAdmin'), false, 'thành viên không thấy nút Quản trị');
  await waitFor(async () => (await ping()).allowed, 3000, 'trang nhận quyền sau khi đăng nhập ở popup');
  await db('PUT', `apps/autoclick/access/${uid('tester')}`, false);
  await popup.reload();
  await waitFor(async () => (await popup.textContent('#accessChip')) === 'Bị chặn', 5000, 'popup hiện bị chặn');
  assert.strictEqual(await popup.textContent('#notice'), 'Quản trị đã chặn bạn dùng Auto Click');
  assert.strictEqual(await popup.isEnabled('#enabled'), false, 'bị chặn thì khoá các công tắc');
  await db('DELETE', `apps/autoclick/access/${uid('tester')}`);
  await popup.click('#signOut');
  await popup.waitForSelector('#viewLogin:not([hidden])');
  await popup.close();
  console.log('✔ 10. Popup: đăng nhập, hiện quyền và lời nhắn, bị chặn thì khoá công tắc, đăng xuất');

  // ===================== 4. Trang Tài khoản & Quản trị =====================
  const opt = await context.newPage();
  opt.on('pageerror', (e) => console.log('  [trang quản trị lỗi]', e.message));
  await opt.goto(`chrome-extension://${extId}/options/options.html#admin`);
  await opt.waitForSelector('#loginCard:not([hidden])');
  // Thành viên thường: không có thẻ Quản trị, mở thẳng #admin cũng chỉ thấy Tài khoản.
  await opt.fill('#username', 'tester');
  await opt.fill('#password', users.tester.password);
  await opt.click('#loginBtn');
  await opt.waitForSelector('#accountCard:not([hidden])');
  assert.strictEqual(await opt.isVisible('#adminTab'), false);
  assert.strictEqual(await opt.isVisible('#tab-admin'), false);
  await opt.click('#signOut');
  await opt.waitForSelector('#loginCard:not([hidden])');

  // Quản trị.
  await opt.fill('#username', 'quantri');
  await opt.fill('#password', users.quantri.password);
  await opt.click('#loginBtn');
  await opt.waitForSelector('#adminTab:not([hidden])');
  await opt.click('#adminTab');
  await opt.waitForSelector('#tab-admin:not([hidden])');
  await waitFor(async () => (await opt.$$('#members tr')).length === 4, 5000, 'danh sách thành viên');
  assert.match(await opt.textContent('#membersSummary'), /^4 thành viên/);
  const row = async (name) => {
    for (const tr of await opt.$$('#members tr')) if ((await tr.textContent()).includes(`@${name}`)) return tr;
    throw new Error(`không thấy ${name}`);
  };
  // Chặn một người.
  await (await (await row('tester')).$('select')).selectOption('deny');
  await waitFor(async () => (await db('GET', `apps/autoclick/access/${uid('tester')}`)).data === false, 5000, 'lưu chặn');
  await waitFor(async () => (await (await row('tester')).textContent()).includes('Không dùng được'), 5000, 'bảng cập nhật');
  await (await (await row('tester')).$('select')).selectOption('default');
  await waitFor(async () => (await db('GET', `apps/autoclick/access/${uid('tester')}`)).data === null, 5000, 'bỏ chặn');
  // Khoá / mở khoá tài khoản; không tự khoá mình.
  assert.strictEqual(await (await (await row('quantri')).$('button')).isDisabled(), true, 'không tự khoá mình');
  await (await (await row('tester')).$('button')).click();
  await waitFor(async () => (await db('GET', `users/${uid('tester')}/status`)).data === 'locked', 5000, 'khoá');
  await waitFor(async () => (await (await row('tester')).textContent()).includes('Mở khoá'), 5000, 'nút Mở khoá');
  await (await (await row('tester')).$('button')).click();
  await waitFor(async () => (await db('GET', `users/${uid('tester')}/status`)).data === 'active', 5000, 'mở khoá');
  // Hạn dùng.
  await (await (await row('tester')).$('input[type=date]')).fill('2030-01-31');
  await waitFor(async () => {
    const v = (await db('GET', `users/${uid('tester')}/expiresAt`)).data;
    return v && new Date(v).toLocaleDateString('sv') === '2030-01-31';
  }, 5000, 'lưu hạn dùng');
  // Cài đặt chung.
  await waitFor(async () => (await opt.inputValue('#cfgMessage')) === 'Chào cả đội', 5000, 'nạp cài đặt');
  await opt.setChecked('#cfgEnabled', false);
  await opt.fill('#cfgMinVersion', '1.9');
  await opt.click('#saveConfig');
  await waitFor(async () => (await db('GET', 'apps/autoclick/config/enabled')).data === false, 5000, 'lưu cài đặt');
  assert.strictEqual((await db('GET', 'apps/autoclick/config/minVersion')).data, '1.9');
  assert.strictEqual((await access()).reason, 'disabled', 'cả đội tạm dừng');
  await opt.setChecked('#cfgEnabled', true);
  await opt.click('#saveConfig');
  await waitFor(async () => (await db('GET', 'apps/autoclick/config/enabled')).data === true, 5000, 'bật lại');
  // Thêm thành viên mới → đăng nhập được, dùng được ngay (mặc định cho phép).
  await opt.fill('#newUsername', 'lan');
  await opt.fill('#newDisplayName', 'Lan Nguyễn');
  await opt.fill('#newPassword', 'lan-123456');
  await opt.selectOption('#newRole', 'publisher');
  await opt.click('#createBtn');
  await waitFor(async () => (await opt.$$('#members tr')).length === 5, 5000, 'thành viên mới trong bảng');
  await opt.fill('#newUsername', 'lan');
  await opt.fill('#newPassword', 'lan-123456');
  await opt.click('#createBtn');
  await waitFor(async () => (await opt.textContent('#createError')).includes('đã có người dùng'), 5000, 'báo trùng tên');
  await opt.close();
  users.lan = { password: 'lan-123456' };
  const a2 = await signIn('lan', 'lan-123456');
  assert.strictEqual(a2.allowed, true);
  assert.strictEqual(a2.user.displayName, 'Lan Nguyễn');
  assert.strictEqual(a2.user.role, 'publisher');
  await dropAuto('small-lan.png');
  console.log('✔ 11. Quản trị: chặn/bỏ chặn, khoá/mở khoá, hạn dùng, cài đặt chung, thêm thành viên');

  await context.close();
  console.log('Tất cả đều qua.');
  process.exit(0);
})().catch((e) => { console.error('✘', e); process.exit(1); });
