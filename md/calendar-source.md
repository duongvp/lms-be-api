# Nguồn lịch suy ra từ mã chương trình

Contract hiện tại ngày 14/10/2026, thay thế phương án lưu `calendar_source` trên calendar.

- Mã bắt đầu bằng `feed-` (không phân biệt hoa/thường) thuộc Feed; các mã khác thuộc Livestream.
- Tạo chương trình có chọn nguồn, mặc định Livestream. Với Feed chỉ thêm `feed-` vào mã được sinh bằng quy tắc Topclass/Topuni hiện có; backend cũng đảm bảo prefix nếu client gửi nguồn Feed.
- Ví dụ: `nguvan-8-2027` / `feed-nguvan-8-2027`, `tongontoantsav2027` / `feed-tongontoantsav2027`.
- Không lưu nguồn ở chương trình hoặc calendar. `calendar_source` trong bộ lọc/response là thông tin suy ra từ mã để giữ tương thích UI/API; Prisma calendar không có field nguồn.
- Modal thêm mới, tạo tự động, sửa hàng loạt chung/riêng không có ô chọn nguồn. Sửa lịch không đổi nguồn độc lập với mã chương trình.
- Bộ lọc mặc định Livestream; Feed lọc `code LIKE 'feed-%'`. Danh sách chương trình của bộ lọc chỉ hiển thị mã thuộc nguồn đang chọn; đổi nguồn xóa mã đang chọn nếu không khớp.
- Kiểm tra xung đột giáo viên/trợ giảng giới hạn trong cùng nhóm prefix. Cùng số bài và giờ giữa chương trình Live và bản Feed của chương trình được phép tạo. Trong cùng nguồn vẫn giữ kiểm tra trùng.
- Quy tắc key Livestream giữ nguyên. Key Feed chứa mã chương trình `feed-...`, nên khác key Livestream mà không cần thêm namespace riêng.
- Trigger INSERT/UPDATE/status giữ nguyên thân/payload/điều kiện cũ, chỉ thêm `AND NEW.code NOT LIKE 'feed-%'`. Service queue, resend, EVG, HMO matching, banner cũng nhận diện từ code. Cron tự động đồng bộ học viên chỉ xử lý nguồn Livestream; chương trình Feed bị loại trước khi lấy package/gọi API, thêm enrollment hoặc đánh dấu student_synced_at. Thao tác đồng bộ học viên thủ công và các tác vụ Teams/attendance vẫn giữ nguyên.
- Mã chương trình Feed tối đa 30 ký tự, tính cả `feed-`, theo giới hạn hiện có của calendar.code. Không cắt/truncate mã tự động hoặc đổi quy tắc sinh mã.

## Migration cụ thể

Migration: `prisma/migrations/20261014180000_calendar_source_from_program_code/migration.sql`.
Bản SQL chạy trực tiếp cho database có lịch sử migration lệch: `prisma/sql/calendar_source_from_program_code.sql`.

Bản SQL:
1. Nếu cột nguồn cũ còn tồn tại, so sánh mọi giá trị với nguồn suy ra từ code. Nếu không khớp, CHECK constraint chặn chạy trước khi thay trigger/drop cột; không tự sửa hay đổi mã dữ liệu cũ.
2. Thay 3 trigger bằng điều kiện prefix.
3. Bỏ cột nguồn cũ nếu tồn tại. Không thay ID, key, mapping, dữ liệu ở các cột khác, index hoặc queue cũ.

Tạm dừng thao tác ghi calendar khi chạy SQL vì MySQL DDL không transactional. Bản SQL có thể chạy lại khi cột đã được bỏ. Không chạy toàn bộ migrate deploy lên database vận hành đang lệch lịch sử migration.

Đã đọc thống kê database vận hành: 3.740 lịch, tất cả nguồn Livestream, không có mã feed-. Cột nguồn đã được thêm theo lần phê duyệt chỉ ADD COLUMN trước đó. **Chưa chạy bản SQL bỏ cột/thay trigger lên database vận hành; cần xác nhận riêng cho việc bỏ cột đã tồn tại.** Code mới không còn phụ thuộc cột này, nhưng trigger trên môi trường đích cũng phải được đổi trước khi ghi lịch Feed.

## Kiểm chứng

- 235 test TypeScript backend và 25 test JavaScript backend pass; backend build thành công.
- Integration MySQL 8 riêng pass: toàn bộ lịch sử migration + migration prefix, bảo toàn dữ liệu/queue, chặn dữ liệu không khớp nguồn trước DDL, bỏ cột thật, trigger lowercase/uppercase Feed, single/bulk/auto, update chung/riêng, bộ lọc, EVG/resend, import ORM/raw SQL, lịch bù và chạy lại SQL.
- Frontend typecheck và test payload/helper pass; Chrome với component thật và API mock kiểm tra form tạo chương trình prefix, toggle nguồn, submit; các modal lịch không còn source picker; mở modal không nhấp nháy.
- Không gọi API Học Mãi/Teams thật và không đổi dữ liệu/database vận hành trong lần chuyển sang prefix này.

Các tài liệu kế hoạch cũ được giữ lại để truy vết, nhưng contract hiện tại là nội dung trên.


## Audit hồi quy ngày 15/10/2026

Rà soát bổ sung theo yêu cầu giữ nguyên nghiệp vụ cũ đã tìm thấy ba điều kiện
`calendar_source` còn sót trong truy vấn dời chuỗi. Integration MySQL đã tái hiện
lỗi `Unknown argument calendar_source` trước sửa; đã bỏ các điều kiện này vì
`code` đã xác định đúng chương trình và nguồn. Các quy tắc chọn slot, đổi key,
copy mapping, log và queue của dời chuỗi được giữ nguyên.

Kiểm tra bổ sung và sửa liên quan nguồn:
- Auto-schedule suy ra nguồn sau khi trim mã chương trình; không phân loại sai
  ` feed-QA ` thành Livestream rồi phát sinh lỗi lúc commit.
- Chặn liên kết bài học Feed vào lịch Livestream và ngược lại; không đổi quy tắc
  liên kết giữa các mã Livestream cũ.
- Test dời chuỗi Live/Feed và dời sau nghỉ học khi cột nguồn đã bị bỏ thật;
  bảo toàn key/mapping, giữ queue Live, Feed không có queue và không chạm nguồn kia.
- Test trùng giáo viên/trợ giảng giữa các chương trình cùng nguồn và rollback
  toàn bộ calendar/queue khi lô sửa có một dòng xung đột.
- Test key Livestream đúng định dạng cũ; Teams outbox và enrollment giáo viên
  Feed vẫn hoạt động; cập nhật tên bài từ đề cương vẫn áp dụng cho cả hai nguồn.
- Fixture unit đồng bộ học viên bổ sung mock thao tác đánh dấu student_synced_at
  vốn chưa mock, để test không phụ thuộc bảng calendar trên database bên ngoài;
  không đổi code nghiệp vụ đồng bộ học viên.

Kết quả cuối: **236 test backend TypeScript, 36 test frontend, 25 test backend
JavaScript đều pass**, build/typecheck và Chrome pass. Integration MySQL riêng
pass sau khi đã chứng minh lỗi trước sửa. Không gọi Học Mãi/Teams thật, không chạy
SQL bỏ cột/thay trigger trên database vận hành; xác nhận cho bước DB vẫn đang chờ.
