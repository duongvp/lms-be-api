# Kế hoạch nguồn ở cấp chương trình và lọc chương trình theo nguồn lịch

> Đã được thay thế bởi phương án prefix `feed-` trên mã chương trình. Xem [contract hiện tại](calendar-source.md). Không tạo registry/chủ sở hữu nguồn riêng và không lưu cột nguồn trên calendar.


Ngày: 14/10/2026.
Trạng thái: **Đã hủy theo yêu cầu ngày 14/10/2026. Chỉ giữ nguồn ở calendar; không thêm nguồn cho chương trình, không lọc chương trình theo nguồn.**

## 1. Hiện trạng đã kiểm tra

- Form `LMS.FE/app/(admin)/lessons/components/Modal/ProgramCreateModal.tsx` chưa có chọn nguồn; payload tạo chương trình cũng chưa có nguồn.
- Chương trình hiện không có bảng riêng. `createNewProgram` tạo bài đầu tiên trong `lessons`; các bài cùng `subject_code` được xem là một chương trình.
- `findLessonProgramOptions` và `getSchedulingPrograms` gộp dữ liệu từ `lessons.subject_code` và `calendar.code`. Không có metadata nguồn ở cấp chương trình nên danh sách chương trình chưa lọc theo Livestream/Feed.
- `useSchedulingProgramsQuery` và `useLessonProgramOptions` đang cache danh sách chỉ theo phiên người dùng, chưa theo nguồn.
- `calendar.calendar_source` đã có hai giá trị `livestream`, `feed`. Lịch đang được phân nguồn độc lập khi tạo; đây chưa phải quan hệ chương trình → bài → lịch như yêu cầu mới.
- Lịch gắn bài qua `session_id` lấy chương trình chuẩn từ `lessons.subject_code`. `calendar.code` có thể là mã khóa/lớp khác mã chương trình; không được mặc định hai mã này luôn giống nhau.

**Trả lời câu hỏi hiện tại:** phần tạo chương trình trong Quản lý đề cương chưa có chọn nguồn. Cần bổ sung ở đó trước, rồi dùng nguồn chương trình khi tạo lịch.

## 2. Phương án đề xuất

### 2.1. Lưu nguồn một lần ở cấp chương trình

Thêm bảng nhỏ `lesson_programs` để lưu metadata nguồn:

| Field | Ý nghĩa |
| --- | --- |
| `subject_code` | Khóa duy nhất, dùng đúng mã chương trình hiện tại, `VARCHAR(100)` |
| `calendar_source` | Enum `livestream` / `feed`, mặc định `livestream`; dùng lại enum nguồn hiện có |
| `created_at`, `updated_at` | Thời điểm tạo/cập nhật metadata |

Bảng này chỉ bổ sung nơi lưu nguồn. Tên môn, khối, hệ thống, bài học và các thống kê tiếp tục dùng luồng hiện có; không chuyển toàn bộ mô hình chương trình trong lần này.

Không thêm nguồn lặp lại trên từng bài học: nguồn của bài được xác định qua `lessons.subject_code` → `lesson_programs`. `calendar.calendar_source` vẫn được lưu trên lịch để giữ contract/trigger/queue hiện có.

Lý do chọn bảng metadata: một mã chương trình chỉ có một nguồn, kể cả khi chưa có lịch. Nếu suy nguồn từ lịch, chương trình Feed mới tạo sẽ không xuất hiện trong bộ lọc cho tới khi có lịch, trái với luồng mong muốn. Nếu đặt nguồn trên từng bài, các bài cùng chương trình có thể bị lệch nguồn.

### 2.2. Quy tắc dữ liệu

1. Một `subject_code` thuộc đúng một nguồn. Không cho dùng cùng mã cho cả Livestream và Feed; giữ unique bài theo `[subject_code, learn_number]` và scope quyền theo mã hiện tại.
2. Chọn nguồn khi tạo chương trình, mặc định Livestream. Nguồn chương trình không được sửa trong các API chỉnh bài/đổi tên chương trình hiện có. Chuyển nguồn là nghiệp vụ riêng nếu sau này cần.
3. Thêm/import bài vào chương trình có sẵn luôn dùng nguồn của chương trình. Không cho một bài tự chọn nguồn khác.
4. Tạo lịch có chương trình/bài hợp lệ thì lấy nguồn từ chương trình. Nếu client gửi nguồn khác, trả lỗi rõ ràng trước khi ghi calendar, mapping hoặc queue.
5. Nếu client không gửi nguồn nhưng chương trình là Feed, lịch vẫn nhận Feed. Đây là thay đổi có chủ đích theo yêu cầu mới; chương trình Livestream cũ tiếp tục tạo Livestream như trước.
6. Luồng legacy không xác định được chương trình chuẩn vẫn mặc định Livestream để tương thích. Không cho tạo Feed bằng cách truyền một mã chưa có chương trình Feed rồi bỏ qua bước tạo chương trình.
7. Khi lịch có `session_id`, ưu tiên chương trình của bài học; không lấy `calendar.code` để suy nguồn nếu mã đó là alias khóa/lớp.
8. Lịch bù/dời chuỗi giữ nguồn gốc như đã triển khai. Không đổi nguồn hoặc giá trị của các lịch cũ khi thêm bảng metadata.
9. Không đổi cách sinh mã chương trình trong phạm vi này. Form hiện cho phép sửa mã. Nếu mã đã thuộc nguồn khác thì báo trùng mã; người dùng cần mã riêng, ví dụ hậu tố `-feed`. Không tự đổi mã dữ liệu cũ hoặc thêm nguồn vào `system_type`.

## 3. Giao diện và luồng sử dụng

### 3.1. Quản lý đề cương

- Form **Tạo Chương trình** thêm lựa chọn **Nguồn: Livestream / Feed**, mặc định Livestream, bố trí cạnh thông tin hệ thống trong modal.
- Tạo metadata chương trình và bài đầu tiên trong cùng transaction. Lỗi ở một bước thì không để lại chương trình hoặc bài dở dang.
- Thêm bài, tạo bài nhanh và import vào chương trình có sẵn không có nguồn độc lập; hiển thị nguồn chương trình ở dạng thông tin.
- Luồng **Import tạo chương trình mới** cũng phải có chọn nguồn. Import nhiều chương trình mới cần quy ước nguồn chung của đợt import, mặc định Livestream; không suy nguồn từ nội dung file/tên bài.
- API danh sách chương trình đề cương trả thêm nguồn. Khi không truyền bộ lọc nguồn vẫn cho xem các chương trình theo scope hiện tại, để Quản lý đề cương có thể quản lý cả hai nguồn. Không bắt trang đề cương chỉ thấy Livestream.

### 3.2. Bộ lọc Quản lý lịch

- Khi chọn **Nguồn lịch = Livestream**, ô **Chương trình** chỉ tải chương trình Livestream; Feed tương tự.
- Chương trình Feed vừa tạo phải xuất hiện ngay cả khi chưa có lịch nào.
- Đổi nguồn sẽ tải lại danh sách chương trình ngay. Nếu chương trình đang chọn thuộc nguồn cũ thì bỏ lựa chọn đó và bỏ `calendar_id` phụ thuộc; giữ các bộ lọc chung như khoảng ngày.
- Giữ hành vi bấm **Lọc** để áp dụng vào bảng/lịch; chỉ danh sách lựa chọn chương trình đổi ngay khi đổi nguồn. Không để cập nhật state nguồn làm mất các giá trị chưa submit của form.
- Khi submit nguồn mới: reset trang về 1, bỏ selection hàng/các filter cột phụ thuộc như luồng hiện có, lưu nguồn và chương trình đúng vào URL.
- Khi mở URL có nguồn/chương trình không khớp: loại chương trình không hợp lệ, không tự chuyển về nguồn khác hoặc dùng chương trình cũ từ shared context. Với người không phải admin vẫn yêu cầu chọn chương trình có quyền.
- “Xóa lọc” về Livestream; chỉ giữ chương trình cũ nếu chương trình đó thuộc Livestream và user có quyền. Không giữ một chương trình Feed rồi lọc Livestream dẫn đến kết quả rỗng.
- Bố cục nguồn/hệ thống đã chỉnh gọn được giữ nguyên, không thêm hàng filter mới.

### 3.3. Tạo lịch dựa trên bài

- Chọn chương trình sẽ xác định nguồn cho modal tạo lịch. Danh sách bài chỉ lấy bài của chương trình đó.
- Single, bulk, lịch phát sinh, import có chương trình và commit tạo lịch tự động phải áp dụng cùng một hàm xác định nguồn ở backend, không chỉ gán nguồn trong frontend.
- Các kiểm tra `assertLivestreamCalendarSource` đang cố định nguồn ở auto-schedule/import cần được đối chiếu với nguồn chương trình, tránh trường hợp bỏ field thì kế thừa Feed nhưng gửi rõ Feed lại bị từ chối.
- Luồng tạo lịch tự động/import chung được phép dùng Feed nếu chỉ sử dụng nghiệp vụ lịch chung. Những bước dành riêng cho Học Mãi/EVG vẫn chỉ chạy cho Livestream. Không tự mở các thao tác chuyên biệt đó cho Feed.
- Không thay ba trigger hoặc điều kiện queue đã triển khai. Feed vẫn không vào queue tạo/cập nhật lịch Học Mãi; Livestream giữ hành vi cũ.

## 4. Backend và cache

- `POST /api/lessons/options/programs`: nhận nguồn tùy chọn; bỏ field mặc định Livestream, sai giá trị/null/rỗng trả 400.
- `GET /api/livestreams/programs?calendar_source=...`: lọc theo nguồn chương trình, mặc định Livestream. Luôn giao với scope chương trình của user.
- `GET /api/lessons/options/programs`: trả metadata nguồn; hỗ trợ nguồn tùy chọn, không truyền thì giữ danh sách cả hai nguồn theo scope.
- Lấy chương trình/bài cho modal, tạo nhanh, auto-schedule dùng cùng registry; lịch legacy chỉ có mã lịch vẫn được giữ trong danh sách phù hợp qua metadata đã backfill.
- Cache SWR danh sách chương trình phải có nguồn và phiên user trong key. Không lọc mảng client từ cache danh sách cũ rồi coi đó là kiểm tra quyền.
- Sau khi tạo/import chương trình mới: invalidate các namespace chương trình/bài/lịch liên quan, để chương trình Feed xuất hiện ngay trong dropdown Feed.
- Cập nhật mã chương trình hợp lệ cần cập nhật khóa registry trong cùng transaction với các thay đổi hiện có; giữ nguồn và kiểm tra trùng mã. Không sửa scope quyền ngoài logic rename hiện có.
- Xóa/soft-delete bài cuối không xóa nguồn registry. Giữ danh tính chương trình và nguồn cho lịch lịch sử, tránh tái tạo cùng mã ở nguồn khác.
- Luồng client cũ tạo bài và qua đó hình thành chương trình mới cần đăng ký metadata Livestream trong cùng transaction. Không để writer cũ tạo bài mà registry bị thiếu.
- Xử lý nguồn như metadata của chương trình, đồng thời giữ quyền `lessons.create/update`, `calendar.create/view` và scope mã chương trình; không vô tình bỏ field quyền khác khi thêm field mới.

## 5. Migration và dữ liệu hiện có

1. Tạo migration mới theo convention timestamp, chỉ tạo `lesson_programs` và backfill metadata; không đổi field/giá trị trong `lessons`, `calendar`, mapping hoặc queue cũ.
2. Trước khi chạy, lập danh sách mã chương trình chuẩn từ `lessons.subject_code`, lịch liên kết bài và mã lịch legacy chưa liên kết. Không tạo chương trình giả từ alias `calendar.code` khi đã có bài chỉ rõ chương trình khác.
3. Chương trình hiện chỉ có Livestream hoặc chưa có lịch thì nhận metadata Livestream. Chương trình có lịch Feed duy nhất theo nguồn có thể nhận metadata Feed, nhưng phải được đối chiếu rõ trong báo cáo backfill.
4. Nếu cùng chương trình chuẩn có cả lịch Feed và Livestream, hoặc nguồn liên kết/alias không thể xác định nhất quán: dừng và trình danh sách cần quyết định. Không âm thầm đổi nguồn lịch/bài hoặc chọn một nguồn bằng `MIN/MAX`.
5. Dữ liệu đã kiểm tra ở bước trước gồm 3.740 lịch đều Livestream; vẫn kiểm tra lại tại thời điểm triển khai, không coi snapshot trước là trạng thái hiện tại.
6. Database hiện có lịch sử migration lệch workspace và một migration cũ chưa hoàn tất. Chuẩn bị SQL riêng cho bảng/metadata mới, kiểm thử trên bản test; không tự chạy toàn bộ `migrate deploy` để xử lý phần này.
7. Bảng/registry mới được backfill đầy đủ trước khi deploy code cần registry. Không để giao diện có chương trình nhưng backend thiếu metadata.
8. Kiểm soát writer đồng thời trong lúc backfill; dùng unique mã và transaction khi tạo metadata để hai request không đăng ký hai nguồn khác nhau.
9. Chỉ áp dụng lên database đang có dữ liệu sau khi kế hoạch và SQL cụ thể được duyệt. Quyền thêm cột calendar ở bước trước không phải quyền tạo bảng hoặc backfill lần này.

Rollback ưu tiên rollback code nhưng giữ registry đã tạo; không xóa dữ liệu chương trình/lịch. Không quay về producer cũ mặc định Livestream khi đã có chương trình Feed mà chưa đánh giá tương thích, vì có thể sinh lịch sai nguồn. Rollback đầy đủ chỉ trong môi trường chưa có dữ liệu Feed mới và sau kiểm tra.

## 6. File dự kiến sửa

| Nhóm | File |
| --- | --- |
| Schema/migration | `lms-manage-api/prisma/schema.prisma`; migration mới và SQL triển khai riêng cho registry |
| Registry/hàm nguồn chung | service/repository nhỏ dùng chung cho chương trình và calendar, bổ sung mới khi triển khai |
| Tạo/đọc/import bài và chương trình | `src/modules/lessons/lesson.types.ts`, `lesson.validation.ts`, `lesson.repository.ts`, `lesson.service.ts`, `lesson.controller.ts`, `lesson.routes.ts` |
| Danh sách chương trình và tạo lịch | `src/modules/livestream/livestream.service.ts`, `livestream.controller.ts`, `calendar-source.ts`; các đường import/auto-schedule liên quan |
| Client API và cache | `LMS.FE/services/lessonService.ts`, `services/livestreamService.ts`, `hooks/useLessonSubjectOptions.ts`, `hooks/useLmsQueries.ts`, `lib/swrKeys.ts` |
| Form tạo/import chương trình | `app/(admin)/lessons/components/Modal/ProgramCreateModal.tsx`, `ProgramImportModal.tsx`, `LessonFormModal.tsx` nếu cần thông tin nguồn; `app/(admin)/lessons/page.tsx` |
| Bộ lọc và tạo lịch | `app/(admin)/schedule/page.tsx`; `ScheduleModal.tsx`, `AutoScheduleModal.tsx` và import modal nếu cần truyền/ngăn nguồn không khớp |
| Test | test program-create/import/rename/lesson-calendar-sync/calendar-source/filter/cache; integration MySQL và kiểm tra UI |

Không sửa trigger, thuật toán key, unique index lesson hiện có, quyền/scope chương trình không liên quan hoặc dữ liệu lịch cũ.

## 7. Kiểm thử nghiệm thu

- Tạo chương trình không truyền nguồn → Livestream; chọn Feed → metadata Feed và bài đầu tiên tạo thành công trong cùng transaction.
- Chương trình Feed chưa có lịch vẫn có trong dropdown Feed; không có trong dropdown Livestream.
- Dropdown nguồn chỉ có chương trình đúng nguồn và đúng scope; chương trình legacy chưa có đề cương vẫn giữ được nếu có metadata phù hợp.
- Đổi nguồn trên desktop/mobile không giữ chương trình cũ sai nguồn, không mất khoảng ngày, không nhảy layout; reset và URL reload đúng.
- Cache của hai nguồn/hai phiên không lẫn nhau; sau tạo/import chương trình Feed cập nhật dropdown ngay.
- Thêm/import bài vào chương trình Feed không cần chọn nguồn lại; không cho bài đổi nguồn độc lập.
- Tạo lịch từ bài Feed mà không gửi nguồn → Feed; gửi Livestream cho bài Feed → lỗi, không để lại calendar/mapping/queue.
- Tạo lịch từ chương trình Livestream cũ/legacy vẫn hoạt động như trước.
- Kiểm tra single/bulk/auto-schedule/import có nguồn kế thừa, raw SQL writer nội bộ, lịch bù/dời chuỗi và mapping.
- Feed không phát sinh queue Học Mãi; các xử lý chung vẫn giữ nguyên.
- Đổi tên/mã chương trình giữ nguồn; xóa bài cuối không làm mất hoặc đổi nguồn registry.
- Kiểm tra trùng mã giữa nguồn, nguồn không hợp lệ, tạo đồng thời, import rollback và phân quyền.
- Migration/backfill không sửa giá trị lịch/bài/queue cũ; phát hiện mixed-source thì dừng đúng.

Chạy test liên quan, kiểm tra TypeScript hai dự án và MySQL test riêng. Báo rõ các phần chưa kiểm chứng trên môi trường vận hành; không coi test bằng mock là kiểm chứng migration thực tế.

## 8. Nội dung đề nghị duyệt

- Thêm registry `lesson_programs`, nguồn lưu một lần theo mã chương trình; bài và lịch kế thừa nguồn.
- Một mã chỉ thuộc một nguồn, nguồn bất biến trong các luồng sửa hiện có; không tự đổi quy tắc sinh mã.
- Thêm nguồn ở tạo/import chương trình; dropdown chương trình trong lịch lọc theo nguồn ngay khi đổi lựa chọn, chỉ áp dụng kết quả sau nút Lọc.
- Backfill chỉ thêm metadata, không thay dữ liệu lịch/bài cũ; SQL triển khai database được duyệt riêng.

Sau khi được duyệt mới bắt đầu triển khai code và chuẩn bị migration/SQL cụ thể.
