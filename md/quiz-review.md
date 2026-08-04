# Review module Quiz của hệ thống cũ

## 1. Phạm vi và phương pháp

Tài liệu này phân tích code hiện có, không sửa code, không thay đổi schema và không tạo migration.

Nguồn đã đọc:

- `apps/api/src/routes/quiz.routes.ts`
- `apps/api/src/controllers/quiz.controller.ts`
- `apps/api/src/middleware/roleGuard.ts`
- `apps/api/src/lib/redis.ts`
- `apps/api/src/lib/batchWorker.ts`
- `apps/api/src/lib/bullmq.ts`
- các phần Quiz/Socket.IO trong `apps/api/src/index.ts`
- các model Quiz trong `apps/api/prisma/schema.prisma`
- `apps/api/src/controllers/calendar.controller.ts`
- toàn bộ UI/hook/store Quiz liên quan trong `apps/web/src`
- schema, RBAC, conventions của dự án mới `lms-manage-api`
- lịch sử Git liên quan đến Quiz để nhận biết các flow legacy đã bị thay đổi

Đường dẫn tham khảo `https://topclass.hocmai.vn/nhaplieugiaovien?...` không thể được tải bằng phiên duyệt tự động. Code tại workspace cũng không chứa source của trang này. Vì vậy, các nhận định về màn nhập liệu ngoài module cũ được đánh dấu là giả định, không coi là business rule đã xác minh.

Không thể kiểm tra dữ liệu production vì kết nối database từ môi trường phân tích không khả dụng. Phân tích dữ liệu và trạng thái dựa trên schema cùng code đang chạy.

## 2. Tóm tắt điều hành

Module Quiz cũ là một hệ thống câu hỏi tương tác trong lớp livestream, không phải một engine bài kiểm tra đầy đủ. Nó có hai nhóm trách nhiệm đang bị trộn trong cùng module:

1. Quản trị nội dung câu hỏi: đọc danh sách, sửa, vô hiệu hóa và kích hoạt lại câu hỏi.
2. Runtime lớp học: giáo viên phát một câu hỏi có thời hạn, học sinh trả lời, hệ thống cập nhật thống kê trực tiếp, giáo viên thu hồi/kết thúc/trả điểm và xem bảng xếp hạng.

Module hỗ trợ ba loại câu hỏi:

- `quiz_type = 1`: trắc nghiệm, có thể có nhiều đáp án đúng.
- `quiz_type = 2`: điền từ/điền chỗ trống.
- `quiz_type = 3`: câu trả lời dạng văn bản, UI gọi là tự luận nhưng thực tế đang chấm tự động bằng so khớp đáp án ngắn.

Hai cách tính điểm:

- `score_type = 1`: đúng toàn bộ thì được 1 điểm.
- `score_type = 2`: cộng điểm theo từng ý/đáp án đúng.

Các hạn chế lớn nhất:

- Server gửi cả đáp án đúng cho học sinh và tin điểm do client gửi lên.
- Các API học sinh quan trọng không yêu cầu xác thực.
- Không có API tạo câu hỏi trong module cũ; nguồn tạo dữ liệu nằm ngoài code được cung cấp.
- Trạng thái content, trạng thái phiên chạy và event trả điểm không tạo thành một state machine nhất quán.
- Timer dùng `setTimeout` trong process, không bền khi restart hoặc chạy nhiều instance.
- Submission được đẩy vào Redis rồi trả thành công trước khi ghi database.
- Không có attempt/session identity đủ mạnh để phân biệt các lần phát lại cùng một `quiz_id`.
- Query bảng điểm phức tạp, khó chứng minh đúng và có nguy cơ chậm theo cấp số lớn.

## 3. Kiến trúc hiện tại

### 3.1 Thành phần

| Thành phần | Vai trò |
|---|---|
| `quiz.routes.ts` | Khai báo 17 REST endpoint, chia route công khai và route teacher |
| `quiz.controller.ts` | Chứa toàn bộ validation, business logic, query, cache, queue và phát Socket.IO |
| Prisma | Đọc/ghi `quiz_content`, `quiz_logs`, `quiz_session` |
| Raw SQL qua Prisma | Ghi `quiz_session_logs`, tính điểm, leaderboard, history |
| Redis | Cache trạng thái phiên và làm queue submission |
| `batchWorker.ts` | Rút batch submission khỏi Redis, ghi `quiz_logs` |
| Socket.IO | Relay giao câu hỏi, thu hồi, kết thúc, trả kết quả và live intent |
| Zustand/client UI | Giữ phần lớn state runtime, timer, chấm điểm và trạng thái đã giao |
| `roleGuard.ts` | Bảo vệ một phần route teacher theo role |

Không có service, repository, validator, constants hoặc enum nghiệp vụ riêng cho Quiz. Controller gần 800 dòng vừa xử lý HTTP, business rule, persistence, cache và realtime.

### 3.2 Bảng dữ liệu

#### `quiz_content`

Lưu nội dung câu hỏi:

- `quiz_id`: mã nghiệp vụ, unique toàn bảng.
- `code`, `learn_number`: khóa lớp/buổi học.
- `quiz_type`: loại câu hỏi 1/2/3.
- `quiz_name`: nội dung câu hỏi.
- `ans`: JSON đáp án và cờ đáp án đúng.
- `score_type`: cách tính điểm 1/2.
- `ans_duration`: thời lượng; code/UI sử dụng **giây**.
- `quiz_status`: `active | disable | done`.
- `quiz_index`: thứ tự câu hỏi.
- `creator`, timestamps.

Lưu ý: seed RBAC dự án mới đang ghi nhãn `ans_duration` là phút, trái với code cũ và UI đang dùng giây.

#### `quiz_logs`

Mỗi dòng là một submission hoặc một record thưởng sao:

- `ans_id`: idempotency key tự tạo ở client/API, unique.
- khóa ngữ cảnh: `quiz_id`, `code`, `learn_number`, `class_id`.
- học sinh: `username`, `name`.
- `ans_info`: JSON đáp án; record thưởng sao cũng dùng cột này với marker chứa `star`.
- `score`: điểm do client gửi hoặc điểm sao.
- `duration`, `is_latest`, `created_at`.

`is_latest` có index nhưng code hiện không cập nhật và gần như không sử dụng.

#### `quiz_session`

Đại diện câu hỏi đang/chủ động chạy:

- unique `(code, learn_number, quiz_id)`.
- `quiz_end_time`.
- `quiz_status`: số `1` đang chạy, `0` đã đóng.

Do unique chứa `quiz_id`, phát lại cùng một câu hỏi sẽ update phiên cũ thay vì tạo một attempt/session mới.

#### `quiz_session_logs`

Event log chung cho hành động runtime. Code xác minh được:

- `action = 2`: thu hồi hoặc kết thúc sớm.
- `action = 5`: trả điểm/chấm xong.
- `action = 6`: gia hạn giờ kết thúc lớp từ Calendar, không phải hành động Quiz.

Ý nghĩa các action khác không có constants hoặc tài liệu trong code. Không nên tự suy đoán.

## 4. Định dạng đáp án và cách chấm hiện tại

### 4.1 Trắc nghiệm (`quiz_type = 1`)

Định dạng tương thích hiện tại:

```json
[
  { "A": false, "text": "Đáp án A" },
  { "B": true, "text": "Đáp án B" }
]
```

Rule hiện có:

- Có thể có nhiều option đúng.
- UI giới hạn số lựa chọn bằng số option có cờ đúng.
- `score_type = 1`: tập lựa chọn phải khớp chính xác tập đáp án đúng, được 1 điểm.
- `score_type = 2`: mỗi lựa chọn đúng được 1 điểm; lựa chọn sai không bị trừ.
- Server không tự chấm lại.

### 4.2 Điền từ (`quiz_type = 2`)

Định dạng nội dung:

```json
[
  { "placeholder": "Chỗ trống 1", "text": "đáp án 1; đáp án thay thế", "A": true }
]
```

Rule hiện có:

- Chuẩn hóa `trim`, lowercase và Unicode NFC.
- Một ô có thể có nhiều đáp án chấp nhận, phân tách bằng `;` hoặc dấu phẩy không nằm giữa hai chữ số.
- `1,5` và `1.5` được coi là cùng số.
- `score_type = 1`: tất cả ô đúng thì được 1 điểm.
- `score_type = 2`: mỗi ô đúng được 1 điểm.
- Khi phát câu hỏi, placeholder rỗng được UI tạm gán `Chỗ trống N`; thay đổi này không được lưu lại database.

### 4.3 Tự luận/văn bản (`quiz_type = 3`)

Định dạng hiện tại là mảng một phần tử có `text` làm đáp án chuẩn.

Rule hiện có:

- Dùng cùng thuật toán so khớp với điền từ.
- Khớp thì 1 điểm, không khớp thì 0.
- Không có API chấm tay mặc dù RBAC mới đã có permission `quiz.grade`.

Vì vậy tên “tự luận” gây hiểu lầm. Hành vi thực tế gần với “câu trả lời ngắn”.

## 5. Business flow hiện tại

### 5.1 Tạo Quiz

Không tồn tại flow tạo trong module API cũ:

- Không có route/controller `create`.
- Không có lệnh `quiz_content.create`, `INSERT quiz_content` hoặc import content trong code đã đọc.
- UI livestream chỉ đọc và sửa câu hỏi có sẵn.

Giả định cần xác minh: câu hỏi được tạo bởi trang nhập liệu giáo viên ở hệ thống khác. Không đủ bằng chứng để mô tả validation, cách sinh `quiz_id`, trạng thái mặc định hoặc quyền tạo của hệ thống đó.

### 5.2 Cập nhật Quiz

Luồng:

```text
QuizEditModal
  -> POST /api/quiz/update + teacher token
  -> authenticate -> authorize(teacher)
  -> updateQuiz controller
  -> quiz_content.updateMany(where quiz_id)
  -> trả success
  -> UI tải lại danh sách
```

Rule/UI validation:

- Tên câu hỏi bắt buộc ở UI.
- Trắc nghiệm cần ít nhất 2 lựa chọn và ít nhất 1 đáp án đúng.
- UI cho sửa loại, cách chấm, thời lượng và đáp án.
- UI luôn gửi `quiz_status = done`.
- Không cho mở modal sửa nếu câu hỏi đang active trong local store.

Server chỉ bắt buộc `id`; không xác minh các rule còn lại, không kiểm tra ownership `code/learn_number`, không whitelist status/type/score type và không dùng optimistic locking.

### 5.3 Publish nội dung Quiz

Không có flow publish content rõ ràng.

- `quiz_status` có `active`, `done`, `disable` nhưng `getQuestions` trả cả `active` và `done`.
- UI chỉ lọc `disable`.
- Update và activate đều đặt `done`.
- Không có endpoint chuyển trạng thái content sang `active` theo nghĩa publish.

Trong runtime có event `publish-results`, nhưng đây là **trả kết quả cho học sinh**, không phải publish nội dung câu hỏi.

### 5.4 Lấy danh sách

`GET /api/quiz/questions?code&learn_number`:

- `code` và `learn_number` đều optional.
- Sắp theo `quiz_index`, rồi `id`.
- Không phân trang.
- Không auth.
- Trả toàn bộ record, bao gồm JSON chứa đáp án đúng và metadata creator.
- UI tự bỏ record có `quiz_status = disable`.

### 5.5 Xem chi tiết

Không có endpoint detail riêng. UI dùng object từ list để preview và edit.

### 5.6 Giao/phát câu hỏi

Luồng giáo viên:

1. Chọn câu hỏi và thời gian từ 1 đến 3600 giây ở UI.
2. UI đếm ngược 12 giây, có thể hủy.
3. UI chặn phát nếu local store đang có câu active hoặc câu trước chưa được đánh dấu trả điểm.
4. `POST /api/quiz/session` upsert `quiz_session`, set status 1 và end time.
5. API set Redis `quiz_status_{code}_{learn}_{quiz}` = `1`, TTL bằng duration + 60 giây.
6. API tạo `setTimeout` để set cache/DB status 0 khi hết giờ.
7. UI emit `send-question` cho từng room.
8. Socket server kiểm tra role teacher và relay `new-question` tới room.
9. UI teacher lưu active state và danh sách đã giao trong Zustand/localStorage.

Trạng thái “đã giao” của danh sách chỉ nằm ở localStorage trong 3 giờ, không phải dữ liệu authoritative.

### 5.7 Học sinh nhận và làm bài

Học sinh nhận câu hỏi theo hai đường:

- Realtime: Socket event `new-question`.
- Restore sau refresh/reconnect: `GET /api/quiz/active?code&learn_number`.

Store học sinh:

- Tính `timeRemaining` ưu tiên từ server.
- Nếu không có, tự tính từ `quiz_end_time`.
- Giữ đáp án trong component state, không lưu server.
- Mỗi lần chọn, emit `student-quiz-action/select` để teacher xem intent realtime.

Server Socket chuyển live intent đến room teacher nhưng không xác thực payload học sinh, không persistence và không rate limit.

### 5.8 Lưu tạm/autosave

Không có.

- Lựa chọn đang làm chỉ tồn tại ở React state.
- Live intent chỉ tồn tại trong memory của teacher UI.
- Refresh trước khi nộp làm mất bài đang làm.

### 5.9 Submit

Luồng:

1. Client tự tính điểm và tạo answer payload.
2. Client gọi công khai `POST /api/quiz/saveanswer` với identity học sinh, score, duration và class context.
3. API kiểm tra cache trạng thái; nếu cache miss thì chỉ kiểm tra `quiz_session.quiz_status`.
4. API tạo `ans_id` từ timestamp + quiz + user.
5. API trừ thủ công 7 giờ khỏi thời gian submission.
6. API `RPUSH` payload vào Redis queue; nếu Redis lỗi mới ghi DB trực tiếp.
7. API emit `leaderboard-update-ping` đến teacher room và trả success ngay.
8. Batch worker mỗi chu kỳ `LPOP` nhiều item và `createMany` vào `quiz_logs`.

UI tự submit khi timer về 0 nếu chưa confirm. Tuy nhiên nếu đáp án là mảng rỗng, API từ chối; current UI không tạo marker `no_ans` mà query leaderboard legacy lại phụ thuộc marker `"no_ans"`.

### 5.10 Thu hồi và kết thúc sớm

Thu hồi:

- Teacher emit `recall-question`.
- Học sinh reset hoàn toàn popup.
- UI gọi session log `action = 2`.
- API session log đặt Redis/DB session status 0.

Kết thúc & chấm:

- UI lần lượt emit `end-question-early`, rồi `publish-results`.
- Hai lời gọi session log được phát: `action = 2`, sau đó `action = 5`.
- Học sinh được lock input rồi nhận màn hình kết quả.
- Teacher store reset active state.

Các REST log call không được await trong flow Socket nên có thể lệch thứ tự hoặc thất bại độc lập với event realtime.

### 5.11 Chấm điểm

Chấm tự động hoàn toàn ở client học sinh trước submit. Server lưu `score` client gửi lên và không đối chiếu `quiz_content.ans`.

Không có:

- chấm tay tự luận;
- sửa điểm;
- audit người chấm;
- rubric;
- partial score cấu hình theo trọng số;
- server-side grading strategy.

`action = 5` chỉ đánh dấu “đã trả điểm”, không thực hiện chấm.

### 5.12 Xem kết quả và restore

- Teacher nhận submission realtime qua Socket ping.
- Teacher refresh thì gọi `/quiz/studentanswers`, lấy submission mới nhất theo học sinh.
- Student refresh thì gọi `/quiz/active`, sau đó `/quiz/lastsubmission`.
- Khi teacher publish, student hiển thị điểm đã lưu local và tự đóng sau 3 giây.
- `correctAnswers` trong Socket publish luôn là mảng rỗng vì caller không truyền.

### 5.13 Lịch sử và thống kê

Các khả năng hiện có:

- thống kê realtime số đã nộp, đúng/sai, lựa chọn đang chọn;
- chi tiết đáp án từng học sinh;
- tỷ lệ đáp án;
- toàn bộ submission hoặc latest submission;
- history theo quiz đã có submission;
- tổng điểm/bảng xếp hạng theo lớp-buổi;
- cộng điểm thưởng sao được lưu chung trong `quiz_logs`.

Không có analytics ổn định theo attempt/session, phân phối thời gian, độ khó, discrimination, export hoặc dashboard lịch sử dài hạn.

## 6. Danh sách API

Base path: `/api`.

| Method | Endpoint | Auth hiện tại | Mục đích |
|---|---|---|---|
| GET | `/quiz/questions` | Không | Danh sách câu hỏi theo lớp/buổi; filter optional |
| GET | `/quiz/active` | Không | Lấy câu hỏi đang chạy và thời gian còn lại |
| POST | `/quiz/saveanswer` | Không | Nộp đáp án học sinh |
| GET | `/quiz/leaderboard` | Không | BXH theo `class_id`, code, buổi |
| GET | `/quiz/lastsubmission` | Không | Submission gần nhất của học sinh cho quiz được suy ra |
| POST | `/quiz/latestungraded` | Không | Biến thể của last submission |
| POST | `/quiz/update` | Teacher | Sửa content |
| POST | `/quiz/logs` | Teacher | Bulk insert quiz logs legacy |
| POST | `/quiz/scoresbyclass` | Teacher | Tổng điểm theo code/buổi |
| POST | `/quiz/session` | Teacher | Tạo/mở phiên câu hỏi |
| POST | `/quiz/statusoff` | Teacher | Đóng phiên trong DB |
| GET | `/quiz/studentanswers` | Teacher | Latest submission mỗi học sinh |
| POST | `/quiz/sessionlogs` | Teacher | Ghi event action |
| POST | `/quiz/disable` | Teacher | Vô hiệu hóa content |
| POST | `/quiz/activate` | Teacher | Đặt content thành `done` |
| GET | `/quiz/allstudentanswers` | Teacher | Tất cả submission của quiz |
| GET | `/quiz/history` | Teacher | Câu hỏi đã làm và answer history |

### Socket event

| Hướng | Event | Vai trò |
|---|---|---|
| Teacher -> server | `send-question` | Phát câu hỏi |
| Server -> student room | `new-question` | Nhận câu hỏi |
| Teacher -> server | `recall-question` | Thu hồi |
| Server -> student room | `question-recalled` | Reset câu hỏi |
| Teacher -> server | `end-question-early` | Dừng làm bài |
| Server -> student room | `question-ended-early` | Lock input |
| Teacher -> server | `publish-results` | Trả kết quả |
| Server -> student room | `results-published` | Hiển thị kết quả |
| Student -> server | `student-quiz-action` | Gửi lựa chọn tạm thời |
| Server -> teacher room | `live-quiz-action` | Thống kê intent |
| REST controller -> teacher room | `leaderboard-update-ping` | Báo submission mới |

## 7. Dependency và coupling

### 7.1 Dependency trực tiếp

- Express request/response.
- Prisma/MySQL.
- Redis/ioredis.
- Socket.IO gắn qua `req.app.get('io')`.
- JWT/session service và `teacher_profiles` cho role teacher.
- Web client để thực hiện grading, timer, validation và state transition.

### 7.2 Module Quiz gọi sang

- Auth/session: xác thực teacher REST và Socket.
- Teacher profile: suy ra role trong fallback auth.
- Room/class Socket: broadcast tới các classroom room.
- Chat/leaderboard UI: teacher room và điểm thưởng sao dùng chung `quiz_logs`.

### 7.3 Module gọi ngược lại Quiz

- `SessionInitializer` restore active quiz và submission.
- `useLiveChat` nhận các event runtime.
- `useTeacherLiveChat` phát câu hỏi và ghi session action.
- Calendar `updateEndTime` ghi `action = 6` vào `quiz_session_logs`.
- Tính năng tặng sao ghi record vào `quiz_logs`, làm leaderboard Quiz phải hiểu marker `star`.
- `batchWorker` xử lý submission Quiz cùng chat và star queue.

Calendar và star reward dùng bảng Quiz như bảng log chung là coupling không đúng ranh giới domain.

## 8. Luồng dữ liệu chi tiết

### 8.1 Quản trị content

```text
HTTP request
  -> quiz.routes
  -> roleGuard (chỉ một số route)
  -> quiz.controller
  -> Prisma model trực tiếp
  -> MySQL
  -> JSON response
```

Không có service/repository/validator nên business rule không có lớp tái sử dụng và khó unit test.

### 8.2 Giao câu hỏi

```text
Teacher UI
  -> REST /quiz/session
  -> MySQL quiz_session + Redis status + process setTimeout
  -> Teacher Socket send-question
  -> Socket server role check
  -> classroom rooms
  -> Student Zustand store/UI
```

REST và Socket là hai transaction độc lập. Có thể session đã mở nhưng Socket không phát, hoặc Socket phát trong khi session REST thất bại nếu caller thay đổi.

### 8.3 Nộp bài

```text
Student UI
  -> client-side grading
  -> public REST /quiz/saveanswer
  -> Redis status/DB fallback
  -> Redis list queue
  -> immediate success + Socket ping teacher
  -> periodic batch worker
  -> quiz_logs
```

Teacher có thể thấy submission qua ping trước khi submission xuất hiện trong DB/API history.

### 8.4 Trả kết quả

```text
Teacher UI
  -> Socket end-question-early
  -> REST sessionlogs(action=2)
  -> Socket publish-results
  -> REST sessionlogs(action=5)
  -> student popup/local score
```

Không có transaction hoặc idempotency cho flow nhiều bước này.

## 9. Business rules đã xác minh

1. Câu hỏi thuộc `code + learn_number` và có `quiz_index` để sắp thứ tự.
2. Một `quiz_id` là unique toàn database.
3. UI hỗ trợ ba quiz type 1/2/3.
4. UI hỗ trợ score type 1/2.
5. Thời lượng runtime dùng giây; UI giới hạn 1..3600 giây.
6. Tại một thời điểm UI teacher chỉ cho một câu active.
7. Muốn giao câu mới, UI yêu cầu câu trước đã kết thúc/trả điểm.
8. Teacher có 12 giây đếm ngược trước khi phát và có thể hủy.
9. Câu hỏi bị `disable` không hiển thị trong teacher list.
10. Trắc nghiệm cần tối thiểu 2 lựa chọn và tối thiểu 1 đáp án đúng ở UI.
11. Trắc nghiệm score type 1 yêu cầu đúng toàn bộ; type 2 cộng theo option đúng.
12. Điền từ score type 1 yêu cầu đúng mọi ô; type 2 cộng theo ô đúng.
13. Điền từ chấp nhận nhiều đáp án qua dấu `;` hoặc dấu phẩy an toàn.
14. So khớp text bỏ khoảng trắng đầu/cuối, không phân biệt hoa thường và normalize NFC.
15. Số thập phân dấu phẩy và dấu chấm được coi tương đương.
16. Hết giờ, UI tự submit nếu chưa nộp.
17. Học sinh có thể restore trạng thái active sau refresh.
18. Thu hồi/kết thúc/trả điểm đóng `quiz_session`.
19. Bảng điểm chỉ tính quiz có event action 5 theo ý định của query.
20. Điểm thưởng sao được cộng vào tổng điểm cùng điểm quiz.

Các rule 6, 7, 9 và 10 chủ yếu được enforce ở UI, không phải server.

## 10. Điểm mạnh nên giữ

- Phân tách rõ content (`quiz_content`), submission (`quiz_logs`) và runtime state (`quiz_session`) ở mức bảng.
- Có index theo `code`, `learn_number`, `quiz_id`, `created_at` cho các query chính.
- Upsert session tránh duplicate row cho cùng khóa hiện tại.
- Có cache fallback: Redis lỗi thì vẫn thử DB hoặc ghi submission trực tiếp.
- Batch write giảm tải database khi nhiều học sinh nộp đồng thời.
- Có restore flow khi teacher/student refresh.
- Có realtime thống kê và feedback trực quan cho teacher.
- UI hỗ trợ nhiều đáp án đúng, partial score và nhiều đáp án chấp nhận cho điền từ.
- Có Unicode normalization và xử lý số thập phân Việt Nam.
- Route teacher và Socket teacher đã có lớp kiểm tra role cơ bản.
- Có `skipDuplicates` để giảm lỗi duplicate submission id.
- Schema và RBAC dự án mới đã nhận diện module Quiz, action permission và field-level permission.

## 11. Điểm yếu thiết kế

### 11.1 Business logic nằm ở client

- Client biết toàn bộ đáp án đúng.
- Client tự tính score.
- Client quyết định identity, duration, class context và score gửi lên.
- Guard một câu active và đã trả điểm nằm trong Zustand/localStorage.

Server không phải nguồn sự thật cho grading hoặc state transition.

### 11.2 Controller quá nhiều trách nhiệm

Controller trực tiếp làm validation, normalize, query, cache, queue, timer, Socket và response. Không có service/repository/domain types nên logic trùng, khó test và khó thay thế từng hạ tầng.

### 11.3 State model không đầy đủ

Ba state system khác nhau không đồng bộ:

- `quiz_content.quiz_status`: active/done/disable.
- `quiz_session.quiz_status`: 1/0.
- `quiz_session_logs.action`: magic numbers.

Không có attempt/session run id, grading status, publish-result status hoặc state transition atomic.

### 11.4 Compatibility debt

- `ans` và `ans_info` là JSON nhưng code lúc coi là object, lúc coi là JSON string.
- `ans_duration` bị gọi là phút trong RBAC seed nhưng là giây ở runtime.
- `quiz_type = 3` tên tự luận nhưng chấm exact answer.
- `active` và `done` không có semantics nhất quán.
- `saveQuizLogs`, `latestungraded`, `QuizOverlay`, `useQuizStore` và BullMQ worker có dấu hiệu legacy/duplicate.

### 11.5 Hiệu năng và độ bền

- Leaderboard dùng nhiều correlated `COUNT(*)` cho mỗi submission.
- List/history không phân trang.
- `getStudentAnswers` đọc toàn bộ log rồi deduplicate trong memory.
- `setTimeout` không sống qua restart/deploy.
- Redis list dùng `LPOP` trước khi DB commit; process crash giữa hai bước có thể mất dữ liệu.
- Không có dead-letter queue, retry count hoặc monitoring backlog.
- API trả success trước durability.

## 12. Bug và rủi ro tiềm ẩn

Chỉ ghi nhận, không sửa trong phase này.

### Critical

1. **Lộ đáp án đúng:** `/quiz/questions` và `/quiz/active` công khai, trả nguyên `ans` có cờ đúng cho học sinh.
2. **Gian lận điểm:** `/quiz/saveanswer` công khai và tin `student`, `score`, `duration`, `class_id` do client gửi.
3. **Giả mạo học sinh:** Socket `student-quiz-action` không kiểm tra role/identity/context, có thể spoof live intent.
4. **Nộp ngoài phiên:** cache miss + không tìm thấy session vẫn được chấp nhận; session status 1 nhưng end time đã qua cũng có thể được chấp nhận.
5. **Timer không bền:** restart process làm mất timeout; DB có thể giữ status 1 và nhận bài muộn.

### High

6. **`lastsubmission` suy luận sai quiz:** endpoint bỏ qua `quiz_id` caller gửi và chọn session log mới nhất có từng dòng `action != 5`.
7. **Quiz đã chấm vẫn có thể bị coi chưa chấm:** flow kết thúc ghi action 2 rồi 5; query `action != 5` vẫn tìm thấy action 2 cũ của cùng quiz.
8. **Nhiều session active:** DB cho phép nhiều `quiz_id` cùng `code/learn_number` status 1; chỉ UI ngăn và API active chọn id mới nhất.
9. **Race REST/Socket/log:** mở phiên, relay câu hỏi, đóng phiên và publish kết quả không atomic.
10. **Mất submission khi worker chết:** queue item bị `LPOP` trước ghi DB; rollback chỉ chạy khi bắt được DB exception.
11. **Read-after-write không nhất quán:** teacher nhận ping và client nhận success trước khi DB có row.
12. **`ans_id` có thể va chạm:** dùng `Date.now()` với quiz/user; bulk legacy còn nối chuỗi không delimiter.
13. **Timezone hard-code:** cộng/trừ 7 giờ thủ công và heuristic `> 3 giờ` dễ sai theo config DB/server hoặc dữ liệu dài hơn 3 giờ.
14. **Không kiểm tra ownership:** teacher role có thể thao tác quiz của code/buổi khác; token context không được đối chiếu.

### Medium

15. `quizStatusOff` chỉ update DB, không đồng bộ Redis cache.
16. Redis key active có TTL; khi TTL hết nhưng DB chưa đóng, fallback có thể tiếp tục nhận bài.
17. `duration` âm/không hợp lệ chưa được validate server; `quiz_end_time` invalid cũng chưa bị chặn rõ.
18. `updateQuiz` nhận arbitrary enum/value và update theo `quiz_id` mà không kiểm tra payload.
19. `getQuestions` không filter mặc định; bỏ query có thể dump toàn bộ question bank.
20. `/quiz/leaderboard` công khai làm lộ tên và điểm học sinh.
21. Union điểm sao trong leaderboard không filter `class_id`, có thể cộng sao từ class khác có cùng code/buổi.
22. Group theo `username, name` có thể tách một học sinh thành nhiều dòng nếu đổi display name.
23. `is_latest` không được duy trì; schema/index không mang lại hiệu quả.
24. Query history dựng `IN ('${quizIds}')` bằng string interpolation từ DB thay vì placeholders.
25. `JSON.parse(row.ans_info)` phụ thuộc JSON column đang chứa JSON string; nếu chứa object hợp lệ có thể làm mất record khỏi response.
26. `ansStr` được tạo nhưng không dùng, cho thấy contract JSON chưa rõ.
27. UI auto-submit đáp án rỗng bị API từ chối, trong khi query legacy chờ marker `"no_ans"`.
28. `correctAnswers` khi publish không được caller truyền, nên result event không mang đáp án chuẩn.
29. Teacher restore đánh dấu `isCorrect` bằng `score > 0`, sai với partial score chưa đạt full correctness.
30. Content `active/done` đều được phát; disable/activate không phải state machine publish thực sự.
31. Thông báo “chấm tự luận ở Lịch sử” không khớp code hiện tại vì không có API chấm tay.
32. Calendar ghi action 6 vào `quiz_session_logs`, làm log domain bị nhiễu và có thể ảnh hưởng query “action != 5”.

## 13. Tính năng còn thiếu

- CRUD tạo/detail đúng nghĩa và delete/restore có audit.
- Search, filter, pagination và sort server-side.
- Bulk update, reorder an toàn, duplicate quiz.
- Import/export và template.
- Question bank tái sử dụng giữa lớp/buổi.
- Versioning/snapshot câu hỏi khi phát.
- Server-side grading.
- Manual grading, rubric và điều chỉnh điểm.
- Autosave/draft answer.
- Attempt history rõ ràng và idempotent submit.
- Random question/answer, seed có thể tái lập.
- Passing score, max attempts, review mode.
- Partial score theo trọng số.
- Timer authoritative, grace period cấu hình.
- Anti-cheating, rate limit, audit và anomaly detection.
- Result release policy và answer visibility policy.
- Analytics theo question/session/attempt.
- Durable queue, retry, dead-letter và observability.
- API versioning và contract/OpenAPI.
- Unit/integration/load/security tests.

## 14. Đề xuất thiết kế tốt hơn, tương thích database hiện tại

### 14.1 Tách hai bounded context

#### A. Quiz Management trong dự án mới

Phạm vi phù hợp ngay:

- CRUD `quiz_content`.
- list/detail/filter/pagination/reorder.
- enable/disable theo status hiện có.
- import/export/template.
- xem submission/history/report read-only.
- chấm/sửa điểm có permission `quiz.grade` nếu business xác nhận.
- RBAC action-level và field-level theo convention dự án mới.

#### B. Quiz Runtime trong lớp livestream

Hiện phụ thuộc Socket.IO, Redis, room identity và batch worker của API cũ. Không nên copy nguyên vào management API mới. Runtime cần một phase riêng để thiết kế lại auth, server-side grading, durable state và compatibility với web livestream.

### 14.2 Kiến trúc module mới

```text
quiz.routes
  -> authMiddleware.authenticate
  -> authorize(permission)
  -> authorizeFields(module=quiz)
  -> quiz.controller
  -> quiz.validation
  -> quiz.service
  -> quiz.repository
  -> Prisma/MySQL hiện tại
```

Các file dự kiến khi được phép implement:

- `quiz.constants.ts`: type, score type, status và giới hạn.
- `quiz.types.ts`: request/response/domain types.
- `quiz.validation.ts`: parse và validate input/query/answer JSON.
- `quiz.repository.ts`: persistence/query thuần.
- `quiz.service.ts`: business rule và transaction boundary.
- `quiz.controller.ts`: HTTP mapping mỏng.
- `quiz.routes.ts`, `index.ts`.
- `quiz.io.ts` cho import/export nếu phase đó được duyệt.

### 14.3 API management đề xuất

Theo convention plural của dự án mới, base path nên là `/api/quizzes`:

| Method | Endpoint | Permission | Ý nghĩa |
|---|---|---|---|
| GET | `/` | `quiz.view` | List có pagination/filter/sort |
| GET | `/options` | `quiz.view` | Enum/type/status options |
| GET | `/export` | `quiz.export` | Export filtered/selected |
| GET | `/template` | `quiz.import` | Template import |
| POST | `/import` | `quiz.import` | Validate toàn file rồi import transaction |
| PATCH | `/reorder` | `quiz.update` | Sắp thứ tự trong đúng code/buổi |
| PATCH | `/bulk` | `quiz.update` | Bulk update field được phép |
| GET | `/:quizId` | `quiz.view` | Detail content |
| POST | `/` | `quiz.create` | Tạo content |
| PUT | `/:quizId` | `quiz.update` | Cập nhật content |
| DELETE | `/:quizId` | `quiz.delete` | Soft disable để tương thích |
| POST | `/:quizId/restore` | `quiz.update` | Khôi phục về trạng thái enabled đã thống nhất |
| GET | `/:quizId/submissions` | `quiz.view` hoặc permission riêng | Submission có pagination |
| GET | `/:quizId/analytics` | `quiz.view` | Thống kê read-only |
| PATCH | `/:quizId/submissions/:answerId/grade` | `quiz.grade` | Chấm/sửa điểm nếu được duyệt |

Route static phải khai báo trước `/:quizId`.

Legacy `/api/quiz/*` nên được giữ ở runtime API cũ trong giai đoạn đầu. Không đổi contract đang phục vụ lớp học chỉ vì management API mới dùng REST chuẩn hơn.

### 14.4 Validation đề xuất

- `code`: trim, bắt buộc, giới hạn 50 ký tự.
- `learn_number`: integer dương.
- `quiz_id`: server sinh khi create; unique; client không được overwrite.
- `quiz_name`: trim, bắt buộc, tối đa 500.
- `quiz_type`: chỉ 1/2/3.
- `score_type`: chỉ 1/2; với type 3 cần business xác nhận.
- `ans_duration`: integer 1..3600 **giây**.
- `quiz_index`: integer không âm.
- `quiz_status`: chỉ enum DB.
- MCQ: ít nhất 2 option, text không rỗng, key duy nhất, ít nhất 1 đúng.
- Fill: ít nhất 1 item; đáp án chuẩn không rỗng; placeholder được normalize.
- Type 3: answer text/rubric theo quyết định nghiệp vụ.
- Không nhận field hệ thống như `creator`, timestamps từ client.

### 14.5 Quyền và dữ liệu nhạy cảm

- List/detail cho management có thể trả đáp án đúng vì chỉ dành cho người có `quiz.view` phù hợp.
- Student-facing API tuyệt đối không dùng DTO management; phải loại cờ đáp án đúng.
- Creator lấy từ `req.user.username`, không lấy body.
- Field-level visible/editable áp dụng cả response lẫn write.
- Teacher cần được giới hạn theo lớp/buổi được phân công; RBAC role đơn thuần chưa đủ.
- Audit mutation nên dùng log riêng; nếu không đổi schema, ít nhất structured application log với actor/request id.

### 14.6 Compatibility với schema hiện tại

Có thể cải thiện management mà không đổi bảng:

- giữ nguyên shape JSON đáp án A/B/...;
- dùng `quiz_id` string hiện có;
- soft delete bằng `quiz_status = disable`;
- transaction reorder bằng temporary index an toàn;
- query submission qua index hiện tại;
- serialize BigInt/Decimal theo convention dự án mới.

Không thể giải quyết hoàn chỉnh các vấn đề sau nếu tuyệt đối không đổi schema:

- phân biệt nhiều lần phát cùng một `quiz_id`;
- attempt id và idempotency chuẩn;
- snapshot/version câu hỏi tại thời điểm phát;
- grading/release state machine đầy đủ;
- foreign key/domain integrity;
- audit mutation bền vững.

Các giới hạn này cần được ghi rõ, không nên giả vờ giải quyết bằng suy luận timestamp.

## 15. Các quyết định cần người dùng xác nhận trước implementation

1. `quiz_status = active` và `done` có ý nghĩa nghiệp vụ chính xác là gì? Hiện code coi cả hai là enabled.
2. `ans_duration` thống nhất là giây hay phút? Code thực tế chỉ ra giây; seed đang ghi phút.
3. Type 3 là “trả lời ngắn tự động” hay “tự luận chấm tay”?
4. Điểm type 2 là mỗi ý 1 điểm hay tổng câu vẫn phải chuẩn hóa về một thang điểm?
5. Có cho phép nhiều đáp án đúng ở MCQ không? Code hiện cho phép.
6. Có được phát lại cùng một `quiz_id` nhiều lần và mỗi lần có lịch sử độc lập không?
7. `quiz_id` mới phải theo format legacy nào? Code không cho biết nguồn sinh id.
8. Create Quiz có gắn trực tiếp với một `code + learn_number`, hay cần question bank dùng chung?
9. Delete là soft disable hay xóa cứng khi chưa từng có submission?
10. Scope dự án mới chỉ quản lý `quiz_content`, hay phải dần thay cả runtime livestream?
11. Ai được xem đáp án đúng, submission, tên và điểm học sinh?
12. Điểm thưởng sao có tiếp tục nằm trong `quiz_logs` và cộng vào leaderboard Quiz không?

## 16. Kết luận

Logic cũ có giá trị ở trải nghiệm realtime và khả năng chịu tải burst qua Redis, nhưng không an toàn để copy sang dự án mới. Hướng tốt nhất là:

1. Xây Quiz Management sạch trong backend mới, dùng database hiện tại và RBAC sẵn có.
2. Giữ runtime cũ hoạt động trong giai đoạn đầu.
3. Chuẩn hóa contract/status/answer schema và test compatibility.
4. Chỉ sau đó mới thay runtime theo từng flow, ưu tiên server-side grading, auth và durable session.

Mọi business rule chưa được code chứng minh đã được nêu dưới dạng câu hỏi/giả định thay vì tự quyết định.
