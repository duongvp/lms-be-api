"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const globalForPrisma = globalThis;
const buildDatabaseUrl = () => {
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl)
        return undefined;
    const url = new URL(rawUrl);
    if (!url.searchParams.has("connection_limit")) {
        url.searchParams.set("connection_limit", process.env.PRISMA_CONNECTION_LIMIT || "10");
    }
    if (!url.searchParams.has("pool_timeout")) {
        url.searchParams.set("pool_timeout", process.env.PRISMA_POOL_TIMEOUT_SECONDS || "60");
    }
    return url.toString();
};
const createPrismaClient = () => {
    const datasourceUrl = buildDatabaseUrl();
    return datasourceUrl
        ? new client_1.PrismaClient({ datasources: { db: { url: datasourceUrl } } })
        : new client_1.PrismaClient();
};
const prisma = globalForPrisma.prisma ?? createPrismaClient();
globalForPrisma.prisma = prisma;
exports.default = prisma;
