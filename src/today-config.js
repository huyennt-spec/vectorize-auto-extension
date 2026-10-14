// Cấu hình máy chủ Today (dùng chung với Today POD Studio: project Firebase today-pod-hub).
// Chủ dự án điền Web API key một lần: Firebase Console → today-pod-hub → Project settings →
// General → "Web API Key". Key này là loại công khai (được phép nằm trong extension); quyền truy
// cập thật do Firebase Authentication và rules của Realtime Database quyết định.
globalThis.TODAY_CONFIG = {
  apiKey: '',
  databaseURL: 'https://today-pod-hub-default-rtdb.asia-southeast1.firebasedatabase.app',
  emailDomain: 'todaypod.local', // Tên đăng nhập "lan" ↔ email nội bộ "lan@todaypod.local" (như Today v6)
};
