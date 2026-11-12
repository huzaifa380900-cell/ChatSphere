import { Prisma } from '@prisma/client';
import { getPrisma } from '../db/prisma.ts';
import { logger } from '../config/logger.ts';

export interface AuditEntryInput {
  actorId?: string | null;
  targetUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function recordAuditLog(entry: AuditEntryInput): Promise<void> {
  try {
    const prisma = getPrisma();
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        targetUserId: entry.targetUserId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: (entry.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (err) {
    logger.error('Failed to record audit log entry', {
      action: entry.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
