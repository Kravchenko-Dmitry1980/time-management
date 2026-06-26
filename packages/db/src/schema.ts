import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

function lower(column: AnyPgColumn) {
  return sql`lower(${column})`;
}

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const userStatusEnum = pgEnum('user_status', ['active', 'invited', 'disabled', 'archived']);

export const workspaceRoleEnum = pgEnum('workspace_role', ['owner', 'admin', 'member', 'guest']);

export const spaceTypeEnum = pgEnum('space_type', [
  'private',
  'family',
  'work',
  'partners',
  'public_limited',
  'system',
]);

export const spaceVisibilityEnum = pgEnum('space_visibility', ['private', 'members', 'restricted']);

export const memberRoleEnum = pgEnum('member_role', ['owner', 'admin', 'member', 'guest']);

export const memberStatusEnum = pgEnum('member_status', [
  'active',
  'invited',
  'suspended',
  'removed',
]);

export const projectStatusEnum = pgEnum('project_status', [
  'active',
  'paused',
  'completed',
  'archived',
]);

export const taskStatusEnum = pgEnum('task_status', [
  'inbox',
  'planned',
  'in_progress',
  'waiting',
  'done',
  'canceled',
  'archived',
]);

export const taskVisibilityEnum = pgEnum('task_visibility', [
  'private',
  'space',
  'project',
  'shared',
]);

export const taskSourceEnum = pgEnum('task_source', [
  'manual',
  'quick_add',
  'voice',
  'ai',
  'recurrence',
  'import_future',
]);

export const eisenhowerQuadrantEnum = pgEnum('eisenhower_quadrant', [
  'important_urgent',
  'important_not_urgent',
  'not_important_urgent',
  'not_important_not_urgent',
]);

export const taskEventTypeEnum = pgEnum('task_event_type', [
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
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    name: text('name').notNull(),
    avatarUrl: text('avatar_url'),
    status: userStatusEnum('status').notNull().default('active'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    disabledAt: timestamptz('disabled_at'),
    archivedAt: timestamptz('archived_at'),
  },
  (table) => [
    uniqueIndex('users_email_unique_idx').on(lower(table.email)),
    index('users_status_idx').on(table.status),
    check('users_email_not_empty_check', sql`length(trim(${table.email})) > 0`),
  ],
);

export const userSettings = pgTable(
  'user_settings',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    timezone: text('timezone').notNull().default('Europe/Moscow'),
    locale: text('locale').notNull().default('ru'),
    notificationPreferences: jsonb('notification_preferences').notNull().default({}),
    // TODO(API_CONTRACTS): replace text with enum/check when ai_confirmation_mode contract is finalized.
    aiConfirmationMode: text('ai_confirmation_mode').notNull().default('confirm_on_low_confidence'),
    aiConfidenceThreshold: numeric('ai_confidence_threshold', { precision: 3, scale: 2 })
      .notNull()
      .default('0.75'),
    morningDigestTime: time('morning_digest_time'),
    eveningReviewTime: time('evening_review_time'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'user_settings_ai_confidence_threshold_check',
      sql`${table.aiConfidenceThreshold} >= 0 AND ${table.aiConfidenceThreshold} <= 1`,
    ),
    check('user_settings_timezone_not_empty_check', sql`length(trim(${table.timezone})) > 0`),
  ],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    defaultTimezone: text('default_timezone').notNull().default('Europe/Moscow'),
    settings: jsonb('settings').notNull().default({}),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    archivedAt: timestamptz('archived_at'),
  },
  (table) => [
    index('workspaces_owner_id_idx').on(table.ownerId),
    index('workspaces_archived_at_idx').on(table.archivedAt),
    check('workspaces_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
  ],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRoleEnum('role').notNull(),
    status: memberStatusEnum('status').notNull().default('active'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    joinedAt: timestamptz('joined_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('workspace_members_workspace_user_unique').on(table.workspaceId, table.userId),
    index('workspace_members_workspace_id_idx').on(table.workspaceId),
    index('workspace_members_user_id_idx').on(table.userId),
    index('workspace_members_status_idx').on(table.status),
    index('workspace_members_role_idx').on(table.role),
    index('workspace_members_workspace_user_status_idx').on(
      table.workspaceId,
      table.userId,
      table.status,
    ),
    uniqueIndex('workspace_members_one_owner_idx')
      .on(table.workspaceId)
      .where(sql`${table.role} = 'owner' AND ${table.status} = 'active'`),
    uniqueIndex('workspace_members_active_membership_idx')
      .on(table.workspaceId, table.userId)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const spaces = pgTable(
  'spaces',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: spaceTypeEnum('type').notNull(),
    visibility: spaceVisibilityEnum('visibility').notNull().default('members'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    archivedAt: timestamptz('archived_at'),
  },
  (table) => [
    unique('spaces_workspace_name_unique').on(table.workspaceId, table.name),
    index('spaces_workspace_id_idx').on(table.workspaceId),
    index('spaces_created_by_idx').on(table.createdBy),
    index('spaces_type_idx').on(table.type),
    index('spaces_visibility_idx').on(table.visibility),
    index('spaces_archived_at_idx').on(table.archivedAt),
    check('spaces_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
  ],
);

export const spaceMembers = pgTable(
  'space_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('member'),
    status: memberStatusEnum('status').notNull().default('active'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    joinedAt: timestamptz('joined_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('space_members_space_user_unique').on(table.spaceId, table.userId),
    index('space_members_space_id_idx').on(table.spaceId),
    index('space_members_user_id_idx').on(table.userId),
    index('space_members_status_idx').on(table.status),
    index('space_members_role_idx').on(table.role),
    index('space_members_space_user_status_idx').on(table.spaceId, table.userId, table.status),
    uniqueIndex('space_members_active_membership_idx')
      .on(table.spaceId, table.userId)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    icon: text('icon'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('categories_workspace_name_unique_idx').on(table.workspaceId, lower(table.name)),
    index('categories_workspace_id_idx').on(table.workspaceId),
    check('categories_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tags_workspace_name_unique_idx').on(table.workspaceId, lower(table.name)),
    index('tags_workspace_id_idx').on(table.workspaceId),
    check('tags_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'restrict' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // Stage 1.1: nullable hook only; FK to goals will be added in a future stage.
    goalId: uuid('goal_id'),
    name: text('name').notNull(),
    description: text('description'),
    status: projectStatusEnum('status').notNull().default('active'),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    archivedAt: timestamptz('archived_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (table) => [
    index('projects_workspace_id_idx').on(table.workspaceId),
    index('projects_space_id_idx').on(table.spaceId),
    index('projects_owner_id_idx').on(table.ownerId),
    index('projects_status_idx').on(table.status),
    index('projects_due_date_idx').on(table.dueDate),
    index('projects_deleted_at_idx').on(table.deletedAt),
    check('projects_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
    check(
      'projects_date_range_check',
      sql`${table.startDate} IS NULL OR ${table.dueDate} IS NULL OR ${table.startDate} <= ${table.dueDate}`,
    ),
  ],
);

export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('member'),
    status: memberStatusEnum('status').notNull().default('active'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    joinedAt: timestamptz('joined_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('project_members_project_user_unique').on(table.projectId, table.userId),
    index('project_members_project_id_idx').on(table.projectId),
    index('project_members_user_id_idx').on(table.userId),
    index('project_members_status_idx').on(table.status),
    index('project_members_role_idx').on(table.role),
    index('project_members_project_user_status_idx').on(
      table.projectId,
      table.userId,
      table.status,
    ),
    uniqueIndex('project_members_active_membership_idx')
      .on(table.projectId, table.userId)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    parentTaskId: uuid('parent_task_id').references((): AnyPgColumn => tasks.id, {
      onDelete: 'set null',
    }),
    // Stage 1.1: nullable hook only; FK to goals will be added in a future stage.
    goalId: uuid('goal_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatusEnum('status').notNull().default('inbox'),
    visibility: taskVisibilityEnum('visibility').notNull().default('private'),
    source: taskSourceEnum('source').notNull().default('manual'),
    importanceScore: smallint('importance_score'),
    urgencyScore: smallint('urgency_score'),
    eisenhowerQuadrant: eisenhowerQuadrantEnum('eisenhower_quadrant'),
    dueAt: timestamptz('due_at'),
    scheduledFor: timestamptz('scheduled_for'),
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    canceledAt: timestamptz('canceled_at'),
    aiConfidence: numeric('ai_confidence', { precision: 3, scale: 2 }),
    aiClassificationStatus: text('ai_classification_status'),
    // Stage 1.1: nullable hook only; FK to recurrence_rules will be added in a future stage.
    recurrenceRuleId: uuid('recurrence_rule_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    deletedAt: timestamptz('deleted_at'),
  },
  (table) => [
    index('tasks_workspace_id_idx').on(table.workspaceId),
    index('tasks_space_id_idx').on(table.spaceId),
    index('tasks_project_id_idx').on(table.projectId),
    index('tasks_parent_task_id_idx').on(table.parentTaskId),
    index('tasks_created_by_idx').on(table.createdBy),
    index('tasks_owner_id_idx').on(table.ownerId),
    index('tasks_assignee_id_idx').on(table.assigneeId),
    index('tasks_category_id_idx').on(table.categoryId),
    index('tasks_status_idx').on(table.status),
    index('tasks_due_at_idx').on(table.dueAt),
    index('tasks_scheduled_for_idx').on(table.scheduledFor),
    index('tasks_deleted_at_idx').on(table.deletedAt),
    uniqueIndex('tasks_recurrence_instance_unique_idx')
      .on(table.recurrenceRuleId, table.scheduledFor)
      .where(
        sql`${table.recurrenceRuleId} IS NOT NULL AND ${table.scheduledFor} IS NOT NULL AND ${table.deletedAt} IS NULL`,
      ),
    check('tasks_title_not_empty_check', sql`length(trim(${table.title})) > 0`),
    check(
      'tasks_importance_score_check',
      sql`${table.importanceScore} IS NULL OR (${table.importanceScore} >= 1 AND ${table.importanceScore} <= 5)`,
    ),
    check(
      'tasks_urgency_score_check',
      sql`${table.urgencyScore} IS NULL OR (${table.urgencyScore} >= 1 AND ${table.urgencyScore} <= 5)`,
    ),
    check(
      'tasks_ai_confidence_check',
      sql`${table.aiConfidence} IS NULL OR (${table.aiConfidence} >= 0 AND ${table.aiConfidence} <= 1)`,
    ),
    check(
      'tasks_parent_not_self_check',
      sql`${table.parentTaskId} IS NULL OR ${table.parentTaskId} <> ${table.id}`,
    ),
  ],
);

export const taskTags = pgTable(
  'task_tags',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.tagId] }),
    index('task_tags_tag_id_idx').on(table.tagId),
  ],
);

export const taskEvents = pgTable(
  'task_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    eventType: taskEventTypeEnum('event_type').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    metadata: jsonb('metadata'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('task_events_workspace_id_idx').on(table.workspaceId),
    index('task_events_task_id_idx').on(table.taskId),
    index('task_events_user_id_idx').on(table.userId),
    index('task_events_event_type_idx').on(table.eventType),
    index('task_events_created_at_idx').on(table.createdAt),
    index('task_events_task_created_idx').on(table.taskId, table.createdAt),
    index('task_events_workspace_type_created_idx').on(
      table.workspaceId,
      table.eventType,
      table.createdAt,
    ),
  ],
);
