"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.allOperationsPolicy = exports.DEFAULT_APPROVAL_POLICY = void 0;
exports.validateApprovalPolicy = validateApprovalPolicy;
exports.resolveApprovalPolicy = resolveApprovalPolicy;
const approval_policy_service_1 = require("../approval-policy/approval-policy.service");
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const calendar_approval_types_1 = require("./calendar-approval.types");
exports.DEFAULT_APPROVAL_POLICY = 'REQUIRE';
const allOperationsPolicy = (value) => Object.fromEntries(calendar_approval_types_1.OPERATIONS.map(operation => [operation, value]));
exports.allOperationsPolicy = allOperationsPolicy;
function validateApprovalPolicy(value, userOverride = false) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new ApiError_1.default('Chính sách phê duyệt không hợp lệ', 400);
    const allowed = userOverride ? ['REQUIRE', 'SKIP', 'INHERIT'] : ['REQUIRE', 'SKIP'];
    for (const [operation, policy] of Object.entries(value)) {
        if (!calendar_approval_types_1.OPERATIONS.includes(operation) || (typeof policy !== 'string' || !allowed.includes(policy))) {
            throw new ApiError_1.default('Thao tác hoặc giá trị chính sách phê duyệt không hợp lệ', 400);
        }
    }
    return { ...value };
}
// Calendar workflow adapter: the shared engine resolves module + action.
function resolveApprovalPolicy(roles, overrides = {}) {
    const result = (0, approval_policy_service_1.resolveModuleApprovalPolicy)(roles, { calendar: overrides });
    return { inherited_policy: result.module_inherited_policy.calendar,
        effective_policy: result.module_effective_policy.calendar,
        policy_sources: result.module_policy_sources.calendar,
        required_operations: calendar_approval_types_1.OPERATIONS.filter(op => result.module_effective_policy.calendar[op] === 'REQUIRE') };
}
