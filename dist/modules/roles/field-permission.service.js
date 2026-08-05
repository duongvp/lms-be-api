"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const dateTime_1 = require("../../utils/dateTime");
const rbac_ui_constants_1 = require("./rbac-ui.constants");
const prisma = new client_1.PrismaClient();
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const normalizeRoleIds = (roleIds) => roleIds.map((roleId) => BigInt(roleId));
const validateFieldPolicyShape = (fieldPolicy) => {
    if (!isPlainObject(fieldPolicy)) {
        throw new ApiError_1.default('fieldPolicy must be an object', 400);
    }
    if (!isPlainObject(fieldPolicy.modules)) {
        throw new ApiError_1.default('fieldPolicy.modules must be an object', 400);
    }
    for (const [moduleCode, modulePolicy] of Object.entries(fieldPolicy.modules)) {
        if (!moduleCode || !isPlainObject(modulePolicy)) {
            throw new ApiError_1.default(`Invalid policy for module ${moduleCode}`, 400);
        }
        if (!isPlainObject(modulePolicy.fields)) {
            throw new ApiError_1.default(`fieldPolicy.modules.${moduleCode}.fields must be an object`, 400);
        }
        for (const [fieldCode, rule] of Object.entries(modulePolicy.fields)) {
            if (!fieldCode || !isPlainObject(rule)) {
                throw new ApiError_1.default(`Invalid rule for ${moduleCode}.${fieldCode}`, 400);
            }
            if (typeof rule.visible !== 'boolean' || typeof rule.editable !== 'boolean') {
                throw new ApiError_1.default(`Rule ${moduleCode}.${fieldCode} must include boolean visible/editable`, 400);
            }
            if (rule.editable && !rule.visible) {
                throw new ApiError_1.default(`Field ${moduleCode}.${fieldCode} cannot be editable when it is not visible`, 400);
            }
        }
    }
    return fieldPolicy;
};
const validateFieldPolicyAgainstModules = async (fieldPolicy) => {
    const moduleCodes = Object.keys(fieldPolicy.modules);
    const modules = await prisma.modules.findMany({
        where: { code: { in: moduleCodes } },
        include: { fields: true },
    });
    const moduleMap = new Map(modules.map((module) => [module.code, module]));
    const missingModules = moduleCodes.filter((moduleCode) => !moduleMap.has(moduleCode));
    if (missingModules.length) {
        throw new ApiError_1.default(`Modules not found: ${missingModules.join(', ')}`, 400);
    }
    for (const moduleCode of moduleCodes) {
        const module = moduleMap.get(moduleCode);
        const validFields = new Set(module.fields.map((field) => field.fieldCode));
        const fieldCodes = Object.keys(fieldPolicy.modules[moduleCode].fields);
        const invalidFields = fieldCodes.filter((fieldCode) => fieldCode !== '*' && !validFields.has(fieldCode));
        if (invalidFields.length) {
            throw new ApiError_1.default(`Fields not found in module ${moduleCode}: ${invalidFields.join(', ')}`, 400);
        }
    }
};
const mergeRule = (current, override) => ({
    visible: override?.visible ?? current.visible,
    editable: override?.editable ?? current.editable,
});
const mergeFieldRuleFromPolicies = (policies, moduleCode, fieldCode) => {
    let mergedRule = { visible: false, editable: false };
    for (const policy of policies) {
        const fields = policy?.modules?.[moduleCode]?.fields;
        if (!fields)
            continue;
        const roleRule = mergeRule(mergeRule({ visible: false, editable: false }, fields['*']), fields[fieldCode]);
        mergedRule = {
            visible: mergedRule.visible || roleRule.visible,
            editable: mergedRule.editable || roleRule.editable,
        };
    }
    return mergedRule;
};
const FieldPermissionService = {
    validateFieldPolicy: async (fieldPolicy) => {
        const normalizedPolicy = validateFieldPolicyShape(fieldPolicy);
        await validateFieldPolicyAgainstModules(normalizedPolicy);
        return normalizedPolicy;
    },
    async getModules() {
        const modules = await prisma.modules.findMany({
            where: {
                code: { in: [...rbac_ui_constants_1.RBAC_FIELD_MODULE_CODES] },
            },
            select: {
                id: true,
                code: true,
                name: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        const moduleOrder = new Map(rbac_ui_constants_1.RBAC_FIELD_MODULE_CODES.map((code, index) => [code, index]));
        return modules
            .sort((left, right) => (moduleOrder.get(left.code) ?? Number.MAX_SAFE_INTEGER)
            - (moduleOrder.get(right.code) ?? Number.MAX_SAFE_INTEGER))
            .map((module) => ({
            ...module,
            id: Number(module.id),
        }));
    },
    async getModuleFields(moduleCode) {
        const module = await prisma.modules.findUnique({
            where: { code: moduleCode },
            include: {
                fields: {
                    orderBy: { sortOrder: 'asc' },
                },
            },
        });
        if (!module) {
            throw new ApiError_1.default('Module not found', 404);
        }
        return {
            id: Number(module.id),
            code: module.code,
            name: module.name,
            fields: module.fields.map((field) => ({
                id: Number(field.id),
                fieldCode: field.fieldCode,
                fieldLabel: field.fieldLabel,
                fieldType: field.fieldType,
                sortOrder: field.sortOrder,
            })),
        };
    },
    async getRoleFieldPolicy(roleId) {
        const role = await prisma.roles.findUnique({
            where: { id: BigInt(roleId) },
            select: {
                id: true,
                code: true,
                name: true,
                fieldPolicy: true,
            },
        });
        if (!role) {
            throw new ApiError_1.default('Role not found', 404);
        }
        return {
            id: Number(role.id),
            code: role.code,
            name: role.name,
            fieldPolicy: role.fieldPolicy,
        };
    },
    async updateRoleFieldPolicy(roleId, fieldPolicy) {
        const normalizedPolicy = await this.validateFieldPolicy(fieldPolicy);
        const role = await prisma.roles.findUnique({
            where: { id: BigInt(roleId) },
        });
        if (!role) {
            throw new ApiError_1.default('Role not found', 404);
        }
        const updatedRole = await prisma.roles.update({
            where: { id: BigInt(roleId) },
            data: {
                fieldPolicy: normalizedPolicy,
                updatedAt: (0, dateTime_1.getVietnamWallClockDate)(),
            },
            select: {
                id: true,
                code: true,
                name: true,
                fieldPolicy: true,
            },
        });
        return {
            id: Number(updatedRole.id),
            code: updatedRole.code,
            name: updatedRole.name,
            fieldPolicy: updatedRole.fieldPolicy,
        };
    },
    async getMergedFieldRule(roleIds, moduleCode, fieldCode) {
        if (!roleIds.length) {
            return { visible: false, editable: false };
        }
        const roles = await prisma.roles.findMany({
            where: {
                id: { in: normalizeRoleIds(roleIds) },
                isActive: true,
            },
            select: { fieldPolicy: true },
        });
        return mergeFieldRuleFromPolicies(roles.map((role) => role.fieldPolicy), moduleCode, fieldCode);
    },
    async assertEditableFields(roleIds, moduleCode, fieldCodes) {
        const uniqueFieldCodes = Array.from(new Set(fieldCodes)).filter(Boolean);
        for (const fieldCode of uniqueFieldCodes) {
            const rule = await this.getMergedFieldRule(roleIds, moduleCode, fieldCode);
            if (!rule.editable) {
                throw new ApiError_1.default(`No permission to edit field ${moduleCode}.${fieldCode}`, 403);
            }
        }
    },
    async filterVisibleRecords(roleIds, moduleCode, records) {
        if (!roleIds.length)
            return records.map(() => ({}));
        const roles = await prisma.roles.findMany({
            where: {
                id: { in: normalizeRoleIds(roleIds) },
                isActive: true,
            },
            select: { fieldPolicy: true },
        });
        const policies = roles.map((role) => role.fieldPolicy);
        return records.map((record) => Object.entries(record).reduce((result, [fieldCode, value]) => {
            const rule = mergeFieldRuleFromPolicies(policies, moduleCode, fieldCode);
            if (rule.visible)
                result[fieldCode] = value;
            return result;
        }, {}));
    },
    async filterVisibleRecord(roleIds, moduleCode, record) {
        const [filtered] = await this.filterVisibleRecords(roleIds, moduleCode, [record]);
        return filtered;
    },
};
exports.default = FieldPermissionService;
