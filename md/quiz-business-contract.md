# Quiz Management Business Contract

Contract này áp dụng cho module quản trị mới `/api/quizzes`. Nó không thay contract runtime livestream cũ.

## Trạng thái

| Trạng thái | Ý nghĩa trong management | Có xuất hiện trong list mặc định |
|---|---|---|
| `active` | Content đang được bật theo dữ liệu legacy | Có |
| `done` | Content đã hoàn thiện/kích hoạt theo flow legacy | Có |
| `disable` | Content bị xóa mềm/vô hiệu hóa | Có, trừ khi client filter |

Do runtime cũ đang coi `active` và `done` đều là enabled, management API không tự diễn giải lại hai trạng thái này. Restore từ `disable` về `done`, giống endpoint activate cũ.

## Identity và phạm vi

- Một Quiz gắn trực tiếp với `code + learn_number`.
- `quiz_id` unique toàn database, không đổi sau create.
- Client có thể cung cấp `quiz_id` khi tạo để tương thích hệ thống ngoài; nếu bỏ trống, server sinh UUID.
- `creator` lấy từ access token.

Question bank dùng chung và version/snapshot không nằm trong scope vì schema hiện tại chưa hỗ trợ.

## Loại câu hỏi

| Giá trị | Tên chuẩn management | Chấm hiện tại |
|---|---|---|
| `1` | Trắc nghiệm | Toàn câu hoặc theo lựa chọn đúng |
| `2` | Điền từ | Toàn câu hoặc theo ô đúng |
| `3` | Trả lời ngắn | Một đáp án mẫu; không phải tự luận chấm tay |

Management API chỉ validate và lưu answer contract. Runtime cũ vẫn chịu trách nhiệm làm/chấm bài trong phase hiện tại.

## Thời gian và điểm

- `ans_duration` dùng giây, từ 1 đến 3600.
- `score_type = 1`: tính điểm toàn câu.
- `score_type = 2`: tính điểm theo ý.
- Module management không tự chấm và không cung cấp mutation sửa điểm.

## Lifecycle mutation

- Create yêu cầu content hợp lệ và mặc định do client khai báo rõ status/index.
- Update là partial nhưng không cho mass assignment field hệ thống.
- Thay `quiz_type` phải gửi lại `ans`.
- Delete là soft disable.
- Restore về `done`.
- Reorder chỉ áp dụng cho toàn bộ Quiz không disable trong cùng `code + learn_number`.
- Bulk chỉ cho đổi `score_type`, `ans_duration`, `quiz_status`.

## Import

- Hỗ trợ CSV/XLSX.
- Toàn file phải hợp lệ trước khi bắt đầu transaction.
- `skip`: giữ record có `quiz_id` đã tồn tại.
- `overwrite`: cập nhật content theo `quiz_id`; không đổi creator ban đầu.
- Dòng không có `quiz_id` luôn tạo mới với UUID.

## Quyền

- Content list/detail: `quiz.view`, đồng thời lọc field visibility.
- Mutation: permission create/update/delete/import tương ứng và field edit policy.
- Export: `quiz.export`, đồng thời lọc field visibility trước khi tạo file.
- Submission/analytics: `quiz.grade` để không lộ dữ liệu học viên cho role student có `quiz.view`.

## Giới hạn đã chấp nhận trong phase này

- Không phân biệt được nhiều lần phát cùng một `quiz_id` thành các attempt riêng.
- Không có snapshot/version content tại thời điểm phát.
- Không có grader/audit columns cho sửa điểm.
- Record thưởng sao vẫn nằm trong `quiz_logs`; API chỉ đánh dấu `is_star` và analytics đếm riêng.
- Không thay Redis, Socket.IO, timer hoặc submission flow của runtime cũ.
