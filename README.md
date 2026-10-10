# Auto Click

Extension cho Chrome giúp đỡ phải bấm khi chuyển ảnh sang vector:
**bạn chỉ việc kéo ảnh vào, còn lại extension tự làm.**

## Extension làm gì

1. Bạn kéo ảnh vào trang (hoặc app đã cài). Cửa sổ **tự thu nhỏ** xuống thanh tác vụ.
2. Nếu hiện bảng **Pre-Crop** (ảnh lớn hơn giới hạn) → tự bấm **OK**.
3. Bảng **Upload / Process / Fetch** hiện ra → extension đứng chờ cho xong.
4. Có kết quả → tự bấm **DOWNLOAD**.
5. Sang trang **Download** (chọn SVG/PDF…) → tự bấm nút **Download** xanh, file về thư mục
   Tải xuống như khi bạn tự bấm.

Muốn làm ảnh tiếp thì cứ kéo ảnh mới vào, ở trang nào cũng được, lúc nào cũng được.

### Kéo nhanh, kéo nhiều ảnh: hàng chờ

Mỗi lúc extension chỉ làm **một ảnh**. Ảnh trước chưa xong mà bạn kéo thêm ảnh, hoặc kéo
**nhiều ảnh một lúc**, thì các ảnh đó được giữ trong hàng chờ (trang chưa nhận). Ảnh trước tải
xong, extension tự đưa ảnh tiếp theo vào, lần lượt đúng thứ tự bạn kéo. Nhờ vậy thao tác
nhanh không bị lẫn ảnh này với ảnh kia.

Bảng bật/tắt (🧩 → **Auto Click**) cho biết còn bao nhiêu ảnh đang chờ.

**Muốn dừng:** bấm **CANCEL** (hoặc nút đóng ×, hoặc phím **Esc**) như bình thường,
extension sẽ dừng ảnh đang làm và **bỏ cả hàng chờ**.

Extension **chạy ngầm**: không hiện thông báo hay nút gì trên trang. Nếu bấm nút mà trang
không phản ứng, sau vài giây extension tự mở thẳng đường link của nút.

Extension chỉ tự bấm khi bạn **vừa kéo, chọn hoặc dán ảnh**. Mở lại ảnh cũ hay tải lại
trang sẽ không tự tải trùng.

## Cài đặt

1. Tải file `vectorizer-auto-click-v1.5.1.zip` rồi giải nén. Bạn sẽ có thư mục
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
| Nhận ảnh xong tự thu nhỏ cửa sổ | Bật |

Cửa sổ chỉ tự thu nhỏ khi mọi bước đều đang bật tự động. Nếu thấy ảnh chỉ chạy tiếp khi mở
cửa sổ lên, hãy tắt mục thu nhỏ.
Bảng này còn cho biết extension **có đang chạy trên trang đang mở không**, còn bao nhiêu ảnh
trong hàng chờ, và đếm số file đã tải hôm nay / tổng cộng.

Định dạng tải về là định dạng đang được chọn ở trang Download (mặc định là SVG).
Extension không đổi lựa chọn đó.

## Nếu extension vẫn không bấm

1. Mở bảng bật/tắt (🧩 → **Auto Click**) ngay lúc bị kẹt: dòng trạng thái phải là
   **✓ Đang chạy trên trang này**.
2. Bấm **Sao chép thông tin lỗi** rồi dán gửi cho người hỗ trợ, kèm ảnh chụp màn hình bước bị
   kẹt. Thông tin này chỉ gồm các nút trên trang (chữ, vị trí, trạng thái) và việc extension
   đang chờ, không có ảnh của bạn.

## Dành cho người phát triển

```
manifest.json       Khai báo extension (Manifest V3)
src/shared.js       Cài đặt mặc định, dùng chung
src/content.js      Chạy trên trang: nhận ảnh, hàng chờ, bấm OK / DOWNLOAD / Download, dừng khi bấm CANCEL
src/background.js   Nhớ việc từng tab, theo dõi file tải về, thu nhỏ cửa sổ, đếm số file, gắn script khi cài
popup/              Bảng bật/tắt, trạng thái, sao chép thông tin lỗi
test/               Trang giả lập + kiểm thử tự động (Playwright)
```

Nút được tìm theo **chữ hiển thị** ("Pre-Crop", "OK", "DOWNLOAD") chứ không theo class CSS,
nên ít bị hỏng khi web đổi giao diện. Nút bị lớp phủ che (bảng đang xử lý, nền mờ) thì chưa bấm.

Chạy kiểm thử: `npm install && npm test`
