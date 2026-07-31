# LMS - Bổ sung quản lý trợ giảng

## 1. Mục tiêu

Bổ sung khả năng lưu thông tin **trợ giảng (Teaching Assistant)** cho từng buổi học trong bảng `calendar`.

Ở giai đoạn hiện tại **không tạo bảng trung gian giữa `calendar` và `teacher_profiles`**.

Thiết kế tạm thời:

- `calendar.teacher`: tiếp tục lưu giáo viên hiện tại.
- `calendar.assistant_teacher`: lưu thông tin trợ giảng dưới dạng `String`.
- `teacher_profiles.teacher_type`: xác định loại nhân sự giảng dạy là giáo viên hay trợ giảng.

> Lưu ý: Đây là thiết kế đơn giản cho giai đoạn hiện tại. Nếu sau này một buổi học cần nhiều giáo viên/trợ giảng hoặc cần quản lý quan hệ phân công chi tiết, có thể nâng cấp sang bảng mapping.

---

## 2. Thay đổi bảng `calendar`

### 2.1. Field hiện tại

Bảng `calendar` hiện có:

```prisma
teacher String? @db.VarChar(150)
```

Field này tiếp tục được sử dụng để lưu giáo viên.

### 2.2. Field mới

Thêm:

```prisma
assistant_teacher String? @db.VarChar(500)
```

Mục đích:

- Lưu thông tin trợ giảng của buổi học.
- Cho phép lưu nhiều trợ giảng dưới dạng chuỗi.
- Không tạo foreign key trực tiếp ở giai đoạn này.

Ví dụ:

```text
assistant_teacher = "ta001,ta002"
```

hoặc tùy theo format hiện tại của hệ thống có thể lưu username / ID dưới dạng chuỗi.

### 2.3. Prisma model dự kiến

```prisma
model calendar {
  id                Int                   @id @default(autoincrement()) @db.UnsignedInt
  code              String                @db.VarChar(30)
  learn_number      Int
  subject           String?               @db.VarChar(100)
  start_time        DateTime              @db.Timestamp(0)
  end_time          DateTime              @db.Timestamp(0)

  teacher           String?               @db.VarChar(150)
  assistant_teacher String?               @db.VarChar(500)

  lesson_name       String?               @db.VarChar(400)
  lesson_document   String?               @db.LongText
  evg_banner        String?               @db.VarChar(500)
  evg_stream        String?               @db.VarChar(500)
  lesson_link       String?               @db.VarChar(500)
  lesson_count      Int?
  lesson_baitap     String?               @db.VarChar(500)
  lesson_tomtat     String?               @db.VarChar(500)
  lesson_phuongphap String?               @db.VarChar(500)
  lesson_luuy       String?               @db.VarChar(500)
  lesson_ketqua     String?               @db.VarChar(500)
  channel_name      String?               @db.VarChar(500)
  lesson_status     Int?                  @default(0) @db.TinyInt
  lesson_noti       String?               @db.VarChar(500)
  key               String?               @db.VarChar(100)
  system_type       calendar_system_type? @default(topclass)
  created_at        DateTime?             @default(now()) @db.Timestamp(0)
  updated_at        DateTime?             @default(now()) @db.Timestamp(0)

  @@unique([key], map: "uq_calendar_key")
  @@index([code, learn_number], map: "idx_calendar_code_learn")
  @@index([code, learn_number, start_time, end_time], map: "idx_calendar_code_time")
  @@index([system_type], map: "idx_calendar_system")
  @@index([start_time, end_time], map: "idx_calendar_time")
}
```

---

## 3. Thay đổi bảng `teacher_profiles`

### 3.1. Field mới

Bảng `teacher_profiles` đã có field:

```prisma
teacher_type Int @default(0) @db.TinyInt
```

Field này được sử dụng để phân biệt loại nhân sự.

Quy ước:

```text
0 = Teacher
1 = Teaching Assistant
```

Có thể mở rộng thêm giá trị trong tương lai nếu nghiệp vụ phát sinh.

### 3.2. Prisma model

```prisma
model teacher_profiles {
  id           Int       @id @default(autoincrement()) @db.UnsignedInt
  username     String    @unique(map: "uq_teacher_username") @db.VarChar(120)
  teacher_type Int       @default(0) @db.TinyInt
  display_name String?   @db.VarChar(100)
  created_at   DateTime? @default(now()) @db.Timestamp(0)
  updated_at   DateTime? @default(now()) @db.Timestamp(0)

  @@index([teacher_type], map: "idx_teacher_type")
}
```

---

## 4. SQL migration

Nếu database đang sử dụng trực tiếp MySQL, có thể thực hiện:

```sql
ALTER TABLE calendar
ADD COLUMN assistant_teacher VARCHAR(500) NULL
AFTER teacher;
```

`teacher_profiles.teacher_type` đã tồn tại trong schema hiện tại nên không cần tạo lại nếu database thực tế đã có column này.

Nếu database chưa có column `teacher_type`:

```sql
ALTER TABLE teacher_profiles
ADD COLUMN teacher_type TINYINT NOT NULL DEFAULT 0
AFTER username;
```

---

## 5. Quy ước dữ liệu

### `teacher_profiles.teacher_type`

| Value | Ý nghĩa |
|---:|---|
| `0` | Teacher |
| `1` | Teaching Assistant |

Ví dụ:

```text
teacher_profiles

id   username    display_name       teacher_type
10   teacher01   Nguyễn Văn A       0
20   ta01        Trần Văn B         1
21   ta02        Lê Văn C           1
```

### `calendar`

Ví dụ một buổi học:

```text
teacher = "teacher01"
assistant_teacher = "ta01,ta02"
```

Ý nghĩa:

```text
Teacher:
- Nguyễn Văn A

Teaching Assistants:
- Trần Văn B
- Lê Văn C
```

---

## 6. Quy ước lưu nhiều trợ giảng

Ở giai đoạn hiện tại `assistant_teacher` là `String`.

Nên thống nhất một format duy nhất trong toàn bộ BE/FE.

Khuyến nghị:

```text
assistant_teacher = "ta01,ta02,ta03"
```

Trong đó mỗi giá trị là `username` của `teacher_profiles`.

Không nên lưu display name:

```text
assistant_teacher = "Trần Văn B,Lê Văn C"
```

vì display name có thể thay đổi và không đảm bảo unique.

Nếu nghiệp vụ yêu cầu lưu **ID**, có thể sử dụng:

```text
assistant_teacher = "20,21,25"
```

Tuy nhiên nếu chọn ID thì cần thống nhất rõ rằng đây là `teacher_profiles.id`, không phải `users.id`.

### Khuyến nghị

Do `teacher_profiles.username` hiện đã unique, có thể ưu tiên:

```text
assistant_teacher = "ta01,ta02"
```

để tương thích với cách `calendar.teacher` đang lưu thông tin dạng username/string.

---

## 7. Backend

### Khi tạo lịch

Request có thể có:

```json
{
  "code": "MATH-12A",
  "learn_number": 5,
  "teacher": "teacher01",
  "assistant_teacher": "ta01,ta02"
}
```

Backend cần:

1. Kiểm tra `teacher` nếu có.
2. Kiểm tra các trợ giảng trong `assistant_teacher` nếu có.
3. Đảm bảo các username trợ giảng tồn tại trong `teacher_profiles`.
4. Nếu cần kiểm tra nghiệp vụ, đảm bảo `teacher_type = 1` đối với trợ giảng.
5. Lưu chuỗi `assistant_teacher` vào `calendar`.

### Khi cập nhật lịch

Cho phép:

- Thêm trợ giảng.
- Xóa trợ giảng.
- Thay đổi danh sách trợ giảng.

Ví dụ:

```text
Trước:
assistant_teacher = "ta01,ta02"

Sau:
assistant_teacher = "ta01,ta03"
```

---

## 8. Frontend

Trong form quản lý lịch, có thể bổ sung:

```text
Teacher
[ Nguyễn Văn A                  ]

Teaching Assistant
[ Trần Văn B ] [ Lê Văn C ] [+]
```

Nếu FE đang dùng Ant Design, có thể dùng `Select` với:

```text
mode="multiple"
```

Ví dụ dữ liệu FE:

```ts
const assistantTeachers = [
  {
    value: "ta01",
    label: "Trần Văn B",
  },
  {
    value: "ta02",
    label: "Lê Văn C",
  },
];
```

Khi submit:

```ts
{
  teacher: "teacher01",
  assistant_teacher: "ta01,ta02"
}
```

---

## 9. API response

Có thể trả về:

```json
{
  "id": 1001,
  "code": "MATH-12A",
  "learn_number": 5,
  "teacher": "teacher01",
  "assistant_teacher": "ta01,ta02"
}
```

Nếu FE cần hiển thị tên, Backend có thể resolve thông tin từ `teacher_profiles`.

Ví dụ response mở rộng:

```json
{
  "id": 1001,
  "code": "MATH-12A",
  "learn_number": 5,
  "teacher": {
    "username": "teacher01",
    "display_name": "Nguyễn Văn A",
    "teacher_type": 0
  },
  "assistant_teachers": [
    {
      "username": "ta01",
      "display_name": "Trần Văn B",
      "teacher_type": 1
    },
    {
      "username": "ta02",
      "display_name": "Lê Văn C",
      "teacher_type": 1
    }
  ]
}
```

Lưu ý: cấu trúc response trên là cấu trúc API trả về cho FE, không có nghĩa phải thay đổi cách lưu DB.

---

## 10. Không tạo bảng trung gian ở giai đoạn này

Không tạo:

```text
calendar_teachers
calendar_assistants
calendar_teacher_mapping
```

Thiết kế hiện tại giữ đơn giản:

```text
teacher_profiles
       │
       │ username
       │
       ├────────────── calendar.teacher
       │
       └────────────── calendar.assistant_teacher
```

`teacher_profiles` đóng vai trò danh mục người giảng dạy.

`calendar` lưu thông tin phân công dạng string.

---

## 11. Giới hạn của thiết kế hiện tại

Thiết kế này phù hợp nếu nhu cầu hiện tại chỉ là:

- Một giáo viên chính.
- Có thể có một hoặc nhiều trợ giảng.
- Chỉ cần lưu danh sách người phụ trách.
- Chưa cần quản lý chi tiết vai trò/phân công.

Tuy nhiên sẽ có một số hạn chế:

1. Không có foreign key trực tiếp từ `calendar` đến `teacher_profiles`.
2. Không đảm bảo DB-level referential integrity.
3. Query theo từng trợ giảng khó hơn.
4. Khó lưu thêm thông tin cho từng người trong một buổi học, ví dụ:
   - Thời gian tham gia.
   - Vai trò chi tiết.
   - Trạng thái tham gia.
   - Ghi chú.
   - Giáo viên thay thế.
5. Nếu sau này cần nhiều loại người phụ trách phức tạp, nên chuyển sang bảng mapping.

---

## 12. Hướng nâng cấp trong tương lai

Nếu nghiệp vụ LMS phát triển thành:

```text
Một buổi học
├── Teacher chính
├── Co-teacher
├── Teaching Assistant 1
├── Teaching Assistant 2
└── Teacher thay thế
```

thì có thể chuyển sang:

```text
calendar
    │
    └── calendar_teachers
            │
            └── teacher_profiles
```

và thêm:

```text
role_type
```

Ví dụ:

```text
0 = Teacher
1 = Teaching Assistant
2 = Co-teacher
3 = Substitute Teacher
```

Khi đó có thể quản lý quan hệ nhiều-nhiều một cách đầy đủ.

---

## 13. Checklist triển khai

### Database

- [ ] Thêm `calendar.assistant_teacher VARCHAR(500) NULL`.
- [ ] Xác nhận `teacher_profiles.teacher_type` tồn tại.
- [ ] Quy ước `teacher_type = 0` là Teacher.
- [ ] Quy ước `teacher_type = 1` là Teaching Assistant.

### Backend

- [ ] Update Prisma schema.
- [ ] Chạy migration.
- [ ] Update API create calendar.
- [ ] Update API update calendar.
- [ ] Update API detail calendar.
- [ ] Validate trợ giảng tồn tại.
- [ ] Validate `teacher_type = 1` nếu cần.

### Frontend

- [ ] Thêm field Teaching Assistant.
- [ ] Cho phép chọn nhiều trợ giảng.
- [ ] Hiển thị `display_name`.
- [ ] Submit username theo format thống nhất.
- [ ] Hiển thị danh sách trợ giảng khi xem lịch.

---

## 14. Kết luận

Thiết kế tạm thời:

```text
teacher_profiles
├── username
├── display_name
└── teacher_type
      ├── 0 = Teacher
      └── 1 = Teaching Assistant

calendar
├── teacher
└── assistant_teacher
```

Không tạo bảng mapping ở thời điểm hiện tại.

Thiết kế này đơn giản, ít ảnh hưởng schema hiện tại và phù hợp với nhu cầu bổ sung trợ giảng trước mắt. Khi nghiệp vụ yêu cầu quản lý phân công chi tiết hoặc nhiều loại người phụ trách, có thể migrate sang bảng mapping mà không ảnh hưởng đến `teacher_profiles`.

---

# 15. Thiết kế API quản lý giáo viên và trợ giảng

## 15.1. Nguyên tắc

API cần tách rõ 2 nhóm nghiệp vụ:

1. Quản lý danh sách giáo viên/trợ giảng.
2. Gán giáo viên/trợ giảng vào `calendar`.

Không expose trực tiếp toàn bộ dữ liệu `teacher_profiles` nếu user hiện tại không có quyền tương ứng.

---

## 15.2. API lấy danh sách giáo viên và trợ giảng

### GET `/api/teacher-profiles`

Dùng cho màn hình quản lý giáo viên/trợ giảng và các Select trong màn hình Calendar.

Query params đề xuất:

```text
?page=1
&limit=20
&search=nguyen
&teacher_type=0
&status=1
```

Ví dụ:

```http
GET /api/teacher-profiles?teacher_type=1&search=ta
```

Response:

```json
{
  "data": [
    {
      "id": 20,
      "username": "ta01",
      "display_name": "Trần Văn B",
      "teacher_type": 1
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

---

## 15.3. API lấy chi tiết

```http
GET /api/teacher-profiles/:id
```

Response:

```json
{
  "id": 20,
  "username": "ta01",
  "display_name": "Trần Văn B",
  "teacher_type": 1
}
```

---

## 15.4. API tạo giáo viên/trợ giảng

```http
POST /api/teacher-profiles
```

Request:

```json
{
  "username": "ta01",
  "display_name": "Trần Văn B",
  "teacher_type": 1
}
```

Validation:

- `username` bắt buộc.
- `username` không được trùng.
- `display_name` có thể nullable.
- `teacher_type` chỉ nhận giá trị hợp lệ.
- `0` = Teacher.
- `1` = Teaching Assistant.

---

## 15.5. API cập nhật giáo viên/trợ giảng

```http
PUT /api/teacher-profiles/:id
```

Request:

```json
{
  "display_name": "Trần Văn B",
  "teacher_type": 1
}
```

Không nên cho phép thay đổi `id`.

Nếu thay đổi `username`, cần kiểm tra các `calendar` đang sử dụng username đó trong `teacher` hoặc `assistant_teacher`.

---

## 15.6. API xóa / vô hiệu hóa

Khuyến nghị ưu tiên **soft delete / inactive** thay vì xóa vật lý.

Có thể bổ sung sau:

```prisma
status Int @default(1) @db.TinyInt
```

Quy ước:

```text
1 = Active
0 = Inactive
```

API:

```http
PATCH /api/teacher-profiles/:id/status
```

Request:

```json
{
  "status": 0
}
```

Không nên xóa người đang được sử dụng trong lịch học nếu chưa xử lý các lịch liên quan.

---

# 16. API quản lý trợ giảng trong Calendar

## 16.1. Tạo Calendar

```http
POST /api/calendar
```

Request:

```json
{
  "code": "MATH-12A",
  "learn_number": 5,
  "teacher": "teacher01",
  "assistant_teacher": "ta01,ta02",
  "start_time": "2026-07-31T19:00:00+07:00",
  "end_time": "2026-07-31T21:00:00+07:00"
}
```

Backend cần:

1. Validate teacher.
2. Parse danh sách `assistant_teacher`.
3. Validate từng username.
4. Kiểm tra `teacher_type = 1` đối với trợ giảng.
5. Loại bỏ username trùng nhau.
6. Lưu dữ liệu theo format thống nhất.

---

## 16.2. Cập nhật Calendar

```http
PUT /api/calendar/:id
```

Ví dụ:

```json
{
  "teacher": "teacher01",
  "assistant_teacher": "ta01,ta03"
}
```

Backend cần xác định:

```text
Danh sách cũ:
ta01, ta02

Danh sách mới:
ta01, ta03

=> Xóa ta02
=> Giữ ta01
=> Thêm ta03
```

---

## 16.3. API lấy danh sách trợ giảng cho Select

Có thể dùng chung:

```http
GET /api/teacher-profiles?teacher_type=1
```

Giáo viên:

```http
GET /api/teacher-profiles?teacher_type=0
```

Điều này giúp FE không cần hard-code danh sách.

---

# 17. Bổ sung quyền RBAC

Hệ thống hiện tại đã có:

```text
roles
permissions
user_roles
role_permissions
modules
module_fields
```

Do đó cần bổ sung permission cho module **Teacher / Teaching Assistant**.

## 17.1. Permission đề xuất

### Teacher Profile

```text
teacher_profile.view
teacher_profile.create
teacher_profile.update
teacher_profile.delete
teacher_profile.status
```

### Calendar Assignment

```text
calendar.teacher.view
calendar.teacher.assign
calendar.teacher.update
calendar.teacher.remove
```

Nếu muốn đơn giản hơn có thể chỉ dùng:

```text
teacher_profile.view
teacher_profile.manage

calendar.teacher.view
calendar.teacher.manage
```

Khuyến nghị dùng permission chi tiết vì hệ thống hiện tại đã có RBAC và fieldPolicy.

---

# 18. Quyền đề xuất cho từng role

## Admin

```text
teacher_profile.view
teacher_profile.create
teacher_profile.update
teacher_profile.delete
teacher_profile.status

calendar.teacher.view
calendar.teacher.assign
calendar.teacher.update
calendar.teacher.remove
```

## Academic Manager / Quản lý đào tạo

Có thể có toàn bộ quyền quản lý giáo viên/trợ giảng:

```text
teacher_profile.view
teacher_profile.create
teacher_profile.update
teacher_profile.status

calendar.teacher.view
calendar.teacher.assign
calendar.teacher.update
calendar.teacher.remove
```

Không nhất thiết có quyền delete vật lý.

## Teacher

Thông thường:

```text
teacher_profile.view
calendar.teacher.view
```

Có thể giới hạn dữ liệu chỉ thuộc phạm vi được phân công.

## Teaching Assistant

Thông thường:

```text
teacher_profile.view
calendar.teacher.view
```

Không có:

```text
teacher_profile.create
teacher_profile.delete
calendar.teacher.assign
```

---

# 19. Field-level permission

Vì hệ thống đang có `fieldPolicy`, có thể áp dụng cho module:

```text
teacher_profile
```

Các field:

```text
id
username
display_name
teacher_type
status
created_at
updated_at
```

Ví dụ:

```json
{
  "teacher_profile": {
    "username": {
      "view": true,
      "edit": false
    },
    "display_name": {
      "view": true,
      "edit": true
    },
    "teacher_type": {
      "view": true,
      "edit": false
    }
  }
}
```

Mục đích:

- Teacher có thể xem thông tin cơ bản.
- Academic Manager có thể thay đổi `teacher_type`.
- User thông thường không được thay đổi loại nhân sự.

---

# 20. UI - Quản lý giáo viên & trợ giảng

Bổ sung một module/menu:

```text
Quản lý nhân sự giảng dạy
├── Giáo viên
└── Trợ giảng
```

Hoặc dùng một màn hình duy nhất:

```text
Quản lý giáo viên & trợ giảng
```

với Tab:

```text
[ Tất cả ] [ Giáo viên ] [ Trợ giảng ]
```

Khuyến nghị dùng **một màn hình duy nhất + filter `teacher_type`**, vì hai loại dữ liệu đang dùng chung `teacher_profiles`.

---

## 20.1. Danh sách

UI đề xuất:

```text
Quản lý giáo viên & trợ giảng

[ Tìm kiếm tên / username ] [ Loại ▼ ] [ Trạng thái ▼ ] [ + Thêm ]

---------------------------------------------------------------
| Username | Họ tên | Loại | Trạng thái | Ngày tạo | Thao tác |
---------------------------------------------------------------
| teacher01| Nguyễn A| Giáo viên | Active | ... | Sửa |
| ta01     | Trần B   | Trợ giảng | Active | ... | Sửa |
---------------------------------------------------------------
```

Filter:

```text
Loại:
- Tất cả
- Giáo viên
- Trợ giảng

Trạng thái:
- Tất cả
- Active
- Inactive
```

---

## 20.2. Form thêm / sửa

Modal:

```text
Thêm nhân sự giảng dạy

Username
[________________________]

Tên hiển thị
[________________________]

Loại
[ Giáo viên ▼ ]

Trạng thái
[ Active ]

              [Hủy] [Lưu]
```

Nếu chọn:

```text
Loại = Trợ giảng
```

thì record sẽ có:

```text
teacher_type = 1
```

Nếu:

```text
Loại = Giáo viên
```

thì:

```text
teacher_type = 0
```

---

# 21. UI - Phân công giáo viên / trợ giảng trong Calendar

Trong `ScheduleModal` hoặc form Calendar hiện tại, bổ sung:

```text
Giáo viên
[ Nguyễn Văn A                       ▼ ]

Trợ giảng
[ Trần Văn B ] [ Lê Văn C ] [ + ▼ ]
```

Teacher:

```text
mode = single
```

Teaching Assistant:

```text
mode = multiple
```

FE lấy dữ liệu từ:

```http
GET /api/teacher-profiles?teacher_type=0
```

và:

```http
GET /api/teacher-profiles?teacher_type=1
```

Không hard-code danh sách người dùng trong FE.

---

# 22. UI - Phân quyền trong quản lý Role

Màn hình quản lý vai trò hiện tại cần bổ sung nhóm permission cho:

```text
Nhân sự giảng dạy
```

Ví dụ:

```text
Quản lý vai trò
────────────────────────────────────────

Vai trò: Academic Manager

[✓] Giáo viên & Trợ giảng
    [✓] Xem danh sách
    [✓] Thêm
    [✓] Sửa
    [ ] Xóa
    [✓] Thay đổi trạng thái

[✓] Phân công Calendar
    [✓] Xem giáo viên
    [✓] Gán giáo viên
    [✓] Cập nhật phân công
    [✓] Xóa phân công
```

---

# 23. UI - Chi tiết Role và Permission

Trong màn hình Role Detail nên có phần:

```text
Thông tin vai trò

Tên vai trò:
[ Academic Manager ]

Mô tả:
[ Quản lý đào tạo ]

---------------------------------------

Quyền

Calendar
├── [✓] Xem
├── [✓] Tạo
├── [✓] Sửa
└── [✓] Xóa

Giáo viên & Trợ giảng
├── [✓] Xem
├── [✓] Thêm
├── [✓] Sửa
├── [ ] Xóa
└── [✓] Đổi trạng thái

Phân công giáo viên
├── [✓] Xem
├── [✓] Gán
├── [✓] Cập nhật
└── [✓] Gỡ
```

Các checkbox này tương ứng trực tiếp với `permissions`.

---

# 24. Module / Field metadata

Để đồng bộ với `modules` và `module_fields`, có thể bổ sung:

## Module

```text
code: teacher_profile
name: Giáo viên & Trợ giảng
```

## Fields

```text
username
display_name
teacher_type
status
created_at
updated_at
```

Ví dụ:

```text
teacher_profile.username
teacher_profile.display_name
teacher_profile.teacher_type
teacher_profile.status
```

Điều này cho phép cấu hình `fieldPolicy` cho role mà không cần hard-code toàn bộ field ở frontend.

---

# 25. API Permission

Nếu hệ thống đã có API quản lý Role/Permission, cần seed thêm các permission mới.

Ví dụ:

```json
[
  {
    "code": "teacher_profile.view",
    "name": "Xem giáo viên và trợ giảng"
  },
  {
    "code": "teacher_profile.create",
    "name": "Thêm giáo viên và trợ giảng"
  },
  {
    "code": "teacher_profile.update",
    "name": "Sửa giáo viên và trợ giảng"
  },
  {
    "code": "teacher_profile.delete",
    "name": "Xóa giáo viên và trợ giảng"
  },
  {
    "code": "teacher_profile.status",
    "name": "Thay đổi trạng thái"
  },
  {
    "code": "calendar.teacher.view",
    "name": "Xem phân công giáo viên"
  },
  {
    "code": "calendar.teacher.assign",
    "name": "Gán giáo viên và trợ giảng"
  },
  {
    "code": "calendar.teacher.update",
    "name": "Cập nhật phân công"
  },
  {
    "code": "calendar.teacher.remove",
    "name": "Gỡ giáo viên và trợ giảng"
  }
]
```

---

# 26. Checklist bổ sung

## Database

- [ ] Thêm `calendar.assistant_teacher`.
- [ ] Xác nhận `teacher_profiles.teacher_type`.
- [ ] Chuẩn hóa `teacher_type`.
- [ ] Không tạo bảng mapping.

## Backend API

- [ ] GET teacher profiles.
- [ ] GET teacher profile detail.
- [ ] POST teacher profile.
- [ ] PUT teacher profile.
- [ ] PATCH teacher profile status.
- [ ] Update create calendar.
- [ ] Update update calendar.
- [ ] Validate teacher.
- [ ] Validate teaching assistants.
- [ ] API filter theo `teacher_type`.

## RBAC

- [ ] Seed `teacher_profile.view`.
- [ ] Seed `teacher_profile.create`.
- [ ] Seed `teacher_profile.update`.
- [ ] Seed `teacher_profile.delete`.
- [ ] Seed `teacher_profile.status`.
- [ ] Seed `calendar.teacher.view`.
- [ ] Seed `calendar.teacher.assign`.
- [ ] Seed `calendar.teacher.update`.
- [ ] Seed `calendar.teacher.remove`.
- [ ] Gán permission cho các role phù hợp.
- [ ] Bổ sung fieldPolicy cho `teacher_profile`.

## Frontend

- [ ] Menu Quản lý giáo viên & trợ giảng.
- [ ] Danh sách giáo viên/trợ giảng.
- [ ] Filter theo loại.
- [ ] Search.
- [ ] Form thêm.
- [ ] Form sửa.
- [ ] Active/Inactive.
- [ ] Chọn giáo viên trong Calendar.
- [ ] Chọn nhiều trợ giảng trong Calendar.
- [ ] Kiểm tra permission trước khi hiển thị action.
- [ ] Bổ sung nhóm quyền giáo viên/trợ giảng trong Role Management.
- [ ] Bổ sung checkbox permission trong Role Detail.
- [ ] Bổ sung field permission nếu sử dụng `fieldPolicy`.

---

# 27. Luồng nghiệp vụ tổng thể

```text
                    ┌──────────────────────────┐
                    │ Teacher Profiles         │
                    │                          │
                    │ Teacher                  │
                    │ Teaching Assistant       │
                    └────────────┬─────────────┘
                                 │
                    teacher_type │
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
              ▼                                     ▼
     Calendar Teacher                    Calendar Assistant
              │                                     │
              └──────────────────┬──────────────────┘
                                 │
                                 ▼
                           Calendar Session
                                 │
                                 ▼
                         Schedule / Livestream
```

Quản lý quyền:

```text
User
  │
  ▼
Role
  │
  ├── teacher_profile.view
  ├── teacher_profile.create
  ├── teacher_profile.update
  ├── teacher_profile.status
  │
  ├── calendar.teacher.view
  ├── calendar.teacher.assign
  ├── calendar.teacher.update
  └── calendar.teacher.remove
```

---

# 28. Kết luận cập nhật

Thiết kế hiện tại vẫn giữ nguyên nguyên tắc đơn giản:

```text
teacher_profiles
├── username
├── display_name
└── teacher_type
      ├── 0 = Teacher
      └── 1 = Teaching Assistant

calendar
├── teacher
└── assistant_teacher
```

Bổ sung thêm 3 nhóm chức năng:

```text
1. API
   ├── CRUD teacher_profiles
   ├── Filter Teacher / Teaching Assistant
   └── Gán Teacher / Teaching Assistant vào Calendar

2. RBAC
   ├── Permission quản lý Teacher / TA
   ├── Permission phân công Calendar
   └── FieldPolicy cho teacher_profile

3. UI
   ├── Quản lý Giáo viên & Trợ giảng
   ├── Chọn Giáo viên / Trợ giảng trong Calendar
   └── Quản lý Permission trong Role Management
```

Thiết kế này đáp ứng nhu cầu hiện tại mà chưa cần thêm bảng trung gian. Khi nghiệp vụ cần quản lý quan hệ phân công chi tiết hơn, có thể nâng cấp sau.
