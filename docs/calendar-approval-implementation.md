# Triển khai phê duyệt lịch theo Role và User

Ngày: 26/11/2026. Bổ sung cho [thiết kế khảo sát](calendar-approval-workflow-design.md).

## Cấu hình và sử dụng

1. Vào **Vai trò**, mở Role và chọn tab **Phê duyệt**, nhóm **Quản lý lịch học**. Cấu hình `REQUIRE` hoặc `SKIP` cho từng thao tác. Người cấu hình cần quyền quản lý Role tương ứng và `calendar.workflow.manage`.
2. Vào **Quản trị viên**, mở tài khoản cần cấu hình. Thay đổi thông tin, vai trò, phạm vi chương trình và thiết lập duyệt, sau đó bấm **Lưu** ở cuối hộp thoại. Không có nút lưu riêng cho cấu hình duyệt; toàn bộ thay đổi được ghi trong cùng giao dịch. Khi lỗi hoặc cấu hình đã bị người khác thay đổi, giao dịch được hoàn tác và hộp thoại vẫn mở.
3. Cấp quyền duyệt bằng cách gán vai trò **Người duyệt lịch**, hoặc một vai trò có quyền duyệt tương ứng. Thu hồi bằng cách bỏ các vai trò cấp quyền duyệt rồi lưu tài khoản. Phần **Phê duyệt** chỉ hiển thị quyền thực tế, các vai trò cấp quyền và phạm vi chương trình; không còn công tắc cấp quyền riêng. Nếu còn vai trò khác cấp quyền duyệt thì tài khoản vẫn có quyền.
4. Với người nhập lịch, bảng chỉ có hai lựa chọn **Bắt buộc duyệt** và **Không cần duyệt**, chọn sẵn theo giá trị đang áp dụng. Chọn khác cấu hình vai trò sẽ tạo thiết lập riêng và hiện nhãn **Thiết lập riêng**; chọn giống vai trò sẽ bỏ ngoại lệ và tiếp tục kế thừa. **Kế thừa tất cả từ vai trò** xóa các ngoại lệ sau khi bấm lưu.
5. Backend ưu tiên User override; khi kế thừa nhiều Role, chỉ cần một Role REQUIRE là phải duyệt. Thao tác không cấu hình mặc định REQUIRE. SKIP không cấp thêm Permission hoặc mở rộng phạm vi chương trình. Người gửi vẫn cần quyền gửi duyệt; người kiểm tra không được tự duyệt, kể cả admin.
6. Vào **Quản lý lịch học → Phê duyệt lịch học**. Người gửi lưu nháp hoặc gửi duyệt; người kiểm tra xem trước/sau, duyệt hoặc từ chối có lý do. Các form lịch hiện tại trả `202` và `approval_required` khi tạo yêu cầu, không ghi lịch chính thức hoặc kích hoạt queue nghiệp vụ trước approve.
7. Thao tác hiệu lực SKIP tiếp tục luồng hiện tại, được ghi nhận **Đã áp dụng trực tiếp** và gửi notification; thao tác REQUIRE chỉ apply sau approve thành công.

Cũng có màn **Cấu hình tài khoản** trong trang phê duyệt dành cho người có `calendar.workflow.manage`. Danh sách tìm kiếm tối đa 100 tài khoản mỗi lần; dùng tìm kiếm để chọn tài khoản ngoài danh sách ban đầu.

## Cấu hình chung theo module/action

- Bảng policy dùng hai cột radio Bắt buộc duyệt/Không cần duyệt cho cả vai trò và tài khoản. Tài khoản tự kế thừa khi không có lựa chọn khác cấu hình vai trò. Header chỉ chứa tên cột; radio chọn toàn bộ nằm trong dòng **Chọn tất cả** ngay dưới header và áp dụng cho toàn bộ thao tác trong đúng module; trạng thái hỗn hợp không chọn radio tổng. Thay đổi vẫn cần bấm lưu.
- Bảng Quyền dữ liệu cũng giữ header Trường dữ liệu/Xem/Sửa và đặt checkbox chọn toàn bộ ở dòng **Chọn tất cả** trong thân bảng. Chọn Sửa luôn bao gồm Xem; bỏ Xem đồng thời bỏ Sửa.
- Quyền thao tác được chia thành Nghiệp vụ và Phê duyệt; quyền duyệt sắp theo xem yêu cầu → gửi duyệt → duyệt → từ chối → lịch sử → cấu hình. Việc gom nhóm không thay mã Permission.
- Role có một tab **Phê duyệt**, bên trong là nhóm module do backend đăng ký. Tab **Quyền thao tác** tiếp tục quản lý Permission theo module, không chuyển Permission sang policy.
- Registry: `src/modules/approval-policy/approval-policy.registry.ts`. Chỉ đăng ký module sau khi đã có workflow backend; hiện có `calendar`. Đề cương/Câu hỏi chưa có workflow nên không hiển thị hoặc cho cấu hình giả.
- JSON Role: `{"calendar":{"update":"REQUIRE"}}`; JSON User override: `{"calendar":{"update":"SKIP"}}`. Tên action giống nhau ở hai module được xử lý độc lập.
- Engine chung `resolveModuleApprovalPolicy` và `policyForAction(module, action, ...)` không phụ thuộc nghiệp vụ lịch. Calendar dùng adapter để tiếp tục phục vụ các gate, transaction và notification hiện có.
- API chung: `GET /api/approval-policies/modules`, `GET/PUT /api/approval-policies/accounts/:id`. API trả các module hỗ trợ và `module_overrides`, `module_inherited_policy`, `module_effective_policy`, `module_policy_sources`.
- Quyền cấu hình được kiểm tra theo module đã đăng ký; lưu một module không xóa cấu hình của module khác. UI vô hiệu hóa nhóm không có quyền cấu hình.
- Không tạo bảng hoặc migration mới ở bước này. Các cột JSON hiện có lưu cấu trúc theo module; adapter vẫn đọc/nhận cấu hình lịch dạng phẳng cũ. Snapshot lịch sử cũ được giữ nguyên, snapshot mới bổ sung policy theo module.
- Bật/tắt quyền duyệt lịch riêng theo tài khoản vẫn dùng adapter và RBAC hiện hữu; thiết lập policy của một module khác không tự thay đổi quyền của module lịch.

## Backend và dữ liệu

- Migration additive: `20261126090000_calendar_approval_workflow`. Đã áp dụng riêng trên `livestream_local` và ghi nhận migration; không reset hoặc chạy toàn bộ migration lịch sử đang lệch schema.
- Sáu bảng workflow đã có: `calendar_approval_accounts`, `calendar_approval_requests`, `calendar_approval_revisions`, `calendar_approval_audit`, `calendar_approval_notifications`, `calendar_approval_mutex`.
- Migration `20261126110000_role_user_approval_policy` không tạo bảng mới: thêm `roles.approval_policy`, `calendar_approval_accounts.operation_overrides`, snapshot policy trên request/revision và FK cấu hình tài khoản tới User hiện tại.
- Chuyển đổi dữ liệu: Role tồn tại được gán SKIP để giữ hành vi cũ; cấu hình checkbox cũ chuyển thành REQUIRE cho thao tác đã chọn và SKIP cho thao tác không chọn. Role mới/chưa cấu hình dùng mặc định REQUIRE. Không tự thay Role hoặc bật duyệt cho tài khoản thật.
- `required_operations` trong response là policy hiệu lực do backend tính; cột cũ chỉ giữ tương thích, không dùng làm nguồn kế thừa. API nhận `overrides` và trả `inherited_policy`, `effective_policy`, `policy_sources`, `roles`, `role_policy_hash`; User save kiểm tra version và hash policy Role chống ghi đè cấu hình đã cũ.
- Snapshot before/proposed và các mục của batch lưu JSON có revision; revision đã submit được giữ nguyên. Audit có toàn bộ dữ liệu apply và các chuyển trạng thái. UI chỉ nhận dữ liệu đã lọc theo field policy.
- Bổ sung quyền qua `npm run db:calendar-approval-rbac`. Script chỉ upsert quyền, không chạy seed rộng, không bật duyệt cho tài khoản thật.
- `schedule_approver` là vai trò có thể gán và thu hồi qua biểu mẫu tài khoản thông thường. `schedule_submitter` cũng là vai trò gán và thu hồi thông thường. Cấu hình yêu cầu duyệt không tự thêm hoặc xóa bất kỳ vai trò nào; tài khoản cần được cấp quyền gửi duyệt qua vai trò để gửi yêu cầu. API cấu hình chính sách từ chối các trường cấp quyền `can_approve` và `approval_enabled`; giá trị `can_approve` trả về chỉ phản ánh quyền RBAC hiện hành.
- Chạy `npm run db:calendar-approval-rbac` khi cập nhật: tạo vai trò Người duyệt lịch nếu chưa có, chuyển các cờ cấp quyền cũ sang vai trò và xóa cờ trong cùng giao dịch. Chạy lại không khôi phục vai trò đã bị thu hồi, không tự kích hoạt vai trò đã ngừng hoạt động. Giữ cột cũ để tương thích dữ liệu, không thêm bảng hoặc yêu cầu migration mới.
- Giữ soft delete và pipeline HMO/Teams/enrollment hiện có. Các hàm ghi lịch dùng transaction context để apply trong transaction ngoài, không mở transaction Prisma độc lập khi approve.
- Chọn một khóa ghi lịch toàn cục ở bản đầu để bảo vệ cả xung đột giáo viên/phòng giữa các chương trình. Batch lớn sẽ tuần tự hóa việc ghi; đây là lựa chọn ưu tiên tính đúng đắn. Có thể chuyển sang khóa theo tài nguyên sau khi đo tải, không giảm kiểm tra concurrency.
- So sánh hash dữ liệu nghiệp vụ và dependency (lịch, đề cương, mapping) trước apply, không chỉ dựa vào `updated_at` độ chính xác một giây. Dữ liệu nền thay đổi chuyển `CONFLICTED`, giữ nguyên lịch chính thức.
- Kiểm tra lại quyền/scope sau khi lấy khóa; quyết định qua HTTP kiểm tra lại session trong transaction. Cấm tự duyệt và bắt buộc lý do reject.
- Retry cùng Idempotency-Key không tạo request/notification trùng; nội dung khác cùng key bị từ chối. Duyệt lặp cùng revision đã thành công trả lại kết quả, không apply lại.

## API và đường ghi

- `PUT /api/users/:id` nhận thêm `approvalPolicy` khi thiết lập duyệt có thay đổi. Backend kiểm tra quyền cấu hình theo module, phiên bản và cấu hình vai trò gốc trước khi áp dụng việc đổi vai trò trong cùng giao dịch. Người không có quyền cấu hình duyệt không được dùng trường này. API lưu chính sách riêng vẫn phục vụ trang cấu hình độc lập.


Prefix: `/api/calendar-change-requests`.

- `GET /capabilities`, `GET /accounts`, `GET/PUT /accounts/:userId`: cấu hình theo tài khoản và quyền quản trị.
- `GET/POST /`, `GET/PATCH /:id`: danh sách, tạo và sửa draft/revision của mình.
- `POST /:id/submit|approve|reject|cancel|withdraw`: state machine, revision và lock_version bắt buộc.
- `GET /:id/history`: audit theo quyền/scope.
- `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /:id/read`, `POST /notifications/read-all`: inbox cá nhân và read receipt. Bulk read dùng mốc `through_id`; không xóa notification hay đổi quyết định duyệt.

Gate đặt sau RBAC/trường/phạm vi hiện có, trước controller ghi lịch. Các client cũ thiếu `X-Calendar-Submit-Approval: true` bị trả `409 APPROVAL_REQUIRED` khi tài khoản phải duyệt. Frontend mới gửi header này rõ ràng và xử lý proposal response.

Hỗ trợ create/bulk/auto schedule, update/bulk, swap, nghỉ/dời/bù, delete/restore và mapping. Import dùng bước kiểm tra hiện có ở server để đóng băng dữ liệu trước khi tạo request; API công khai không chấp nhận payload import tự nhận đã kiểm tra. Một yêu cầu tối đa 500 lịch. Các lệnh import cập nhật vẫn bị kiểm tra lại dữ liệu nền và quyền trước apply.

Các thao tác vận hành không phải đề xuất lịch như tạo EVG/phân lớp bị chặn ghi trực tiếp nếu tài khoản đang phải duyệt sửa lịch. Thay đổi đề cương có thể tác động lịch cũng bị chặn cho tài khoản phải duyệt sửa/mapping; không cho đi vòng qua module khác. Các tài khoản không chịu policy vẫn dùng chức năng hiện tại. Worker tiếp tục chỉ xử lý lịch chính thức.

## Notification và UI

Socket.IO dùng namespace `/calendar-approvals`, event `calendar-workflow:changed` và xác thực session/RBAC hiện có. Module socket và hook frontend chỉ phục vụ lịch LMS.

Notification workflow lưu theo người nhận trong transaction nghiệp vụ. Socket kiểm tra trạng thái inbox bền vững, gửi invalidation riêng từng socket người nhận; REST/reconnect/polling khôi phục khi offline. Không lấy MAX(id) đơn lẻ làm bằng chứng giao hàng. Không truyền snapshot lịch qua Socket.

Badge ở từng dòng dùng `rows[].status` của API notification hiện có: truy vấn JOIN với yêu cầu để đọc trạng thái hiện tại, không suy ra từ `event_type` lịch sử. Vì vậy thông báo gửi duyệt cũ vẫn thể hiện Đã duyệt/Đã từ chối/Đã hủy sau xử lý. Mapping nhãn và màu dùng chung giữa Drawer và popup; nhãn ngắn Đã áp dụng dành cho badge. Tiêu đề yêu cầu ổn định theo loại thao tác, tránh mâu thuẫn giữa nội dung gửi duyệt cũ và trạng thái mới. Badge không thay read receipt, bộ lọc hoặc unread count; notification thiếu trạng thái không bị mặc định thành Chờ duyệt. Không thêm API hay migration. Đã kiểm chứng bằng API thật trên database test và trình duyệt desktop/mobile; suite hiện có 51 nhóm integration đạt.

Chuông chỉ hiển thị thông báo lịch LMS. Click dòng mở Drawer, tự lưu Read; không có nút Read riêng trên từng dòng. Header có bulk read thật cho workflow; lỗi API không fake trạng thái. Nội dung đã đọc vẫn còn trong danh sách đầy đủ.

Tạo/sửa draft đơn có form chỉnh đề xuất. Sau reject/conflict, sửa sẽ tạo revision mới và phải gửi lại. Với đề xuất phức tạp theo lô/import, có thể đối chiếu/tạo lại draft từ lệnh đã lưu; muốn thay cấu hình chi tiết hoặc nội dung file thì dùng lại công cụ bulk/import tương ứng rồi gửi yêu cầu mới. Không cung cấp trình sửa JSON nghiệp vụ cho người dùng.

Theo yêu cầu ngày 26/11/2026, đã gỡ webhook, Apps Script, installer/tunnel local, UI và quyền theo dõi thay đổi Google Sheet. Migration `20261126100000_remove_sheet_schedule_changes` xóa bốn bảng `sheet_schedule_*` cùng quyền tương ứng; giữ nguyên migration tạo bảng đã áp dụng để không thay đổi checksum lịch sử. Các bảng phê duyệt, lịch chính thức và chức năng xuất/nhập hiện có không bị xóa.

## Kiểm chứng

- Typecheck backend/frontend và build production frontend.
- Unit test workflow và hồi quy lịch, import, Socket, read receipt.
- Integration dùng database MySQL test riêng, tự tạo/xóa; không sửa dữ liệu lịch ở `livestream_local`, không gọi HMO/Teams/Google/EVG.
- Kiểm tra concurrent approve, stale request, rollback khi audit lỗi sau ghi lịch, reject/revision, tự duyệt, scope bị thu hồi, giả lesson/import, và API Express/JWT thật.
- Kết quả sau khi gỡ Sheet: 423 unit test của suite backend đã qua, gồm kiểm tra Socket gửi đúng từng người, đồng bộ Read và không bỏ lỡ transaction commit khác thứ tự. 23 nhóm kiểm tra tích hợp đã qua trên database test riêng. Build backend và frontend thành công.
- Timestamp notification lưu UTC instant, phân biệt với ngày/giờ lịch theo wall-clock Việt Nam; API kiểm thử xác minh thời điểm nhận không lệch 7 giờ.
- Chrome với API mock ở desktop 1440px và mobile 390px: popup, filter unread, bulk read, diff, approve/reject, cấu hình Role và User, ghi đè từng thao tác và khôi phục kế thừa; không ghi LMS.
- HTTP local: endpoint capabilities trả 401 khi chưa đăng nhập; trang frontend được middleware chuyển đến đăng nhập.

Không tự bật policy cho tài khoản thật và không triển khai production. Cần chọn người gửi/người duyệt cùng phạm vi chương trình để bắt đầu dùng trên local.

## Đối chiếu nghiệp vụ lịch học ngày 26/11/2026

Phê duyệt chỉ trì hoãn thời điểm áp dụng. Khi duyệt, bộ điều phối gọi lại các hàm nghiệp vụ lịch đang có; không dùng bản ghi xem trước để ghi đè trực tiếp bảng lịch. Với thao tác không cần duyệt, API tiếp tục đường xử lý hiện hữu.

Bộ kiểm thử `tests/calendar-approval-parity.fixture.ts` chạy trong database tạm của integration. Với cùng trạng thái ban đầu và payload, đường trực tiếp được chạy rồi rollback; sau đó gửi yêu cầu, xác minh lịch/mapping/hàng đợi chưa đổi, duyệt và đối chiếu dữ liệu nghiệp vụ với kết quả tham chiếu. Bỏ các ID tự tăng và timestamp kỹ thuật khi so sánh, giữ các giá trị ngày/giờ, giáo viên, nội dung, mã định danh nghiệp vụ, mapping và trạng thái hàng đợi.

Đã đối chiếu 22 trường hợp: tạo đơn, Feed, buổi học chung có cờ cho phép, tạo hàng loạt, tự động TopClass/TopUni/ngày nghỉ, sửa đơn với lý do mặc định/lý do nghiệp vụ/tắt thông báo, sửa hàng loạt cấu hình chung/riêng, nghỉ, học bù, dời chuỗi, nghỉ/bù hàng loạt, hoán đổi, xóa, khôi phục, xóa mapping và import cập nhật. Bộ workflow hiện có kiểm tra riêng import tạo mới, chống ghi lịch trước duyệt, chống áp dụng trùng, đối chiếu dữ liệu thay đổi và rollback khi ghi audit lỗi.

Đã khắc phục các sai lệch được bộ đối chiếu phát hiện:

- Cho lớp yêu cầu giữ `cancel_reason` do bộ tạo lịch tự động sinh cho ngày nghỉ.
- Lý do trong hồ sơ phê duyệt không ghi đè `reason`/`change_reason` của lệnh nghiệp vụ hoặc thay nội dung thông báo thời gian mặc định.
- Import cập nhật trực tiếp và sau duyệt dùng chung `applyValidatedCalendarUpdates`, giữ nguyên quy tắc mapping, trigger/hàng đợi HMO và thông báo của đường import hiện hữu.

Kết quả kiểm chứng: build backend thành công, 423 kiểm thử đơn vị và 48 nhóm kiểm tra tích hợp đạt. Đây là phạm vi các trường hợp đã kiểm chứng; không thay thế kiểm thử tải và các tích hợp dịch vụ bên ngoài trên môi trường staging.

## Đồng bộ quyết định giữa nhiều người duyệt

Drawer dùng dữ liệu chi tiết qua SWR, cùng cơ chế invalidation Socket với popup và danh sách yêu cầu. Khi trạng thái hoặc phiên bản đổi, giao diện đóng hộp xác nhận duyệt/từ chối đang mở. Hai nút chỉ xuất hiện với yêu cầu `PENDING` và có quyền tương ứng; tạm khóa khi đang cập nhật dữ liệu. Tự tải lại khi cửa sổ lấy focus và đối chiếu mỗi 10 giây khi Drawer mở để khôi phục khi mất tín hiệu Socket.

Backend giữ khóa yêu cầu và khóa ghi lịch trong cùng giao dịch. Hai người gửi Duyệt/Từ chối đồng thời chỉ có một quyết định được commit; thao tác còn lại nhận HTTP 409 kèm thông tin người đã xử lý. Duyệt lại cùng phiên bản đã thành công vẫn trả kết quả cũ theo cơ chế idempotency, giữ nguyên người duyệt và không áp dụng lịch lần nữa. Frontend tải lại dữ liệu khi thao tác thất bại.

Chi tiết hiển thị người duyệt hoặc người từ chối, thời điểm xử lý theo giờ Việt Nam và lý do nếu có. Tên người xử lý lấy từ audit tại thời điểm quyết định; bản ghi cũ thiếu audit dùng tên tài khoản hiện có. Tận dụng `decided_by`, `decided_at`, `decision_reason` và audit hiện hữu, không thêm bảng hay migration.

Kiểm thử bổ sung dùng hai tài khoản duyệt độc lập gửi đồng thời Duyệt/Từ chối theo cả hai thứ tự, xác nhận chỉ một audit quyết định, lịch chỉ thay đổi nếu bên duyệt thắng và cả hai tài khoản nhìn thấy đúng người xử lý. Tổng cộng 50 nhóm integration đạt, bao gồm 22 trường hợp đối chiếu nghiệp vụ lịch trực tiếp với sau duyệt. Chrome desktop 1440px và mobile 390px kiểm tra Socket cập nhật Drawer đang mở, đóng xác nhận cũ, ẩn nút với trạng thái kết thúc ngay cả khi capability bị cũ, và hiển thị người/thời điểm quyết định.

## Thu hồi yêu cầu đang chờ duyệt để chỉnh sửa

Người gửi có quyền gửi duyệt được dùng `POST /:id/withdraw` với `revision` và `lock_version` khi yêu cầu còn `PENDING`. Sau xác nhận, yêu cầu giữ nguyên ID, chuyển `DRAFT`, tăng phiên bản và khóa phiên bản, xóa thời điểm gửi hiện tại. Snapshot phiên bản đã gửi trong `calendar_approval_revisions` được giữ nguyên; audit `request.withdrawn` ghi nhận việc thu hồi và phiên bản tiếp theo. Thu hồi không ghi lịch chính thức hay hàng đợi đồng bộ. Không thêm schema hoặc migration.

Frontend mở form chỉnh sửa hiện có cho đề xuất đơn. Người gửi lưu bản nháp, kiểm tra rồi gửi duyệt lại; API tạo snapshot phiên bản mới và gửi `request.resubmitted`. Đề xuất hàng loạt/import giữ phạm vi chỉnh sửa của công cụ hiện hữu; bản nháp có thể chỉnh lý do, không cung cấp trình sửa JSON.

Bản nháp chỉ dành cho người tạo. Các người nhận trước đó cùng người duyệt hiện tại nhận invalidation `request.withdrawn`; danh sách yêu cầu duyệt không hiển thị bản nháp. Drawer phiên bản cũ nhận thông báo yêu cầu đã được thu hồi và đóng xác nhận, ẩn nút Duyệt/Từ chối. Sau gửi lại, phải dùng đúng phiên bản mới để duyệt.

Thu hồi và duyệt dùng cùng khóa giao dịch ghi lịch/yêu cầu: nếu thu hồi trước, phiên bản cũ không được áp dụng; nếu duyệt trước, thu hồi bị từ chối và lịch đã duyệt được giữ nguyên. Lỗi audit rollback cả trạng thái, phiên bản và thông báo.

Đã kiểm chứng quyền người gửi, phiên bản cũ, giữ snapshot, rollback lỗi audit, sửa/gửi lại/áp dụng đúng nội dung mới, cả hai thứ tự chạy đồng thời thu hồi/duyệt và endpoint HTTP thật. Tổng 56 nhóm tích hợp và 423 unit test đạt; Chrome desktop/mobile kiểm tra xác nhận thu hồi, mở form sửa, lưu/gửi lại và xử lý thu hồi khi người duyệt đang mở xác nhận. Build frontend/backend đạt.

## Tránh thông báo trùng sau thu hồi và gửi lại

Dropdown và unread count chọn thông báo nghiệp vụ mới nhất theo cặp người nhận/yêu cầu, dùng cùng truy vấn nhóm `MAX(id)`. Sự kiện `request.withdrawn` chỉ phục vụ invalidation Socket và lịch sử, không hiển thị thành thông báo chờ duyệt. Chọn bản ghi mới nhất trước khi lọc chưa đọc để tránh một thông báo cũ chưa đọc xuất hiện lại sau khi đã đọc thông báo mới. Không xóa dữ liệu hoặc tự đánh dấu các bản ghi cũ là đã đọc.

Áp dụng ngay với các thông báo đã tồn tại, không cần migration hay chỉnh dữ liệu local. Khi gửi lại, dropdown có một dòng mới nhất cho yêu cầu đó; khi duyệt/từ chối, dòng được thay bằng kết quả mới nhất. Lịch sử xử lý đầy đủ vẫn nằm ở Drawer. Đã kiểm tra API thật cho hai lần thu hồi/gửi lại liên tiếp, giữ receipt cũ chưa đọc, đọc riêng thông báo mới, lọc chưa đọc, bulk read, số lượng và quyền theo phạm vi. Tổng 57 nhóm kiểm thử tích hợp đạt.

## Popup lý do trước khi gửi duyệt

Các lệnh lịch học phải duyệt trả `409 APPROVAL_REASON_REQUIRED` trước khi tạo yêu cầu nếu chưa có lý do. Client mở popup nhập lý do bắt buộc 1–1000 ký tự, rồi gửi lại cùng payload và Idempotency-Key với header `X-Calendar-Approval-Reason` được mã hóa URI để hỗ trợ tiếng Việt. Thao tác không cần duyệt giữ đường ghi hiện có. Import/cập nhật file dùng cùng cơ chế, giữ nguyên FormData và nội dung file. Xóa nhiều lịch dùng lại lý do đã xác nhận trong cùng đợt thao tác.

Lý do phê duyệt lưu vào hồ sơ, snapshot phiên bản và audit; không thay `reason`/`change_reason` hoặc cờ thông báo trong lệnh nghiệp vụ. Gửi bản nháp từ Drawer cũng mở popup; API submit lưu lý do được xác nhận trong cùng transaction gửi duyệt. Đóng popup không tạo yêu cầu, không báo thành công hoặc báo lỗi, và giữ dữ liệu form. Popup bị hủy khi đổi tài khoản/phiên đăng nhập; Drawer hủy popup nếu phiên bản yêu cầu thay đổi. Không thêm bảng hay migration.

Đã kiểm chứng nhập tiếng Việt, lý do rỗng/quá dài, quyền gửi duyệt, hủy popup, gửi lại bản nháp, body JSON/Multipart và Idempotency-Key không đổi sau bước nhập lý do, giữ lý do nghiệp vụ riêng, cùng các luồng lịch hiện hữu. 424 unit test, 58 nhóm integration trên DB tạm và Chrome desktop/mobile đạt; build frontend/backend đạt.


### Tiêu đề yêu cầu tùy chỉnh khi gửi duyệt
- Popup gửi duyệt gồm tiêu đề (1–255 ký tự) và lý do (1–1000 ký tự). Tiêu đề mặc định theo thao tác, có thể thay đổi trước lần gửi đầu và khi gửi lại sau thu hồi.
- `title` là metadata của yêu cầu, độc lập với loại thao tác và payload lịch. Header `X-Calendar-Approval-Title` mã hóa URI được chuyển thành metadata trước khi tạo yêu cầu; bước challenge trả operation để chọn tiêu đề mặc định. Không thay đổi các hàm tạo/sửa/xóa/import lịch hiện tại.
- Migration `20261126120000_custom_calendar_approval_title` thêm hai cột nullable tại yêu cầu và phiên bản đã gửi. Bản ghi cũ tiếp tục hiển thị tiêu đề theo thao tác, không cần backfill. Idempotency tính cả tiêu đề khi được cung cấp. Tiêu đề phiên bản đã gửi không thay đổi khi thu hồi và gửi lại phiên bản mới.
- Thông báo lấy tiêu đề hiện tại từ yêu cầu qua JOIN; danh sách và drawer dùng cùng tiêu đề tùy chỉnh. Trạng thái, đọc/chưa đọc và phân quyền giữ nguyên.
- Kiểm thử bao phủ tiêu đề rỗng/quá dài/Unicode, truyền header riêng với JSON và file import, metadata không thay thế lý do nghiệp vụ, lưu phiên bản và hiển thị desktop/mobile. Local đã áp dụng riêng migration bổ sung tiêu đề.


### Tên bài trong form đề xuất
- Form chỉnh sửa từ drawer/thông báo và form tạo đề xuất không còn cho nhập trực tiếp tên bài gốc. Tên gốc đọc từ API bài học của chương trình bằng `session_id`; chỉnh sửa tên gốc vẫn thực hiện tại đề cương.
- Tùy chỉnh tên hiển thị bằng tiền tố/hậu tố, có xem trước và giới hạn 400 ký tự. Ghép từ tên gốc thay vì ghép chồng tên lịch cũ. Hai ô tiền tố/hậu tố luôn hiển thị; chỉ gửi `lesson_name` khi người dùng thay đổi chúng; đổi ngày giờ/giáo viên không ghi đè tên hiện tại.
- Không xác định hoặc không tải được bài gốc thì khóa tùy chỉnh tên và giữ nguyên tên; các phần sửa khác vẫn dùng luồng hiện có. Không đổi API, database hay hàm xử lý lịch.
- Browser desktop/mobile đã kiểm tra tên gốc chỉ đọc, ghép cả tiền tố và hậu tố, lưu ngay sau nhập, giữ nguyên tên khi lưu không tùy chỉnh và gửi lại duyệt.

- Phản hồi đề xuất giữ `session_id` như metadata liên kết cùng `id`, kể cả khi trường nghiệp vụ bị lọc theo quyền. Điều này khắc phục form không tìm được bài dù snapshot gốc có mã bài. Đã đọc kiểm chứng trên đề xuất local; không cập nhật lịch hay dữ liệu đề xuất.
- Form chỉnh sửa rộng 640px, giảm khoảng cách, hai ô tiền tố/hậu tố cùng hàng; ngày/giờ và giáo viên/trợ giảng cùng hàng trên desktop. Giới hạn chiều cao phần nội dung để footer luôn truy cập được trên màn hình thấp.


### Không cuộn ngang và thống nhất tiền tố/hậu tố
- Modal đề xuất bỏ phần tràn ngang do gutter của hàng chia cột; giới hạn chiều rộng picker/select, cho nội dung tag xuống dòng, chỉ cuộn dọc khi màn hình thấp.
- `calendarLessonDisplayName` là hàm ghép tên dùng chung với sửa lịch hàng loạt và xem trước lịch: thay `{n}` trong tiền tố/hậu tố, giữ tên gốc và giới hạn 400 ký tự như trước. Quy tắc đánh số từng luồng vẫn giữ nguyên; sửa riêng một buổi dùng thứ tự 1 như cấu hình riêng của sửa lịch hàng loạt.
- Browser desktop/mobile kiểm tra `scrollWidth <= clientWidth` của modal và mẫu `{n}` được lưu đúng; kiểm thử hàm dùng chung kiểm tra nhiều marker, tên gốc chứa `{n}`, khoảng trắng và giới hạn ký tự.
