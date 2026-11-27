"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCalendarClassificationOptions = getCalendarClassificationOptions;
exports.calendarClassificationCondition = calendarClassificationCondition;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../../lib/prisma"));
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
async function getCalendarClassificationOptions(allowedPrograms) {
    if (allowedPrograms?.length === 0)
        return [];
    return prisma_1.default.$queryRaw(client_1.Prisma.sql `
  SELECT DISTINCT subject_code AS code, TRIM(subject_name) AS subject_name, grade
  FROM lessons WHERE status <> 0 AND TRIM(subject_code) <> '' AND TRIM(subject_name) <> ''
  ${allowedPrograms === null ? client_1.Prisma.empty : client_1.Prisma.sql `AND subject_code IN (${client_1.Prisma.join(allowedPrograms)})`}
  ORDER BY subject_name, grade, code
 `);
}
// Exact curriculum classification; do not infer grades from calendar names/codes.
// Calendar IDs are intersected with the existing permission/source/date filters.
async function calendarClassificationCondition(query, programs = null) {
    const subject = String(query.subject_name ?? '').trim();
    const hasGrade = query.grade !== undefined && query.grade !== null && query.grade !== '';
    const grade = hasGrade ? Number(query.grade) : undefined;
    if (subject.length > 100)
        throw new ApiError_1.default('Môn học không hợp lệ', 400);
    if (hasGrade && (!Number.isInteger(grade) || (grade ?? 0) < 1 || (grade ?? 0) > 12))
        throw new ApiError_1.default('Khối phải là số nguyên từ 1 đến 12', 400);
    if (!subject && !hasGrade)
        return null;
    if (programs?.length === 0)
        return { id: { in: [] } };
    const rows = await prisma_1.default.$queryRaw(client_1.Prisma.sql `
  SELECT DISTINCT c.id FROM calendar c
  LEFT JOIN lessons linked ON linked.id=c.session_id AND linked.status<>0
  LEFT JOIN lessons legacy ON c.session_id IS NULL AND legacy.subject_code=c.code
    AND legacy.learn_number=c.learn_number AND legacy.status<>0
  WHERE 1=1
  ${programs === null ? client_1.Prisma.empty : client_1.Prisma.sql `AND COALESCE(linked.subject_code,legacy.subject_code,c.code) IN (${client_1.Prisma.join(programs)})`}
  ${subject ? client_1.Prisma.sql `AND TRIM(COALESCE(linked.subject_name,legacy.subject_name,c.subject))=${subject}` : client_1.Prisma.empty}
  ${hasGrade ? client_1.Prisma.sql `AND COALESCE(linked.grade,legacy.grade)=${grade}` : client_1.Prisma.empty}
 `);
    return { id: { in: rows.map(row => Number(row.id)) } };
}
