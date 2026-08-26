import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPublicGoogleSheetCsvUrls } from '../src/integrations/google-sheet-csv';

test('tạo URL CSV cho link chia sẻ thông thường và giữ gid trong query', () => {
  const urls = buildPublicGoogleSheetCsvUrls(
    'https://docs.google.com/spreadsheets/d/sheet_123/edit?gid=456#gid=456'
  );

  assert.equal(urls[0], 'https://docs.google.com/spreadsheets/d/sheet_123/export?format=csv&gid=456');
  assert.match(urls[1], /\/gviz\/tq\?/);
});

test('đọc gid trong hash của link Google Sheets', () => {
  const urls = buildPublicGoogleSheetCsvUrls(
    'https://docs.google.com/spreadsheets/d/sheet_123/edit#gid=789'
  );

  assert.match(urls[0], /gid=789$/);
});

test('hỗ trợ link có đoạn user index', () => {
  const urls = buildPublicGoogleSheetCsvUrls(
    'https://docs.google.com/spreadsheets/u/1/d/sheet_123/edit#gid=12'
  );

  assert.match(urls[0], /\/d\/sheet_123\/export\?format=csv&gid=12$/);
});

test('hỗ trợ link publish to web thay vì hiểu nhầm spreadsheet id là e', () => {
  const urls = buildPublicGoogleSheetCsvUrls(
    'https://docs.google.com/spreadsheets/d/e/2PACX-published_id/pubhtml?gid=321&single=true'
  );

  assert.deepEqual(urls, [
    'https://docs.google.com/spreadsheets/d/e/2PACX-published_id/pub?output=csv&single=true&gid=321',
  ]);
});

test('từ chối URL không phải Google Sheets', () => {
  assert.throws(
    () => buildPublicGoogleSheetCsvUrls('https://example.com/sheet.csv'),
    /docs\.google\.com/
  );
});
