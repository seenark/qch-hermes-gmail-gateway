import { PrismaLibSql } from "@prisma/adapter-libsql";
import { env } from "@qch-hermes/env/server";

import { PrismaClient } from "../prisma/generated/client";

export function createPrismaClient() {
  const adapter = new PrismaLibSql({
    url: env.DATABASE_URL,
  });

  return new PrismaClient({ adapter });
}

const prisma = createPrismaClient();
export default prisma;
