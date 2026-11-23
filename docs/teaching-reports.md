# Báo cáo giảng dạy

Theo yêu cầu ngày 23/11/2026, hệ thống chỉ theo dõi số buổi và thời lượng của giáo viên/trợ giảng. Đã bỏ đơn giá, kỳ lương, điều chỉnh, thanh toán và toàn bộ xác nhận công thủ công.

## Nguồn dữ liệu và ý nghĩa số giờ

Báo cáo đọc bảng calendar, teacher_profiles và thông tin chương trình từ cùng repository với quản lý đề cương. Không tạo bảng báo cáo mới, không ghi lại lịch hoặc tự xác nhận buổi học.

- Thời lượng là chênh lệch giờ bắt đầu/kết thúc trên lịch. Đây không phải dữ liệu có mặt thực tế.
- Lịch nghỉ/hủy và lịch xóa không cộng giờ. Lịch tương lai vẫn có phân công, không cộng vào giờ lịch đã kết thúc.
- Cách tính giờ nhân sự có hai lựa chọn: `hours_mode=union` (mặc định, gộp khoảng trùng theo người và vai trò) và `hours_mode=per_assignment` (cộng đủ từng lịch phân công). Tổng giờ lịch không đổi theo lựa chọn. Chỉ nhân sự khớp hồ sơ mới được cộng giờ.
- Cảnh báo trùng giờ xét các lịch không nghỉ học trong kết quả lọc, theo cùng hồ sơ nhân sự và vai trò, kể cả khác chương trình. Hai lịch chỉ tiếp giáp giờ không tính trùng. Mỗi lịch hiển thị người/vai trò, tổng số lịch trùng và tối đa 5 lịch ví dụ (mã lịch, chương trình, giờ). Bảng nhân sự có số lịch bị trùng; Excel giữ thông tin cảnh báo và cách tính đã chọn.
- Một người có thể có hai dòng vai trò giáo viên và trợ giảng. Hồ sơ trùng tên không được tự gán. Tên đầy đủ của lịch cũ được đối chiếu thêm với tên trên tài khoản users có cùng username với teacher_profiles (bỏ tiền tố mã số); không dò tên gần giống. Cảnh báo phân biệt chưa phân công, chưa khớp tên và trùng nhiều hồ sơ. Cột trợ giảng hiển thị display_name, giữ tên gốc nếu chưa khớp hồ sơ.
- Dùng quy ước wall-clock Việt Nam hiện có của lịch. Khoảng ngày có cận trên loại trừ; UI tự chuyển ngày cuối người dùng chọn.

## Giao diện và quyền

Trang `/teacher-reports` có hai tab Lịch giảng dạy và Theo nhân sự, biểu đồ ngày, xuất Excel, bộ lọc ngày/tiến độ/vai trò và bộ lọc chéo chương trình–giáo viên–trợ giảng–môn–khối–vai trò. Không có bộ lọc nhóm học.

Môn và khối dùng metadata chương trình như quản lý đề cương. Danh sách gợi ý chỉ gồm phân công trong khoảng ngày đang chọn và các chương trình được phép xem. Thay đổi gợi ý chưa tự chạy báo cáo; dùng nút Xem báo cáo.

Excel gồm ba sheet “Theo nhân sự”, “Lịch giảng dạy”, “Thông tin báo cáo”, với tiêu đề và các giá trị phân loại bằng tiếng Việt. Mỗi sheet đánh STT từ 1, bỏ các ID nội bộ; chi tiết lịch trùng tham chiếu STT trong sheet lịch. Header nền xanh chữ trắng, có bộ lọc cột; giờ giữ dạng số với hai chữ số thập phân. Báo cáo rỗng vẫn có tiêu đề.

API chỉ đọc: `GET /api/teaching-reports`, `/options`, `/export`. Quyền giữ lại: `teaching_report.view`, `teaching_report.export`. Export yêu cầu cả quyền xem và xuất trên mọi chương trình liên quan. Các API `/api/teacher-salary` và xác nhận công đã được gỡ.

## Database và migration

Các migration tạo và xóa bảng lương/xác nhận đã được gỡ khỏi source theo yêu cầu vì chỉ từng áp dụng trên DB local. Không có migration lương/xác nhận nào cần chạy khi merge thay đổi này.

Các bảng liên quan đã được xóa khỏi livestream_local, sau khi sao lưu và đối chiếu dữ liệu lịch/mapping/users/teacher_profiles/stream/room_config. Database nguồn không được ghi. Những bản ghi tương ứng với migration đã gỡ cũng được dọn khỏi lịch sử migration local; hai quyền báo cáo hiện có được giữ nguyên.

## Kiểm tra

`npm run test:teaching-reports` kiểm tra ngày, danh tính, phân trang và gộp thời lượng. Integration chạy trên database tạm localhost với schema hiện tại và quyền báo cáo được seed riêng cho test, kiểm quyền HTTP, môn/khối, vai trò, lịch nghỉ/tương lai, thời gian trùng và tính chỉ đọc; tự xóa database test.

FE: `QA_MODE=filters node tests/teaching-reports.e2e.cjs` kiểm tra lọc chéo; `QA_MODE=personnel` kiểm tra tab nhân sự và dữ liệu giờ thiếu; `QA_VIEWPORT=390` dùng màn hình mobile. Kiểm tra bằng Chrome local, mock dữ liệu API trong test UI.

`QA_MODE=hours` kiểm tra hai cách tính giờ, chi tiết lịch trùng, giữ lựa chọn khi đổi tab/xuất Excel và đặt lại mặc định.

Vai trò được lọc chéo hai chiều theo vai trò có phân công trên lịch. Một lịch có thể có cả giáo viên và trợ giảng; chọn vai trò trợ giảng vẫn cho lọc giáo viên cùng dạy. Lịch có phân công chưa khớp hồ sơ vẫn được giữ trong danh sách chương trình/môn/khối theo vai trò. `QA_MODE=roles` kiểm tra luồng này trên desktop/mobile.

Biểu đồ thanh riêng cho giáo viên và trợ giảng dùng toàn bộ dữ liệu sau bộ lọc (không phụ thuộc trang của bảng). Chỉ số chuyển giữa giờ lịch đã kết thúc, giờ theo lịch, số lịch phân công. Giờ dùng chế độ gộp/cộng từng lịch hiện chọn; chọn vai trò chỉ hiện biểu đồ tương ứng. Tên trùng được phân biệt thêm bằng tài khoản; danh sách dài có thể cuộn. `QA_MODE=staff-charts` kiểm tra biểu đồ thật, tooltip tiếng Việt, lọc, cách tính giờ và trạng thái rỗng trên desktop/mobile.

Biểu đồ nhân sự mặc định hiển thị 10 người có giá trị cao nhất theo chỉ số đang chọn, có nút Xem tất cả/Thu gọn; bấm thanh để xem lịch của đúng người và vai trò, giữ các bộ lọc và chế độ giờ. Biểu đồ xu hướng dùng số lịch theo tuần (thứ Hai) hoặc tháng, bù kỳ không có lịch bằng 0; tính trong khoảng lọc và gồm lịch nghỉ học. Kiểm tra tổng hợp kỳ bằng `node --import tsx --test ../LMS.FE/tests/report-chart-data.test.ts` từ repo BE.

Biểu đồ xu hướng có đủ Theo ngày / Theo tuần / Theo tháng; chế độ ngày hiển thị từng ngày trong khoảng lọc và bù ngày không có lịch bằng 0.

Xu hướng có thanh kéo hai đầu và kéo đoạn giữa để chọn/dịch khoảng xem, cùng Phóng to / Thu nhỏ / Toàn bộ. Chế độ ngày mặc định tối đa 30 ngày cuối, không có nút tắt 30 ngày cuối. Các nút Phóng to / Thu nhỏ / Toàn bộ dùng icon kèm tooltip và nhãn truy cập. Nhãn trục giảm mật độ, không xoay dọc; ẩn điểm khi xem trên 60 kỳ. Thu phóng chỉ thay đổi biểu đồ, giữ nguyên bộ lọc và số tổng báo cáo; đổi khoảng ngày/chu kỳ sẽ đặt lại khoảng xem.

Xem báo cáo / Đặt lại / Làm mới có spinner trên nút và vùng kết quả. Luôn tải mới khi bấm, kể cả bộ lọc giữ nguyên hoặc kết quả đã cache; khóa bấm lặp trong cùng thao tác. Giữ kết quả trước trong khi tải, chỉ chuyển bộ lọc đã áp dụng khi dữ liệu mới sẵn sàng. Lỗi tải hiển thị rõ và giải phóng trạng thái loading để thử lại. `QA_MODE=loading` kiểm tra API chậm, cache, lỗi/thử lại và chống gửi lặp trên desktop/mobile.

Biểu đồ nhân sự giới hạn vùng tên, tên dài hiển thị dấu … và giữ nguyên tên đầy đủ trong tooltip. Nhãn giá trị đặt ngoài thanh, chữ đậm màu tối, có khoảng trống bên phải; không cuộn ngang khi tên dài. Đã kiểm tra tên dài và giá trị rất nhỏ trên desktop/mobile.

Khi mở chi tiết nhân sự từ biểu đồ hoặc bảng, lưu bộ lọc và tab trước đó. Nút Quay lại tổng quan nằm ở thanh điều khiển phần thống kê nhân sự, khôi phục cả vai trò ban đầu (không giữ vai trò được tự thêm lúc drill-down), khoảng ngày, cách tính giờ, tab và trang trước đó. Chọn nhân sự trên biểu đồ hoặc bảng sẽ đồng bộ ô Giáo viên/Trợ giảng và vai trò tương ứng; không hiển thị thông báo hoặc dòng Chi tiết riêng. Gửi bộ lọc mới/Đặt lại sẽ thoát ngữ cảnh chi tiết sau khi tải thành công.

Thống kê giáo viên và Thống kê trợ giảng hiển thị trong hai box riêng như ban đầu, dùng chung bộ chọn chỉ số và bộ lọc báo cáo. Giữ đồng bộ nhân sự được chọn vào ô lọc và không hiển thị dòng/thông báo Chi tiết.

Bảng Lịch giảng dạy và Theo nhân sự dùng sticky header cùng cơ chế Quản lý lịch, bám vùng cuộn Admin Content, với offset theo breakpoint. Không tạo cuộn dọc lồng trong bảng; cuộn ngang giữ cột header và body đồng bộ. `QA_MODE=sticky` kiểm tra cả hai tab trên desktop/mobile bằng vùng cuộn mô phỏng AdminLayout.

Bộ lọc Hệ thống gồm Top Class (`topclass`) và Top Uni (`topuni`), lọc chéo hai chiều với chương trình/giáo viên/trợ giảng/môn/khối/vai trò. Phân loại lấy từ `calendar.system_type`, đồng nhất với điều kiện báo cáo backend hiện có; không suy đoán theo tên chương trình. Bỏ chọn/Đặt lại sẽ xem mọi hệ thống. Biểu đồ và Excel dùng bộ lọc hệ thống đã áp dụng. `QA_MODE=systems` kiểm tra trên desktop/mobile.
