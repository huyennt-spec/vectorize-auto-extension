# Auto Click

Extension cho Chrome giúp đỡ phải bấm khi chuyển ảnh sang vector:
**bạn chỉ việc kéo ảnh vào, còn lại extension tự làm.**

## Extension làm gì

1. Bạn kéo ảnh vào trang (hoặc app đã cài).
2. Nếu hiện bảng **Pre-Crop** (ảnh lớn hơn giới hạn) → tự bấm **OK**.
3. Bảng **Upload / Process / Fetch** hiện ra → extension đứng chờ cho xong.
4. Có kết quả → tự bấm **DOWNLOAD**.
5. Sang trang **Download** (chọn SVG/PDF…) → tự bấm nút **Download** xanh, file về thư mục
   Tải xuống như khi bạn tự bấm.

Muốn làm ảnh tiếp thì cứ kéo ảnh mới vào, ở trang nào cũng được.

**Muốn dừng:** bấm **CANCEL** (hoặc nút đóng ×, hoặc phím **Esc**) như bình thường,
extension sẽ dừng theo và không bấm gì nữa cho ảnh đó.

Góc dưới bên trái trang có thông báo ngắn cho biết extension đang làm gì. Lúc đang chờ thì
thông báo đứng yên cho tới khi xong:

| Thông báo | Nghĩa |
| --- | --- |
| 📥 Đã nhận ảnh | Vừa thấy bạn kéo ảnh vào |
| ✅ Đã bấm OK | Đã bấm OK ở bảng Pre-Crop |
| ⏳ Chờ xử lý xong… | Bảng Upload / Process / Fetch đang chạy |
| ⏳ Chờ kết quả… | Chưa thấy nút DOWNLOAD |
| ⏳ Chờ nút DOWNLOAD… | Có nút nhưng đang bị khoá |
| ⬇️ Đang tải… | Đã bấm DOWNLOAD / Download, đang chờ file về |
| ✅ Đã tải xong | File đã về máy |
| ⏹ Đã dừng | Bạn vừa bấm CANCEL / Esc |

Nếu bấm nút mà trang không phản ứng, sau vài giây extension tự mở thẳng đường link của nút.

Extension chỉ tự bấm khi bạn **vừa kéo, chọn hoặc dán ảnh**. Mở lại ảnh cũ hay tải lại
trang sẽ không tự tải trùng.

## Cài đặt

1. Tải file `vectorizer-auto-click-v1.3.0.zip` rồi giải nén. Bạn sẽ có thư mục
   `vectorizer-auto-click` (bên trong có file `manifest.json`).
2. Mở Chrome (cửa sổ bình thường), vào `chrome://extensions`.
3. Bật **Chế độ dành cho nhà phát triển** (*Developer mode*).
4. Bấm **Tải tiện ích đã giải nén** (*Load unpacked*) → chọn thư mục ở bước 1.

Không cần đóng app hay tải lại trang: extension tự gắn vào các trang đang mở ngay khi cài.

> **Lần tải đầu tiên:** nếu trình duyệt hỏi *"Tải xuống nhiều tệp"* (*Download multiple files*)
> thì chọn **Cho phép**. Trình duyệt sẽ nhớ và không hỏi lại.

> Đừng xoá thư mục đã giải nén: trình duyệt chạy extension từ chính thư mục đó.

### Dùng với app đã cài

App bạn cài vào máy là **app của Chrome** (bấm ⋮ trong app sẽ thấy dòng *"Mở trong Chrome"*),
nên cài extension vào Chrome là app tự có.

Trong cửa sổ app, bấm hình mảnh ghép 🧩 trên thanh tiêu đề → **Auto Click** để mở bảng
bật/tắt.

### Cập nhật bản mới

Giải nén bản mới đè lên thư mục cũ → vào `chrome://extensions` → bấm nút tải lại ⟳ của
*Auto Click*. Extension tự gắn lại vào các trang đang mở.

## Bảng bật/tắt

| Tuỳ chọn | Mặc định |
| --- | --- |
| Bật tự động (tắt hết) | Bật |
| Tự bấm **OK** ở bảng Pre-Crop | Bật |
| Tự bấm **DOWNLOAD** khi có kết quả | Bật |
| Hiện thông báo nhỏ trên trang | Bật |

Bảng này còn cho biết extension **có đang chạy trên trang đang mở không**, và đếm số file
đã tải hôm nay / tổng cộng.

Định dạng tải về là định dạng đang được chọn ở trang Download (mặc định là SVG).
Extension không đổi lựa chọn đó.

## Nếu extension vẫn không bấm

1. Chụp màn hình lúc bị kẹt, **có cả thông báo ở góc dưới bên trái** (nó cho biết đang chờ gì).
   Không thấy thông báo nào nghĩa là extension không nhận ra bạn vừa kéo ảnh vào.
2. Mở bảng bật/tắt (🧩 → **Auto Click**) ngay lúc bị kẹt: dòng trạng thái phải là
   **✓ Đang chạy trên trang này**.
3. Bấm **Sao chép thông tin lỗi** rồi dán gửi cho người hỗ trợ, kèm ảnh chụp màn hình bước bị
   kẹt. Thông tin này chỉ gồm các nút trên trang (chữ, vị trí, trạng thái), không có ảnh
   của bạn.

## Dành cho người phát triển

```
manifest.json       Khai báo extension (Manifest V3)
src/shared.js       Cài đặt mặc định, dùng chung
src/content.js      Chạy trên trang: nhận ảnh, bấm OK / DOWNLOAD / Download, dừng khi bấm CANCEL
src/background.js   Theo dõi file tải về, báo tab khi tải xong, đếm số file, gắn script khi cài
popup/              Bảng bật/tắt, trạng thái, sao chép thông tin lỗi
test/               Trang giả lập + kiểm thử tự động (Playwright)
```

Nút được tìm theo **chữ hiển thị** ("Pre-Crop", "OK", "DOWNLOAD") chứ không theo class CSS,
nên ít bị hỏng khi web đổi giao diện. Nút bị lớp phủ che (bảng đang xử lý, nền mờ) thì chưa bấm.

Chạy kiểm thử: `npm install && npm test`
