# Kiểm tra và bổ sung học viên thiếu theo ngày đăng ký

Trong Quản lý lịch học:

1. Lọc khoảng ngày với cả ngày bắt đầu và kết thúc là **hôm qua theo giờ Việt Nam**, bấm **Lọc**, rồi chọn các lịch cần kiểm tra (tối đa 50 lịch/lượt).
2. Mở **Đồng bộ → Kiểm tra học viên thiếu hôm qua**. Mục này chỉ xuất hiện khi khoảng ngày đã áp dụng là đúng hôm qua; thay đổi bản nháp chưa bấm Lọc không đổi điều kiện hiển thị.
3. Ngày đăng ký được cố định là **hôm qua theo giờ Việt Nam**; backend cũng chặn ngày khác.
4. Bấm **Kiểm tra**. Chức năng lấy tất cả các trang API của cả hai mốc hôm qua và hôm nay, loại đăng ký hôm nay, đối chiếu với bảng `users`
   và hiển thị tổng đăng ký, enrollment đã có/còn thiếu, chi tiết theo chương trình/buổi.
5. Xem danh sách rồi bấm **Bổ sung ... enrollment thiếu** nếu muốn thêm các dòng thiếu.

Không cần copy username vào SQL UNION, không cần xuất file trung gian. Script
`export-registered-usernames.cjs`, test và hướng dẫn riêng của script đã được xóa.

## Quy tắc đối chiếu

- Package ID lấy từ `package_lesson_mapping` theo key của lịch đã chọn.
- API dùng cấu hình hiện có: `HOCMAI_LIVE_USER_API_URL`, `HOCMAI_LIVE_USER_API_TOKEN`.
- `registed_at=D` lấy đăng ký **từ D đến hiện tại**, không chỉ trong ngày D. Kết quả hôm qua là danh sách từ hôm qua trừ danh sách từ hôm nay, theo ID Học Mãi + username + package và số lần xuất hiện. Không trừ theo username đơn lẻ vì cùng người có thể đăng ký gói khác hôm nay. Kết quả hiển thị tổng dòng tích lũy, số dòng hôm nay đã loại và số đăng ký hôm qua.
- Nếu danh sách hôm nay chứa dòng không có trong snapshot từ hôm qua (có đăng ký mới trong lúc quét), báo lỗi và yêu cầu kiểm tra lại thay vì đưa ra số thiếu không chính xác. Cách đối chiếu dựa trên API trả cùng danh tính và số lần xuất hiện của đăng ký cho cả hai mốc; API không cung cấp lịch sử nếu bản ghi đăng ký cũ bị sửa/xóa.
- Lấy đủ `max(last_page, ceil(total/per_page))` trang; không giới hạn cứng 12 trang.
  Trả sai số trang/thiếu dòng/sai metadata sẽ báo lỗi, không kết luận đã đầy đủ.
- Đối chiếu theo **username + code + learn_number**. Có username ở buổi khác hoặc
  chương trình khác không có nghĩa là đã có ở lịch đang xét.
- Phép so sánh dùng collation thực tế của MySQL, không tự coi email/số điện thoại
  là số. Giữ nguyên số 0 đầu username.
- Đăng ký nhiều gói cho cùng enrollment chỉ tạo một dòng; cùng username có ID Học Mãi
  mâu thuẫn hoặc thông tin không hợp lệ sẽ chặn kiểm tra để tránh thêm sai.
- Nếu nhiều lịch cùng code/buổi nhưng khác class_id được chọn cùng lúc, yêu cầu kiểm tra
  riêng để xác định đúng lớp cho dòng mới.

## Khi bấm Bổ sung

- Chỉ dùng dữ liệu từ snapshot đã kiểm tra ở server; client không được gửi tùy ý các dòng user.
- Đọc lại danh sách user: nếu một luồng khác vừa thêm thì bỏ qua dòng đó.
- Chỉ `INSERT` các dòng còn thiếu, không `UPDATE` user đã có; giữ nguyên name, islearn,
  room_id, class_id và các thông tin khác của dữ liệu cũ.
- Dòng mới dùng chính sách tạo học viên hiện có: tên qua `buildStudentDisplayName`,
  islearn=0, room_id=1, class_id tính từ code/ngày giờ/buổi của lịch.
- `created_at`/`updated_at` của dòng mới dùng cùng giá trị `CURRENT_TIMESTAMP` đọc từ DB trước mỗi batch; không tự cộng 7 giờ và không sửa timestamp của học viên đã có.
- Thêm theo batch trong một transaction; lỗi giữa chừng rollback cả lượt bổ sung.
- Nếu lịch/key/ngày giờ/Package ID đã đổi sau khi kiểm tra, yêu cầu kiểm tra lại.
- Hỗ trợ unique index `username,code,learn_number` và unique index có thêm `class_id`
  đang có trên DB thực tế. Không thay index/schema. Nếu không có ràng buộc chống trùng
  tương ứng thì chặn bổ sung, không tự sửa cấu trúc DB.
- Các xung đột unique khác vẫn giữ nguyên dòng cũ; kết quả báo rõ số dòng còn thiếu
  nếu database không thể thêm một số username.

## Tách biệt với các luồng hiện tại

Module API/service và modal riêng. Dùng ba helper đọc API hiện có thông qua export;
không đổi thuật toán, state hay entry point của đồng bộ học viên cũ.

Không gọi sync/cron, không đổi calendar, không đánh dấu `student_synced_at`, không
chia lại lớp, reset điểm danh, ghi stream hay enqueue lịch Học Mãi. Không đổi luồng Feed,
Livestream hoặc đồng bộ Lesson ID. Không có migration/schema mới cho chức năng này.

Luồng mới dùng quyền `calendar.update` và kiểm tra phạm vi chương trình cho cả xem và
bổ sung; mỗi kết quả chỉ thuộc user khởi tạo. Quyền được kiểm tra lại khi gọi apply.

Endpoint:

- `POST /api/livestreams/students/registration-audits`: `{ids, registered_at}` → jobId.
- `GET /api/livestreams/students/registration-audits/:jobId?page=1&limit=50`: tiến độ/kết quả.
- `POST /api/livestreams/students/registration-audits/:jobId/apply`: bắt đầu bổ sung.

Job nằm trong bộ nhớ process riêng, hết hạn sau 30 phút kể từ khi hoàn tất. Sau khi
backend restart hoặc kết quả hết hạn cần kiểm tra lại. Các lần kiểm tra không thay đổi DB.
Giới hạn 100.000 dòng API/enrollment mỗi lượt để tránh giữ quá nhiều dữ liệu trong bộ nhớ.

## Kiểm thử

- Hồi quy: 236 test backend, 37 test frontend và 25 test JavaScript cũ; build/typecheck.
- Chrome modal desktop 1280px và điện thoại 390px: kiểm tra không ghi dữ liệu, chỉ nút
  Bổ sung mới gọi apply, giữ số 0 đầu, hiển thị kết quả, API thiếu trang không có nút bổ sung.
- MySQL riêng + API giả lập: 12 trang/1.102 đăng ký, 1.101 enrollment, 501 đã có/600 thiếu;
  đối chiếu đúng username ở buổi khác và username tương đương theo collation.
- Có luồng khác thêm trước 1 dòng → chỉ thêm 599; dữ liệu cũ và calendar giữ nguyên.
- Đổi mapping sau preview → chặn; lỗi DB batch thứ hai → rollback cả batch đầu.
- Ownership/scope, bấm lại apply, dữ liệu API thiếu và DB thiếu index đều được kiểm tra.
- Chạy integration với cả cấu trúc unique key 3 cột và 4 cột.

```bash
TEST_REGISTRATION_AUDIT_DATABASE_URL=mysql://root@127.0.0.1:13316/calendar_source_test \
  node --import tsx tests/calendar-registration-audit.integration.ts
```

Test chỉ chấp nhận server localhost ở cổng riêng khác 3306 và tạo/xóa database fixture
riêng. Không dùng token/API Học Mãi thật; không bổ sung học viên trên DB vận hành khi test.
