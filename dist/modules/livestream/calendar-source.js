"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertLivestreamCalendarSource = exports.assertCalendarSourceUnchanged = exports.calendarSourceFromCode = exports.resolveCalendarSource = void 0;
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
// Only an omitted field defaults. Explicit null/empty/unknown values are errors.
const resolveCalendarSource = (value = undefined) => {
    if (value === undefined)
        return 'livestream';
    if (value === 'livestream' || value === 'feed')
        return value;
    throw new ApiError_1.default('calendar_source chỉ chấp nhận livestream hoặc feed', 400);
};
exports.resolveCalendarSource = resolveCalendarSource;
// Source is a property of the program code, never a stored calendar field.
const calendarSourceFromCode = (code) => /^feed-/i.test(String(code || '')) ? 'feed' : 'livestream';
exports.calendarSourceFromCode = calendarSourceFromCode;
const assertCalendarSourceUnchanged = (calendar, input) => {
    if (input?.calendar_source === undefined)
        return;
    if ((0, exports.resolveCalendarSource)(input.calendar_source) !== (0, exports.calendarSourceFromCode)(calendar?.code)) {
        throw new ApiError_1.default('Nguồn lịch được xác định bởi mã chương trình; không thể đổi nguồn trên lịch', 400);
    }
};
exports.assertCalendarSourceUnchanged = assertCalendarSourceUnchanged;
const assertLivestreamCalendarSource = (value) => {
    (0, exports.resolveCalendarSource)(value);
};
exports.assertLivestreamCalendarSource = assertLivestreamCalendarSource;
