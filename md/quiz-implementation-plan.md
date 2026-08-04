# Kế hoạch triển khai Quiz trên `lms-manage-api`

## 1. Nguyên tắc

- Tài liệu này chỉ là roadmap; chưa cho phép generate code hoặc implement.
- Không thay đổi schema, migration hay dữ liệu database trong roadmap hiện tại.
- Dự án cũ và mới dùng chung database, nên mọi write phải backward-compatible.
- Không copy controller cũ sang dự án mới.
- Mỗi phase kết thúc bằng một checkpoint và **dừng để người dùng review/duyệt**.
- Không bắt đầu phase sau khi chưa có xác nhận.
- Runtime livestream và management API được tách thành hai workstream.

## 2. Kiến trúc mục tiêu

### Workstream A — Management API

Chạy trong `lms-manage-api`, quản lý `quiz_content` và đọc báo cáo từ các bảng Quiz. Đây là scope ưu tiên vì phù hợp kiến trúc và dependency hiện tại.

### Workstream B — Runtime Quiz (chưa cần triển khai trong lần này)

Phục vụ giao bài realtime, làm bài, submit, chấm và trả kết quả. Workstream này hiện nằm ở API cũ và phụ thuộc Redis/Socket.IO. Chỉ chuyển sau khi có thiết kế/authorization riêng.

```text
Phase 0-5: Management API mới, dùng chung DB
                         |
                         v
               compatibility verified
                         |
                         v
Phase 6+: Runtime hardening/migration theo từng flow
```

## 3. Phase 0 — Chốt business contract

### Mục tiêu

Loại bỏ các điểm mơ hồ có thể làm sai dữ liệu dùng chung.

### Việc thực hiện

- Xác nhận semantics `active`, `done`, `disable`.
- Xác nhận `ans_duration` là giây.
- Xác nhận tên và cách chấm type 3.
- Xác nhận score type 1/2 và thang điểm.
- Xác nhận format/sinh `quiz_id`.
- Xác nhận create theo lớp-buổi hay question bank.
- Xác nhận soft delete/restore.
- Xác nhận quyền theo role và ownership lớp học.
- Xác nhận có giữ điểm sao trong báo cáo Quiz không.
- Xác nhận scope chỉ management hay gồm runtime trong tương lai.

### Deliverable

- `quiz-business-contract.md` đã được duyệt.
- Bảng state transition và answer JSON contract.
- Danh sách API được chốt.

### Điều kiện hoàn thành

- Không còn quyết định business quan trọng dựa trên giả định.
- Contract không làm client/runtime cũ đọc sai dữ liệu.

### Checkpoint

**Dừng và gửi người dùng review Phase 0.**

## 4. Phase 1 — Read-only Management API

### Mục tiêu

Tạo nền module mới và chứng minh query/response tương thích trước khi cho phép write.

### Phạm vi dự kiến

- Tạo module theo layers:
  - constants/types;
  - validation;
  - repository;
  - service;
  - controller/routes/index.
- Mount `/api/quizzes`.
- `GET /api/quizzes`:
  - pagination;
  - filter `code`, `learn_number`, type, score type, status, keyword;
  - whitelist sort.
- `GET /api/quizzes/options`.
- `GET /api/quizzes/:quizId`.
- Áp dụng:
  - authentication;
  - `quiz.view`;
  - field-level response filtering;
  - BigInt/Decimal serialization.
- Không expose endpoint student runtime.

### Kiểm thử

- Unit test query validation.
- Unit test answer JSON parser cho cả JSON object và legacy JSON string.
- Integration test auth/permission/field visibility.
- Test pagination/sort/filter và invalid input.
- Snapshot response với ba quiz type.

### Deliverable

- API read-only có test.
- API contract/example response.
- Báo cáo đối chiếu record giữa API cũ và mới trên môi trường được phép.

### Checkpoint

**Dừng và gửi người dùng review Phase 1. Không bật write route.**

## 5. Phase 2 — CRUD content an toàn

### Mục tiêu

Cho phép tạo/sửa/disable/restore câu hỏi với validation ở server.

### Phạm vi dự kiến

- `POST /api/quizzes` với `quiz.create`.
- `PUT /api/quizzes/:quizId` với `quiz.update`.
- `DELETE /api/quizzes/:quizId` với `quiz.delete`, mặc định soft disable.
- `POST /api/quizzes/:quizId/restore` với `quiz.update`.
- `creator` lấy từ authenticated user.
- Enforce field-level edit permission.
- Validate answer schema theo `quiz_type`.
- Validate enum/range/length.
- Không cho đổi `quiz_id` sau create.
- Kiểm tra conflict unique và trả 409.
- Nếu business cho phép, chặn sửa content đang có session active.

### Compatibility guard

- Giữ nguyên JSON shape mà web livestream cũ hiểu.
- Không đổi cách đọc `active/done` trước khi contract được duyệt.
- Không hard delete record đã có submission/session.
- Không ghi vào `quiz_logs` hoặc `quiz_session` trong CRUD content.

### Kiểm thử

- Valid/invalid payload cho từng type.
- Permission action và field-level.
- Duplicate id, not found, disabled/restore.
- Backward compatibility: câu vừa tạo/sửa được API cũ đọc đúng.
- Security test mass assignment.

### Checkpoint

**Dừng và gửi người dùng review Phase 2, gồm mẫu dữ liệu trước/sau.**

## 6. Phase 3 — Reorder, bulk và lifecycle content

### Mục tiêu

Hoàn thiện quản trị danh sách lớn mà không tạo thứ tự trùng hoặc update nhầm nhóm.

### Phạm vi dự kiến

- `PATCH /api/quizzes/reorder`:
  - bắt buộc cùng `code + learn_number`;
  - danh sách đầy đủ hoặc contract partial đã chốt;
  - transaction;
  - temporary index tránh unique/conflict nếu database có constraint tương lai.
- `PATCH /api/quizzes/bulk`:
  - whitelist field;
  - field permission;
  - giới hạn số lượng.
- Chuẩn hóa enable/disable/finalize theo state contract Phase 0.
- Không dùng localStorage làm nguồn authoritative cho trạng thái content.

### Kiểm thử

- Reorder thiếu/thừa/duplicate/cross-group.
- Concurrent reorder.
- Bulk partial failure và transaction rollback.
- Permission trên từng field.

### Checkpoint

**Dừng và gửi người dùng review Phase 3.**

## 7. Phase 4 — Import/export

### Mục tiêu

Cho phép quản lý số lượng lớn với quy trình validate trước khi ghi.

### Phạm vi dự kiến

- `GET /api/quizzes/template?format=xlsx|csv`.
- `GET /api/quizzes/export` cho filter hoặc selected ids.
- `POST /api/quizzes/import` bằng upload memory có size limit.
- Permission `quiz.import`, `quiz.export`.
- Hai bước:
  1. parse + validate toàn file;
  2. chỉ ghi transaction nếu không có lỗi.
- Error trả row, field, message rõ ràng.
- Chế độ `skip/overwrite` chỉ thêm nếu business duyệt.
- Answer JSON trong spreadsheet có format/template dễ dùng, không yêu cầu giáo viên tự viết JSON raw nếu có thể tránh.

### Kiểm thử

- CSV/XLSX, encoding tiếng Việt, formula cell, file sai type/size.
- Duplicate quiz id và duplicate index.
- Mỗi quiz type và nhiều đáp án đúng.
- Import rollback.
- Export-import round trip.

### Checkpoint

**Dừng và gửi người dùng review Phase 4 cùng file mẫu.**

## 8. Phase 5 — Submission history, analytics và grading management

### Mục tiêu

Đọc lịch sử hiệu quả và chỉ thêm mutation điểm khi business rule đã rõ.

### Phạm vi read-only

- `GET /api/quizzes/:quizId/submissions` có pagination/filter.
- `GET /api/quizzes/:quizId/analytics`.
- Chọn latest submission bằng query deterministic (`created_at`, `id`), không load toàn bộ vào memory.
- Phân biệt record quiz với record star trong response/report.
- Không dùng thuật toán `no_ans` legacy nếu không có contract được xác minh.
- Không suy ra attempt/session giả từ timestamp.

### Grading tùy chọn, cần duyệt riêng

- `PATCH /api/quizzes/:quizId/submissions/:answerId/grade`.
- Permission `quiz.grade`.
- Server validate score range và actor.
- Vì schema không có grader/audit/version, phải ghi rõ giới hạn audit hoặc hoãn cho đến khi được phép thay schema.

### Kiểm thử

- Data volume lớn, explain/index review.
- Privacy/permission học sinh.
- Decimal serialization.
- Latest submission tie-break.
- Grade concurrency và invalid score nếu tính năng được duyệt.

### Checkpoint

**Dừng và gửi người dùng review Phase 5. Management API chỉ được coi hoàn tất sau checkpoint này.**

## 9. Phase 6 — Hardening runtime cũ trước migration

### Mục tiêu

Giảm rủi ro bảo mật ngay tại runtime mà chưa chuyển kiến trúc hàng loạt.

### Thứ tự ưu tiên đề xuất

1. Bắt buộc auth cho student endpoints và derive identity/context từ token.
2. Tạo student DTO không chứa đáp án đúng.
3. Server-side grading; bỏ tin score client.
4. Validate session tồn tại, active và chưa hết giờ.
5. Đồng bộ DB/Redis close logic.
6. Idempotency submit trong giới hạn schema.
7. Rate limit và payload limit.
8. Fix query graded/latest và star scope.
9. Bỏ timezone offset thủ công, chuẩn hóa UTC contract.
10. Thêm monitoring queue/backlog/error.

### Ràng buộc

- Đây là thay đổi ở dự án cũ/runtime, ngoài management API mới.
- Cần test với web livestream và kế hoạch rollout/rollback riêng.
- Không bắt đầu chỉ vì Phase 1-5 hoàn thành.

### Checkpoint

**Dừng và xin duyệt từng nhóm security/runtime change trước khi sửa dự án cũ.**

## 10. Phase 7 — Runtime service mới (tùy chọn) (phần này chưa cần làm trong phase này)

### Mục tiêu

Thay flow runtime cũ bằng service authoritative, bền vững và có contract rõ.

### Thiết kế mong muốn

- Server authoritative timer/state/grading.
- Durable scheduled job thay process `setTimeout`.
- Durable queue có ack/retry/dead-letter.
- REST command và realtime event dùng cùng application service/state transition.
- Snapshot câu hỏi khi phát.
- Một active session được enforce server-side.
- Attempt id/idempotency key rõ.
- Autosave có version.
- Result release policy.
- Observability: correlation id, metrics, queue lag, submission failure.

### Blocker với yêu cầu “không đổi schema”

Runtime hoàn chỉnh cần cân nhắc thêm session run/attempt/snapshot/audit fields hoặc tables. Nếu vẫn cấm schema change, Phase 7 chỉ có thể cải thiện một phần và phải chấp nhận các giới hạn đã nêu trong review.

### Checkpoint

**Dừng ở design review trước bất kỳ migration hoặc cutover nào.**

## 11. Phase 8 — Kiểm thử hệ thống và rollout

### Test pyramid

- Unit: validation, answer normalization, grading strategies, state transition.
- Repository integration: MySQL transaction/query/index.
- API integration: auth/RBAC/field-level/error contract.
- Compatibility: old runtime đọc content do API mới ghi.
- E2E: teacher create -> runtime phát -> student submit -> result/report.
- Load: burst submission theo sĩ số/phòng đồng thời.
- Security: answer leakage, identity spoof, score tamper, IDOR, replay, rate limit.
- Failure: Redis down, DB down, worker restart, duplicate request, deploy giữa phiên.

### Rollout

- Feature flag cho write management mới.
- Read comparison/shadow check trước write.
- Canary theo role/lớp.
- Backup/rollback runbook dù không đổi schema.
- Dashboard/error alert trước khi mở rộng.

### Checkpoint

**Dừng để duyệt test evidence và rollout checklist trước production.**

## 12. Thứ tự ưu tiên khuyến nghị

| Ưu tiên | Hạng mục | Lý do |
|---|---|---|
| P0 | Chốt contract/status/unit/type 3 | Tránh ghi dữ liệu sai vào DB dùng chung |
| P0 | Read-only management + RBAC | Rủi ro thấp, tạo nền kiến trúc |
| P0 | Runtime auth + không lộ đáp án + server grading | Rủi ro bảo mật hiện hữu |
| P1 | CRUD content có validation | Đáp ứng quản lý Quiz |
| P1 | Reorder/import/export | Tăng hiệu quả vận hành |
| P1 | Fix durable submission/session | Tránh mất bài và nhận bài muộn |
| P2 | Analytics/manual grade | Cần rule và audit rõ |
| P2 | Autosave/randomization/attempt history | Cần runtime/state model tốt hơn |

## 13. Definition of Done chung cho mỗi phase implement

- Scope đúng tài liệu đã được duyệt.
- Không có migration/schema change ngoài phê duyệt riêng.
- Build/lint/test pass.
- Có test cho happy path, validation, permission và failure path.
- Không lộ đáp án/PII ngoài permission.
- Query có pagination hoặc giới hạn phù hợp.
- Không phá contract runtime cũ.
- Có tài liệu API và giả định còn lại.
- Git diff không chứa thay đổi ngoài scope.
- Có checkpoint report và dừng chờ review.

## 14. Checkpoint hiện tại

Phase phân tích đã hoàn thành với hai deliverable:

- `md/quiz-review.md`
- `md/quiz-implementation-plan.md`

Theo yêu cầu, công việc phải dừng tại đây để người dùng review. Chưa có code, schema, migration hoặc database nào được thay đổi.
