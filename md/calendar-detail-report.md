# Báo cáo chi tiết buổi học

Giai đoạn 2 được người dùng chấp thuận ngày 21/10/2026. Bản đầu chỉ đọc nguồn đã khảo sát trong [kế hoạch](calendar-detail-report-plan.md). Không migration, seed, index, trigger hoặc thay đổi logging runtime. Feature `waiting_video_playlist` tiếp tục ở stash.

## Sử dụng

Mở **Báo cáo lớp học theo chương trình / buổi → Xem chi tiết** trên một dòng. Phạm vi chi tiết là đúng `calendar.id`, giữ room nếu mở từ dòng room. Không mở rộng theo cột tổng cả lịch 1/2. Modal tổng hợp giữ trạng thái khi đóng chi tiết.

Modal có thống kê, danh sách học sinh, tìm tên/username/HMID, lọc chuyên cần/room/chat/bản ghi kiểm duyệt và phân trang backend. Bấm tên để mở drawer; các tab tham gia/chat/kiểm duyệt/quiz tải độc lập khi chọn. Nhật ký buổi có tìm học sinh, chọn nguồn, lọc giờ, thứ tự thời gian và phân trang cursor. Chat có tìm nội dung nguyên bản đã lưu, không render HTML.

## Quyền

Mọi route bắt buộc đăng nhập, `calendar.view` **và** `calendar.report.detail.view`, cùng phạm vi chương trình từ bài liên kết (`lessons.subject_code`), không tin mã do client gửi.

| Quyền thêm | Dữ liệu |
|---|---|
| `calendar.report.chat.view` | Thống kê/nội dung chat |
| `calendar.report.moderation.view` | Bản ghi hạn chế và ẩn/khôi phục |
| `quiz.view` | Metadata nộp quiz; không trả đáp án |
| `calendar.export` **và** `calendar.report.detail.export` | Xuất; vẫn cần quyền xem nguồn tương ứng |

Tài khoản admin hoặc `*` dùng theo cơ chế hiện có. Permission mới chỉ được khai báo trong source seed; **chưa chạy seed hoặc gán quyền DB**. Không tự gán các quyền nhạy cảm này cho manager/teacher qua bộ lọc prefix. Non-admin cần cấp riêng các quyền theo vai trò khi triển khai.

Chính sách trường cũng phải cho xem `users.username/student_hmid/name/room_id` và `calendar.code/learn_number/lesson_name/teacher/assistant_teacher/start_time/end_time`. Thiếu trường cần thiết trả 403 trước khi đọc dữ liệu chi tiết; không lách chính sách bằng API báo cáo/Excel. Email chỉ dùng nội bộ đối chiếu restriction, không trả cho client. Không trả IP, URL, đáp án quiz hay stream key.

## API

Base: `/api/livestreams/room-report/calendars/:calendarId`.

| GET | Kết quả |
|---|---|
| `/overview` | Thống kê và chất lượng dữ liệu |
| `/students` | Overview + `rows,total,page,limit` |
| `/students/:studentId` | Học sinh + restriction snapshot nếu được phép |
| `/timeline` | Nhật ký cả buổi, chỉ nguồn được phép |
| `/students/:studentId/events` | Nhật ký học sinh thuộc roster/room |
| `/live-times` | EVG tải riêng, HH:mm sớm nhất–muộn nhất trên UI |
| `/export/students` | Excel toàn bộ kết quả lọc, không chỉ trang hiện tại |
| `/students/:studentId/export` | Excel một nguồn nhật ký; bắt buộc `source` cụ thể |
| `/students/:studentId/export-restrictions` | Excel snapshot hạn chế hiện lưu, cùng code+bài qua mọi ngày |

`studentId` là `users.id` của enrollment, không phải HMID. Không truy vấn học sinh ngoài roster/phạm vi room. Dữ liệu trong envelope `{success:true,data:...}`.

Bộ lọc danh sách: `room_id` (số dương hoặc `unassigned`), `q` ≤200 ký tự, `attendance=all|attended|observed|unobserved`, `chat=all|yes|no`, `moderation=all|yes|no`, `sort=name|first_seen|chat_count`, `order=asc|desc`, `page` mặc định 1, `limit` mặc định 50 tối đa 100. Lọc trước khi cắt trang. `refresh=true` bỏ cache snapshot/context.

Nhật ký: `source=all|presence|chat|moderation|activities`, `q` tìm nội dung chat, `from/to` ISO UTC **biểu diễn thành phần giờ DB** như `2026-10-20T18:00:00.000Z`; cửa sổ `[from,to)` luôn giao với phiên của lịch. Không cộng +7 lần nữa. Cursor gắn calendar/enrollment/room/bộ lọc/quyền, thứ tự timestamp + nguồn + BigInt ID. Mỗi nguồn chỉ SELECT `limit+1`, hợp nhất tại backend; không trả toàn bộ chat cho FE. `next_cursor=null` là hết trang. Không dùng số trang cho nhật ký.

Excel dùng cùng resolver/bộ lọc, tối đa 20.000 dòng; vượt giới hạn trả 422 trước khi gửi file, không cắt âm thầm. Xuất nhật ký bắt đầu từ đầu bộ lọc, không chỉ trang cursor đang xem. Giữ BigInt dạng chuỗi và nội dung dạng text, không tạo công thức từ chat. Snapshot hạn chế được xuất riêng và ghi rõ không phải lịch sử. Thiếu bảng ẩn/khôi phục thì không xuất một lịch sử trống có vẻ đầy đủ.

## Định nghĩa và giới hạn

- Chuyên cần dùng chung counter với tổng hợp: hai status=2 liên tiếp trong một phiên; status khác ngắt chuỗi. Không ghép qua EVG session khác. Một enrollment có nhiều log/phiên vẫn một dòng. Giữ nguyên hành vi tổng hợp.
- Roster đối chiếu class_id dựng bằng helper và history phân bổ đúng calendar; loại giáo viên/trợ giảng cả username và HMID. Roster hiện lưu không phải snapshot enrollment tại thời điểm buổi học.
- Presence không lưu room/calendar ID. Room trong roster là **phân bổ**, không khẳng định phòng thực sự tham gia. Lịch cùng code+bài chồng giờ được cảnh báo, không tự phân biệt log bằng lịch ID chưa có ở nguồn.
- `first_seen/last_seen` là MIN/MAX log đã ghép; không phải vào/rời phòng chính xác. `duration_minutes,last_leave,reconnect_count,join_count,leave_count,ban_events,banned_students` chưa đủ căn cứ nên null. Số status=1 hoặc socket ID khác nhau chỉ là số bản ghi/định danh, không gọi là số lần join/reconnect.
- Chat thống kê chỉ role student, type 1/2, HMID khớp roster và class_id đúng ngày/bài/room; không cộng broadcast/type3, quiz/type4 hoặc staff. Chat có HMID trùng enrollment để null, nêu cảnh báo và không cộng trùng. Chat chưa ghép/ambiguous được đếm riêng trong `data_quality`. Timeline cho xem các bản ghi thực lưu, có role/type/status và nhãn identity matched/unmatched/ambiguous; không tái tạo nội dung null.
- `users_block` là snapshot cho cùng code+bài qua mọi ngày. Không dùng updated_at làm thời điểm mở cấm, không tự gán actor từ cột `user` hoặc diễn giải type. Tab/sheet ghi rõ giới hạn này.
- `chat_hidden_rules` đọc raw SELECT có tham số; phân biệt sự kiện tạo ẩn và restored_at/restored_by, không coi đó là cấm chat. Môi trường thiếu bảng trả `hidden_rules_available=false`, UI cảnh báo và không cho lọc “không có kiểm duyệt” như dữ liệu đầy đủ.
- Quiz chỉ metadata nộp bài từ `quiz_logs`; answer_seconds là thời gian làm bài. Không suy diễn hành động của giáo viên từ `quiz_session_logs` chưa đủ contract. Không tự tạo sự kiện camera/micro/mất mạng.
- Giá trị null khác số 0, không có bản ghi khác lỗi/403 hoặc thiếu nguồn.

## Hiệu năng

Một lịch mỗi request, không N+1 theo học sinh; roster, attendance và thống kê từng nguồn đọc riêng, không join nhân attendance × chat × moderation. Attendance đọc các đoạn một giờ, giữ thứ tự timestamp/ID và counter qua biên giờ. Mỗi log chỉ đếm một lần khi webhook chồng lấn; mỗi phiên vẫn có chuỗi riêng.

Context/snapshot cache tối đa 20 phạm vi, TTL 30 giây tính sau khi tải xong; quyền luôn kiểm tra lại trước cache. Bộ lọc/trang dùng lại snapshot; refresh chủ động xóa. Tối đa 3 snapshot build đồng thời mỗi process, quá tải trả 503 dễ thử lại. Giới hạn 30.000 enrollment, 200.000 log và tổng thời gian các cửa sổ 72 giờ; vượt trả 422 minh bạch. API đọc nhật ký không chạy lại attendance. Không thêm index. Phép so sánh class_id canonical dùng BINARY tại SELECT để tránh mix collation giữa nguồn chat và connection.

## Kiểm tra

Chỉ test cô lập/mock và SELECT trên DB đang kết nối; không chạy integration có fixture ghi DB.

- `npm run test:calendar-detail-report`: validation, scope/permission AND, field policy, source capability, cursor/BigInt, room 1/10/12, lọc trước phân trang, Excel, staff, join lại, phiên chồng lấn, không ghép qua phiên, null dữ liệu thiếu, missing-table, cache, identity mơ hồ.
- `npm run test:calendar-room-report`: 24 ca hồi quy tổng hợp.
- `npm run test:evg-recordings`: 9 ca nguồn EVG.
- TypeScript FE/BE: `./node_modules/.bin/tsc --noEmit --incremental false`.
- FE client: `node --test tests/calendar-detail-report-service.test.cjs` kiểm tra URL/phạm vi bộ lọc và tách export snapshot hạn chế khỏi event export.
- FE: `node tests/calendar-detail-report.e2e.cjs` trên viewport 390 và 1366; kiểm tra lazy tab, bỏ phản hồi chat cũ, quyền, export scope, giữ tổng hợp, grid mobile hai cột. `node tests/calendar-room-report-live-times.e2e.cjs` hồi quy EVG tải riêng.

SELECT đối chiếu ngày 21/10/2026 với lịch #1898 (`tienganh-10-2027`, bài 13): detail và summary cùng **22/278**. Mẫu chạy đầu 206–259 ms cho snapshot, 11–45 ms/trang nhật ký, 1 ms khi lọc lại cache. Đây là số đo đơn lẻ, không phải p95 hoặc cam kết tải đồng thời.

Đối chiếu lớp lớn #694 (`tongontoantcv2027`): detail và summary cùng **3.013/15.760**. Các lần đọc đầu quan sát dao động khoảng 5,9–27,9 giây trong quá trình tối ưu; lọc/trang từ cache khoảng 37–49 ms. EXPLAIN xác nhận `users_logs` dùng range trên `idx_logs_time`, partition `p2026q4`; không thêm index. Bản cuối đọc tối đa hai đoạn giờ song song và tiêu thụ đúng thứ tự. Chưa có benchmark p95 hoặc tải đồng thời; không dùng số đo lớp nhỏ để cam kết tốc độ lớp lớn.
