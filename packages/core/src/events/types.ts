export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const TASK_EVENT_TYPES = [
  'task_created',
  'task_updated',
  'task_completed',
  'task_reopened',
  'task_rescheduled',
  'task_deleted',
  'task_restored',
  'task_delegated',
  'task_moved_to_space',
  'task_moved_to_project',
  'priority_changed',
  'quadrant_changed',
  'reminder_created',
  'reminder_sent',
  'recurrence_generated',
  'ai_classified',
  'ai_classification_corrected',
  'comment_added',
] as const;

export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export interface RecordTaskEventInput {
  workspaceId: string;
  taskId: string;
  userId: string | null;
  eventType: TaskEventType;
  oldValue?: JsonValue;
  newValue?: JsonValue;
  metadata?: JsonValue;
}

export interface TaskEventRecord {
  id: string;
  workspaceId: string;
  taskId: string;
  userId: string | null;
  eventType: TaskEventType;
  oldValue: JsonValue | null;
  newValue: JsonValue | null;
  metadata: JsonValue | null;
  createdAt: Date;
}

export interface TaskEventWriter {
  insertTaskEvent(event: TaskEventRecord): Promise<void>;
}

export interface EventServiceDependencies {
  writer: TaskEventWriter;
  idGenerator: () => string;
  now: () => Date;
}
