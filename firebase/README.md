# Kết nối Today Auto Click với máy chủ Today

Today Auto Click dùng chung máy chủ với Today POD Studio: project Firebase **today-pod-hub**
(Authentication + Realtime Database). Tài khoản, khoá/mở khoá, hạn dùng là của hệ thống Today;
Auto Click chỉ có thêm một nhánh riêng `apps/autoclick` cho các cài đặt của nó.

Việc này chỉ chủ dự án làm, **một lần**. Không cần máy chủ mới, không cần Worker.

## Dữ liệu dùng

```
users/{uid}                    username, displayName, role (full|designer|publisher),
                               status (active|locked), expiresAt, createdAt   ← của Today (mô hình v6)
admins/{uid}                   true                                           ← của Today
apps/autoclick/config          enabled, defaultAllow, minVersion, message     ← cài đặt chung của Auto Click
apps/autoclick/access/{uid}    true (cấp riêng) | false (chặn)                ← quyền từng người
apps/autoclick/usage/{uid}     total, days/{YYYY-MM-DD}, lastSeen, lastAt, version
```

Tên đăng nhập `lan` ứng với email nội bộ `lan@todaypod.local` (giống kế hoạch Today v6), nên
khi Today POD Studio v6 dùng Firebase Authentication thì **cùng tài khoản** đăng nhập được cả hai.

Một người dùng được Auto Click khi: có hồ sơ `users/{uid}` với `status: active`, chưa hết hạn,
Auto Click đang bật cho cả đội, phiên bản đủ mới, và quản trị không chặn người đó
(`access/{uid}` khác `false`; nếu "Thành viên chưa được cấp riêng" là *Không được dùng* thì phải
có `access/{uid} = true`).

## Bước 1 — Bật đăng nhập bằng mật khẩu

Firebase Console → **today-pod-hub** → **Authentication** → *Get started* → *Sign-in method* →
**Email/Password** → *Enable* → *Save*.

Giữ nguyên tuỳ chọn cho phép tạo tài khoản (*User actions → Enable create (sign-up)*): quản trị
tạo thành viên mới bằng cách này. An toàn vì tài khoản không có hồ sơ `users/{uid}` do quản trị
ghi thì không làm được gì.

## Bước 2 — Điền Web API key vào extension

Firebase Console → ⚙ *Project settings* → *General* → **Web API Key** → chép vào
`src/today-config.js`:

```js
apiKey: 'AIza…',
```

Key này là loại công khai (ứng dụng web nào của Firebase cũng để lộ key này); quyền thật do
Authentication và rules quyết định. Sau đó đóng gói lại và phát bản cài cho cả đội.

## Bước 3 — Tạo quản trị đầu tiên

1. **Authentication** → *Users* → *Add user*: email `tenban@todaypod.local`, mật khẩu ≥ 6 ký tự.
   Chép **User UID** vừa tạo.
2. **Realtime Database** → *Data*, thêm:

```json
"users": { "<UID>": { "username": "tenban", "displayName": "Tên của bạn", "role": "full", "status": "active" } },
"admins": { "<UID>": true }
```

Từ đây đăng nhập Auto Click bằng `tenban` sẽ thấy thẻ **Quản trị** (popup → *Quản trị*, hoặc
chuột phải biểu tượng → *Tuỳ chọn*): thêm thành viên, khoá/mở khoá, đặt hạn dùng, chặn/cho phép
dùng Auto Click, tạm tắt cho cả đội, bắt cập nhật bản mới, gửi lời nhắn.
Thêm quản trị khác: chỉ làm trong Firebase Console (ghi `admins/{uid}: true`), extension không
có quyền này.

## Bước 4 — Đóng database với người lạ (rules)

Hiện database đang mở (Today POD Studio bản cũ đọc/ghi không cần đăng nhập). Khi chưa nạp rules,
Auto Click vẫn kiểm tra quyền và chặn đúng theo trang quản trị, nhưng người rành kỹ thuật có thể
tự sửa dữ liệu. Nạp `database.rules.json` để máy chủ tự chặn:

- Nhánh mới (`users`, `admins`, `apps`) chỉ người đăng nhập mới đọc được: thành viên chỉ xem
  của mình, chỉ quản trị sửa được, không ai tự cấp quyền hay tự thêm quản trị.
- Các nhánh Today bản cũ đang dùng (`system_config`, `system_notifications`, `users_accounts`,
  `team_chat`, `stores`, `jobs`) **giữ nguyên như bây giờ** để Today POD Studio không bị ảnh
  hưởng — sẽ đóng nốt khi Today chuyển sang v6.

**Trước khi nạp** (bắt buộc, theo quy định của Today):

1. Sao lưu: *Realtime Database* → *Data* → ⋮ → **Export JSON**, cất file.
2. So các nhánh gốc trong dữ liệu với danh sách 6 nhánh cũ ở trên. Có nhánh nào khác đang được
   dùng thì thêm vào `database.rules.json` theo cùng kiểu (`".read": true, ".write": true`),
   nếu không app cũ sẽ mất quyền vào nhánh đó.
3. Thử trên Emulator (`node test/today.cjs` chạy toàn bộ kiểm tra rules).

Nạp: *Realtime Database* → *Rules* → dán nội dung `database.rules.json` → *Publish*
(hoặc `firebase deploy --only database --project today-pod-hub` trong thư mục này).
Rules cũ đang chạy nên chép lại trước khi thay, để quay lại được ngay nếu cần.

## Thử trên máy (không đụng máy chủ thật)

```
npm install
node test/today.cjs
```

Bài thử tự bật Firebase Emulator (cần Java), nạp đúng `database.rules.json`, tạo tài khoản giả và
kiểm tra: rules, đăng nhập, chặn/cho phép, khoá, hết hạn, tạm tắt, bắt cập nhật, mất mạng, popup
và trang quản trị.
