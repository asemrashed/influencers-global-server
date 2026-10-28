import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/prisma/client.js';

export { Prisma, PrismaClient };
export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;
/** Either the client or an interactive-transaction client. */
export type DbOrTx = Db | Tx;

export function createPrisma(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
