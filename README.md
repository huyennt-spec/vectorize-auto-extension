# Today Auto Click

Một ứng dụng trong **hệ sinh thái Today** (cùng tài khoản, cùng máy chủ với Today POD Studio).
Extension cho Chrome giúp đỡ phải bấm khi chuyển ảnh sang vector:
**bạn chỉ việc kéo ảnh vào, còn lại extension tự làm.**

Cần **đăng nhập tài khoản Today** và được quản trị cho phép thì extension mới chạy. Chưa đăng
nhập, bị chặn, tài khoản bị khoá hoặc hết hạn → extension không làm gì, trang chạy như bình thường.

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

Bảng bật/tắt (🧩 → **Today Auto Click**) cho biết còn bao nhiêu ảnh đang chờ.

**Muốn dừng:** bấm **CANCEL** (hoặc nút đóng ×, hoặc phím **Esc**) như bình thường,
extension sẽ dừng ảnh đang làm và **bỏ cả hàng chờ**.

Extension **chạy ngầm**: không hiện thông báo hay nút gì trên trang.

- Chỉ bấm khi trang đã tải xong hẳn (nút của web chỉ chạy được sau khi trang tải xong).
- Bấm mà trang không phản ứng (bấm hụt) thì vài giây sau bấm lại; nút có link thật thì mở
  thẳng link đó.
- Cửa sổ đang thu nhỏ vẫn làm tiếp; nếu web chỉ chạy khi cửa sổ hiện thì lúc bạn mở cửa sổ lên
  extension làm tiếp, không bị huỷ vì chờ lâu.
- Không bao giờ bấm nút Download của ảnh trước, và không bấm trên trang một ảnh cũ bạn tự mở ra
  trong lúc chờ.

Extension chỉ tự bấm khi bạn **vừa kéo, chọn hoặc dán ảnh**. Mở lại ảnh cũ hay tải lại
trang sẽ không tự tải trùng.

## Cài đặt

1. Tải file `today-auto-click-v2.0.0.zip` rồi giải nén. Bạn sẽ có thư mục
   `today-auto-click` (bên trong có file `manifest.json`).
2. Mở Chrome (cửa sổ bình thường), vào `chrome://extensions`.
3. Bật **Chế độ dành cho nhà phát triển** (*Developer mode*).
4. Bấm **Tải tiện ích đã giải nén** (*Load unpacked*) → chọn thư mục ở bước 1.
5. Bấm biểu tượng 🧩 → **Today Auto Click** → đăng nhập bằng tài khoản Today quản trị cấp.

Không cần đóng app hay tải lại trang: extension tự gắn vào các trang đang mở ngay khi cài.

> **Lần tải đầu tiên:** nếu trình duyệt hỏi *"Tải xuống nhiều tệp"* (*Download multiple files*)
> thì chọn **Cho phép**. Trình duyệt sẽ nhớ và không hỏi lại.

> Đừng xoá thư mục đã giải nén: trình duyệt chạy extension từ chính thư mục đó.

### Dùng với app đã cài

App bạn cài vào máy là **app của Chrome** (bấm ⋮ trong app sẽ thấy dòng *"Mở trong Chrome"*),
nên cài extension vào Chrome là app tự có.

Trong cửa sổ app, bấm hình mảnh ghép 🧩 trên thanh tiêu đề → **Today Auto Click** để mở bảng
bật/tắt.

### Cập nhật bản mới

Giải nén bản mới đè lên thư mục cũ → vào `chrome://extensions` → bấm nút tải lại ⟳ của
*Today Auto Click*. Extension tự gắn lại vào các trang đang mở, vẫn giữ đăng nhập.

Từ bản 1.x lên 2.0: thư mục giải nén đổi tên thành `today-auto-click`. Gỡ bản cũ
(*Auto Click*) trong `chrome://extensions` rồi cài bản mới theo các bước ở trên.

## Tài khoản Today và quản trị

Bảng bật/tắt hiện tài khoản đang đăng nhập và trạng thái quyền:

| Nhãn | Nghĩa |
| --- | --- |
| **Được phép** | Dùng bình thường |
| **Bị chặn** / **Chưa cấp quyền** | Quản trị chưa cho bạn dùng Auto Click |
| **Bị khoá** / **Hết hạn** | Tài khoản Today bị khoá hoặc hết hạn (khoá chung cả hệ thống Today) |
| **Tạm tắt** | Quản trị đang tạm dừng Auto Click cho cả đội |
| **Cần cập nhật** | Phải cài bản mới hơn |
| **Ngoại tuyến** | Mất mạng: dùng tạm theo lần kiểm tra trước (tối đa 12 giờ) |

Quyền được kiểm tra lại mỗi phút trong lúc trang đang mở. Quản trị chặn thì extension dừng ngay,
kể cả ảnh đang làm dở.

**Quản trị** (tài khoản có quyền quản trị Today) có thêm nút **Quản trị** trong bảng bật/tắt,
mở trang quản lý:

- Cài đặt chung: bật/tắt Auto Click cho cả đội, thành viên mới mặc định được dùng hay không,
  phiên bản tối thiểu, lời nhắn hiện cho cả đội.
- Thêm thành viên (tài khoản Today mới, dùng chung với Today POD Studio).
- Từng thành viên: cho phép / chặn dùng Auto Click, khoá / mở khoá tài khoản, hạn dùng, số file đã
  tải hôm nay / tổng cộng, lần dùng gần nhất và phiên bản đang cài.

Cách kết nối máy chủ Today (dành cho chủ dự án, làm một lần): xem [firebase/README.md](firebase/README.md).

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

1. Mở bảng bật/tắt (🧩 → **Today Auto Click**) ngay lúc bị kẹt: nhãn quyền phải là
   **Được phép** và dòng trạng thái phải là **Đang chạy trên trang này**.
2. Bấm **Sao chép thông tin lỗi** rồi dán gửi cho người hỗ trợ, kèm ảnh chụp màn hình bước bị
   kẹt. Thông tin này chỉ gồm các nút trên trang (chữ, vị trí, trạng thái) và việc extension
   đang chờ, không có ảnh của bạn.

## Dành cho người phát triển

```
manifest.json       Khai báo extension (Manifest V3)
src/shared.js       Cài đặt mặc định, dùng chung
src/content.js      Chạy trên trang: nhận ảnh, hàng chờ, bấm OK / DOWNLOAD / Download, dừng khi bấm CANCEL
src/background.js   Nhớ việc từng tab, theo dõi file tải về, thu nhỏ cửa sổ, đếm số file, gắn script khi cài,
                    giữ quyền dùng (hỏi máy chủ Today)
src/today.js        Kết nối máy chủ Today: đăng nhập, kiểm tra quyền, các thao tác quản trị (REST)
src/today-config.js Địa chỉ máy chủ Today + Web API key (chủ dự án điền)
ui/today.css        Bộ nhận diện Today dùng chung cho popup và trang quản trị
popup/              Bảng bật/tắt: tài khoản, quyền, trạng thái, sao chép thông tin lỗi
options/            Trang Tài khoản & Quản trị
firebase/           Rules của Realtime Database + hướng dẫn kết nối
test/               Trang giả lập + máy chủ Today giả lập (Firebase Emulator) + kiểm thử tự động
```

Quyền do **máy chủ** quyết định (Firebase Authentication + rules), extension chỉ đọc kết quả;
không có mật khẩu hay khoá bí mật nào nằm trong extension.

Nút được tìm theo **chữ hiển thị** ("Pre-Crop", "OK", "DOWNLOAD") chứ không theo class CSS,
nên ít bị hỏng khi web đổi giao diện. Nút bị lớp phủ che (bảng đang xử lý, nền mờ) thì chưa bấm.

Chạy kiểm thử: `npm install && npm test` (thêm `npm run test:hidden` cho trường hợp cửa sổ ẩn,
cần `xvfb-run` trên Linux). Các bài thử tự bật Firebase Emulator (cần Java) làm máy chủ Today giả.
