// Cửa sổ đang ẩn (như lúc tự thu nhỏ). Playwright luôn giữ trang ở trạng thái "đang hiện", nên bài này
// tự mở Chromium, phục vụ trang giả lập qua HTTPS và điều khiển qua CDP.
// Chạy (cần màn hình ảo): xvfb-run -a node test/hidden.cjs
const assert = require('assert');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const EXT = path.resolve(__dirname, '..');
const MOCK = path.join(__dirname, 'mock');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => false);
    if (v) return v;
    if (Date.now() > end) throw new Error(`Hết giờ chờ: ${what}`);
    await sleep(200);
  }
}

// Kết nối CDP tối giản.
function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  return new Promise((resolve, reject) => {
    ws.onerror = reject;
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((r) => {
        const i = ++id;
        pending.set(i, r);
        ws.send(JSON.stringify({ id: i, method, params }));
      }),
      close: () => ws.close(),
    });
  });
}

async function evaluate(conn, expression) {
  const r = await conn.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-hidden-'));
  // Máy chủ HTTPS giả làm vectorizer.ai (chứng chỉ tự ký, tạo lúc chạy).
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=vectorizer.ai', '-days', '1',
    '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
  const requests = {}; // Số lần trang xin mỗi file
  let slowMs = 0;      // Máy chủ trả file chậm bấy lâu
  const server = https.createServer({
    key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')),
  }, (req, res) => {
    const url = new URL(req.url, 'https://vectorizer.ai');
    if (url.pathname.startsWith('/download/')) {
      requests[url.pathname] = (requests[url.pathname] || 0) + 1;
      const name = decodeURIComponent(url.pathname.split('-').slice(1).join('-')).replace(/\.png$/, '.svg');
      const send = () => {
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'content-disposition': `attachment; filename="${name}"` });
        res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
      };
      return slowMs ? void setTimeout(send, slowMs) : send();
    }
    const file = !url.pathname.startsWith('/images/') ? 'index.html'
      : url.pathname.endsWith('/download') ? 'download.html' : 'result.html';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(MOCK, file)));
  }).listen(0);
  const port = server.address().port;

  const downloadsDir = path.join(dir, 'downloads');
  fs.mkdirSync(downloadsDir);
  fs.mkdirSync(path.join(dir, 'profile', 'Default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'profile', 'Default', 'Preferences'),
    // Không đặt sẵn quyền "Tải xuống nhiều tệp": extension phải tự cho phép, nếu không từ file thứ hai
    // Chrome giữ file lại và hỏi (cửa sổ ẩn thì không ai thấy để bấm).
    JSON.stringify({ download: { default_directory: downloadsDir, prompt_for_download: false } }));
  const debugPort = 9200 + Math.floor(Math.random() * 700);
  const browser = spawn(chromium.executablePath(), [
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(dir, 'profile')}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--no-proxy-server',
    `--host-resolver-rules=MAP vectorizer.ai 127.0.0.1:${port}`, '--ignore-certificate-errors',
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, 'https://vectorizer.ai/',
  ], { stdio: 'ignore' });

  try {
    let targets = [];
    await waitFor(async () => {
      targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      return targets.some((t) => t.type === 'service_worker')
        && targets.some((t) => t.type === 'page' && t.url.startsWith('https://vectorizer.ai'));
    }, 20000, 'trình duyệt sẵn sàng');
    const sw = await cdp(targets.find((t) => t.type === 'service_worker').webSocketDebuggerUrl);
    const page = await cdp(targets.find((t) => t.type === 'page' && t.url.startsWith('https://vectorizer.ai')).webSocketDebuggerUrl);
    const onPage = (expr) => evaluate(page, expr);
    const files = () => fs.readdirSync(downloadsDir).filter((f) => f.endsWith('.svg')).sort();
    const tabOp = (body) => evaluate(sw, `(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://vectorizer.ai/*' });
      ${body}
    })()`);
    // Ẩn tab đang làm: mở tab khác trong cùng cửa sổ (như chuyển tab / thu nhỏ). Hiện lại: chọn lại tab cũ.
    const hide = () => tabOp("await chrome.tabs.create({ windowId: tab.windowId, url: 'about:blank', active: true });");
    const show = () => tabOp('await chrome.tabs.update(tab.id, { active: true });');
    const isHidden = () => onPage('document.visibilityState === "hidden"');
    const hasJob = () => evaluate(sw, "chrome.storage.session.get(null).then((s) => Object.keys(s).some((k) => k.startsWith('job:')))");
    const drop = (name) => onPage(`(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], ${JSON.stringify(name)}, { type: 'image/png' }));
      const target = document.getElementById('drop') || document.body;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
    })()`);
    const goHome = async (mode) => {
      await onPage(`localStorage.setItem('mockMode', ${JSON.stringify(mode)}); location.href = 'https://vectorizer.ai/'`);
      await sleep(1500);
      await waitFor(() => onPage('document.readyState === "complete"'), 10000, 'trang chủ');
      await sleep(500);
    };

    await evaluate(sw, 'chrome.storage.sync.set({ minimize: false })');
    await waitFor(() => onPage('document.readyState === "complete"'), 10000, 'trang chủ');

    // 1) Trang Download có hiệu ứng hiện dần (đứng yên khi ẩn): vẫn bấm được, tải xong trong lúc ẩn.
    await goHome('fade');
    await drop('an.png');
    await hide();
    await waitFor(isHidden, 5000, 'tab bị ẩn');
    await waitFor(async () => files().length === 1, 30000, 'tải lúc ẩn');
    assert.deepStrictEqual(files(), ['an.svg']);
    assert.ok(await isHidden(), 'tab vẫn đang ẩn lúc file về');
    console.log('✔ 1. Cửa sổ ẩn, trang có hiệu ứng hiện dần: vẫn tải xong');

    // 2) Trang chỉ cho nút chạy khi cửa sổ hiện, và cửa sổ ẩn lâu hơn thời hạn 40 giây:
    //    việc không bị huỷ lúc ẩn, hiện lại là bấm tiếp và tải đúng 1 file.
    await show();
    await waitFor(async () => !(await isHidden()), 5000, 'tab hiện lại');
    await goHome('visonly');
    await drop('vis.png');
    await hide();
    await waitFor(isHidden, 5000, 'tab bị ẩn');
    await sleep(50000);
    assert.strictEqual(files().length, 1, 'lúc ẩn chưa tải được (nút chưa chạy)');
    assert.ok(await hasJob(), 'việc vẫn còn sau 50 giây ẩn');
    await show();
    await waitFor(async () => files().length === 2, 20000, 'tải sau khi hiện lại').catch(async (e) => {
      console.log(JSON.stringify(await evaluate(sw, `(async () => {
        const [tab] = await chrome.tabs.query({ url: 'https://vectorizer.ai/*' });
        return { ends: (await chrome.storage.session.get('ends')).ends, autoDl: await new Promise((r) => chrome.contentSettings.automaticDownloads.get({ primaryUrl: 'https://vectorizer.ai/' }, r)),
          session: await chrome.storage.session.get(null),
          report: await chrome.tabs.sendMessage(tab.id, { type: 'va:debug' }).catch((x) => String(x)) };
      })()`), null, 1).slice(0, 4000));
      throw e;
    });
    assert.deepStrictEqual(files(), ['an.svg', 'vis.svg']);
    console.log('✔ 2. Ẩn hơn 40 giây: hiện lại là làm tiếp');

    // 3) Ảnh tiếp theo (trang thường) cũng làm xong trong lúc ẩn.
    await goHome('');
    await drop('lau.png');
    await hide();
    await waitFor(isHidden, 5000, 'tab bị ẩn');
    await waitFor(async () => files().length === 3, 30000, 'tải ảnh thứ 3 lúc ẩn');
    await sleep(4000);
    assert.deepStrictEqual(files(), ['an.svg', 'lau.svg', 'vis.svg'], 'đúng 3 file, không trùng');
    console.log('✔ 3. Ảnh tiếp theo cũng xong trong lúc ẩn');

    const reqs = (name) => Object.entries(requests).filter(([k]) => k.endsWith(`-${name}`)).reduce((n, [, v]) => n + v, 0);
    const dropMany = (names) => onPage(`(() => {
      const dt = new DataTransfer();
      for (const n of ${JSON.stringify(names)}) dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], n, { type: 'image/png' }));
      const target = document.getElementById('drop') || document.body;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
    })()`);

    // 4) Kéo 2 ảnh, ảnh đầu bị web báo lỗi; cửa sổ ẩn suốt: ảnh lỗi bị bỏ, ảnh sau vẫn làm xong.
    await show();
    await waitFor(async () => !(await isHidden()), 5000, 'tab hiện lại');
    await goHome('');
    await dropMany(['err-a.png', 'ok-b.png']);
    await hide();
    await waitFor(isHidden, 5000, 'tab bị ẩn');
    await waitFor(async () => files().includes('ok-b.svg'), 120000, 'ảnh sau ảnh lỗi');
    assert.ok(await isHidden(), 'vẫn đang ẩn');
    console.log('✔ 4. Ảnh lỗi không chặn hàng chờ lúc cửa sổ ẩn');

    // 5) Nút OK của Pre-Crop khoá 6 giây lúc cửa sổ ẩn: không bấm phí, mở khoá là bấm, tải xong.
    await show();
    await waitFor(async () => !(await isHidden()), 5000, 'tab hiện lại');
    await goHome('pcguard');
    await drop('big-pc.png');
    await hide();
    await waitFor(isHidden, 5000, 'tab bị ẩn');
    await waitFor(async () => files().includes('big-pc.svg'), 40000, 'Pre-Crop khoá rồi mở');
    console.log('✔ 5. Pre-Crop OK bị khoá lúc ẩn: chờ mở khoá rồi bấm');

    // 6) Mở cửa sổ lên đúng lúc file đang tải chậm: không bấm lại, không có file trùng.
    await show();
    await waitFor(async () => !(await isHidden()), 5000, 'tab hiện lại');
    await goHome('');
    slowMs = 9000;
    await drop('mo-len.png');
    await hide();
    await waitFor(isHidden, 5000, 'tab bị ẩn');
    await waitFor(async () => reqs('mo-len.png') > 0, 30000, 'bắt đầu xin file');
    await sleep(2000);
    await show();
    await waitFor(async () => files().includes('mo-len.svg'), 30000, 'file chậm về');
    await sleep(5000);
    assert.strictEqual(reqs('mo-len.png'), 1, `số lần xin file: ${reqs('mo-len.png')}`);
    assert.strictEqual(files().filter((f) => f.startsWith('mo-len')).length, 1, `file trùng: ${files().join(', ')}`);
    slowMs = 0;
    console.log('✔ 6. Mở cửa sổ lúc file đang tải chậm: không tải trùng');

    sw.close();
    page.close();
    console.log('Tất cả đều qua.');
  } finally {
    browser.kill();
    server.close();
  }
})().catch((e) => { console.error('✘', e); process.exit(1); });
