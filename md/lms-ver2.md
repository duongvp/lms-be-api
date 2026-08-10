TÀI LIỆU YÊU CẦU NGHIỆP VỤ

Phân hệ: Quản lý Lịch học & Đề cương LMS

1. Trang Tổng Quan (Dashboard)
Thống kê Đề cương: Bổ sung hiển thị số liệu chi tiết: Số lượng đề cương đã được gán
Quiz và Số lượng đề cương chưa được gán Quiz.
Bộ lọc thời gian (Time Filter): Bổ sung bộ lọc theo khoảng thời gian (Từ ngày - Đến ngày,
Tuần, Tháng) cho các biểu đồ và số liệu thống kê. Khắc phục tình trạng số liệu thống kê
chung chung, giúp báo cáo chính xác hơn.

2. Quản Lý Nội Dung (Quản Lý Đề Cương)
2.1. Giao diện & Hiển thị dữ liệu
Điều kiện hiển thị: Hệ thống yêu cầu người dùng bắt buộc phải chọn bộ lọc (filter) hợp lệ thì mới hiển thị danh sách dữ liệu trên bảng.
Sắp xếp mặc định: Khi tải trang lần đầu, cột "Số thứ tự" phải được sắp xếp theo chiều tăng dần.
Dọn dẹp giao diện: Xóa bỏ các cột dữ liệu không còn sử dụng.
Khóa dữ liệu quá khứ: Những bài học/đề cương đã diễn ra trong quá khứ tuyệt đối không được phép sắp xếp lại hoặc thay đổi thứ tự.
2.2. Phân quyền & Bảo mật
Bảo mật cấp 2: Yêu cầu nhập thêm một lớp mật khẩu xác thực khi truy cập vào tính năng
Quản lý đề cương. (Áp dụng ngay cả khi tài khoản đó đã có sẵn quyền truy cập, nhằm bảo vệ an toàn cho phân hệ dữ liệu quan trọng này).
Nhật ký hệ thống (Audit Log): Hệ thống cần tự động lưu lại lịch sử khi có thao tác thay đổi thời gian (Bao gồm thông tin: Ai là người sửa và Sửa vào thời gian nào).
`	2.3. Hỗ trợ Nhập liệu & Chuyển đổi dữ liệu
Quản lý `course_id`: Chuyển luồng nghiệp vụ quản lý `course_id` từ module Lịch học sang module Quản lý đề cương. Mapping `package_id` + `course_id` được quản lý trên từng bài học của từng Chương trình, không đọc/phụ thuộc từ `calendar`.
Thao tác hàng loạt: Cung cấp tính năng Thêm hàng loạt (Bulk Add) hoặc Xóa hàng loạt (Bulk Delete) `course_id` cho toàn bộ các bài học thuộc một chương trình cụ thể.
Khóa cập nhật: Mọi thao tác cập nhật/xóa hàng loạt không được phép tác động hay can thiệp vào các bài học ở quá khứ.
Điều kiện Import: Thao tác Import dữ liệu phải được thực hiện đích danh cho một Chương trình cụ thể.
3. Quản Lý Lịch Học (View Theo Chương Trình)
3.1. Giao diện & Cấu trúc Dữ liệu
Đổi tên nhãn: Đổi tên cột "Khóa học" thành "Chương trình" (Ví dụ: `nguvan-6-2027` được xác định là một Chương trình).
Định dạng hiển thị: Cung cấp 2 chế độ xem: Dạng Lịch (Calendar) và Dạng Bảng (Table).
Dọn dẹp giao diện: Ẩn toàn bộ các phần/cột hiển thị liên quan đến "Tài liệu".
Điều kiện truy xuất: Tương tự như Quản lý đề cương, người dùng bắt buộc phải chọn filter
Chương trình thì mới nhìn thấy lịch học. Tính năng Import cũng chỉ hợp lệ khi khớp với
Chương trình đang được chọn.
Phân bổ ID: Trường `course_id` nằm ở phần Quản lý nội dung (đi theo Chương trình).
Trường `lesson_id` sẽ thuộc quyền quản lý của phần Quản lý lịch học.
Khi tạo lịch, chưa bắt buộc phải gán `lesson_id` HOCMAI. Lịch chưa có `lesson_id` vẫn được lưu trong LMS nhưng chưa sinh queue đồng bộ HOCMAI; sau khi được gán mapping hợp lệ mới cho phép đồng bộ.
Ghi chú: Hiện tại chưa cần phát triển nghiệp vụ quản lý "Tạo lịch Live".

3.2. Tạo Lịch Học Tự Động (Auto-scheduling)
Cơ chế Block: Lịch học tự động sẽ được chia thành các Block. (Ví dụ: Lộ trình có 20 bài sẽ chia thành 20 Block loại 1 bài/Block hoặc 10 Block loại 2 bài/Block). Mỗi bài trong Block sở hữu cặp lịch học chính/phát lại riêng.
Ví dụ thiết lập:
Bài 1 bắt đầu từ 20/06: Lịch học là Thứ 2 & Thứ 7.
Bài 2 học nối tiếp: Lịch học có thể là Thứ 3 & Thứ 7.
Phân loại hệ học (Topclass & Topuni):
Đối với hệ Topclass: Chủ yếu diễn ra 2 buổi/lịch trên cùng 1 bài học (1 buổi học chính &
1 buổi phát lại).
Kịch bản xếp lịch xen kẽ: Cho phép hệ thống sinh lịch liên tục và linh hoạt theo các trật tự như: Bài 1 ➔ Bài 2 ➔ Bài 1 (Buổi 2) ➔ Bài 2 (Buổi 2) hoặc Bài 1 ➔ Bài 1 (Buổi 2) ➔ Bài 2 ➔ Bài 2 (Buổi 1)
Đánh dấu ngày nghỉ: Hệ thống thực hiện tạo lịch liên tục theo cấu hình Block, có hỗ trợ tính năng "Đánh dấu ngày nghỉ" (hệ thống sẽ tự động bỏ qua và tịnh tiến lịch học nếu rơi vào những ngày này).
