# Thiết kế nghiệp vụ: Dời lịch học (Reschedule Session) & Đồng bộ HMO

## 1. Bối cảnh

Hiện tại hệ thống LMS quản lý lịch học thông qua bảng `calendar`.

Một bài học trong đề cương **có thể được livestream nhiều lần**, vì vậy:

- Một `lesson_number` có thể xuất hiện nhiều session.
- Mỗi lần phát lại được phân biệt bằng `lesson_count`.
- Mỗi session có một `key` duy nhất để đồng bộ sang hệ thống HMO.

Ngoài LMS, hệ thống còn đồng bộ dữ liệu sang **HMO** thông qua trường `key`.

Các bảng liên quan:

- `calendar`
- `package_lesson_mapping`
- `hocmai_sync_queue`

Hiện tại việc đồng bộ đang dựa hoàn toàn vào `key`.

---

# 2. Quy tắc dữ liệu

## lesson_number

Là số thứ tự bài học trong đề cương.

Ví dụ:

```
lesson_number = 1
```

nghĩa là bài số 1.

---

## lesson_count

Lưu số lần bài học được livestream.

Quy ước:

| lesson_count | Ý nghĩa |
|--------------|----------|
| 0 | lần học thứ 1 |
| 1 | lần học thứ 2 |
| 2 | lần học thứ 3 |
| ... | ... |

Ví dụ:

```
lesson_number = 5
lesson_count = 0
```

→ Buổi học đầu tiên của bài 5.

```
lesson_number = 5
lesson_count = 1
```

→ Buổi học bù / học lại lần thứ hai của bài 5.

---

# 3. Quy tắc sinh KEY

KEY chính là SessionId dùng để đồng bộ sang HMO.

Format:

```
[system_type]_[nam_hoc]_[code]_[lesson_number]_b[lesson_count + 1]
```

Trong đó

```
system_type

topclass => tc

topuni => tu
```

Ví dụ

```
system_type = topclass

năm học = 2026-2027

code = toan-6

lesson_number = 5

lesson_count = 0
```

Sinh ra

```
tc_2627_toan-6_5_b1
```

Nếu cùng bài được livestream lần 2

```
lesson_count = 1
```

Sinh ra

```
tc_2627_toan-6_5_b2
```

Lưu ý:

> KEY phải luôn là duy nhất.

---

# 4. Các trường hợp dời lịch

Có 3 trường hợp.

---

# Trường hợp 1
## Nghỉ học, không học bù

Không phát sinh lịch mới.

Chỉ update

```
lesson_status

0 -> 1
```

Không thay đổi:

- key
- lesson_number
- lesson_count

Không ghi queue đồng bộ.

---

# Trường hợp 2
## Nghỉ học và tạo lịch học bù

Ví dụ

```
lesson_number = 1

lesson_count = 0
```

Giáo viên chọn một ngày học bù.

Nếu thời gian hợp lệ thì:

- tạo một record calendar mới
- copy toàn bộ dữ liệu bài học
- lesson_number giữ nguyên
- lesson_count tăng thêm 1
- sinh KEY mới

Ví dụ

Buổi gốc

```
lesson_number = 1

lesson_count = 0

key = tc_2627_toan-6_1_b1
```

Buổi học bù

```
lesson_number = 1

lesson_count = 1

key = tc_2627_toan-6_1_b2
```

Buổi gốc sẽ chuyển

```
lesson_status = 1
```

---

# Trường hợp 3
## Dời lịch theo chuỗi (Following)

Đây là trường hợp phức tạp nhất.

Áp dụng khi việc nghỉ học làm ảnh hưởng tiến độ toàn khóa.

Ví dụ

```
Buổi 5 nghỉ
```

Muốn toàn bộ đề cương lùi xuống 1 buổi.

Mục tiêu:

Giữ nguyên thứ tự bài học.

Ví dụ

Trước

```
Buổi 5 -> Bài 5

Buổi 6 -> Bài 6

Buổi 7 -> Bài 7
```

Sau

```
Buổi 5 -> Nghỉ

Buổi 6 -> Bài 5

Buổi 7 -> Bài 6

Buổi 8 -> Bài 7
```

Có nghĩa là:

- toàn bộ nội dung đề cương được dồn xuống dưới
- tạo thêm một buổi mới ở cuối
- vẫn giữ đúng thứ tự đề cương

---

## Quy tắc cập nhật

Không đổi KEY của các session hiện có.

Chỉ thay đổi:

- lesson_number
- lesson_name
- lesson_document
- toàn bộ thông tin giáo trình
- lesson_count (nếu cần)

Buổi cuối sẽ phát sinh thêm một session mới.

Session mới được cung cấp:

- start_time
- end_time

và sinh KEY mới.

---

## Điều kiện validate

Khi tạo buổi mới phải kiểm tra:

- Giáo viên không bị trùng lịch.
- Phòng học không bị trùng.
- Hai buổi cùng khóa không được trùng thời gian.
- lesson_number không bị thiếu.
- lesson_number không bị trùng.
- start_time < end_time.
- Không vượt ngày kết thúc khóa học.
- Không sửa các buổi đã diễn ra (hoặc yêu cầu xác nhận/phân quyền).

---

# 5. Vấn đề hiện tại của HMO

Hiện tại HMO đồng bộ dựa trên:

```
calendar.key
```

và

```
package_lesson_mapping.key
```

Nếu chỉ dồn nội dung đề cương xuống dưới nhưng vẫn giữ nguyên KEY thì HMO hiểu sai.

Ví dụ

Ban đầu

```
KEY A

lesson_number = 5
```

Sau khi dồn

```
KEY A

lesson_number = 6
```

HMO vẫn coi

```
KEY A
```

là session cũ.

Điều này dẫn tới:

- Lesson mapping sai
- Session bên HMO sai
- Nội dung học bị lệch

Do HMO đang coi KEY chính là SessionId.

---

# 6. Yêu cầu cần phân tích

Cần thiết kế lại nghiệp vụ dời lịch sao cho:

- Không làm sai dữ liệu trên LMS.
- Không làm sai SessionId trên HMO.
- Không làm sai mapping package_lesson_mapping.
- Không làm sai queue đồng bộ.
- Đảm bảo lịch học sau khi dời vẫn đúng thứ tự đề cương.

---

# 7. Các bảng liên quan

## calendar

```prisma
model calendar {
  id                Int                   @id @default(autoincrement()) @db.UnsignedInt
  code              String                @db.VarChar(30)
  learn_number      Int
  subject           String?               @db.VarChar(100)
  start_time        DateTime              @db.Timestamp(0)
  end_time          DateTime              @db.Timestamp(0)
  teacher           String?               @db.VarChar(150)
  lesson_name       String?               @db.VarChar(400)
  lesson_document   String?               @db.VarChar(500)
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
}
```

---

## package_lesson_mapping

```prisma
model package_lesson_mapping {
  id           Int     @id @default(autoincrement())
  package_id   String  @db.VarChar(50)
  lesson_id    String  @db.VarChar(50)
  code         String  @db.VarChar(30)
  learn_number Int
  key          String? @db.VarChar(100)
}
```

---

## hocmai_sync_queue

```prisma
model hocmai_sync_queue {
  id         Int       @id @default(autoincrement())
  c_key      String    @db.VarChar(50)
  action     String    @db.VarChar(20)
  payload    String    @db.LongText
  status     Int?      @default(0) @db.TinyInt
  synced_at  DateTime? @db.Timestamp(0)
  last_error String?   @db.Text
  created_at DateTime  @default(now()) @db.Timestamp(0)
}
```

---

# 8. Mục tiêu của Codex

Hãy phân tích toàn bộ nghiệp vụ trên và đề xuất giải pháp tối ưu để:

1. Thiết kế lại luồng dời lịch học.
2. Đảm bảo dữ liệu LMS luôn đúng.
3. Đảm bảo HMO luôn đồng bộ chính xác.
4. Hạn chế tối đa việc thay đổi KEY không cần thiết.
5. Đề xuất phương án migrate dữ liệu nếu cần.
6. Đưa ra flow xử lý cho cả Backend, Database và HMO Sync.
7. Phân tích ưu/nhược điểm của từng phương án trước khi lựa chọn phương án cuối cùng.
