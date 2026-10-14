// Như realsite.cjs nhưng cửa sổ ẩn thật (Chromium tự mở + CDP, ẩn bằng cách mở tab khác như test/hidden.cjs).
// Chạy: xvfb-run -a node test/realsite-hidden.cjs [thư mục extension] [tên bài…]
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const EXT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const ONLY = process.argv.slice(3);
const MOCK = path.join(__dirname, 'mock', 'real');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn().catch(() => false); if (v) return v; if (Date.now() > end) return false; await sleep(250); }
}
function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  return new Promise((resolve, reject) => {
    ws.onerror = reject;
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }),
      close: () => ws.close(),
    });
  });
}
async function evaluate(conn, expression) {
  const r = await conn.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;
}

async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-rh-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=vectorizer.ai', '-days', '1',
    '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
  const logs = [];
  const t0 = Date.now();
  const stamp = () => ((Date.now() - t0) / 1000).toFixed(1);
  const server = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) }, (req, res) => {
    const url = new URL(req.url, 'https://vectorizer.ai');
    if (url.pathname === '/log') { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { logs.push(`[${stamp()}] ${b}`); res.writeHead(204); res.end(); }); return; }
    if (url.pathname.startsWith('/download/')) {
      const name = decodeURIComponent(url.pathname.split('/')[2].split('-').slice(1).join('-')).replace(/\.png$/, '.svg');
      logs.push(`[${stamp()}] FILE-REQUEST ${name}`);
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'content-disposition': `attachment; filename="${name}"` });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
    }
    if (url.pathname.startsWith('/m/')) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(MOCK, url.pathname.slice(3)))); }
    const isDl = /^\/images\/[^/]+$/.test(url.pathname);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(MOCK, isDl ? 'dl2.html' : 'app.html')));
  }).listen(0);
  const port = server.address().port;
  const downloadsDir = path.join(dir, 'downloads');
  fs.mkdirSync(downloadsDir);
  fs.mkdirSync(path.join(dir, 'profile', 'Default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'profile', 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloadsDir, prompt_for_download: false } }));
  const debugPort = 9200 + Math.floor(Math.random() * 700);
  const browser = spawn(chromium.executablePath(), [
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(dir, 'profile')}`, '--window-size=820,700',
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--no-proxy-server',
    `--host-resolver-rules=MAP vectorizer.ai 127.0.0.1:${port}`, '--ignore-certificate-errors',
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, 'https://vectorizer.ai/',
  ], { stdio: 'ignore' });
  let targets = [];
  await waitFor(async () => {
    targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return targets.some((t) => t.type === 'service_worker') && targets.some((t) => t.type === 'page' && t.url.startsWith('https://vectorizer.ai'));
  }, 20000);
  const sw = await cdp(targets.find((t) => t.type === 'service_worker').webSocketDebuggerUrl);
  const page = await cdp(targets.find((t) => t.type === 'page' && t.url.startsWith('https://vectorizer.ai')).webSocketDebuggerUrl);
  await evaluate(sw, 'chrome.storage.sync.set({ minimize: false })');
  const onPage = (expr) => evaluate(page, expr);
  const tabOp = (body) => evaluate(sw, `(async () => { const [tab] = await chrome.tabs.query({ url: 'https://vectorizer.ai/*' }); ${body} })()`);
  return {
    logs, stamp,
    files: () => fs.readdirSync(downloadsDir).filter((f) => !f.endsWith('.crdownload')).sort(),
    onPage,
    hide: () => tabOp("await chrome.tabs.create({ windowId: tab.windowId, url: 'about:blank', active: true });"),
    show: () => tabOp('await chrome.tabs.update(tab.id, { active: true });'),
    isHidden: () => onPage('document.visibilityState === "hidden"'),
    ends: () => evaluate(sw, "chrome.storage.session.get('ends').then((r) => r.ends || [])"),
    async setMode(mode) {
      await onPage(`localStorage.setItem('appMode', ${JSON.stringify(JSON.stringify(mode))})`);
      await page.send('Page.reload');
      await sleep(1500);
    },
    drop: (names) => onPage(`(() => { const dt = new DataTransfer();
      for (const n of ${JSON.stringify([].concat(names))}) dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], n, { type: 'image/png' }));
      const target = document.getElementById('drop') || document.body;
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })); })()`),
    busyClicks: () => logs.filter((l) => /pill-click .*processing=true/.test(l)).length,
    close: () => { try { browser.kill('SIGKILL'); } catch (e) {} server.close(); sw.close(); page.close(); },
  };
}

const tests = {
  // H1. Cửa sổ ẩn lâu (45 giây); nút DOWNLOAD chỉ hiện khi trang được vẽ (requestAnimationFrame) → hiện lại
  // cửa sổ thì phải bấm tiếp và tải được.
  async 'H1-raf-hidden'(t) {
    await t.setMode({ href: 'hash', show: 'raf', procMs: 5000 });
    await t.drop('big-h1.png');
    await sleep(400);
    await t.hide();
    const hid = await waitFor(() => t.isHidden(), 5000);
    await sleep(45000);
    const filesHidden = t.files().length;
    await t.show();
    const ok = await waitFor(async () => t.files().includes('big-h1.svg'), 25000);
    return { pass: !!hid && ok && t.files().length === 1, filesHidden, files: t.files() };
  },
  // H2. Bảng xử lý thật, cửa sổ ẩn ngay sau khi thả: không bấm lúc đang xử lý, tải xong ngay lúc ẩn.
  async 'H2-busy-hidden'(t) {
    await t.setMode({ href: 'hash', show: 'during', procMs: 7000 });
    await t.drop('big-h2.png');
    await sleep(400);
    await t.hide();
    const hid = await waitFor(() => t.isHidden(), 5000);
    const ok = await waitFor(async () => t.files().includes('big-h2.svg'), 40000);
    const stillHidden = await t.isHidden().catch(() => null);
    await sleep(5000); // Không được có file thừa
    return { pass: !!hid && ok && t.busyClicks() === 0 && t.files().length === 1, busyClicks: t.busyClicks(), stillHidden, files: t.files() };
  },
  // H3. Kéo 3 ảnh một lúc rồi cửa sổ ẩn 2 phút; kết quả chỉ hiện khi trang được vẽ → không được bỏ ảnh nào vì
  // "đứng yên" lúc ẩn; hiện cửa sổ lên thì cả 3 ảnh đều về, mỗi ảnh đúng 1 file.
  async 'H3-queue-raf'(t) {
    await t.setMode({ href: 'hash', show: 'raf', procMs: 5000 });
    await t.drop(['big-qa.png', 'big-qb.png', 'big-qc.png']);
    await sleep(400);
    await t.hide();
    const hid = await waitFor(() => t.isHidden(), 5000);
    await sleep(120000);
    await t.show();
    const want = ['big-qa.svg', 'big-qb.svg', 'big-qc.svg'];
    const ok = await waitFor(async () => want.every((f) => t.files().includes(f)), 120000);
    await sleep(5000);
    return { pass: !!hid && ok && JSON.stringify(t.files()) === JSON.stringify(want), files: t.files() };
  },
};

(async () => {
  const names = ONLY.length ? ONLY : Object.keys(tests);
  let allPass = true;
  // Chạy lần lượt từng bài: các trình duyệt dùng chung một màn hình ảo, cửa sổ mở sau che cửa sổ trước nên
  // trang của bài trước vẫn bị coi là "ẩn" dù đã chọn lại tab (bài H1 sẽ hỏng vì lý do không liên quan).
  const results = [];
  for (const name of names) {
    const t = await launch();
    let r;
    try { r = await tests[name](t); } catch (e) { r = { pass: false, error: String(e) }; }
    r.ends = (await t.ends().catch(() => [])).map((e) => ({ reason: e.reason, hidden: e.hidden, stage: e.stage, clicks: e.clicks, tries: e.tries, sawBusy: e.sawBusy }));
    r.logs = t.logs;
    t.close();
    results.push([name, r]);
  }
  for (const [name, r] of results) {
    allPass = allPass && r.pass;
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify({ ...r, logs: undefined, pass: undefined })}`);
    if (process.env.VERBOSE || !r.pass) for (const l of r.logs) console.log(`    ${l}`);
  }
  process.exit(allPass ? 0 : 1);
})();
