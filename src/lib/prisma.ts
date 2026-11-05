import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const buildDatabaseUrl = () => {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return undefined;

  const url = new URL(rawUrl);
  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set(
      "connection_limit",
      process.env.PRISMA_CONNECTION_LIMIT || "10"
    );
  }
  if (!url.searchParams.has("pool_timeout")) {
    url.searchParams.set(
      "pool_timeout",
      process.env.PRISMA_POOL_TIMEOUT_SECONDS || "60"
    );
  }
  return url.toString();
};

const createPrismaClient = () => {
  const datasourceUrl = buildDatabaseUrl();
  const client = datasourceUrl
    ? new PrismaClient({ datasources: { db: { url: datasourceUrl } } })
    : new PrismaClient();
  // Calendar behaves as physically removed for existing callers. Only lifecycle
  // operations explicitly providing deleted_at may read/write deleted records.
  client.$use(async (params, next) => {
    if (params.model === "calendar" && [
      "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow",
      "findMany", "count", "aggregate", "groupBy", "update", "updateMany",
    ].includes(params.action)) {
      params.args ??= {};
      params.args.where ??= {};
      if (!Object.prototype.hasOwnProperty.call(params.args.where, "deleted_at")) {
        params.args.where.deleted_at = null;
      }
    }
    return next(params);
  });
  return client;
};

const prisma = globalForPrisma.prisma ?? createPrismaClient();
globalForPrisma.prisma = prisma;

export default prisma;
