"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scope = exports.check = exports.prisma = void 0;
const prisma_1 = __importDefault(require("../../lib/prisma"));
exports.prisma = prisma_1.default;
const authorization_service_1 = require("../../services/authorization.service");
const report_domain_1 = require("./report-domain");
const check = (u, p, codes) => {
    if (!codes.length || codes.some(c => !(0, authorization_service_1.isProgramAllowed)(u, p, c)))
        (0, report_domain_1.fail)('Không có quyền trên toàn bộ chương trình liên quan', 403);
};
exports.check = check;
const scope = (u, p) => (0, authorization_service_1.getProgramScopeFilter)(u, p);
exports.scope = scope;
