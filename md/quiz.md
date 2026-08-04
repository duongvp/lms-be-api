# Bối cảnh

Tôi có 2 dự án.

## Dự án cũ

Đường dẫn:

/home/ubuntu/Documents/HOCMAI/HMO.streamapp/streamapp-v2/apps/api

Đây là hệ thống LMS cũ viết bằng ExpressJS.

Module Quiz đã hoạt động nhưng business logic còn nhiều hạn chế và chưa hoàn chỉnh.

## Dự án mới

Đây cũng là backend ExpressJS.

Hai dự án sử dụng cùng một database, vì vậy:

- Không cần quan tâm migration.
- Không cần thay đổi schema.
- Không cần tạo lại database.

---

# Mục tiêu

Đọc toàn bộ module Quiz của dự án cũ để hiểu:

- business logic
- flow xử lý
- kiến trúc
- dependency
- ưu điểm
- hạn chế

Sau đó giúp tôi thiết kế phiên bản tốt hơn trên dự án mới.

Lưu ý:

KHÔNG copy nguyên code.

KHÔNG implement.

Chỉ phân tích.

---

# Việc cần làm

## 1. Tự tìm toàn bộ code liên quan đến Quiz

Bao gồm nhưng không giới hạn:

- routes
- controllers
- services
- models
- repositories (nếu có)
- middleware
- validators
- request validation
- helper
- utils
- constants
- enums
- cron jobs
- queue jobs
- upload
- socket
- permissions
- auth
- cache
- các API liên quan
- các module được Quiz gọi tới
- các module gọi ngược lại Quiz

Nếu Quiz phụ thuộc module khác thì tiếp tục đọc để hiểu đầy đủ business flow.

---

## 2. Phân tích module

Tạo file:

quiz-review.md

Bao gồm:

### Tổng quan module

Module Quiz hiện hỗ trợ những gì.

### Business flow

Phân tích từng flow:

- tạo Quiz
- cập nhật Quiz
- publish Quiz
- lấy danh sách
- xem chi tiết
- làm bài
- lưu tạm
- submit
- chấm điểm
- xem kết quả
- thống kê (nếu có)

### Business Rules

Liệt kê toàn bộ rule đang tồn tại.

### API

Liệt kê toàn bộ endpoint liên quan.

### Dependency

Quiz đang phụ thuộc vào những module nào.

### Luồng dữ liệu

Request

↓

Controller

↓

Service

↓

Model / Repository

↓

Database

Phân tích rõ từng bước.

### Điểm mạnh

Những logic nên giữ lại.

### Điểm yếu

- logic chưa tối ưu
- duplicate
- hard-code
- coupling
- performance
- maintainability
- security

### Những bug tiềm ẩn

Nếu phát hiện, chỉ ghi chú.

Không sửa.

### Những tính năng còn thiếu

Ví dụ:

- autosave
- random question
- random answer
- question bank
- attempt history
- grading strategy
- timer
- anti cheating
- review mode
- passing score
- partial score
- analytics
- import/export
- ...

### Đề xuất cải tiến

Đề xuất business logic mới nhưng vẫn tương thích với database hiện tại.

---

## 3. Roadmap

Tạo thêm:

quiz-implementation-plan.md

Chia thành nhiều phase nhỏ.

Ví dụ:

Phase 1

Đọc code

Phase 2

Hoàn thiện business

Phase 3

Thiết kế API

Phase 4

Refactor backend

Phase 5

Kiểm thử

Sau mỗi phase phải dừng để tôi review.

---

# Quy định

Không sửa bất kỳ file nào.

Không generate code.

Không refactor.

Không thay đổi database.

Không thay đổi schema.

Không tạo migration.

Chỉ đọc, phân tích và lập kế hoạch.

tham khảo link này https://topclass.hocmai.vn/nhaplieugiaovien?code=toan-7-2027&learn_number=10

Nếu không chắc một business rule, hãy ghi rõ giả định thay vì suy đoán.