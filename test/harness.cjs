// Khung dùng chung cho các bài thử: Chromium có cài extension + trang giả lập (test/mock).
const path = require('path');
const fs = require('fs');
const os = require('os');
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

// mock.deferMs > 0: trang Download có script defer /assets/dl-wire.js trả về chậm bấy lâu (như web thật).
async function launch({ headless = true } = {}) {
  const mock = { deferMs: 0 };
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-test-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await context.route(/^https:\/\/vectorizer\.ai\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/download/')) {
      const name = decodeURIComponent(url.pathname.split('-').slice(1).join('-')).replace(/\.png$/, '.svg');
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'image/svg+xml', 'content-disposition': `attachment; filename="${name}"` },
        body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      });
    }
    if (url.pathname === '/assets/dl-wire.js') {
      await sleep(mock.deferMs);
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.__wire && window.__wire();' });
    }
    const isDownloadPage = url.pathname === '/dlpage' || url.pathname.endsWith('/download');
    const file = isDownloadPage ? 'download.html' : url.pathname.startsWith('/images/') ? 'result.html' : 'index.html';
    let body = fs.readFileSync(path.join(MOCK, file), 'utf8');
    if (isDownloadPage && mock.deferMs) {
      body = body.replace('</head>', '<script defer src="/assets/dl-wire.js"></script></head>');
    }
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  const downloads = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));

  const t = {
    context, sw, page, downloads, mock,
    setSettings: (s) => sw.evaluate((v) => chrome.storage.sync.set(v), s),
    setMode: (m) => page.evaluate((v) => localStorage.setItem('mockMode', v), m),
    hasJob: () => sw.evaluate(() => chrome.storage.session.get(null)
      .then((s) => Object.keys(s).some((k) => k.startsWith('job:')))),
    async drop(names) {
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
    },
    // Chờ đúng n file về, rồi chờ thêm để chắc không có file thừa (tải trùng).
    async expectDownloads(n, ms, what) {
      await waitFor(() => downloads.length >= n, ms, what);
      await sleep(4000);
      if (downloads.length !== n) throw new Error(`${what}: mong ${n} file, có ${downloads.length}: ${downloads.join(', ')}`);
    },
  };
  await t.setSettings({ minimize: false });
  return t;
}

module.exports = { launch, sleep, waitFor, HOME };
