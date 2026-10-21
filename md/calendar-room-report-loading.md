# Tải báo cáo lớp học theo từng phần

Báo cáo tổng hợp trước đây đã tách EVG khỏi truy vấn chuyên cần bằng `include_recordings=false`, nhưng phải chờ chuyên cần và tổng hợp các lịch liên quan mới hiển thị được bảng.

Luồng mới dùng cùng GET `/api/livestreams/room-report`, quyền và phạm vi lịch hiện có:

1. `include_attendance=false&include_recordings=false`: chỉ lấy danh sách lịch được phép xem, 20 lịch/trang, đúng bộ lọc. Không đọc users_logs, lịch sử phân phòng, lịch cùng chương trình/bài hoặc EVG. Các số học sinh trả null với `attendance_status=pending`, không trả 0 giả.
2. Yêu cầu đầy đủ tải độc lập với `include_recordings=false`. Khi xong, thay số liệu chờ bằng số thực. Quy tắc chuyên cần, cột tổng lịch 1/2, phân quyền và Excel giữ nguyên.
3. Giờ live qua `/room-report/live-times` bắt đầu ngay khi có ID lịch, độc lập với chuyên cần. Hợp nhất theo calendar_id dù nguồn nào về trước; chỉ gọi các ID chưa tải, kể cả khi lịch được cập nhật giữa hai phản hồi. Retry EVG không khởi động lại truy vấn chuyên cần đang chạy.

Nếu tải lịch nhanh lỗi, vẫn có thể hiển thị phản hồi đầy đủ. Nếu chuyên cần lỗi, giữ thông tin lịch và giờ live đã có, đánh dấu ô “Chưa tải được” cùng nút thử lại. Cache giao diện chỉ giữ số liệu chuyên cần đã hoàn thành. Việc đóng modal/đổi phạm vi bỏ qua phản hồi cũ.

Tra các lịch liên quan xử lý tối đa hai chương trình song song qua chính lister có phân quyền; giữ phân trang từng chương trình và so khớp chính xác code + số bài. Không thay SQL chuyên cần, schema, index hoặc dữ liệu DB. Export luôn tính đầy đủ, không dùng phản hồi chờ.

Kiểm tra: 26 test calendar-room-report, 9 test EVG; Chrome `calendar-room-report-progressive.e2e.cjs` kiểm tra cả hai thứ tự phản hồi, EVG lỗi/retry khi chuyên cần còn chờ, số liệu null và metadata lỗi; hồi quy `calendar-room-report-live-times.e2e.cjs` và `calendar-detail-report.e2e.cjs`; TypeScript FE/BE.

Đo SELECT hai lịch mẫu trên DB đang cấu hình: metadata 321 ms, chuyên cần 710 ms, không gọi EVG. Đây là đo một lần trên phạm vi nhỏ, không đại diện trang 20 lịch hoặc hiệu năng tải đồng thời.
