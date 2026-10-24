import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileRepository } from '../src/repositories/profile.repository.js';

describe('Profile Repository and Row-Level Security Isolation', () => {
  const userA = {
    id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    email: 'user.a@savebite.com',
    full_name: 'Alice Chef',
    avatar_url: 'https://example.com/alice.png',
    role: 'user',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const userB = {
    id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    email: 'user.b@savebite.com',
    full_name: 'Bob Pantry',
    avatar_url: 'https://example.com/bob.png',
    role: 'user',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const createMockDb = (currentUser) => {
    const store = new Map([
      [userA.id, { ...userA }],
      [userB.id, { ...userB }]
    ]);

    return {
      from: (table) => {
        if (table !== 'profiles') throw new Error('Invalid table');

        let filterId = null;
        let updatePayload = null;

        const builder = {
          select: () => builder,
          eq: (col, val) => {
            if (col === 'id') filterId = val;
            return builder;
          },
          maybeSingle: async () => {
            // Emulate PostgreSQL Row-Level Security:
            // "Users can view own profile": auth.uid() = id
            if (currentUser && currentUser.id !== filterId) {
              // RLS filters out rows that do not match the current user ID
              return { data: null, error: null };
            }
            if (filterId && store.has(filterId)) {
              return { data: store.get(filterId), error: null };
            }
            return { data: null, error: null };
          },
          update: (updates) => {
            updatePayload = updates;
            return builder;
          },
          single: async () => {
            // Emulate RLS policy + trigger protection on update:
            if (currentUser && currentUser.id !== filterId) {
              return { data: null, error: new Error('RLS policy violation: cannot access another user record') };
            }
            if (updatePayload && 'role' in updatePayload && updatePayload.role !== 'user' && currentUser.role !== 'service_role') {
              return { data: null, error: new Error('Permission denied: Role modifications are restricted to administrators') };
            }
            const record = store.get(filterId);
            const updated = { ...record, ...updatePayload, updated_at: new Date().toISOString() };
            store.set(filterId, updated);
            return { data: updated, error: null };
          }
        };

        return builder;
      }
    };
  };

  it('should allow user A to fetch their own profile under RLS', async () => {
    const dbClient = createMockDb(userA);
    const repo = new ProfileRepository();

    const profile = await repo.findById(userA.id, dbClient);
    assert.ok(profile);
    assert.equal(profile.id, userA.id);
    assert.equal(profile.full_name, 'Alice Chef');
  });

  it('should prevent user A from reading user B profile under RLS', async () => {
    const dbClient = createMockDb(userA);
    const repo = new ProfileRepository();

    const profile = await repo.findById(userB.id, dbClient);
    // RLS policy suppresses unauthorized records from the result
    assert.equal(profile, null);
  });

  it('should prevent non-admin clients from elevating their role to admin', async () => {
    const dbClient = createMockDb(userA);
    const repo = new ProfileRepository();

    await assert.rejects(
      async () => {
        await repo.update(userA.id, { role: 'admin' }, dbClient);
      },
      /Role modifications are restricted to administrators/i
    );
  });

  it('should allow user A to update their own permissible profile fields', async () => {
    const dbClient = createMockDb(userA);
    const repo = new ProfileRepository();

    const updated = await repo.update(userA.id, { full_name: 'Alice MasterChef' }, dbClient);
    assert.equal(updated.full_name, 'Alice MasterChef');
    assert.equal(updated.role, 'user');
  });
});
