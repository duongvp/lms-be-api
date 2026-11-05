# Xóa mềm và khôi phục lịch học

## Phạm vi

`calendar.deleted_at IS NULL` là lịch hoạt động. Các luồng hiện có giữ nguyên quy tắc nghiệp vụ; Prisma middleware và truy vấn SQL trực tiếp bỏ qua lịch đã xóa khi vận hành, kiểm tra trùng, thống kê, export và đồng bộ.

- `DELETE /api/livestreams/:id`: xóa mềm, ghi `calendar_change_logs` và queue `{c_key, action: "delete"}` trong cùng transaction. Giữ mapping và snapshot để khôi phục.
- `POST /api/livestreams/:id/restore`: khôi phục chính lịch bị xóa nhầm; dùng quyền `calendar.delete` theo chương trình. Kiểm tra lịch chưa diễn ra, bài đề cương còn hợp lệ, mapping Course thuộc bài và không trùng lịch. Gửi đầy đủ payload với `restore`.
- API danh sách nhận `deleted=true` để chỉ xem lịch đã xóa; mặc định chỉ xem lịch hoạt động. Metadata `can_restore` không phụ thuộc quyền hiển thị cột `key`.
- Giao diện lịch có nút **Lịch đã xóa**, dùng chương trình và nguồn lịch đang chọn, có phân trang và thao tác khôi phục.
- Feed vẫn xóa/khôi phục cục bộ và ghi log, không ghi queue HMO.

## Tái sử dụng key

Khi một luồng tạo lịch hiện tại sinh ra key đã bị xóa, bản ghi đã xóa được giữ lại với `key=NULL`; key gốc vẫn còn trong log `delete`. Tạo bản ghi lịch mới với key đó để không gán nhầm lịch sử phụ thuộc `calendar_id` của lịch cũ sang lịch mới. Mapping cũ được thay hoàn toàn bằng mapping đầu vào của luồng hiện tại.

Log `restore` có `after_data.restore_type="reuse_key"`; `before_data` chứa snapshot lịch/mapping cũ, `after_data` chứa lịch/mapping mới. `restore_type="self"` là khôi phục nguyên trạng chính lịch đã xóa. Key đã được tái sử dụng không được khôi phục đè từ bản ghi lịch cũ, kể cả lịch mới sau đó cũng bị xóa.

Không đổi cách reorder đề cương, không tự khôi phục mọi lịch đã xóa khi reorder. Các thao tác ghi lại lịch dùng dữ liệu mà luồng hiện tại đã tính. Key được dùng lại gửi `restore` và toàn bộ payload mới, gồm thời gian, giáo viên, tài liệu và packages/lesson của lịch nguồn. Nếu chưa có mapping, chưa gửi payload rỗng; khi mapping được gán hoặc gửi lại HMO, queue tiếp tục dùng `restore` nếu lifecycle trước vẫn là delete hoặc restore chưa thành công.

## Log và queue

Dùng bảng `calendar_change_logs` hiện có, không thêm bảng audit. `operation_id` liên kết log với queue tương ứng khi tạo job cùng thao tác. Nếu mapping được gán sau, đó là thao tác đồng bộ riêng có operation ID riêng. Log ghi nhận thay đổi tại LMS; queue phản ánh kết quả HMO sau khi consumer xử lý.

Các truy vấn xác định khả năng nghỉ/bù bỏ qua hai action lifecycle mới để không đổi ý nghĩa log nghiệp vụ trước đây. Trigger không sinh update/status cho lịch đã xóa hoặc trong chuyển trạng thái delete/restore. Thao tác từ service dùng cờ manual queue để tránh job trùng; trigger lifecycle hỗ trợ các cập nhật SQL khác nhưng không thay thế audit của service.

## Triển khai

Migration `20261031090000_calendar_soft_delete` tạo trực tiếp cột `deleted_at`, index calendar theo `deleted_at, start_time` và index tra cứu queue theo key. Dùng một migration cho production chưa có cột này; không có bước đổi tên cột, cập nhật dữ liệu thời gian hay thay đổi trigger.

`deleted_at` lưu giờ Việt Nam dạng wall-clock giống các thời gian lịch khác. Service dùng `getVietnamWallClockDate()`; frontend dùng `formatVietnamDateTime()` để không cộng múi giờ lần nữa.

Trigger được quản lý riêng qua `prisma/sql/calendar_triggers.sql` và lệnh `npm run db:calendar-triggers`, không đưa thao tác trigger vào migration. Prisma Client cần được generate/build theo schema mới khi triển khai. Database đã chạy hai migration tách riêng trước đây cần đối chiếu lịch sử migration trước khi triển khai bản gộp; không chạy lại lệnh thêm cột trên database đã có `deleted_at`.

Consumer HMO nằm ở dự án khác, không thay đổi tại đây. Trước khi đưa vào vận hành, consumer phải nhận được action `delete` và `restore`, gửi payload đầy đủ và xử lý đúng thứ tự theo cùng `c_key` (bao gồm job từ các operation khác nhau). Các trường operation/sequence hiện có không tự bảo đảm thứ tự nếu consumer không sử dụng chúng. Không gọi HMO trong kiểm thử.

Lịch đã xóa cứng trước migration không tự xuất hiện lại trong LMS. Cần đối soát riêng nếu còn key đã xóa trên HMO mà LMS không còn bản ghi hoặc lịch sử.

## Kiểm thử

- Kiểm tra kiểu: `tsc --noEmit` ở API và frontend.
- Hồi quy: calendar-source, calendar-filter, lesson-calendar-sync, shared-staff-schedule, livestream-bulk-conflict, calendar-user-sync, calendar-teaching-user-revocation.
- Integration chỉ chấp nhận localhost và cổng khác 3306, tên database `calendar_soft_delete_*test`. Tạo schema và trigger trên một MySQL thử nghiệm riêng trước khi chạy:

```sh
TEST_CALENDAR_SOFT_DELETE_DATABASE_URL='mysql://root@127.0.0.1:13327/calendar_soft_delete_test' npm run test:calendar-soft-delete:integration
```

Integration kiểm tra: giữ bản ghi khi xóa, lọc đọc/ghi mặc định, không trùng queue khi xóa lại, self restore, xung đột lịch, đề cương thay đổi, snapshot không bị sửa theo đề cương, key reuse với payload/mapping mới, rollback khi ghi log lỗi, gán mapping trễ, resend, các luồng single/bulk/internal import, trigger và Feed. Dữ liệu kiểm thử dùng mã chương trình riêng mỗi lần chạy; không dùng database vận hành.
