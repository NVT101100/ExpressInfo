# Cổng đăng ký giao hàng nhà cung cấp

Ứng dụng React/Vite dùng Firebase Authentication (Google), Realtime Database, Google Drive API và Firebase Hosting. File Excel được đọc ngay trên trình duyệt; các file kế hoạch/giấy giới thiệu được lưu trong thư mục Drive công ty, còn dữ liệu phiếu gốc không bị ghi đè. Mỗi lần sửa, duyệt hoặc xóa mềm sẽ được ghi thành một revision bất biến và giao diện áp các revision để hiển thị nội dung mới nhất.

## Chạy ứng dụng

1. Tạo Firebase project, bật **Authentication → Google** và tạo **Realtime Database**.
2. Sao chép `.env.example` thành `.env.local`, điền Firebase Web App config cùng Realtime Database URL.
3. Trong Realtime Database, tạo/cập nhật `/roles/{uid}` cho từng tài khoản và đặt `role` thành `admin`, `developer` hoặc `user`. Rules không cần whitelist UID; quyền được lấy từ role trong DB. Thêm `email` và tùy chọn `displayName` để admin xuất hiện trong danh sách người nhận chat.
4. Bật **Google Drive API** trong Google Cloud Console. Tạo thư mục Drive dùng chung, cấp quyền Editor cho các tài khoản nhà cung cấp/admin cần tải hoặc xem hồ sơ, rồi điền ID thư mục vào `GOOGLE_DRIVE_DELIVERY_FOLDER_ID` trong `src/config.ts`. Nhà cung cấp cần có quyền tạo file trong thư mục; các thành viên được chia sẻ thư mục mới mở được file.
5. Cài dependencies rồi chạy:

   ```sh
   npm install
   npm run dev
   ```

6. Cài Firebase CLI (`npm install -g firebase-tools`), đăng nhập (`firebase login`), chọn project (`firebase use --add`) và thêm domain Hosting trong **Authentication → Settings → Authorized domains**.
7. Triển khai Realtime Database Rules và Hosting:

   ```sh
   firebase deploy --only database,hosting
   ```

   Khi deploy bằng GitHub Actions, thêm các repository secrets mà workflow sử dụng: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_DATABASE_URL` và `FIREBASE_TOKEN`. Các biến `VITE_*` được nhúng vào ứng dụng trong bước build; sau khi đổi secrets, cần chạy lại workflow để deploy bản build mới.

Khi tải hồ sơ lần đầu, ứng dụng yêu cầu nhà cung cấp xác nhận lại tài khoản Google và cấp quyền `drive.file`; quyền này được dùng để tải trực tiếp lên thư mục Drive, không lưu access token vào Realtime Database.

## Cấu hình file Excel

`EXCEL_TEMPLATE` trong `src/config.ts` hiện dùng các cột: **STT, Nhân sự phụ trách, Địa điểm giao hàng, Số PO, Tên vật tư, Số lượng giao, Đơn vị tính, Ngày giao dự kiến, Ghi chú**. Cột ghi chú này thuộc từng dòng Excel và vẫn được giữ; ghi chú chung cũ trên phiếu đã bỏ. `sheetIndex` là sheet bắt đầu từ 0; `headerRow` là dòng tiêu đề bắt đầu từ 1. Ngày dự kiến được chuẩn hóa thành `YYYY-MM-DD` (hỗ trợ ngày Excel, timestamp dạng giây/mili giây, `dd/mm/yyyy` và `yyyy-mm-dd`; chuỗi có dấu gạch chéo được hiểu theo thứ tự ngày/tháng/năm). Cột **Đơn vị tính** được để trống khi đọc file mẫu cũ chưa có cột này. Các dòng trống được bỏ qua; giới hạn mặc định là 500 dòng.

## Cấu hình admin nhận form

Danh sách admin nhận chat được đọc từ các bản ghi `/roles/{uid}` có `role: "admin"`; thay đổi role/email/tên tại Realtime Database, không cần sửa whitelist trong mã nguồn hay rules. Admin có thể lọc danh sách theo từ khóa, trạng thái, nhà cung cấp và khoảng ngày giao; có thể xuất riêng kết quả lọc hoặc xuất tất cả phiếu đang hoạt động. Form không còn trường người nhận form, giờ giao hàng hoặc ghi chú chung.

## Quyền và dữ liệu

- Admin được xác định bằng `roles/{uid}/role == "admin"` ở giao diện và `database.rules.json`. Để cấp quyền lần đầu, thêm bản ghi role trong Realtime Database Console; rules cho phép admin hiện tại cập nhật bản ghi role. Dashboard phân cấp thành ngày giao → nhà cung cấp → danh sách phiếu → chi tiết; ngày hôm nay được ưu tiên, ngày quá hạn màu đỏ, sắp đến màu vàng, đã giao màu xanh và chưa đến hạn màu xám. Mỗi danh sách tối đa 50 mục/trang. Tại dòng phiếu admin có thể duyệt/từ chối hoặc nhắc giao/xác nhận giao mà không cần mở chi tiết.
- Deep Admin và quyền đọc `/activityLogs` dành cho mọi tài khoản có `roles/{uid}/role == "developer"`.
- Nhà cung cấp và admin đều sửa hồ sơ của chính tài khoản đang đăng nhập; email Google là định danh và không cho sửa trong ứng dụng.
- Nhà cung cấp chỉ đọc phiếu của chính mình; admin đọc toàn bộ phiếu.
- Chat dùng biểu tượng nổi và hội thoại riêng theo nhà cung cấp, không gắn với phiếu; nhà cung cấp chọn admin nhận tin, admin chọn nhà cung cấp. Đề cập được chọn theo ngày → nhà cung cấp → phiếu → trường thông tin hoặc cả dòng hàng (không chọn từng ô); bấm đề cập sẽ mở đúng phiếu và tô sáng dữ liệu liên quan. Không có luồng nhắn tin giữa hai nhà cung cấp.
- Phiếu gốc chỉ cho phép tạo, không cho cập nhật/xóa. Revision, tin nhắn và thông báo là append-only.
- Revision chỉ lưu trường giao hàng, thay đổi ô hàng, thay danh sách hàng khi tải Excel mới/xóa dòng, hoặc sự kiện trạng thái; dữ liệu gốc không bị ghi đè. Nhà cung cấp có thể nạp Excel thay thế và xóa dòng khi sửa phiếu; email chỉ dành cho admin.
- Phiếu đã duyệt/đã nhắc mà qua ngày giao chưa xác nhận được tự chuyển sang trạng thái **Trễ giao** khi admin mở ứng dụng, ghi lịch sử và gửi thông báo realtime cho đúng nhà cung cấp. Admin dashboard hiển thị cảnh báo quá hạn; thông báo desktop chỉ xuất hiện khi ứng dụng đang mở và quyền trình duyệt đã được cấp, không phải lịch chạy nền.
- Khi chọn ngày giao trong dashboard, admin có thể chuyển giữa danh sách nhà cung cấp và danh sách hàng tổng hợp toàn bộ phiếu trong ngày (tối đa 50 dòng mỗi trang), đồng thời mở Outlook web để soạn email tổng hợp toàn bộ mặt hàng trong ngày. Với email một phiếu hoặc tổng hợp ngày, có thể dùng **Sao chép bảng HTML** rồi dán vào nội dung thư trong Outlook để chèn bảng đã định dạng; liên kết soạn thư không tự nhúng HTML. Cần đăng nhập Outlook và tự kiểm tra/gửi thư. Liên kết `mailto:` trong chi tiết vẫn có để mở ứng dụng email mặc định nhưng cách giải mã ký tự phụ thuộc ứng dụng đó.
- Activity log được lưu trực tiếp trong Realtime Database, tối đa 1.000 log gần nhất hiển thị trên trang Deep Admin. Theo lựa chọn hiện tại, Google Drive chưa được tích hợp nên log chưa được chuyển ra file ngoài.
- Chức năng xóa của admin là **xóa mềm** (ẩn khỏi danh sách thường) để giữ nguyên dữ liệu gốc và dấu vết lịch sử.
- Tin nhắn, phiếu mới và thay đổi trạng thái đồng bộ realtime; thông báo desktop của trình duyệt chạy khi ứng dụng đang mở. Người dùng bật quyền thông báo trong cửa sổ chat; push khi đóng hẳn ứng dụng cần FCM/Cloud Function và chưa nằm trong MVP này.
- Nhà cung cấp cần đính kèm file kế hoạch `.xlsx` và giấy giới thiệu (PDF, Word hoặc ảnh). Excel được parse trước để kiểm tra; cả hai file được upload lên Drive khi gửi phiếu. Khi sửa, nhà cung cấp có thể thay file và dữ liệu kế hoạch được lưu trong revision cùng liên kết Drive mới.
- Dữ liệu Firestore đang tồn tại (nếu có) không tự chuyển sang Realtime Database; cần migration riêng trước khi dùng dữ liệu cũ.
