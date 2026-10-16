# Kế hoạch mở rộng `calendar` dùng chung cho Livestream và Feed

> Đã được thay thế bởi phương án prefix `feed-` trên mã chương trình. Xem [contract hiện tại](calendar-source.md). Không tạo registry/chủ sở hữu nguồn riêng và không lưu cột nguồn trên calendar.


Ngày rà soát: 14/10/2026.
Trạng thái: **Đã được duyệt và triển khai trong mã nguồn. Migration chỉ được kiểm thử trên MySQL test riêng; chưa áp dụng database vận hành.**

Kết quả và hướng dẫn vận hành: [calendar-source.md](calendar-source.md).

## 1. Mục tiêu và phạm vi

Bổ sung `calendar_source` độc lập với `system_type` và các field nghiệp vụ hiện có:

- `livestream`: nguồn mặc định tại database và API; giữ nguyên hành vi hiện tại.
- `feed`: lưu lịch, không phát sinh queue tạo/cập nhật lịch hoặc cập nhật trạng thái lịch trên Học Mãi.

Chỉ chặn đồng bộ lịch Học Mãi và những tác động rõ ràng dành riêng cho Livestream. Không dùng cờ nguồn để tắt toàn bộ notification, enrollment, đồng bộ học viên, attendance, export hoặc cập nhật đề cương.

Các yêu cầu dữ liệu bắt buộc hiện tại của `calendar` vẫn áp dụng. Không tự thiết kế thêm nghiệp vụ video Feed, thay đổi khóa/index hoặc refactor module.

## 2. Kết quả rà soát mã nguồn

### 2.1. Schema và migration

- `prisma/schema.prisma`: `calendar` hiện chưa có `calendar_source`; database là MySQL, ORM là Prisma 5.
- Convention migration: `prisma/migrations/<timestamp>_<description>/migration.sql`.
- Chưa thấy convention migration `down` hoặc script rollback trigger trong repository.
- `prisma/sql/calendar_triggers.sql` định nghĩa ba trigger; `prisma/scripts/syncCalendarTriggers.ts` áp dụng lại file này bằng MySQL CLI qua script `db:calendar-triggers`.
- Không tìm thấy định nghĩa `CREATE TRIGGER` trong các migration hiện có. Vì vậy chỉ sửa file SQL hoặc chỉ sửa schema đều không bảo đảm môi trường đã triển khai được nâng cấp đầy đủ.

### 2.2. Các đường đi thực tế vào queue

| Đường đi | File/hàm | Đặc điểm cần bảo toàn |
| --- | --- | --- |
| Tạo một lịch | `livestream.service.ts`: `createSingle`, `prepareCalendarCreateData`, `createCalendarRecord` | Transaction đặt `@lms_manual_hocmai_queue = 1`; tạo lịch, mapping, rồi enqueue `create` nếu có mapping |
| Tạo hàng loạt, commit tự động | `createBulk`; controller `commitAutoSchedule` | Từng lịch có queue thủ công; auto-schedule chuyển kết quả preview thành bulk |
| Import có mapping HMO | `calendar-import.service.ts` → `createValidatedCalendarImport` | Đi qua hàm chuẩn bị lịch và queue thủ công |
| Import nội bộ | `createValidatedInternalCalendarImport` | Dùng `INSERT INTO calendar` nhiều dòng trực tiếp, có danh sách cột riêng; cần xử lý nguồn ở đường này |
| Cập nhật một/nhiều lịch | `updateSchedule`, `updateBulk`, `updateCalendarsFromSheet` | Có cập nhật mapping, notification, nhân sự; queue thủ công ở các nhánh cần đồng bộ |
| Nghỉ, bù, dời chuỗi, đổi giờ | `rescheduleSession`, `bulkRescheduleSessions`, `swapSessionTimes` → `enqueueRescheduleSync` | Queue có `operation_id`, `sequence_no`; không thay đổi thứ tự/payload của Livestream |
| Mapping thủ công và job mapping | `reconcileCalendarMappingsAndEnqueue`; `hmo-lesson-sync.service.ts` | Có thể thêm queue `update` sau khi lịch đã được tạo |
| Gửi lại Học Mãi | `resendCalendarsToHocmai` → `enqueueCalendarsSyncBulk` | Ghi `hocmai_sync_queue.createMany` trực tiếp, không qua hàm enqueue từng lịch |
| Ghi SQL/ORM ngoài service | Ba trigger trong `calendar_triggers.sql` | `AFTER INSERT` tạo `create`; `AFTER UPDATE` tạo `update`; trigger trạng thái tạo `update-status-lesson` |
| Cập nhật đề cương | `lessons/lesson.repository.ts` | SQL UPDATE calendar theo session hoặc code/số bài; có thể kích hoạt trigger cập nhật |

Hiện enqueue còn phụ thuộc `key` và mapping hợp lệ. Lịch Livestream không có mapping vẫn được lưu và không tạo job chắc chắn lỗi; yêu cầu tương thích phải giữ điều kiện này.

`hocmai-sync-queue.service.ts` có hai đường ghi queue: SQL `INSERT` và `createMany` cho bulk resend. Cần bảo vệ cả hai.

### 2.3. Những tác động và client liên quan

- `createCalendarRecord` lấy banner theo chương trình/giáo viên và đồng bộ nhân sự.
- `updateCalendarRecord` có thể cập nhật banner trong bảng `stream` theo code/số bài. Nếu Feed dùng cùng định danh, thao tác này có thể tác động đến stream Livestream.
- Các API có middleware kiểm tra quyền chương trình, phân công và field. Field mới phải được xử lý như metadata nguồn; không được vô tình khiến client Feed bị từ chối vì thiếu field policy mới, cũng không được bỏ kiểm tra quyền tạo/cập nhật hiện có.
- Frontend hiện dùng `LMS.FE/services/livestreamService.ts`; các hàm chuyển payload tạo mới dựng danh sách field riêng nên sẽ bỏ field mới nếu chỉ thêm type.
- Chưa tìm thấy client/module tạo lịch Feed trong `LMS.FE`, `lms-manage-api/src` hoặc `live-user-sync`. Không gán nguồn Feed cho bất kỳ luồng Livestream hiện có nào.
- `live-user-sync` là đồng bộ user riêng, không tìm thấy ghi `calendar` hoặc `hocmai_sync_queue` trong mã của ứng dụng này.
- `src/syncWorker.ts` đang được comment toàn bộ; `src/server.ts` không khởi động worker này. Job mapping HMO có được khởi động. Chưa xác định được consumer queue thực tế đang chạy ngoài repository.

## 3. Thiết kế thay đổi đề xuất

### 3.1. Dữ liệu và validation

1. Thêm enum Prisma `calendar_source` gồm `livestream`, `feed`; field `calendar.calendar_source` bắt buộc, `@default(livestream)`.
2. Migration thêm cột MySQL `ENUM('livestream','feed') NOT NULL DEFAULT 'livestream'`. Bản ghi cũ nhận mặc định; không xóa/tạo lại lịch, không thay khóa/index.
3. Thêm helper nhỏ dùng chung để kiểm tra nguồn. Chỉ field bị bỏ qua mới nhận mặc định; `null`, chuỗi rỗng, sai kiểu hoặc giá trị ngoài enum bị từ chối ở API/service trước khi ghi.
4. Nguồn là metadata lúc tạo. Khi cập nhật, bỏ qua field thì giữ nguồn đang lưu; gửi cùng nguồn được chấp nhận, gửi nguồn khác bị từ chối. Không cho chuyển Livestream thành Feed để bỏ qua queue hoặc chuyển Feed thành Livestream ngoài một nghiệp vụ chuyển đổi riêng.
5. Bulk nhận nguồn trên **từng phần tử `calendars`**. Kiểm tra cả lô trước khi ghi, tránh giá trị sai xuất hiện sau các side effect. Không thêm quy ước nguồn ở cấp request khi chưa có nhu cầu.
6. Import và auto-schedule hiện có vẫn tạo Livestream. Không suy đoán Feed từ tên bài, hệ, file hoặc mapping. Nếu một caller nội bộ truyền nguồn rõ ràng, source phải được bảo toàn qua đường chuẩn bị và SQL INSERT; không tự mở thêm giao diện/import Feed.

### 3.2. Queue thủ công và trigger

- Query đọc calendar trong enqueue từng lịch và bulk phải lấy thêm `calendar_source` từ database.
- `enqueueCalendar` và `enqueueStatus` trả về không enqueue cho Feed trước khi kiểm tra key/mapping; Livestream giữ nguyên payload, điều kiện mapping, operation và thứ tự.
- `enqueueCalendarsSyncBulk` đưa Feed vào `skippedIds`, không ghi queue; không đổi cơ chế báo `missingIds` hoặc thứ tự job Livestream.
- Mapping reconciliation vẫn lưu mapping nếu caller có nghiệp vụ yêu cầu; việc quyết định enqueue dùng nguồn calendar thật trong database. Không tin nguồn do payload gọi enqueue cung cấp.
- Job tự động mapping `lesson_id` HMO chỉ đọc lịch Livestream, bao gồm cả các lịch lịch sử dùng để phân bổ section; Feed không được chiếm section hoặc thay đổi kết quả matching Livestream.
- Mỗi trigger thêm điều kiện `NEW.calendar_source = 'livestream'` vào đúng nhánh ghi queue. Giữ nguyên mọi điều kiện, JSON và kiểm tra thay đổi field cũ. Không xóa các trigger hoặc thay session variable bằng một cờ tắt sync chung.
- UPDATE phát sinh trong luồng tạo Feed, kể cả từ đồng bộ đề cương, vẫn bị chặn tại trigger. Source không bị đổi bởi các luồng này.

### 3.3. Bảo toàn xử lý khác và ranh giới Livestream

- Giữ cập nhật metadata, nội dung, mapping được yêu cầu, log và các xử lý không phục vụ tạo lịch Học Mãi.
- Nhánh Feed không tự lấy/ghi đè banner Livestream và không cập nhật bảng `stream` trong `createCalendarRecord`/`updateCalendarRecord`; Livestream giữ logic cũ. Các field Feed được caller truyền hợp lệ vẫn được lưu theo contract hiện có.
- Với thao tác tạo lịch bù/dời chuỗi: bản ghi phát sinh phải kế thừa nguồn lịch gốc, không rơi về mặc định Livestream. Nếu payload cố đổi nguồn thì từ chối.
- Không thêm filter nguồn hàng loạt vào worker học viên, enrollment, attendance, Teams hoặc export trong thay đổi này. Bổ sung test để chứng minh không tắt các luồng đó chỉ vì nguồn Feed.
- Các thao tác chuyên biệt như tạo EVG, chia phòng, swap và quy tắc xung đột sẽ được đối chiếu khi triển khai. Chỉ thêm guard nếu thực sự có side effect Livestream không phù hợp với Feed; không tự thiết kế lại hành vi Feed hoặc sửa luật Livestream.
- Không thay thuật toán key/lesson_count hoặc unique index. Nếu Feed cần định danh trùng hoàn toàn với Livestream, đó là yêu cầu riêng cần làm rõ, không nằm trong migration nguồn.
- Không đổi mặc định lọc/list lịch hoặc UI trong kế hoạch này. Có thể bổ sung nguồn trong dữ liệu trả về để caller nhận biết; việc tách màn quản lý Feed là phạm vi riêng.

### 3.4. Frontend/client

- Thêm type union và field tùy chọn vào payload/response liên quan trong `LMS.FE/services/livestreamService.ts`.
- Hàm chuyển payload chỉ chuyển tiếp `calendar_source` nếu caller chủ động cung cấp, giữ nguyên payload client cũ khi field bị bỏ qua.
- Form, preview, bulk và auto-schedule Livestream không tự thêm `feed`; giữ nguyên UI.
- Client Feed tương lai gọi API tạo với `calendar_source: 'feed'` và các field bắt buộc hiện có. Chưa có client Feed trong workspace để sửa; sẽ ghi contract/example trong tài liệu API thay vì tạo module giả định.

## 4. Các file dự kiến thay đổi

Đường dẫn backend dưới `lms-manage-api/` trừ phần frontend.

| File | Thay đổi |
| --- | --- |
| `prisma/schema.prisma` | Enum và field mặc định |
| `prisma/migrations/<timestamp>_add_calendar_source/migration.sql` | Thêm cột; cập nhật ba trigger cho môi trường đã triển khai |
| `prisma/sql/calendar_triggers.sql` | Đồng bộ định nghĩa trigger chuẩn để script vận hành không ghi đè bản sửa |
| `prisma/sql/rollback_calendar_source_triggers.sql` (mới) | SQL phục hồi trigger, kèm điều kiện sử dụng an toàn trong runbook |
| `src/modules/livestream/calendar-source.ts` (mới) | Validation và quy tắc nguồn khi tạo/cập nhật |
| `src/modules/livestream/livestream.service.ts` | Truyền/bảo toàn nguồn ở create, bulk, import SQL, update và bản ghi phát sinh; tách side effect banner/stream |
| `src/modules/livestream/hocmai-sync-queue.service.ts` | Chặn Feed ở enqueue từng lịch, trạng thái và bulk resend bằng nguồn database |
| `src/modules/livestream/livestream.route.ts` | Xử lý metadata nguồn trong field middleware, giữ quyền CRUD/chương trình/phân công |
| `src/modules/livestream/livestream.controller.ts` | Validation ở biên request nếu cần; bảo toàn nguồn ở đường dựng payload, lỗi 4xx theo cơ chế hiện có |
| `src/modules/livestream/calendar-import.types.ts`, `calendar-import.service.ts` | Contract nguồn nội bộ và bảo toàn nguồn khi cần, không đổi định dạng import legacy |
| `src/modules/hmo-lesson-sync/hmo-lesson-sync.service.ts` | Giới hạn matching tự động và tập lịch lịch sử vào Livestream |
| `LMS.FE/services/livestreamService.ts` | Type và chuyển tiếp field tùy chọn; không sửa UI |
| `tests/calendar-source.test.ts`, `tests/calendar-source.integration.ts` (mới) | Validation, service queue, direct SQL/trigger, tương thích migration |
| Các test create/import/mapping/bulk/lesson-sync hiện có | Bổ sung case nguồn khi cần và giữ kỳ vọng Livestream |
| `md/calendar-source.md` (mới), `package.json` nếu cần | Contract, triển khai/rollback và lệnh test chuyên biệt |

Chỉ sửa thêm file worker/service khác khi kiểm tra chứng minh có đường ghi queue hoặc side effect đặc thù chưa được bảo vệ; ghi rõ trong báo cáo thay đổi.

## 5. Migration, triển khai và rollback

1. Dùng migration mới; không chỉnh lịch sử migration đã triển khai. Không chạy `migrate reset`, không xóa dữ liệu calendar hoặc queue cũ.
2. Chụp `SHOW CREATE TRIGGER` và danh sách trigger của database đích trước triển khai, kiểm tra cả trigger trên `package_lesson_mapping` và các bảng liên quan. Đối chiếu tên, definer, nội dung và quyền với source. Nếu có trigger bổ sung ghi queue, bổ sung guard và cập nhật kế hoạch trước khi áp dụng.
3. Migration cập nhật ba trigger đã biết; file migration không dùng lệnh client `DELIMITER`. File SQL áp dụng qua CLI vẫn dùng convention `DELIMITER` hiện có. Kiểm tra bằng database test thật.
4. MySQL DDL không bảo đảm rollback nguyên tử cho toàn bộ ALTER/DROP/CREATE TRIGGER. Dùng cửa sổ tạm dừng ghi lịch/worker liên quan khi thay trigger; kiểm tra quyền tạo trigger trước, có bản SQL phục hồi nếu một bước thất bại.
5. Deploy migration và trigger trước khi cho phép client Feed ghi dữ liệu; generate Prisma client và deploy backend hỗ trợ nguồn. Script `db:calendar-triggers` phải dùng file nguồn đã sửa.
6. Kiểm tra bản ghi cũ, default, ba trigger và queue sau nâng cấp. Không sửa payload/action hoặc xử lý lại queue Livestream tồn tại.
7. Rollback thông thường ưu tiên rollback ứng dụng, giữ cột/default và trigger đã chặn Feed để bảo toàn dữ liệu mới. Không phục hồi trigger cũ khi còn lịch Feed vì UPDATE có thể đưa Feed vào Học Mãi.
8. Chỉ phục hồi trigger cũ và cân nhắc bỏ cột khi chưa có Feed, đã dừng ghi, và có kiểm tra dữ liệu/backup. Nếu đã có Feed, không drop cột và không đổi toàn bộ Feed thành Livestream. Đây là runbook rollback thủ công do repository chưa có convention `down`.

## 6. Phương án kiểm thử và nghiệm thu

### 6.1. Unit/service/API

- Tạo không truyền nguồn và tạo `livestream`: nguồn đúng, queue/payload/operation/thứ tự và side effect giữ như trước khi có mapping; không mapping vẫn không enqueue như hiện tại.
- Tạo Feed có mapping: calendar/mapping lưu thành công, không có queue Học Mãi. Kiểm tra cả single và bulk trộn hai nguồn.
- Validation: sai enum, null, rỗng, số/object; lỗi không để lại calendar/queue/bản ghi phụ. Client bỏ field vẫn hoạt động.
- Cập nhật từng lịch, bulk và import update: giữ nguồn; Feed không tạo `update` hoặc `update-status-lesson`; notification và các xử lý khác được kiểm tra theo nhánh hiện có.
- Payload update không được đổi nguồn, kể cả bulk và `new_session`.
- Dời/bù có bản ghi mới giữ nguồn gốc; hồi quy Livestream kiểm tra thứ tự queue và payload.
- Resend trộn nguồn: chỉ Livestream vào queue, Feed báo skipped.
- Mapping thủ công và job tự động: Feed không bị enqueue hoặc chiếm section trong matching Livestream.
- Cập nhật banner Feed không sửa stream Livestream cùng code/số bài.
- Frontend chuyển payload legacy không thay đổi, field `feed` chủ động truyền được bảo toàn.

### 6.2. Database và trigger thật

Dùng MySQL test riêng, không chạy integration test có ghi dữ liệu trên database vận hành.

- Tạo dữ liệu legacy trước migration, chụp field/ID/key/mapping; chạy migration rồi so sánh và kiểm tra nguồn mặc định.
- Trực tiếp SQL INSERT lịch hai nguồn có key/mapping đã tồn tại để trigger INSERT thực sự thỏa điều kiện enqueue.
- Trực tiếp UPDATE các field đủ kích hoạt trigger nội dung; UPDATE trạng thái/noti; xác nhận cả hai trigger UPDATE bỏ Feed và giữ Livestream.
- Kiểm tra session variable 0 và 1, service manual enqueue, UPDATE gián tiếp trong quá trình tạo và cập nhật đề cương.
- Kiểm tra raw SQL bulk import, ORM create, upgrade database có trigger cũ và database mới cài từ migrations.
- Chạy lại script sync trigger trên database test và xác nhận guard vẫn tồn tại.
- Thử phục hồi trigger trong database test và kiểm tra runbook ngăn rollback không an toàn khi đã có Feed.

### 6.3. Các lệnh dự kiến

- `npm run build` để generate Prisma client và kiểm tra TypeScript backend.
- `npx tsx --test tests/*.test.ts` cho các test TypeScript hiện có và test mới, đối chiếu điều kiện cần mock/cấu hình trước khi chạy.
- `npm run test:calendar-import`, `npm run test:hmo-lesson-sync-match` và integration import/database nguồn trên MySQL test riêng.
- Kiểm tra TypeScript frontend và các test chuyển payload mới.
- Báo rõ từng nhóm pass/fail/không chạy. `npm test` hiện chỉ là placeholder trả lỗi, không dùng làm bằng chứng toàn bộ test đã pass.

## 7. Giới hạn hiện tại và nội dung cần duyệt

Rà soát ở bước này dựa trên mã nguồn và migration trong workspace; chưa kết nối database, chưa xác minh trigger/definer thực tế, chưa kiểm thử migration hay chạy test cho thay đổi chưa triển khai. Consumer queue Học Mãi vận hành và client Feed có thể nằm ngoài workspace; cần đối chiếu trước rollout. Không sửa hoặc kích hoạt file `src/syncWorker.ts` đang comment.

Đề nghị duyệt phương án: enum/default tại DB; nguồn bất biến khi cập nhật; guard tại cả service và ba trigger; bảo toàn raw import và nguồn bản ghi phát sinh; job matching HMO chỉ dùng Livestream; tránh Feed ghi banner vào stream Livestream; giữ các luồng khác và UI hiện tại.

Sau khi được duyệt mới triển khai code, migration và test theo kế hoạch này. Việc chạy migration trên database vận hành là bước triển khai riêng, sau khi có kết quả kiểm thử và đối chiếu trigger thực tế.
