import assert from 'node:assert/strict';
import test from 'node:test';
import { getCalendarEvgStatuses } from '../src/modules/livestream/evg-status';
import { buildCalendarRoomClassId } from '../src/modules/livestream/calendar-user-sync.service';

const calendar = { id: 4836, code: 'feed-tsa-1-2027', learn_number: 1, start_time: new Date('2026-10-14T21:00:00Z'), evg_stream: '123', channel_name: 'feed-stream', lesson_link: 'stream-key' };
const rooms = () => Array.from({ length: 25 }, (_, index) => ({
  code: calendar.code, learn_number: 1, room_id: index + 1,
  stream_key: 'https://evg-stream.hocmai.net/live/alias/playlist.m3u8', banner_url: 'https://example.test/banner.jpg',
  class_id: buildCalendarRoomClassId(calendar.code, calendar.start_time, 1, index + 1),
}));
const config = { code: calendar.code, learn_number: 1, config: { evg: 'evg', stream_key: calendar.lesson_link } };
const client = (streamRows: any[], configs: any[] = [config]) => ({ stream: { findMany: async () => streamRows }, room_config: { findMany: async () => configs } }) as any;

test('calendar có ID EVG nhưng bảng stream trống phải hiện chưa hoàn tất', async () => {
  const statuses = await getCalendarEvgStatuses(client([]), [calendar]);
  assert.deepEqual(statuses.get(calendar.id), { evg_provisioned: false, evg_provisioning_status: 'incomplete' });
});

test('chỉ hiện đã tạo khi có đủ 25 phòng và room_config đúng khóa stream', async () => {
  const statuses = await getCalendarEvgStatuses(client(rooms()), [calendar]);
  assert.deepEqual(statuses.get(calendar.id), { evg_provisioned: true, evg_provisioning_status: 'ready' });
  assert.equal((await getCalendarEvgStatuses(client(rooms().slice(0, 24)), [calendar])).get(calendar.id)?.evg_provisioned, false);
  assert.equal((await getCalendarEvgStatuses(client(rooms(), []), [calendar])).get(calendar.id)?.evg_provisioned, false);
  assert.equal((await getCalendarEvgStatuses(client(rooms(), [{ ...config, config: { evg: 'evg', stream_key: 'other-key' } }]), [calendar])).get(calendar.id)?.evg_provisioned, false);
});

test('phòng của buổi khác, thiếu banner hoặc sai link phát không xác nhận thành công', async () => {
  for (const patch of [{ class_id: 'other-session' }, { banner_url: '' }, { stream_key: 'not-hls' }]) {
    assert.equal((await getCalendarEvgStatuses(client(rooms().map((room) => ({ ...room, ...patch }))), [calendar])).get(calendar.id)?.evg_provisioned, false);
  }
});

test('không có EVG hoặc ID là giá trị rỗng/0 thì không hiển thị đã tạo', async () => {
  for (const evg_stream of [null, '', '0', 'null', 'false']) {
    const statuses = await getCalendarEvgStatuses(client(rooms()), [{ ...calendar, evg_stream }]);
    assert.deepEqual(statuses.get(calendar.id), { evg_provisioned: false, evg_provisioning_status: 'not_created' });
  }
});

test('hai buổi cùng mã và bài chỉ xác nhận buổi khớp class_id thực tế', async () => {
  const otherDate = { ...calendar, id: 4837, start_time: new Date('2026-10-15T21:00:00Z') };
  const statuses = await getCalendarEvgStatuses(client(rooms()), [calendar, otherDate]);
  assert.equal(statuses.get(calendar.id)?.evg_provisioned, true);
  assert.equal(statuses.get(otherDate.id)?.evg_provisioned, false);
});
