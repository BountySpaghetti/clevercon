import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ServiceStatus } from '@clevercon/db';
import { PrismaService } from '../prisma/prisma.service.js';

type ServiceWithRep = Prisma.ServiceGetPayload<{ include: { reputation: true } }>;

export type ServiceSort = 'trust' | 'recent' | 'rating' | 'price_asc' | 'price_desc';

export interface ListParams {
  q?: string;
  category?: string;
  capability?: string;
  sort?: ServiceSort;
  limit?: number;
  offset?: number;
}

/**
 * A service's trust tier, earned by REAL on-chain settlements (successfulJobs is
 * only incremented when a job actually completes and the provider is paid, see
 * workers/executor.ts). This is our anti-spam primitive: a freshly listed service
 * is `new` and ranks last until it proves itself with settled work, so listing is
 * open (anyone can register) without the directory filling with unproven noise.
 */
export type TrustTier = 'new' | 'active' | 'trusted';
function trustTier(settlements: number, score: number): TrustTier {
  if (settlements >= 10 && score >= 4) return 'trusted';
  if (settlements >= 1) return 'active';
  return 'new';
}

/** Curated services we vouch for, by registry agent_id (comma-separated env). */
function verifiedAgentIds(): Set<string> {
  return new Set(
    (process.env.VERIFIED_AGENT_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// Map the public sort keys to Prisma orderBy. Every service carries a (zeroed)
// reputation row, so ordering by the relation is well-defined. `trust` is the
// default: settlement-gated (most settled + highest-rated first), so proven
// services surface and unproven ones sink, pagination-correct in SQL.
const SORT_ORDER: Record<ServiceSort, Prisma.ServiceOrderByWithRelationInput[]> = {
  trust: [
    { reputation: { successfulJobs: 'desc' } },
    { reputation: { score: 'desc' } },
    { registeredAt: 'desc' },
  ],
  recent: [{ registeredAt: 'desc' }],
  rating: [{ reputation: { score: 'desc' } }],
  price_asc: [{ pricePerCall: 'asc' }],
  price_desc: [{ pricePerCall: 'desc' }],
};

function serialize(s: ServiceWithRep, verified: Set<string>) {
  const settlements = s.reputation?.successfulJobs ?? 0;
  const score = s.reputation?.score ?? 0;
  return {
    id: s.id,
    agentId: s.agentId,
    name: s.name,
    description: s.description,
    category: s.category,
    capabilities: s.capabilities,
    pricingModel: s.pricingModel,
    pricePerCall: Number(s.pricePerCall),
    currency: s.currency,
    endpoint: s.endpoint,
    status: s.status,
    // Settlement-gated trust, surfaced for the marketplace: the tier, the count
    // of real settled jobs, and whether we've curated/vouched for it.
    trust: trustTier(settlements, score),
    settlements,
    verified: verified.has(s.agentId),
    reputation: s.reputation
      ? {
          score: s.reputation.score,
          totalJobs: s.reputation.totalJobs,
          avgLatencyMs: s.reputation.avgLatencyMs,
        }
      : null,
  };
}

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: ListParams) {
    const where: Prisma.ServiceWhereInput = {
      status: { in: [ServiceStatus.ACTIVE, ServiceStatus.NEW] },
    };
    if (params.category) where.category = params.category;
    if (params.capability) where.capabilities = { has: params.capability };
    // Server-side search so it composes correctly with pagination.
    if (params.q)
      where.OR = [
        { name: { contains: params.q, mode: 'insensitive' } },
        { description: { contains: params.q, mode: 'insensitive' } },
      ];

    const take = Math.min(params.limit ?? 50, 100);
    const skip = params.offset ?? 0;
    const orderBy = SORT_ORDER[params.sort ?? 'trust'];
    const verified = verifiedAgentIds();
    const [rows, total] = await Promise.all([
      this.prisma.service.findMany({ where, include: { reputation: true }, orderBy, take, skip }),
      this.prisma.service.count({ where }),
    ]);
    return { items: rows.map((r) => serialize(r, verified)), total, limit: take, offset: skip };
  }

  async get(id: string) {
    const s = await this.prisma.service.findUnique({
      where: { id },
      include: { reputation: true },
    });
    if (!s) throw new NotFoundException('Service not found');
    return serialize(s, verifiedAgentIds());
  }
}
