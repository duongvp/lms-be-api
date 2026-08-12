## Yêu cầu: Phân quyền theo Chương trình học (Program-level Permission)

Tôi đang phát triển hệ thống quản lý LMS và hiện tại hệ thống phân quyền đang có **2 lớp quyền**:

1. **Phân quyền theo chức năng (Function/Action Permission)**

   * Ví dụ:

     * Xem lịch học
     * Thêm lịch học
     * Sửa lịch học
     * Xóa lịch học
     * Quản lý đề cương
     * Quản lý câu hỏi
     * ...

2. **Phân quyền theo Field (Field-level Permission)**

   * Xác định user/role nào được phép xem hoặc chỉnh sửa từng field.
   * Ví dụ một role được xem `teacher` nhưng không được sửa `teacher`.

### Yêu cầu bổ sung

Cần bổ sung thêm **phân quyền theo Chương trình học (Program-level Permission)**.

Trong LMS, một user có thể có quyền thực hiện một nghiệp vụ nhưng **chỉ được thao tác trên một số chương trình học nhất định**.

Ví dụ:

* User A:

  * Có quyền quản lý lịch học.
  * Nhưng chỉ được thao tác trong:

    * `nguvan-6-2027`
    * `toan-7-2027`

* User B:

  * Có quyền quản lý lịch học.
  * Nhưng chỉ được thao tác trong:

    * `ly-8-2027`

Do đó quyền cuối cùng cần được hiểu theo hướng:

> User/Role có **quyền chức năng + quyền field + phạm vi chương trình học**.

Ví dụ:

```text
User A
 ├── Function Permission
 │    ├── calendar.view
 │    ├── calendar.create
 │    └── calendar.update
 │
 ├── Field Permission
 │    ├── calendar.teacher.view
 │    └── calendar.teacher.edit
 │
 └── Program Scope
      ├── nguvan-6-2027
      └── toan-7-2027
```

### Một số yêu cầu nghiệp vụ cần xem xét

Phạm vi chương trình học phải áp dụng được cho từng nghiệp vụ.

Ví dụ:

```text
calendar.view
calendar.create
calendar.update
calendar.delete
```

có thể bị giới hạn bởi các chương trình học mà user được phép truy cập.

Ví dụ:

```text
User A
calendar.view    -> nguvan-6-2027, toan-7-2027
calendar.create  -> nguvan-6-2027
calendar.update  -> nguvan-6-2027
calendar.delete  -> không có
```

Tức là không nên chỉ hiểu đơn giản:

```text
User A -> được phép truy cập Program X
```

mà cần xem xét khả năng:

```text
User A
  -> Permission
       -> Program Scope
```

để có thể kiểm soát chính xác hơn.

---

# Yêu cầu quan trọng

**Hiện tại CHƯA được code hoặc thay đổi database.**

Hãy chỉ **phân tích hệ thống hiện tại và lập PLAN triển khai**.

Trước tiên hãy kiểm tra repository để hiểu:

1. Kiến trúc backend hiện tại.
2. Kiến trúc frontend hiện tại nếu cần.
3. Database/schema hiện tại.
4. Cấu trúc RBAC hiện tại.
5. Các bảng liên quan:

   * users
   * roles
   * permissions
   * user_roles
   * role_permissions
   * field permissions/policies
   * các bảng liên quan đến program/course/package/lesson.
6. Middleware/guard/authentication/authorization hiện tại.
7. Cách API hiện tại kiểm tra permission.
8. Cách frontend hiện tại kiểm tra permission.
9. Các nghiệp vụ LMS hiện tại đang sử dụng program/course/package như thế nào.

## Cần đặc biệt kiểm tra

Hãy xác định **program** trong hệ thống hiện tại thực chất đang được đại diện bởi entity/table nào.

Ví dụ có thể là:

```text
program
course
package
learning_program
course_code
package_code
...
```

Không được tự giả định tên bảng hoặc entity.

Hãy trace từ API -> service -> repository/query -> database để xác định:

> Khi một request thao tác dữ liệu LMS, hệ thống hiện tại lấy `program_code` hoặc thông tin chương trình học từ đâu?

Ví dụ với:

```text
POST /calendar
PUT /calendar/:id
GET /calendar
DELETE /calendar/:id
```

hãy xác định chương trình học được xác định như thế nào.

---

# Mục tiêu của PLAN

Hãy đưa ra một plan kỹ thuật hoàn chỉnh để bổ sung:

```text
Function Permission
        +
Field Permission
        +
Program Scope Permission
```

## 1. Đề xuất mô hình permission

Phân tích xem nên thiết kế theo hướng nào:

### Option A

```text
User -> Program
```

### Option B

```text
Role -> Program
```

### Option C

```text
User/Role -> Permission -> Program
```

### Option D

```text
User/Role
   -> Permission
       -> Scope
            -> Program
```

Hãy so sánh ưu/nhược điểm của từng phương án và chọn phương án phù hợp nhất với LMS hiện tại.

Ưu tiên:

* dễ mở rộng
* không phá vỡ RBAC hiện tại
* không duplicate permission
* hỗ trợ nhiều program
* hỗ trợ permission khác nhau trên từng program
* dễ query
* dễ enforce ở backend
* frontend có thể sử dụng để ẩn/disable chức năng
* sau này có thể mở rộng thêm scope khác ngoài program nếu cần.

---

# 2. Database plan

Đề xuất các thay đổi database cần thiết.

Nếu cần thêm bảng, hãy mô tả:

```text
table name
columns
primary key
foreign key
unique key
index
relationship
```

Ví dụ cần cân nhắc các mô hình:

```text
role_programs
user_programs
permission_programs
role_permission_programs
```

Nhưng **không được mặc định chọn các bảng trên**.

Hãy phân tích dựa trên schema hiện tại và đưa ra thiết kế tối ưu.

Đặc biệt cần đảm bảo:

* Không mất dữ liệu hiện tại.
* Không phá vỡ RBAC hiện tại.
* User/Role hiện tại vẫn hoạt động bình thường sau migration.
* Có chiến lược backward compatibility.

---

# 3. Permission evaluation

Hãy thiết kế logic kiểm tra quyền cuối cùng.

Ví dụ request:

```http
PUT /calendar/123
```

hệ thống cần kiểm tra theo thứ tự:

```text
Authentication
      ↓
User
      ↓
Role
      ↓
Function Permission
      ↓
Program Scope
      ↓
Field Permission
      ↓
Allow / Deny
```

Nhưng thứ tự trên chỉ là ví dụ.

Hãy phân tích và đề xuất thứ tự chính xác.

Cần giải thích rõ:

```text
User có function permission
        nhưng không có program scope
        => ?
```

```text
User có program scope
        nhưng không có function permission
        => ?
```

```text
User có function permission + program scope
        nhưng field permission deny
        => ?
```

---

# 4. Multi-program

Một user có thể có nhiều chương trình:

```text
User A
 ├── nguvan-6-2027
 ├── toan-7-2027
 └── ly-8-2027
```

Cần đảm bảo query/API không cho phép user lấy dữ liệu ngoài scope.

Ví dụ:

```http
GET /calendar
```

không được trả về toàn bộ calendar rồi mới filter ở frontend.

Phải đảm bảo:

```text
Database query
    ↓
WHERE program_code IN (...)
```

hoặc cơ chế tương đương ở backend.

Đặc biệt phân tích các trường hợp:

```http
GET list
GET detail
POST
PUT
DELETE
BULK UPDATE
BULK DELETE
IMPORT
EXPORT
```

để tránh bypass permission.

---

# 5. Program scope trong các nghiệp vụ LMS

Hãy rà soát các nghiệp vụ hiện tại và xác định những nghiệp vụ nào cần program scope.

Ví dụ:

```text
Dashboard
Quản lý chương trình
Quản lý đề cương
Quản lý câu hỏi
Quản lý lịch học
Quản lý livestream
Import lịch học
Export dữ liệu
...
```

Không tự giới hạn vào các ví dụ trên.

Hãy scan repository để tìm toàn bộ các module/nghiệp vụ có liên quan đến chương trình học và đưa ra danh sách.

---

# 6. Backend implementation plan

Hãy xác định cần thay đổi:

```text
middleware
guard
permission service
authorization service
controller
service
repository
query builder
Prisma/Knex/etc.
```

nếu có.

Đề xuất một abstraction dùng chung, ví dụ:

```text
checkPermission()
checkProgramAccess()
authorize()
```

hoặc kiến trúc tương đương phù hợp với codebase hiện tại.

Không tạo logic kiểm tra program permission riêng lẻ trong từng controller nếu có thể xây dựng một cơ chế dùng chung.

---

# 7. Frontend implementation plan

Phân tích frontend hiện tại đang kiểm tra permission như thế nào.

Đề xuất cách bổ sung program scope.

Ví dụ:

```text
Can(user, "calendar.update", programCode)
```

hoặc cơ chế phù hợp hơn với architecture hiện tại.

Cần xử lý:

* menu
* button
* action
* page
* modal
* table
* bulk action
* filter program
* select program
* API response
* trường hợp user cố truy cập URL trực tiếp.

Lưu ý:

> Frontend chỉ dùng để cải thiện UX. Backend mới là nơi enforce permission thực sự.

---

# 8. Super Admin / System Admin

Hãy phân tích cần xử lý role đặc biệt như:

```text
Super Admin
System Admin
```

như thế nào.

Ví dụ:

```text
Super Admin
=> toàn bộ program
```

hoặc:

```text
System Admin
=> bypass program scope
```

Nhưng không được tự quyết định; hãy xem code hiện tại đang xử lý các role đặc biệt như thế nào rồi đề xuất.

---

# 9. Migration strategy

Đề xuất migration an toàn.

Yêu cầu bắt buộc:

> **Tuyệt đối không DELETE, TRUNCATE hoặc làm mất dữ liệu hiện tại.**

Migration phải đảm bảo hệ thống hiện tại vẫn hoạt động.

Đặc biệt cần xác định:

```text
Existing Role
Existing Permission
Existing User
```

sẽ được xử lý thế nào sau khi bổ sung Program Scope.

Cần đề xuất:

* default behavior
* backward compatibility
* migration data
* rollback strategy.

---

# 10. Security / bypass analysis

Hãy phân tích các cách user có thể bypass program permission.

Ví dụ:

```text
GET /calendar
GET /calendar/:id
POST /calendar
PUT /calendar/:id
DELETE /calendar/:id

POST /calendar/bulk
POST /calendar/import
GET /calendar/export
```

Đặc biệt chú ý:

```text
IDOR
```

Ví dụ:

User A chỉ có:

```text
nguvan-6-2027
```

nhưng biết ID của calendar thuộc:

```text
toan-7-2027
```

và gọi:

```http
PUT /calendar/999
```

=> phải bị deny.

---

# 11. Test plan

Chưa cần viết test code.

Hãy lập test matrix cho các trường hợp:

| Function | Program | Field | Expected |
| -------- | ------- | ----- | -------- |
| Allow    | Allow   | Allow | Allow    |
| Allow    | Deny    | Allow | Deny     |
| Deny     | Allow   | Allow | Deny     |
| Allow    | Allow   | Deny  | Deny     |

Bổ sung các case:

* user có nhiều program
* user không có program
* role có nhiều program
* super admin
* bulk operation
* import
* export
* direct API call
* IDOR
* program không tồn tại
* program đã inactive
* request chứa program không thuộc scope.

---

# 12. Output bắt buộc

**KHÔNG CODE.**

Chỉ trả về PLAN.

Format:

```text
# 1. Current Architecture Analysis

# 2. Current Permission Architecture

# 3. Program/Program Code Analysis

# 4. Proposed Permission Architecture

# 5. Database Changes

# 6. Permission Evaluation Flow

# 7. Backend Changes

# 8. Frontend Changes

# 9. Migration Strategy

# 10. Security / Bypass Analysis

# 11. Test Plan

# 12. File-by-File Implementation Plan

# 13. Risks & Trade-offs

# 14. Recommended Implementation Order
```

Ở phần:

```text
# 12. File-by-File Implementation Plan
```

hãy chỉ rõ:

```text
file hiện tại
        ↓
thay đổi gì
        ↓
lý do
```

Không được tự tạo file hoặc sửa code ở bước này.

Cuối cùng hãy đưa ra:

```text
Recommended Architecture
Recommended Database Model
Recommended Permission Evaluation Flow
Implementation Steps
```

và **DỪNG LẠI**.

Chỉ sau khi tôi review và xác nhận plan thì mới được bắt đầu implementation.
