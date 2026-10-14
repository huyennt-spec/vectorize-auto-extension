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
  const DOWNLOAD_CONFIRM_MS = 40 * 1000; // Chờ file tải về tối đa bấy lâu sau lần bấm cuối / từ lúc sang trang
  const MAX_CLICKS = 6;                  // Số lần bấm "Download" tối đa cho mỗi ảnh (mọi trang cộng lại)
  const MAX_TRIES = 2;                   // Một nút bấm hụt (trang chưa sẵn sàng) thì bấm lại tối đa bấy lần
  const RETRY_MS = 3000;                 // Bấm hụt (có bằng chứng) → chờ bấy lâu rồi bấm lại
  const MISS_CHECK_MS = 1500;            // Bấm xong bấy lâu thì xét xem cú bấm có hụt không
  const HIDDEN_DL_CAP_MS = 3 * 60 * 1000; // Cửa sổ ẩn mà còn ảnh khác chờ: đợi file tối đa bấy lâu
  const SHOW_GRACE_MS = 2 * 60 * 1000;   // Cửa sổ vừa hiện lại: việc đang làm còn ít nhất bấy lâu
  const SETTLE_MS = 700;                 // Trang tải xong hẳn bấy lâu rồi mới bấm (để script của trang gắn xong nút)
  const NAV_WINDOW_MS = 20 * 1000;       // Trang mở ra quá bấy lâu sau lần bấm cuối → do bạn tự chuyển trang
  const STALE_DL_ON_DROP_MS = 8000;      // Bạn kéo ảnh mới mà ảnh trước bấm tải đã bấy lâu chưa có file → bỏ
  const AFTER_SHOW_MS = 15 * 1000;       // Cửa sổ vừa hiện lại: còn ít nhất bấy lâu trước khi hết hạn
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
  // Bảng/hộp thoại của trang (Bootstrap .modal như web thật, <dialog>, role="dialog"…) và nền mờ của nó.
  const DIALOG_SEL = '.modal, dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]';
  // Lớp che không cho bấm: hộp thoại chặn cả trang (không tính role="dialog" thường, vd. thanh cookie).
  const DIALOG_COVER_SEL = '.modal, .modal-backdrop, dialog, [aria-modal="true"]';
  const VIS = { opacityProperty: true, visibilityProperty: true };

  let settings = { ...VA.DEFAULTS };
  let job = null;
  let jobLoaded = false;     // Đã lấy xong việc đang làm của tab này từ background
  const startedAt = Date.now();
  let readySince = 0;      // Lúc nút DOWNLOAD bắt đầu sẵn sàng
  let coveredSince = 0;    // Lúc nút DOWNLOAD bắt đầu "có vẻ bị che"
  // Các nút Download có sẵn lúc ảnh này vào (của ảnh trước) ở trang này → link thật của nút lúc đó ('' nếu là "#").
  const oldEls = new WeakMap();
  let completeAt = document.readyState === 'complete' ? Date.now() - SETTLE_MS : 0;
  let precropAttempts = 0;
  let lastPrecropClickAt = 0;
  let stoppedAt = 0;
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
  let clicking = false;      // Đang trong một lần bấm DOWNLOAD (chờ background trả lời)
  let stopRequested = false; // Bạn bấm dừng lúc trang vừa mở, việc đang làm chưa nạp xong
  let sawBusyHere = false;   // Đã thấy bảng Upload/Process/Fetch của ảnh đang làm ngay trên trang này
  let navStartedAt = 0;      // Lúc trang bắt đầu chuyển đi (cú bấm đã có tác dụng)
  let checkClick = null;     // Lần bấm Download đang chờ xét có hụt không: { key, at }
  let lastDialogOver = false; // Nút Download đang bị bảng che (để ghi nhật ký một lần)
  let lastBusy = false;       // Bảng Upload/Process/Fetch đang hiện (để ghi nhật ký một lần)
  let doneBeforeLoad = null;  // Việc mà background báo đã xong trước khi trang này nạp xong việc
  const trace = [];          // Nhật ký ngắn các sự kiện gần đây (cho "Sao chép thông tin lỗi")
  const note = (m) => { trace.push(`${(performance.now() / 1000).toFixed(1)} ${m}`); if (trace.length > 40) trace.shift(); };
  let ends = [];             // 10 lần kết thúc ảnh gần nhất và lý do (cho "Sao chép thông tin lỗi")

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
    note(`hello job=${r.job?.id || '-'} stage=${r.job?.stage || '-'}`);
    ends = [...(r.ends || []), ...ends].slice(-10);
    if (jobLoaded) return; // Trong lúc chờ bạn đã thả ảnh mới
    jobLoaded = true;
    // Việc vừa xong đúng lúc trang chuyển (tin "đã tải xong" đến trước) thì không nhận lại.
    if (r.job && r.job.id !== doneBeforeLoad && Date.now() - r.job.startedAt < JOB_TTL_MS) job = r.job;
    else if (r.job) saveJob();
    if (job) progressAt = job.progressAt || job.startedAt; // Lần cuối còn tiến triển (kể cả ở trang trước)
    if (job && stopRequested) stopJob();
    // Trang này mở ra lâu sau lần bấm cuối: không phải do extension bấm mà do bạn tự chuyển trang
    // → bỏ ảnh đó, không bấm nút trên trang này.
    if (job && job.stage === 'downloading' && !job.dlStarted && !document.hidden
      && Date.now() - job.clickedAt > NAV_WINDOW_MS) finishJob('tự chuyển trang');
  }).catch(() => { jobLoaded = true; });
  hello.then(refreshQueue);

  function saveJob() {
    return chrome.runtime.sendMessage({ type: 'va:job:set', job }).catch(() => {});
  }

  function startJob(name) {
    if (!settings.enabled) return;
    jobLoaded = true;
    // Thả ảnh mới ngay trên trang kết quả / trang Download của ảnh cũ thì nút của ảnh cũ
    // vẫn còn đó (lúc bảng Pre-Crop đóng, lúc web đang thu nhỏ ảnh…): ghi lại để không bấm
    // nhầm. Nhớ chính các nút đó (phần tử trên trang) và địa chỉ của chúng; địa chỉ chỉ dùng
    // cho tới khi trang chuyển đi, vì trang của ảnh mới có thể trùng địa chỉ với ảnh cũ.
    const olds = findButtons(RX.download);
    olds.forEach((el) => oldEls.set(el, realHref(el)));
    job = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: name || 'ảnh',
      startedAt: Date.now(),
      startUrl: normUrl(location.href),
      startId: imageId(location.href), // Ảnh đang mở lúc thả ảnh mới (ảnh trước), nếu có
      leftStart: false,  // Đã rời trang lúc bắt đầu (địa chỉ cũ không còn là "nút cũ" nữa)
      sawBusy: false,    // Đã thấy bảng Upload/Process/Fetch của ảnh này (ở trang nào đó)
      oldKeys: olds.map(dlKey),
      stage: 'waiting',  // 'waiting' → chờ kết quả, 'downloading' → đã bấm, chờ file về
      tries: {},         // Số lần đã bấm từng nút: { key: { n, at, url } }
      clicks: 0,
      last: null,        // Lần bấm gần nhất: { url, href, at, fallback }
      dlStarted: false,  // Trình duyệt đã bắt đầu tải file
    };
    readySince = 0;
    coveredSince = 0;
    sawBusyHere = false;
    progressAt = Date.now();
    stoppedAt = 0;
    saveJob();
  }

  function finishJob(reason = '') {
    if (job) {
      ends = [...ends, {
        name: job.name, reason, at: new Date().toLocaleTimeString('vi-VN'), hidden: document.hidden,
        stage: job.stage, clicks: job.clicks || 0, clickedAgo: job.clickedAt ? Date.now() - job.clickedAt : null,
        tries: Object.values(job.tries || {}).map((t) => `${t.n}${t.miss ? 'h' : ''}${t.prevented ? 'p' : ''}${t.hidden ? 'a' : ''}`).join(','),
        keys: Object.keys(job.tries || {}).map((k) => k.replace(/https?:\/\/[^/|]+/g, '').slice(-90)),
        sawBusy: !!job.sawBusy,
        trace: trace.slice(-16),
      }].slice(-10);
      chrome.runtime.sendMessage({ type: 'va:ended', ends }).catch(() => {});
    }
    const itemId = job?.itemId;
    job = null;
    checkClick = null;
    precropAttempts = 0;
    idleSince = Date.now();
    saveJob();
    if (itemId != null) queueOp(() => qDelete([itemId])).then(refreshQueue);
  }

  // Bạn bấm dừng: bỏ ảnh đang làm và cả hàng chờ.
  function stopJob() {
    finishJob('bấm dừng');
    queueOp(async () => qDelete((await qMine()).map((it) => it.id))).then(refreshQueue);
    stoppedAt = Date.now();
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
    if (job && job.stage === 'waiting' && Date.now() - progressAt > STALL_ON_DROP_MS) finishJob('đứng yên, có ảnh mới');
    // Ảnh trước đã bấm tải nhưng cú bấm chắc chắn hụt và đã lâu: bỏ. Còn đang tải (dù chậm) thì để yên,
    // ảnh mới vào hàng chờ, không được cắt ngang file đang tải.
    if (job && job.stage === 'downloading' && !job.dlStarted && lastTry()?.miss
      && Date.now() - job.clickedAt > STALE_DL_ON_DROP_MS) finishJob('bấm hụt, có ảnh mới');
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
    if (pumping || job || !settings.enabled || !document.body || !pageSettled()) return;
    pumping = true;
    try {
      let item = null;
      await queueOp(async () => { [item] = await qMine(); });
      if (!item || job) return;
      startJob(item.name);
      job.itemId = item.id;
      // busyBefore: bảng xử lý đã mở sẵn (vd. ảnh trước bị treo) → bảng đó không chứng tỏ trang đã nhận ảnh này.
      job.feed = { step: 1, at: Date.now(), url: location.href, ok: false, busyBefore: !!scan?.busyModal };
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
    if (f.busyBefore && !scan.busyModal) f.busyBefore = false; // Bảng cũ đã đóng: bảng mở lại là của ảnh này
    if (scan.precropHeading || (scan.busyModal && !f.busyBefore) || (f.step !== 3 && location.href !== f.url)) {
      f.ok = true;
      saveJob();
      return;
    }
    if (Date.now() - f.at < FEED_STEP_MS || !pageSettled()) return;
    feedBusy = true;
    try {
      let item = null;
      await queueOp(async () => { item = (await qMine()).find((it) => it.id === job?.itemId); });
      if (!job || job.feed !== f) return;
      if (!item) { finishJob('mất ảnh trong hàng chờ'); return; }
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
        f.busyBefore = !!scan.busyModal;
        saveJob();
        feedDrop(item);
      } else {
        finishJob('trang không nhận ảnh'); // Không đưa được ảnh này vào trang → bỏ qua, làm ảnh sau
      }
    } finally {
      feedBusy = false;
    }
  }

  // Bạn tự bấm CANCEL / đóng (chỉ tính cú bấm thật, không tính cú bấm của extension).
  listen(document, 'click', (e) => {
    if (e.isTrusted && (job || !jobLoaded) && isStopControl(e.target)) requestStop();
  });
  listen(window, 'keydown', (e) => {
    if (e.isTrusted && (job || !jobLoaded) && e.key === 'Escape') requestStop();
  });
  // Trang vừa mở, việc đang làm chưa nạp xong → nhớ lại, nạp xong thì dừng.
  function requestStop() {
    if (jobLoaded) stopJob();
    else stopRequested = true;
  }

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
      // Cửa sổ đang thu nhỏ/ẩn: hiệu ứng hiện dần của trang không chạy (nút kẹt ở độ mờ 0),
      // nên lúc đó chỉ xét ẩn/hiện thật, không xét độ mờ.
      if (!el.checkVisibility(document.hidden ? { visibilityProperty: true } : VIS)) return false;
    } else {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }

  // relaxHidden: cửa sổ ẩn thì hiệu ứng mở khoá nút (bỏ pointer-events: none khi chạy xong) không chạy,
  // nên với lần bấm đầu tiên của một nút thì bỏ qua pointer-events. Các lần khác vẫn xét chặt
  // (trang có thể đang khoá nút vì đang chuẩn bị file).
  function isEnabled(el, relaxHidden = false) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.disabled || n.inert || n.getAttribute('aria-disabled') === 'true') return false;
    }
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/\bdisabled\b/i.test(cls)) return false;
    return (relaxHidden && document.hidden) || getComputedStyle(el).pointerEvents !== 'none';
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

  // Nút đang nằm dưới một bảng/hộp thoại đang mở (hoặc nền mờ của nó): người dùng cũng không bấm được,
  // nên không bấm xuyên qua (vd. bảng Upload/Process/Fetch, bảng báo lỗi). Gọi khi isUncovered(el) là false.
  function underDialog(el) {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1),
      Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1));
    const box = top?.closest(DIALOG_COVER_SEL);
    return !!box && !box.contains(el);
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

  // Bỏ dấu # trơn ở cuối: bấm vào link href="#" khi trang chưa sẵn sàng chỉ thêm "#" vào địa chỉ.
  const normUrl = (u) => (u || '').replace(/#$/, '');

  // Link thật của nút (mở trang/tệp khác), '' nếu không có link hoặc chỉ là "#…" trong cùng trang.
  function realHref(el) {
    const href = el.closest('a[href]')?.href || '';
    if (!/^https?:/i.test(href)) return '';
    const bare = (u) => u.replace(/#.*$/, '');
    return bare(href) === bare(location.href) ? '' : normUrl(href);
  }

  // Mã ảnh trong địa chỉ (/images/<mã>/…), '' nếu không có.
  const imageId = (u) => { try { return (new URL(u, location.href).pathname.match(/^\/images\/([^/]+)/) || [])[1] || ''; } catch { return ''; } };

  // Nút được nhận diện theo địa chỉ đầy đủ của trang + link của nút.
  function dlKey(el) {
    return `${normUrl(location.href)}|${normUrl(el.closest('a[href]')?.href)}`;
  }

  // Nút của ảnh trước:
  // - cùng địa chỉ (trang + link) với nút có sẵn lúc ảnh này vào, khi chưa rời trang đó; hoặc
  // - chính phần tử có sẵn lúc ảnh này vào, cho tới khi thấy web xử lý ảnh mới (bảng Upload/Process/
  //   Fetch) VÀ có bằng chứng nút đã thuộc ảnh mới: nút có link thật thì link phải đổi (link cũ còn nguyên
  //   = vẫn là ảnh trước, vd. web báo lỗi); nút "#" thì phải không bị gì che (không bấm xuyên lớp phủ).
  function isOld(el, key) {
    if (!job?.leftStart && (job?.oldKeys || []).includes(key)) return true;
    if (!oldEls.has(el)) return false;
    if (!job?.sawBusy) return true;
    const was = oldEls.get(el);
    if (was) { const now = realHref(el); return !now || now === was; }
    // Nút "#": của ảnh mới khi không còn gì che, và không còn nút nào hiện nguyên link thật của ảnh trước
    // (link cũ còn trên trang = kết quả mới chưa có, nút "#" lúc này vẫn mở ảnh trước).
    return !isUncovered(el) || oldLinkShown();
  }
  const oldLinkShown = () => findButtons(RX.download).some((o) => {
    const was = oldEls.get(o);
    return !!was && isVisible(o) && realHref(o) === was;
  });

  // Nút DOWNLOAD để bấm: ưu tiên nút không phải của ảnh trước, rồi nút đang bấm được, rồi nút to nhất.
  function pickDownloadButton() {
    const cands = findButtons(RX.download).filter(isVisible).sort((a, b) => area(b) - area(a));
    const fresh = cands.filter((el) => !isOld(el, dlKey(el)));
    const list = fresh.length ? fresh : cands;
    return list.find((el) => isEnabled(el, true) && isUncovered(el)) || list[0] || null;
  }

  // Trang này có phải trang kết quả của ảnh đang làm không. Ảnh mới luôn hiện bảng Upload/Process/
  // Fetch trên trang kết quả của nó; trang mở ra mà không có bảng đó (vd. bạn mở lại ảnh cũ trong
  // lúc chờ) thì không bấm. Ngoại lệ: trang lúc bắt đầu (web xử lý tại chỗ), đã sang bước tải
  // (trang Download), hoặc chưa từng thấy bảng đó (phòng khi web không hiện bảng).
  // Trang kết quả cũng có thể là trang cùng đường dẫn với nơi đã thấy bảng (web tải lại / chuyển sang
  // địa chỉ chuẩn sau khi xử lý), hoặc trang mở ra ngay sau trang bắt đầu nếu bảng hiện ở trang bắt đầu.
  const under = (path, p) => path === p || (p !== '/' && path.startsWith(`${p.replace(/\/+$/, '')}/`));
  function resultPageHere() {
    if (!job) return false;
    if (job.stage === 'downloading' || sawBusyHere || !job.sawBusy) return true;
    if (!job.leftStart && normUrl(location.href) === job.startUrl) return true;
    if ((job.busyPaths || []).some((p) => under(location.pathname, p))) return true;
    if (job.busyOnStart && job.leftStart) {
      if (!job.nextPath) {
        job.nextPath = location.pathname;
        saveJob();
      }
      return location.pathname === job.nextPath;
    }
    return false;
  }

  // Trang đã tải xong hẳn chưa (script của trang đã kịp gắn việc cho nút).
  const pageSettled = () => completeAt > 0 && Date.now() - completeAt >= SETTLE_MS;
  listen(window, 'load', () => { completeAt = Date.now(); });
  // Cửa sổ vừa hiện lại: những lần bấm lúc ẩn có thể đã hụt (trang chỉ chạy khi hiện) → cho bấm lại
  // các nút trên trang này, trừ khi file đã bắt đầu tải.
  listen(document, 'visibilitychange', () => {
    if (document.hidden || !job) return;
    const now = Date.now();
    readySince = 0;      // Chờ nút ổn định lại rồi mới bấm
    precropAttempts = 0; // Bảng Pre-Crop còn mở thì được thử lại
    // Thời gian ẩn không tính vào hạn chờ.
    job.startedAt = Math.max(job.startedAt, now - JOB_TTL_MS + SHOW_GRACE_MS);
    progressAt = now; // Lúc ẩn trang có thể không chạy (không vẽ): tính lại thời gian đứng yên từ lúc hiện
    if (job.stage === 'downloading') {
      job.clickedAt = Math.max(job.clickedAt || 0, now - DOWNLOAD_CONFIRM_MS + AFTER_SHOW_MS);
    }
    // Chỉ cho bấm lại những lần bấm chắc chắn hụt lúc ẩn (trang chỉ chạy khi cửa sổ hiện).
    if (job.tries && !job.dlStarted) {
      const here = normUrl(location.href);
      job.tries = Object.fromEntries(Object.entries(job.tries).filter(([, t]) => !(t.url === here && t.miss)));
    }
    saveJob();
  });

  // Trang bắt đầu chuyển đi (vd. cú bấm Download đã mở link tải file).
  listen(window, 'beforeunload', () => { navStartedAt = Date.now(); });
  listen(window, 'pagehide', () => { navStartedAt = Date.now(); });
  if (window.navigation) {
    // Chỉ tính khi sang trang khác thật (bấm link "#" chỉ đổi phần # trong cùng trang).
    navigation.addEventListener('navigate', (e) => {
      if (e.destination && !e.destination.sameDocument) navStartedAt = Date.now();
    }, { signal: ac.signal });
  }

  // Lần bấm gần nhất trên trang này.
  const lastTry = () => (job?.last ? job.tries?.[job.last.key] : null);

  // Bấm xong MISS_CHECK_MS: cú bấm "hụt" khi trang không nhận (không preventDefault), trang không
  // chuyển đi, và nút là link "#" (href trỏ về chính trang) nên địa chỉ chỉ thêm dấu #.
  // Chỉ những lần hụt mới được bấm lại; bấm trúng mà file về chậm thì chờ, không bấm thêm.
  function checkMiss() {
    if (!checkClick || !job || Date.now() - checkClick.at < MISS_CHECK_MS) return;
    const t = job.tries?.[checkClick.key];
    const at = checkClick.at;
    checkClick = null;
    if (!t) return;
    t.miss = !t.prevented && navStartedAt < at && t.hashLink && normUrl(location.href) === t.url;
    saveJob();
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
    // Sự kiện click tự tạo vẫn kích hoạt link <a href> như click(); trang gọi preventDefault
    // nghĩa là script của trang đã nhận cú bấm.
    const click = new MouseEvent('click', { ...opts, detail: 1 });
    const notPrevented = el.dispatchEvent(click);
    return { prevented: !notPrevented || click.defaultPrevented };
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

  // Bảng "Upload / Process / Fetch": các nhãn đó nằm chung một khung có nút CANCEL. Web thật để nhãn trong
  // các ô của một bảng (<table>) còn nút Cancel ở chân hộp thoại (.modal-footer), nên từ khung nhỏ nhất chứa
  // các nhãn phải đi tiếp lên vài tầng (không ra khỏi hộp thoại) mới gặp nút Cancel.
  function isBusyModal(labelEls) {
    for (const start of labelEls) {
      let up = 0; // Số tầng đã đi lên từ khung nhỏ nhất chứa ≥ 2 nhãn
      for (let n = start, i = 0; n && n !== document.body && i < 14; n = n.parentElement, i++) {
        if (labelEls.filter((el) => n.contains(el)).length < 2) continue;
        if (findButtons(RX.cancel, n).some(isVisible)) return true;
        if (n.matches(DIALOG_SEL) || ++up > 6) break;
      }
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
    const el = pickDownloadButton();
    const busy = scan.busyModal || !!scan.precropHeading;
    if (!resultPageHere()) { readySince = 0; return; }
    const uncovered = !!el && isUncovered(el);
    // Nút nằm dưới một bảng đang mở (bảng xử lý, bảng báo lỗi…): chưa phải lúc bấm, và cũng chưa phải kết quả.
    const dialogOver = !!el && !uncovered && underDialog(el);
    if (el && !dialogOver && !isOld(el, dlKey(el))) progressAt = now;
    if (!el || uncovered || dialogOver) coveredSince = 0;
    if (dialogOver !== lastDialogOver) { lastDialogOver = dialogOver; if (dialogOver) note('nút Download đang bị bảng che → chờ'); }
    const firstClick = !!el && !job.tries?.[dlKey(el)]; // Lần bấm đầu tiên của nút này
    let wait = false; // Còn phải chờ
    if (!el || busy || dialogOver || !isEnabled(el, firstClick)) wait = true;
    else if (!uncovered) {
      // Có vẻ bị che nhưng không có bảng nào đang hiện: chờ thêm chút rồi vẫn bấm.
      if (!coveredSince) coveredSince = now;
      if (now - coveredSince < COVERED_GRACE_MS) wait = true;
    }

    if (wait || !pageSettled()) {
      readySince = 0;
      return;
    }
    if (!readySince) readySince = now;
    if (now - readySince < STABLE_MS) return;
    if (scan.busyWord && now - readySince < BUSY_MAX_MS) return;
    const key = dlKey(el);
    if (isOld(el, key)) return; // Nút của ảnh trước → chờ kết quả của ảnh mới
    // Lưới an toàn: đã bấm DOWNLOAD trên trang của ảnh mới mà lại sang trang của ảnh trước (ảnh đang mở lúc
    // thả) → không bấm tải ở đây (thà không có file còn hơn tải nhầm ảnh trước).
    const hereId = imageId(location.href);
    if (job.stage === 'downloading' && job.startId && hereId === job.startId && job.clickId && job.clickId !== job.startId) {
      finishJob('trang tải của ảnh trước');
      return;
    }
    // Mỗi nút bấm một lần. Bấm rồi mà sau RETRY_MS không có file về, trang không chuyển đi
    // (bấm hụt lúc trang chưa gắn xong nút) thì bấm lại, tối đa MAX_TRIES lần.
    const tries = job.tries || {};
    const t = tries[key];
    // Đã bấm nút này rồi: chỉ bấm lại khi lần trước chắc chắn hụt.
    if (t && !(t.miss && t.n < MAX_TRIES && !job.dlStarted && now - t.at >= RETRY_MS
      && normUrl(location.href) === t.url)) return;
    if ((job.clicks || 0) >= MAX_CLICKS || clicking) return;

    clicking = true;
    try {
      const jobId = job.id;
      const href = el.closest('a[href]')?.href || '';
      const after = {
        stage: 'downloading',
        clickedAt: now,
        firstClickAt: job.firstClickAt || now,
        clickId: job.clickId ?? imageId(location.href), // Ảnh của trang lúc bấm DOWNLOAD lần đầu
        last: { key, url: location.href, href, at: now, fallback: false },
        tries: { ...tries, [key]: {
          n: (t?.n || 0) + 1, at: now, url: normUrl(location.href), hidden: document.hidden,
          hashLink: !href || normUrl(href) === normUrl(location.href), // Link "#": trỏ về chính trang
        } },
        clicks: (job.clicks || 0) + 1,
      };
      // Báo background (kèm việc sau khi bấm) trước khi bấm, để nó nhận ra file tải về thuộc ảnh này.
      await Promise.race([
        chrome.runtime.sendMessage({ type: 'va:clicked', job: { ...job, ...after } }).catch(() => {}),
        new Promise((r) => setTimeout(r, 1000)),
      ]);
      if (!job || job.id !== jobId) return; // Bạn vừa bấm dừng
      const target = el.isConnected ? el : pickDownloadButton(); // Nút vừa bị vẽ lại → lấy nút mới
      if (!target || dlKey(target) !== key || !isVisible(target) || !isEnabled(target, firstClick)
        || job.dlStarted || navStartedAt >= now) { // File đã bắt đầu tải / trang đã chuyển trong lúc chờ
        readySince = 0;
        saveJob(); // Chưa bấm: trả lại trạng thái cũ cho background
        return;
      }
      const { prevented } = realClick(target);
      note(`bấm ${key.slice(-40)} prevented=${prevented}${document.hidden ? ' (ẩn)' : ''}`);
      after.tries[key].prevented = prevented;
      Object.assign(job, after); // Chỉ ghi "đã bấm" sau khi bấm thật
      checkClick = { key, at: now };
      saveJob();
    } finally {
      clicking = false;
    }
  }

  // Đã bấm mà trang đứng yên, chưa có file → mở thẳng link của nút (như bạn tự mở link).
  async function handleFallback() {
    const last = job.last;
    if (job.stage !== 'downloading' || job.dlStarted || !last || last.fallback) return;
    if (Date.now() - last.at < FALLBACK_MS || normUrl(location.href) !== normUrl(last.url)) return;
    if (navStartedAt >= last.at) return; // Cú bấm đã mở link (file đang tải chậm) → không mở lại
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
    note(`tin ${msg.type} ${msg.jobId === job?.id ? 'khớp' : `lệch (job=${job?.id || 'chưa có'}, loaded=${jobLoaded})`}`);
    if (!jobLoaded && (msg.type === 'va:dlComplete' || msg.type === 'va:dlFailed')) doneBeforeLoad = msg.jobId;
    if (!job || msg.jobId !== job.id) return;
    if (msg.type === 'va:dlStarted') {
      job.dlStarted = true;
      saveJob();
    } else if (msg.type === 'va:dlComplete' || msg.type === 'va:dlFailed') {
      finishJob(msg.type === 'va:dlComplete' ? 'đã tải xong' : `tải lỗi: ${msg.error || ''}`);
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
      ends,
      trace,
      url: location.href,
      readyState: document.readyState,
      settled: pageSettled(),
      hidden: document.hidden,
      downloadKeys: findButtons(RX.download).slice(0, 4).map((el) => ({
        key: dlKey(el), old: isOld(el, dlKey(el)), underDialog: !isUncovered(el) && underDialog(el),
      })),
      scan: { precrop: !!scan.precropHeading, busyLabels: [...scan.busyLabels], busyWord: scan.busyWord, busyModal: scan.busyModal },
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
    // Cửa sổ đang thu nhỏ/ẩn: nếu không còn ảnh nào khác chờ thì đợi tới khi mở lên (không huỷ vì quá
    // giờ); còn ảnh khác chờ thì vẫn có giới hạn, để một ảnh hỏng không chặn cả hàng.
    const hidden = document.hidden;
    const othersWaiting = queueCount - (job?.itemId != null ? 1 : 0) > 0;
    // Lúc ẩn: bảng xử lý đã hiện rồi đóng trên trang này, không còn bảng nào mở, mà chưa thấy kết quả → trang
    // chỉ chờ được vẽ (cửa sổ mở lên). Không bỏ ảnh này vì quá giờ; mở cửa sổ lên thì tính giờ lại như thường.
    const awaitingPaint = hidden && !!job && job.stage === 'waiting' && sawBusyHere && !scan.busyModal
      && !scan.precropHeading && !(job.feed && !job.feed.ok)
      && ![...document.querySelectorAll(DIALOG_COVER_SEL)].some(isVisible);
    if (job && (!hidden || (othersWaiting && !awaitingPaint)) && Date.now() - job.startedAt > JOB_TTL_MS) finishJob('quá 10 phút');
    if (job && !job.leftStart && normUrl(location.href) !== job.startUrl) {
      job.leftStart = true;
      saveJob();
    }
    if (scan.busyModal !== lastBusy) { lastBusy = scan.busyModal; note(`bảng xử lý ${lastBusy ? 'hiện' : 'đóng'}`); }
    if (job && scan.busyModal) {
      sawBusyHere = true;
      const paths = job.busyPaths || [];
      const onStart = normUrl(location.href) === job.startUrl;
      if (!job.sawBusy || !paths.includes(location.pathname) || (onStart && !job.busyOnStart)) {
        job.sawBusy = true;
        job.busyPaths = [...paths, location.pathname].filter((p, i, a) => a.indexOf(p) === i).slice(-10);
        if (onStart) job.busyOnStart = true;
        saveJob();
      }
    }
    if (settings.autoPrecrop) handlePrecrop();
    // Đã bấm mà chưa có file: hết hạn sau DOWNLOAD_CONFIRM_MS tính từ lần bấm cuối. Lúc ẩn: chờ tới khi
    // mở lên, hoặc tối đa HIDDEN_DL_CAP_MS nếu còn ảnh khác chờ.
    if (job && job.stage === 'downloading') {
      const limit = !hidden ? DOWNLOAD_CONFIRM_MS : othersWaiting ? HIDDEN_DL_CAP_MS : Infinity;
      if (Date.now() - job.clickedAt > limit) finishJob('bấm rồi mà không có file');
    }
    if (job) checkMiss();
    // Còn tiến triển: có bảng Pre-Crop / bảng xử lý, đang đưa ảnh vào, đã bấm tải… (cửa sổ ẩn không tính:
    // các dấu hiệu trên vẫn thấy được lúc ẩn, nên ảnh hỏng vẫn bị bỏ để hàng chờ chạy tiếp).
    if (job && (scan.precropHeading || scan.busyModal || job.stage === 'downloading'
      || (job.feed && !job.feed.ok))) progressAt = Date.now();
    // Lưu mốc đó kèm việc (vài giây một lần) để sang trang khác vẫn biết ảnh đã đứng yên bao lâu.
    if (job && progressAt - (job.progressAt || 0) > 2000) {
      job.progressAt = progressAt;
      saveJob();
    }
    // Đứng yên quá lâu thì bỏ. Lúc ẩn chỉ bỏ khi còn ảnh khác chờ (để hàng chờ chạy tiếp): trang ẩn có thể chỉ
    // hiện kết quả khi cửa sổ mở lên, ảnh duy nhất thì cứ đợi.
    if (job && job.stage === 'waiting' && (!hidden || (othersWaiting && !awaitingPaint)) && Date.now() - progressAt > STALL_MS) {
      finishJob('đứng yên quá lâu');
    }
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
