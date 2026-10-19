import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { config, isDemo } from '../config';
import { useSession } from '../store/session';

/**
 * Subscribe to server-pushed updates over WebSocket (full mode only). The worker
 * emits `task.updated` when a job finishes and `job.paid` when a provider is paid;
 * the API emits `dispute.opened` / `dispute.resolved`. We refetch the affected
 * queries so the UI reflects it instantly instead of waiting for the poll. The
 * socket is authenticated with the access token and scoped to the user's room.
 */
export function useRealtime(): void {
  const qc = useQueryClient();
  const token = useSession((s) => s.session?.accessToken ?? null);

  useEffect(() => {
    if (isDemo() || !token) return;
    const socket = io(config.apiUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    });
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['vault'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    };
    const refreshProofs = () => qc.invalidateQueries({ queryKey: ['proof'] });
    // A provider got paid: refresh their earnings, jobs, and trust signals.
    const refreshProvider = () => {
      qc.invalidateQueries({ queryKey: ['provider-earnings'] });
      qc.invalidateQueries({ queryKey: ['provider-jobs'] });
      qc.invalidateQueries({ queryKey: ['provider-services'] });
    };
    // A dispute changed: refresh every dispute inbox plus tasks/activity.
    const refreshDisputes = () => {
      qc.invalidateQueries({ queryKey: ['disputes'] });
      qc.invalidateQueries({ queryKey: ['provider-disputes'] });
      qc.invalidateQueries({ queryKey: ['admin-disputes'] });
      refresh();
    };
    socket.on('task.updated', refresh);
    socket.on('proof.updated', refreshProofs);
    socket.on('job.paid', refreshProvider);
    socket.on('dispute.opened', refreshDisputes);
    socket.on('dispute.resolved', refreshDisputes);
    return () => {
      socket.off('task.updated', refresh);
      socket.off('proof.updated', refreshProofs);
      socket.off('job.paid', refreshProvider);
      socket.off('dispute.opened', refreshDisputes);
      socket.off('dispute.resolved', refreshDisputes);
      socket.disconnect();
    };
  }, [token, qc]);
}
