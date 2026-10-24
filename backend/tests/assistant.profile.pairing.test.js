import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Assistant Proxy, Profile, Settings & Device Pairing Suite (Phase 4)', () => {
  let mockDb;
  let authToken;
  let memberAuthToken;
  let defaultUser;
  let memberUser;
  let defaultHousehold;
  let originalFetch;

  beforeEach(async () => {
    mockDb = await setupTestDatabase();
    defaultUser = mockDb.defaultUser;
    defaultHousehold = mockDb.defaultHousehold;
    authToken = generateAccessToken(defaultUser);

    // Create a non-owner member user in the same household
    memberUser = {
      id: crypto.randomUUID(),
      name: 'Regular Household Member',
      email: 'member@savebite.com',
      role: 'user',
      token_version: 1
    };
    mockDb.usersTable.set(memberUser.id, memberUser);

    mockDb.householdMembersTable.set('member-membership-uuid', {
      id: 'member-membership-uuid',
      household_id: defaultHousehold.id,
      user_id: memberUser.id,
      role: 'member', // NOT owner or admin
      status: 'active'
    });

    memberAuthToken = generateAccessToken(memberUser);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    teardownTestDatabase();
  });

  describe('POST /api/v1/assistant/chat', () => {
    test('should proxy user message and household inventory context to AI assistant', async () => {
      const itemId = crypto.randomUUID();
      mockDb.inventoryItemsTable.set(itemId, {
        id: itemId,
        household_id: defaultHousehold.id,
        name: 'Eggs',
        quantity: 6,
        unit: 'piece',
        status: 'active'
      });

      globalThis.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body || '{}');
        assert.equal(body.message, 'What can I cook tonight?');
        assert.ok(Array.isArray(body.inventory_context));
        assert.equal(body.inventory_context.length, 1);
        assert.equal(body.inventory_context[0].name, 'Eggs');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            reply: 'You have 6 eggs in your fridge. You could make a simple omelette or scrambled eggs!',
            suggested_actions: ['View Omelette Recipe', 'Check Expiry']
          })
        };
      };

      const res = await request(app)
        .post('/api/v1/assistant/chat')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'What can I cook tonight?'
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.ok(res.body.data.reply.includes('omelette'));
      assert.equal(res.body.data.suggested_actions.length, 2);
    });

    test('should validate message length and reject empty messages (400)', async () => {
      const res = await request(app)
        .post('/api/v1/assistant/chat')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: ''
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });

    test('should handle AI service outage without crashing the server', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service Unavailable' }),
        text: async () => JSON.stringify({ error: 'Service Unavailable' })
      });

      const res = await request(app)
        .post('/api/v1/assistant/chat')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Hello Assistant'
        });

      assert.equal(res.status, 502);
      assert.equal(res.body.error.code, 'AI_SERVICE_ERROR');
    });
  });

  describe('User Profile (/api/v1/profile)', () => {
    test('GET /api/v1/profile should never expose password hashes or token versions', async () => {
      const res = await request(app)
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.user.email, defaultUser.email);
      assert.equal(res.body.data.user.password_hash, undefined);
      assert.equal(res.body.data.user.token_version, undefined);
    });

    test('PATCH /api/v1/profile should update permitted fields and ignore role escalation', async () => {
      const res = await request(app)
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Updated Chef Name',
          avatar_url: 'https://example.com/avatar.jpg',
          preferences: { theme: 'dark' },
          role: 'admin' // Attempted privilege escalation
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.user.name, 'Updated Chef Name');
      assert.equal(res.body.data.user.avatar_url, 'https://example.com/avatar.jpg');
      assert.equal(res.body.data.user.preferences.theme, 'dark');
      // Role remains 'user', escalation ignored
      assert.equal(res.body.data.user.role, 'user');
    });
  });

  describe('Household Settings (/api/v1/household/settings)', () => {
    test('GET should return household settings and members', async () => {
      const res = await request(app)
        .get('/api/v1/household/settings')
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.name, defaultHousehold.name);
      assert.ok(Array.isArray(res.body.data.members));
      assert.equal(res.body.data.members.length, 2);
    });

    test('PATCH by owner should update settings', async () => {
      const res = await request(app)
        .patch('/api/v1/household/settings')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          settings: { alert_on_critical: true, timezone: 'America/New_York' }
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.settings.timezone, 'America/New_York');
    });

    test('PATCH by regular member should be rejected (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .patch('/api/v1/household/settings')
        .set('Authorization', `Bearer ${memberAuthToken}`)
        .send({
          settings: { malicious_setting: true }
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    });
  });

  describe('Device Pairing (/api/v1/devices/pairing-token and /api/v1/devices/pair)', () => {
    test('should generate 15-minute pairing token and complete pairing', async () => {
      // 1. Generate token
      const tokenRes = await request(app)
        .post('/api/v1/devices/pairing-token')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          device_type: 'esp32_sensor_hub'
        });

      assert.equal(tokenRes.status, 201);
      const token = tokenRes.body.data.pairing_token;
      assert.ok(token);
      assert.equal(tokenRes.body.data.expires_in_seconds, 900);

      // 2. Complete pairing
      const pairRes = await request(app)
        .post('/api/v1/devices/pair')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          pairing_token: token,
          device_name: 'Kitchen Fridge Sensor'
        });

      assert.equal(pairRes.status, 201);
      assert.equal(pairRes.body.status, 'success');
      assert.equal(pairRes.body.data.device.name, 'Kitchen Fridge Sensor');
      assert.ok(pairRes.body.data.device.device_code);

      // 3. Attempting to reuse the same pairing token should be rejected
      const reuseRes = await request(app)
        .post('/api/v1/devices/pair')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          pairing_token: token,
          device_name: 'Duplicate Sensor'
        });

      assert.equal(reuseRes.status, 400);
      assert.equal(reuseRes.body.error.code, 'INVALID_PAIRING_TOKEN');
    });

    test('should reject invalid pairing tokens', async () => {
      const res = await request(app)
        .post('/api/v1/devices/pair')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          pairing_token: 'PAIR-INVALID999',
          device_name: 'Faulty Sensor'
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_PAIRING_TOKEN');
    });
  });
});
