import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduledExportDate, createScheduledExportCheck } from '../src/modules/livestream/calendar-sheet-export.worker';
import { startScheduledSheetExportJob, startSheetExportJob, getSheetExportJob } from '../src/integrations/google-sheet-export-job';

test('05:00 Vietnam uses the next calendar day relative to UTC', () => {
  assert.equal(scheduledExportDate(new Date('2026-09-17T22:00:00Z')), '2026-09-18');
  assert.equal(scheduledExportDate(new Date('2026-09-17T22:00:59Z')), '2026-09-18');
  assert.equal(scheduledExportDate(new Date('2026-09-17T21:59:59Z')), null);
  assert.equal(scheduledExportDate(new Date('2026-09-17T22:01:00Z')), null);
});

test('starts once daily and retries a busy sheet within the scheduled minute', () => {
  let date = new Date('2026-09-17T22:00:00Z');
  let attempts = 0;
  let errors = 0;
  const check = createScheduledExportCheck(() => { if (++attempts === 1) throw new Error('busy'); }, () => date, () => errors++);
  check(); check(); check();
  assert.equal(attempts, 2);
  assert.equal(errors, 1);
  date = new Date('2026-09-18T22:00:00Z');
  check(); check();
  assert.equal(attempts, 3);
});

test('scheduled export shares manual locks and has no user owner', async () => {
  let release!: (result: { sheetUrl: string; sheetCount: number; rowCount: number }) => void;
  const done = new Promise<void>(resolve => {
    const job = startScheduledSheetExportJob(['cron-topclass', 'cron-topuni'], () => new Promise(resolveTask => { release = resolveTask; }), result => {
      assert.equal(result.status, 'completed'); resolve();
    });
    assert.throws(() => getSheetExportJob(job.jobId, 1));
    assert.throws(() => startSheetExportJob(1, 'cron-topuni', async () => ({ sheetUrl: '', sheetCount: 0, rowCount: 0 })), /đang được xuất/);
  });
  await Promise.resolve();
  await Promise.resolve();
  release({ sheetUrl: 'test', sheetCount: 2, rowCount: 10 });
  await done;
});
