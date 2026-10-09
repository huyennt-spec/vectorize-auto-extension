# Vectorizer Auto Click

Extension cho Chrome / Edge / Cốc Cốc giúp dùng [Vectorizer.AI](https://vectorizer.ai/) đỡ phải bấm:
**bạn chỉ việc kéo ảnh vào, còn lại extension tự làm.**

## Extension làm gì

1. Bạn kéo ảnh vào trang (hoặc app đã cài) Vectorizer.AI.
2. Nếu hiện bảng **Pre-Crop** (ảnh lớn hơn giới hạn) → tự bấm **OK**.
3. Khi có kết quả → tự bấm **DOWNLOAD**, file về thư mục Tải xuống như khi bạn tự bấm.
4. Tải xong → tự quay về trang chính để bạn kéo ảnh tiếp theo.

Góc dưới bên trái trang có thông báo nhỏ cho biết extension đang làm gì.

Extension chỉ tự bấm khi bạn **vừa kéo, chọn hoặc dán ảnh**. Mở lại ảnh cũ hay tải lại
trang sẽ không tự tải trùng.

## Cài đặt

1. Tải file `vectorizer-auto-click-v1.0.0.zip` rồi giải nén. Bạn sẽ có thư mục
   `vectorizer-auto-click` (bên trong có file `manifest.json`).
   *(Hoặc trên GitHub: chọn nhánh này → **Code** → **Download ZIP**.)*
2. Mở trang quản lý tiện ích:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Cốc Cốc: `coccoc://extensions`
3. Bật **Chế độ dành cho nhà phát triển** (*Developer mode*).
4. Bấm **Tải tiện ích đã giải nén** (*Load unpacked*) → chọn thư mục ở bước 1.
5. Đóng hẳn rồi mở lại Vectorizer.AI (hoặc bấm F5) một lần.

Extension chạy được cả trong **cửa sổ app Vectorizer.AI đã cài** vào máy.

> **Lần tải đầu tiên:** nếu trình duyệt hỏi *"Tải xuống nhiều tệp"* (*Download multiple files*)
> thì chọn **Cho phép**. Trình duyệt sẽ nhớ và không hỏi lại.

> Đừng xoá thư mục đã giải nén: trình duyệt chạy extension từ chính thư mục đó.

## Tuỳ chỉnh

Bấm icon extension (chữ **V** xanh trên thanh công cụ) để bật/tắt:

| Tuỳ chọn | Mặc định |
| --- | --- |
| Bật tự động (tắt hết) | Bật |
| Tự bấm **OK** ở bảng Pre-Crop | Bật |
| Tự bấm **DOWNLOAD** khi có kết quả | Bật |
| Tải xong tự về trang chính để kéo ảnh tiếp | Bật |
| Hiện thông báo nhỏ trên trang | Bật |

Popup cũng đếm số file đã tải hôm nay / tổng cộng.

Định dạng tải về là định dạng mặc định khi bấm DOWNLOAD trên web (SVG).

## Nếu extension không bấm

- Xem thông báo nhỏ ở góc dưới bên trái trang: nó cho biết extension đang chờ ở bước nào.
- Kiểm tra extension đang bật trong popup, và đã tải lại trang Vectorizer.AI sau khi cài.
- Vectorizer.AI đổi giao diện (đổi chữ trên nút) thì extension có thể không nhận ra nút.
  Khi đó gửi ảnh chụp màn hình bước bị dừng để sửa.

## Dành cho người phát triển

```
manifest.json       Khai báo extension (Manifest V3)
src/shared.js       Cài đặt mặc định, dùng chung
src/content.js      Chạy trên vectorizer.ai: nhận ảnh, bấm OK / DOWNLOAD, quay về trang chính
src/background.js   Theo dõi file tải về, báo tab khi tải xong, đếm số file
popup/              Giao diện bật/tắt
test/               Trang giả lập Vectorizer.AI + kiểm thử tự động (Playwright)
```

Nút được tìm theo **chữ hiển thị** ("Pre-Crop", "OK", "DOWNLOAD") chứ không theo class CSS,
nên ít bị hỏng khi web đổi giao diện.

Chạy kiểm thử: `npm install && npm test`
