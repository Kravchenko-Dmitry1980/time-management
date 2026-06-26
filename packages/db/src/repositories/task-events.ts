import type { TaskEventRecord, TaskEventWriter } from '@time-management/core';

import { taskEvents } from '../schema.js';

type TaskEventInsertValues = {
  id: string;
  workspaceId: string;
  taskId: string;
  userId: string | null;
  eventType: TaskEventRecord['eventType'];
  oldValue: TaskEventRecord['oldValue'];
  newValue: TaskEventRecord['newValue'];
  metadata: TaskEventRecord['metadata'];
  createdAt: Date;
};

export interface TaskEventDatabase {
  insert(table: typeof taskEvents): {
    values(values: TaskEventInsertValues): Promise<unknown>;
  };
}

export function createTaskEventWriter(db: TaskEventDatabase): TaskEventWriter {
  return {
    async insertTaskEvent(event) {
      await db.insert(taskEvents).values({
        id: event.id,
        workspaceId: event.workspaceId,
        taskId: event.taskId,
        userId: event.userId,
        eventType: event.eventType,
        oldValue: event.oldValue,
        newValue: event.newValue,
        metadata: event.metadata,
        createdAt: event.createdAt,
      });
    },
  };
}
