// Kiểm thử tự động trên trang giả lập (test/mock) với Chromium có cài extension.
// Chạy: npm install && npm test
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { chromium } = require('playwright');

const EXT = path.resolve(__dirname, '..');
const MOCK = path.join(__dirname, 'mock');
const HOME = 'https://vectorizer.ai/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Hết giờ chờ: ${what}`);
    await sleep(100);
  }
}

async function drop(page, names) {
  await page.evaluate((fileNames) => {
    const dt = new DataTransfer();
    for (const fileName of fileNames) {
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], fileName, { type: 'image/png' }));
    }
    const target = document.getElementById('drop') || document.body;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  }, [].concat(names));
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const downloads = [];
  await context.route(/^https:\/\/vectorizer\.ai\//, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/download/')) {
      const name = decodeURIComponent(url.pathname.split('-').slice(1).join('-')).replace(/\.png$/, '.svg');
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'image/svg+xml', 'content-disposition': `attachment; filename="${name}"` },
        body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      });
    }
    const file = !url.pathname.startsWith('/images/') ? 'index.html'
      : url.pathname.endsWith('/download') ? 'download.html' : 'result.html';
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(MOCK, file)) });
  });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const setSettings = (s) => sw.evaluate((v) => chrome.storage.sync.set(v), s);
  const stats = () => sw.evaluate(() => chrome.storage.local.get('stats').then((r) => r.stats || {}));
  const askTab = (msg) => sw.evaluate(async (m) => {
    const [tab] = await chrome.tabs.query({ url: 'https://vectorizer.ai/*' });
    return chrome.tabs.sendMessage(tab.id, m);
  }, msg);

  await setSettings({ minimize: false }); // Các bài thử khác cần cửa sổ mở
  const windowStates = () => sw.evaluate(() => chrome.windows.getAll().then((ws) => ws.map((w) => w.state)));
  const page = await context.newPage();
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  page.on('console', (m) => { if (/Auto Click/.test(m.text())) console.log('  [page]', m.text()); });
  const hasJob = () => sw.evaluate(() => chrome.storage.session.get(null)
    .then((s) => Object.keys(s).some((k) => k.startsWith('job:'))));
  const noOverlay = async () => assert.ok(await page.evaluate(() => !document.getElementById('ac-toast')
    && ![...document.querySelectorAll('body *')].some((el) => el.shadowRoot)), 'không được hiện gì trên trang');
  const expectCount = async (n, ms = 4000) => { await sleep(ms); assert.strictEqual(downloads.length, n); };

  // 1) Ảnh lớn: OK ở Pre-Crop → chờ Upload/Process/Fetch → DOWNLOAD → trang Download → Download
  await page.goto(HOME);
  await sleep(500);
  await drop(page, 'big-tim-anh.png');
  await page.waitForURL(/\/images\/[^/]+$/, { timeout: 8000 });
  assert.ok(await page.isVisible('#modal'), 'bảng Upload/Process/Fetch phải đang hiện');
  await noOverlay();
  await page.waitForURL(/\/download$/, { timeout: 10000 });
  await waitFor(() => downloads.length === 1, 15000, 'tải file 1');
  assert.strictEqual(downloads[0], 'big-tim-anh.svg');
  await waitFor(async () => (await stats()).total === 1, 5000, 'đếm file');
  await waitFor(async () => !(await hasJob()), 3000, 'xong việc');
  await noOverlay();
  await expectCount(1);
  assert.match(page.url(), /\/download$/); // Không tự chuyển trang
  console.log('✔ 1. Pre-Crop OK → chờ xử lý → DOWNLOAD → trang Download → Download');

  // 2) Kéo ảnh mới thẳng vào trang Download → tự làm tiếp ảnh mới
  await drop(page, 'tiep-theo.png');
  await waitFor(() => downloads.length === 2, 15000, 'tải file 2');
  assert.strictEqual(downloads[1], 'tiep-theo.svg');
  console.log('✔ 2. Kéo ảnh mới vào trang Download');

  // 3) Mở lại trang kết quả cũ (không có job) → không được tải trùng
  await page.goto(`${HOME}images/123-old.png`);
  await expectCount(2, 5000);
  console.log('✔ 3. Mở ảnh cũ không tự tải');

  // 4) Bấm CANCEL lúc đang xử lý → dừng, không tự bấm DOWNLOAD nữa
  await page.goto(HOME);
  await sleep(500);
  await drop(page, 'small-cancel.png');
  await page.waitForURL(/\/images\/[^/]+$/, { timeout: 8000 });
  await page.click('#cancel');
  await waitFor(async () => !(await hasJob()), 3000, 'dừng việc');
  await expectCount(2, 5000);
  console.log('✔ 4. Bấm CANCEL thì dừng');

  // 5) Tắt "tự bấm OK" → bảng Pre-Crop phải còn nguyên
  await setSettings({ autoPrecrop: false });
  await page.goto(HOME);
  await sleep(500);
  await drop(page, 'big-2.png');
  await sleep(3000);
  assert.ok(await page.isVisible('#pre h2'));
  assert.ok(!(await page.evaluate(() => window.__okDown)));
  await setSettings({ autoPrecrop: true });
  console.log('✔ 5. Tắt tự bấm OK thì không bấm');

  // 6) Ảnh nhỏ (không có Pre-Crop). Ảnh ở bước 5 bị bỏ dở → kéo ảnh mới vào là làm ảnh mới luôn.
  await page.goto(HOME);
  await sleep(3500);
  await drop(page, 'small.png');
  await waitFor(() => downloads.length === 3, 15000, 'tải file 3');
  assert.strictEqual(downloads[2], 'small.svg');
  console.log('✔ 6. Ảnh nhỏ không có Pre-Crop');

  // 7) Thả ảnh mới ngay trên trang kết quả (xử lý tại chỗ) → tải ảnh mới, không tải lại ảnh cũ
  await page.goto(`${HOME}images/456-small.png`);
  await expectCount(3, 3500); // Nút DOWNLOAD của ảnh cũ đã sẵn sàng nhưng không bấm
  await drop(page, 'next.png');
  await waitFor(() => downloads.length === 4, 15000, 'tải file 4');
  assert.strictEqual(downloads[3], 'next.svg');
  await expectCount(4, 3000);
  assert.strictEqual((await stats()).total, 4);
  await waitFor(async () => !(await hasJob()), 3000, 'xoá việc sau khi tải xong');
  console.log('✔ 7. Thả ảnh mới trên trang kết quả');

  // 7b) Trang không nhận cú bấm của script → tự mở thẳng link của nút DOWNLOAD
  await page.goto(`${HOME}images/789-old.png?strict=1`);
  await sleep(3500);
  await drop(page, 'strict.png');
  await waitFor(() => downloads.length === 5, 25000, 'tải file strict');
  assert.strictEqual(downloads[4], 'strict.svg');
  console.log('✔ 7b. Bấm không ăn thì mở thẳng link');

  // 7c) Có lớp trong suốt phủ lên nút (không phải bảng nào) → vẫn bấm sau vài giây
  await page.goto(`${HOME}images/791-old.png?overlay=1`);
  await sleep(3500);
  await drop(page, 'overlay.png');
  await waitFor(() => downloads.length === 6, 20000, 'tải file overlay');
  assert.strictEqual(downloads[5], 'overlay.svg');
  console.log('✔ 7c. Nút bị lớp trong suốt phủ vẫn bấm được');

  // 7d) Bảng Upload/Process/Fetch hiện ra giữa chừng mà không có kéo/thả → vẫn tự làm
  await page.goto(`${HOME}images/790-old.png`);
  await sleep(3500);
  await page.evaluate(() => window.__reprocess('silent.png'));
  await waitFor(() => downloads.length === 7, 15000, 'tải file silent');
  assert.strictEqual(downloads[6], 'silent.svg');
  await expectCount(7, 3000);
  console.log('✔ 7d. Nhận việc từ bảng tiến trình');

  // 8) Popup hỏi trạng thái / thông tin lỗi
  assert.ok((await askTab({ type: 'va:ping' })).ok);
  const report = await askTab({ type: 'va:debug' });
  assert.ok(Array.isArray(report.download) && report.page);
  console.log('✔ 8. Trạng thái và thông tin lỗi');

  // 9) Chèn script lần nữa (như lúc cài/cập nhật) → vẫn chỉ một bản chạy, không tải đôi
  await page.goto(HOME);
  await sleep(500);
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://vectorizer.ai/*' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/shared.js', 'src/content.js'] });
  });
  await drop(page, 'big-reinject.png');
  await waitFor(() => downloads.length === 8, 15000, 'tải file 8');
  await expectCount(8, 4000);
  console.log('✔ 9. Chèn script lại không bị chạy đôi');

  // 10b) Kéo ảnh lớn vào trang Download của ảnh cũ: Pre-Crop → OK → web thu nhỏ ảnh vài giây,
  // nút Download của ảnh cũ vẫn bấm được → KHÔNG được tải lại ảnh cũ, phải tải ảnh mới.
  await page.goto(HOME);
  await sleep(500);
  await drop(page, 'cu.png');
  await waitFor(() => downloads.length === 9, 15000, 'tải ảnh cũ');
  await page.waitForURL(/\/download$/, { timeout: 5000 });
  await sleep(1500);
  await drop(page, 'big-moi.png');
  await waitFor(() => downloads.length === 10, 20000, 'tải ảnh mới');
  assert.strictEqual(downloads[9], 'big-moi.svg', `tải nhầm: ${downloads[9]}`);
  await expectCount(10, 4000);
  console.log('✔ 10b. Kéo ảnh mới vào trang Download cũ: không tải lại ảnh cũ');

  // 11) Thao tác nhanh: thả ảnh khi ảnh trước chưa xong, thả nhiều ảnh một lúc → làm lần lượt, không lẫn
  await page.goto(HOME);
  await sleep(500);
  await drop(page, 'q1.png');
  await sleep(300);
  await drop(page, ['big-q2.png', 'q3.png']);
  await sleep(300);
  await drop(page, 'q4.png');
  await sleep(500);
  assert.strictEqual((await askTab({ type: 'va:ping' })).waiting, 3);
  await waitFor(() => downloads.length === 14, 90000, 'tải hết hàng chờ');
  assert.deepStrictEqual(downloads.slice(10), ['q1.svg', 'big-q2.svg', 'q3.svg', 'q4.svg']);
  await expectCount(14, 4000);
  assert.strictEqual((await askTab({ type: 'va:ping' })).waiting, 0);
  console.log('✔ 11. Hàng chờ: làm lần lượt từng ảnh, đúng thứ tự');

  // 12) Nhấn Esc → dừng ảnh đang làm và bỏ cả hàng chờ
  await page.goto(HOME);
  await sleep(500);
  await drop(page, 'q5.png');
  await sleep(300);
  await drop(page, ['q6.png', 'q7.png']);
  await page.waitForURL(/\/images\//, { timeout: 8000 });
  await page.keyboard.press('Escape');
  await expectCount(14, 8000);
  assert.strictEqual((await askTab({ type: 'va:ping' })).waiting, 0);
  console.log('✔ 12. Esc dừng cả hàng chờ');

  // 13) Nhận ảnh xong tự thu nhỏ cửa sổ, vẫn tải xong trong lúc thu nhỏ
  await setSettings({ minimize: true });
  await page.goto(HOME);
  await sleep(500);
  await drop(page, 'mini.png');
  await waitFor(async () => (await windowStates()).includes('minimized'), 5000, 'thu nhỏ cửa sổ');
  await waitFor(() => downloads.length === 15, 30000, 'tải lúc thu nhỏ');
  assert.strictEqual(downloads[14], 'mini.svg');
  await sw.evaluate(() => chrome.windows.getAll().then((ws) => Promise.all(
    ws.map((w) => chrome.windows.update(w.id, { state: 'normal' })))));
  await setSettings({ minimize: false });
  console.log('✔ 13. Tự thu nhỏ cửa sổ');

  // 14) Tắt extension → không bấm gì
  await setSettings({ enabled: false });
  await page.goto(HOME);
  await sleep(500);
  await drop(page, 'small-off.png');
  await page.waitForURL(/\/images\//, { timeout: 8000 });
  await expectCount(15, 5000);
  console.log('✔ 14. Tắt extension thì không bấm');

  await context.close();
  console.log('Tất cả đều qua.');
})().catch((e) => { console.error('✘', e); process.exit(1); });
