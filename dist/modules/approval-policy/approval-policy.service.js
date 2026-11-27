"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeModulePolicies = normalizeModulePolicies;
exports.validateModulePolicies = validateModulePolicies;
exports.resolveModuleApprovalPolicy = resolveModuleApprovalPolicy;
exports.policyForAction = policyForAction;
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const approval_policy_registry_1 = require("./approval-policy.registry");
const object = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
// The only legacy adapter: old flat action maps belonged to the calendar module.
// New policy storage and APIs always namespace actions under their module key.
function normalizeModulePolicies(value) {
    if (!object(value))
        return {};
    if (Object.values(value).some(v => typeof v === 'string'))
        return { calendar: { ...value } };
    return Object.fromEntries(Object.entries(value).map(([key, actions]) => [key, object(actions) ? { ...actions } : actions]));
}
function validateModulePolicies(value, userOverride = false, modules = approval_policy_registry_1.APPROVAL_MODULES) {
    if (!object(value))
        throw new ApiError_1.default('Chính sách phê duyệt không hợp lệ', 400);
    const normalized = normalizeModulePolicies(value), allowed = userOverride ? ['REQUIRE', 'SKIP', 'INHERIT'] : ['REQUIRE', 'SKIP'];
    for (const [key, actions] of Object.entries(normalized)) {
        const module = modules.find(m => m.key === key);
        if (!module || !object(actions))
            throw new ApiError_1.default('Chức năng này chưa hỗ trợ cấu hình phê duyệt', 400);
        for (const [action, policy] of Object.entries(actions)) {
            if (!module.actions.some(a => a.key === action) || typeof policy !== 'string' || !allowed.includes(policy))
                throw new ApiError_1.default('Thao tác hoặc giá trị chính sách phê duyệt không hợp lệ', 400);
        }
    }
    return normalized;
}
function resolveModuleApprovalPolicy(roles, overrides = {}, modules = approval_policy_registry_1.APPROVAL_MODULES) {
    const inherited = {}, effective = {}, sources = {};
    const rolePolicies = roles.map(role => normalizeModulePolicies(role.approval_policy));
    for (const module of modules) {
        inherited[module.key] = {};
        effective[module.key] = {};
        sources[module.key] = {};
        for (const { key: action } of module.actions) {
            const inheritedValue = rolePolicies.length
                ? rolePolicies.some(policy => { const value = policy[module.key]?.[action]; return (value === 'REQUIRE' || value === 'SKIP' ? value : module.defaultPolicy) === 'REQUIRE'; }) ? 'REQUIRE' : 'SKIP'
                : module.defaultPolicy;
            const override = overrides[module.key]?.[action];
            inherited[module.key][action] = inheritedValue;
            effective[module.key][action] = override === 'REQUIRE' || override === 'SKIP' ? override : inheritedValue;
            sources[module.key][action] = override === 'REQUIRE' || override === 'SKIP' ? 'USER' : roles.length ? 'ROLE' : 'DEFAULT';
        }
    }
    return { module_inherited_policy: inherited, module_effective_policy: effective, module_policy_sources: sources };
}
function policyForAction(moduleKey, action, roles, overrides = {}, modules = approval_policy_registry_1.APPROVAL_MODULES) {
    const module = modules.find(m => m.key === moduleKey);
    if (!module?.actions.some(a => a.key === action))
        throw new ApiError_1.default('Chức năng hoặc thao tác chưa hỗ trợ phê duyệt', 422);
    return resolveModuleApprovalPolicy(roles, overrides, modules).module_effective_policy[moduleKey][action];
}
