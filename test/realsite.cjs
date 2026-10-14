// Bài thử trên trang giả lập dựng từ mã HTML thật của web (mock/app.html): bảng Upload/Process/Fetch thật
// (nhãn trong <table>, nút Cancel ở .modal-footer), nút DOWNLOAD hiện dưới bảng lúc đang xử lý (ảnh u04).
// Chạy: node test/realsite.cjs [thư mục extension] [tên bài…]  (mặc định: extension này)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const EXT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const ONLY = process.argv.slice(3);
const MOCK = path.join(__dirname, 'mock', 'real');
const HOME = 'https://vectorizer.ai/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return false; await sleep(200); }
}

// Cửa sổ rộng ≥ 1200 px: chữ DOWNLOAD trên thanh công cụ (#App-DownloadLink, "#") hiện ra, thành nút thứ hai.
const WIDE = /wide/;

async function launch(width = 820) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-real-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium', headless: true, viewport: { width, height: 620 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const logs = [];
  const fileReq = {};
  const t0 = Date.now();
  const stamp = () => ((Date.now() - t0) / 1000).toFixed(1);
  await context.route(/^https:\/\/vectorizer\.ai\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/log') { logs.push(`[${stamp()}] ${route.request().postData()}`); return route.fulfill({ status: 204 }); }
    if (url.pathname.startsWith('/download/')) {
      fileReq[url.pathname] = (fileReq[url.pathname] || 0) + 1;
      const name = decodeURIComponent(url.pathname.split('/')[2].split('-').slice(1).join('-')).replace(/\.png$/, '.svg');
      return route.fulfill({ status: 200, headers: { 'content-type': 'image/svg+xml', 'content-disposition': `attachment; filename="${name}"` }, body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    }
    if (url.pathname === '/slow') {
      await sleep(Number(url.searchParams.get('ms')) || 0);
      return route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') });
    }
    if (url.pathname.startsWith('/m/')) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(MOCK, url.pathname.slice(3))) });
    }
    const isDl = /^\/images\/[^/]+$/.test(url.pathname);
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(MOCK, isDl ? 'dl2.html' : 'app.html')) });
  });
  await context.route(/^https:\/\/other\.test\//, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('.png')) {
      return route.fulfill({ status: 200, headers: { 'content-type': 'image/png', 'content-disposition': 'attachment; filename="Gemini_Generated_Image_x.png"' }, body: Buffer.from([137, 80, 78, 71]) });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<a id="f" href="/Gemini_Generated_Image_x.png" download>save</a>' });
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(() => chrome.storage.sync.set({ minimize: false }));
  const downloads = [];
  const watch = (p) => p.on('download', (d) => { downloads.push(d.suggestedFilename()); logs.push(`[${stamp()}] DOWNLOAD ${d.suggestedFilename()}`); });
  context.on('page', watch);
  const page = context.pages()[0] || await context.newPage();
  if (!context.pages().includes(page)) watch(page);
  else watch(page);
  const debug = () => sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://vectorizer.ai/*' });
    return tab ? chrome.tabs.sendMessage(tab.id, { type: 'va:debug' }).catch((e) => String(e)) : null;
  });
  const ends = () => sw.evaluate(() => chrome.storage.session.get('ends').then((r) => r.ends || []));
  return {
    context, page, logs, downloads, fileReq, debug, ends, stamp,
    async setMode(mode) {
      await page.goto(HOME);
      await page.evaluate((m) => localStorage.setItem('appMode', JSON.stringify(m)), mode);
    },
    drop: (names) => page.evaluate((fileNames) => {
      const dt = new DataTransfer();
      for (const fileName of fileNames) dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], fileName, { type: 'image/png' }));
      const target = document.getElementById('drop') || document.body;
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, [].concat(names)),
    busyClicks: () => logs.filter((l) => /pill-click .*processing=true/.test(l)).length,
  };
}

const tests = {
  // R1. Nút DOWNLOAD "#" hiện dưới bảng xử lý thật; web bỏ qua cú bấm lúc đang xử lý.
  async 'R1-busy-hash'(t) {
    await t.setMode({ href: 'hash', show: 'during', procMs: 7000 });
    await t.page.goto(HOME); await sleep(500);
    await t.drop('big-r1.png');
    const ok = await waitFor(() => t.downloads.includes('big-r1.svg'), 30000);
    await sleep(3000);
    return { pass: ok && t.busyClicks() === 0 && t.downloads.length === 1, busyClicks: t.busyClicks() };
  },
  // R2. Như R1 nhưng nút có link thật khi có kết quả: không được bấm lúc bảng xử lý còn hiện.
  async 'R2-busy-real'(t) {
    await t.setMode({ href: 'real', show: 'during', procMs: 9000 });
    await t.page.goto(HOME); await sleep(500);
    await t.drop('big-r2.png');
    const ok = await waitFor(() => t.downloads.includes('big-r2.svg'), 35000);
    await sleep(3000);
    return { pass: ok && t.busyClicks() === 0 && t.downloads.length === 1, busyClicks: t.busyClicks() };
  },
  // R3. Thả ảnh mới ngay trên trang kết quả đã xong (web dùng lại nút DOWNLOAD, chỉ đổi link khi có kết quả).
  async 'R3-editor-reuse'(t) {
    await t.setMode({ href: 'real', show: 'during', procMs: 6000, pill: 'reuse' });
    await t.page.goto(`${HOME}images/1000-prev.png/edit`); await sleep(2500);
    await t.drop('r3.png');
    const ok = await waitFor(() => t.downloads.includes('r3.svg'), 40000);
    await sleep(3000);
    return { pass: ok && t.downloads.length === 1, downloads: [...t.downloads] };
  },
  // R4 (giữ an toàn). Như R3 nhưng web báo lỗi: nút vẫn là của ảnh trước → không được tải gì.
  async 'R4-editor-fail'(t) {
    await t.setMode({ href: 'real', show: 'during', procMs: 6000, pill: 'reuse', fail: true });
    await t.page.goto(`${HOME}images/1000-prev.png/edit`); await sleep(2500);
    await t.drop('r4.png');
    await sleep(45000);
    return { pass: t.downloads.length === 0, downloads: [...t.downloads] };
  },
  // R5. Xử lý lâu (40 giây), nút DOWNLOAD chỉ hiện khi có kết quả: không được bỏ ảnh vì "đứng yên".
  async 'R5-long-proc'(t) {
    await t.setMode({ href: 'hash', show: 'after', procMs: 40000 });
    await t.page.goto(HOME); await sleep(500);
    await t.drop('big-r5.png');
    const ok = await waitFor(() => t.downloads.includes('big-r5.svg'), 65000);
    return { pass: ok && t.downloads.length === 1 };
  },
  // R6 (giữ an toàn). Trang Download của ảnh trước còn trong trang, bị lớp ứng dụng phủ; nút DOWNLOAD mới
  // hiện chậm 6 giây sau khi bảng xử lý đóng → không được bấm nút Download cũ.
  async 'R6-dlview-gap'(t) {
    await t.setMode({ dlview: true, href: 'hash', show: 'after', gapMs: 6000, procMs: 5000 });
    await t.page.goto(HOME); await sleep(1000);
    await t.drop('big-r6.png');
    const ok = await waitFor(() => t.downloads.includes('big-r6.svg'), 40000);
    await sleep(3000);
    const old = t.logs.filter((l) => /OLD-download-click/.test(l)).length;
    return { pass: ok && old === 0 && t.downloads.length === 1, oldClicks: old, downloads: [...t.downloads] };
  },
  // R7. Một file khác (tải ở tab khác, trang gốc khác) bắt đầu giữa lúc bấm DOWNLOAD và lúc bấm Download
  // ở trang Download → không được coi là file của ảnh này.
  async 'R7-foreign'(t) {
    await t.setMode({ href: 'hash', show: 'after', procMs: 3000, dlSlowMs: 6000 });
    await t.page.goto(HOME); await sleep(500);
    await t.drop('big-r7.png');
    await waitFor(() => t.logs.some((l) => /pill-click .*processing=false/.test(l)), 30000);
    const p2 = await t.context.newPage();
    await p2.goto('https://other.test/');
    await p2.click('#f');
    const ok = await waitFor(() => t.downloads.includes('big-r7.svg'), 30000);
    return { pass: ok, downloads: [...t.downloads] };
  },
  // R8 (giữ an toàn). Thả ảnh mới trên trang kết quả của ảnh trước; nút DOWNLOAD "#" dùng lại, kết quả mới hiện
  // chậm 3 giây sau khi bảng xử lý đóng (trong lúc đó nút vẫn mở ảnh trước) → không được tải file của ảnh trước.
  async 'R8-hash-gap'(t) {
    await t.setMode({ href: 'hash', show: 'during', pill: 'reuse', procMs: 6000, gapMs: 3000 });
    await t.page.goto(`${HOME}images/1000-prev.png/edit`); await sleep(2500);
    await t.drop('r8.png');
    await sleep(30000);
    return { pass: !t.downloads.includes('prev.svg') && t.downloads.length <= 1, downloads: [...t.downloads] };
  },
  // R9. Cửa sổ rộng: nút "#" trên thanh công cụ cũng hiện chữ DOWNLOAD (và mở kết quả đang hiện). Nút DOWNLOAD
  // có link thật dùng lại, kết quả mới chậm 3 giây → phải tải đúng ảnh mới, đúng 1 file, không tải ảnh trước.
  async 'R9-wide-toolbar-gap'(t) {
    await t.setMode({ href: 'real', show: 'during', pill: 'reuse', procMs: 6000, gapMs: 3000, toolbarNav: true });
    await t.page.goto(`${HOME}images/1000-prev.png/edit`); await sleep(2500);
    await t.drop('r9.png');
    const ok = await waitFor(() => t.downloads.includes('r9.svg'), 40000);
    await sleep(4000);
    return { pass: ok && t.downloads.length === 1, downloads: [...t.downloads] };
  },
  // R10 (giữ an toàn). Cửa sổ rộng, web báo lỗi, bạn bấm ra ngoài để đóng bảng lỗi → không được tải ảnh trước.
  async 'R10-wide-error-dismissed'(t) {
    await t.setMode({ href: 'real', show: 'during', pill: 'reuse', procMs: 5000, fail: true, bsDismiss: true, toolbarNav: true });
    await t.page.goto(`${HOME}images/1000-prev.png/edit`); await sleep(2500);
    await t.drop('r10.png');
    await waitFor(() => t.logs.some((l) => /ERROR dialog/.test(l)), 20000);
    await sleep(2000);
    await t.page.mouse.click(15, 600); // Bấm thật vào vùng mờ ngoài bảng
    await sleep(15000);
    return { pass: t.downloads.length === 0, downloads: [...t.downloads] };
  },
  // R11. Cửa sổ rộng, kéo 3 ảnh một lúc (hàng chờ): mỗi ảnh đúng 1 file, đúng thứ tự, không lẫn.
  async 'R11-wide-queue'(t) {
    await t.setMode({ href: 'real', show: 'during', pill: 'reuse', procMs: 4000, toolbarNav: true });
    await t.page.goto(HOME); await sleep(800);
    await t.drop(['w1.png', 'w2.png', 'w3.png']);
    await waitFor(() => t.downloads.length >= 3, 120000);
    await sleep(6000);
    return { pass: JSON.stringify(t.downloads) === JSON.stringify(['w1.svg', 'w2.svg', 'w3.svg']), downloads: [...t.downloads] };
  },
};

(async () => {
  const names = ONLY.length ? ONLY : Object.keys(tests);
  const results = await Promise.all(names.map(async (name, i) => {
    await sleep(i * 1500);
    const t = await launch(WIDE.test(name) ? 1280 : 820);
    let r;
    try { r = await tests[name](t); } catch (e) { r = { pass: false, error: String(e) }; }
    r.ends = (await t.ends().catch(() => [])).map((e) => ({ reason: e.reason, hidden: e.hidden, stage: e.stage, clicks: e.clicks, tries: e.tries, sawBusy: e.sawBusy, keys: e.keys }));
    r.logs = t.logs;
    await t.context.close().catch(() => {});
    return [name, r];
  }));
  let allPass = true;
  for (const [name, r] of results) {
    allPass = allPass && r.pass;
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify({ ...r, logs: undefined, pass: undefined })}`);
    if (process.env.VERBOSE || !r.pass) for (const l of r.logs) console.log(`    ${l}`);
  }
  process.exit(allPass ? 0 : 1);
})();
