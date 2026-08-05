import { PrismaClient } from '@prisma/client';
import ApiError from '../../utils/ApiError';
import { getVietnamWallClockDate } from '../../utils/dateTime';
import { RBAC_FIELD_MODULE_CODES } from './rbac-ui.constants';

const prisma = new PrismaClient();

type FieldRule = {
    visible: boolean;
    editable: boolean;
};

type FieldPolicy = {
    modules: Record<string, {
        fields: Record<string, FieldRule>;
    }>;
};

const isPlainObject = (value: unknown): value is Record<string, any> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const normalizeRoleIds = (roleIds: Array<string | number | bigint>) =>
    roleIds.map((roleId) => BigInt(roleId));

const validateFieldPolicyShape = (fieldPolicy: unknown): FieldPolicy => {
    if (!isPlainObject(fieldPolicy)) {
        throw new ApiError('fieldPolicy must be an object', 400);
    }

    if (!isPlainObject(fieldPolicy.modules)) {
        throw new ApiError('fieldPolicy.modules must be an object', 400);
    }

    for (const [moduleCode, modulePolicy] of Object.entries(fieldPolicy.modules)) {
        if (!moduleCode || !isPlainObject(modulePolicy)) {
            throw new ApiError(`Invalid policy for module ${moduleCode}`, 400);
        }

        if (!isPlainObject(modulePolicy.fields)) {
            throw new ApiError(`fieldPolicy.modules.${moduleCode}.fields must be an object`, 400);
        }

        for (const [fieldCode, rule] of Object.entries(modulePolicy.fields)) {
            if (!fieldCode || !isPlainObject(rule)) {
                throw new ApiError(`Invalid rule for ${moduleCode}.${fieldCode}`, 400);
            }

            if (typeof rule.visible !== 'boolean' || typeof rule.editable !== 'boolean') {
                throw new ApiError(`Rule ${moduleCode}.${fieldCode} must include boolean visible/editable`, 400);
            }

            if (rule.editable && !rule.visible) {
                throw new ApiError(`Field ${moduleCode}.${fieldCode} cannot be editable when it is not visible`, 400);
            }
        }
    }

    return fieldPolicy as FieldPolicy;
};

const validateFieldPolicyAgainstModules = async (fieldPolicy: FieldPolicy) => {
    const moduleCodes = Object.keys(fieldPolicy.modules);
    const modules = await prisma.modules.findMany({
        where: { code: { in: moduleCodes } },
        include: { fields: true },
    });

    const moduleMap = new Map(modules.map((module) => [module.code, module]));
    const missingModules = moduleCodes.filter((moduleCode) => !moduleMap.has(moduleCode));
    if (missingModules.length) {
        throw new ApiError(`Modules not found: ${missingModules.join(', ')}`, 400);
    }

    for (const moduleCode of moduleCodes) {
        const module = moduleMap.get(moduleCode)!;
        const validFields = new Set(module.fields.map((field) => field.fieldCode));

        const fieldCodes = Object.keys(fieldPolicy.modules[moduleCode].fields);
        const invalidFields = fieldCodes.filter((fieldCode) => fieldCode !== '*' && !validFields.has(fieldCode));
        if (invalidFields.length) {
            throw new ApiError(`Fields not found in module ${moduleCode}: ${invalidFields.join(', ')}`, 400);
        }
    }
};

const mergeRule = (current: FieldRule, override?: Partial<FieldRule>): FieldRule => ({
    visible: override?.visible ?? current.visible,
    editable: override?.editable ?? current.editable,
});

const mergeFieldRuleFromPolicies = (
    policies: Array<FieldPolicy | null>,
    moduleCode: string,
    fieldCode: string
): FieldRule => {
    let mergedRule: FieldRule = { visible: false, editable: false };

    for (const policy of policies) {
        const fields = policy?.modules?.[moduleCode]?.fields;
        if (!fields) continue;
        const roleRule = mergeRule(
            mergeRule({ visible: false, editable: false }, fields['*']),
            fields[fieldCode]
        );
        mergedRule = {
            visible: mergedRule.visible || roleRule.visible,
            editable: mergedRule.editable || roleRule.editable,
        };
    }

    return mergedRule;
};

const FieldPermissionService = {
    validateFieldPolicy: async (fieldPolicy: unknown) => {
        const normalizedPolicy = validateFieldPolicyShape(fieldPolicy);
        await validateFieldPolicyAgainstModules(normalizedPolicy);
        return normalizedPolicy;
    },

    async getModules() {
        const modules = await prisma.modules.findMany({
            where: {
                code: { in: [...RBAC_FIELD_MODULE_CODES] },
            },
            select: {
                id: true,
                code: true,
                name: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        const moduleOrder = new Map<string, number>(
            RBAC_FIELD_MODULE_CODES.map((code, index) => [code, index])
        );
        return modules
        .sort((left, right) =>
            (moduleOrder.get(left.code) ?? Number.MAX_SAFE_INTEGER)
            - (moduleOrder.get(right.code) ?? Number.MAX_SAFE_INTEGER)
        )
        .map((module) => ({
            ...module,
            id: Number(module.id),
        }));
    },

    async getModuleFields(moduleCode: string) {
        const module = await prisma.modules.findUnique({
            where: { code: moduleCode },
            include: {
                fields: {
                    orderBy: { sortOrder: 'asc' },
                },
            },
        });

        if (!module) {
            throw new ApiError('Module not found', 404);
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

    async getRoleFieldPolicy(roleId: string | number | bigint) {
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
            throw new ApiError('Role not found', 404);
        }

        return {
            id: Number(role.id),
            code: role.code,
            name: role.name,
            fieldPolicy: role.fieldPolicy,
        };
    },

    async updateRoleFieldPolicy(roleId: string | number | bigint, fieldPolicy: unknown) {
        const normalizedPolicy = await this.validateFieldPolicy(fieldPolicy);

        const role = await prisma.roles.findUnique({
            where: { id: BigInt(roleId) },
        });

        if (!role) {
            throw new ApiError('Role not found', 404);
        }

        const updatedRole = await prisma.roles.update({
            where: { id: BigInt(roleId) },
            data: {
                fieldPolicy: normalizedPolicy,
                updatedAt: getVietnamWallClockDate(),
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

    async getMergedFieldRule(roleIds: Array<string | number | bigint>, moduleCode: string, fieldCode: string): Promise<FieldRule> {
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

        return mergeFieldRuleFromPolicies(
            roles.map((role) => role.fieldPolicy as FieldPolicy | null),
            moduleCode,
            fieldCode
        );
    },

    async assertEditableFields(roleIds: Array<string | number | bigint>, moduleCode: string, fieldCodes: string[]) {
        const uniqueFieldCodes = Array.from(new Set(fieldCodes)).filter(Boolean);
        for (const fieldCode of uniqueFieldCodes) {
            const rule = await this.getMergedFieldRule(roleIds, moduleCode, fieldCode);
            if (!rule.editable) {
                throw new ApiError(`No permission to edit field ${moduleCode}.${fieldCode}`, 403);
            }
        }
    },

    async filterVisibleRecords(
        roleIds: Array<string | number | bigint>,
        moduleCode: string,
        records: Array<Record<string, any>>
    ) {
        if (!roleIds.length) return records.map(() => ({}));
        const roles = await prisma.roles.findMany({
            where: {
                id: { in: normalizeRoleIds(roleIds) },
                isActive: true,
            },
            select: { fieldPolicy: true },
        });
        const policies = roles.map((role) => role.fieldPolicy as FieldPolicy | null);

        return records.map((record) =>
            Object.entries(record).reduce<Record<string, any>>((result, [fieldCode, value]) => {
                const rule = mergeFieldRuleFromPolicies(policies, moduleCode, fieldCode);
                if (rule.visible) result[fieldCode] = value;
                return result;
            }, {})
        );
    },

    async filterVisibleRecord(
        roleIds: Array<string | number | bigint>,
        moduleCode: string,
        record: Record<string, any>
    ) {
        const [filtered] = await this.filterVisibleRecords(roleIds, moduleCode, [record]);
        return filtered;
    },
};

export default FieldPermissionService;
