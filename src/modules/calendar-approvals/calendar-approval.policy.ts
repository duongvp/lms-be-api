import {resolveModuleApprovalPolicy} from '../approval-policy/approval-policy.service';
import ApiError from '../../utils/ApiError';
import { OPERATIONS, type ApprovalOperation } from './calendar-approval.types';

export type PolicyValue = 'REQUIRE' | 'SKIP';
export type UserPolicyValue = PolicyValue | 'INHERIT';
export type PolicyMap = Partial<Record<ApprovalOperation, PolicyValue>>;
export type UserPolicyMap = Partial<Record<ApprovalOperation, UserPolicyValue>>;
export const DEFAULT_APPROVAL_POLICY: PolicyValue = 'REQUIRE';
export const allOperationsPolicy = (value: PolicyValue): Record<ApprovalOperation, PolicyValue> =>
  Object.fromEntries(OPERATIONS.map(operation => [operation, value])) as Record<ApprovalOperation, PolicyValue>;

export function validateApprovalPolicy(value: unknown, userOverride = false): UserPolicyMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('Chính sách phê duyệt không hợp lệ', 400);
  const allowed = userOverride ? ['REQUIRE', 'SKIP', 'INHERIT'] : ['REQUIRE', 'SKIP'];
  for (const [operation, policy] of Object.entries(value)) {
    if (!OPERATIONS.includes(operation as ApprovalOperation) || (typeof policy!=='string'||!allowed.includes(policy))) {
      throw new ApiError('Thao tác hoặc giá trị chính sách phê duyệt không hợp lệ', 400);
    }
  }
  return { ...value } as UserPolicyMap;
}

// Calendar workflow adapter: the shared engine resolves module + action.
export function resolveApprovalPolicy(
  roles: Array<{id: string | number | bigint; name: string; approval_policy?: unknown}>,
  overrides: UserPolicyMap = {},
) {
  const result=resolveModuleApprovalPolicy(roles,{calendar:overrides});
  return {inherited_policy:result.module_inherited_policy.calendar as Record<ApprovalOperation,PolicyValue>,
    effective_policy:result.module_effective_policy.calendar as Record<ApprovalOperation,PolicyValue>,
    policy_sources:result.module_policy_sources.calendar,
    required_operations:OPERATIONS.filter(op=>result.module_effective_policy.calendar[op]==='REQUIRE')};
}
