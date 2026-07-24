# Đề xuất bổ sung bảng `lessons`

## 1. Bối cảnh

Hiện tại hệ thống sử dụng bảng `calendar` để quản lý toàn bộ thông tin của một buổi học.

Mỗi bản ghi trong `calendar` đại diện cho một phiên học (Session), tuy nhiên bảng này cũng đang lưu toàn bộ thông tin của bài học như:

- lesson_name
- lesson_document
- lesson_baitap
- lesson_tomtat
- lesson_phuongphap
- lesson_luuy
- lesson_ketqua

Trong thực tế nghiệp vụ:

- Một bài học (`learn_number`) có thể được tổ chức Live nhiều lần.
- Có thể phát sinh lịch học bù.
- Có thể phát sinh lịch học lại.
- Mỗi phiên học có thể có:
  - Giáo viên khác nhau.
  - Banner khác nhau.
  - Stream khác nhau.
  - Thời gian khác nhau.
  - Tên hiển thị khác nhau.

Ví dụ:

| code | learn_number | start_time | lesson_name |
|------|--------------|------------|-------------|
| nguvan-6-2027 | 1 | 22/06 | Từ phân chia theo cấu tạo |
| nguvan-6-2027 | 1 | 26/06 | [Lịch 2] - Từ phân chia theo cấu tạo |
| nguvan-6-2027 | 1 | 01/07 | [Học bù] - Từ phân chia theo cấu tạo |

Trong khi đó các thông tin như:

- Tên chuẩn bài học
- Tài liệu
- Bài tập
- Tóm tắt
- Phương pháp
- Lưu ý
- Kết quả

lại là dữ liệu dùng chung của bài học và đang bị lưu lặp lại ở tất cả các phiên học.

---

# 2. Mục tiêu

Bổ sung bảng `lessons` để quản lý tập trung toàn bộ thông tin của bài học.

Mục tiêu:

- Chuẩn hóa dữ liệu.
- Giảm dữ liệu trùng lặp.
- Dễ quản lý nội dung bài học.
- Chuẩn bị cho các chức năng quản lý chương trình học trong tương lai.

Đồng thời **không thay đổi cấu trúc và nghiệp vụ hiện tại của bảng `calendar`** nhằm đảm bảo các module đang hoạt động không bị ảnh hưởng.

---

# 3. Thiết kế bảng `lessons`

```prisma
model lessons {
  id                BigInt   @id @default(autoincrement())

  /// Mã khóa học
  code              String   @db.VarChar(50)

  /// Khối
  grade             Int

  /// Môn học
  subject_code      String   @db.VarChar(20)
  subject_name      String   @db.VarChar(100)

  /// Chương (dự phòng mở rộng)
  chapter_id        BigInt?
  chapter_name      String?  @db.VarChar(200)

  /// Thứ tự bài học
  learn_number      Int

  /// Tên chuẩn bài học
  lesson_name       String   @db.VarChar(400)

  /// Nội dung bài học
  lesson_document   String?  @db.VarChar(500)
  lesson_baitap     String?  @db.VarChar(500)
  lesson_tomtat     String?  @db.VarChar(500)
  lesson_phuongphap String?  @db.VarChar(500)
  lesson_luuy       String?  @db.VarChar(500)
  lesson_ketqua     String?  @db.VarChar(500)

  status            Int      @default(1)

  created_at        DateTime @default(now())
  updated_at        DateTime @updatedAt

  @@unique([code, learn_number])
  @@index([grade, subject_code])
  @@index([chapter_id])
  @@index([code])
}
```

---

# 4. Thiết kế bảng `calendar`

Bảng `calendar` **giữ nguyên cấu trúc hiện tại**.

Không đổi tên trường.

Không xóa trường.

Không thay đổi dữ liệu hiện có.

Lý do:

Hiện tại rất nhiều nghiệp vụ của hệ thống đang sử dụng trực tiếp bảng `calendar`, bao gồm:

- API
- Frontend
- Trigger
- Queue Sync
- Đồng bộ HMO
- Thông báo
- Báo cáo
- Các module khác

Việc thay đổi cấu trúc của bảng `calendar` sẽ kéo theo việc phải refactor toàn bộ các nghiệp vụ trên và làm tăng rủi ro triển khai.

Do đó, giai đoạn đầu chỉ bổ sung thêm bảng `lessons`, còn bảng `calendar` vẫn hoạt động như hiện tại.

---

# 5. Mối quan hệ giữa hai bảng

Bảng `lessons` đóng vai trò là **Master Data** của bài học.

Bảng `calendar` đóng vai trò là **Session Data**.

Hai bảng được liên kết thông qua:

```text
(code, learn_number)
```

Quan hệ:

```
                lessons
        +-------------------------+
        | id                      |
        | code                    |
        | grade                   |
        | subject_code            |
        | subject_name            |
        | learn_number            |
        | lesson_name             |
        | lesson_document         |
        | lesson_baitap           |
        | lesson_tomtat           |
        | lesson_phuongphap       |
        | lesson_luuy             |
        | lesson_ketqua           |
        +-------------------------+
                  ▲
                  │
        code + learn_number
                  │
                  ▼
               calendar
        +-------------------------+
        | id                      |
        | code                    |
        | learn_number            |
        | lesson_name             |
        | teacher                 |
        | start_time              |
        | end_time                |
        | evg_banner              |
        | evg_stream              |
        | lesson_link             |
        | lesson_status           |
        | lesson_count            |
        | channel_name            |
        | key                     |
        | ...                     |
        +-------------------------+
```

Quan hệ giữa hai bảng:

- Một bài học (`lessons`) có thể có nhiều phiên học (`calendar`).
- Một phiên học (`calendar`) chỉ thuộc về một bài học (`lessons`).

```
Lesson (1)
     │
     │
     └───────────────< Calendar (N)
```

---

# 6. Luồng dữ liệu

## Tạo bài học

Khi tạo mới bài học:

- Thông tin chuẩn của bài học sẽ được lưu vào bảng `lessons`.

Ví dụ:

- lesson_name
- lesson_document
- lesson_baitap
- lesson_tomtat
- lesson_phuongphap
- lesson_luuy
- lesson_ketqua

Mỗi bài học chỉ tồn tại một bản ghi.

---

## Tạo lịch học

Khi tạo lịch học:

Hệ thống vẫn ghi dữ liệu vào bảng `calendar` như hiện tại.

Bao gồm:

- lesson_name
- teacher
- start_time
- end_time
- stream
- banner
- lesson_link
- ...

Không thay đổi luồng xử lý hiện tại.

---

## Đồng bộ dữ liệu

Khi người dùng cập nhật nội dung bài học:

- Cập nhật dữ liệu trong bảng `lessons`.
- Có thể đồng bộ sang các bản ghi trong `calendar` nếu cần (tùy theo nghiệp vụ).

Điều này giúp các module cũ vẫn hoạt động bình thường trong khi các module mới có thể bắt đầu sử dụng dữ liệu từ bảng `lessons`.

---

# 7. Lợi ích

- Chuẩn hóa dữ liệu bài học.
- Có nơi quản lý tập trung toàn bộ nội dung bài học.
- Giảm dữ liệu trùng lặp.
- Dễ chỉnh sửa tài liệu bài học.
- Dễ triển khai quản lý chương trình học.
- Hỗ trợ phân chia theo khối, môn học và chương.
- Không ảnh hưởng đến các API hiện tại.
- Không ảnh hưởng Trigger.
- Không ảnh hưởng Queue Sync.
- Không ảnh hưởng HMO Sync.
- Không ảnh hưởng Frontend.
- Giảm tối đa rủi ro khi triển khai.

---

# 8. Định hướng mở rộng

Sau khi bảng `lessons` được đưa vào sử dụng ổn định, các chức năng mới có thể ưu tiên lấy dữ liệu từ bảng này thay vì từ `calendar`.

Ví dụ:

- Quản lý chương trình học.
- Danh sách bài học.
- Quản lý Chapter.
- Import/Export chương trình học.
- Đồng bộ dữ liệu với LMS khác.
- Quản lý phiên bản bài học.
- Quản lý Template bài học.

Trong khi đó các nghiệp vụ hiện tại vẫn tiếp tục sử dụng bảng `calendar`, đảm bảo khả năng tương thích và giảm thiểu việc phải refactor toàn bộ hệ thống.