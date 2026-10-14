// Ứng dụng giả lập trên mã HTML thật (app.html). Chế độ trong localStorage 'appMode' (JSON):
//  procMs  thời gian bảng Upload/Process/Fetch hiện (mặc định 7000)
//  upMs    tải lên xong sau bấy lâu → địa chỉ đổi thành /images/<tok>/edit (pushState), mặc định 1500
//  pill    'reuse' (một nút DOWNLOAD dùng cho mọi ảnh trong trang) | 'rebuild' (nút mới cho mỗi kết quả)
//  href    'hash' (nút "#", script tự chuyển trang) | 'real' (nút có link thật /images/<tok> khi có kết quả)
//  show    'during' (nút hiện dưới bảng xử lý, như ảnh u04) | 'after' (chỉ hiện khi có kết quả)
//          | 'raf' (hiện bằng requestAnimationFrame khi có kết quả: cửa sổ ẩn thì chưa hiện)
//  gapMs   bảng xử lý đóng rồi bấy lâu nút mới hiện
//  fail    true → xử lý xong hiện bảng Error, nút giữ nguyên (link của ảnh trước)
//  dlview  true → trang chủ đang hiện trang Download của ảnh trước (nút "#"), lớp ứng dụng phủ lên khi thả ảnh mới
//  resultRaf  true → kết quả (trạng thái + nút) chỉ được dựng trong requestAnimationFrame (cửa sổ ẩn thì chưa có)
//  bsDismiss  true → bấm ra ngoài bảng thì bảng đóng (mặc định của Bootstrap 3)
//  toolbarNav true → nút DOWNLOAD trên thanh công cụ (#App-DownloadLink, "#") mở trang Download của kết quả đang hiện
//  hang    tên ảnh (một phần) → ảnh đó xử lý mãi không xong; hangAccept: trang đang treo vẫn nhận ảnh mới
// Bấm DOWNLOAD lúc đang xử lý: web bỏ qua (preventDefault) như nút "#" của web thật.
(() => {
  const o = Object.assign({ procMs: 7000, upMs: 1500, pill: 'reuse', href: 'hash', show: 'during', gapMs: 0, fail: false, dlview: false, bsDismiss: false, toolbarNav: false, hang: null, hangAccept: false },
    JSON.parse(localStorage.getItem('appMode') || '{}'));
  const log = (m) => { try { navigator.sendBeacon('/log', `${(performance.now() / 1000).toFixed(1)} ${location.pathname} ${m}`); } catch (e) {} };
  const $ = (id) => document.getElementById(id);
  const app = $('App-App');
  const pane = $('App-ImageView-Pane');
  const pre = $('PreCrop-App');
  const dlg = $('App-Progress-Dialog');
  const err = $('App-Error-Dialog');
  const st = { processing: false, tok: null, hung: false };
  let pill = null;
  let backdrop = null;
  const tokOf = (name) => `${Date.now()}-${encodeURIComponent(name)}`;

  function buildPill() {
    if (pill) pill.remove();
    pill = document.createElement('a');
    pill.id = 'Pill';
    pill.className = 'Viewer-blue_button Viewer-button_base off'; // Hiện bằng showPill()
    pill.href = '#';
    pill.innerHTML = '<span class="bttn_icon_left"><img alt="Download icon" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></span><span>&nbsp;&nbsp;DOWNLOAD</span>';
    pill.addEventListener('click', (e) => {
      log(`pill-click trusted=${e.isTrusted} processing=${st.processing} href=${pill.getAttribute('href')}`);
      if (st.processing) { e.preventDefault(); return; } // Đang xử lý: web không làm gì
      if (pill.getAttribute('href') === '#') { e.preventDefault(); log(`pill-nav tok=${st.tok}`); if (st.tok) location.href = `/images/${st.tok}`; }
    });
    pane.appendChild(pill);
  }
  function showPill(on) {
    if (!on) { pill.classList.add('off'); return; }
    if (o.show === 'raf') requestAnimationFrame(() => pill.classList.remove('off'));
    else pill.classList.remove('off');
  }
  function setResult(tok) {
    st.tok = tok;
    if (!pill || o.pill === 'rebuild') buildPill();
    pill.setAttribute('href', o.href === 'real' ? `/images/${tok}` : '#');
    showPill(true);
  }
  function modal(el, on) {
    el.classList.toggle('in', on);
    if (on && !backdrop) { backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop in'; document.body.appendChild(backdrop); }
    if (!on && backdrop) { backdrop.remove(); backdrop = null; }
  }

  // Mở thẳng trang kết quả của một ảnh (ảnh đã xong): hiện kết quả, không có bảng xử lý.
  const m = location.pathname.match(/^\/images\/([^/]+)\/edit$/);
  if (m) { app.classList.add('on'); setResult(m[1]); log('editor opened'); }
  if (o.dlview && !m) {
    const oldTok = tokOf('old.png');
    $('dlview').hidden = false;
    $('OldDownload').addEventListener('click', (e) => {
      e.preventDefault();
      log('OLD-download-click');
      location.href = `/download/${oldTok}`;
    });
  }

  let pending = null;
  function onFile(f) {
    if (!f) return;
    if (st.hung && !o.hangAccept) { log(`HUNG-ignored ${f.name}`); return; }
    if (st.hung) { log(`HUNG-accepted-new ${f.name}`); st.hung = false; }
    pending = f.name;
    if (/big/.test(f.name)) { pre.classList.add('shown'); log(`precrop ${f.name}`); } else run(f.name);
  }
  pre.querySelector('.PreCrop-Sidebar-crop_button').addEventListener('click', () => {
    pre.classList.remove('shown');
    log('precrop ok');
    run(pending);
  });
  for (const b of pre.querySelectorAll('.PreCrop-Sidebar-cancel_button')) b.addEventListener('click', () => pre.classList.remove('shown'));

  let timers = [];
  function run(name) {
    timers.forEach(clearTimeout); timers = [];
    app.classList.add('on');
    st.processing = true;
    modal(dlg, true);
    if (o.show === 'during') { if (!pill) buildPill(); showPill(true); } else if (pill) showPill(false);
    const tok = tokOf(name);
    log(`processing ${name}`);
    timers.push(setTimeout(() => { history.pushState(null, '', `/images/${tok}/edit`); log('upload done'); }, o.upMs));
    if (o.hang && name.includes(o.hang)) { st.hung = true; log(`HANG ${name}`); return; } // Bảng xử lý không bao giờ đóng
    timers.push(setTimeout(() => {
      st.processing = false;
      modal(dlg, false);
      if (o.fail) { modal(err, true); $('App-Error-Message').textContent = 'Could not process image'; log('ERROR dialog'); return; }
      const done = () => { setResult(tok); log(`result href=${pill.getAttribute('href')}`); };
      // resultRaf: the result view (state + pill) is rendered in requestAnimationFrame (no frames while minimized).
      const later = o.resultRaf ? () => requestAnimationFrame(done) : done;
      if (o.gapMs) timers.push(setTimeout(later, o.gapMs)); else later();
    }, o.procMs));
  }
  function cancelRun(why) { timers.forEach(clearTimeout); timers = []; st.processing = false; modal(dlg, false); log(`cancel (${why}) tok=${st.tok}`); }
  dlg.querySelector('.App-cancel_upload').addEventListener('click', () => cancelRun('button'));
  // Bootstrap 3 default (backdrop: true): a click on the .modal itself (outside .modal-dialog) hides it.
  if (o.bsDismiss) {
    dlg.addEventListener('click', (e) => { if (e.target === dlg) cancelRun(`backdrop trusted=${e.isTrusted}`); });
    err.addEventListener('click', (e) => { if (e.target === err) { modal(err, false); log(`error dismissed trusted=${e.isTrusted}`); } });
  }
  if (o.toolbarNav) {
    $('App-DownloadLink').addEventListener('click', (e) => {
      log(`toolbar-click trusted=${e.isTrusted} processing=${st.processing} tok=${st.tok}`);
      e.preventDefault();
      if (!st.processing && st.tok) location.href = `/images/${st.tok}`;
    });
  }
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); });
  $('FileInput-Field').addEventListener('change', (e) => onFile(e.target.files[0]));
})();
