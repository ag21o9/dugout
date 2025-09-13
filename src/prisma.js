import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis

/**
 * Ensure a single PrismaClient instance across reloads (useful in dev).
 */
const prisma = globalForPrisma.prisma || new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
