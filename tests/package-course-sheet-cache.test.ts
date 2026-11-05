import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearPackageCourseSheetCache,
  listPackageCoursesFromSheet,
} from '../src/integrations/package-course-sheet.service';

test('manual reload bypasses cache, shares downloads and preserves old data on failure', async () => {
  const originalFetch = globalThis.fetch;
  const originalTtl = process.env.PACKAGE_COURSE_SHEET_CACHE_TTL_MS;
  let downloads = 0;
  let fail = false;
  let courseId = 'course-1';
  process.env.PACKAGE_COURSE_SHEET_CACHE_TTL_MS = '300000';
  globalThis.fetch = async () => {
    downloads += 1;
    if (fail) throw new Error('Sheet unavailable');
    return new Response(`package_id,course_id\npackage-1,${courseId}\n`);
  };
  clearPackageCourseSheetCache();

  try {
    assert.equal((await listPackageCoursesFromSheet())[0].course_id, 'course-1');
    courseId = 'course-2';
    assert.equal((await listPackageCoursesFromSheet())[0].course_id, 'course-1');
    assert.equal(downloads, 1);

    const refreshed = await Promise.all([
      listPackageCoursesFromSheet(true),
      listPackageCoursesFromSheet(true),
    ]);
    assert.ok(refreshed.every((rows) => rows[0].course_id === 'course-2'));
    assert.equal(downloads, 2);
    assert.equal((await listPackageCoursesFromSheet())[0].course_id, 'course-2');
    assert.equal(downloads, 2);

    fail = true;
    await assert.rejects(listPackageCoursesFromSheet(true), /Sheet unavailable/);
    assert.equal((await listPackageCoursesFromSheet())[0].course_id, 'course-2');
    assert.equal(downloads, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTtl === undefined) delete process.env.PACKAGE_COURSE_SHEET_CACHE_TTL_MS;
    else process.env.PACKAGE_COURSE_SHEET_CACHE_TTL_MS = originalTtl;
    clearPackageCourseSheetCache();
  }
});
