import { describe, expect, it } from 'vitest';

import {
  EventService,
  InvalidTaskEventInputError,
  UnsafeTaskEventMetadataError,
} from './event-service.js';
import type { RecordTaskEventInput, TaskEventRecord, TaskEventWriter } from './types.js';

const fixedId = '00000000-0000-4000-8000-000000009001';
const fixedNow = new Date('2026-01-01T00:00:00.000Z');

function createFakeWriter(): TaskEventWriter & { events: TaskEventRecord[] } {
  return {
    events: [],
    async insertTaskEvent(event) {
      this.events.push(event);
    },
  };
}

function createService(writer: TaskEventWriter): EventService {
  return new EventService({
    writer,
    idGenerator: () => fixedId,
    now: () => fixedNow,
  });
}

function createInput(overrides: Partial<RecordTaskEventInput> = {}): RecordTaskEventInput {
  return {
    workspaceId: '00000000-0000-4000-8000-000000000201',
    taskId: '00000000-0000-4000-8000-000000001001',
    userId: '00000000-0000-4000-8000-000000000101',
    eventType: 'task_created',
    ...overrides,
  };
}

describe('EventService', () => {
  it('records event', async () => {
    const writer = createFakeWriter();
    const service = createService(writer);

    const event = await service.recordTaskEvent(createInput());

    expect(writer.events).toHaveLength(1);
    expect(writer.events[0]).toBe(event);
    expect(event).toMatchObject({
      id: fixedId,
      workspaceId: '00000000-0000-4000-8000-000000000201',
      taskId: '00000000-0000-4000-8000-000000001001',
      userId: '00000000-0000-4000-8000-000000000101',
      eventType: 'task_created',
      oldValue: null,
      newValue: null,
      metadata: null,
    });
    expect(event.createdAt).toBe(fixedNow);
  });

  it('allows null userId', async () => {
    const writer = createFakeWriter();
    const service = createService(writer);

    const event = await service.recordTaskEvent(createInput({ userId: null }));

    expect(event.userId).toBeNull();
    expect(writer.events).toHaveLength(1);
  });

  it('rejects missing IDs', async () => {
    const writer = createFakeWriter();
    const service = createService(writer);

    await expect(service.recordTaskEvent(createInput({ workspaceId: '' }))).rejects.toBeInstanceOf(
      InvalidTaskEventInputError,
    );
    await expect(service.recordTaskEvent(createInput({ taskId: '   ' }))).rejects.toBeInstanceOf(
      InvalidTaskEventInputError,
    );
    expect(writer.events).toHaveLength(0);
  });

  it('rejects unsafe metadata', async () => {
    const writer = createFakeWriter();
    const service = createService(writer);

    await expect(
      service.recordTaskEvent(createInput({ metadata: { comment_body: 'private text' } })),
    ).rejects.toBeInstanceOf(UnsafeTaskEventMetadataError);
    expect(writer.events).toHaveLength(0);
  });

  it('rejects nested unsafe metadata', async () => {
    const writer = createFakeWriter();
    const service = createService(writer);

    await expect(
      service.recordTaskEvent(createInput({ metadata: { nested: { raw_ai_prompt: 'secret' } } })),
    ).rejects.toBeInstanceOf(UnsafeTaskEventMetadataError);
    expect(writer.events).toHaveLength(0);
  });

  it('allows IDs-only metadata', async () => {
    const writer = createFakeWriter();
    const service = createService(writer);
    const metadata = {
      comment_id: '00000000-0000-4000-8000-000000002001',
      reminder_id: '00000000-0000-4000-8000-000000003001',
      attempt: 1,
    };

    const event = await service.recordTaskEvent(createInput({ metadata }));

    expect(event.metadata).toEqual(metadata);
    expect(writer.events).toHaveLength(1);
  });
});
