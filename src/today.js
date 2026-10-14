// Kết nối hệ thống Today: đăng nhập bằng tài khoản Today (Firebase Authentication) và đọc/ghi
// Realtime Database qua REST — cùng máy chủ, cùng mô hình dữ liệu với Today POD Studio v6
// (users/{uid}, admins/{uid}), thêm nhánh riêng apps/autoclick cho ứng dụng này.
// Dùng được cả ở service worker (importScripts) lẫn trang của extension (<script>).
(() => {
  const APP = 'autoclick';
  const SESSION_KEY = 'todaySession';
  const BASE = {
    authBase: 'https://identitytoolkit.googleapis.com',
    tokenBase: 'https://securetoken.googleapis.com',
    dbNamespace: '',
    ...globalThis.TODAY_CONFIG,
  };

  // Máy chủ thử nghiệm (Firebase Emulator trên chính máy này): chỉ nhận địa chỉ 127.0.0.1/localhost,
  // để không ai trỏ extension sang máy chủ khác nhằm né quyền quản trị.
  const isLocal = (u) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(u || '');
  async function cfg() {
    let over = null;
    try { ({ todayServer: over = null } = await chrome.storage.local.get('todayServer')); } catch {}
    if (over && ['authBase', 'tokenBase', 'databaseURL'].every((k) => isLocal(over[k]))) return { ...BASE, ...over };
    return BASE;
  }

  class TodayError extends Error {
    constructor(code, detail = '') {
      super(detail ? `${code}: ${detail}` : code);
      this.code = code;
    }
  }

  // Lỗi đăng nhập của Firebase → mã ngắn để hiện chữ tiếng Việt.
  function authCode(msg = '') {
    if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL/.test(msg)) return 'wrong-credentials';
    if (/USER_DISABLED/.test(msg)) return 'user-disabled';
    if (/TOO_MANY_ATTEMPTS/.test(msg)) return 'too-many-attempts';
    if (/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND|INVALID_ID_TOKEN/.test(msg)) return 'session-expired';
    if (/API_KEY|API key/i.test(msg)) return 'not-configured';
    return 'auth-error';
  }

  async function post(url, body, form = false) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
        body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
      });
    } catch (e) {
      throw new TodayError('network', String(e));
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new TodayError(authCode(data?.error?.message), data?.error?.message || `HTTP ${res.status}`);
    return data;
  }

  const toEmail = (name, c) => (name.includes('@') ? name : `${name}@${c.emailDomain}`).trim().toLowerCase();

  async function session() {
    return (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY] || null;
  }

  async function signIn(username, password) {
    const c = await cfg();
    if (!c.apiKey) throw new TodayError('not-configured');
    const name = String(username || '').trim();
    if (!name || !password) throw new TodayError('wrong-credentials');
    const email = toEmail(name, c);
    const r = await post(`${c.authBase}/v1/accounts:signInWithPassword?key=${encodeURIComponent(c.apiKey)}`,
      { email, password, returnSecureToken: true });
    const s = {
      uid: r.localId, email, username: name.includes('@') ? name.split('@')[0] : name,
      idToken: r.idToken, refreshToken: r.refreshToken,
      expiresAt: Date.now() + Number(r.expiresIn || 3600) * 1000,
    };
    await chrome.storage.local.set({ [SESSION_KEY]: s });
    return s;
  }

  async function signOut() {
    await chrome.storage.local.remove(SESSION_KEY);
  }

  // Token còn hạn thì dùng, sắp hết thì làm mới. Phiên bị thu hồi (admin xoá/khoá tài khoản Auth) → đăng xuất.
  let refreshing = null;
  async function idToken() {
    const s = await session();
    if (!s) throw new TodayError('not-signed-in');
    if (s.expiresAt - Date.now() > 2 * 60 * 1000) return { s, token: s.idToken };
    refreshing ??= (async () => {
      const c = await cfg();
      try {
        const r = await post(`${c.tokenBase}/v1/token?key=${encodeURIComponent(c.apiKey)}`,
          { grant_type: 'refresh_token', refresh_token: s.refreshToken }, true);
        const next = { ...s, idToken: r.id_token, refreshToken: r.refresh_token,
          expiresAt: Date.now() + Number(r.expires_in || 3600) * 1000 };
        await chrome.storage.local.set({ [SESSION_KEY]: next });
        return next;
      } catch (e) {
        if (e.code !== 'network') await signOut();
        throw e.code === 'network' ? e : new TodayError('not-signed-in', e.message);
      }
    })().finally(() => { refreshing = null; });
    const next = await refreshing;
    return { s: next, token: next.idToken };
  }

  async function db(method, path, body) {
    const c = await cfg();
    const { token } = await idToken();
    const q = new URLSearchParams({ auth: token });
    if (c.dbNamespace) q.set('ns', c.dbNamespace);
    let res;
    try {
      res = await fetch(`${c.databaseURL}/${path}.json?${q}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new TodayError('network', String(e));
    }
    if (res.status === 401 || res.status === 403) throw new TodayError('permission-denied', path);
    if (!res.ok) throw new TodayError(`http-${res.status}`, path);
    return res.json();
  }
  const get = (path) => db('GET', path);
  const getOrNull = (path) => get(path).catch((e) => { if (e.code === 'permission-denied') return null; throw e; });

  function cmpVersion(a, b) {
    const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  // Kiểm tra quyền dùng Auto Click của tài khoản đang đăng nhập (máy chủ quyết định):
  // tài khoản Today còn hoạt động và còn hạn, ứng dụng đang bật cho cả đội, phiên bản đủ mới,
  // và admin không chặn người này. Lỗi mạng ném ra 'network' để nơi gọi tự xử lý.
  async function checkAccess() {
    const c = await cfg();
    const version = chrome.runtime.getManifest().version;
    if (!c.apiKey) return { allowed: false, reason: 'not-configured' };
    const s = await session();
    if (!s) return { allowed: false, reason: 'not-signed-in' };
    let profile;
    try {
      profile = await get(`users/${s.uid}`);
    } catch (e) {
      if (e.code === 'not-signed-in' || e.code === 'session-expired') return { allowed: false, reason: 'not-signed-in' };
      if (e.code === 'permission-denied') return { allowed: false, reason: 'no-profile' };
      throw e;
    }
    const user = {
      uid: s.uid, username: profile?.username || s.username, displayName: profile?.displayName || s.username,
      role: profile?.role || '', expiresAt: profile?.expiresAt || null, isAdmin: false,
    };
    if (!profile) return { allowed: false, reason: 'no-profile', user };
    if (profile.status !== 'active') return { allowed: false, reason: 'locked', user };
    if (profile.expiresAt && Number(profile.expiresAt) < Date.now()) return { allowed: false, reason: 'expired', user };
    const [isAdmin, conf, grant] = await Promise.all([
      getOrNull(`admins/${s.uid}`),
      getOrNull(`apps/${APP}/config`),
      getOrNull(`apps/${APP}/access/${s.uid}`),
    ]);
    user.isAdmin = isAdmin === true;
    const config = conf || {};
    const base = { user, message: typeof config.message === 'string' ? config.message : '' };
    if (config.enabled === false) return { ...base, allowed: false, reason: 'disabled' };
    if (config.minVersion && cmpVersion(version, config.minVersion) < 0) {
      return { ...base, allowed: false, reason: 'outdated', minVersion: config.minVersion };
    }
    const allowed = grant === true || (grant !== false && config.defaultAllow !== false);
    // Báo máy chủ là máy này còn dùng (cho trang quản trị); lỗi thì bỏ qua.
    db('PATCH', `apps/${APP}/usage/${s.uid}`, { lastSeen: { '.sv': 'timestamp' }, version }).catch(() => {});
    return { ...base, allowed, reason: allowed ? 'ok' : grant === false ? 'blocked' : 'not-granted', verifiedAt: Date.now() };
  }

  // Đếm số file đã tải (cho trang quản trị).
  async function reportDownload() {
    const s = await session();
    if (!s) return null;
    const day = new Date().toLocaleDateString('sv'); // YYYY-MM-DD theo giờ máy
    return db('PATCH', `apps/${APP}/usage/${s.uid}`, {
      total: { '.sv': { increment: 1 } },
      [`days/${day}`]: { '.sv': { increment: 1 } },
      lastAt: { '.sv': 'timestamp' },
      version: chrome.runtime.getManifest().version,
    }).catch(() => null);
  }

  // ---------- Dành cho quản trị (rules chỉ cho admin làm các việc này) ----------
  const admin = {
    async overview() {
      const [users, access, usage, config] = await Promise.all([
        get('users'), get(`apps/${APP}/access`), get(`apps/${APP}/usage`), get(`apps/${APP}/config`),
      ]);
      return { users: users || {}, access: access || {}, usage: usage || {}, config: config || {} };
    },
    // value: true (cho phép), false (chặn), null (theo mặc định của cả đội)
    setAccess: (uid, value) => (value === null
      ? db('DELETE', `apps/${APP}/access/${uid}`) : db('PUT', `apps/${APP}/access/${uid}`, value === true)),
    setConfig: (patch) => db('PATCH', `apps/${APP}/config`, patch),
    setStatus: (uid, status) => db('PATCH', `users/${uid}`, { status }),
    setExpiry: (uid, expiresAt) => (expiresAt
      ? db('PATCH', `users/${uid}`, { expiresAt }) : db('DELETE', `users/${uid}/expiresAt`)),
    // Tạo tài khoản Today mới (như Today v6: admin tạo bằng REST signUp, không giữ token của người mới).
    async createMember({ username, displayName, password, role, expiresAt }) {
      const c = await cfg();
      const name = String(username || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,40}$/.test(name)) throw new TodayError('bad-username');
      if (String(password || '').length < 6) throw new TodayError('weak-password');
      const r = await post(`${c.authBase}/v1/accounts:signUp?key=${encodeURIComponent(c.apiKey)}`,
        { email: toEmail(name, c), password, returnSecureToken: false })
        .catch((e) => { throw /EMAIL_EXISTS/.test(e.message) ? new TodayError('username-taken') : e; });
      const profile = {
        username: name, displayName: String(displayName || name).slice(0, 60), role: role || 'designer',
        status: 'active', createdAt: { '.sv': 'timestamp' },
      };
      if (expiresAt) profile.expiresAt = expiresAt;
      await db('PUT', `users/${r.localId}`, profile);
      return r.localId;
    },
  };

  // Chữ hiện cho người dùng (gom một chỗ).
  const TEXT = {
    reasons: {
      ok: 'Được phép sử dụng',
      offline: 'Mất kết nối máy chủ — dùng tạm theo lần kiểm tra trước',
      'not-configured': 'Chưa kết nối máy chủ Today. Liên hệ quản trị.',
      'not-signed-in': 'Chưa đăng nhập tài khoản Today',
      'no-profile': 'Tài khoản chưa được cấp trong hệ thống Today',
      locked: 'Tài khoản Today đang bị khoá',
      expired: 'Tài khoản Today đã hết hạn',
      disabled: 'Quản trị đang tạm tắt Auto Click cho cả đội',
      outdated: 'Cần cập nhật Auto Click lên bản mới',
      blocked: 'Quản trị đã chặn bạn dùng Auto Click',
      'not-granted': 'Chưa được quản trị cấp quyền dùng Auto Click',
      error: 'Không kiểm tra được quyền. Thử lại sau.',
    },
    errors: {
      'wrong-credentials': 'Sai tên đăng nhập hoặc mật khẩu',
      'user-disabled': 'Tài khoản đã bị vô hiệu hoá',
      'too-many-attempts': 'Thử sai quá nhiều lần, đợi một lúc rồi thử lại',
      'not-configured': 'Chưa kết nối máy chủ Today. Liên hệ quản trị.',
      network: 'Không kết nối được máy chủ. Kiểm tra mạng.',
      'permission-denied': 'Không có quyền làm việc này',
      'username-taken': 'Tên đăng nhập đã có người dùng',
      'bad-username': 'Tên đăng nhập chỉ gồm chữ thường không dấu, số, dấu . _ - (2–40 ký tự)',
      'weak-password': 'Mật khẩu cần ít nhất 6 ký tự',
    },
    roles: { full: 'Toàn quyền', designer: 'Thiết kế', publisher: 'Đăng hình' },
  };
  const errorText = (e) => TEXT.errors[e?.code] || `Có lỗi xảy ra (${e?.code || e})`;

  globalThis.TodayClient = {
    APP, cfg, session, signIn, signOut, checkAccess, reportDownload, admin, TEXT, errorText, TodayError,
  };
})();
