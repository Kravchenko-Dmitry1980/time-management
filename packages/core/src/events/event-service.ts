import {
  type EventServiceDependencies,
  type JsonValue,
  type RecordTaskEventInput,
  TASK_EVENT_TYPES,
  type TaskEventRecord,
  type TaskEventType,
} from './types.js';

export class InvalidTaskEventInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTaskEventInputError';
  }
}

export class UnsafeTaskEventMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTaskEventMetadataError';
  }
}

const taskEventTypes = new Set<string>(TASK_EVENT_TYPES);

const unsafeMetadataKeys = new Set([
  'comment_body',
  'body',
  'task_title',
  'title',
  'task_description',
  'description',
  'raw_ai_prompt',
  'raw_ai_output',
  'raw_provider_payload',
  'transcript',
  'transcript_text',
  'audio',
  'password',
  'token',
  'secret',
  'api_key',
]);

export class EventService {
  constructor(private readonly dependencies: EventServiceDependencies) {}

  async recordTaskEvent(input: RecordTaskEventInput): Promise<TaskEventRecord> {
    validateRequiredId(input.workspaceId, 'workspaceId');
    validateRequiredId(input.taskId, 'taskId');

    if (input.userId !== null) {
      validateRequiredId(input.userId, 'userId');
    }

    validateTaskEventType(input.eventType);

    const oldValue = normalizeOptionalJsonValue(input.oldValue, 'oldValue');
    const newValue = normalizeOptionalJsonValue(input.newValue, 'newValue');
    const metadata = normalizeOptionalJsonValue(input.metadata, 'metadata');

    if (metadata !== null) {
      validateMetadataSafety(metadata);
    }

    const event: TaskEventRecord = {
      id: this.dependencies.idGenerator(),
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      userId: input.userId,
      eventType: input.eventType,
      oldValue,
      newValue,
      metadata,
      createdAt: this.dependencies.now(),
    };

    validateRequiredId(event.id, 'id');

    // EventService does not open transactions. The caller must provide a writer
    // bound to the current DB transaction so task mutation and TaskEvent write
    // are committed or rolled back together.
    await this.dependencies.writer.insertTaskEvent(event);

    return event;
  }
}

function validateRequiredId(value: string, fieldName: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidTaskEventInputError(`${fieldName} must be a non-empty string`);
  }
}

function validateTaskEventType(eventType: TaskEventType): void {
  if (!taskEventTypes.has(eventType)) {
    throw new InvalidTaskEventInputError(`Unsupported task event type: ${String(eventType)}`);
  }
}

function normalizeOptionalJsonValue(
  value: JsonValue | undefined,
  fieldName: string,
): JsonValue | null {
  if (value === undefined) {
    return null;
  }

  validateJsonValue(value, fieldName);

  return value;
}

function validateJsonValue(value: unknown, fieldName: string, seen = new WeakSet<object>()): void {
  if (value === null) {
    return;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new InvalidTaskEventInputError(`${fieldName} must be JSON-compatible`);
    }

    return;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new InvalidTaskEventInputError(`${fieldName} must be JSON-compatible`);
    }

    seen.add(value);
    value.forEach((item, index) => validateJsonValue(item, `${fieldName}[${index}]`, seen));
    seen.delete(value);

    return;
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);

    if (prototype !== Object.prototype && prototype !== null) {
      throw new InvalidTaskEventInputError(`${fieldName} must be JSON-compatible`);
    }

    if (seen.has(value)) {
      throw new InvalidTaskEventInputError(`${fieldName} must be JSON-compatible`);
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new InvalidTaskEventInputError(`${fieldName} must be JSON-compatible`);
    }

    seen.add(value);

    for (const [key, nestedValue] of Object.entries(value)) {
      validateJsonValue(nestedValue, `${fieldName}.${key}`, seen);
    }

    seen.delete(value);

    return;
  }

  throw new InvalidTaskEventInputError(`${fieldName} must be JSON-compatible`);
}

function validateMetadataSafety(metadata: JsonValue, seen = new WeakSet<object>()): void {
  if (metadata === null || typeof metadata !== 'object') {
    return;
  }

  if (seen.has(metadata)) {
    return;
  }

  seen.add(metadata);

  if (Array.isArray(metadata)) {
    metadata.forEach((item) => validateMetadataSafety(item, seen));
    seen.delete(metadata);

    return;
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (unsafeMetadataKeys.has(normalizeMetadataKey(key))) {
      throw new UnsafeTaskEventMetadataError(`Task event metadata contains unsafe key: ${key}`);
    }

    validateMetadataSafety(value, seen);
  }

  seen.delete(metadata);
}

function normalizeMetadataKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}
