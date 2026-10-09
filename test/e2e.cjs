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
    const file = url.pathname.startsWith('/images/') ? 'result.html' : 'index.html';
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(MOCK, file)) });
  });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const setSettings = (s) => sw.evaluate((v) => chrome.storage.sync.set(v), s);
  const stats = () => sw.evaluate(() => chrome.storage.local.get('stats').then((r) => r.stats || {}));

  const page = await context.newPage();
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  page.on('console', (m) => { if (/Vectorizer Auto/.test(m.text())) console.log('  [page]', m.text()); });
  const toastText = () => page.evaluate(() => document.getElementById('vectorizer-auto-toast')
    ?.shadowRoot.querySelector('.t').textContent || '');

  // 1) Ảnh lớn: tự bấm OK ở Pre-Crop → tự bấm DOWNLOAD → tự về trang chính
  await page.goto(HOME);
  await sleep(500);
  await drop(page, 'big-tim-anh.png');
  await page.waitForURL(/\/images\//, { timeout: 8000 });
  await waitFor(() => downloads.length === 1, 15000, 'tải file 1');
  assert.strictEqual(downloads[0], 'big-tim-anh.svg');
  await page.waitForURL(HOME, { timeout: 8000 });
  assert.strictEqual((await stats()).total, 1);
  console.log('✔ 1. Pre-Crop OK → DOWNLOAD → về trang chính');

  // 2) Mở lại trang kết quả cũ (không có job) → không được tải trùng
  await page.goto(`${HOME}images/123-old.png`);
  await sleep(5000);
  assert.strictEqual(downloads.length, 1);
  console.log('✔ 2. Mở ảnh cũ không tự tải');

  // 3) Tắt "tự bấm OK" → bảng Pre-Crop phải còn nguyên
  await setSettings({ autoPrecrop: false });
  await page.goto(HOME);
  await sleep(500);
  await drop(page, 'big-2.png');
  await sleep(3000);
  assert.ok(await page.isVisible('#pre h2'));
  assert.ok(!(await page.evaluate(() => window.__okDown)));
  await setSettings({ autoPrecrop: true });
  console.log('✔ 3. Tắt tự bấm OK thì không bấm');

  // 4) Ảnh nhỏ, tắt "tự về trang chính" → tải xong vẫn ở trang kết quả
  await setSettings({ autoReturn: false });
  await page.goto(HOME);
  await sleep(500);
  await drop(page, 'small.png');
  await page.waitForURL(/\/images\//, { timeout: 8000 });
  await waitFor(() => downloads.length === 2, 15000, 'tải file 2');
  assert.strictEqual(downloads[1], 'small.svg');
  await sleep(3000);
  assert.match(page.url(), /\/images\//);
  assert.match(await toastText(), /Đã tải xong/);
  console.log('✔ 4. Ảnh nhỏ tải được, không tự về khi đã tắt');

  // 5) Thả ảnh mới ngay trên trang kết quả (xử lý tại chỗ) → tải ảnh mới, không tải lại ảnh cũ
  await drop(page, 'next.png');
  await waitFor(() => downloads.length === 3, 15000, 'tải file 3');
  assert.strictEqual(downloads[2], 'next.svg');
  await sleep(3000);
  assert.strictEqual(downloads.length, 3);
  assert.strictEqual((await stats()).total, 3);
  console.log('✔ 5. Thả ảnh mới trên trang kết quả');

  // 6) Tắt extension → không bấm gì
  await setSettings({ enabled: false, autoReturn: true });
  await page.goto(HOME);
  await sleep(500);
  await drop(page, 'small-off.png');
  await page.waitForURL(/\/images\//, { timeout: 8000 });
  await sleep(5000);
  assert.strictEqual(downloads.length, 3);
  console.log('✔ 6. Tắt extension thì không bấm');

  await context.close();
  console.log('Tất cả đều qua.');
})().catch((e) => { console.error('✘', e); process.exit(1); });
