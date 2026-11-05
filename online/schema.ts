import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable('qa_sessions', {
  hash: text('hash').primaryKey(), tenant: text('tenant').notNull(), actor: text('actor').notNull(),
  expires: integer('expires').notNull(),
});
export const templates = sqliteTable('qa_templates', {
  tenant: text('tenant').notNull(), id: text('id').notNull(), tariff: text('tariff_id').notNull(),
  name: text('name').notNull(), revision: text('revision').notNull(), active: integer('active').notNull(),
  mapping: text('mapping').notNull(), object: text('object_key'), importedAt: text('imported_at'),
}, t => [
  primaryKey({ columns: [t.tenant,t.id] }),
  uniqueIndex('qa_template_revision').on(t.tenant,t.tariff,t.name,t.revision),
]);
export const records = sqliteTable('qa_records', {
  id: text('id').primaryKey(), tenant: text('tenant').notNull(), actor: text('actor').notNull(),
  request: text('request_id').notNull(), digest: text('digest').notNull(),
  snapshot: text('snapshot').notNull(), object: text('object_key').notNull(),
}, t => [uniqueIndex('qa_request_owner').on(t.tenant,t.actor,t.request)]);

export const importedTariffs = sqliteTable('demo_tariffs', {
  tenant: text('tenant').notNull(), id: text('id').notNull(), data: text('data').notNull(),
}, t => [primaryKey({ columns: [t.tenant,t.id] })]);

export const sampleSettings = sqliteTable('demo_settings', {
  tenant: text('tenant').primaryKey(), hideSamples: integer('hide_samples').notNull(),
});
