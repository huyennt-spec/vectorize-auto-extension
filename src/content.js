// Chạy trên vectorizer.ai: tự bấm OK ở bảng Pre-Crop và tự bấm DOWNLOAD khi có kết quả.
//
// Chỉ tự động khi có "việc" (job): job bắt đầu khi bạn kéo/thả, chọn hoặc dán ảnh,
// hay khi bảng Pre-Crop hiện ra. Nhờ vậy mở lại ảnh cũ hay tải lại trang sẽ không
// bị tải trùng. Job lưu trong sessionStorage nên vẫn còn khi trang chuyển sang
// trang kết quả.
(() => {
  'use strict';
  if (globalThis.__vectorizerAutoLoaded) return;
  globalThis.__vectorizerAutoLoaded = true;

  const JOB_KEY = 'vectorizerAuto.job';
  const JOB_TTL_MS = 10 * 60 * 1000;     // Bỏ job nếu quá 10 phút chưa có kết quả
  const STABLE_MS = 800;                 // Nút phải sẵn sàng liên tục bấy lâu mới bấm
  const DOWNLOAD_CONFIRM_MS = 30 * 1000; // Chờ file tải về tối đa bấy lâu sau khi bấm
  const MAX_CLICKS = 3;                  // Số lần bấm "Download" tối đa cho mỗi ảnh
  const RETURN_DELAY_MS = 1500;          // Tải xong chờ bấy lâu rồi quay về trang chính
  const BUSY_MAX_MS = 60 * 1000;         // Bỏ qua dấu hiệu "đang xử lý" nếu kéo dài quá lâu

  const RX = {
    download: /^(download|tải xuống|tải về)$/,
    ok: /^(ok|đồng ý)$/,
    precrop: /pre-?\s?crop/i,
    busy: /^(uploading|vectorizing|processing|loading|đang tải lên|đang xử lý)\b/,
  };
  const CLICKABLE_SEL =
    'button, a[href], [role="button"], input[type="button"], input[type="submit"]';

  let settings = { ...VA.DEFAULTS };
  let job = loadJob();
  let readySince = 0;      // Lúc nút DOWNLOAD bắt đầu sẵn sàng
  let notReadySince = 0;   // Lúc nút DOWNLOAD bắt đầu không sẵn sàng
  let sawNotReady = false; // Đã thấy nút DOWNLOAD biến mất/bị khoá kể từ lúc bắt đầu job
  let precropAttempts = 0;
  let lastPrecropClickAt = 0;
  let returnTimer = 0;
  let toastHost = null;
  let toastBox = null;
  let toastTimer = 0;

  // ---------- Cài đặt ----------
  chrome.storage.sync.get(VA.DEFAULTS).then((s) => { settings = s; }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
  });

  // ---------- Job ----------
  function loadJob() {
    try {
      const j = JSON.parse(sessionStorage.getItem(JOB_KEY));
      if (j && Date.now() - j.startedAt < JOB_TTL_MS) return j;
      sessionStorage.removeItem(JOB_KEY);
    } catch {}
    return null;
  }

  function saveJob() {
    try {
      if (job) sessionStorage.setItem(JOB_KEY, JSON.stringify(job));
      else sessionStorage.removeItem(JOB_KEY);
    } catch {}
  }

  function startJob(name) {
    if (!settings.enabled) return;
    cancelReturn();
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
    };
    readySince = 0;
    notReadySince = 0;
    sawNotReady = false;
    precropAttempts = 0;
    saveJob();
    toast(`📥 Đã nhận ${job.name}, đang chờ Vectorizer xử lý…`);
  }

  function finishJob() {
    job = null;
    saveJob();
  }

  function filesOf(dt) {
    return dt && dt.files && dt.files.length ? [...dt.files] : [];
  }

  // Bắt sự kiện ở pha capture để chạy trước code của trang.
  window.addEventListener('drop', (e) => {
    const files = filesOf(e.dataTransfer);
    if (files.length) startJob(files[0].name);
  }, true);
  window.addEventListener('paste', (e) => {
    const files = filesOf(e.clipboardData);
    if (files.length) startJob(files[0].name || 'ảnh dán');
  }, true);
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'file' && t.files && t.files.length) {
      startJob(t.files[0].name);
    }
  }, true);

  // ---------- Tìm & bấm nút ----------
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const ICONISH = 'i, svg, [aria-hidden="true"], [class*="icon" i], [class*="material-symbols" i]';

  // Chữ hiển thị trên nút, bỏ qua icon (vd. icon font kiểu "file_download").
  function textOf(el) {
    if (el instanceof HTMLInputElement) return norm(el.value);
    let s = '';
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = tw.nextNode(); t; t = tw.nextNode()) {
      const p = t.parentElement;
      const icon = p.closest(ICONISH);
      if (icon && icon !== el && el.contains(icon)) continue;
      if (p.checkVisibility && !p.checkVisibility()) continue;
      s += ` ${t.nodeValue}`;
    }
    return norm(s);
  }
  const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
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

  // Có lớp phủ nào (bảng, màn hình đang xử lý…) đè lên nút không?
  function isUncovered(el) {
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
    const top = document.elementFromPoint(x, y);
    return !top || top === el || el.contains(top);
  }

  const isReady = (el) => isVisible(el) && isEnabled(el) && isUncovered(el);

  function closestClickable(el) {
    for (let n = el, i = 0; n && n !== document.body && i < 6; n = n.parentElement, i++) {
      if (n.matches(CLICKABLE_SEL) || n.onclick || getComputedStyle(n).cursor === 'pointer') return n;
    }
    return null;
  }

  // Tìm các nút có chữ khớp hoàn toàn với rx; nút lồng nhau chỉ giữ nút ngoài cùng.
  function findButtons(rx, root = document.body) {
    if (!root) return [];
    const found = [];
    for (const el of root.querySelectorAll(CLICKABLE_SEL)) {
      if (rx.test(textOf(el))) found.push(el);
    }
    if (!found.length) {
      // Dự phòng: nút làm bằng <div>/<span> không có role.
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let t = tw.nextNode(); t; t = tw.nextNode()) {
        if (!rx.test(norm(t.nodeValue))) continue;
        const c = closestClickable(t.parentElement);
        if (c && !found.includes(c)) found.push(c);
      }
    }
    return found.filter((el) => !found.some((o) => o !== el && o.contains(el)));
  }

  function findDownloadButton() {
    const cands = findButtons(RX.download).filter(isVisible);
    if (!cands.length) return null;
    return cands.sort((a, b) => area(b) - area(a))[0]; // Nút to nhất là nút DOWNLOAD chính
  }

  // Trang còn hiện "Uploading…/Vectorizing…" hoặc thanh tiến trình → chưa xong.
  function isBusy() {
    for (const el of document.querySelectorAll('progress, [role="progressbar"]')) {
      if (isVisible(el)) return true;
    }
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.length <= 60 && RX.busy.test(norm(n.nodeValue))
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    for (let t = tw.nextNode(); t; t = tw.nextNode()) {
      if (isVisible(t.parentElement)) return true;
    }
    return false;
  }

  function dlKey(el) {
    const href = el instanceof HTMLAnchorElement ? el.href : '';
    return `${location.href}|${href}`;
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

  // ---------- Bước 1: bảng Pre-Crop → bấm OK ----------
  function findPrecropHeading() {
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (RX.precrop.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    for (let t = tw.nextNode(); t; t = tw.nextNode()) {
      // Chỉ lấy dòng tiêu đề ngắn, bỏ qua đoạn văn có nhắc chữ "pre-crop".
      if (norm(t.nodeValue).length <= 40 && isVisible(t.parentElement)) return t.parentElement;
    }
    return null;
  }

  function findOkNear(heading) {
    // Đi dần lên các khung cha, gặp nút OK nào gần tiêu đề nhất thì lấy.
    for (let n = heading.parentElement, i = 0; n && i < 15; n = n.parentElement, i++) {
      const ok = findButtons(RX.ok, n).find(isReady);
      if (ok) return ok;
      if (n === document.body) break;
    }
    return null;
  }

  function handlePrecrop() {
    const heading = findPrecropHeading();
    if (!heading) { precropAttempts = 0; return; }
    const ok = findOkNear(heading);
    if (!ok) return;
    if (!job) startJob('ảnh');
    // Bảng vẫn còn sau khi bấm thì thử lại, tối đa 3 lần.
    if (precropAttempts >= 3 || Date.now() - lastPrecropClickAt < 1500) return;
    precropAttempts++;
    lastPrecropClickAt = Date.now();
    realClick(ok);
    toast('✅ Đã tự bấm OK ở bảng Pre-Crop');
  }

  // ---------- Bước 2: có kết quả → bấm DOWNLOAD ----------
  // Bấm DOWNLOAD ở trang kết quả sẽ mở trang "Download" (chọn SVG/PDF…), ở đó lại có
  // nút Download để tải file thật. Mỗi nút (theo địa chỉ trang + link) chỉ bấm một lần.
  async function handleDownload() {
    const el = findDownloadButton();
    const now = Date.now();
    if (!el || !isReady(el)) {
      readySince = 0;
      if (!notReadySince) notReadySince = now;
      if (now - notReadySince > 500) sawNotReady = true;
      return;
    }
    notReadySince = 0;
    if (!readySince) readySince = now;
    if (now - readySince < STABLE_MS) return;
    if (now - readySince < BUSY_MAX_MS && isBusy()) return;
    const key = dlKey(el);
    const clicked = job.clickedKeys || [];
    if (clicked.includes(key) || clicked.length >= MAX_CLICKS) return;
    // Vẫn là nút DOWNLOAD của ảnh trước → chờ ảnh mới.
    if (job.startDlKey && job.startDlKey === key && !sawNotReady) return;

    const prev = { stage: job.stage, clickedAt: job.clickedAt };
    job.stage = 'downloading';
    job.clickedAt = now;
    job.clickedKeys = [...clicked, key];
    saveJob();
    const jobId = job.id;
    // Báo background trước khi bấm để nó nhận ra file tải về thuộc ảnh này.
    await Promise.race([
      chrome.runtime.sendMessage({ type: 'va:clicked', jobId, name: job.name }).catch(() => {}),
      new Promise((r) => setTimeout(r, 1000)),
    ]);
    if (!job || job.id !== jobId) return;
    if (!el.isConnected) { // Nút vừa bị vẽ lại → lần sau tìm lại
      Object.assign(job, prev, { clickedKeys: clicked });
      saveJob();
      readySince = 0;
      return;
    }
    realClick(el);
    toast(clicked.length ? '⬇️ Đã tự bấm Download ở trang tải về…' : '⬇️ Đã tự bấm DOWNLOAD…');
  }

  // ---------- Bước 3: tải xong → quay về trang chính ----------
  function scheduleReturn() {
    cancelReturn();
    returnTimer = setTimeout(() => {
      if (job) return; // Bạn đã thả ảnh mới trong lúc chờ
      location.assign(`${location.origin}/`);
    }, RETURN_DELAY_MS);
  }

  function cancelReturn() {
    clearTimeout(returnTimer);
    returnTimer = 0;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !job || msg.jobId !== job.id) return;
    if (msg.type === 'va:dlComplete') {
      finishJob();
      if (settings.enabled && settings.autoReturn) {
        toast(`✅ Đã tải xong ${msg.filename || ''}. Đang về trang chính để kéo ảnh tiếp…`, 'ok');
        scheduleReturn();
      } else {
        toast(`✅ Đã tải xong ${msg.filename || ''}`, 'ok');
      }
    } else if (msg.type === 'va:dlFailed') {
      finishJob();
      toast(`⚠️ Tải file bị lỗi (${msg.error || 'không rõ'}). Thử bấm DOWNLOAD lại.`, 'warn', 12000);
    }
  });

  // ---------- Vòng lặp ----------
  function tick() {
    if (!settings.enabled || !document.body) return;
    if (job && Date.now() - job.startedAt > JOB_TTL_MS) finishJob();
    if (settings.autoPrecrop) handlePrecrop();
    if (job && job.stage === 'downloading' && Date.now() - job.clickedAt > DOWNLOAD_CONFIRM_MS) {
      finishJob();
      toast('⚠️ Đã bấm DOWNLOAD nhưng chưa thấy file về. Xem biểu tượng tải xuống của trình duyệt '
        + '(có thể đang hỏi "Cho phép tải nhiều tệp").', 'warn', 12000);
    }
    if (job && settings.autoDownload) handleDownload();
  }

  function safeTick() {
    if (!chrome.runtime?.id) { // Extension vừa được cập nhật/tắt → dừng script cũ
      clearInterval(interval);
      observer.disconnect();
      return;
    }
    try { tick(); } catch (e) { console.debug('[Vectorizer Auto]', e); }
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

  // ---------- Thông báo nhỏ trên trang ----------
  function toast(msg, kind = 'info', ms = 5000) {
    if (!settings.showToast) return;
    if (!toastHost || !toastHost.isConnected) {
      toastHost = document.createElement('div');
      toastHost.id = 'vectorizer-auto-toast';
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
    toastBox.textContent = `Vectorizer Auto: ${msg}`;
    toastBox.className = `t show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastBox.classList.remove('show'), ms);
  }

  safeTick();
})();
