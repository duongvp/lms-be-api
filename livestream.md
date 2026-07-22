Nghiệp vụ Quản lý lịch Livestream
1. Thêm lịch livestream
1.1. Thêm từng lịch
Cho phép tạo một buổi học riêng lẻ với các thông tin: - Khóa học/lớp học - Bài học (lesson) - Tên buổi học - Giáo viên - Thời gian bắt đầu - Thời gian kết thúc - Phòng học (nếu có) - Trạng thái (Nháp / Đã lên lịch)

1.2. Thêm nhiều lịch tự động
Cho phép tạo hàng loạt lịch theo chu kỳ.

Thông tin cấu hình: - Ngày bắt đầu - Ngày kết thúc hoặc số buổi - Số buổi/tuần - Các ngày trong tuần (Thứ 2...Chủ nhật) - Khung giờ học - Thời lượng mỗi buổi - Giáo viên - Đề cương/bài học áp dụng

Hệ thống tự sinh toàn bộ lịch theo cấu hình.

Ví dụ - Học thứ 2 - 4 - 6 - 19:30 - 21:00 - Từ 01/08 đến 30/09

⇒ Tự tạo toàn bộ lịch trong khoảng thời gian đó.

1.3. Kiểm tra khi tạo
Trùng thời gian giáo viên.
Trùng phòng học.
Trùng lesson (nếu không cho phép).
Trùng chính xác buổi học đã tồn tại.
Cảnh báo nếu thời gian học vượt thời gian kết thúc khóa học.
2. Sửa lịch livestream
Cho phép sửa: - Thời gian - Giáo viên - Lesson - Tên bài - Phòng học - Trạng thái

2.1. Chỉ sửa buổi hiện tại
Chỉ cập nhật đúng một buổi, các buổi phía sau giữ nguyên.

2.2. Sửa và cập nhật các buổi phía sau
Áp dụng khi thay đổi ảnh hưởng đến tiến độ học.

Ví dụ: Buổi 5 nghỉ và lùi đề cương một buổi.

Hệ thống tự động: - Dời lesson của các buổi sau xuống 1 buổi. - Cập nhật lesson_name. - Cập nhật lesson_count (nếu có). - Giữ nguyên thứ tự đề cương.

 dời lịch học phần following sửa lại vẫn giữ nguyên key thay vào đó dồn lịch học xuống và tạo thêm 1 buổi khác, chuyển trạng thái buổi học khi dời , chuyển tất cả thông tin ví dụ như để cương xuống, nếu tạo thêm mới 1 buổi học mới sẽ cung cấp thêm giá trị cho buổi học mới như thời gian bắt đầu và thời gian kết thúc nhưng vẫn phải check điều kiện (
Giáo viên có bị trùng lịch.
Phòng học có bị trùng.
Hai buổi cùng khóa có bị trùng thời gian.
Lesson có bị trùng hoặc thiếu.
Thời gian bắt đầu nhỏ hơn thời gian kết thúc.
Không vượt thời gian kết thúc khóa học.
Không sửa các buổi đã diễn ra (hoặc yêu cầu xác nhận/phân quyền
 chỉ dời lịch khi chúng phải cùng code ).  phần dời lịch này là trường hợp khi nghỉ buổi học


2.3. Nghỉ một buổi nhưng không dời đề cương
Chỉ đánh dấu buổi là Nghỉ/Hủy.
Không thay đổi lesson hoặc thời gian các buổi sau.
2.4. Dời lịch học
Cho phép: - Chỉ dời buổi hiện tại. - Dời toàn bộ các buổi phía sau theo cùng khoảng thời gian.



3. Thêm/Xóa buổi
3.1. Thêm buổi giữa khóa
Ví dụ: Thêm một buổi ôn tập sau Lesson 10.

Lựa chọn: - Không đánh lại lesson. - Đánh lại toàn bộ lesson phía sau.

3.2. Xóa buổi
Xóa nhưng giữ nguyên đề cương - Lesson phía sau giữ nguyên.

Xóa và dồn đề cương - Lesson phía sau được đánh lại liên tục.

4. Cập nhật hàng loạt
Cho phép cập nhật: - Giáo viên - Khung giờ - Thời lượng - Phòng học - Trạng thái

Phạm vi áp dụng: - Các buổi được chọn. - Từ buổi hiện tại đến cuối khóa. - Toàn bộ khóa học.

5. Kiểm tra dữ liệu
Giáo viên có bị trùng lịch.
Phòng học có bị trùng.
Hai buổi cùng khóa có bị trùng thời gian.
Lesson có bị trùng hoặc thiếu.
Thời gian bắt đầu nhỏ hơn thời gian kết thúc.
Không vượt thời gian kết thúc khóa học.
Không sửa các buổi đã diễn ra (hoặc yêu cầu xác nhận/phân quyền).
6. Gợi ý mở rộng
Xem trước (Preview) các thay đổi trước khi lưu.
Lưu lịch sử thay đổi (Audit log).
Hỗ trợ hoàn tác (Rollback).
Gửi thông báo khi thay đổi ảnh hưởng đến học viên.
Phân quyền theo vai trò (Admin, Điều phối, Giáo vụ...).


7. trường hợp dời lịch có 2 trường hợp 
dời đồng loạt các buổi sau và tạo thêm một buổi mới phía sau
