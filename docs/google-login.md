# Đăng nhập Google

Luồng: nút Google → `/api/auth/google` (proxy Next.js) → Google →
`/callback` (proxy Next.js tới `/api/auth/google/callback` ở backend) → session LMS → `/auth/google/complete`.
Frontend nhận access token qua API refresh hiện có, tải `/me` và chuyển đến trang có quyền.
Không đưa access token hoặc refresh token lên URL.

## Cấu hình

Khai báo ở môi trường **backend**:

```dotenv
GOOGLE_CLIENT_ID=<OAuth web client ID>
GOOGLE_CLIENT_SECRET=<OAuth web client secret>
GOOGLE_REDIRECT_URI=https://liveops.hocmai.io.vn/callback
```

Trong Google Cloud, tạo OAuth client loại Web application, cấu hình consent screen
và đăng ký chính xác URI trên trong Authorized redirect URIs. Local dùng
`http://localhost:3000/callback`, đồng thời đăng ký URI local ở Google.
Route `/callback` được truy cập khi chưa đăng nhập; cookie ngữ cảnh Google có
Path `/callback` và được proxy chuyển tới backend để kiểm tra state/nonce/PKCE.
Frontend tiếp tục dùng `NEXT_PUBLIC_BACKEND_API_URL` trỏ tới backend.
Production đặt `NODE_ENV=production` để cookie chỉ truyền qua HTTPS.
Giữ cấu hình ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET và bảng auth_sessions hiện có.

## Điều kiện truy cập

- Google ID token được thư viện Google xác minh chữ ký, issuer, audience, expiry;
  callback kiểm tra state, nonce và PKCE với cookie HttpOnly hết hạn sau 10 phút.
- Email phải được Google xác minh và thuộc Gmail hoặc Google Workspace (`hd`).
  Google không bảo đảm quyền sở hữu hiện tại của email bên thứ ba chỉ bằng
  `email_verified`; loại email đó cần luồng liên kết riêng.
- Email phải khớp **đúng một** bản ghi users có vai trò hoạt động. Email trùng giữa
  nhiều tài khoản có quyền bị từ chối để tránh chọn nhầm tài khoản.
- Không tự tạo user hoặc cấp vai trò. Session, RBAC, phạm vi chương trình, refresh
  và logout dùng chung với đăng nhập hiện tại.
- Chọn “Duy trì đăng nhập”: refresh cookie có thời hạn theo `exp` của refresh
  token (mặc định 30 ngày), được cập nhật mỗi lần refresh thành công. Không chọn:
  cookie phiên, không có Max-Age/Expires; session phía server mặc định 1 ngày và
  vẫn gia hạn khi refresh. Áp dụng chung cho đăng nhập thường và Google.

Chạy kiểm thử: `node --import tsx --test tests/google-auth.test.ts`.
Kiểm thử sử dụng Google/database giả lập; sau khi điền credentials cần thử thực tế
qua HTTPS với tài khoản được cấp quyền, tài khoản chưa có quyền và thao tác hủy ở Google.

Tham khảo: https://developers.google.com/identity/openid-connect/openid-connect
