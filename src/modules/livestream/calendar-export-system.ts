type Program = { system_type: string };

export const resolveCalendarExportSystem = (
  calendar: { code: string; system_type: string | null },
  linkedProgram: Program | undefined,
  candidates: Program[],
) => {
  if (linkedProgram) return linkedProgram.system_type;
  const systems = new Set(candidates.map((row) => row.system_type));
  if (systems.size > 1) throw new Error(`Chương trình ${calendar.code} có đề cương thuộc nhiều hệ. Cần xác định lại trước khi xuất.`);
  return candidates[0]?.system_type || calendar.system_type || 'topclass';
};
