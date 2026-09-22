import { randomUUID } from 'node:crypto';
import ApiError from '../utils/ApiError';

type ExportResult = { sheetUrl: string; sheetCount: number; rowCount: number; destinations?: Array<{ systemType: string; sheetUrl: string; sheetCount: number; rowCount: number }> };
type ExportJob = {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  result?: ExportResult;
  error?: string;
};
const jobs = new Map<string, { owner: number | null; targets: string[]; updatedAt: number; job: ExportJob }>();
const retentionMs = 60 * 60 * 1000;

const startJob = (owner: number | null, target: string | string[], task: (progress: (percent: number, message: string) => void) => Promise<ExportResult>, onFinished?: (job: ExportJob) => void) => {
  const targets = Array.isArray(target) ? target : [target];
  for (const [id, entry] of jobs) {
    if (entry.job.status !== 'running' && Date.now() - entry.updatedAt > retentionMs) jobs.delete(id);
    else if (entry.job.status === 'running' && entry.targets.some((item) => targets.includes(item))) throw new ApiError('Sheet này đang được xuất dữ liệu. Vui lòng chờ lượt xuất hoàn tất.', 409);
  }
  if ([...jobs.values()].filter((entry) => entry.job.status === 'running').length >= 5) throw new ApiError('Hệ thống đang xử lý các lượt xuất khác. Vui lòng thử lại sau.', 409);
  const job: ExportJob = { jobId: randomUUID(), status: 'running', progress: 0, message: 'Đang chuẩn bị dữ liệu chương trình…' };
  const entry = { owner, targets, updatedAt: Date.now(), job };
  jobs.set(job.jobId, entry);
  void Promise.resolve().then(() => task((progress, message) => {
    job.progress = Math.max(job.progress, Math.min(99, progress));
    job.message = message;
    entry.updatedAt = Date.now();
  })).then((result) => {
    job.result = result;
    job.status = 'completed';
    job.progress = 100;
    job.message = 'Xuất Google Sheets thành công.';
  }).catch((error: unknown) => {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Không thể xuất Google Sheets.';
    job.message = job.error;
  }).finally(() => { entry.updatedAt = Date.now(); onFinished?.({ ...job }); });
  return { ...job };
};

export const getSheetExportJob = (jobId: string, owner: number) => {
  const entry = jobs.get(jobId);
  if (!entry || entry.owner !== owner) throw new ApiError('Không tìm thấy lượt xuất Google Sheets. Nếu backend vừa khởi động lại, hãy kiểm tra sheet trước khi xuất lại.', 404);
  return { ...entry.job };
};

export const startSheetExportJob = (owner: number, target: string | string[], task: (progress: (percent: number, message: string) => void) => Promise<ExportResult>) => {
  if (!Number.isInteger(owner) || owner <= 0) throw new ApiError('Phiên đăng nhập không hợp lệ.', 401);
  return startJob(owner, target, task);
};

export const startScheduledSheetExportJob = (target: string[], task: (progress: (percent: number, message: string) => void) => Promise<ExportResult>, onFinished: (job: ExportJob) => void) => startJob(null, target, task, onFinished);
