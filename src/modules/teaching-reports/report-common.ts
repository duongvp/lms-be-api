import prisma from '../../lib/prisma';
import { isProgramAllowed, getProgramScopeFilter } from '../../services/authorization.service';
import { fail } from './report-domain';
export { prisma };
export type User = {
    userId: number;
    username: string;
    permissions?: string[];
    roles?: string[];
    programScope?: any;
};
export const check = (u: User, p: string, codes: string[]) => {
    if (!codes.length || codes.some(c => !isProgramAllowed(u, p, c)))
        fail('Không có quyền trên toàn bộ chương trình liên quan', 403);
};
export const scope = (u: User, p: string) => getProgramScopeFilter(u, p);
