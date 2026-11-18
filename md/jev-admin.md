# Cấu hình JEV trên LMS Admin

Trang `/jev` gồm bộ cấu hình, vận hành toàn hệ thống, phạm vi và trạng thái đồng bộ. Dữ liệu là bốn bảng JEV do repo Chat quản lý; Admin chỉ khai báo hai model cấu hình để đọc/ghi. Không có endpoint sửa student state hoặc audit ledger.

## Kết nối và triển khai

1. Repo Chat đã chạy migration compact và seed. `DATABASE_URL` của Admin trỏ đúng DB dùng chung. **Không chạy `prisma db push`, `migrate dev` hoặc tạo lại bảng JEV từ repo Admin.** Quyền DB của backend Admin cần SELECT/INSERT/UPDATE hai bảng `chat_jev_policy_versions`, `chat_jev_bindings` và SELECT lịch cho kiểm tra phạm vi. Không cấp quyền ghi state/ledger cho phần cấu hình.
2. Trên backend Admin, đặt:

   ```dotenv
   JEV_CHAT_API_URL=http://streamapp_api:3001
   JEV_INTERNAL_API_SECRET=<giống INTERNAL_API_SECRET của backend Chat>
   ```

   URL là địa chỉ gốc truy cập từ backend Admin, không thêm `/api/internal/jev-policy`. Hai biến này chỉ ở backend. Không cần sao chép `TYPESAFE_API_KEY`, `ROOM_TOKEN_SECRET` hoặc `REDIS_URL` sang Admin. Chúng vẫn được cấu hình trên Chat theo tài liệu triển khai Chat.
3. Trong `lms-manage-api`, chạy `npm ci`, `npm run build`, rồi `npm run db:jev-rbac`. Lệnh RBAC chỉ tạo module/quyền và gán năm quyền cho role `admin`; không bật JEV hoặc thay đổi policy Chat. Đăng nhập lại nếu phiên hiện tại chưa thấy quyền mới. Không dùng toàn bộ seed RBAC cũ chỉ để thêm quyền JEV.
4. Build/deploy `LMS.FE` như hiện tại. Trang gọi `/api/jev` trên backend Admin qua `NEXT_PUBLIC_BACKEND_API_URL` đang có.
5. Mở **Kiểm duyệt JEV → Trạng thái đồng bộ → Kiểm tra** để xác nhận kết nối tới Chat. Không bật mode chỉ để thử kết nối.

Quyền tách riêng: `jev.view`, `jev.edit`, `jev.publish`, `jev.bind`, `jev.runtime`. Ngoài role admin, tài khoản cần phạm vi chương trình `ALL` cùng quyền tương ứng vì bản phát hành/runtime có tác động toàn hệ thống. `RESTRICTED` và `DENY` không được truy cập API JEV dù có wildcard permission. Người có quyền sửa policy là quản trị viên cấu hình tin cậy.

## Luồng sử dụng

- Tạo bản nháp bằng cách chọn bộ cấu hình có sẵn làm mẫu hoặc Mẫu chuẩn từ Live. Form tự điền mã và gợi ý phiên bản kế tiếp trong danh sách được tải, hỗ trợ tải thêm 100 mẫu mỗi trang. Không phải nhập JSON. Sau tạo, tự mở giao diện cấu hình để chỉnh tiếp. Mẫu chuẩn được biên dịch trực tiếp từ bản chụp seed gốc Live trong backend LMS; không chạy seed, sửa GLOBAL hay bật vận hành. Bản đã phát hành chỉ đọc. API tạo JSON cũ vẫn giữ để tương thích.
- Mở cấu hình bắt đầu tại Tổng quan, có số nhóm/mức/quy tắc/thông báo và hướng dẫn Lưu nháp → Kiểm tra → Phát hành. Nhóm nội dung và mức độ dùng biểu mẫu, các định danh nghiệp vụ giữ nguyên. Đổi tên hiển thị không sửa nội dung AI; đổi định nghĩa/tiêu chí cập nhật tiêu chí AI liên quan theo cách dựng rubric của Live. Hướng dẫn AI gốc không tự dịch. Quy tắc xử lý có lọc, phân trang và nhãn tiếng Việt; chi tiết sửa đúng index gốc kể cả khi lọc. Mẫu thông báo có tìm kiếm, lọc người nhận và xem trước. Ngưỡng hiển thị % và lưu 0..1; xóa ô là NULL, khác 0%. JSON, liên kết mẫu an toàn và fallback nằm tại Thiết lập nâng cao. Thêm/xóa nhóm hoặc mức cần cập nhật toàn bộ cấu trúc và kiểm tra trước khi phát hành.
- Lưu nháp rồi **Kiểm tra**. Kiểm tra chạy compiler cùng contract với Chat. **Kiểm tra giả lập** gửi điểm giả lập sang endpoint internal preview có sẵn trên Chat; không gọi provider, không tính lượt. Chưa lưu thì không preview.
- **Thử tình huống** dùng điểm giả định theo %, số lần trước theo ô số; chuyển về xác suất 0..1 và object counter theo đúng API Live. Không gọi AI, gửi chat hay thực thi chế tài. **Phát hành** kiểm toàn bundle/hash, tương thích định danh đã publish và ngưỡng đã hiệu chỉnh. Không tự gán bản mới vào phạm vi.
- Trong **Phạm vi áp dụng**, nhập ID policy đã phát hành từ danh sách. Với phạm vi lịch học, tìm/chọn mã chương trình rồi chọn lịch theo số buổi, tên bài và thời gian. Hệ thống lấy `calendar.id` thực của lịch được chọn; không suy từ code + learn_number. Danh sách lịch tìm được theo số buổi hoặc tên bài, tải thêm 30 lịch mỗi lần. Đổi chương trình sẽ bỏ lựa chọn lịch cũ. Phạm vi đã có giữ cố định chương trình/lịch khi chỉnh mode để bảo toàn CAS. Chọn off để tắt phạm vi; inherit cho CODE/CALENDAR để quay về cấp cha. Không xóa binding.
- **Chế độ toàn hệ thống** sửa `GLOBAL.runtime_json`, khác **Policy mặc định** là binding GLOBAL. Cả hai cùng CAS revision GLOBAL. Sau lưu runtime/binding, Admin gọi reload Chat. Nếu hook thất bại, response vẫn báo dữ liệu đã lưu và chưa xác nhận đồng bộ; chỉ bấm **Thử đồng bộ lại**, không lặp mutation.
- Khi revision xung đột, form giữ thay đổi của người dùng, không tự ghi đè. Đọc bản mới để so sánh. Với phạm vi, đóng form → Tải lại → mở lại. Với runtime, xem bản hiện tại rồi Tải lại khi muốn bỏ thay đổi.

Mode thực tế còn chịu trần `CHAT_JEV_MODE`, key/Redis/actor secret trên Chat và binding được chọn; enforce còn cần L1 enforce. Status là worker đang trả lời, không phải xác nhận toàn cụm. `runtimeStatus` là mode engine; `policy.runtime.settings.mode` là cấu hình DB. Quota dự phòng không phải hóa đơn hay số dư provider.

## API

Tất cả endpoint dưới `/api/jev` dùng xác thực và RBAC của LMS:

| Endpoint | Quyền |
|---|---|
| GET `/policies`, GET `/policies/:id` | jev.view |
| POST `/policies`, POST `/policies/from-template`, PUT `/policies/:id`, POST `/policies/:id/clone` | jev.edit |
| POST `/policies/:id/validate`, POST `/preview` | jev.view |
| POST `/policies/:id/publish` | jev.publish |
| GET `/bindings`, GET `/runtime`, GET `/status` | jev.view |
| GET `/scope/programs?q=...`, GET `/scope/calendars?code=...&q=...&page=...`, GET `/scope/calendars/:calendarId` | jev.view |
| PUT `/bindings` | jev.bind |
| PUT `/runtime`, POST `/reload` | jev.runtime |

Policy list phân trang 20 dòng, tối đa 100. Binding list phân trang 100 dòng, gồm tombstone và thông tin lịch học lấy theo lô để hiển thị. Tra cứu chỉ trả mã chương trình và thông tin tối thiểu của lịch chưa bị xóa; không trả thông tin học sinh hoặc khóa stream. POST `/policies/from-template` nhận `{policyKey, revision, sourcePolicyId?}`; bỏ sourcePolicyId để dùng seed chuẩn Live, có sourcePolicyId để clone bản hiện có. API tạo chỉ ghi DRAFT, không publish/bind/reload. PUT draft nhận `{expectedEditRevision, config}`; publish nhận `{expectedEditRevision}`. PUT runtime nhận `{expectedRevision, settings}` không chứa revision trong settings. Binding nhận `{scopeType, scopeKey, mode, policyVersionId, expectedRevision}`; revision=0 chỉ cho scope mới. Actor lấy từ phiên đăng nhập, không từ body.

Body giới hạn 700 KiB riêng module này; compiler chặn bundle quá 640 KiB. Hook timeout 3 giây, không tự retry POST và không theo redirect. Secret không đi xuống browser. Lưu draft/publish chỉ cập nhật DB; đổi binding/runtime mới yêu cầu reload.

## Nguồn contract và kiểm tra

`src/modules/jev/vendor` chụp compiler/helpers từ `streamapp-v2/apps/api/src/services` ngày 17/11/2026. `manifest.json` lưu SHA-256 của file nguồn. Ngoại lệ duy nhất: nhánh thiếu GLOBAL trong `policy-database.ts` dùng `return invalid()` để TypeScript 7 thu hẹp kiểu; cùng hành vi ném lỗi. Khi Chat đổi contract, đồng bộ lại toàn bộ dependency closure và chạy test trước khi dùng bản Admin mới. Nên tách package chung hoặc bổ sung API ghi trên Chat trong lần phát triển tiếp theo để giảm nguy cơ lệch phiên bản.

Fixture `tests/fixtures/jev-c2-r2.json` là bundle synthetic biên dịch từ seed C2 revision 2 ở repo Chat, không phải dữ liệu người dùng/DB thật.

```sh
# Backend, không kết nối DB thật trong các test này
npm run test:jev
npx tsc --noEmit

# Trong LMS.FE; Chrome headless, toàn bộ API được giả lập
node tests/jev.e2e.cjs
# Test model biểu mẫu, chạy từ thư mục lms-manage-api:
# node --import tsx ../LMS.FE/tests/jev-policy-model.test.cjs
npx tsc --noEmit --incremental false
```

Chưa xác minh deployment/DB/Chat đang chạy hoặc tải production. Không có lệnh activation/seed/migration hay thay mode DB được thực thi khi xây dựng phần tích hợp này.
