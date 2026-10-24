import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { __setMockClients, __resetMockClients } from '../../src/config/supabase.js';

/**
 * Creates an in-memory mock Supabase database client for testing users and profiles tables.
 */
export const createMockDatabaseClient = async (options = {}) => {
  const usersTable = new Map();
  const profilesTable = new Map();

  // Pre-seed a known test user with properly hashed password
  const defaultPassword = options.defaultPassword || 'StrongPassword123!';
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);

  const defaultUser = {
    id: options.defaultUserId || '11111111-2222-3333-4444-555555555555',
    name: 'Test Chef',
    email: 'testuser@savebite.com',
    password_hash: hashedPassword,
    role: 'user',
    token_version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  usersTable.set(defaultUser.id, { ...defaultUser });

  const client = {
    from: (table) => {
      let filterId = null;
      let filterEmail = null;
      let insertRecord = null;
      let updatePayload = null;

      const builder = {
        select: () => builder,
        eq: (col, val) => {
          if (col === 'id') filterId = val;
          if (col === 'email') filterEmail = String(val).toLowerCase();
          return builder;
        },
        ilike: (col, val) => {
          if (col === 'email') filterEmail = String(val).toLowerCase();
          return builder;
        },
        insert: (record) => {
          insertRecord = record;
          return builder;
        },
        update: (updates) => {
          updatePayload = updates;
          return builder;
        },
        maybeSingle: async () => {
          if (table === 'users') {
            if (filterId && usersTable.has(filterId)) {
              return { data: { ...usersTable.get(filterId) }, error: null };
            }
            if (filterEmail) {
              for (const u of usersTable.values()) {
                if (u.email.toLowerCase() === filterEmail.toLowerCase()) {
                  return { data: { ...u }, error: null };
                }
              }
            }
            return { data: null, error: null };
          }
          if (table === 'profiles') {
            if (filterId && profilesTable.has(filterId)) {
              return { data: { ...profilesTable.get(filterId) }, error: null };
            }
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          if (table === 'users') {
            if (insertRecord) {
              const normalizedEmail = insertRecord.email.toLowerCase();
              for (const u of usersTable.values()) {
                if (u.email.toLowerCase() === normalizedEmail) {
                  const duplicateErr = new Error('duplicate key value violates unique constraint "idx_users_email_lower"');
                  duplicateErr.code = '23505';
                  return { data: null, error: duplicateErr };
                }
              }
              const id = insertRecord.id || crypto.randomUUID();
              const created = {
                ...insertRecord,
                id,
                email: normalizedEmail,
                token_version: insertRecord.token_version || 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              };
              usersTable.set(id, created);
              return { data: { ...created }, error: null };
            }

            if (filterId && updatePayload) {
              const existing = usersTable.get(filterId);
              if (!existing) {
                return { data: null, error: new Error('User not found') };
              }
              const updated = {
                ...existing,
                ...updatePayload,
                updated_at: new Date().toISOString()
              };
              usersTable.set(filterId, updated);
              return { data: { ...updated }, error: null };
            }

            if (filterId && usersTable.has(filterId)) {
              return { data: { ...usersTable.get(filterId) }, error: null };
            }

            return { data: null, error: new Error('User not found') };
          }

          if (table === 'profiles') {
            if (insertRecord) {
              profilesTable.set(insertRecord.id, insertRecord);
              return { data: { ...insertRecord }, error: null };
            }
            if (filterId && profilesTable.has(filterId)) {
              return { data: { ...profilesTable.get(filterId) }, error: null };
            }
            return { data: null, error: new Error('Profile not found') };
          }

          return { data: null, error: new Error('Table not found') };
        }
      };

      return builder;
    }
  };

  return { client, usersTable, profilesTable, defaultUser, defaultPassword };
};

export const setupTestDatabase = async (options = {}) => {
  const mock = await createMockDatabaseClient(options);
  __setMockClients({ client: mock.client, admin: mock.client });
  return mock;
};

export const teardownTestDatabase = () => {
  __resetMockClients();
};
