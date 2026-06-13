export const workerAppName = '@time-management/worker' as const;

export function createWorkerStub(): { status: 'skeleton' } {
  return { status: 'skeleton' };
}
