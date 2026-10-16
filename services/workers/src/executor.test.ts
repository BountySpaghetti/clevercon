import { describe, it, expect, vi, afterEach } from 'vitest';
import { executeTask, isAcceptableOutput, releaseHeldStep } from './executor.js';

interface Service {
  endpoint: string;
  tier?: string;
  verification?: { method: string; spec?: Record<string, unknown> } | null;
  outputSchema?: Record<string, unknown> | null;
}
interface Step {
  id: string;
  index: number;
  action: string;
  status: string;
  service: Service | null;
  serviceId?: string | null;
  input?: Record<string, unknown> | null;
  output?: string | null;
  error?: string | null;
  latencyMs?: number | null;
  releaseAt?: Date | null;
  qualityRating?: number | null;
  qualityNote?: string | null;
}
interface Task {
  id: string;
  status: string;
  steps: Step[];
}

// Minimal in-memory Prisma double capturing the writes the executor makes.
function mockPrisma(task: Task | null) {
  return {
    task: {
      findUnique: vi.fn(async () => task),
      update: vi.fn(async ({ data }: { data: { status: string } }) => {
        if (task) task.status = data.status;
        return task;
      }),
    },
    taskStep: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Step> }) => {
        const s = task?.steps.find((x) => x.id === where.id);
        if (s) Object.assign(s, data);
        return s;
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const okFetch = vi.fn(async () => new Response('result-body', { status: 200 }));

describe('executeTask', () => {
  it('runs a reachable step and completes the task', async () => {
    const task: Task = {
      id: 't1',
      status: 'DRAFT',
      steps: [
        {
          id: 's1',
          index: 0,
          action: 'Pay oracle',
          status: 'PENDING',
          service: { endpoint: 'https://svc.test' },
        },
      ],
    };
    const p = mockPrisma(task);
    const res = await executeTask(p, okFetch as unknown as typeof fetch, 't1');
    expect(res.status).toBe('completed');
    expect(task.status).toBe('COMPLETED');
    expect(task.steps[0].status).toBe('RELEASED');
    expect(task.steps[0].output).toBe('result-body');
    expect(task.steps[0].latencyMs).toBeTypeOf('number');
  });

  it('fails the step (and task) when the provider errors', async () => {
    const task: Task = {
      id: 't2',
      status: 'PENDING',
      steps: [
        {
          id: 's1',
          index: 0,
          action: 'x',
          status: 'PENDING',
          service: { endpoint: 'https://svc.test' },
        },
      ],
    };
    const badFetch = vi.fn(async () => new Response('nope', { status: 500 }));
    const res = await executeTask(mockPrisma(task), badFetch as unknown as typeof fetch, 't2');
    expect(res.status).toBe('failed');
    expect(task.status).toBe('FAILED');
    expect(task.steps[0].status).toBe('FAILED');
    expect(task.steps[0].error).toContain('HTTP 500');
  });

  it('fails a step with no provider endpoint', async () => {
    const task: Task = {
      id: 't3',
      status: 'PENDING',
      steps: [{ id: 's1', index: 0, action: 'x', status: 'PENDING', service: null }],
    };
    const res = await executeTask(mockPrisma(task), okFetch as unknown as typeof fetch, 't3');
    expect(res.status).toBe('failed');
    expect(task.steps[0].error).toBe('no provider endpoint');
  });

  it('is idempotent: already-released steps are skipped', async () => {
    const task: Task = {
      id: 't4',
      status: 'RUNNING',
      steps: [
        {
          id: 's1',
          index: 0,
          action: 'x',
          status: 'RELEASED',
          service: { endpoint: 'https://svc.test' },
        },
      ],
    };
    const spy = vi.fn(async () => new Response('x', { status: 200 }));
    const res = await executeTask(mockPrisma(task), spy as unknown as typeof fetch, 't4');
    expect(res.status).toBe('completed');
    expect(spy).not.toHaveBeenCalled(); // released step not re-executed
  });

  it('skips a terminal task', async () => {
    const task: Task = { id: 't5', status: 'COMPLETED', steps: [] };
    const res = await executeTask(mockPrisma(task), okFetch as unknown as typeof fetch, 't5');
    expect(res.status).toBe('skipped');
  });

  it('skips a missing task', async () => {
    const res = await executeTask(mockPrisma(null), okFetch as unknown as typeof fetch, 'nope');
    expect(res.status).toBe('skipped');
  });

  it('fails a step whose 2xx output does not pass the acceptance check', async () => {
    const task: Task = {
      id: 't6',
      status: 'PENDING',
      steps: [
        {
          id: 's1',
          index: 0,
          action: 'x',
          status: 'PENDING',
          service: { endpoint: 'https://svc.test' },
        },
      ],
    };
    // A 200 with a soft-error JSON body is a non-delivery: do not pay for it.
    const softError = vi.fn(
      async () => new Response(JSON.stringify({ error: 'no data' }), { status: 200 }),
    );
    const res = await executeTask(mockPrisma(task), softError as unknown as typeof fetch, 't6');
    expect(res.status).toBe('failed');
    expect(task.steps[0].status).toBe('FAILED');
    expect(task.steps[0].error).toContain('acceptance');
  });

  function oneStep(id: string, service: Service, input: Record<string, unknown> = {}): Task {
    return {
      id,
      status: 'PENDING',
      steps: [{ id: 's1', index: 0, action: 'x', status: 'PENDING', service, input }],
    };
  }

  it('fails a step whose result violates the service output schema', async () => {
    const task = oneStep('t7', {
      endpoint: 'https://svc.test',
      outputSchema: { type: 'object', required: ['price'] },
    });
    const bad = vi.fn(async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 }));
    const res = await executeTask(mockPrisma(task), bad as unknown as typeof fetch, 't7');
    expect(res.status).toBe('failed');
    expect(task.steps[0].error).toContain('schema');
  });

  it('releases a T1 step when the witness verifier passes and fails it when it does not', async () => {
    const service: Service = {
      endpoint: 'https://svc.test',
      tier: 'T1',
      verification: { method: 'witness', spec: { predicate: 'product' } },
    };
    // Correct factors for n=15: an envelope the worker re-checks trustlessly.
    const good = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, contentType: 'application/json', data: { a: 3, b: 5 }, issuedAt: 1 }),
          { status: 200 },
        ),
    );
    const passTask = oneStep('t8', service, { n: 15 });
    expect((await executeTask(mockPrisma(passTask), good as unknown as typeof fetch, 't8')).status).toBe(
      'completed',
    );
    expect(passTask.steps[0].status).toBe('RELEASED');

    const bad = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, contentType: 'application/json', data: { a: 3, b: 4 }, issuedAt: 1 }),
          { status: 200 },
        ),
    );
    const failTask = oneStep('t9', service, { n: 15 });
    expect((await executeTask(mockPrisma(failTask), bad as unknown as typeof fetch, 't9')).status).toBe(
      'failed',
    );
    expect(failTask.steps[0].error).toContain('verification');
  });
});

describe('executeTask T2 dispute window', () => {
  afterEach(() => {
    delete process.env.DISPUTE_WINDOW_SECONDS;
  });

  function t2Task(id: string): Task {
    return {
      id,
      status: 'PENDING',
      steps: [
        {
          id: 's1',
          index: 0,
          action: 'x',
          status: 'PENDING',
          serviceId: 'svc1',
          service: { endpoint: 'https://svc.test', tier: 'T2' },
        },
      ],
    };
  }

  it('holds an accepted T2 step for the window instead of releasing it', async () => {
    process.env.DISPUTE_WINDOW_SECONDS = '3600';
    const task = t2Task('tw1');
    const scheduleRelease = vi.fn(async () => {});
    const enqueueSettle = vi.fn(async () => {});
    const res = await executeTask(mockPrisma(task), okFetch as unknown as typeof fetch, 'tw1', {
      scheduleRelease,
      enqueueSettle,
    });
    expect(res.status).toBe('awaiting');
    expect(task.status).toBe('RUNNING'); // not COMPLETED while held
    expect(task.steps[0].status).toBe('AWAITING_APPROVAL');
    expect(task.steps[0].releaseAt).toBeInstanceOf(Date);
    expect(scheduleRelease).toHaveBeenCalledWith('s1', 3600 * 1000);
    expect(enqueueSettle).not.toHaveBeenCalled(); // no release yet
  });

  it('releases a T2 step immediately when the window is disabled (0)', async () => {
    process.env.DISPUTE_WINDOW_SECONDS = '0';
    const task = t2Task('tw2');
    const scheduleRelease = vi.fn(async () => {});
    const res = await executeTask(mockPrisma(task), okFetch as unknown as typeof fetch, 'tw2', {
      scheduleRelease,
    });
    expect(res.status).toBe('completed');
    expect(task.steps[0].status).toBe('RELEASED');
    expect(scheduleRelease).not.toHaveBeenCalled();
  });

  it('is idempotent: a held step is not re-executed on replay', async () => {
    process.env.DISPUTE_WINDOW_SECONDS = '3600';
    const task = t2Task('tw3');
    task.status = 'RUNNING';
    task.steps[0].status = 'AWAITING_APPROVAL';
    const spy = vi.fn(async () => new Response('x', { status: 200 }));
    const res = await executeTask(mockPrisma(task), spy as unknown as typeof fetch, 'tw3', {
      scheduleRelease: vi.fn(async () => {}),
    });
    expect(res.status).toBe('awaiting');
    expect(spy).not.toHaveBeenCalled(); // provider not called again
  });

  it('annotates a held step with the advisory judge verdict', async () => {
    process.env.DISPUTE_WINDOW_SECONDS = '3600';
    const task = t2Task('tw4');
    const judge = vi.fn(async () => ({ rating: 4.5, note: 'matches the request' }));
    const res = await executeTask(mockPrisma(task), okFetch as unknown as typeof fetch, 'tw4', {
      scheduleRelease: vi.fn(async () => {}),
      judge,
    });
    expect(res.status).toBe('awaiting');
    expect(judge).toHaveBeenCalledOnce();
    expect(task.steps[0].qualityRating).toBe(4.5);
    expect(task.steps[0].qualityNote).toBe('matches the request');
  });

  it('holds normally when the judge is unavailable (returns null)', async () => {
    process.env.DISPUTE_WINDOW_SECONDS = '3600';
    const task = t2Task('tw5');
    const res = await executeTask(mockPrisma(task), okFetch as unknown as typeof fetch, 'tw5', {
      scheduleRelease: vi.fn(async () => {}),
      judge: vi.fn(async () => null),
    });
    expect(res.status).toBe('awaiting');
    expect(task.steps[0].status).toBe('AWAITING_APPROVAL');
    expect(task.steps[0].qualityRating ?? null).toBeNull();
  });
});

interface HeldStep {
  id: string;
  status: string;
  serviceId?: string | null;
  task: { id: string; status: string; buyerId: string; vaultTaskId: string | null } | null;
}

function mockReleasePrisma(step: HeldStep | null, openDisputes = 0, stillOpen = 0) {
  const task = step?.task ?? null;
  return {
    taskStep: {
      findUnique: vi.fn(async () => step),
      update: vi.fn(async ({ data }: { data: Partial<HeldStep> }) => {
        if (step) Object.assign(step, data);
        return step;
      }),
      count: vi.fn(async () => stillOpen),
    },
    task: {
      update: vi.fn(async ({ data }: { data: { status: string } }) => {
        if (task) task.status = data.status;
        return task;
      }),
    },
    dispute: { count: vi.fn(async () => openDisputes) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('releaseHeldStep', () => {
  it('releases a held step and enqueues settlement when undisputed', async () => {
    const step: HeldStep = {
      id: 's1',
      status: 'AWAITING_APPROVAL',
      serviceId: 'svc1',
      task: { id: 't1', status: 'RUNNING', buyerId: 'u1', vaultTaskId: '7' },
    };
    const enqueueSettle = vi.fn(async () => {});
    const res = await releaseHeldStep(mockReleasePrisma(step), 's1', { enqueueSettle });
    expect(res.status).toBe('released');
    expect(step.status).toBe('RELEASED');
    expect(enqueueSettle).toHaveBeenCalledWith('s1');
  });

  it('does not release while a dispute is open (window paused)', async () => {
    const step: HeldStep = {
      id: 's1',
      status: 'AWAITING_APPROVAL',
      serviceId: 'svc1',
      task: { id: 't1', status: 'RUNNING', buyerId: 'u1', vaultTaskId: '7' },
    };
    const enqueueSettle = vi.fn(async () => {});
    const res = await releaseHeldStep(mockReleasePrisma(step, 1), 's1', { enqueueSettle });
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('dispute open');
    expect(step.status).toBe('AWAITING_APPROVAL'); // untouched
    expect(enqueueSettle).not.toHaveBeenCalled();
  });

  it('no-ops a step that was already released (approved early)', async () => {
    const step: HeldStep = {
      id: 's1',
      status: 'RELEASED',
      serviceId: 'svc1',
      task: { id: 't1', status: 'RUNNING', buyerId: 'u1', vaultTaskId: '7' },
    };
    const enqueueSettle = vi.fn(async () => {});
    const res = await releaseHeldStep(mockReleasePrisma(step), 's1', { enqueueSettle });
    expect(res.status).toBe('skipped');
    expect(enqueueSettle).not.toHaveBeenCalled();
  });

  it('does not release on a disputed task', async () => {
    const step: HeldStep = {
      id: 's1',
      status: 'AWAITING_APPROVAL',
      serviceId: 'svc1',
      task: { id: 't1', status: 'DISPUTED', buyerId: 'u1', vaultTaskId: '7' },
    };
    const res = await releaseHeldStep(mockReleasePrisma(step), 's1', { enqueueSettle: vi.fn() });
    expect(res.status).toBe('skipped');
    expect(step.status).toBe('AWAITING_APPROVAL');
  });

  it('completes an off-chain task (no vault) once no step is still open', async () => {
    const step: HeldStep = {
      id: 's1',
      status: 'AWAITING_APPROVAL',
      serviceId: 'svc1',
      task: { id: 't1', status: 'RUNNING', buyerId: 'u1', vaultTaskId: null },
    };
    const enqueueSettle = vi.fn(async () => {});
    const res = await releaseHeldStep(mockReleasePrisma(step, 0, 0), 's1', { enqueueSettle });
    expect(res.status).toBe('released');
    expect(step.status).toBe('RELEASED');
    expect(step.task?.status).toBe('COMPLETED');
    expect(enqueueSettle).not.toHaveBeenCalled(); // no on-chain settlement
  });
});

describe('isAcceptableOutput', () => {
  it('accepts non-empty plain text and JSON without an error field', () => {
    expect(isAcceptableOutput('result-body')).toBe(true);
    expect(isAcceptableOutput(JSON.stringify({ price: '0.10' }))).toBe(true);
    expect(isAcceptableOutput(JSON.stringify({ error: null }))).toBe(true);
  });

  it('rejects empty output and a soft JSON error', () => {
    expect(isAcceptableOutput('')).toBe(false);
    expect(isAcceptableOutput('   ')).toBe(false);
    expect(isAcceptableOutput(JSON.stringify({ error: 'boom' }))).toBe(false);
  });
});
