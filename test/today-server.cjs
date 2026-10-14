// Máy chủ Today giả lập cho bài thử: Firebase Emulator (Authentication + Realtime Database) chạy trên
// chính máy này, nạp đúng rules trong firebase/database.rules.json. Không đụng tới máy chủ thật.
// Cần firebase-tools (npm install, hoặc đặt FIREBASE_BIN) và Java.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// Cổng mặc định như firebase/firebase.json. Chạy nhiều bộ thử cùng lúc: đặt TODAY_EMU_PORT_BASE (vd. 9300)
// → auth = base, database = base+1, hub = base+2, logging = base+3.
const BASE_PORT = Number(process.env.TODAY_EMU_PORT_BASE) || 0;
const PORTS = BASE_PORT
  ? { auth: BASE_PORT, database: BASE_PORT + 1, hub: BASE_PORT + 2, logging: BASE_PORT + 3 }
  : { auth: 9099, database: 9000, hub: 4400, logging: 4500 };
const AUTH = `http://127.0.0.1:${PORTS.auth}`;
const DB = `http://127.0.0.1:${PORTS.database}`;
const PROJECT = 'demo-today';
const NS = `${PROJECT}-default-rtdb`;
const API_KEY = 'fake-api-key';
const RULES = path.resolve(__dirname, '../firebase/database.rules.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cấu hình đưa vào extension (storage.local.todayServer — extension chỉ nhận địa chỉ 127.0.0.1/localhost).
const SERVER = {
  apiKey: API_KEY,
  authBase: `${AUTH}/identitytoolkit.googleapis.com`,
  tokenBase: `${AUTH}/securetoken.googleapis.com`,
  databaseURL: DB,
  dbNamespace: NS,
};

async function isUp() {
  try {
    await fetch(`${AUTH}/`);
    await fetch(`${DB}/.json?ns=${NS}`);
    return true;
  } catch {
    return false;
  }
}

let child = null;
function stop() {
  if (!child) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  child = null;
}

async function start() {
  if (await isUp()) return;
  const bin = process.env.FIREBASE_BIN || path.resolve(__dirname, '../node_modules/.bin/firebase');
  if (!fs.existsSync(bin)) throw new Error('Thiếu firebase-tools: chạy npm install (hoặc đặt FIREBASE_BIN)');
  const env = { ...process.env };
  // Emulator chạy hoàn toàn trên máy này: bỏ proxy để CLI và Java không đi vòng ra ngoài.
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'JAVA_TOOL_OPTIONS']) delete env[k];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'today-emu-'));
  const host = '127.0.0.1';
  fs.writeFileSync(path.join(dir, 'firebase.json'), JSON.stringify({
    database: { rules: RULES },
    emulators: {
      auth: { host, port: PORTS.auth }, database: { host, port: PORTS.database },
      hub: { host, port: PORTS.hub }, logging: { host, port: PORTS.logging },
      ui: { enabled: false }, singleProjectMode: true,
    },
  }));
  child = spawn(bin, ['emulators:start', '--only', 'auth,database', '--project', PROJECT, '--config', path.join(dir, 'firebase.json')], {
    cwd: dir, env, stdio: 'ignore', detached: true,
  });
  child.unref(); // Không giữ tiến trình thử lại; khi thoát thì tắt emulator (bên dưới)
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(1); });
  const end = Date.now() + 90000;
  while (!(await isUp())) {
    if (Date.now() > end) { stop(); throw new Error('Firebase Emulator không chạy được'); }
    await sleep(500);
  }
}

// Gọi Realtime Database. token: idToken của một tài khoản; bỏ trống = quyền chủ (bỏ qua rules, chỉ có ở emulator);
// null = khách chưa đăng nhập.
async function db(method, p, body, token) {
  const q = new URLSearchParams({ ns: NS });
  if (token) q.set('auth', token);
  const headers = { 'content-type': 'application/json' };
  if (token === undefined) headers.authorization = 'Bearer owner';
  const res = await fetch(`${DB}/${p}.json?${q}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, data };
}

async function authCall(name, body) {
  const res = await fetch(`${SERVER.authBase}/v1/accounts:${name}?key=${API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${name}: ${data?.error?.message}`);
  return data;
}

const email = (username) => `${username}@todaypod.local`;
const users = {}; // username → { uid, password }

// Xoá sạch dữ liệu + tài khoản, nạp rules của repo.
async function reset() {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  const rules = await fetch(`${DB}/.settings/rules.json?ns=${NS}`, {
    method: 'PUT', headers: { authorization: 'Bearer owner' }, body: fs.readFileSync(RULES, 'utf8'),
  });
  if (!rules.ok) throw new Error(`Nạp rules lỗi: ${await rules.text()}`);
  await db('PUT', '', {});
  for (const k of Object.keys(users)) delete users[k];
}

// Tạo tài khoản Today: tài khoản Auth + users/{uid} (profile = null thì không tạo hồ sơ) + admins/{uid}.
async function createUser(username, { password = 'matkhau123', profile = {}, admin = false } = {}) {
  const r = await authCall('signUp', { email: email(username), password, returnSecureToken: true });
  const uid = r.localId;
  if (profile) {
    await db('PUT', `users/${uid}`, { username, displayName: username, role: 'designer', status: 'active', ...profile });
  }
  if (admin) await db('PUT', `admins/${uid}`, true);
  users[username] = { uid, password };
  return uid;
}

async function token(username) {
  const r = await authCall('signInWithPassword',
    { email: email(username), password: users[username].password, returnSecureToken: true });
  return r.idToken;
}

// Trỏ extension vào máy chủ giả lập và đăng nhập (chạy trong service worker của extension).
// sw: Worker của Playwright, hoặc hàm (expr) => evaluate qua CDP.
async function signInExtension(sw, username) {
  const args = { server: SERVER, username, password: users[username].password };
  const fn = async ({ server, username: u, password }) => {
    await chrome.storage.local.set({ todayServer: server });
    await TodayClient.signIn(u, password);
    return refreshAccess();
  };
  if (typeof sw === 'function') return sw(`(${fn})(${JSON.stringify(args)})`);
  return sw.evaluate(fn, args);
}

// Một lần cho mỗi tiến trình thử: bật emulator, xoá sạch, tạo quản trị + một thành viên được dùng.
let readyOnce = null;
function ready() {
  readyOnce ??= (async () => {
    await start();
    await reset();
    await createUser('quantri', { admin: true, profile: { role: 'full', displayName: 'Quản trị' } });
    await createUser('tester', { profile: { displayName: 'Người thử' } });
  })();
  return readyOnce;
}

module.exports = { SERVER, NS, start, stop, reset, ready, db, createUser, token, users, signInExtension };
