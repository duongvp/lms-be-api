# Thông báo thay đổi lịch học lên Microsoft Teams

## Kiến trúc

Luồng lịch học không gọi Teams trực tiếp. Trong cùng transaction thay đổi
`calendar`, service thêm sự kiện vào `teams_notification_outbox`. Worker nền
claim sự kiện, gửi Adaptive Card đến từng webhook rồi đánh dấu kết quả.

Thiết kế này bảo đảm:

- Teams lỗi không làm rollback thao tác lịch đã hoàn tất.
- Mỗi `event_key + destination` chỉ có một outbox record.
- Nhiều instance backend không cùng claim một record.
- Sự kiện lỗi được retry với exponential backoff; mặc định tối đa 5 lần.

Trạng thái outbox: `0=pending`, `1=sent`, `2=retry`, `3=processing`,
`4=failed`.

## Tạo Teams webhook

Trong ứng dụng Workflows của Teams, dùng template gửi webhook alert vào
channel, chọn Team/Channel và sao chép callback URL sau khi lưu workflow.

Khuyến nghị dùng Teams Workflows thay cho Microsoft 365 Connector cũ. Nếu
workflow dùng chế độ xác thực tenant, bearer token phải được cấp và xoay vòng
bởi hạ tầng triển khai; webhook kiểu `Anyone` không cần token.

## Cấu hình

```env
TEAMS_NOTIFICATIONS_ENABLED=true
TEAMS_WEBHOOKS_JSON='[
  {"name":"van-hanh","url":"https://..."},
  {"name":"dao-tao","url":"https://..."}
]'
TEAMS_NOTIFICATION_POLL_INTERVAL_MS=5000
TEAMS_NOTIFICATION_TIMEOUT_MS=10000
TEAMS_NOTIFICATION_MAX_ATTEMPTS=5
TEAMS_NOTIFICATION_BATCH_SIZE=20
```

Tên destination phải duy nhất. URL webhook là secret và không được commit.

## Triển khai database

```bash
npx prisma migrate deploy
```

Migration tạo bảng `teams_notification_outbox`. Cần chạy migration trước khi
bật `TEAMS_NOTIFICATIONS_ENABLED=true` và cấu hình webhook.

## Phạm vi sự kiện

- Tạo một lịch, tạo hàng loạt và import lịch.
- Cập nhật một lịch và cập nhật hàng loạt.
- Hủy, dời lịch, tạo lịch học bù.
- Xóa lịch.

Thông báo update chỉ được enqueue khi snapshot trước/sau có thay đổi và hiển
thị từng giá trị cũ → mới. `event_key` cùng unique index chống enqueue trùng
cho cùng một event/destination.


## Đồng bộ học viên đăng ký sát giờ học

Backend chỉ chạy vào 17:00, 17:30, …, 23:30 (giờ Việt Nam), quét mọi lịch hoạt động của ngày hiện tại (kể cả đang dạy hoặc đã kết thúc, loại lịch nghỉ học), chỉ lấy học viên đăng ký trong ngày và thêm enrollment còn thiếu. Enrollment đã có không bị sửa. Cron lấy học viên qua API theo các package của toàn bộ lịch trong ngày (chia nhóm tối đa 50 package, lấy đủ mọi trang), rồi phân dữ liệu cho từng chương trình để ghi tuần tự. Nếu request gộp lỗi, cron tự quay lại gọi API riêng theo chương trình. Sau 23:30 cron nghỉ đến 17:00 hôm sau. Thiết lập bằng:

```env
CALENDAR_STUDENT_CRON_ENABLED=true
CALENDAR_STUDENT_CRON_NOTIFY_EMPTY=false
```

Sau lượt có lịch cần xử lý (hoặc có lỗi), kết quả được đưa vào cùng Teams outbox nên vẫn tự retry nếu webhook tạm thời lỗi. Đặt `CALENDAR_STUDENT_CRON_NOTIFY_EMPTY=true` nếu cần nhận cả thông báo các lượt không có lịch.
