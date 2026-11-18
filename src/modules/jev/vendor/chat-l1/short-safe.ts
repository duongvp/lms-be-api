/**
 * Danh sách tương tác lớp học để bỏ riêng bước gọi L2 trong tương lai.
 * Không cấp quyền gửi, không miễn flood/lặp/cấm chat và không chứa đáp án tự do.
 * Thêm câu phải cập nhật phiên bản và test; không tạo regex hoặc danh sách theo user.
 */
export const CHAT_L1_SHORT_SAFE_POLICY = Object.freeze({
  version: 'short-safe-vi-v3',
  phrases: Object.freeze([
    // Nhóm chào hỏi & thưa gửi cơ bản
    'dạ', 'dạ vâng', 'dạ vâng ạ', 'vâng', 'vâng ạ', 'vâng thầy ạ', 'vâng cô ạ',
    'dạ thầy', 'dạ cô', 'dạ thầy ạ', 'dạ cô ạ', 'thầy ơi', 'thầy ơi ạ', 'cô ơi', 'cô ơi ạ',
    'chào thầy', 'chào cô', 'chào thầy cô', 'chào thầy ạ', 'chào cô ạ', 'chào thầy cô ạ',
    'chào cả lớp', 'chào cả lớp ạ', 'em chào cả lớp', 'em chào cả lớp ạ',
    'em chào thầy', 'em chào cô', 'em chào thầy cô',
    'em chào thầy ạ', 'em chào cô ạ', 'em chào thầy cô ạ',
    'hello thầy', 'hello cô', 'hi thầy', 'hi cô',

    // Nhóm xưng "con" (học sinh tiểu học, THCS, miền Nam)
    'con hiểu rồi', 'con hiểu rồi ạ', 'con cảm ơn', 'con cảm ơn ạ',
    'con cảm ơn thầy', 'con cảm ơn cô', 'con cảm ơn thầy ạ', 'con cảm ơn cô ạ',
    'con chào thầy', 'con chào cô', 'con chào thầy cô',
    'con chào thầy ạ', 'con chào cô ạ', 'con chào thầy cô ạ',
    'dạ con hiểu rồi', 'dạ con hiểu rồi ạ',

    // Nhóm cảm ơn & hiểu bài
    'em hiểu rồi', 'em hiểu rồi ạ', 'hiểu rồi ạ', 'hiểu bài rồi ạ',
    'em hiểu bài rồi ạ', 'con hiểu bài rồi ạ',
    'em cảm ơn', 'em cảm ơn ạ',
    'em cảm ơn thầy', 'em cảm ơn cô', 'em cảm ơn thầy ạ', 'em cảm ơn cô ạ',
    'cảm ơn thầy', 'cảm ơn cô', 'cảm ơn thầy ạ', 'cảm ơn cô ạ',
    'thanks thầy ạ', 'thanks cô ạ',

    // Nhóm xác nhận nghe rõ & nhìn thấy
    'rõ ạ', 'nghe rõ ạ', 'đã rõ ạ', 'em nghe rõ ạ', 'con nghe rõ ạ',
    'rõ rồi ạ', 'em rõ rồi ạ', 'con rõ rồi ạ',
    'nghe rõ rồi ạ', 'em nghe rõ rồi ạ', 'con nghe rõ rồi ạ',
    'thấy rõ ạ', 'em thấy rõ ạ', 'con thấy rõ ạ',
    'thấy rồi ạ', 'em thấy rồi ạ', 'con thấy rồi ạ',
    'rất rõ ạ', 'nghe tốt ạ',

    // Nhóm tiến độ làm bài & ghi chép
    'xong rồi ạ', 'xong rồi', 'em xong rồi', 'con xong rồi',
    'em xong rồi ạ', 'con xong rồi ạ',
    'chép xong rồi ạ', 'đã xong ạ',
    'em chép xong rồi ạ', 'con chép xong rồi ạ',
    'em làm xong rồi ạ', 'con làm xong rồi ạ',
    'chưa ạ', 'chưa xong', 'chưa xong ạ',
    'em chưa xong', 'con chưa xong', 'em chưa xong ạ', 'con chưa xong ạ',
    'em chưa chép xong ạ', 'con chưa chép xong ạ',
    'đợi em tí ạ', 'đợi em xíu ạ', 'đợi con xíu ạ',
    'đợi em một chút ạ', 'đợi con một chút ạ',

    // Nhóm điểm danh & sẵn sàng
    'có ạ', 'dạ có', 'dạ có ạ', 'em có ạ', 'con có ạ',
    'có mặt ạ', 'em có mặt ạ', 'con có mặt ạ',
    'sẵn sàng', 'sẵn sàng ạ', 'sẵn sàng rồi ạ',
    'em sẵn sàng ạ', 'con sẵn sàng ạ',
    'em sẵn sàng rồi ạ', 'con sẵn sàng rồi ạ',

    // Nhóm đồng ý & biến thể Ok
    'ok', 'ok ạ', 'oke', 'oke ạ', 'oki', 'oki ạ', 'okie', 'okie ạ', 'okay', 'okay ạ',
    'đúng rồi', 'đúng rồi ạ', 'chuẩn rồi ạ', 'chính xác ạ',

    // Nhóm khen bài giảng & nhận xét tích cực
    'dễ hiểu ạ', 'dễ hiểu lắm ạ', 'dễ hiểu quá ạ',
    'thầy giảng hay quá ạ', 'cô giảng hay quá ạ',
    'thầy giảng dễ hiểu quá ạ', 'cô giảng dễ hiểu quá ạ',

    // Nhóm chào tạm biệt & chúc cuối buổi học
    'em chào thầy em nghỉ ạ', 'em chào cô em nghỉ ạ',
    'con chào thầy con nghỉ ạ', 'con chào cô con nghỉ ạ',
    'chúc thầy ngủ ngon', 'chúc thầy ngủ ngon ạ', 'chúc cô ngủ ngon', 'chúc cô ngủ ngon ạ',
    'chúc thầy buổi tối vui vẻ ạ', 'chúc cô buổi tối vui vẻ ạ',
    'chúc cả lớp ngủ ngon', 'chúc cả lớp ngủ ngon ạ',
    'hẹn gặp lại thầy ạ', 'hẹn gặp lại cô ạ',
    'bye thầy', 'bye thầy ạ', 'bye cô', 'bye cô ạ', 'bye bye thầy cô',

    // Nhóm xin phép lịch sự
    'em xin phép đi vệ sinh ạ', 'con xin phép đi vệ sinh ạ',
    'em xin phép uống nước ạ', 'con xin phép uống nước ạ',
    'em xin phép ra ngoài một chút ạ', 'con xin phép ra ngoài một chút ạ',
    'em xin phép vào muộn ạ', 'con xin phép vào muộn ạ',

    // Nhóm đại diện tập thể (chúng em / chúng con)
    'chúng em cảm ơn thầy ạ', 'chúng em cảm ơn cô ạ',
    'chúng em chào thầy ạ', 'chúng em chào cô ạ',
    'chúng con cảm ơn thầy ạ', 'chúng con cảm ơn cô ạ',
    'chúng em hiểu rồi ạ', 'chúng con hiểu rồi ạ',
  ]),
});

const defaultPhrases = new Set<string>(CHAT_L1_SHORT_SAFE_POLICY.phrases);
let activePhrases = defaultPhrases;

export function setActiveShortSafePhrases(custom?: ReadonlySet<string> | readonly string[] | null): void {
  if (!custom) {
    activePhrases = defaultPhrases;
    return;
  }
  const set = custom instanceof Set ? custom : new Set(custom);
  // Set rỗng là cấu hình chủ động không miễn L2; chỉ null/undefined mới dùng mặc định.
  activePhrases = new Set(set);
}

export function getActiveShortSafePhrases(): ReadonlySet<string> {
  return activePhrases;
}

/**
 * Khớp TOÀN BỘ câu sau NFC/hoa-thường/khoảng trắng ASCII và tối đa 2 dấu .! cuối.
 * Không dùng matchText đã gỡ ký tự ẩn hoặc đổi full-width: phần bất thường vẫn đi L2.
 * Không bỏ dấu tiếng Việt, không tách lấy từ đầu, không bỏ emoji/link/phần đuôi khác.
 */
export function isChatL1ShortSafe(raw: string, phrasesOverride?: ReadonlySet<string>): boolean {
  if (raw.length > 64 || /[\p{Cc}\p{Cf}]/u.test(raw)) return false;
  const canonical = raw.normalize('NFC').toLowerCase().trim()
    .replace(/ {2,}/gu, ' ').replace(/[.!]{1,2}$/u, '').trim();
  const targetPhrases = phrasesOverride ?? activePhrases;
  return targetPhrases.has(canonical);
}
