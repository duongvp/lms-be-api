import crypto from 'node:crypto';
import ApiError from '../../utils/ApiError';

export const OPERATIONS = ['create', 'update', 'delete', 'cancel', 'reschedule', 'swap', 'restore', 'mapping', 'import'] as const;
export type ApprovalOperation = typeof OPERATIONS[number];
export type Command = { action: 'create' | 'createBulk' | 'update' | 'updateBulk' | 'delete' | 'cancel' | 'reschedule' | 'swap' | 'restore' | 'mapping' | 'auto' | 'import'; id?: number; payload: any };
export const PERMISSIONS = {
  submit: 'calendar.submit_approval', approve: 'calendar.approve', reject: 'calendar.reject',
  review: 'calendar.approval.view', history: 'calendar.history.view', manage: 'calendar.workflow.manage',
};
export const commandOperation = (command: Command): ApprovalOperation => {
  const mode=command.payload?.update_mode||command.payload?.mode;
  const cancelModes=['cancel','cancel_only','no_makeup','no_make_up'];
  if (command.action==='updateBulk' && command.payload?.operation==='cancel') return 'cancel';
  if (command.action==='updateBulk' && command.payload?.operation==='makeup') return 'reschedule';
  if (command.action==='update' && command.payload?.update_mode && mode!=='current') return cancelModes.includes(mode)?'cancel':'reschedule';
  if (command.action==='reschedule' && cancelModes.includes(mode||'cancel')) return 'cancel';
  return ({ create: 'create', createBulk: 'create', auto: 'create', update: 'update', updateBulk: 'update', delete: 'delete', cancel: 'cancel', reschedule: 'reschedule', swap: 'swap', restore: 'restore', mapping: 'mapping', import:'import' } as const)[command.action];
};
export function affectedOperations(c:Command):ApprovalOperation[] {
  const ops=new Set<ApprovalOperation>([commandOperation(c)]);
  const payload=JSON.stringify(c.payload||{});
  if(payload.includes('package_lesson_mappings')) ops.add('mapping');
  return [...ops];
}
export const operationPermission = (operation: ApprovalOperation) => operation === 'create' ? 'calendar.create' : ['delete','restore'].includes(operation) ? 'calendar.delete' : operation === 'import' ? 'calendar.import' : 'calendar.update';
export function jsonValue<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_k, v) => typeof v === 'bigint' ? String(v) : v)); }
export function canonical(value: any): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(typeof value === 'bigint' ? String(value) : value);
}
export const fingerprint = (value: any) => crypto.createHash('sha256').update(canonical(value)).digest('hex');
export const positiveId = (value: unknown) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError('ID không hợp lệ', 400);
  return id;
};
export const positiveBigId = (value: unknown) => {
  if (!/^\d{1,19}$/.test(String(value)) || BigInt(String(value)) < 1n) throw new ApiError('ID không hợp lệ', 400);
  return BigInt(String(value));
};
export function assertOperations(value: unknown): ApprovalOperation[] {
  if (!Array.isArray(value) || value.some(v => !OPERATIONS.includes(v))) throw new ApiError('Loại yêu cầu cần duyệt không hợp lệ',400);
  return [...new Set(value)] as ApprovalOperation[];
}
