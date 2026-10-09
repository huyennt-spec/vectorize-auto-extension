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

async function drop(page, name) {
  await page.evaluate((fileName) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], fileName, { type: 'image/png' }));
    const target = document.getElementById('drop') || document.body;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  }, name);
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

  const page = await context.newPage();
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  page.on('console', (m) => { if (/Auto Click/.test(m.text())) console.log('  [page]', m.text()); });
  const toastText = () => page.evaluate(() => document.getElementById('ac-toast')
    ?.shadowRoot.querySelector('.t').textContent || '');
  const expectCount = async (n, ms = 4000) => { await sleep(ms); assert.strictEqual(downloads.length, n); };

  // 1) Ảnh lớn: OK ở Pre-Crop → chờ Upload/Process/Fetch → DOWNLOAD → trang Download → Download
  await page.goto(HOME);
  await sleep(500);
  await drop(page, 'big-tim-anh.png');
  await page.waitForURL(/\/images\/[^/]+$/, { timeout: 8000 });
  assert.ok(await page.isVisible('#modal'), 'bảng Upload/Process/Fetch phải đang hiện');
  await page.waitForURL(/\/download$/, { timeout: 10000 });
  await waitFor(() => downloads.length === 1, 15000, 'tải file 1');
  assert.strictEqual(downloads[0], 'big-tim-anh.svg');
  await waitFor(async () => /Đã tải xong/.test(await toastText()), 5000, 'thông báo tải xong');
  assert.strictEqual((await stats()).total, 1);
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
  await waitFor(async () => /Đã dừng/.test(await toastText()), 3000, 'thông báo dừng');
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

  // 6) Ảnh nhỏ (không có Pre-Crop)
  await page.goto(HOME);
  await sleep(500);
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
  console.log('✔ 7. Thả ảnh mới trên trang kết quả');

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
  await waitFor(() => downloads.length === 5, 15000, 'tải file 5');
  await expectCount(5, 4000);
  console.log('✔ 9. Chèn script lại không bị chạy đôi');

  // 10) Tắt extension → không bấm gì
  await setSettings({ enabled: false });
  await page.goto(HOME);
  await sleep(500);
  await drop(page, 'small-off.png');
  await page.waitForURL(/\/images\//, { timeout: 8000 });
  await expectCount(5, 5000);
  console.log('✔ 10. Tắt extension thì không bấm');

  await context.close();
  console.log('Tất cả đều qua.');
})().catch((e) => { console.error('✘', e); process.exit(1); });
