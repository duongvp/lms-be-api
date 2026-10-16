import ApiError from '../../utils/ApiError';

export type CalendarSource = 'livestream' | 'feed';

// Only an omitted field defaults. Explicit null/empty/unknown values are errors.
export const resolveCalendarSource = (value: unknown = undefined): CalendarSource => {
  if (value === undefined) return 'livestream';
  if (value === 'livestream' || value === 'feed') return value;
  throw new ApiError('calendar_source chỉ chấp nhận livestream hoặc feed', 400);
};

// Source is a property of the program code, never a stored calendar field.
export const calendarSourceFromCode = (code: unknown): CalendarSource =>
  /^feed-/i.test(String(code || '')) ? 'feed' : 'livestream';

export const assertCalendarSourceUnchanged = (calendar: any, input: any) => {
  if (input?.calendar_source === undefined) return;
  if (resolveCalendarSource(input.calendar_source) !== calendarSourceFromCode(calendar?.code)) {
    throw new ApiError('Nguồn lịch được xác định bởi mã chương trình; không thể đổi nguồn trên lịch', 400);
  }
};

export const assertLivestreamCalendarSource = (value: unknown) => {
  resolveCalendarSource(value);
};
