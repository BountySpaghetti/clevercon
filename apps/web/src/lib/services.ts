import { isDemo } from '../config';
import { apiFetch } from './api';
import { demoServices } from './demo';

/** Settlement-gated trust tier, earned by real on-chain settled jobs. */
export type TrustTier = 'new' | 'active' | 'trusted';

export interface Service {
  id: string;
  name: string;
  description: string;
  category: string | null;
  pricePerCall: number;
  rating: number;
  provider: string;
  /** Trust earned by real on-chain settlements (anti-spam, our discovery primitive). */
  trust: TrustTier;
  /** Count of real settled jobs behind the trust tier. */
  settlements: number;
  /** Curated: a service we vouch for. */
  verified: boolean;
  /** How the service charges: x402 one-shot or MPP metered. */
  pricingModel: string;
}

interface ApiService {
  id: string;
  name: string;
  description: string;
  category: string | null;
  pricePerCall: number;
  pricingModel: string;
  trust?: TrustTier;
  settlements?: number;
  verified?: boolean;
  reputation: { score: number } | null;
}

export type ServiceSort = 'trust' | 'recent' | 'rating' | 'price_asc' | 'price_desc';

export interface ServiceQuery {
  q?: string;
  category?: string;
  sort?: ServiceSort;
  limit?: number;
  offset?: number;
}

export interface ServicePage {
  items: Service[];
  total: number;
}

function mapApiService(s: ApiService): Service {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    pricePerCall: s.pricePerCall,
    rating: s.reputation?.score ?? 0,
    provider: s.pricingModel === 'MPP' ? 'streaming' : 'per-call',
    trust: s.trust ?? 'new',
    settlements: s.settlements ?? 0,
    verified: !!s.verified,
    pricingModel: s.pricingModel,
  };
}

function sortClient(list: Service[], sort: ServiceSort): Service[] {
  const sorted = [...list];
  if (sort === 'trust') sorted.sort((a, b) => b.settlements - a.settlements || b.rating - a.rating);
  else if (sort === 'rating') sorted.sort((a, b) => b.rating - a.rating);
  else if (sort === 'price_asc') sorted.sort((a, b) => a.pricePerCall - b.pricePerCall);
  else if (sort === 'price_desc') sorted.sort((a, b) => b.pricePerCall - a.pricePerCall);
  // 'recent' keeps the source order.
  return sorted;
}

/**
 * Marketplace services with server-side search/filter/sort/pagination (so paging
 * is correct against the full set). Demo mode applies the same operations to the
 * demo list client-side so the UI behaves identically.
 */
export async function getServices(params: ServiceQuery = {}): Promise<ServicePage> {
  const { q = '', category, sort = 'trust', limit = 12, offset = 0 } = params;
  if (isDemo()) {
    let list: Service[] = demoServices.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      category: d.category,
      pricePerCall: d.pricePerCall,
      rating: d.rating,
      provider: d.provider,
      trust: d.rating >= 4.5 ? 'trusted' : d.rating >= 3 ? 'active' : 'new',
      settlements: Math.round(d.rating * 7),
      verified: d.rating >= 4.7,
      pricingModel: d.provider === 'streaming' ? 'MPP' : 'X402',
    }));
    if (category && category !== 'All') list = list.filter((s) => s.category === category);
    if (q) {
      const t = q.toLowerCase();
      list = list.filter(
        (s) => s.name.toLowerCase().includes(t) || s.description.toLowerCase().includes(t),
      );
    }
    list = sortClient(list, sort);
    return { items: list.slice(offset, offset + limit), total: list.length };
  }
  const usp = new URLSearchParams();
  if (q) usp.set('q', q);
  if (category && category !== 'All') usp.set('category', category);
  usp.set('sort', sort);
  usp.set('limit', String(limit));
  usp.set('offset', String(offset));
  const res = await apiFetch<{ items: ApiService[]; total: number }>(`/services?${usp.toString()}`);
  return { items: res.items.map(mapApiService), total: res.total };
}

export interface ServiceDetail extends Service {
  capabilities: string[];
  pricingModel: string;
  currency: string;
  endpoint: string;
  status: string;
  totalJobs: number;
  avgLatencyMs: number | null;
}

interface ApiServiceDetail extends ApiService {
  capabilities: string[];
  currency: string;
  endpoint: string;
  status: string;
  reputation: { score: number; totalJobs: number; avgLatencyMs: number } | null;
}

/** One service's detail: demo data in demo mode, the live API otherwise. */
export async function getService(id: string): Promise<ServiceDetail> {
  if (isDemo()) {
    const d = demoServices.find((s) => s.id === id) ?? demoServices[0];
    return {
      id,
      name: d.name,
      description: d.description,
      category: d.category,
      pricePerCall: d.pricePerCall,
      rating: d.rating,
      provider: d.provider,
      trust: 'trusted',
      settlements: 30,
      verified: true,
      capabilities: ['demo-capability'],
      pricingModel: 'X402',
      currency: 'USDC',
      endpoint: 'https://demo.example.com',
      status: 'ACTIVE',
      totalJobs: 42,
      avgLatencyMs: 780,
    };
  }
  const s = await apiFetch<ApiServiceDetail>(`/services/${id}`);
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    pricePerCall: s.pricePerCall,
    rating: s.reputation?.score ?? 0,
    provider: s.pricingModel === 'MPP' ? 'streaming' : 'per-call',
    trust: s.trust ?? 'new',
    settlements: s.settlements ?? 0,
    verified: !!s.verified,
    capabilities: s.capabilities ?? [],
    pricingModel: s.pricingModel,
    currency: s.currency,
    endpoint: s.endpoint,
    status: s.status,
    totalJobs: s.reputation?.totalJobs ?? 0,
    avgLatencyMs: s.reputation?.avgLatencyMs ?? null,
  };
}
