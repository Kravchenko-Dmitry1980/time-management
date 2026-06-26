import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import {
  categories,
  projects,
  projectMembers,
  spaces,
  spaceMembers,
  tags,
  taskEvents,
  tasks,
  taskTags,
  users,
  userSettings,
  workspaceMembers,
  workspaces,
} from './schema.js';

const PASSWORD_HASH_PLACEHOLDER = 'dev_placeholder_hash_not_for_login';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const updatedAt = createdAt;
const joinedAt = createdAt;
const disabledAt = new Date('2026-01-01T01:00:00.000Z');
const completedAt = new Date('2026-01-02T12:00:00.000Z');
const deletedAt = new Date('2026-01-03T12:00:00.000Z');

const excluded = (columnName: string) => sql.raw(`excluded.${columnName}`);

const ids = {
  users: {
    owner: '00000000-0000-4000-8000-000000000101',
    familyMember: '00000000-0000-4000-8000-000000000102',
    workPartner: '00000000-0000-4000-8000-000000000103',
    guest: '00000000-0000-4000-8000-000000000104',
    externalUser: '00000000-0000-4000-8000-000000000105',
    disabledUser: '00000000-0000-4000-8000-000000000106',
  },
  workspace: '00000000-0000-4000-8000-000000000201',
  workspaceMembers: {
    owner: '00000000-0000-4000-8000-000000000301',
    familyMember: '00000000-0000-4000-8000-000000000302',
    workPartner: '00000000-0000-4000-8000-000000000303',
    guest: '00000000-0000-4000-8000-000000000304',
  },
  spaces: {
    private: '00000000-0000-4000-8000-000000000401',
    family: '00000000-0000-4000-8000-000000000402',
    work: '00000000-0000-4000-8000-000000000403',
  },
  spaceMembers: {
    privateOwner: '00000000-0000-4000-8000-000000000501',
    familyOwner: '00000000-0000-4000-8000-000000000502',
    familyMember: '00000000-0000-4000-8000-000000000503',
    workOwner: '00000000-0000-4000-8000-000000000504',
    workPartner: '00000000-0000-4000-8000-000000000505',
    workGuest: '00000000-0000-4000-8000-000000000506',
  },
  projects: {
    workX: '00000000-0000-4000-8000-000000000601',
    family: '00000000-0000-4000-8000-000000000602',
  },
  projectMembers: {
    workOwner: '00000000-0000-4000-8000-000000000701',
    workPartner: '00000000-0000-4000-8000-000000000702',
    familyOwner: '00000000-0000-4000-8000-000000000703',
    familyMember: '00000000-0000-4000-8000-000000000704',
  },
  categories: {
    work: '00000000-0000-4000-8000-000000000801',
    family: '00000000-0000-4000-8000-000000000802',
    personal: '00000000-0000-4000-8000-000000000803',
  },
  tags: {
    urgent: '00000000-0000-4000-8000-000000000901',
    call: '00000000-0000-4000-8000-000000000902',
    aiCandidate: '00000000-0000-4000-8000-000000000903',
  },
  tasks: {
    privateOwner: '00000000-0000-4000-8000-000000001001',
    familyVisible: '00000000-0000-4000-8000-000000001002',
    workProject: '00000000-0000-4000-8000-000000001003',
    privateInsideProject: '00000000-0000-4000-8000-000000001004',
    completed: '00000000-0000-4000-8000-000000001005',
    softDeleted: '00000000-0000-4000-8000-000000001006',
  },
  taskEvents: {
    privateOwnerCreated: '00000000-0000-4000-8000-000000001101',
    familyVisibleCreated: '00000000-0000-4000-8000-000000001102',
    workProjectCreated: '00000000-0000-4000-8000-000000001103',
    privateInsideProjectCreated: '00000000-0000-4000-8000-000000001104',
    completedCreated: '00000000-0000-4000-8000-000000001105',
    softDeletedCreated: '00000000-0000-4000-8000-000000001106',
    completed: '00000000-0000-4000-8000-000000001107',
    softDeleted: '00000000-0000-4000-8000-000000001108',
  },
} as const;

export async function seedDevelopmentData(connectionString: string): Promise<void> {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to seed development data');
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(users)
        .values([
          {
            id: ids.users.owner,
            email: 'owner@example.com',
            passwordHash: PASSWORD_HASH_PLACEHOLDER,
            name: 'Owner User',
            status: 'active',
            createdAt,
            updatedAt,
          },
          {
            id: ids.users.familyMember,
            email: 'family.member@example.com',
            passwordHash: PASSWORD_HASH_PLACEHOLDER,
            name: 'Family Member',
            status: 'active',
            createdAt,
            updatedAt,
          },
          {
            id: ids.users.workPartner,
            email: 'work.partner@example.com',
            passwordHash: PASSWORD_HASH_PLACEHOLDER,
            name: 'Work Partner',
            status: 'active',
            createdAt,
            updatedAt,
          },
          {
            id: ids.users.guest,
            email: 'guest@example.com',
            passwordHash: PASSWORD_HASH_PLACEHOLDER,
            name: 'Guest User',
            status: 'active',
            createdAt,
            updatedAt,
          },
          {
            id: ids.users.externalUser,
            email: 'external.user@example.com',
            passwordHash: PASSWORD_HASH_PLACEHOLDER,
            name: 'External User',
            status: 'active',
            createdAt,
            updatedAt,
          },
          {
            id: ids.users.disabledUser,
            email: 'disabled@example.com',
            passwordHash: PASSWORD_HASH_PLACEHOLDER,
            name: 'Disabled User',
            status: 'disabled',
            createdAt,
            updatedAt,
            disabledAt,
          },
        ])
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: excluded('email'),
            passwordHash: excluded('password_hash'),
            name: excluded('name'),
            status: excluded('status'),
            disabledAt: excluded('disabled_at'),
            archivedAt: excluded('archived_at'),
            updatedAt: excluded('updated_at'),
          },
        });

      await tx
        .insert(userSettings)
        .values(
          [
            ids.users.owner,
            ids.users.familyMember,
            ids.users.workPartner,
            ids.users.guest,
            ids.users.externalUser,
            ids.users.disabledUser,
          ].map((userId) => ({
            userId,
            timezone: 'Europe/Moscow',
            locale: 'ru',
            notificationPreferences: {},
            aiConfirmationMode: 'confirm_on_low_confidence',
            aiConfidenceThreshold: '0.75',
            createdAt,
            updatedAt,
          })),
        )
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: {
            timezone: excluded('timezone'),
            locale: excluded('locale'),
            notificationPreferences: excluded('notification_preferences'),
            aiConfirmationMode: excluded('ai_confirmation_mode'),
            aiConfidenceThreshold: excluded('ai_confidence_threshold'),
            updatedAt: excluded('updated_at'),
          },
        });

      await tx
        .insert(workspaces)
        .values({
          id: ids.workspace,
          name: 'Dev Workspace',
          ownerId: ids.users.owner,
          defaultTimezone: 'Europe/Moscow',
          settings: {},
          createdAt,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: workspaces.id,
          set: {
            name: 'Dev Workspace',
            ownerId: ids.users.owner,
            defaultTimezone: 'Europe/Moscow',
            settings: {},
            updatedAt,
          },
        });

      await tx
        .insert(workspaceMembers)
        .values([
          {
            id: ids.workspaceMembers.owner,
            workspaceId: ids.workspace,
            userId: ids.users.owner,
            role: 'owner',
            status: 'active',
            joinedAt,
            createdAt,
            updatedAt,
          },
          {
            id: ids.workspaceMembers.familyMember,
            workspaceId: ids.workspace,
            userId: ids.users.familyMember,
            role: 'member',
            status: 'active',
            invitedBy: ids.users.owner,
            joinedAt,
            createdAt,
            updatedAt,
          },
          {
            id: ids.workspaceMembers.workPartner,
            workspaceId: ids.workspace,
            userId: ids.users.workPartner,
            role: 'member',
            status: 'active',
            invitedBy: ids.users.owner,
            joinedAt,
            createdAt,
            updatedAt,
          },
          {
            id: ids.workspaceMembers.guest,
            workspaceId: ids.workspace,
            userId: ids.users.guest,
            role: 'guest',
            status: 'active',
            invitedBy: ids.users.owner,
            joinedAt,
            createdAt,
            updatedAt,
          },
        ])
        .onConflictDoUpdate({
          target: workspaceMembers.id,
          set: {
            workspaceId: excluded('workspace_id'),
            userId: excluded('user_id'),
            role: excluded('role'),
            status: excluded('status'),
            invitedBy: excluded('invited_by'),
            joinedAt: excluded('joined_at'),
            updatedAt: excluded('updated_at'),
          },
        });

      await tx
        .insert(spaces)
        .values([
          {
            id: ids.spaces.private,
            workspaceId: ids.workspace,
            name: 'Private',
            type: 'private',
            visibility: 'private',
            createdBy: ids.users.owner,
            createdAt,
            updatedAt,
          },
          {
            id: ids.spaces.family,
            workspaceId: ids.workspace,
            name: 'Family',
            type: 'family',
            visibility: 'members',
            createdBy: ids.users.owner,
            createdAt,
            updatedAt,
          },
          {
            id: ids.spaces.work,
            workspaceId: ids.workspace,
            name: 'Work',
            type: 'work',
            visibility: 'members',
            createdBy: ids.users.owner,
            createdAt,
            updatedAt,
          },
        ])
        .onConflictDoUpdate({
          target: spaces.id,
          set: {
            workspaceId: excluded('workspace_id'),
            name: excluded('name'),
            type: excluded('type'),
            visibility: excluded('visibility'),
            createdBy: excluded('created_by'),
            archivedAt: excluded('archived_at'),
            updatedAt: excluded('updated_at'),
          },
        });

      await tx
        .insert(spaceMembers)
        .values([
          {
            id: ids.spaceMembers.privateOwner,
            spaceId: ids.spaces.private,
            userId: ids.users.owner,
            role: 'owner',
            status: 'active',
            joinedAt,
            createdAt,
            updatedAt,
          },
          {
            id: ids.spaceMembers.familyOwner,
            spaceId: ids.spaces.family,
            userId: ids.users.owner,
            role: 'owner',
            status: 'active',
            joinedAt,
            createdAt,
            updatedAt,
          },
          {
            id: ids.spaceMembers.familyMember,
            spaceId: ids.spaces.family,
            userId: ids.users.familyMember,
            role: 'member',
            status: 'active',
            invitedBy: ids.users.owner,
            joinedAt,
            createdAt,
            updatedAt,
          },
          {
            id: ids.spaceMembers.workOwner,
            spaceId: ids.spaces.work,
            userId: ids.users.owner,
            role: 'owner',
            status: 'active',
            joinedAt,
            createdAt,
            updatedAt,
          },
          {
            id: ids.spaceMembers.workPartner,
            spaceId: ids.spaces.work,
            userId: ids.users.workPartner,
            role: 'member',
            status: 'active',
            invitedBy: ids.users.owner,
            joinedAt,
            createdAt,
            updatedAt,
          },
          {
            id: ids.spaceMembers.workGuest,
            spaceId: ids.spaces.work,
            userId: ids.users.guest,
            role: 'guest',
            status: 'active',
            invitedBy: ids.users.owner,
            joinedAt,
            createdAt,
            updatedAt,
          },
        ])
        .onConflictDoUpdate({
          target: spaceMembers.id,
          set: {
            spaceId: excluded('space_id'),
            userId: excluded('user_id'),
            role: excluded('role'),
            status: excluded('status'),
            invitedBy: excluded('invited_by'),
            joinedAt: excluded('joined_at'),
            updatedAt: excluded('updated_at'),
          },
        });

      await tx
        .insert(projects)
        .values([
          {
            id: ids.projects.workX,
            workspaceId: ids.workspace,
            spaceId: ids.spaces.work,
            ownerId: ids.users.owner,
            name: 'Work Project X',
            status: 'active',
            createdAt,
            updatedAt,
          },
          {
            id: ids.projects.family,
            workspaceId: ids.workspace,
            spaceId: ids.spaces.family,
            ownerId: ids.users.owner,
            name: 'Family Project',
            status: 'active',
            createdAt,
            updatedAt,
          },
        ])
        .onConflictDoUpdate({
          target: projects.id,
          set: {
            workspaceId: excluded('workspace_id'),
            spaceId: excluded('space_id'),
            ownerId: excluded('owner_id'),
            goalId: excluded('goal_id'),
            name: excluded('name'),
            description: excluded('description'),
            status: excluded('status'),
            startDate: excluded('start_date'),
            dueDate: excluded('due_date'),
            archivedAt: excluded('archived_at'),
            deletedAt: excluded('deleted_at'),
            updatedAt: excluded('updated_at'),
          },
        });

      await tx
        .insert(projectMembers)
        .values([
          {
            id: ids.projectMembers.workOwner,
            projectId: ids.projects.workX,
            userId: ids.users.owner,
            role: 'owner',
            status: 'active',
            joinedAt,
            createdAt,
            updatedAt,
          },
          {
            id: ids.projectMembers.workPartner,
            projectId: ids.projects.workX,
            userId: ids.users.workPartner,
            role: 'member',
            status: 'active',
            invitedBy: ids.users.owner,
            joinedAt,
            createdAt,
            updatedAt,
          },
          {
            id: ids.projectMembers.familyOwner,
            projectId: ids.projects.family,
            userId: ids.users.owner,
            role: 'owner',
            status: 'active',
            joinedAt,
            createdAt,
            updatedAt,
          },
          {
            id: ids.projectMembers.familyMember,
            projectId: ids.projects.family,
            userId: ids.users.familyMember,
            role: 'member',
            status: 'active',
            invitedBy: ids.users.owner,
            joinedAt,
            createdAt,
            updatedAt,
          },
        ])
        .onConflictDoUpdate({
          target: projectMembers.id,
          set: {
            projectId: excluded('project_id'),
            userId: excluded('user_id'),
            role: excluded('role'),
            status: excluded('status'),
            invitedBy: excluded('invited_by'),
            joinedAt: excluded('joined_at'),
            updatedAt: excluded('updated_at'),
          },
        });

      await tx
        .insert(categories)
        .values([
          {
            id: ids.categories.work,
            workspaceId: ids.workspace,
            name: 'Work',
            createdBy: ids.users.owner,
            createdAt,
            updatedAt,
          },
          {
            id: ids.categories.family,
            workspaceId: ids.workspace,
            name: 'Family',
            createdBy: ids.users.owner,
            createdAt,
            updatedAt,
          },
          {
            id: ids.categories.personal,
            workspaceId: ids.workspace,
            name: 'Personal',
            createdBy: ids.users.owner,
            createdAt,
            updatedAt,
          },
        ])
        .onConflictDoUpdate({
          target: categories.id,
          set: {
            workspaceId: excluded('workspace_id'),
            name: excluded('name'),
            color: excluded('color'),
            icon: excluded('icon'),
            createdBy: excluded('created_by'),
            updatedAt: excluded('updated_at'),
          },
        });

      await tx
        .insert(tags)
        .values([
          {
            id: ids.tags.urgent,
            workspaceId: ids.workspace,
            name: 'urgent',
            createdAt,
            updatedAt,
          },
          {
            id: ids.tags.call,
            workspaceId: ids.workspace,
            name: 'call',
            createdAt,
            updatedAt,
          },
          {
            id: ids.tags.aiCandidate,
            workspaceId: ids.workspace,
            name: 'ai_candidate',
            createdAt,
            updatedAt,
          },
        ])
        .onConflictDoUpdate({
          target: tags.id,
          set: {
            workspaceId: excluded('workspace_id'),
            name: excluded('name'),
            updatedAt: excluded('updated_at'),
          },
        });

      await tx
        .insert(tasks)
        .values([
          {
            id: ids.tasks.privateOwner,
            workspaceId: ids.workspace,
            spaceId: ids.spaces.private,
            createdBy: ids.users.owner,
            ownerId: ids.users.owner,
            assigneeId: ids.users.owner,
            categoryId: ids.categories.personal,
            title: 'Private owner task',
            status: 'inbox',
            visibility: 'private',
            source: 'manual',
            createdAt,
            updatedAt,
          },
          {
            id: ids.tasks.familyVisible,
            workspaceId: ids.workspace,
            spaceId: ids.spaces.family,
            projectId: ids.projects.family,
            createdBy: ids.users.owner,
            ownerId: ids.users.owner,
            assigneeId: ids.users.familyMember,
            categoryId: ids.categories.family,
            title: 'Family shared task',
            status: 'planned',
            visibility: 'space',
            source: 'manual',
            createdAt,
            updatedAt,
          },
          {
            id: ids.tasks.workProject,
            workspaceId: ids.workspace,
            spaceId: ids.spaces.work,
            projectId: ids.projects.workX,
            createdBy: ids.users.owner,
            ownerId: ids.users.owner,
            assigneeId: ids.users.workPartner,
            categoryId: ids.categories.work,
            title: 'Work project task',
            status: 'planned',
            visibility: 'project',
            source: 'manual',
            createdAt,
            updatedAt,
          },
          {
            id: ids.tasks.privateInsideProject,
            workspaceId: ids.workspace,
            spaceId: ids.spaces.work,
            projectId: ids.projects.workX,
            createdBy: ids.users.owner,
            ownerId: ids.users.owner,
            assigneeId: ids.users.owner,
            categoryId: ids.categories.work,
            title: 'Private task inside work project',
            status: 'planned',
            visibility: 'private',
            source: 'manual',
            createdAt,
            updatedAt,
          },
          {
            id: ids.tasks.completed,
            workspaceId: ids.workspace,
            spaceId: ids.spaces.work,
            projectId: ids.projects.workX,
            createdBy: ids.users.owner,
            ownerId: ids.users.owner,
            assigneeId: ids.users.workPartner,
            categoryId: ids.categories.work,
            title: 'Completed dev seed task',
            status: 'done',
            visibility: 'space',
            source: 'manual',
            completedAt,
            createdAt,
            updatedAt,
          },
          {
            id: ids.tasks.softDeleted,
            workspaceId: ids.workspace,
            spaceId: ids.spaces.work,
            createdBy: ids.users.owner,
            ownerId: ids.users.owner,
            assigneeId: ids.users.owner,
            categoryId: ids.categories.personal,
            title: 'Soft deleted dev seed task',
            status: 'planned',
            visibility: 'private',
            source: 'manual',
            deletedAt,
            createdAt,
            updatedAt,
          },
        ])
        .onConflictDoUpdate({
          target: tasks.id,
          set: {
            workspaceId: excluded('workspace_id'),
            spaceId: excluded('space_id'),
            projectId: excluded('project_id'),
            parentTaskId: excluded('parent_task_id'),
            goalId: excluded('goal_id'),
            createdBy: excluded('created_by'),
            ownerId: excluded('owner_id'),
            assigneeId: excluded('assignee_id'),
            categoryId: excluded('category_id'),
            title: excluded('title'),
            description: excluded('description'),
            status: excluded('status'),
            visibility: excluded('visibility'),
            source: excluded('source'),
            importanceScore: excluded('importance_score'),
            urgencyScore: excluded('urgency_score'),
            eisenhowerQuadrant: excluded('eisenhower_quadrant'),
            dueAt: excluded('due_at'),
            scheduledFor: excluded('scheduled_for'),
            startedAt: excluded('started_at'),
            completedAt: excluded('completed_at'),
            canceledAt: excluded('canceled_at'),
            aiConfidence: excluded('ai_confidence'),
            aiClassificationStatus: excluded('ai_classification_status'),
            recurrenceRuleId: excluded('recurrence_rule_id'),
            deletedAt: excluded('deleted_at'),
            updatedAt: excluded('updated_at'),
          },
        });

      await tx
        .insert(taskTags)
        .values([
          { taskId: ids.tasks.workProject, tagId: ids.tags.urgent, createdAt },
          { taskId: ids.tasks.privateOwner, tagId: ids.tags.call, createdAt },
          { taskId: ids.tasks.privateInsideProject, tagId: ids.tags.aiCandidate, createdAt },
        ])
        .onConflictDoNothing();

      await tx
        .insert(taskEvents)
        .values([
          {
            id: ids.taskEvents.privateOwnerCreated,
            workspaceId: ids.workspace,
            taskId: ids.tasks.privateOwner,
            userId: ids.users.owner,
            eventType: 'task_created',
            metadata: { task_id: ids.tasks.privateOwner },
            createdAt,
          },
          {
            id: ids.taskEvents.familyVisibleCreated,
            workspaceId: ids.workspace,
            taskId: ids.tasks.familyVisible,
            userId: ids.users.owner,
            eventType: 'task_created',
            metadata: { task_id: ids.tasks.familyVisible },
            createdAt,
          },
          {
            id: ids.taskEvents.workProjectCreated,
            workspaceId: ids.workspace,
            taskId: ids.tasks.workProject,
            userId: ids.users.owner,
            eventType: 'task_created',
            metadata: { task_id: ids.tasks.workProject },
            createdAt,
          },
          {
            id: ids.taskEvents.privateInsideProjectCreated,
            workspaceId: ids.workspace,
            taskId: ids.tasks.privateInsideProject,
            userId: ids.users.owner,
            eventType: 'task_created',
            metadata: { task_id: ids.tasks.privateInsideProject },
            createdAt,
          },
          {
            id: ids.taskEvents.completedCreated,
            workspaceId: ids.workspace,
            taskId: ids.tasks.completed,
            userId: ids.users.owner,
            eventType: 'task_created',
            metadata: { task_id: ids.tasks.completed },
            createdAt,
          },
          {
            id: ids.taskEvents.softDeletedCreated,
            workspaceId: ids.workspace,
            taskId: ids.tasks.softDeleted,
            userId: ids.users.owner,
            eventType: 'task_created',
            metadata: { task_id: ids.tasks.softDeleted },
            createdAt,
          },
          {
            id: ids.taskEvents.completed,
            workspaceId: ids.workspace,
            taskId: ids.tasks.completed,
            userId: ids.users.owner,
            eventType: 'task_completed',
            metadata: { task_id: ids.tasks.completed },
            createdAt: completedAt,
          },
          {
            id: ids.taskEvents.softDeleted,
            workspaceId: ids.workspace,
            taskId: ids.tasks.softDeleted,
            userId: ids.users.owner,
            eventType: 'task_deleted',
            metadata: { task_id: ids.tasks.softDeleted },
            createdAt: deletedAt,
          },
        ])
        .onConflictDoNothing();
    });
  } finally {
    await pool.end();
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];

  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('DATABASE_URL is required to seed development data');
    process.exit(1);
  }

  seedDevelopmentData(connectionString).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Development seed failed');
    process.exit(1);
  });
}
