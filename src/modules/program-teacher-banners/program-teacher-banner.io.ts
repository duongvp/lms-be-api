import * as XLSX from 'xlsx';

const normalizedHeader = (value: unknown) => String(value || '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
  .replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

const aliases: Record<string, 'program_code' | 'teacher' | 'banner_url'> = {
  code: 'program_code', 'ma chuong trinh': 'program_code', 'chuong trinh': 'program_code', 'program code': 'program_code',
  teacher: 'teacher', 'giao vien': 'teacher', 'ten giao vien': 'teacher', 'ma giao vien': 'teacher',
  banner: 'banner_url', 'banner url': 'banner_url', 'url banner': 'banner_url',
};

export const parseBannerFile = (buffer: Buffer, filename: string) => {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (!['csv', 'xlsx'].includes(extension || '')) throw new Error('Chỉ hỗ trợ file .csv hoặc .xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', blankrows: false })
    .map((row, index) => {
      const mapped: Record<string, unknown> = {};
      Object.entries(row).forEach(([header, value]) => {
        const key = aliases[normalizedHeader(header)];
        if (key) mapped[key] = value;
      });
      return { row: index + 2, program_code: String(mapped.program_code || '').trim(), teacher: String(mapped.teacher || '').trim(), banner_url: String(mapped.banner_url || '').trim() };
    });
};

export const buildBannerTemplate = () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['code', 'teacher', 'banner_url'],
    ['toan-10-2027', 'Nguyễn Văn A', 'https://example.com/banner.png'],
  ]);
  sheet['!cols'] = [{ wch: 28 }, { wch: 30 }, { wch: 70 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Banner');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

export const buildBannerExport = (rows: Array<{
  program_code: string;
  username: string;
  display_name?: string | null;
  banner_url: string;
  status: number;
}>) => {
  const sheet = XLSX.utils.json_to_sheet(rows.map((row) => ({
    code: row.program_code,
    teacher: row.username,
    teacher_name: row.display_name || '',
    banner_url: row.banner_url,
    status: row.status ? 'Hoạt động' : 'Tắt',
  })), { header: ['code', 'teacher', 'teacher_name', 'banner_url', 'status'] });
  sheet['!cols'] = [{ wch: 28 }, { wch: 30 }, { wch: 30 }, { wch: 70 }, { wch: 14 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Banner');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};
