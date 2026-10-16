import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchCalendarRegisteredStudents } from '../src/modules/livestream/calendar-student-sync.service';

const withApi = async (reply: (page: number) => unknown, check: (pages: number[]) => Promise<void>) => {
  const original = { fetch: global.fetch, url: process.env.HOCMAI_LIVE_USER_API_URL, token: process.env.HOCMAI_LIVE_USER_API_TOKEN };
  const pages: number[] = [];
  try {
    process.env.HOCMAI_LIVE_USER_API_URL = 'https://example.invalid/users?packages[0]=stale&packages[1]=stale2';
    process.env.HOCMAI_LIVE_USER_API_TOKEN = 'fixture';
    global.fetch = async (input) => {
      const url = new URL(String(input));
      assert.deepEqual([...url.searchParams].filter(([key]) => key.startsWith('packages[')), [['packages[0]', '9318']]);
      assert.equal(url.searchParams.get('registed_at'), '14/10/2026');
      const page = Number(url.searchParams.get('page'));
      pages.push(page);
      return new Response(JSON.stringify(reply(page)));
    };
    await check(pages);
  } finally {
    global.fetch = original.fetch;
    for (const [key, value] of Object.entries({ HOCMAI_LIVE_USER_API_URL: original.url, HOCMAI_LIVE_USER_API_TOKEN: original.token })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
};

const rows = Array.from({length: 1104}, (_, index) => ({userid: String(index + 1), username: String(index).padStart(10, '0'), product_id: '9318'}));
const reply = (page: number) => ({status: 'success', current_page: String(page), per_page: '100', last_page: 11,
  total: '1104', data: rows.slice((page - 1) * 100, page * 100)});

test('1104 API rows fetch all 12 pages even if last_page is understated; stale configured packages are removed', async () => {
  await withApi(reply, async (pages) => {
    const result = await fetchCalendarRegisteredStudents(['9318'], '14/10/2026');
    assert.equal(result.length, 1104);
    assert.equal(new Set(result.map(row => row.username)).size, 1104);
    assert.deepEqual(pages, Array.from({length: 12}, (_, index) => index + 1));
    assert.equal(result[0].username, '0000000000');
  });
});

test('repeated API page is rejected instead of claiming a complete sync', async () => {
  await withApi(page => reply(page === 12 ? 11 : page), async () => {
    await assert.rejects(fetchCalendarRegisteredStudents(['9318'], '14/10/2026'), /trả sai trang/);
  });
});

test('missing or excess API rows are rejected', async () => {
  for (const difference of [-1, 1]) {
    await withApi(page => {
      const payload = reply(page);
      if (page === 12) payload.data = difference < 0 ? payload.data.slice(1) : [...payload.data, rows[0]];
      return payload;
    }, async () => {
      await assert.rejects(fetchCalendarRegisteredStudents(['9318'], '14/10/2026'), /số dòng không khớp/);
    });
  }
});

test('invalid pagination cannot silently skip the remaining pages', async () => {
  await withApi(() => ({...reply(1), per_page: 'invalid'}), async () => {
    await assert.rejects(fetchCalendarRegisteredStudents(['9318'], '14/10/2026'), /phân trang không hợp lệ/);
  });
});
