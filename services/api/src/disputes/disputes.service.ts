import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DisputeStatus } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { VaultContractService } from '../vault/vault-contract.service.js';

/**
 * Buyer-facing disputes. Opening a dispute records it and returns the unsigned
 * `raise_dispute` XDR for the buyer to sign (via the existing vault submit path):
 * on-chain this freezes the task so no further release or completion can happen
 * until the dispute resolver settles it (the vault's resolve_dispute splits the
 * still-locked plan_cost - spent). The lock IS the escrow, so nothing is clawed
 * back. See .local/MARKETPLACE-ECONOMY-SPEC.md section 6.
 */
@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contract: VaultContractService,
  ) {}

  async open(userId: string, taskId: string, reason?: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, buyerId: true, vaultTaskId: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.buyerId !== userId) throw new ForbiddenException('not your task');
    if (task.vaultTaskId == null) {
      throw new BadRequestException('task is not locked on-chain; nothing to dispute');
    }
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { address: true },
    });
    if (!wallet) throw new BadRequestException('no wallet on file to sign the dispute');

    const dispute = await this.prisma.dispute.create({
      data: { taskId, raisedBy: wallet.address, reason: reason ?? null, status: DisputeStatus.OPEN },
    });
    // The buyer signs this and submits it (POST /vault/submit) to freeze the task.
    const xdr = await this.contract.buildRaiseDisputeXdr(wallet.address, BigInt(task.vaultTaskId));
    return { dispute: { id: dispute.id, taskId, status: dispute.status }, xdr };
  }

  async list(userId: string) {
    const rows = await this.prisma.dispute.findMany({
      where: { task: { buyerId: userId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { task: { select: { title: true } } },
    });
    return rows.map(serialize);
  }

  async get(userId: string, id: string) {
    const d = await this.prisma.dispute.findUnique({
      where: { id },
      include: { task: { select: { title: true, buyerId: true } } },
    });
    if (!d || d.task?.buyerId !== userId) throw new NotFoundException('Dispute not found');
    return serialize(d);
  }
}

type DisputeRow = {
  id: string;
  taskId: string;
  status: DisputeStatus;
  reason: string | null;
  resolution: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  task: { title: string } | null;
};

function serialize(d: DisputeRow) {
  return {
    id: d.id,
    taskId: d.taskId,
    task: d.task?.title ?? null,
    status: d.status,
    reason: d.reason,
    resolution: d.resolution,
    createdAt: d.createdAt.toISOString(),
    resolvedAt: d.resolvedAt?.toISOString() ?? null,
  };
}
