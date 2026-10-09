// Chạy trên trang web: tự bấm OK ở bảng Pre-Crop, chờ bảng Upload/Process/Fetch xong,
// tự bấm DOWNLOAD và bấm tiếp nút Download ở trang tải về.
//
// Chỉ tự động khi có "việc" (job): job bắt đầu khi bạn kéo/thả, chọn hoặc dán ảnh, hay khi
// bảng Pre-Crop / bảng Upload-Process-Fetch hiện ra. Nhờ vậy mở lại ảnh cũ hay tải lại
// trang sẽ không bị tải trùng. Job lưu ở background theo tab nên vẫn còn khi trang chuyển
// sang trang kết quả. Bạn bấm CANCEL / đóng / Esc thì job dừng.
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

  // ---------- Cài đặt ----------
  chrome.storage.sync.get(VA.DEFAULTS).then((s) => { settings = s; }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
  });

  // ---------- Job ----------
  // Việc đang làm được lưu ở background theo tab, nên vẫn còn khi trang chuyển đi.
  chrome.runtime.sendMessage({ type: 'va:job:get' }).then((j) => {
    if (jobLoaded) return; // Trong lúc chờ bạn đã thả ảnh mới
    jobLoaded = true;
    if (j && Date.now() - j.startedAt < JOB_TTL_MS) job = j;
    else if (j) saveJob();
  }).catch(() => { jobLoaded = true; });

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
    stoppedAt = 0;
    busyAfterStop = false;
    saveJob();
    status('📥 Đã nhận ảnh');
  }

  function finishJob() {
    job = null;
    saveJob();
  }

  function stopJob() {
    finishJob();
    stoppedAt = Date.now();
    busyAfterStop = true;
    precropAttempts = MAX_PRECROP_CLICKS; // Không bấm OK lại cho bảng đang mở
    status('⏹ Đã dừng', 'info', false);
  }

  function filesOf(dt) {
    return dt && dt.files && dt.files.length ? [...dt.files] : [];
  }

  // Bắt sự kiện ở pha capture để chạy trước code của trang.
  listen(window, 'drop', (e) => {
    const files = filesOf(e.dataTransfer);
    if (files.length) startJob(files[0].name);
  });
  listen(window, 'paste', (e) => {
    const files = filesOf(e.clipboardData);
    if (files.length) startJob(files[0].name || 'ảnh dán');
  });
  listen(document, 'change', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'file' && t.files && t.files.length) {
      startJob(t.files[0].name);
    }
  });

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
    status('✅ Đã bấm OK');
  }

  // ---------- Bước 2: có kết quả → bấm DOWNLOAD ----------
  // Bấm DOWNLOAD ở trang kết quả sẽ mở trang "Download" (chọn SVG/PDF…), ở đó lại có
  // nút Download để tải file thật. Mỗi nút (theo địa chỉ trang + link) chỉ bấm một lần.
  async function handleDownload() {
    const now = Date.now();
    const el = findDownloadButton();
    const busy = scan.busyModal || !!scan.precropHeading;
    const uncovered = !!el && isUncovered(el);
    if (!el || uncovered) coveredSince = 0;
    let wait = null; // Lý do còn chờ, hiện lên thông báo
    if (!el) wait = 'result';
    else if (busy) wait = 'busy';
    else if (!isEnabled(el)) wait = 'locked';
    else if (!uncovered) {
      // Có vẻ bị che nhưng không có bảng nào đang hiện: chờ thêm chút rồi vẫn bấm.
      if (!coveredSince) coveredSince = now;
      if (now - coveredSince < COVERED_GRACE_MS) wait = 'busy';
    }

    if (wait) {
      readySince = 0;
      if (!notReadySince) notReadySince = now;
      if (now - notReadySince > 500) sawNotReady = true;
      if (job.stage === 'waiting') {
        status(wait === 'result' ? '⏳ Chờ kết quả…' : wait === 'busy' ? '⏳ Chờ xử lý xong…'
          : '⏳ Chờ nút DOWNLOAD…', 'info', true);
      }
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
    if (job.startDlKey && job.startDlKey === key && !sawNotReady) {
      status('⏳ Chờ kết quả…', 'info', true);
      return;
    }

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
    status('⬇️ Đang tải…', 'info', true);
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
      sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
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
    } else if (msg.type === 'va:dlComplete') {
      finishJob();
      status('✅ Đã tải xong', 'ok');
    } else if (msg.type === 'va:dlFailed') {
      finishJob();
      status('⚠️ Tải lỗi, hãy bấm Download lại', 'warn');
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
    if (!settings.enabled || !document.body) {
      if (statusSticky) status('');
      return;
    }
    scan = scanPage();
    if (!scan.busyModal) busyAfterStop = false;
    if (job && Date.now() - job.startedAt > JOB_TTL_MS) finishJob();
    if (settings.autoPrecrop) handlePrecrop();
    // Bảng tiến trình hiện ra giữa chừng mà chưa có job (vd. tải ảnh bằng cách khác) → nhận việc.
    // Bảng hiện ngay lúc vừa mở trang (mở lại ảnh cũ, tải lại trang) thì không tính.
    if (!job && jobLoaded && scan.busyModal && !busyAfterStop && Date.now() - startedAt > 3000
      && Date.now() - stoppedAt > STOP_COOLDOWN_MS) startJob('ảnh');
    if (job && job.stage === 'downloading' && Date.now() - job.clickedAt > DOWNLOAD_CONFIRM_MS) {
      finishJob();
      status('⚠️ Chưa thấy file về', 'warn');
    }
    if (job && settings.autoDownload) {
      handleFallback();
      handleDownload();
    }
    if (!job && statusSticky) status('');
  }

  function stop() {
    ac.abort();
    clearInterval(interval);
    observer.disconnect();
    toastHost?.remove();
  }
  globalThis.__autoClickStop = stop;

  function safeTick() {
    if (!chrome.runtime?.id) return stop(); // Extension vừa được cập nhật/gỡ → dừng bản cũ
    try { tick(); } catch (e) { console.debug('[Auto Click]', e); }
  }

  // ---------- Thông báo nhỏ trên trang ----------
  // sticky = true: giữ nguyên tới khi có thông báo khác (dùng lúc đang chờ / đang tải).
  let toastHost = null;
  let toastBox = null;
  let toastTimer = 0;
  let statusSticky = false;

  function status(msg, kind = 'info', sticky = false) {
    if (!msg || !settings.showToast) {
      if (toastBox) toastBox.classList.remove('show');
      statusSticky = false;
      return;
    }
    if (!toastHost || !toastHost.isConnected) {
      document.getElementById('ac-toast')?.remove();
      toastHost = document.createElement('div');
      toastHost.id = 'ac-toast';
      toastHost.style.cssText = 'all:initial;position:fixed;left:16px;bottom:16px;'
        + 'z-index:2147483647;pointer-events:none;';
      const root = toastHost.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        .t{font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;background:#1f2937;
          padding:8px 12px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.25);max-width:360px;
          opacity:0;transform:translateY(6px);transition:opacity .2s,transform .2s}
        .t.show{opacity:.95;transform:none}
        .t.ok{background:#047857}.t.warn{background:#b45309}
      </style><div class="t"></div>`;
      toastBox = root.querySelector('.t');
      document.documentElement.appendChild(toastHost);
    }
    statusSticky = sticky;
    if (toastBox.textContent !== msg || !toastBox.classList.contains('show')) {
      toastBox.textContent = msg;
      toastBox.className = `t show ${kind}`;
    }
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => toastBox.classList.remove('show'), kind === 'warn' ? 8000 : 3000);
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; safeTick(); }, 150);
  });
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, characterData: true,
  });
  const interval = setInterval(safeTick, 700);

  safeTick();
})();
