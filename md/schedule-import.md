# BE Requirement: Import Sheet → HMO Batch API → Validate → Import Calendar

## 1. Mục tiêu

Thay đổi flow Import hiện tại để hỗ trợ đúng format file Sheet thực tế.

### Sheet mẫu chuẩn

**Google Sheet tham chiếu:**

[Sheet mẫu Import LMS](https://docs.google.com/spreadsheets/d/1RDnAISxLG-35_OLx9b5s8GVP1ean5co4ChBLO4LTwB4/edit?usp=sharing&utm_source=chatgpt.com)

Đây là **format chuẩn** mà hệ thống phải hỗ trợ.

Trong tương lai, khi người dùng import file, file được kỳ vọng có cấu trúc tương đương Sheet mẫu này.

BE phải đọc Sheet mẫu để xác định:

* Tên column.
* Cấu trúc dữ liệu.
* Các column thông tin lịch.
* `courseId`.
* `lessonId`.
* `packageId`.
* Các column có thể chứa nhiều ID.
* Cách phân cách nhiều ID trong cùng một cell.
* Column bắt buộc.
* Column không bắt buộc.

**Không được tiếp tục giả định format import cũ nếu format cũ khác với Sheet mẫu.**

---

# 2. Format dữ liệu ID

Một row trong Sheet có thể chứa **nhiều `courseId`, nhiều `lessonId` và nhiều `packageId`**.

Ví dụ:

```text
Course ID:
3108,3117,3315,3127,3314

Lesson ID:
168357,168572,168313,167460,167060

Package ID:
9025,9028,9036,9104,9106,9017,9102
```

Sau khi parse phải trở thành:

```ts
{
  courseIds: [
    "3108",
    "3117",
    "3315",
    "3127",
    "3314"
  ],

  lessonIds: [
    "168357",
    "168572",
    "168313",
    "167460",
    "167060"
  ],

  packageIds: [
    "9025",
    "9028",
    "9036",
    "9104",
    "9106",
    "9017",
    "9102"
  ]
}
```

Các ID trong cell được phân cách bằng:

```text
,
```

BE phải:

* `trim()` whitespace.
* Loại bỏ phần tử rỗng.
* Normalize ID thành string hoặc number thống nhất theo convention hiện tại.
* Validate ID trước khi gửi sang HMO.

---

# 3. Không được giả định 1 row = 1 bộ ID

Không được giả định:

```text
1 row
↓
1 courseId
+
1 lessonId
+
1 packageId
```

Mà phải hỗ trợ:

```text
1 row
 ├── courseIds[]
 ├── lessonIds[]
 └── packageIds[]
```

Đặc biệt, **không được ghép ID theo index**.

Không được làm:

```text
courseIds[0]
    ↕
lessonIds[0]
    ↕
packageIds[0]
```

Ví dụ:

```text
3108 → 168357 → 9025
3117 → 168572 → 9028
```

**Không được tự suy luận quan hệ như trên.**

Lý do các danh sách có thể có số lượng phần tử khác nhau.

Ví dụ:

```text
5 courseIds
5 lessonIds
7 packageIds
```

Quan hệ chính xác phải được xác định thông qua HMO.

---

# 4. HMO Batch API

Giả định **phía HMO đã hỗ trợ Batch API**.

BE LMS phải sử dụng Batch API thay vì gọi API từng `packageId + courseId`.

API giả định:

```http
POST /api/course/outline/batch
```

Request:

```json
{
  "items": [
    {
      "packageId": "9025",
      "courseId": "3108"
    },
    {
      "packageId": "9028",
      "courseId": "3117"
    },
    {
      "packageId": "9036",
      "courseId": "3315"
    }
  ]
}
```

## Quan trọng

Request sang HMO ở bước này **chỉ cần**:

```text
packageId
courseId
```

Không gửi:

```text
lessonId
```

`lessonId` trong Sheet chỉ được sử dụng để **đối chiếu sau khi HMO trả dữ liệu**.

---

# 5. HMO Response

HMO Batch API nên trả dữ liệu tương ứng với từng `packageId + courseId`.

Ví dụ:

```json
{
  "status": "success",
  "data": [
    {
      "packageId": "9025",
      "courseId": "3108",
      "exists": true,
      "lessons": [
        {
          "lessonId": "168357",
          "name": "Bài 1"
        },
        {
          "lessonId": "168358",
          "name": "Bài 2"
        }
      ]
    },
    {
      "packageId": "9028",
      "courseId": "3117",
      "exists": true,
      "lessons": [
        {
          "lessonId": "168572",
          "name": "Bài 1"
        }
      ]
    }
  ]
}
```

Nếu package/course không tồn tại:

```json
{
  "packageId": "9999",
  "courseId": "3108",
  "exists": false,
  "lessons": []
}
```

HMO nên trả rõ trạng thái để BE có thể xác định chính xác lỗi.

---

# 6. Flow tổng thể

Flow Import bắt buộc:

```text
                    IMPORT SHEET
                         │
                         ▼
                 Parse toàn bộ file
                         │
                         ▼
                  Normalize dữ liệu
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      packageIds[]   courseIds[]    lessonIds[]
          │              │              │
          └───────┬──────┘              │
                  ▼                     │
             Deduplicate                │
                  │                     │
                  ▼                     │
          Package + Course pairs        │
                  │                     │
                  ▼                     │
            HMO Batch API               │
                  │                     │
                  ▼                     │
       HMO trả Package/Course/Lessons   │
                  │                     │
                  └──────────┬──────────┘
                             ▼
                      Build Mapping
                             │
                             ▼
                 Validate Package ID
                             │
                             ▼
                  Validate Course ID
                             │
                             ▼
                  Validate Lesson ID
                             │
                             ▼
               Validate quan hệ:
          Package + Course + Lesson
                             │
                             ▼
                 Check duplicate
                  trong chính file
                             │
                             ▼
                 Check duplicate DB
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
                  ERROR             VALID
                    │                 │
                    ▼                 ▼
              Return errors      Transaction
                                      │
                                      ▼
                              Import Calendar
                                      │
                                      ▼
                                    COMMIT
```

---

# 7. Bước 1: Parse toàn bộ Sheet

BE phải đọc **toàn bộ file trước**.

Không gọi HMO trong lúc đang đọc từng row.

Ví dụ:

```text
Row 1:
courseIds  = [3108,3117,3315]
lessonIds  = [168357,168572,168313]
packageIds = [9025,9028,9036]

Row 2:
courseIds  = [3108,3117]
lessonIds  = [168500,168600]
packageIds = [9025,9028]
```

Sau khi parse toàn bộ mới thực hiện bước tiếp theo.

---

# 8. Bước 2: Extract toàn bộ Package ID

Ví dụ:

```text
Row 1:
9025,9028,9036

Row 2:
9025,9028
```

Kết quả:

```ts
const packageIds = [
  "9025",
  "9028",
  "9036"
];
```

Phải deduplicate.

---

# 9. Bước 3: Extract toàn bộ Course ID

Ví dụ:

```text
Row 1:
3108,3117,3315

Row 2:
3108,3117
```

Kết quả:

```ts
const courseIds = [
  "3108",
  "3117",
  "3315"
];
```

Phải deduplicate.

---

# 10. Bước 4: Extract toàn bộ Lesson ID

Tương tự:

```ts
const lessonIds = [
  "168357",
  "168572",
  "168313"
];
```

Lesson ID được giữ lại để:

* Validate.
* Mapping.
* Xác định lesson có tồn tại không.
* Xác định lesson có thuộc package/course hay không.

---

# 11. Bước 5: Tạo danh sách Package + Course

Sau khi parse và deduplicate, BE phải xác định các cặp:

```text
packageId + courseId
```

để gửi HMO.

Ví dụ:

```json
[
  {
    "packageId": "9025",
    "courseId": "3108"
  },
  {
    "packageId": "9028",
    "courseId": "3117"
  },
  {
    "packageId": "9036",
    "courseId": "3315"
  }
]
```

Nếu một cặp xuất hiện nhiều lần trong file:

```text
9025 + 3108
9025 + 3108
9025 + 3108
```

chỉ được gửi một lần.

---

# 12. Không tạo request theo từng Row

Không được:

```text
Row 1 → HMO
Row 2 → HMO
Row 3 → HMO
...
Row 1000 → HMO
```

Phải:

```text
1000 rows
    ↓
Parse toàn bộ
    ↓
Extract IDs
    ↓
Deduplicate
    ↓
Unique package + course pairs
    ↓
HMO Batch API
```

Ví dụ:

```text
1000 rows
↓
35 unique packageId
20 unique courseId
50 unique package+course pairs
↓
HMO Batch API
```

HMO chỉ cần xử lý 50 item thay vì 1000 request.

---

# 13. Validation Package ID

Sau khi HMO trả kết quả, phải kiểm tra package.

Nếu:

```text
packageId = 9025
```

và HMO:

```text
exists = true
```

→ hợp lệ.

Nếu:

```text
packageId = 9999
```

và HMO:

```text
exists = false
```

→ phải báo lỗi.

Ví dụ:

```json
{
  "row": 15,
  "packageId": "9999",
  "errorCode": "PACKAGE_NOT_FOUND",
  "message": "Package ID 9999 không tồn tại trên HMO"
}
```

**Không được silently ignore.**

---

# 14. Validation Course ID

Nếu course không tồn tại:

```json
{
  "row": 15,
  "courseId": "999999",
  "errorCode": "COURSE_NOT_FOUND",
  "message": "Course ID 999999 không tồn tại trên HMO"
}
```

Không được tiếp tục import row đó.

---

# 15. Validation Lesson ID

Sau khi HMO trả danh sách lesson:

```json
{
  "packageId": "9025",
  "courseId": "3108",
  "lessons": [
    {
      "lessonId": "168357"
    },
    {
      "lessonId": "168358"
    }
  ]
}
```

Nếu Sheet có:

```text
lessonId = 168357
```

→ hợp lệ.

Nếu Sheet có:

```text
lessonId = 999999
```

nhưng HMO không trả lesson này:

→ báo:

```json
{
  "row": 15,
  "packageId": "9025",
  "courseId": "3108",
  "lessonId": "999999",
  "errorCode": "LESSON_NOT_FOUND",
  "message": "Lesson ID 999999 không tồn tại trong package 9025 / course 3108"
}
```

---

# 16. Validation quan hệ Package + Course + Lesson

Phải kiểm tra cả quan hệ chứ không chỉ kiểm tra ID tồn tại.

Ví dụ Sheet:

```text
packageId = 9025
courseId = 3108
lessonId = 168572
```

HMO:

```text
9025 + 3108
→ 168357
→ 168358
→ 168359
```

`168572` không thuộc package/course này.

Phải báo:

```json
{
  "row": 15,
  "packageId": "9025",
  "courseId": "3108",
  "lessonId": "168572",
  "errorCode": "LESSON_NOT_IN_PACKAGE_COURSE",
  "message": "Lesson 168572 không thuộc package 9025 / course 3108"
}
```

---

# 17. Build Mapping

Không dùng `lessonId` làm key duy nhất.

Phải sử dụng context:

```text
packageId + courseId + lessonId
```

Ví dụ:

```text
9025:3108:168357
9025:3108:168358
9028:3117:168572
```

Có thể implement lookup:

```ts
const key = `${packageId}:${courseId}:${lessonId}`;
```

Sau đó:

```text
Sheet lessonId
      ↓
packageId + courseId + lessonId
      ↓
Lookup HMO
      ↓
Valid / Invalid
```

---

# 18. Một Lesson ID có thể xuất hiện ở nhiều context

Không được giả định:

```text
lessonId = 168357
```

luôn chỉ thuộc một package/course.

Do đó không được tạo:

```ts
Map<lessonId, packageId>
```

mà phải có context:

```ts
Map<`${packageId}:${courseId}:${lessonId}`, data>
```

---

# 19. Validation trùng lịch

Sau khi resolve:

```text
packageId
courseId
lessonId
```

phải kiểm tra lịch có bị trùng hay không.

Không được chỉ check:

```text
lessonId
```

Mà phải dựa trên business key của Calendar.

Ví dụ có thể bao gồm:

```text
packageId
+
courseId
+
lessonId
+
date
+
startTime
+
endTime
```

**Codex phải đọc schema và service Calendar hiện tại để xác định chính xác unique key.**

Không tự ý thay đổi business rule hiện tại.

---

# 20. Duplicate trong Database

Ví dụ Sheet:

```text
packageId = 9025
courseId = 3108
lessonId = 168357
date = 2026-08-01
startTime = 19:00
endTime = 20:30
```

DB đã có lịch tương ứng.

→ Không tạo thêm.

Trả:

```json
{
  "row": 15,
  "packageId": "9025",
  "courseId": "3108",
  "lessonId": "168357",
  "errorCode": "DUPLICATE_SCHEDULE_IN_DATABASE",
  "message": "Lịch đã tồn tại trong hệ thống"
}
```

---

# 21. Duplicate trong chính file Import

Phải kiểm tra duplicate trước khi insert DB.

Ví dụ:

```text
Row 10:
9025 + 3108 + 168357 + 2026-08-01 + 19:00

Row 25:
9025 + 3108 + 168357 + 2026-08-01 + 19:00
```

→ Row 25 phải báo lỗi:

```json
{
  "row": 25,
  "errorCode": "DUPLICATE_SCHEDULE_IN_FILE",
  "duplicateWithRow": 10,
  "packageId": "9025",
  "courseId": "3108",
  "lessonId": "168357"
}
```

---

# 22. Validation ID Format

Trước khi gửi HMO:

```text
packageId
courseId
lessonId
```

phải được validate format.

Ví dụ:

```text
packageId = abc
```

→ lỗi:

```json
{
  "row": 10,
  "packageId": "abc",
  "errorCode": "INVALID_PACKAGE_ID"
}
```

Không gửi dữ liệu invalid lên HMO.

Tương tự:

```text
INVALID_COURSE_ID
INVALID_LESSON_ID
```

---

# 23. Không import nếu validation còn lỗi

Khuyến nghị sử dụng **Strict Import Mode**.

Ví dụ:

```text
100 rows
98 valid
2 invalid
```

→ **Không import 98 rows.**

Phải trả danh sách lỗi để user sửa file.

Lý do: Calendar là dữ liệu nghiệp vụ quan trọng, không nên để file được import một phần ngoài ý muốn.

Flow:

```text
Parse
 ↓
HMO Batch
 ↓
Validate toàn bộ
 ↓
Có lỗi?
 ├── YES → Không insert
 └── NO  → Transaction → Insert
```

---

# 24. Transaction

Sau khi validation toàn bộ thành công:

```text
BEGIN TRANSACTION
      ↓
Insert Calendar
      ↓
Trigger / Sync Queue / logic hiện tại
      ↓
COMMIT
```

Nếu có lỗi:

```text
ROLLBACK
```

Không được để dữ liệu import ở trạng thái nửa thành công nửa thất bại trong strict mode.

---

# 25. Response khi Import thành công

Ví dụ:

```json
{
  "status": "success",
  "summary": {
    "totalRows": 100,
    "successRows": 100,
    "failedRows": 0,
    "uniquePackageIds": 20,
    "uniqueCourseIds": 15,
    "uniqueLessonIds": 100,
    "uniquePackageCoursePairs": 35,
    "hmoBatchItems": 35
  }
}
```

---

# 26. Response khi Import lỗi

Ví dụ:

```json
{
  "status": "validation_error",
  "summary": {
    "totalRows": 100,
    "validRows": 98,
    "invalidRows": 2,
    "uniquePackageIds": 20,
    "uniqueCourseIds": 15,
    "uniqueLessonIds": 100,
    "uniquePackageCoursePairs": 35
  },
  "errors": [
    {
      "row": 15,
      "packageId": "9999",
      "errorCode": "PACKAGE_NOT_FOUND",
      "message": "Package ID 9999 không tồn tại trên HMO"
    },
    {
      "row": 25,
      "packageId": "9025",
      "courseId": "3108",
      "lessonId": "168572",
      "errorCode": "LESSON_NOT_IN_PACKAGE_COURSE",
      "message": "Lesson 168572 không thuộc package 9025 / course 3108"
    }
  ]
}
```

FE phải có thể xác định:

* Row nào lỗi.
* Package nào lỗi.
* Course nào lỗi.
* Lesson nào lỗi.
* Error code.
* Nội dung lỗi.

---

# 27. Error Codes

Chuẩn hóa các lỗi:

```text
INVALID_PACKAGE_ID
INVALID_COURSE_ID
INVALID_LESSON_ID

PACKAGE_NOT_FOUND
COURSE_NOT_FOUND
LESSON_NOT_FOUND
LESSON_NOT_IN_PACKAGE_COURSE

DUPLICATE_SCHEDULE_IN_FILE
DUPLICATE_SCHEDULE_IN_DATABASE

HMO_BATCH_ERROR
HMO_TIMEOUT
HMO_INVALID_RESPONSE
```

---

# 28. HMO Batch Error

Nếu HMO trả một item lỗi:

```json
{
  "packageId": "9025",
  "courseId": "3108",
  "exists": false
}
```

BE phải map lỗi về đúng các row trong Sheet có sử dụng cặp này.

Không được làm mất thông tin row.

Ví dụ:

```text
Row 10 → package 9025 + course 3108
Row 25 → package 9025 + course 3108
Row 50 → package 9025 + course 3108
```

Nếu HMO báo cặp này không tồn tại thì phải báo lỗi tương ứng cho cả 3 row.

---

# 29. Performance

Với file lớn, phải tối ưu:

### Không làm

```text
1000 rows
→ 1000 HMO requests
```

### Phải làm

```text
1000 rows
→ Extract IDs
→ Deduplicate
→ Unique package/course pairs
→ 1 HMO Batch request
```

Nếu HMO Batch API có giới hạn số lượng item/request thì BE phải chunk.

Ví dụ:

```env
HMO_BATCH_SIZE=100
```

1000 unique pairs:

```text
Batch 1 → 100
Batch 2 → 100
...
Batch 10 → 100
```

Không hard-code batch size.

---

# 30. Cache

Có thể cache kết quả HMO theo:

```text
packageId + courseId
```

Ví dụ Redis:

```text
hmo:course-outline:9025:3108
```

Nếu đã có cache còn hợp lệ:

```text
Sheet
 ↓
Unique package/course
 ↓
Cache
 ↓
Có → dùng cache
Không → HMO Batch API
```

TTL configurable:

```env
HMO_CACHE_TTL=3600
```

Chỉ triển khai cache nếu phù hợp với architecture hiện tại.

---

# 31. Các lỗi phải báo rõ cho người dùng

Đặc biệt bắt buộc phải báo các trường hợp:

### Package không tồn tại

```text
Package ID 9999 không tồn tại.
```

### Course không tồn tại

```text
Course ID 999999 không tồn tại.
```

### Lesson không tồn tại

```text
Lesson ID 999999 không tồn tại.
```

### Lesson không thuộc package/course

```text
Lesson 168572 không thuộc Package 9025 / Course 3108.
```

### Trùng lịch

```text
Lịch của Lesson 168357 đã tồn tại trong hệ thống.
```

### Trùng ngay trong file

```text
Dòng 25 bị trùng lịch với dòng 10.
```

Không được silently skip những trường hợp trên.

---

# 32. Đọc code hiện tại trước khi triển khai

Trước khi code, Codex phải đọc:

* Import route/controller hiện tại.
* Import service.
* Excel/CSV parser.
* DTO/schema validation.
* Calendar schema.
* Calendar service.
* Logic tạo Calendar.
* Logic kiểm tra duplicate hiện tại.
* HMO integration hiện tại.
* Existing package/course/lesson service.
* Trigger Calendar.
* Sync queue.
* Redis/cache nếu có.
* Existing tests.

Sau đó mới quyết định refactor.

**Không viết lại toàn bộ import service nếu có thể mở rộng logic hiện tại.**

---

# 33. Không thay đổi nghiệp vụ ngoài phạm vi

Task này chỉ thay đổi:

```text
Sheet Import
+
HMO Batch Mapping
+
Validation
+
Duplicate Check
```

Không tự ý thay đổi:

* Calendar schema.
* Calendar trigger.
* Sync queue.
* Permission.
* API không liên quan.
* Logic tạo Calendar hiện tại.
* Các nghiệp vụ khác.

Nếu cần thay đổi schema hoặc business logic để phục vụ requirement, phải ghi rõ trước khi triển khai.

---

# 34. Test Cases

## Case 1 — Import đúng format Sheet

Một row có:

```text
courseId:
3108,3117,3315

lessonId:
168357,168572,168313

packageId:
9025,9028,9036
```

→ Parse thành arrays chính xác.

---

## Case 2 — Package không tồn tại

```text
packageId = 9999
```

HMO:

```text
exists = false
```

→ `PACKAGE_NOT_FOUND`.

---

## Case 3 — Course không tồn tại

→ `COURSE_NOT_FOUND`.

---

## Case 4 — Lesson không tồn tại

→ `LESSON_NOT_FOUND`.

---

## Case 5 — Lesson không thuộc Package/Course

→ `LESSON_NOT_IN_PACKAGE_COURSE`.

---

## Case 6 — Duplicate trong file

Hai row cùng tạo một schedule.

→ `DUPLICATE_SCHEDULE_IN_FILE`.

---

## Case 7 — Duplicate trong DB

Sheet tạo lịch đã tồn tại.

→ `DUPLICATE_SCHEDULE_IN_DATABASE`.

---

## Case 8 — Package/Course lặp lại

```text
9025 + 3108
9025 + 3108
9025 + 3108
```

→ HMO Batch chỉ xử lý một item.

---

## Case 9 — HMO Batch trả partial error

Một số package/course hợp lệ, một số không tồn tại.

→ Map lỗi đúng về các row tương ứng.

---

## Case 10 — File lớn

Test file có nhiều rows và nhiều package/course/lesson.

Đảm bảo:

```text
HMO request << số lượng rows
```

và không xảy ra request explosion.

---

# 35. Acceptance Criteria

* [ ] Sheet mẫu được sử dụng làm **source of truth** cho format Import.
* [ ] Sheet mẫu: https://docs.google.com/spreadsheets/d/1RDnAISxLG-35_OLx9b5s8GVP1ean5co4ChBLO4LTwB4/edit?usp=sharing
* [ ] Một row hỗ trợ nhiều `courseId`.
* [ ] Một row hỗ trợ nhiều `lessonId`.
* [ ] Một row hỗ trợ nhiều `packageId`.
* [ ] Parse ID dạng comma-separated.
* [ ] Trim whitespace.
* [ ] Remove empty values.
* [ ] Validate ID format.
* [ ] Parse toàn bộ file trước khi gọi HMO.
* [ ] Deduplicate `packageId`.
* [ ] Deduplicate `courseId`.
* [ ] Deduplicate `lessonId`.
* [ ] Deduplicate `packageId + courseId`.
* [ ] Sử dụng HMO Batch API.
* [ ] Request HMO chỉ cần `packageId + courseId`.
* [ ] Không gửi `lessonId` để resolve HMO.
* [ ] Không map ID theo index.
* [ ] Không dùng `lessonId` làm key duy nhất.
* [ ] Validate Package tồn tại.
* [ ] Validate Course tồn tại.
* [ ] Validate Lesson tồn tại.
* [ ] Validate Lesson thuộc đúng Package + Course.
* [ ] Validate duplicate trong chính file.
* [ ] Validate duplicate với Calendar trong DB.
* [ ] Nếu có lỗi validation thì không import ở strict mode.
* [ ] Import Calendar bằng transaction.
* [ ] Rollback khi insert thất bại.
* [ ] Error response có row number.
* [ ] Error response có package/course/lesson liên quan.
* [ ] Chuẩn hóa error code.
* [ ] Có test cho tất cả validation chính.
* [ ] Có test file lớn.
* [ ] Có test HMO Batch partial error.
* [ ] Không phá vỡ nghiệp vụ Calendar hiện tại.

---

# 36. Flow cuối cùng cần triển khai

```text
                 GOOGLE SHEET
                      │
                      ▼
              Parse toàn bộ file
                      │
                      ▼
               Normalize dữ liệu
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   packageIds     courseIds     lessonIds
        │             │             │
        └──────┬──────┘             │
               ▼                    │
        Deduplicate IDs             │
               │                    │
               ▼                    │
      Unique Package + Course       │
               │                    │
               ▼                    │
        ┌───────────────┐           │
        │ HMO BATCH API │           │
        └───────┬───────┘           │
                ▼                   │
       Package/Course/Lessons       │
                │                   │
                └────────┬──────────┘
                         ▼
                  Build Mapping
                         │
                         ▼
              Validate Package ID
                         │
                         ▼
               Validate Course ID
                         │
                         ▼
               Validate Lesson ID
                         │
                         ▼
             Validate relationship
          Package + Course + Lesson
                         │
                         ▼
             Check duplicate file
                         │
                         ▼
              Check duplicate DB
                         │
                  ┌──────┴──────┐
                  ▼             ▼
                ERROR         VALID
                  │             │
                  ▼             ▼
             Return errors   BEGIN TX
                                │
                                ▼
                         Insert Calendar
                                │
                                ▼
                              COMMIT
```

## Nguyên tắc cốt lõi

```text
Không làm:

lessonId
   ↓
Tìm package/course
   ↓
Import
```

Mà phải làm:

packageId + courseId
↓
HMO Batch API
↓
HMO trả lessonIds
↓
Đối chiếu lessonId trong Sheet
↓
Validate
↓
Check duplicate
↓
Import Calendar

```

**Sheet mẫu ở mục 1 là format tham chiếu chính thức cho chức năng Import.**
```
