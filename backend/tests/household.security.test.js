import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import env from '../src/config/env.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Household Isolation & Authorization Security Suite', () => {
  let mockDb;
  let userA;
  let tokenA;
  let householdA;

  let userB;
  let tokenB;
  let householdB;

  before(async () => {
    mockDb = await setupTestDatabase();

    // 1. Register User A via public signup API
    const signupResA = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        name: 'Alice Baker',
        email: 'alice.baker@savebite.com',
        password: 'Password123!'
      });

    assert.equal(signupResA.status, 201);
    userA = signupResA.body.data.user;
    tokenA = signupResA.body.data.accessToken;
    householdA = signupResA.body.data.household;

    // 2. Register User B via public signup API
    const signupResB = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        name: 'Bob Cook',
        email: 'bob.cook@savebite.com',
        password: 'Password123!'
      });

    assert.equal(signupResB.status, 201);
    userB = signupResB.body.data.user;
    tokenB = signupResB.body.data.accessToken;
    householdB = signupResB.body.data.household;
  });

  after(() => {
    teardownTestDatabase();
  });

  describe('1. Household Signup and Membership Provisioning', () => {
    it('should create exactly one household and owner membership upon user signup', async () => {
      assert.ok(householdA.id);
      assert.equal(householdA.role, 'owner');
      assert.notEqual(householdA.id, householdB.id);

      // Verify membership record in database
      let membershipA = null;
      for (const m of mockDb.householdMembersTable.values()) {
        if (m.user_id === userA.id) {
          membershipA = m;
        }
      }

      assert.ok(membershipA);
      assert.equal(membershipA.household_id, householdA.id);
      assert.equal(membershipA.role, 'owner');
      assert.equal(membershipA.status, 'active');
    });

    it('should reject duplicate signup without creating orphaned households', async () => {
      const initialHouseholdsCount = mockDb.householdsTable.size;

      const dupRes = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          name: 'Alice Imposter',
          email: 'alice.baker@savebite.com',
          password: 'Password123!'
        });

      assert.equal(dupRes.status, 409);
      assert.equal(mockDb.householdsTable.size, initialHouseholdsCount);
    });

    it('should include household membership info in GET /api/v1/auth/me', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 200);
      assert.ok(res.body.data.user.household);
      assert.equal(res.body.data.user.household.id, householdA.id);
      assert.equal(res.body.data.user.household.role, 'owner');
    });
  });

  describe('2. Cross-Household Inventory Isolation', () => {
    let itemAId;

    before(async () => {
      // User A creates an item in Household A
      const createRes = await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Secret Truffles',
          category: 'pantry',
          quantity: 2,
          unit: 'piece',
          estimated_unit_price: 50.00
        });

      assert.equal(createRes.status, 201);
      itemAId = createRes.body.data.item.id;
    });

    it('should never list User A item in User B inventory list', async () => {
      const res = await request(app)
        .get('/api/v1/inventory')
        .set('Authorization', `Bearer ${tokenB}`);

      assert.equal(res.status, 200);
      const items = res.body.data.items;
      const found = items.find((i) => i.id === itemAId);
      assert.equal(found, undefined);
    });

    it('should return 404 when User B attempts to GET User A item by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/inventory/${itemAId}`)
        .set('Authorization', `Bearer ${tokenB}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('should return 404 when User B attempts to PATCH User A item', async () => {
      const res = await request(app)
        .patch(`/api/v1/inventory/${itemAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          name: 'Stolen Truffles'
        });

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('should return 404 when User B attempts to DELETE User A item', async () => {
      const res = await request(app)
        .delete(`/api/v1/inventory/${itemAId}`)
        .set('Authorization', `Bearer ${tokenB}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('should return 404 when User B attempts to consume User A item', async () => {
      const res = await request(app)
        .post(`/api/v1/inventory/${itemAId}/consume`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          quantity: 1
        });

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('should return 404 when User B attempts to waste User A item', async () => {
      const res = await request(app)
        .post(`/api/v1/inventory/${itemAId}/waste`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          quantity: 1,
          reason: 'spoiled'
        });

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('should return 404 when User B attempts to open User A item', async () => {
      const res = await request(app)
        .post(`/api/v1/inventory/${itemAId}/open`)
        .set('Authorization', `Bearer ${tokenB}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });
  });

  describe('3. Cross-Household Dashboard Metrics Isolation', () => {
    it('should ensure User B dashboard never leaks User A items or monetary values', async () => {
      const resB = await request(app)
        .get('/api/v1/dashboard')
        .set('Authorization', `Bearer ${tokenB}`);

      assert.equal(resB.status, 200);
      // User B has no items in Household B yet
      assert.equal(resB.body.data.summary.totalActiveItems, 0);
      assert.equal(resB.body.data.summary.totalEstimatedValue, 0);

      // User A dashboard should contain User A's $100 value (2 truffles * $50)
      const resA = await request(app)
        .get('/api/v1/dashboard')
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(resA.status, 200);
      assert.equal(resA.body.data.summary.totalActiveItems, 1);
      assert.equal(resA.body.data.summary.totalEstimatedValue, 100);
    });
  });

  describe('4. Inactive Membership & Token Security', () => {
    it('should reject users who have inactive household membership with 403', async () => {
      // Create a user with inactive membership status
      const inactiveUser = {
        id: '99991111-2222-3333-4444-555555555555',
        name: 'Inactive Member',
        email: 'inactive@savebite.com',
        role: 'user',
        token_version: 1
      };
      mockDb.usersTable.set(inactiveUser.id, inactiveUser);

      // Add inactive membership
      mockDb.householdMembersTable.set('inactive-membership-id', {
        id: 'inactive-membership-id',
        household_id: householdA.id,
        user_id: inactiveUser.id,
        role: 'member',
        status: 'inactive'
      });

      const inactiveToken = generateAccessToken(inactiveUser);

      const res = await request(app)
        .get('/api/v1/inventory')
        .set('Authorization', `Bearer ${inactiveToken}`);

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN_HOUSEHOLD');
    });

    it('should reject unauthenticated requests to inventory endpoints (401)', async () => {
      const res = await request(app).get('/api/v1/inventory');
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    it('should reject inventory requests with expired JWTs (401)', async () => {
      const expiredToken = jwt.sign(
        { sub: userA.id, role: 'user', tokenVersion: 1 },
        env.JWT_SECRET,
        { expiresIn: '-10s', algorithm: 'HS256' }
      );

      const res = await request(app)
        .get('/api/v1/inventory')
        .set('Authorization', `Bearer ${expiredToken}`);

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    it('should immediately revoke access after user logs out', async () => {
      // 1. User B logs out
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokenB}`);

      assert.equal(logoutRes.status, 200);

      // 2. Token B is now revoked and must be rejected on inventory endpoints
      const res = await request(app)
        .get('/api/v1/inventory')
        .set('Authorization', `Bearer ${tokenB}`);

      assert.equal(res.status, 401);
      assert.match(res.body.message, /revoked/i);
    });
  });
});
