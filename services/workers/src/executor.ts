import { type PrismaClient, StepStatus, TaskStatus } from '@clevercon/db';
import {
  validateSchema,
  verifyDelivery,
  type JobRequestEnvelope,
  type JobResultEnvelope,
  type VerificationSpec,
  type JsonSchema,
} from '@clevercon/common';
import { enqueueSettlement } from './queue.js';
import { finalizeTaskIfComplete } from './settlement.js';

export interface ExecuteResult {
  status: 'completed' | 'failed' | 'skipped';
  reason?: string;
  stepsRun?: number;
  /** The task's buyer, so the worker can push a real-time update to their room. */
  buyerId?: string;
}

type FetchImpl = typeof fetch;

const STEP_TIMEOUT_MS = 15_000;
const TERMINAL: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.FAILED];

/**
 * Acceptance check: a step is paid only when the provider returned a usable
 * result, not merely a 2xx. This is the minimal, provider-agnostic gate (a
 * non-empty body that is not a soft error). A provider that answers 200 with an
 * empty body or a JSON `{ error: ... }` is rejected, so the vault does not pay
 * for a non-delivery. Richer, service-declared acceptance criteria build on this.
 */
export function isAcceptableOutput(output: string): boolean {
  const trimmed = output.trim();
  if (!trimmed) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'error' in parsed &&
      (parsed as { error: unknown }).error
    ) {
      return false;
    }
  } catch {
    // Non-JSON, non-empty text is acceptable (e.g. a plain string result).
  }
  return true;
}

/**
 * Normalize a provider response into the standard JobResultEnvelope. New providers
 * return the envelope directly; older ones return a bare value (JSON or text),
 * which we wrap so the acceptance pipeline is uniform. Back-compat is preserved:
 * a provider built before the envelope still settles exactly as before.
 */
export function parseResultEnvelope(text: string): JobResultEnvelope {
  const trimmed = text.trim();
  const now = Math.floor(Date.now() / 1000);
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.ok === 'boolean' &&
      (typeof parsed.issuedAt === 'number' || typeof parsed.contentType === 'string')
    ) {
      return parsed as unknown as JobResultEnvelope;
    }
    return { ok: true, contentType: 'application/json', data: parsed, issuedAt: now };
  } catch {
    return { ok: trimmed.length > 0, contentType: 'text/plain', data: trimmed, issuedAt: now };
  }
}

/**
 * Record a real job outcome against a service's reputation and health. Called
 * only when the provider endpoint was actually contacted, so these numbers
 * reflect genuine execution, never fabricated activity:
 *  - totalJobs / successfulJobs / failedJobs are incremented atomically (exact
 *    under concurrency),
 *  - score is a reliability rating (success rate on a 0-5 scale) recomputed from
 *    the fresh counts,
 *  - avgLatencyMs is a running mean over successful calls,
 *  - the service's lastSeen is stamped on a successful call (health signal).
 * Best-effort: a reputation write failure never fails the task execution.
 */
async function recordOutcome(
  prisma: PrismaClient,
  serviceId: string,
  success: boolean,
  latencyMs: number,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      // Atomic counter increments keep the counts exact even if several steps
      // for the same service settle at once.
      const rep = await tx.serviceReputation.update({
        where: { serviceId },
        data: {
          totalJobs: { increment: 1 },
          successfulJobs: { increment: success ? 1 : 0 },
          failedJobs: { increment: success ? 0 : 1 },
        },
      });
      const score = Math.round((rep.successfulJobs / rep.totalJobs) * 5 * 10) / 10;
      let avgLatencyMs = rep.avgLatencyMs;
      if (success) {
        const prevSuccessful = rep.successfulJobs - 1;
        avgLatencyMs = Math.round(
          (rep.avgLatencyMs * prevSuccessful + latencyMs) / rep.successfulJobs,
        );
      }
      await tx.serviceReputation.update({ where: { serviceId }, data: { score, avgLatencyMs } });
      if (success) {
        await tx.service.update({ where: { id: serviceId }, data: { lastSeen: new Date() } });
      }
    });
  } catch {
    // A reputation/health update is non-critical; never fail execution over it.
  }
}

/**
 * Drive one task's step state machine: mark it RUNNING, call each step's provider
 * endpoint, record the output/latency and mark the step RELEASED, or FAILED with
 * the error. Then settle the task to COMPLETED (all steps released) or FAILED.
 *
 * Idempotent: already-released steps are skipped and a terminal task is a no-op,
 * so BullMQ retries never double-execute a step.
 *
 * Note: this performs orchestration/execution only. On-chain payment/settlement
 * per released step (x402 / vault release) is a separate worker job and is not
 * done here, so no Payment rows are fabricated.
 */
export async function executeTask(
  prisma: PrismaClient,
  fetchImpl: FetchImpl,
  taskId: string,
): Promise<ExecuteResult> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { steps: { orderBy: { index: 'asc' }, include: { service: true } } },
  });
  if (!task) return { status: 'skipped', reason: 'task not found' };
  if (TERMINAL.includes(task.status))
    return { status: 'skipped', reason: 'task already terminal', buyerId: task.buyerId };

  await prisma.task.update({ where: { id: taskId }, data: { status: TaskStatus.RUNNING } });

  let anyFailed = false;
  let stepsRun = 0;
  for (const step of task.steps) {
    if (step.status === StepStatus.RELEASED) continue; // idempotent replay

    const endpoint = step.service?.endpoint;
    if (!endpoint) {
      await prisma.taskStep.update({
        where: { id: step.id },
        data: { status: StepStatus.FAILED, error: 'no provider endpoint' },
      });
      anyFailed = true;
      continue;
    }

    const started = Date.now();
    const input = (step.input as Record<string, unknown> | null) ?? {};
    const request: JobRequestEnvelope = {
      jobId: step.id,
      taskId,
      stepId: step.id,
      action: step.action,
      input,
      replyFormat: 'json',
      deadline: Math.floor(Date.now() / 1000) + Math.ceil(STEP_TIMEOUT_MS / 1000),
      idempotencyKey: `${taskId}:${step.id}`,
    };
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // action/taskId stay top-level for pre-envelope providers; the rest is additive.
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      });
      const latencyMs = Date.now() - started;
      if (!res.ok) throw new Error(`provider returned HTTP ${res.status}`);
      const rawText = (await res.text()).slice(0, 8000);
      // Acceptance pipeline: delivery gate -> schema check -> tier verification.
      const envelope = parseResultEnvelope(rawText);
      if (!envelope.ok)
        throw new Error(envelope.error ? `provider error: ${envelope.error}` : 'provider delivery rejected');
      if (!isAcceptableOutput(rawText))
        throw new Error('provider output rejected (acceptance check)');
      const outputSchema = step.service?.outputSchema as JsonSchema | null | undefined;
      if (outputSchema) {
        const schemaCheck = validateSchema(envelope.data, outputSchema);
        if (!schemaCheck.ok) throw new Error(`schema check failed: ${schemaCheck.reason}`);
      }
      const verification = step.service?.verification as VerificationSpec | null | undefined;
      if (step.service?.tier === 'T1' && verification) {
        // Trustless gate: a T1 service is paid only if the declared check passes.
        // `deferred` (onchain without a worker-side deriver) passes here; the buyer
        // agent verifies it trustlessly before accepting.
        const v = await verifyDelivery(verification, input, envelope);
        if (!v.ok) throw new Error(`verification failed: ${v.reason}`);
      }
      const storedOutput = (
        typeof envelope.data === 'string'
          ? envelope.data
          : JSON.stringify(envelope.data ?? envelope.artifact ?? '')
      ).slice(0, 2000);
      await prisma.taskStep.update({
        where: { id: step.id },
        data: { status: StepStatus.RELEASED, output: storedOutput, latencyMs, error: null },
      });
      if (step.serviceId) await recordOutcome(prisma, step.serviceId, true, latencyMs);
      // If the task is locked on-chain under a policy, settle this step (pay the
      // provider via a proof-gated release) out of band. Non-fatal: execution
      // never fails because settlement could not be enqueued.
      if (task.vaultTaskId && step.serviceId) {
        try {
          await enqueueSettlement(step.id);
        } catch {
          // settlement can be retried/driven later; do not fail the step
        }
      }
      stepsRun += 1;
    } catch (err) {
      const latencyMs = Date.now() - started;
      await prisma.taskStep.update({
        where: { id: step.id },
        data: {
          status: StepStatus.FAILED,
          error: err instanceof Error ? err.message : String(err),
          latencyMs,
        },
      });
      // The endpoint was contacted and failed, so it counts against the provider.
      if (step.serviceId) await recordOutcome(prisma, step.serviceId, false, latencyMs);
      anyFailed = true;
    }
  }

  const status = anyFailed ? TaskStatus.FAILED : TaskStatus.COMPLETED;
  await prisma.task.update({ where: { id: taskId }, data: { status } });
  // Finalize the on-chain task if nothing settled (e.g. all steps failed), so the
  // locked budget is unlocked instead of stranded. When steps DID release, this is
  // a no-op here (settlement finalizes after the releases land); both are idempotent.
  if (task.vaultTaskId) {
    try {
      await finalizeTaskIfComplete(prisma, taskId);
    } catch {
      // finalization is best-effort here; the settlement path and the on-chain
      // stale-task escape hatch both cover it.
    }
  }
  return { status: anyFailed ? 'failed' : 'completed', stepsRun, buyerId: task.buyerId };
}
