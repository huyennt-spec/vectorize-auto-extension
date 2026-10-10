// Chạy trên trang web: tự bấm OK ở bảng Pre-Crop, chờ bảng Upload/Process/Fetch xong,
// tự bấm DOWNLOAD và bấm tiếp nút Download ở trang tải về.
//
// Chỉ tự động khi có "việc" (job): job bắt đầu khi bạn kéo/thả, chọn hoặc dán ảnh, hay khi
// bảng Pre-Crop / bảng Upload-Process-Fetch hiện ra. Nhờ vậy mở lại ảnh cũ hay tải lại
// trang sẽ không bị tải trùng. Job lưu ở background theo tab nên vẫn còn khi trang chuyển
// sang trang kết quả. Bạn bấm CANCEL / đóng / Esc thì job dừng.
//
// Mỗi lúc chỉ làm một ảnh. Ảnh kéo vào khi ảnh trước chưa xong (hoặc kéo nhiều ảnh một lúc)
// được giữ trong hàng chờ, xong ảnh trước mới đưa vào trang, nên thao tác nhanh không bị lẫn.
(() => {
  'use strict';
  // Script có thể được chèn lại (khi cài/cập nhật extension): dừng bản cũ trước.
  globalThis.__autoClickStop?.();
  const ac = new AbortController();
  const listen = (target, type, fn) => target.addEventListener(type, fn, { capture: true, signal: ac.signal });

  const JOB_TTL_MS = 10 * 60 * 1000;     // Bỏ job nếu quá 10 phút chưa có kết quả
  const STABLE_MS = 800;                 // Nút phải sẵn sàng liên tục bấy lâu mới bấm
  const COVERED_GRACE_MS = 3000;         // Nút "có vẻ bị che" nhưng không có bảng nào → vẫn bấm sau bấy lâu
  const BUSY_MAX_MS = 5000;              // Bỏ qua chữ "Loading…" lạ nếu kéo dài quá lâu
  const FALLBACK_MS = 8000;              // Bấm xong mà trang không phản ứng → mở thẳng link của nút
  const DOWNLOAD_CONFIRM_MS = 40 * 1000; // Chờ file tải về tối đa bấy lâu sau khi bấm
  const MAX_CLICKS = 3;                  // Số lần bấm "Download" tối đa cho mỗi ảnh
  const MAX_PRECROP_CLICKS = 3;          // Bảng Pre-Crop vẫn còn thì bấm OK lại tối đa bấy lần
  const STOP_COOLDOWN_MS = 2000;         // Vừa bấm dừng thì không tự bấm gì trong bấy lâu
  const FEED_STEP_MS = 6000;             // Đưa ảnh từ hàng chờ vào mà trang chưa nhận → thử cách khác
  const NEXT_DELAY_MS = 1000;            // Xong ảnh trước, chờ bấy lâu rồi mới đưa ảnh tiếp theo
  const STALL_MS = 30 * 1000;            // Ảnh đang làm đứng yên bấy lâu (trang không làm gì) → bỏ
  const STALL_ON_DROP_MS = 3000;         // Bạn kéo ảnh mới mà ảnh đang làm đứng yên bấy lâu → bỏ ảnh cũ

  const RX = {
    download: /^(download|tải xuống|tải về)$/,
    ok: /^(ok|đồng ý)$/,
    cancel: /^(cancel|huỷ|hủy|dừng|stop|close|đóng|×|✕|✖)$/,
    precrop: /pre[\s \-‐-―]?crop/i,
    precropContext: /pre[\s \-‐-―]?crop|size limit|megapixel/i,
    busyLabel: /^(upload|process|fetch)$/,   // Bảng tiến trình "Upload / Process / Fetch"
    busyWord: /^(uploading|vectorizing|processing|loading|đang tải lên|đang xử lý)\b/,
  };
  const CONTROL_SEL = 'button, a, [role="button"], input[type="button"], input[type="submit"]';
  const LOOSE_SEL = '[onclick], [class*="btn" i], [class*="button" i]';
  const ICONISH = 'i, svg, [aria-hidden="true"], [class*="icon" i], [class*="material-symbols" i]';
  const VIS = { opacityProperty: true, visibilityProperty: true };

  let settings = { ...VA.DEFAULTS };
  let job = null;
  let jobLoaded = false;     // Đã lấy xong việc đang làm của tab này từ background
  const startedAt = Date.now();
  let readySince = 0;      // Lúc nút DOWNLOAD bắt đầu sẵn sàng
  let notReadySince = 0;   // Lúc nút DOWNLOAD bắt đầu không sẵn sàng
  let coveredSince = 0;    // Lúc nút DOWNLOAD bắt đầu "có vẻ bị che"
  let sawNotReady = false; // Đã thấy nút DOWNLOAD biến mất/bị khoá kể từ lúc bắt đầu job
  let precropAttempts = 0;
  let lastPrecropClickAt = 0;
  let stoppedAt = 0;
  let busyAfterStop = false; // Dừng lúc bảng tiến trình đang hiện → chờ bảng tắt mới nhận việc mới
  let scan = null;           // Kết quả quét chữ trên trang của lượt hiện tại
  let tab = { tabId: -1, bootId: '' }; // Tab này (để hàng chờ của tab nào tab nấy làm)
  let queueCount = 0;        // Số ảnh trong hàng chờ của tab này (kể cả ảnh đang làm)
  let queueLoaded = false;
  let feedingNow = false;    // Đang tự đưa ảnh vào trang (sự kiện do chính extension tạo)
  let pumping = false;
  let feedBusy = false;
  let idleSince = Date.now();
  let progressAt = Date.now(); // Lần cuối thấy ảnh đang làm còn tiến triển
  let minimizeTimer = 0;

  // ---------- Cài đặt ----------
  chrome.storage.sync.get(VA.DEFAULTS).then((s) => { settings = s; }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
  });

  // ---------- Job ----------
  // Việc đang làm được lưu ở background theo tab, nên vẫn còn khi trang chuyển đi.
  const hello = chrome.runtime.sendMessage({ type: 'va:hello' }).then((r) => {
    tab = { tabId: r.tabId, bootId: r.bootId };
    if (jobLoaded) return; // Trong lúc chờ bạn đã thả ảnh mới
    jobLoaded = true;
    if (r.job && Date.now() - r.job.startedAt < JOB_TTL_MS) job = r.job;
    else if (r.job) saveJob();
  }).catch(() => { jobLoaded = true; });
  hello.then(refreshQueue);

  function saveJob() {
    return chrome.runtime.sendMessage({ type: 'va:job:set', job }).catch(() => {});
  }

  function startJob(name) {
    if (!settings.enabled) return;
    jobLoaded = true;
    const dl = findDownloadButton();
    job = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: name || 'ảnh',
      startedAt: Date.now(),
      // Nếu thả ảnh mới ngay trên trang kết quả cũ thì nút DOWNLOAD cũ đang hiện:
      // nhớ lại để không bấm nhầm nút của ảnh trước.
      startDlKey: dl && isReady(dl) ? dlKey(dl) : null,
      stage: 'waiting',  // 'waiting' → chờ kết quả, 'downloading' → đã bấm, chờ file về
      clickedKeys: [],   // Các nút Download đã bấm (trang kết quả, trang Download…)
      last: null,        // Lần bấm gần nhất: { url, href, at, fallback }
      dlStarted: false,  // Trình duyệt đã bắt đầu tải file
    };
    readySince = 0;
    notReadySince = 0;
    coveredSince = 0;
    sawNotReady = false;
    progressAt = Date.now();
    stoppedAt = 0;
    busyAfterStop = false;
    saveJob();
  }

  function finishJob() {
    const itemId = job?.itemId;
    job = null;
    idleSince = Date.now();
    saveJob();
    if (itemId != null) queueOp(() => qDelete([itemId])).then(refreshQueue);
  }

  // Bạn bấm dừng: bỏ ảnh đang làm và cả hàng chờ.
  function stopJob() {
    finishJob();
    queueOp(async () => qDelete((await qMine()).map((it) => it.id))).then(refreshQueue);
    stoppedAt = Date.now();
    busyAfterStop = true;
    precropAttempts = MAX_PRECROP_CLICKS; // Không bấm OK lại cho bảng đang mở
  }

  const filesOf = (dt) => (dt && dt.files && dt.files.length ? [...dt.files] : []);
  const isImage = (f) => /^image\//.test(f.type) || /\.(png|jpe?g|gif|bmp|webp|tiff?|avif|heic)$/i.test(f.name);

  // Bạn đưa ảnh vào trang. Đang rảnh và chỉ một ảnh → để trang nhận như thường.
  // Đang làm ảnh khác / còn ảnh chờ / nhiều ảnh một lúc → giữ lại, trang chưa thấy gì.
  function onUserFiles(e, files, x, y) {
    if (feedingNow || !settings.enabled) return;
    const images = files.filter(isImage);
    if (!images.length) return;
    // Ảnh đang làm đã đứng yên (vd. bị bỏ dở rồi chuyển trang) → bỏ, nhận ảnh mới luôn.
    if (job && job.stage === 'waiting' && Date.now() - progressAt > STALL_ON_DROP_MS) finishJob();
    const busy = !!job || !jobLoaded || !queueLoaded || pumping || queueCount > 0 || images.length > 1;
    if (busy) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'drop') clearDragState(e.target);
      enqueue(images, x, y);
    } else {
      startJob(images[0].name);
    }
    minimizeSoon();
  }

  // Bắt sự kiện ở pha capture để chạy trước code của trang.
  listen(window, 'drop', (e) => onUserFiles(e, filesOf(e.dataTransfer), e.clientX, e.clientY));
  listen(window, 'paste', (e) => onUserFiles(e, filesOf(e.clipboardData)));
  listen(document, 'change', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'file') onUserFiles(e, [...(t.files || [])]);
  });

  // Trang có thể đang hiện lớp "thả ảnh vào đây": báo cho trang là đã kéo ra để nó tắt đi.
  function clearDragState(target) {
    feedingNow = true;
    try {
      for (const el of new Set([target, document.body])) {
        el?.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, composed: true }));
      }
    } finally { feedingNow = false; }
  }

  // Nhận ảnh xong thì thu nhỏ cửa sổ (chỉ khi mọi bước đều tự động).
  function minimizeSoon() {
    if (!settings.minimize || !settings.autoDownload || !settings.autoPrecrop) return;
    clearTimeout(minimizeTimer);
    minimizeTimer = setTimeout(() => chrome.runtime.sendMessage({ type: 'va:minimize' }).catch(() => {}), 400);
  }

  // ---------- Hàng chờ ảnh ----------
  // Lưu trong IndexedDB của trang (giữ được file lớn, còn nguyên khi trang chuyển đi).
  let dbPromise = null;
  function db() {
    dbPromise ??= new Promise((resolve, reject) => {
      const r = indexedDB.open('ac-queue', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return dbPromise;
  }
  const txDone = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
  async function qAdd(items) {
    const tx = (await db()).transaction('files', 'readwrite');
    for (const it of items) tx.objectStore('files').add(it);
    await txDone(tx);
  }
  async function qDelete(ids) {
    if (!ids.length) return;
    const tx = (await db()).transaction('files', 'readwrite');
    for (const id of ids) tx.objectStore('files').delete(id);
    await txDone(tx);
  }
  // Ảnh của tab này theo thứ tự kéo vào; ảnh còn sót từ lần mở trình duyệt trước thì xoá.
  async function qMine() {
    const tx = (await db()).transaction('files');
    const req = tx.objectStore('files').getAll();
    await txDone(tx);
    const stale = req.result.filter((it) => it.bootId !== tab.bootId).map((it) => it.id);
    if (stale.length) await qDelete(stale);
    return req.result.filter((it) => it.bootId === tab.bootId && it.tabId === tab.tabId).sort((a, b) => a.id - b.id);
  }
  // Các thao tác với hàng chờ chạy lần lượt, không chen nhau.
  let queueChain = Promise.resolve();
  function queueOp(fn) {
    const run = queueChain.then(() => hello).then(fn);
    queueChain = run.catch((e) => console.debug('[Auto Click]', e));
    return queueChain;
  }
  function refreshQueue() {
    return queueOp(async () => { queueCount = (await qMine()).length; queueLoaded = true; });
  }

  function enqueue(files, x, y) {
    queueCount += files.length;
    queueOp(() => qAdd(files.map((file) => ({
      tabId: tab.tabId, bootId: tab.bootId, name: file.name, file, x, y, addedAt: Date.now(),
    })))).then(refreshQueue).then(() => pump());
  }

  // Rảnh rồi → lấy ảnh đầu hàng chờ đưa vào trang.
  async function pump() {
    if (pumping || job || !settings.enabled || !document.body) return;
    pumping = true;
    try {
      let item = null;
      await queueOp(async () => { [item] = await qMine(); });
      if (!item || job) return;
      startJob(item.name);
      job.itemId = item.id;
      job.feed = { step: 1, at: Date.now(), url: location.href, ok: false };
      saveJob();
      feedDrop(item);
    } finally {
      pumping = false;
    }
  }

  // Thả ảnh vào trang y như bạn kéo thả (ở đúng chỗ bạn đã thả).
  function feedDrop(item) {
    const dt = new DataTransfer();
    dt.items.add(item.file);
    const x = Math.min(Math.max(item.x ?? innerWidth / 2, 1), innerWidth - 1);
    const y = Math.min(Math.max(item.y ?? innerHeight / 2, 1), innerHeight - 1);
    const fire = (type) => {
      const target = document.elementFromPoint(x, y) || document.body;
      feedingNow = true;
      try {
        target.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: x, clientY: y,
        }));
      } finally { feedingNow = false; }
    };
    fire('dragenter');
    fire('dragover');
    setTimeout(() => { fire('dragover'); fire('drop'); }, 200);
  }

  // Cách khác: chọn ảnh vào ô chọn file của trang.
  function feedInput(item) {
    const input = [...document.querySelectorAll('input[type="file"]')].find((i) => !i.disabled);
    if (!input) return false;
    const dt = new DataTransfer();
    dt.items.add(item.file);
    feedingNow = true;
    try {
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } finally { feedingNow = false; }
    return true;
  }

  // Trang đã nhận ảnh chưa? Chưa thì lần lượt: thả lại → ô chọn file → về trang chủ thử lại → bỏ qua.
  async function handleFeed() {
    const f = job.feed;
    if (!f || f.ok || feedBusy) return;
    if (scan.precropHeading || scan.busyModal || (f.step !== 3 && location.href !== f.url)) {
      f.ok = true;
      saveJob();
      return;
    }
    if (Date.now() - f.at < FEED_STEP_MS) return;
    feedBusy = true;
    try {
      let item = null;
      await queueOp(async () => { item = (await qMine()).find((it) => it.id === job?.itemId); });
      if (!job || job.feed !== f) return;
      if (!item) { finishJob(); return; }
      f.step++;
      f.at = Date.now();
      if (f.step === 2 || f.step === 5) {
        if (!feedInput(item)) f.at = 0; // Không có ô chọn file → sang bước sau luôn
        saveJob();
      } else if (f.step === 3) {
        f.at = Date.now() - FEED_STEP_MS + 2000; // Về trang chủ rồi thả lại sau 2 giây
        await saveJob();
        location.assign(`${location.origin}/`);
      } else if (f.step === 4) {
        f.url = location.href;
        saveJob();
        feedDrop(item);
      } else {
        finishJob(); // Không đưa được ảnh này vào trang → bỏ qua, làm ảnh sau
      }
    } finally {
      feedBusy = false;
    }
  }

  // Bạn tự bấm CANCEL / đóng (chỉ tính cú bấm thật, không tính cú bấm của extension).
  listen(document, 'click', (e) => {
    if (e.isTrusted && job && isStopControl(e.target)) stopJob();
  });
  listen(window, 'keydown', (e) => {
    if (e.isTrusted && job && e.key === 'Escape') stopJob();
  });

  function isStopControl(target) {
    for (let n = target, i = 0; n instanceof Element && n !== document.body && i < 6; n = n.parentElement, i++) {
      const label = norm(n.getAttribute('aria-label') || n.getAttribute('title'));
      if (RX.cancel.test(label)) return true;
      if (n.matches(CONTROL_SEL) || n.matches(LOOSE_SEL) || getComputedStyle(n).cursor === 'pointer') {
        return RX.cancel.test(textOf(n));
      }
    }
    return false;
  }

  // ---------- Tìm & bấm nút ----------
  const norm = (s) => (s || '').replace(/[\s​-‍﻿]+/g, ' ').trim().toLowerCase();
  const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };

  // Chữ hiển thị trên nút, bỏ qua icon (vd. icon font kiểu "file_download") và chữ ẩn (tooltip).
  function textOf(el) {
    if (el instanceof HTMLInputElement) return norm(el.value);
    let s = '';
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = tw.nextNode(); t; t = tw.nextNode()) {
      const p = t.parentElement;
      const icon = p.closest(ICONISH);
      if (icon && icon !== el && el.contains(icon)) continue;
      if (p.checkVisibility && !p.checkVisibility(VIS)) continue;
      s += ` ${t.nodeValue}`;
    }
    return norm(s);
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility(VIS)) return false;
    } else {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }

  function isEnabled(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.disabled || n.inert || n.getAttribute('aria-disabled') === 'true') return false;
    }
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/\bdisabled\b/i.test(cls)) return false;
    return getComputedStyle(el).pointerEvents !== 'none';
  }

  // Có lớp phủ nào (bảng "Upload / Process / Fetch", nền mờ…) đè lên nút không?
  // Thử vài điểm trên nút, trúng nút ở điểm nào cũng được.
  function isUncovered(el) {
    const r = el.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]]) {
      const x = Math.min(Math.max(r.left + r.width * fx, 0), innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height * fy, 0), innerHeight - 1);
      const top = document.elementFromPoint(x, y);
      if (!top || top === el || el.contains(top)) return true;
      // Trúng khung bao sát nút (vd. chữ trên nút bỏ qua chuột) vẫn tính là không bị che.
      for (let n = el.parentElement, i = 0; n && i < 3; n = n.parentElement, i++) if (n === top) return true;
    }
    return false;
  }

  const isReady = (el) => isVisible(el) && isEnabled(el) && isUncovered(el);

  function closestClickable(el) {
    for (let n = el, i = 0; n && n !== document.body && i < 6; n = n.parentElement, i++) {
      if (n.matches(CONTROL_SEL) || n.matches(LOOSE_SEL) || n.onclick
        || getComputedStyle(n).cursor === 'pointer') return n;
    }
    return null;
  }

  // Phần tử lồng nhau: chỉ giữ phần tử trong cùng (cú bấm sẽ nổi lên các khung ngoài).
  const innermost = (list) => list.filter((el) => !list.some((o) => o !== el && el.contains(o)));

  // Tìm các nút có chữ khớp hoàn toàn với rx. Ưu tiên nút thật (<button>, <a>…),
  // không có mới tìm phần tử trông giống nút (class "btn", con trỏ bàn tay…).
  function findButtons(rx, root = document.body) {
    if (!root) return [];
    const controls = [...root.querySelectorAll(CONTROL_SEL)].filter((el) => rx.test(textOf(el)));
    if (controls.length) return innermost(controls);
    const loose = [...root.querySelectorAll(LOOSE_SEL)].filter((el) => rx.test(textOf(el)));
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = tw.nextNode(); t; t = tw.nextNode()) {
      if (!rx.test(norm(t.nodeValue))) continue;
      const c = closestClickable(t.parentElement);
      if (c && !loose.includes(c)) loose.push(c);
    }
    return innermost(loose);
  }

  // Nút DOWNLOAD chính: ưu tiên nút đang bấm được, rồi nút to nhất.
  function findDownloadButton() {
    const cands = findButtons(RX.download).filter(isVisible).sort((a, b) => area(b) - area(a));
    return cands.find((el) => isEnabled(el) && isUncovered(el)) || cands[0] || null;
  }

  function dlKey(el) {
    return `${location.href}|${el.closest('a[href]')?.href || ''}`;
  }

  function realClick(el) {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, composed: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0,
    };
    const ptr = { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerover', ptr));
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new PointerEvent('pointerdown', { ...ptr, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...opts, buttons: 1 }));
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', ptr));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click(); // click() tự kích hoạt cả link <a href> (tải file)
  }

  // ---------- Quét chữ trên trang (một lượt cho mỗi vòng lặp) ----------
  function scanPage() {
    const res = { precropHeading: null, busyLabels: new Set(), busyWord: false };
    const labelEls = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = tw.nextNode(); t; t = tw.nextNode()) {
      const v = t.nodeValue;
      if (v.length > 60 || !v.trim()) continue; // Chỉ xét chữ ngắn (tiêu đề, nhãn)
      const n = norm(v);
      let hit = null;
      if (!res.precropHeading && RX.precrop.test(n)) hit = 'precrop';
      else if (RX.busyLabel.test(n)) hit = 'label';
      else if (!res.busyWord && RX.busyWord.test(n)) hit = 'word';
      if (!hit || !isVisible(t.parentElement)) continue;
      if (hit === 'precrop') res.precropHeading = t.parentElement;
      else if (hit === 'label') { res.busyLabels.add(n); labelEls.push(t.parentElement); }
      else res.busyWord = true;
    }
    res.busyModal = res.busyLabels.size >= 2 && isBusyModal(labelEls);
    return res;
  }

  // Bảng "Upload / Process / Fetch": các nhãn đó nằm chung một khung có nút CANCEL.
  function isBusyModal(labelEls) {
    for (let n = labelEls[0].parentElement, i = 0; n && n !== document.body && i < 8; n = n.parentElement, i++) {
      if (!labelEls.slice(1).some((el) => n.contains(el))) continue;
      return findButtons(RX.cancel, n).some(isVisible);
    }
    return false;
  }

  // ---------- Bước 1: bảng Pre-Crop → bấm OK ----------
  function findPrecropOk() {
    const heading = scan.precropHeading;
    if (heading) {
      // Đi dần lên các khung cha, gặp nút OK nào gần tiêu đề nhất thì lấy.
      for (let n = heading.parentElement, i = 0; n && n !== document.body && i < 15; n = n.parentElement, i++) {
        const ok = findButtons(RX.ok, n).find(isReady);
        if (ok) return ok;
      }
      return findButtons(RX.ok).find(isReady) || null;
    }
    // Không thấy tiêu đề: nhận ra bảng qua nội dung ("Size Limit", "Megapixels"…).
    for (const ok of findButtons(RX.ok).filter(isReady)) {
      for (let n = ok.parentElement, i = 0; n && n !== document.body && i < 12; n = n.parentElement, i++) {
        const text = n.textContent;
        if (text.length < 5000 && RX.precropContext.test(text)) return ok;
      }
    }
    return null;
  }

  function handlePrecrop() {
    if (Date.now() - stoppedAt < STOP_COOLDOWN_MS) return;
    const ok = findPrecropOk();
    if (!ok) { precropAttempts = 0; return; }
    if (precropAttempts >= MAX_PRECROP_CLICKS || Date.now() - lastPrecropClickAt < 1500) return;
    if (!job) startJob('ảnh');
    precropAttempts++;
    lastPrecropClickAt = Date.now();
    realClick(ok);
  }

  // ---------- Bước 2: có kết quả → bấm DOWNLOAD ----------
  // Bấm DOWNLOAD ở trang kết quả sẽ mở trang "Download" (chọn SVG/PDF…), ở đó lại có
  // nút Download để tải file thật. Mỗi nút (theo địa chỉ trang + link) chỉ bấm một lần.
  async function handleDownload() {
    const now = Date.now();
    const el = findDownloadButton();
    const busy = scan.busyModal || !!scan.precropHeading;
    if (el && (!job.startDlKey || job.startDlKey !== dlKey(el) || sawNotReady)) progressAt = now;
    const uncovered = !!el && isUncovered(el);
    if (!el || uncovered) coveredSince = 0;
    let wait = false; // Còn phải chờ
    if (!el || busy || !isEnabled(el)) wait = true;
    else if (!uncovered) {
      // Có vẻ bị che nhưng không có bảng nào đang hiện: chờ thêm chút rồi vẫn bấm.
      if (!coveredSince) coveredSince = now;
      if (now - coveredSince < COVERED_GRACE_MS) wait = true;
    }

    if (wait) {
      readySince = 0;
      if (!notReadySince) notReadySince = now;
      if (now - notReadySince > 500) sawNotReady = true;
      return;
    }
    notReadySince = 0;
    if (!readySince) readySince = now;
    if (now - readySince < STABLE_MS) return;
    if (scan.busyWord && now - readySince < BUSY_MAX_MS) return;
    const key = dlKey(el);
    const clicked = job.clickedKeys || [];
    if (clicked.includes(key) || clicked.length >= MAX_CLICKS) return;
    // Vẫn là nút DOWNLOAD của ảnh trước → chờ ảnh mới.
    if (job.startDlKey && job.startDlKey === key && !sawNotReady) return;

    const prev = { stage: job.stage, clickedAt: job.clickedAt, last: job.last };
    job.stage = 'downloading';
    job.clickedAt = now;
    job.clickedKeys = [...clicked, key];
    job.last = { url: location.href, href: el.closest('a[href]')?.href || '', at: now, fallback: false };
    const jobId = job.id;
    // Báo background (kèm việc đang làm) trước khi bấm, để nó nhận ra file tải về thuộc ảnh này.
    await Promise.race([
      chrome.runtime.sendMessage({ type: 'va:clicked', job }).catch(() => {}),
      new Promise((r) => setTimeout(r, 1000)),
    ]);
    if (!job || job.id !== jobId) return; // Bạn vừa bấm dừng
    if (!el.isConnected) { // Nút vừa bị vẽ lại → lần sau tìm lại
      Object.assign(job, prev, { clickedKeys: clicked });
      saveJob();
      readySince = 0;
      return;
    }
    realClick(el);
  }

  // Đã bấm mà trang đứng yên, chưa có file → mở thẳng link của nút (như bạn tự mở link).
  async function handleFallback() {
    const last = job.last;
    if (job.stage !== 'downloading' || job.dlStarted || !last || last.fallback) return;
    if (Date.now() - last.at < FALLBACK_MS || location.href !== last.url) return;
    if (!/^https?:/i.test(last.href) || last.href.includes('#') || last.href === location.href) return;
    last.fallback = true;
    await saveJob();
    location.assign(last.href);
  }

  // ---------- Tin nhắn từ background / popup ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (ac.signal.aborted || !msg) return;
    if (msg.type === 'va:ping') {
      const waiting = Math.max(0, queueCount - (job?.itemId != null ? 1 : 0));
      sendResponse({ ok: true, version: chrome.runtime.getManifest().version, busy: !!job, waiting });
      return;
    }
    if (msg.type === 'va:debug') {
      sendResponse(debugReport());
      return;
    }
    if (!job || msg.jobId !== job.id) return;
    if (msg.type === 'va:dlStarted') {
      job.dlStarted = true;
      saveJob();
    } else if (msg.type === 'va:dlComplete' || msg.type === 'va:dlFailed') {
      finishJob();
    }
  });

  // Thông tin để tìm lỗi khi extension không bấm được nút (popup → "Sao chép thông tin lỗi").
  function debugReport() {
    if (!scan) scan = scanPage();
    const path = (el) => {
      const parts = [];
      for (let n = el, i = 0; n && n !== document.documentElement && i < 6; n = n.parentElement, i++) {
        const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
        parts.unshift(n.tagName.toLowerCase() + (n.id ? `#${n.id}` : '') + (cls ? `.${cls}` : ''));
      }
      return parts.join(' > ');
    };
    const describe = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        path: path(el),
        text: textOf(el).slice(0, 60),
        rect: [r.left, r.top, r.width, r.height].map(Math.round),
        visible: isVisible(el),
        enabled: isEnabled(el),
        uncovered: isUncovered(el),
        topAtCenter: top ? path(top) : null,
        html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 300),
      };
    };
    const texts = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = tw.nextNode(); t && texts.length < 8; t = tw.nextNode()) {
      if (/crop|download|upload|process|fetch/i.test(t.nodeValue) && t.nodeValue.length < 80) {
        texts.push(`${norm(t.nodeValue)} [${isVisible(t.parentElement) ? 'hiện' : 'ẩn'}] ${path(t.parentElement)}`);
      }
    }
    return {
      version: chrome.runtime.getManifest().version,
      page: location.pathname,
      iframes: document.querySelectorAll('iframe').length,
      shadowHosts: [...document.querySelectorAll('*')].filter((el) => el.shadowRoot).length,
      settings,
      job,
      queueCount,
      scan: { precrop: !!scan.precropHeading, busyLabels: [...scan.busyLabels], busyWord: scan.busyWord },
      texts,
      precropOk: describe(findPrecropOk()),
      ok: findButtons(RX.ok).slice(0, 4).map(describe),
      cancel: findButtons(RX.cancel).slice(0, 4).map(describe),
      download: findButtons(RX.download).slice(0, 4).map(describe),
    };
  }

  // ---------- Vòng lặp ----------
  function tick() {
    if (!settings.enabled || !document.body) return;
    scan = scanPage();
    if (!scan.busyModal) busyAfterStop = false;
    if (job && Date.now() - job.startedAt > JOB_TTL_MS) finishJob();
    if (settings.autoPrecrop) handlePrecrop();
    // Bảng tiến trình hiện ra giữa chừng mà chưa có job (vd. tải ảnh bằng cách khác) → nhận việc.
    // Bảng hiện ngay lúc vừa mở trang (mở lại ảnh cũ, tải lại trang) thì không tính.
    if (!job && jobLoaded && scan.busyModal && !busyAfterStop && Date.now() - startedAt > 3000
      && Date.now() - stoppedAt > STOP_COOLDOWN_MS) startJob('ảnh');
    if (job && job.stage === 'downloading' && Date.now() - job.clickedAt > DOWNLOAD_CONFIRM_MS) finishJob();
    // Còn tiến triển: có bảng Pre-Crop / bảng xử lý, đang đưa ảnh vào, đã bấm tải…
    if (job && (scan.precropHeading || scan.busyModal || job.stage === 'downloading'
      || (job.feed && !job.feed.ok))) progressAt = Date.now();
    if (job && job.stage === 'waiting' && Date.now() - progressAt > STALL_MS) finishJob();
    if (job && job.feed && !job.feed.ok) {
      handleFeed(); // Chưa chắc trang đã nhận ảnh → chưa bấm gì khác
    } else if (job && settings.autoDownload) {
      handleFallback();
      handleDownload();
    }
    if (!job && queueCount > 0 && Date.now() - idleSince > NEXT_DELAY_MS
      && Date.now() - stoppedAt > STOP_COOLDOWN_MS) pump();
  }

  function stop() {
    ac.abort();
    clearInterval(interval);
    observer.disconnect();
    document.getElementById('ac-toast')?.remove(); // Thông báo của bản cũ (nếu còn)
  }
  globalThis.__autoClickStop = stop;

  function safeTick() {
    if (!chrome.runtime?.id) return stop(); // Extension vừa được cập nhật/gỡ → dừng bản cũ
    try { tick(); } catch (e) { console.debug('[Auto Click]', e); }
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; safeTick(); }, 150);
  });
  observer.observe(document, { // Chạy từ lúc trang mới bắt đầu tải (chưa có <html>)
    childList: true, subtree: true, attributes: true, characterData: true,
  });
  const interval = setInterval(safeTick, 700);

  safeTick();
})();
