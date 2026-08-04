# Quiz Management API

Base path: `/api/quizzes`.

Tất cả endpoint yêu cầu access token:

```http
Authorization: Bearer <access-token>
```

Runtime livestream cũ (`/api/quiz/*`, Redis, Socket.IO) không nằm trong module này.

Để đồng bộ metadata field/permission Quiz theo cách không xóa role hoặc permission hiện có, quản trị viên có thể chạy có chủ đích:

```bash
npm run db:quiz-rbac
```

Lệnh này chạy idempotent: upsert module cùng 14 field metadata, 7 permission và tự gán các quyền Quiz cùng field policy toàn quyền cho role `admin` nếu role này tồn tại. Các role khác được cấu hình thủ công từ màn hình Vai trò thành viên.

## Quy ước dữ liệu

- `ans_duration` tính bằng **giây**, hợp lệ từ 1 đến 3600.
- `quiz_type`: `1` trắc nghiệm, `2` điền từ, `3` trả lời ngắn.
- `score_type`: `1` toàn câu, `2` theo ý.
- `quiz_status`: `active`, `done`, `disable`.
- Xóa là xóa mềm sang `disable`; restore chuyển về `done` để tương thích runtime cũ.
- `quiz_id` là string tối đa 100 ký tự. Nếu create/import không truyền, server sinh UUID.

### Trắc nghiệm

```json
[
  { "A": false, "text": "3" },
  { "B": true, "text": "4" }
]
```

Tối thiểu hai lựa chọn và một lựa chọn đúng. Key phải tuần tự `A`, `B`, `C`...

### Điền từ

```json
[
  { "placeholder": "Thủ đô Việt Nam", "text": "Hà Nội; Ha Noi", "A": true }
]
```

### Trả lời ngắn

```json
[
  { "A": true, "text": "Đáp án mẫu" }
]
```

## Endpoint

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/` | `quiz.view` | Danh sách có filter và pagination |
| GET | `/options` | `quiz.view` | Options type, score, status và đơn vị thời gian |
| GET | `/classes` | `quiz.view` | Danh sách lớp học tổng hợp từ dữ liệu lịch học |
| GET | `/lessons?code=...` | `quiz.view` | Danh sách bài học/buổi học của một lớp |
| GET | `/export` | `quiz.export` | Export XLSX/CSV, áp dụng field visibility |
| GET | `/template` | `quiz.import` | Tải file import mẫu |
| POST | `/import` | `quiz.import` | Import transaction với mode `skip/overwrite` |
| PATCH | `/bulk` | `quiz.update` | Bulk status/score type/duration |
| PATCH | `/reorder` | `quiz.update` | Sắp xếp toàn bộ quiz enabled trong lớp/buổi |
| GET | `/:quizId` | `quiz.view` | Chi tiết |
| POST | `/` | `quiz.create` | Tạo quiz |
| PUT | `/:quizId` | `quiz.update` | Cập nhật partial payload |
| DELETE | `/:quizId` | `quiz.delete` | Soft disable |
| POST | `/:quizId/restore` | `quiz.update` | Restore về `done` |
| GET | `/:quizId/submissions` | `quiz.grade` | Submission history/latest |
| GET | `/:quizId/analytics` | `quiz.grade` | Thống kê tổng hợp |

Endpoint submission/analytics dùng `quiz.grade` thay vì `quiz.view` để học viên có quyền xem nội dung Quiz không thể xem dữ liệu của học viên khác.

## List query

```http
GET /api/quizzes?page=1&limit=20&code=toan-7-2027&learn_number=10&quiz_status=active&sort_by=quiz_index&sort_order=asc
```

Filter hỗ trợ:

- `code`
- `learn_number`
- `quiz_type`
- `score_type`
- `quiz_status`
- `keyword` trên tên câu hỏi
- `sort_by`, `sort_order`

`limit` tối đa 100.

## Lớp học và bài học

`GET /api/quizzes/classes` trả `code`, tên môn học và số bài học của từng lớp từ dữ liệu `calendar`.

Sau khi chọn lớp, gọi `GET /api/quizzes/lessons?code=<mã-lớp>` để lấy danh sách gồm `learn_number`, `lesson_name`, `subject_name`, `grade` và `lesson_id` nếu lịch đã liên kết với nội dung bài học. Hai endpoint dùng `quiz.view`, vì vậy người quản lý câu hỏi không cần được cấp thêm quyền xem toàn bộ lịch học.

## Create

```http
POST /api/quizzes
Content-Type: application/json
```

```json
{
  "code": "toan-7-2027",
  "learn_number": 10,
  "quiz_type": 1,
  "quiz_name": "2 + 2 bằng bao nhiêu?",
  "ans": [
    { "A": false, "text": "3" },
    { "B": true, "text": "4" }
  ],
  "score_type": 1,
  "ans_duration": 60,
  "quiz_status": "active",
  "quiz_index": 1
}
```

`creator` luôn lấy từ access token. Client không được gửi field hệ thống.

## Update

`PUT /api/quizzes/:quizId` nhận partial payload. Nếu thay `quiz_type`, request bắt buộc gửi lại `ans` để server validate đúng schema mới.

```json
{
  "quiz_name": "Tên câu hỏi mới",
  "ans_duration": 90
}
```

## Bulk update

Chỉ hỗ trợ `score_type`, `ans_duration`, `quiz_status`, tối đa 500 quiz:

```json
{
  "quiz_ids": ["q-1", "q-2"],
  "data": {
    "quiz_status": "disable"
  }
}
```

## Reorder

Phải gửi đủ toàn bộ quiz không bị `disable` trong đúng `code + learn_number`:

```json
{
  "code": "toan-7-2027",
  "learn_number": 10,
  "ordered_quiz_ids": ["q-2", "q-1", "q-3"]
}
```

Reorder chạy trong transaction và khóa group để tránh ghi đè khi có request đồng thời.

## Import/export

Import dùng `multipart/form-data`:

- `file`: `.xlsx` hoặc `.csv`, tối đa 5 MB và 5000 dòng.
- `mode`: `skip` mặc định hoặc `overwrite`.

Toàn file được validate trước; có bất kỳ dòng lỗi nào thì không ghi database. Error trả `row` và `message`.

Export query hỗ trợ các filter như list, `format=xlsx|csv`, và `quiz_ids=q-1,q-2`. Dữ liệu bị ẩn theo field policy không được đưa vào file.

## Submissions

```http
GET /api/quizzes/:quizId/submissions?page=1&limit=20&latest=true&username=123&class_id=class-1
```

- `latest=true` mặc định: lấy deterministic record có `id` lớn nhất của mỗi username.
- `latest=false`: lấy toàn bộ lịch sử.
- Mỗi record có `is_star` để phân biệt record thưởng sao legacy.

## Analytics

`GET /api/quizzes/:quizId/analytics` trả:

- tổng record và tổng học viên khác nhau;
- điểm trung bình/nhỏ nhất/lớn nhất;
- thời gian trung bình;
- số record sao;
- thời điểm submission đầu/cuối.

Module không suy diễn attempt/session từ timestamp và chưa cung cấp mutation chấm/sửa điểm.
