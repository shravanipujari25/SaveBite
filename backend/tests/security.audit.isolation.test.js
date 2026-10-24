import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import env from '../src/config/env.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Deep Household Authorization & Isolation Audit Suite (Phase 5)', () => {
  let mockDb;

  let userA;
  let tokenA;
  let householdA;

  let userB;
  let tokenB;
  let householdB;

  before(async () => {
    mockDb = await setupTestDatabase();

    // Register User A
    const signupA = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        name: 'Alice Security',
        email: 'alice.sec@savebite.com',
        password: 'Password123!'
      });
    assert.equal(signupA.status, 201);
    userA = signupA.body.data.user;
    tokenA = signupA.body.data.accessToken;
    householdA = signupA.body.data.household;

    // Register User B
    const signupB = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        name: 'Bob Security',
        email: 'bob.sec@savebite.com',
        password: 'Password123!'
      });
    assert.equal(signupB.status, 201);
    userB = signupB.body.data.user;
    tokenB = signupB.body.data.accessToken;
    householdB = signupB.body.data.household;
  });

  after(() => {
    teardownTestDatabase();
  });

  describe('1. Device Management & Sensor Telemetry Isolation', () => {
    let deviceBId;

    it('should register a device strictly under User B household', async () => {
      const res = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          name: "Bob's Refrigerator Sensor",
          device_code: 'ESP32-BOB-01',
          device_type: 'esp32',
          zone: 'refrigerator'
        });

      assert.equal(res.status, 201);
      deviceBId = res.body.data.device.id;
      assert.ok(deviceBId);
      assert.equal(res.body.data.device.household_id, householdB.id);
    });

    it('should prevent User A from seeing User B device in device list', async () => {
      const res = await request(app)
        .get('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 200);
      const devices = res.body.data.devices;
      const found = devices.find((d) => d.id === deviceBId);
      assert.equal(found, undefined, 'User B device must not appear in User A device list');
    });

    it('should return 404 when User A requests User B device by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/devices/${deviceBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('should return 404 when User A requests readings for User B device', async () => {
      const res = await request(app)
        .get(`/api/v1/devices/${deviceBId}/readings`)
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('should prevent User A from ingesting telemetry for User B device code', async () => {
      const res = await request(app)
        .post('/api/v1/telemetry')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          device_code: 'ESP32-BOB-01',
          source_type: 'simulator',
          readings: {
            temperature_c: 4.2,
            humidity_percent: 65.0,
            air_quality_raw: 150.0
          }
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN_DEVICE');
    });
  });

  describe('2. Notifications Isolation', () => {
    let notifBId;

    before(() => {
      notifBId = 'd0000000-0000-4000-b000-000000000091';
      mockDb.notificationsTable.set(notifBId, {
        id: notifBId,
        household_id: householdB.id,
        type: 'threshold_alert',
        title: 'Secret Alert for Bob',
        message: 'High humidity in cellar',
        severity: 'warning',
        is_read: false,
        created_at: new Date().toISOString()
      });
    });

    it('should never list User B notifications in User A notification list', async () => {
      const res = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 200);
      const found = res.body.data.notifications.find((n) => n.id === notifBId);
      assert.equal(found, undefined, 'User B notification must not appear in User A notification list');
    });

    it('should return 404 when User A attempts to mark User B notification as read', async () => {
      const res = await request(app)
        .patch(`/api/v1/notifications/${notifBId}/read`)
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });
  });

  describe('3. Receipts & Receipt Items Isolation', () => {
    let receiptBId;
    let lineItemBId;

    before(() => {
      receiptBId = 'd0000000-0000-4000-b000-000000000092';
      lineItemBId = 'd0000000-0000-4000-b000-000000000093';

      mockDb.receiptsTable.set(receiptBId, {
        id: receiptBId,
        household_id: householdB.id,
        status: 'parsed',
        store_name: 'Organic Market',
        total_amount: 45.50,
        currency: 'USD',
        uploaded_by: userB.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      mockDb.receiptItemsTable.set(lineItemBId, {
        id: lineItemBId,
        receipt_id: receiptBId,
        raw_text: 'Organic Apples 3.99',
        item_name: 'Organic Apples',
        category: 'produce',
        quantity: 1,
        unit: 'pack',
        confidence: 0.65,
        status: 'pending_review'
      });
    });

    it('should return 404 when User A requests User B receipt items', async () => {
      const res = await request(app)
        .get(`/api/v1/receipts/${receiptBId}/items`)
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'RECEIPT_NOT_FOUND');
    });

    it('should return 404 when User A attempts to trigger AI parsing on User B receipt', async () => {
      const res = await request(app)
        .post(`/api/v1/receipts/${receiptBId}/parse`)
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'RECEIPT_NOT_FOUND');
    });

    it('should return 404 when User A attempts to confirm User B receipt item', async () => {
      const res = await request(app)
        .post(`/api/v1/receipts/${receiptBId}/items/${lineItemBId}/confirm`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          item_name: 'Organic Apples',
          category: 'produce',
          quantity: 1,
          unit: 'pack',
          storage_location: 'refrigerator'
        });

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'LINE_ITEM_NOT_FOUND');
    });
  });

  describe('4. Shopping List Isolation', () => {
    let shoppingItemBId;

    it('should create shopping list item under User B household', async () => {
      const res = await request(app)
        .post('/api/v1/shopping-list')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          name: 'Almond Flour',
          quantity: 2,
          unit: 'bag',
          category: 'pantry'
        });

      assert.equal(res.status, 201);
      shoppingItemBId = res.body.data.item.id;
      assert.ok(shoppingItemBId);
      assert.equal(res.body.data.item.household_id, householdB.id);
    });

    it('should never list User B shopping items in User A shopping list', async () => {
      const res = await request(app)
        .get('/api/v1/shopping-list')
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 200);
      const found = res.body.data.items.find((i) => i.id === shoppingItemBId);
      assert.equal(found, undefined);
    });

    it('should return 404 when User A requests User B shopping item by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/shopping-list/${shoppingItemBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('should return 404 when User A attempts to update User B shopping item', async () => {
      const res = await request(app)
        .patch(`/api/v1/shopping-list/${shoppingItemBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ quantity: 10 });

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('should return 404 when User A attempts to delete User B shopping item', async () => {
      const res = await request(app)
        .delete(`/api/v1/shopping-list/${shoppingItemBId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });
  });

  describe('5. Analytics & Waste Isolation', () => {
    before(() => {
      // Seed waste log for Household B only
      const wasteBId = 'd0000000-0000-4000-b000-000000000094';
      mockDb.wasteLogTable.set(wasteBId, {
        id: wasteBId,
        household_id: householdB.id,
        item_name: 'Wasted Ribeye Steak',
        category: 'meat',
        quantity: 1,
        unit: 'pack',
        reason: 'expired',
        estimated_value: 25.00,
        wasted_at: new Date().toISOString(),
        recorded_by: userB.id
      });
    });

    it('should return 0 waste for User A household analytics', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/waste')
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.total_items_wasted, 0);
      assert.equal(res.body.data.total_estimated_value, 0);
    });

    it('should return correct waste metrics for User B household analytics', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/waste')
        .set('Authorization', `Bearer ${tokenB}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.total_items_wasted, 1);
      assert.equal(res.body.data.total_estimated_value, 25.00);
    });
  });

  describe('6. Household Settings & Client Spoofing Defense', () => {
    it('should prevent client-supplied household_id from overriding server authorization in inventory creation', async () => {
      const res = await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Spoofed Item',
          category: 'pantry',
          quantity: 1,
          unit: 'pack',
          household_id: householdB.id // Malicious client attempt to inject Household B
        });

      assert.equal(res.status, 201);
      // Verify the item was created in Household A, completely ignoring the spoofed household_id
      assert.equal(res.body.data.item.household_id, householdA.id);
      assert.notEqual(res.body.data.item.household_id, householdB.id);
    });

    it('should return distinct household settings for User A vs User B', async () => {
      const resA = await request(app)
        .get('/api/v1/household/settings')
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(resA.status, 200);
      assert.equal(resA.body.data.id, householdA.id);

      const resB = await request(app)
        .get('/api/v1/household/settings')
        .set('Authorization', `Bearer ${tokenB}`);

      assert.equal(resB.status, 200);
      assert.equal(resB.body.data.id, householdB.id);
    });
  });

  describe('7. Authentication & Token Hardening', () => {
    it('should reject requests with missing Authorization header (401)', async () => {
      const res = await request(app).get('/api/v1/inventory');
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    it('should reject requests with malformed Authorization format (401)', async () => {
      const res = await request(app)
        .get('/api/v1/inventory')
        .set('Authorization', 'Basic 123456');

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    it('should reject requests with tampered JWT signature (401)', async () => {
      // Craft a token signed with an invalid secret
      const forgedToken = jwt.sign(
        { sub: userA.id, role: 'user', tokenVersion: 1 },
        'wrong-secret-key-123456789012345678901234567890',
        { expiresIn: '1h', algorithm: 'HS256' }
      );

      const res = await request(app)
        .get('/api/v1/inventory')
        .set('Authorization', `Bearer ${forgedToken}`);

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    it('should reject requests with malformed non-JWT token string (401)', async () => {
      const res = await request(app)
        .get('/api/v1/inventory')
        .set('Authorization', 'Bearer not.a.valid.jwt.string');

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    it('should reject requests with invalid non-UUID parameter format (400)', async () => {
      const res = await request(app)
        .get('/api/v1/inventory/invalid-uuid-string')
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('should return 404 for non-existent UUID resource parameter', async () => {
      const res = await request(app)
        .get('/api/v1/inventory/00000000-0000-4000-a000-000000000000')
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });
  });
});
