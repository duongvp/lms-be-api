# Khảo sát và kế hoạch báo cáo chi tiết lớp học theo chương trình / buổi

**Giai đoạn 1 — chờ xem xét, chưa triển khai.**  
Ngày khảo sát: 21/10/2026, múi giờ Việt Nam.

Tài liệu được lập từ source hiện có và các truy vấn SELECT/SHOW metadata trên database backend đang cấu hình. Không sửa source, schema, phân quyền hoặc dữ liệu trong giai đoạn này; không tạo index và không chạy migration/seed/test integration có ghi DB. Những thay đổi đã có từ các yêu cầu trước được giữ nguyên.

**Kết luận:** Có thể xây dựng ngay phần danh sách học sinh, chuyên cần theo quy tắc hiện tại, tra cứu log, chat đã lưu và một phần dữ liệu kiểm duyệt. Chưa đủ bằng chứng để công bố chính xác giờ rời phòng, tổng thời gian học, số lần mất kết nối, toàn bộ lịch sử cấm/mở cấm hoặc camera/micro. Các mục thiếu dữ liệu phải trả `null` kèm lý do, không thay bằng `0` hoặc tự tạo sự kiện.

## 1. Luồng báo cáo tổng hợp hiện tại

1. Trang quản lý lịch dựng phạm vi qua `buildCalendarRoomReportParams`: chương trình, nguồn livestream/feed, ngày, bộ lọc cột và ID lịch được chọn.
2. `CalendarRoomReportModal` gọi báo cáo với `include_recordings=false`. Backend phân quyền rồi lấy lịch bằng `livestream.service.getCalendar(..., rawRowsOnly=true)`.
3. Với các lịch được hiển thị, backend tìm thêm lịch cùng `calendar.code + learn_number` để cột tổng có cả lịch 1/lịch 2 ngoài ngày hoặc trang đang xem. Việc tìm thêm vẫn đi qua lister có phân quyền.
4. `buildReportWindows` ghép callback EVG theo kênh và khoảng thời gian, tạo cửa sổ cho từng phiên. Thiếu giờ thực tế thì dùng giờ lịch theo quy tắc hiện có.
5. Lấy roster `users`, đối chiếu `class_id` và lịch sử phân lớp của đúng `calendar.id`, loại giáo viên/trợ giảng theo cấu hình và `teacher_profiles`.
6. Đọc `users_logs` theo cửa sổ phiên. Đối chiếu username/HMID; học sinh đủ chuyên cần khi có hai `status=2` liên tiếp trong cùng phiên. `status=1` hoặc trạng thái khác ngắt chuỗi; không ghép qua phiên EVG khác.
7. Hợp nhất danh tính qua các phiên: một dòng mỗi lịch, hoặc mỗi lịch + room; không cộng trùng học sinh. Cột theo lịch/room và cột tổng cùng chương trình + số bài có phạm vi khác nhau.
8. Giờ live thật tải riêng qua `/room-report/live-times`, lấy `evg_stream` gọi API MP4 EVG, lọc ngày lịch và gộp bắt đầu sớm nhất/kết thúc muộn nhất, hiển thị HH:mm. **Khoảng này là thời gian phát của lớp, không phải tổng thời gian học của một học sinh.**
9. Excel hiện dùng cùng service báo cáo; có kiểm tra cả quyền xem và quyền xuất. UI phân trang 20 lịch/trang; export hiện giới hạn 2.000 lịch.

Điểm mở rộng phù hợp: thêm thao tác **Xem chi tiết** trên dòng của modal báo cáo, truyền `calendar_id` và `room_id` nếu dòng đang ở chế độ từng room. Không dùng mã chương trình + số bài làm khóa duy nhất và không dùng ID phiên EVG thay ID lịch.

## 2. API, service, component và database đã xác minh

### 2.1. Source và API hiện có

| Thành phần | Nguồn thực tế | Trách nhiệm |
|---|---|---|
| Trang lịch | [schedule/page.tsx](/home/ubuntu/Documents/LMS/LMS.FE/app/(admin)/schedule/page.tsx:5268) | Mở modal, truyền bộ lọc/ID lịch |
| Bộ lọc báo cáo | [scheduleFilters.ts](/home/ubuntu/Documents/LMS/LMS.FE/helper/scheduleFilters.ts:59) | Chuẩn hóa phạm vi từ trang lịch |
| Modal tổng hợp | [CalendarRoomReportModal.tsx](/home/ubuntu/Documents/LMS/LMS.FE/app/(admin)/schedule/components/Modal/CalendarRoomReportModal.tsx:16) | Bảng, hai chế độ hiển thị, room, phân trang, Excel, tải giờ live riêng; chưa có thao tác mở chi tiết học sinh |
| Client API | [livestreamService.ts](/home/ubuntu/Documents/LMS/LMS.FE/services/livestreamService.ts) | Gọi API báo cáo |
| Router | [livestream.route.ts](/home/ubuntu/Documents/LMS/lms-manage-api/src/modules/livestream/livestream.route.ts:135) | Xác thực và phân quyền |
| Controller | [livestream.controller.ts](/home/ubuntu/Documents/LMS/lms-manage-api/src/modules/livestream/livestream.controller.ts:39) | Tạo lister theo quyền, xuất workbook |
| Service tổng hợp | [calendar-room-report.service.ts](/home/ubuntu/Documents/LMS/lms-manage-api/src/modules/livestream/calendar-room-report.service.ts:39) | Counter chuyên cần, cửa sổ phiên, roster và tổng hợp |
| Lister/phạm vi chương trình | [livestream.service.ts](/home/ubuntu/Documents/LMS/lms-manage-api/src/modules/livestream/livestream.service.ts:2852) | Quyền lịch theo bài liên kết/legacy; lấy lịch thô |
| Quy tắc class_id | [calendar-user-sync.service.ts](/home/ubuntu/Documents/LMS/lms-manage-api/src/modules/livestream/calendar-user-sync.service.ts:117) | `code + ExcelDate(ngày lịch) + learn_number + room_id` |
| Bản ghi EVG | [evg-recordings.service.ts](/home/ubuntu/Documents/LMS/lms-manage-api/src/integrations/evg-recordings.service.ts) | GET bản ghi, xử lý 429/cache, gộp giờ phát |
| Phân quyền | [auth.middleware.ts](/home/ubuntu/Documents/LMS/lms-manage-api/src/modules/auth/auth.middleware.ts), [authorization.service.ts](/home/ubuntu/Documents/LMS/lms-manage-api/src/services/authorization.service.ts) | Permission, scope chương trình, admin |

Các route dưới base thực tế `/api/livestreams`:

- `GET /room-report`: `calendar.view` + kiểm tra phạm vi lịch/chương trình.
- `GET /room-report/live-times`: cùng quyền xem, chỉ lấy giờ của các lịch được phép.
- `GET /room-report/export`: quyền xem **và** `calendar.export`, giao của hai phạm vi.
- `GET /api/quizzes/...` hiện quản trị **nội dung quiz**, không phải API lịch sử hoạt động của học sinh.

### 2.2. Bảng và view

| Nguồn | Khóa/cột liên quan | Ý nghĩa xác minh được |
|---|---|---|
| `calendar` | `id`, `code`, `learn_number`, `session_id`, thời gian, giáo viên/trợ giảng, `evg_stream`, `channel_name` | Lịch học cụ thể |
| `lessons` | `id`, `subject_code`, trạng thái | Chương trình dùng cho phân quyền có thể khác `calendar.code` |
| `users` | `id`, `username`, `student_hmid`, `name`, `code`, `learn_number`, `class_id`, `room_id`, `islearn` | Enrollment hiện có; unique username + code + bài |
| `teacher_profiles` | username/HMID và thông tin nhân sự | Loại nhân sự khỏi chỉ số học sinh |
| `classroom_assignment_history` | `calendar_id`, `user_id`, room/class trước/sau, người tạo, thời gian | Lịch sử **phân bổ** phòng; không phải lịch sử thực sự vào phòng |
| `evg_callbacks` | `live_session_id`, `channel_id`, `channel_name`, `start_on`, `end_on`, loại event | Phiên livestream của kênh, không phải phiên socket của học sinh |
| `users_logs` | `username`, `name`, `code`, `learn_number`, `created_at`, `status`, `session_id`, `source_system`, `learn_date` | Log phục vụ chuyên cần; không có cột room/class, calendar_id, leave_at |
| `logs_chat_new` | `user_hmid`, display name, `mess_id`, `mess_content`, `user_role`, code/bài, `classroom_id`, `mess_status`, `mess_type`, `mess_time`, reply/highlight/source | Có nội dung chat đã lưu và metadata; không có timestamp/người xóa riêng |
| `users_block` | `user_id`, `user`, code/bài, `note`, `expired_at`, `type`, created/updated | Một bản ghi hạn chế hiện lưu cho mỗi user + code + bài; không đủ chứng minh lịch sử cấm/mở cấm đầy đủ |
| **`chat_hidden_rules`** | code/bài/room, `scope`, `mess_id`, `user_hmid`, `hidden_by`, role, reason, created, restored_at/by | Bảng thực tế **ngoài Prisma schema**; có thông tin ẩn/khôi phục theo tin hoặc người dùng |
| `quiz_logs` | username, code/bài, `class_id`, quiz, `ans_info`, score, duration, created | Bản ghi nộp bài. Duration là thời gian làm bài, không phải thời gian học lớp |
| `quiz_session_logs` | username/name, code/bài/quiz, action/status, duration, class/time | Event quiz/quản trị còn phải xác minh người thực hiện và nghĩa action |
| `calendar_change_logs` | calendar, actor, before/after, reason/time | Thay đổi lịch, không phải vi phạm học sinh |
| `users_logs_history`, `users_logs_daily`, `quiz_logs_storage` | Các cấu trúc lưu trữ/ảnh chụp tương ứng | Không tự UNION vào báo cáo; chưa chứng minh vòng đời, độ trùng và đầy đủ |
| `vw_learning_session`, `vw_learning_session_ext` | username, code/bài/date, start/end; view ext có `actual_minutes` | Có trên DB nhưng chưa kiểm tra được định nghĩa, xem mục 4 |

DB metadata ước lượng khoảng 13 triệu dòng chuyên cần, 2,2 triệu chat và 1,36 triệu lịch sử phân lớp. Đây là `TABLE_ROWS` ước lượng, **không phải COUNT chính xác**.

## 3. Đối chiếu yêu cầu với nguồn dữ liệu

| Thông tin cần báo cáo | Nguồn/cách lấy đề xuất | Mức đáp ứng và cách hiển thị |
|---|---|---|
| Thông tin lịch, giáo viên/trợ giảng | `calendar`, lesson liên kết | Có; lấy theo ID lịch sau kiểm tra quyền |
| Giờ dự kiến / live thật | Calendar / reader MP4 hiện có | Có; live hiển thị HH:mm, tải riêng |
| Tổng roster | Roster theo đúng lịch + lịch sử phân lớp, loại nhân sự | Có theo **danh sách hiện lưu**, không bảo đảm là snapshot enrollment tại thời điểm buổi đã diễn ra |
| Đủ chuyên cần | Counter hiện tại, hợp nhất user qua các phiên | Có; giữ nguyên kết quả báo cáo tổng hợp |
| Có ghi nhận nhưng chưa đủ chuyên cần | Có log trong cửa sổ, không đạt counter | Có; không đồng nghĩa xác định được số phút học |
| Chưa có ghi nhận | Roster không khớp log trong cửa sổ | Có; nhãn “Chưa có ghi nhận”, không khẳng định “Vắng mặt” |
| Hoạt động của người ngoài roster | Log/chat không khớp enrollment | Nhóm đối soát riêng, không tự thêm vào tổng roster; danh tính chưa ánh xạ phải được đánh dấu |
| Đầu/cuối hoạt động | MIN/MAX thời gian log đã đối chiếu | Có **mốc ghi nhận đầu/cuối**; không đổi nhãn thành vào/rời phòng thật |
| Tổng thời gian học | Event lifecycle hoặc view đã kiểm chứng | Chưa đủ căn cứ; `null / Chưa xác định`, không lấy last-first |
| Số lần vào/ra/kết nối lại | Writer contract và log lifecycle | Có thể đếm bản ghi theo status/socket, nhưng chưa được gắn nhãn join/leave/reconnect chắc chắn |
| Phòng được phân bổ | History + class_id | Có, tách khỏi phòng đã thực sự tham gia |
| Phòng hoạt động | `classroom_id` của chat, `class_id` của quiz; presence không có room | Chỉ khẳng định theo loại nguồn tương ứng, không suy diễn từ room hiện tại |
| Số chat, người có chat | Chat theo code/bài, class, cửa sổ; đối chiếu roster/nhân sự | Có sau khi chốt role/type; công bố định nghĩa tin học sinh và loại broadcast |
| Nội dung chat nguyên bản đã lưu | `mess_content` | Có trong giới hạn dữ liệu còn lưu (varchar 500); không phục dựng nội dung bị xóa/cắt ở nguồn |
| Trạng thái tin | `mess_status`, rule ẩn/khôi phục | Có trạng thái/rule hiện lưu; không đủ suy ra mọi lần thay đổi hoặc xóa |
| Hạn chế chat hiện lưu | `users_block` | Có dữ liệu hàng, nhưng nghĩa type và user/actor phải được xác minh trước khi kết luận trạng thái cấm |
| Cấm/mở cấm trong buổi | Không thấy event history đầy đủ của `users_block` | Không được suy từ `updated_at` hoặc tự coi hết hạn là thao tác mở cấm của giáo viên |
| Ẩn/khôi phục chat | `chat_hidden_rules` | Có người/thời điểm/lý do được lưu; phân biệt ẩn tin với cấm chat và nêu giới hạn lịch sử |
| Sự kiện quiz | `quiz_logs`, `quiz_session_logs` | Có nguồn để mở rộng tab hoạt động; không tự diễn giải action chưa rõ hoặc biến hành động giáo viên thành hành động học sinh |
| Camera/micro, mất mạng thật | Chưa tìm thấy nguồn bền vững đã xác minh | Không có chỉ số/sự kiện giả; hiển thị thiếu nguồn hoặc chưa cung cấp tab này |

## 4. Giới hạn, mâu thuẫn và các điều kiện cần xác minh

### 4.1. Chuyên cần và thời gian tham gia

- Nghiệp vụ đã thống nhất và code tổng hợp dùng `1 = join`, hai `2` liên tiếp để đạt chuyên cần. Nhưng **comment DB hiện ghi `0=normal, 1=studying, 2=stopped`**. Comment có thể cũ; chưa có source writer để xác nhận. Không đổi quy tắc tổng hợp vì mâu thuẫn này.
- Comment `users_logs.session_id` ghi **Socket session ID for UPSERT**. Chưa chứng minh log luôn append-only hoặc có event rời phòng. Không coi đó là EVG live_session_id.
- Buổi mẫu `tienganh-10-2027`, bài 13, ngày 20/10 trong khoảng 18:00–20:45 có 294 dòng status 1, 867 dòng status 2, không thiếu socket ID ở mẫu. Đây là kiểm tra cấu trúc, không chứng minh đủ lifecycle và không thay số chuyên cần của báo cáo.
- DB có view session và actual_minutes, nhưng lệnh đọc định nghĩa bị từ chối quyền `SHOW VIEW`. Chỉ xác minh được tên cột. Không dựa vào tên `actual_minutes` để công bố số phút chính xác; cần được cung cấp định nghĩa và quy tắc nguồn.
- Chưa xác định writer của attendance/chat/moderation trong ba project hiện có (`LMS.FE`, `lms-manage-api`, `live-user-sync`). `live-user-sync` đồng bộ enrollment; socket FnB trong FE không phải socket lớp học. Tài liệu cũ `md/quiz-review.md` chỉ là đầu mối về runtime khác, không thay cho source hiện chạy.

### 4.2. Chat và kiểm duyệt

- Buổi mẫu trên có chat `mess_status=sent`, khác default `active` trong Prisma. Không hardcode chỉ `active`.
- Có 24 dòng chat thường `mess_type=1` mang role student từ 14 HMID; đồng thời có **120 dòng `mess_type=3` cũng mang role student từ một HMID**. Comment type 3 là broadcast. Chưa đủ xác định đó là chat học sinh thật hay phát tới nhiều room; cần writer contract và đối chiếu nhân sự. Không cộng máy móc `user_role=student` thành tương tác học sinh.
- `logs_chat_new` unique `(mess_id, mess_time)`. Không mặc định mess_id đơn lẻ là duy nhất toàn hệ thống; không tự dedup nội dung giống nhau. Phải phân biệt lượt lưu/lượt phân phối với tin nhắn logic nếu runtime có broadcast.
- `users_block` unique `(user_id, code, learn_number)` nên không thể giữ độc lập mọi lần cấm của cùng người/bài. `user_id` được mô tả là HMID **hoặc email**; `user` chưa xác định là học sinh hay người thao tác. Không gán actor từ tên cột.
- Mẫu toàn bảng block hiện có type 1, nhưng không có mapping type được xác minh. Chưa được kết luận type 1 tương đương một loại vi phạm cụ thể.
- `chat_hidden_rules` có 6 hàng trong lần khảo sát, scope message/user, các hàng đều có restored_at. Có thể trình bày cặp ẩn/khôi phục còn lưu; **chưa chứng minh writer luôn append-only**, nên không hứa đầy đủ mọi chu kỳ ẩn/khôi phục.
- Không tìm thấy permission chat/report/moderation riêng trong danh mục permission hiện tại. Quyền xem lịch hiện hữu không tự động đủ để đọc nội dung chat/hạn chế của học sinh.

### 4.3. Phạm vi và danh tính

Phân biệt ba ID: `calendar.session_id` là bài liên kết; `evg_callbacks.live_session_id` là phiên phát; `users_logs.session_id` là socket. Không join ba cột này trực tiếp.

Khóa chi tiết là **calendar.id**. Phân quyền phải dùng chương trình từ `lessons.subject_code`/logic legacy hiện có, không tin code client gửi và không mặc định calendar.code luôn là mã phân quyền.

class_id ghép không có dấu phân cách; phải so khớp **toàn bộ ID dựng từ helper**, không dùng LIKE tiền tố đơn giản (room 1 dễ lẫn room 10/12). Ngày + số bài + room không phân biệt được hai lịch cùng code/bài/ngày/room nhưng khác giờ; khi có lịch chồng giờ và dữ liệu không có calendar_id, phải đánh dấu mơ hồ thay vì tự gán.

## 5. Thiết kế UI/UX đề xuất

### 5.1. Điểm mở và phạm vi

Thêm nút/link **Xem chi tiết** trên từng dòng tổng hợp. Mở modal chi tiết nhất quán với Ant Design hiện tại, giữ modal tổng hợp/bộ lọc/trang đang xem. Mobile dùng modal toàn chiều rộng, thẻ thống kê hai cột, tránh dồn mọi nội dung thành một cột dài.

Mặc định chi tiết theo **đúng lịch của cột theo lịch**; nếu mở từ room thì giữ room đó. Không tự mở rộng theo cột tổng gồm lịch 1/lịch 2. Header luôn hiển thị ID lịch, chương trình, số bài, ngày và phạm vi room để tránh nhầm.

### 5.2. Modal buổi học

- Header: thông tin lịch, giáo viên/trợ giảng, giờ dự kiến và giờ live HH:mm tải độc lập.
- Thống kê: roster; đủ chuyên cần; có ghi nhận nhưng chưa đủ; chưa có ghi nhận; chat học sinh theo định nghĩa đã duyệt; số người có chat. Chỉ số không được phép xem/thiếu nguồn trả trạng thái riêng, không hiển thị 0.
- Tab **Học sinh**: tìm tên/username/HMID, lọc trạng thái chuyên cần, room phân bổ, có chat, có dữ liệu hạn chế/kiểm duyệt. Phân trang backend mặc định 50, tối đa 100 dòng. Cột ghi nhận đầu/cuối; cột thời lượng ghi “Chưa xác định” khi thiếu căn cứ.
- Tab **Nhật ký buổi**: lọc học sinh, loại nguồn/sự kiện, room, thời gian; cursor theo timestamp + nguồn + ID. Chỉ tải tab khi mở.
- Tách số liệu roster với hoạt động chưa ghép được danh tính; không âm thầm bỏ hoặc ghép vào người cùng tên.

### 5.3. Drawer học sinh

Các tab tải độc lập và có phân trang:

1. **Tổng quan**: thông tin, chuyên cần, mốc ghi nhận, chat và giới hạn nguồn.
2. **Ghi nhận tham gia**: log gốc theo thời gian, socket ID khi cần đối soát; chỉ gọi “phiên tham gia/giờ vào-ra” sau khi xác minh được lifecycle. Phân biệt không có leave với leave đúng giờ.
3. **Chat**: nguyên văn đã lưu, thời gian, phòng, role/type/status; tìm nội dung và lọc giờ. Không dựng lại nội dung đã mất.
4. **Hạn chế & kiểm duyệt**: hai nhóm riêng: bản ghi hạn chế hiện lưu và ẩn/khôi phục chat. Phần lịch sử chưa đủ nguồn có chú thích cụ thể.
5. **Hoạt động khác**: quiz đã xác minh. Camera/mic không có nguồn thì không tạo timeline giả.

Mọi tab có loading/empty/error riêng; lỗi EVG không chặn danh sách, lỗi tab chat không làm mất thông tin chuyên cần. Dùng quyền/capabilities để ẩn dữ liệu nhạy cảm và phân biệt `forbidden`, `not_recorded`, `not_verified`, `no_matching_records`.

## 6. API và phương án truy vấn đề xuất

**Toàn bộ endpoint dưới đây là đề xuất mới, chưa tồn tại.** Base `/api/livestreams/room-report/calendars/:calendarId`.

| GET endpoint | Trách nhiệm |
|---|---|
| `/overview` | Lịch, scope, chất lượng nguồn/capabilities; các chỉ số có thể tính đúng |
| `/students` | Tìm kiếm/lọc/phân trang roster + thống kê liên quan |
| `/students/:enrollmentId/overview` | Thông tin một enrollment đã xác minh thuộc lịch |
| `/students/:enrollmentId/presence` | Trang log/phiên ghi nhận; cursor timestamp + ID |
| `/students/:enrollmentId/chat` | Chat của đúng danh tính trong đúng lịch và room |
| `/students/:enrollmentId/moderation` | Bản ghi hạn chế/rule ẩn-khôi phục được phép đọc |
| `/students/:enrollmentId/activities` | Quiz/sự kiện đã có contract |
| `/timeline` | Nhật ký toàn buổi, cursor; chỉ tổng hợp nguồn được phép |
| `/export/students` | Excel theo cùng scope/bộ lọc của danh sách |
| `/students/:enrollmentId/export/:dataset` | Allowlist chat/presence/moderation, đúng quyền và scope |

Đặt route tĩnh hiện có trước route mở rộng; kiểm tra không xung đột `/live-times`, `/export` và các route lịch khác.

### 6.1. Quy trình truy vấn

1. **Resolve scope một lần**: parse ID; kiểm tra lịch, nguồn, chương trình phân quyền; lấy room filter hợp lệ; lấy cửa sổ phiên bằng logic tổng hợp. Client không được cung cấp khoảng thời gian để vượt scope server.
2. **Roster**: lọc code + bài, exact class_id hoặc lịch sử của calendar như baseline; loại nhân sự; phân trang ở backend. Phân biệt room phân bổ với room có bằng chứng hoạt động.
3. **Chuyên cần**: tái sử dụng counter hiện tại qua helper chỉ đọc, không đổi thuật toán hoặc `islearn`. Tính đủ chuyên cần/đầu-cuối/có ghi nhận một lần theo scope. Danh sách lọc trạng thái chuyên cần cần tập kết quả tổng hợp trước khi LIMIT, không LIMIT trước rồi mới lọc làm sai total.
4. **Chat count**: GROUP BY danh tính đã chuẩn hóa trên chat đã giới hạn code/bài + cửa sổ + class hợp lệ. Join với danh sách kết quả đã tổng hợp, không join trực tiếp toàn bộ log × chat × block.
5. **Trang học sinh**: lấy metadata theo batch ID; chỉ lấy thống kê cần cho trang. Không gửi toàn bộ log hoặc tin nhắn của cả lớp xuống browser.
6. **Chi tiết chat/presence**: truy vấn theo danh tính + scope; cursor sắp xếp `(time,id)`, lấy limit+1. Với chat phải đối chiếu HMID trong roster; không nhận tùy ý một HMID/email rồi trả lịch sử toàn hệ thống.
7. **Moderation**: users_block chỉ là dữ liệu hiện lưu; history rule lọc theo thời điểm tạo/khôi phục có liên quan, không chỉ `created_at >= from` nếu đang tìm rule đã có từ trước. Nếu rule không có room hoặc ngày đủ phân biệt lịch 1/lịch 2, trả scope `program_lesson` cùng giới hạn, không khẳng định nó thuộc riêng lịch đang xem.
8. **Timeline**: mỗi nguồn đọc tối đa limit+1, gộp ở backend theo khóa ổn định; cursor gồm timestamp + source rank + ID. Không tải mọi tin nhắn rồi mới sắp xếp trên FE. Thời gian trùng nhau có thứ tự hiển thị ổn định nhưng không tự suy ra quan hệ nhân quả.

Scope thời gian mặc định dùng cùng hợp các `ReportWindow` của lịch, biên `[from,to)`, để chuyên cần đối chiếu được với tổng hợp. Không dùng khoảng HH:mm đã gộp để nối hai phiên và tạo chuỗi chuyên cần qua chỗ gián đoạn. Cần công bố scope cửa sổ thực tế trong overview; bất kỳ mở rộng ra ngoài scope phải là thay đổi nghiệp vụ được duyệt riêng.

### 6.2. Ngữ nghĩa response và thời lượng

Response có `scope`, `capabilities`, `data_quality`, `computed_at` và các số liệu thực tính. Khi chưa tính được thời lượng: `duration_seconds: null`, `duration_quality: not_verified`; dùng `first_observed_at/last_observed_at` thay cho first_join/last_leave chưa được chứng minh.

Chỉ sau khi có lifecycle đáng tin cậy mới tạo interval join→leave; cắt theo cửa sổ phiên, lấy **hợp các interval** để không cộng trùng, không kéo interval thiếu leave đến giờ tan học. Bản ghi thiếu đóng phải có cờ incomplete và độ tin cậy; mọi ước tính cần công thức/nhãn riêng được duyệt, không gọi là “thời gian học thực tế”. `quiz_logs.duration` không dùng cho chỉ số này.

Một HMID/username khớp nhiều enrollment trong phạm vi phải được đối soát, không chọn ngẫu nhiên. Không gộp theo display name. BigInt chuyển chuỗi khi serialize; không ép Number gây mất định danh.

## 7. Schema và logging mới: chỉ đề xuất khi thật sự cần

### 7.1. Bản triển khai đầu

Không cần tạo bảng, migration hoặc index để triển khai các thông tin đã có nguồn. Đọc `chat_hidden_rules` bằng SQL parameterized/DTO rõ ràng trong phạm vi báo cáo; có thể bổ sung model Prisma sau khi đối chiếu DDL đầy đủ nhưng **không tự áp migration**.

Không coi `users_logs_daily`, các bảng storage hoặc view chưa đọc được định nghĩa là nguồn thay thế mặc định. Không sửa socket/chat đang chạy để làm báo cáo đọc.

### 7.2. Logging cho dữ liệu còn thiếu — cần duyệt riêng

Nếu bắt buộc có tổng thời gian, leave/reconnect chính xác và đầy đủ lịch sử hạn chế, trước tiên cần khảo sát source runtime thực sự. Khi xác nhận chưa lưu bền vững, đề xuất event append-only, ví dụ tên **dự kiến** `classroom_activity_events`:

- Event ID/idempotency key, server occurred_at, ingested_at; timestamp client chỉ để đối soát.
- calendar_id khi xác định được, code + bài, exact class_id/room, source system.
- Danh tính học sinh/enrollment, socket/connection ID; live_session_id nếu runtime thực sự có liên kết.
- Event type có contract: join, heartbeat, leave, connection_lost, chat_restrict, chat_unrestrict, hide/restore…; không suy đoán nghĩa số.
- Actor ID/role, lý do, expires_at và tham chiếu tin nhắn khi có; trạng thái camera/mic chỉ thêm nếu cần và được chấp thuận.
- Ghi qua cơ chế idempotent/batch/outbox đã kiểm chứng để không chặn luồng realtime; định nghĩa xử lý retry, mất event, retention và dung lượng trước khi triển khai.

Không backfill lịch sử không tồn tại. Ghi rõ mốc bắt đầu có logging để buổi cũ không bị hiểu nhầm có đầy đủ lịch sử. Kế hoạch này **không cho phép** tạo bảng, ghi dữ liệu hoặc mở quyền DB ở giai đoạn khảo sát.

## 8. Hiệu năng, phân quyền và rủi ro

### 8.1. Hiệu năng

- Dùng index **đang có**: users(code,bài), history(calendar_id,time), logs(username,code,bài)/time/dedupe, chat(code,bài,time), chat(HMID,time), chat(room,time), block(code,bài,expiry), hidden rule lesson/message/user. Một số index thực tế có ngoài Prisma schema; không regenerate schema rồi làm mất index.
- Khởi động scope và roster trước; count nặng/chat/moderation tải riêng theo tab/capability. Tận dụng cache EVG hiện có và không query lại chuyên cần chỉ để tải giờ live.
- Tổng hợp từng nguồn trước khi join, không N+1 mỗi học sinh. Giới hạn tối đa hai phần đọc log song song và giữ đúng thứ tự counter như code hiện tại.
- Tìm nội dung chat substring có thể phải quét dù có index: chỉ thực hiện trong một buổi/một học sinh, debounce, giới hạn độ dài/khung giờ; không thêm FULLTEXT/index tự động.
- Không quét view unknown hoặc history toàn thời gian. Dùng EXPLAIN và benchmark SELECT có scope sau khi thiết kế query, không suy đoán hiệu năng từ tên bảng.
- Cache tổng hợp chi tiết nếu cần phải có TTL, quyền/scope/room/công thức/version trong key và chính sách cập nhật rõ ràng. Không cache lỗi; không để cache làm thay kết quả tổng hợp hiện hành.
- Export phân trang/ghi nối file, có trần khối lượng và xử lý quá giới hạn rõ ràng; không xuất một phần rồi gọi là toàn bộ. Job bất đồng bộ nếu cần là hạng mục thiết kế thêm, không đưa vào realtime writer.

### 8.2. Quyền đề xuất

Tái sử dụng authentication và resolver chương trình từ calendar ID. Không nhận quyền hoặc program code tự khai của FE làm căn cứ.

Đề xuất thêm permission vào **cơ chế RBAC đang có**, không tạo schema quyền mới:

- `calendar.report.detail.view`: dữ liệu học sinh/ghi nhận tham gia, kết hợp `calendar.view`.
- `calendar.report.chat.view`: thêm quyền đọc nội dung chat, kết hợp quyền chi tiết.
- `calendar.report.moderation.view`: thêm quyền đọc hạn chế/kiểm duyệt.
- `calendar.report.detail.export`: xuất chi tiết, kết hợp `calendar.export`, quyền xem chi tiết và quyền của dataset xuất.

**Middleware `authorize([A,B]) hiện là OR**, không thể dùng một mảng để yêu cầu đồng thời A và B. Phải nối nhiều guard hoặc kiểm tra AND tường minh, đồng thời lấy giao các phạm vi liên quan. Admin `*` theo cơ chế hiện có.

Quyền nhạy cảm không cấp mặc định theo calendar.view. Chưa có quyền thì API trả 403, tab/cột bị khóa; không lấy dữ liệu đầy đủ về FE rồi chỉ ẩn bằng CSS. Áp field policy/masking ở backend nếu cấu hình yêu cầu; không trả IP, token, session socket thô ở bảng đại trà.

Việc đăng ký/gán permission là thay đổi metadata phân quyền cần được duyệt và vận hành theo quy trình riêng; **không tự chạy seed vào DB thật**. Khi chưa gán quyền, mặc định từ chối cho tài khoản không đủ quyền.

Chat là nội dung không tin cậy: render dạng text an toàn; không chạy HTML; Excel giữ nội dung dưới dạng text để tránh công thức. Không ghi nguyên nội dung chat hoặc định danh nhạy cảm vào log ứng dụng khi benchmark.

### 8.3. Rủi ro chính

| Rủi ro | Kiểm soát |
|---|---|
| Sai nghĩa status / UPSERT mất lịch sử | Xác minh writer; chưa công bố duration/leave thật; giữ counter tổng hợp |
| Nhầm lịch 1/lịch 2, phiên phát/socket/bài | Calendar ID + resolver scope + exact class + cửa sổ từng phiên; đánh dấu mơ hồ |
| Nhầm phòng phân bổ với phòng tham gia | Hai trường riêng, ghi nguồn và mức tin cậy |
| Đếm chat broadcast/nhân sự thành chat học sinh | Chốt role/type, đối chiếu HMID/roster/staff; không dùng role đơn lẻ |
| Coi trạng thái hiện tại là lịch sử cấm chat | Tách snapshot/block, ẩn/khôi phục và lịch sử đầy đủ; unknown là null |
| Lộ dữ liệu ngoài chương trình | Kiểm tra quyền trên từng endpoint, enrollment/HMID/cursor/export; lọc server |
| Làm chậm lớp live | Chỉ đọc trong module quản trị, bounded queries; không thay writer/socket hoặc thêm index |

## 9. Danh sách file dự kiến thay đổi

**Chưa sửa các file này trong giai đoạn khảo sát.**

| File/hạng mục | Thay đổi dự kiến |
|---|---|
| `lms-manage-api/src/modules/livestream/livestream.route.ts` | Gắn route chi tiết với guard đúng scope |
| `.../livestream.controller.ts` | Handler chi tiết; có thể tách controller riêng để tránh file lớn |
| `.../calendar-room-report.service.ts` | Tách helper đọc scope/counter có regression test, không đổi kết quả tổng hợp |
| `.../calendar-detail-report.service.ts` **mới** | Overview, roster, chất lượng dữ liệu, query tổng hợp |
| `.../calendar-detail-report.validation.ts` **mới** | ID, filter, cursor, thời gian, sort/limit allowlist |
| `.../calendar-detail-report.io.ts` **mới** | Excel theo cùng scope và bộ lọc |
| `src/modules/auth/auth.middleware.ts`, `src/services/authorization.service.ts` | Chỉ thay nếu cần helper guard; ưu tiên tái sử dụng hiện có |
| `prisma/seed.ts` | Khai báo permission/module fields nếu duyệt; không tự áp vào DB thật |
| `LMS.FE/.../CalendarRoomReportModal.tsx` | Nút mở chi tiết trên dòng, giữ trạng thái tổng hợp |
| `.../CalendarLessonDetailReportModal.tsx` **mới** | Overview, học sinh, timeline, filter/pagination |
| `.../CalendarStudentActivityDrawer.tsx` **mới** | Các tab học sinh tải riêng |
| `LMS.FE/services/calendarDetailReportService.ts` **mới** | DTO/API chi tiết, không tăng kích thước service tổng hợp nếu không cần |
| Các test API/counter/query/Excel và test UI tương ứng | Regression phân quyền, scope, missing data, dữ liệu lớn |
| `lms-manage-api/md/calendar-detail-report-plan.md` và tài liệu API **dự kiến** | Đưa kế hoạch đã duyệt/contract vào repo trong giai đoạn triển khai |

Không dự kiến sửa `live-user-sync`, FnB sockets hoặc thêm migration. Không đưa phần waiting_video_playlist đang stash trở lại.

## 10. Kế hoạch triển khai và tiêu chí nghiệm thu

### Bước 1 — Chốt contract và phạm vi sau khi duyệt kế hoạch

Xác nhận source writer của attendance/chat/moderation; nghĩa status theo source_system, session UPSERT/append, role/type chat, type block và vòng đời hide/restore. Cần định nghĩa view hoặc xác nhận không sử dụng view. Chốt permission và cách gán ở môi trường triển khai.

**Điều kiện:** Nội dung nào chưa xác minh vẫn được triển khai giao diện với giới hạn rõ ràng, nhưng không được xuất thành con số/thời gian chính xác. Không vì thiếu writer mà tự tạo logging hoặc schema.

### Bước 2 — Backend đọc, roster và overview

Xây resolver calendar/enrollment, validation, capabilities và nguồn dữ liệu. Tái sử dụng counter, chỉ số theo đúng lịch; test hợp nhất phiên và không thay kết quả tổng hợp. Bổ sung danh sách phân trang/tìm kiếm/lọc.

**Đạt khi:** Một người vào nhiều lần chỉ có một dòng; lịch/room khác không lọt dữ liệu; không có log trả “Chưa có ghi nhận”; duration không xác minh trả null. Tổng đủ chuyên cần theo scope đối chiếu được với cột tương ứng ở tổng hợp.

### Bước 3 — Chat và kiểm duyệt đã có nguồn

API chat phân trang, lọc giờ/nội dung, đối chiếu danh tính và quyền; đọc block/rule dưới nhãn chính xác. Timeline chỉ ghép sự kiện thực sự được lưu và đã hiểu nghĩa.

**Đạt khi:** Nội dung/trạng thái/actor có nguồn kiểm chứng; không nhầm broadcast/giáo viên thành chat học sinh; không dùng updated_at như unmute; dữ liệu bị thiếu/xóa không được tái tạo. Người thiếu quyền nhận 403 và không nhận dữ liệu nhạy cảm qua API/Excel.

### Bước 4 — Frontend nhất quán với báo cáo hiện tại

Nút Xem chi tiết, modal/drawer, bộ lọc và phân trang backend; các tab tải độc lập, hủy/bỏ phản hồi cũ khi đổi học sinh/lịch. Mobile không tràn ngang ngoài bảng có scroll hợp lý.

**Đạt khi:** Mở/đóng không mất bộ lọc/trang tổng hợp; tải chat/EVG chậm không chặn danh sách; lỗi/empty/forbidden được phân biệt, không dùng dữ liệu giả.

### Bước 5 — Excel và hiệu năng

Cùng resolver/filter với API; xuất đúng dataset/quyền, thời gian Việt Nam, ID không mất chính xác; không gọi mỗi học sinh một query.

**Đạt khi:** Tập ID và chỉ số trong Excel trùng danh sách đã lọc trên toàn bộ các trang; có giới hạn minh bạch. Benchmark lớp lớn theo metadata thực tế, EXPLAIN dùng được index hiện có; số query không tăng tuyến tính theo số học sinh trên trang. Chốt ngưỡng p95 sau baseline đo, không hứa một SLA chưa đo.

### Bước 6 — Nghiệm thu hồi quy

Bộ ca tối thiểu:

- Lịch 1/lịch 2 cùng code/bài khác ngày, lịch cùng ngày khác giờ, room 1/10/12 và lịch chồng giờ mơ hồ.
- Nhiều phiên EVG, nhiều socket, vào lại/ngắt chuỗi, log cùng timestamp khác ID, log ở biên kết thúc, nguồn tc/tu/default.
- Không ghép heartbeat qua hai phiên; không cộng trùng interval nếu lifecycle đã được xác minh; thiếu leave không kéo đến tan học.
- Đổi room sau buổi, học sinh ngoài roster, HMID/username đổi hoặc không ánh xạ được.
- Không có log/chat/block; có chat nhưng chưa đủ chuyên cần; role student/type broadcast; nội dung mất/null; ẩn/khôi phục nhiều lần nếu có nguồn.
- Phân biệt trạng thái hạn chế đang lưu với trạng thái tại thời điểm kết thúc buổi.
- Admin, scope ALL/RESTRICTED/DENY, sửa calendarId/enrollmentId/cursor, thiếu quyền chat/moderation/export.
- API, search/filter, cursor/page và Excel nhất quán; không N+1 hoặc tải toàn bộ chat lên FE.
- So sánh snapshot báo cáo tổng hợp trước/sau theo cùng dữ liệu; không đổi hai cột chuyên cần và cách tính giờ live.

Ở môi trường hiện tại chỉ chạy test cô lập/mock không ghi DB và SELECT đối chiếu. Test integration cần fixture ghi DB chỉ được chạy trong môi trường kiểm thử riêng sau khi có quyền rõ ràng; không coi duyệt code là cho phép sửa DB đang kết nối.

---

**Đề nghị xem xét:** triển khai bản đầu với dữ liệu đã chứng minh được; giữ trạng thái chưa xác định cho duration/leave/reconnect/lịch sử cấm đầy đủ. Việc bổ sung logging, index, schema hoặc thay đổi quyền ở DB là quyết định riêng, không nằm trong bước triển khai đọc mặc định.

Theo yêu cầu Giai đoạn 2, chỉ bắt đầu sửa code sau khi kế hoạch này được chấp thuận.
