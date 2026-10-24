import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Inventory & Household Pantry API Suite (/api/v1/inventory & /api/v1/dashboard)', () => {
  let mockDb;
  let userToken;
  let defaultUser;
  let defaultHousehold;

  before(async () => {
    mockDb = await setupTestDatabase();
    defaultUser = mockDb.defaultUser;
    defaultHousehold = mockDb.defaultHousehold;
    userToken = generateAccessToken(defaultUser);
  });

  after(() => {
    teardownTestDatabase();
  });

  beforeEach(() => {
    // Clear inventory and waste tables before each test block
    mockDb.inventoryItemsTable.clear();
    mockDb.wasteLogTable.clear();
    mockDb.inventoryEventsTable.clear();
  });

  describe('1. Create Inventory Item (POST /api/v1/inventory)', () => {
    it('should create an active inventory item with valid payload', async () => {
      const res = await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Organic Milk',
          category: 'dairy',
          quantity: 2,
          unit: 'l',
          purchase_date: '2026-10-24',
          expiry_date: '2026-10-31',
          storage_location: 'refrigerator',
          estimated_unit_price: 3.99,
          currency: 'USD'
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.status, 'success');
      assert.ok(res.body.data.item);

      const item = res.body.data.item;
      assert.equal(item.name, 'Organic Milk');
      assert.equal(item.category, 'dairy');
      assert.equal(item.quantity, 2);
      assert.equal(item.unit, 'l');
      assert.equal(item.status, 'active');
      assert.equal(item.is_opened, false);
      assert.equal(item.household_id, defaultHousehold.id);
      assert.equal(item.created_by, defaultUser.id);
      assert.ok(item.id);
    });

    it('should reject invalid creation input (missing name, negative quantity, invalid unit)', async () => {
      // Missing name
      const res1 = await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: '',
          quantity: 1,
          unit: 'piece'
        });
      assert.equal(res1.status, 400);
      assert.equal(res1.body.error.code, 'VALIDATION_ERROR');

      // Negative quantity
      const res2 = await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Apples',
          quantity: -3,
          unit: 'kg'
        });
      assert.equal(res2.status, 400);

      // Invalid unit
      const res3 = await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Bread',
          quantity: 1,
          unit: 'unsupported_unit_xyz'
        });
      assert.equal(res3.status, 400);
    });

    it('should prevent client-supplied ownership fields (zero-trust)', async () => {
      const spoofedHouseholdId = '99999999-9999-9999-9999-999999999999';
      const spoofedUserId = '88888888-8888-8888-8888-888888888888';

      const res = await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Strawberries',
          quantity: 1,
          unit: 'pack',
          household_id: spoofedHouseholdId,
          created_by: spoofedUserId
        });

      assert.equal(res.status, 201);
      // Strictly enforced server-side derivation:
      assert.equal(res.body.data.item.household_id, defaultHousehold.id);
      assert.equal(res.body.data.item.created_by, defaultUser.id);
      assert.notEqual(res.body.data.item.household_id, spoofedHouseholdId);
    });
  });

  describe('2. List & Query Inventory (GET /api/v1/inventory)', () => {
    beforeEach(async () => {
      // Seed 3 items in default household
      await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Cheddar Cheese',
          category: 'dairy',
          quantity: 1,
          unit: 'piece',
          storage_location: 'refrigerator',
          expiry_date: '2026-10-28',
          estimated_unit_price: 4.50
        });

      await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Greek Yogurt',
          category: 'dairy',
          quantity: 3,
          unit: 'piece',
          storage_location: 'refrigerator',
          expiry_date: '2026-10-30',
          estimated_unit_price: 1.25
        });

      await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Whole Wheat Bread',
          category: 'bakery',
          quantity: 1,
          unit: 'piece',
          storage_location: 'pantry',
          expiry_date: '2026-10-26',
          estimated_unit_price: 2.99
        });
    });

    it('should list all active items in the household', async () => {
      const res = await request(app)
        .get('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.equal(res.body.data.items.length, 3);
      assert.equal(res.body.data.pagination.total, 3);
      assert.equal(res.body.data.pagination.page, 1);
    });

    it('should filter items by category and storage location', async () => {
      // Category filter: dairy (expect 2)
      const resCategory = await request(app)
        .get('/api/v1/inventory?category=dairy')
        .set('Authorization', `Bearer ${userToken}`);
      assert.equal(resCategory.status, 200);
      assert.equal(resCategory.body.data.items.length, 2);

      // Storage location filter: pantry (expect 1)
      const resPantry = await request(app)
        .get('/api/v1/inventory?storage_location=pantry')
        .set('Authorization', `Bearer ${userToken}`);
      assert.equal(resPantry.status, 200);
      assert.equal(resPantry.body.data.items.length, 1);
      assert.equal(resPantry.body.data.items[0].name, 'Whole Wheat Bread');
    });

    it('should search items by substring name', async () => {
      const res = await request(app)
        .get('/api/v1/inventory?search=cheddar')
        .set('Authorization', `Bearer ${userToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.items.length, 1);
      assert.equal(res.body.data.items[0].name, 'Cheddar Cheese');
    });

    it('should paginate results properly', async () => {
      const res = await request(app)
        .get('/api/v1/inventory?limit=2&page=1')
        .set('Authorization', `Bearer ${userToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.items.length, 2);
      assert.equal(res.body.data.pagination.limit, 2);
      assert.equal(res.body.data.pagination.totalPages, 2);
    });
  });

  describe('3. Single Item Operations (GET, PATCH, DELETE)', () => {
    let createdItemId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Avocados',
          category: 'produce',
          quantity: 4,
          unit: 'piece',
          storage_location: 'counter',
          expiry_date: '2026-10-27',
          estimated_unit_price: 1.50
        });
      createdItemId = res.body.data.item.id;
    });

    it('should fetch single item by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/inventory/${createdItemId}`)
        .set('Authorization', `Bearer ${userToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.item.name, 'Avocados');
      assert.equal(res.body.data.item.quantity, 4);
    });

    it('should return 404 for nonexistent item ID', async () => {
      const randomUuid = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .get(`/api/v1/inventory/${randomUuid}`)
        .set('Authorization', `Bearer ${userToken}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('should update permitted fields and ignore/reject protected fields', async () => {
      const res = await request(app)
        .patch(`/api/v1/inventory/${createdItemId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Ripe Avocados',
          quantity: 3,
          storage_location: 'refrigerator'
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.item.name, 'Ripe Avocados');
      assert.equal(res.body.data.item.quantity, 3);
      assert.equal(res.body.data.item.storage_location, 'refrigerator');

      // Attempting to update protected fields should be rejected by schema strict validation
      const resTamper = await request(app)
        .patch(`/api/v1/inventory/${createdItemId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          household_id: '99999999-9999-9999-9999-999999999999'
        });
      assert.equal(resTamper.status, 400);
      assert.equal(resTamper.body.error.code, 'VALIDATION_ERROR');
    });

    it('should archive item on DELETE and exclude from active list', async () => {
      const resDelete = await request(app)
        .delete(`/api/v1/inventory/${createdItemId}`)
        .set('Authorization', `Bearer ${userToken}`);

      assert.equal(resDelete.status, 200);
      assert.match(resDelete.body.message, /archived successfully/i);

      // Active items query should now return 0 items
      const resList = await request(app)
        .get('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`);
      assert.equal(resList.body.data.items.length, 0);
    });
  });

  describe('4. Item Consumption (POST /api/v1/inventory/:itemId/consume)', () => {
    let itemId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Eggs',
          category: 'dairy',
          quantity: 6,
          unit: 'piece'
        });
      itemId = res.body.data.item.id;
    });

    it('should partially consume item and decrement quantity', async () => {
      const res = await request(app)
        .post(`/api/v1/inventory/${itemId}/consume`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          quantity: 2,
          unit: 'piece'
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.item.quantity, 4);
      assert.equal(res.body.data.item.status, 'active');
      assert.equal(res.body.data.consumedQuantity, 2);
    });

    it('should fully consume item and transition status to consumed when quantity reaches 0', async () => {
      const res = await request(app)
        .post(`/api/v1/inventory/${itemId}/consume`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          quantity: 6
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.item.quantity, 0);
      assert.equal(res.body.data.item.status, 'consumed');
    });

    it('should reject consuming more stock than available (stock must never go negative)', async () => {
      const res = await request(app)
        .post(`/api/v1/inventory/${itemId}/consume`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          quantity: 10
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INSUFFICIENT_STOCK');

      // Verify stock remained unchanged in database
      const itemCheck = await request(app)
        .get(`/api/v1/inventory/${itemId}`)
        .set('Authorization', `Bearer ${userToken}`);
      assert.equal(itemCheck.body.data.item.quantity, 6);
    });

    it('should reject zero or negative consume quantity', async () => {
      const res = await request(app)
        .post(`/api/v1/inventory/${itemId}/consume`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          quantity: -1
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });
  });

  describe('5. Food Waste Logging (POST /api/v1/inventory/:itemId/waste)', () => {
    let itemId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Strawberries',
          category: 'produce',
          quantity: 2,
          unit: 'pack',
          estimated_unit_price: 3.50
        });
      itemId = res.body.data.item.id;
    });

    it('should log waste, decrease stock, calculate financial loss, and create waste_log entry', async () => {
      const res = await request(app)
        .post(`/api/v1/inventory/${itemId}/waste`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          quantity: 1,
          reason: 'spoiled'
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.item.quantity, 1);
      assert.ok(res.body.data.wasteLog);

      const wasteLog = res.body.data.wasteLog;
      assert.equal(wasteLog.item_name, 'Strawberries');
      assert.equal(wasteLog.quantity, 1);
      assert.equal(wasteLog.reason, 'spoiled');
      assert.equal(wasteLog.estimated_value, 3.50);
      assert.equal(wasteLog.household_id, defaultHousehold.id);
      assert.equal(wasteLog.recorded_by, defaultUser.id);
    });

    it('should transition status to wasted when entire quantity is wasted', async () => {
      const res = await request(app)
        .post(`/api/v1/inventory/${itemId}/waste`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          quantity: 2,
          reason: 'expired'
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.item.quantity, 0);
      assert.equal(res.body.data.item.status, 'wasted');
    });

    it('should reject waste quantity exceeding available stock', async () => {
      const res = await request(app)
        .post(`/api/v1/inventory/${itemId}/waste`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          quantity: 5,
          reason: 'expired'
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INSUFFICIENT_STOCK');
    });

    it('should reject invalid waste reasons', async () => {
      const res = await request(app)
        .post(`/api/v1/inventory/${itemId}/waste`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          quantity: 1,
          reason: 'invalid_uncontrolled_reason'
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });
  });

  describe('6. Open Item Package (POST /api/v1/inventory/:itemId/open)', () => {
    it('should mark item as opened and set opened_at timestamp idempotently', async () => {
      const createRes = await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Tomato Sauce Jar',
          category: 'pantry',
          quantity: 1,
          unit: 'can'
        });
      const itemId = createRes.body.data.item.id;

      // 1. First open request
      const res1 = await request(app)
        .post(`/api/v1/inventory/${itemId}/open`)
        .set('Authorization', `Bearer ${userToken}`);

      assert.equal(res1.status, 200);
      assert.equal(res1.body.data.item.is_opened, true);
      assert.ok(res1.body.data.item.opened_at);
      const firstOpenedAt = res1.body.data.item.opened_at;

      // 2. Second open request - must be idempotent and preserve original opened_at
      const res2 = await request(app)
        .post(`/api/v1/inventory/${itemId}/open`)
        .set('Authorization', `Bearer ${userToken}`);

      assert.equal(res2.status, 200);
      assert.equal(res2.body.data.item.is_opened, true);
      assert.equal(res2.body.data.item.opened_at, firstOpenedAt);
      assert.equal(res2.body.data.item.quantity, 1); // Opening never consumes stock
    });
  });

  describe('7. Manual Purchase / Add to Pantry (POST /api/v1/inventory/manual-purchase)', () => {
    it('should add grocery haul item to pantry inventory', async () => {
      const res = await request(app)
        .post('/api/v1/inventory/manual-purchase')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Almond Butter',
          category: 'pantry',
          quantity: 2,
          unit: 'bottle',
          purchase_date: '2026-10-24',
          expiry_date: '2027-04-24',
          storage_location: 'pantry',
          estimated_unit_price: 6.99,
          currency: 'USD'
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.status, 'success');
      assert.equal(res.body.data.item.name, 'Almond Butter');
      assert.equal(res.body.data.item.status, 'active');
      assert.equal(res.body.data.item.household_id, defaultHousehold.id);
    });
  });

  describe('8. Dashboard Metrics & Analytics (GET /api/v1/dashboard)', () => {
    it('should return accurate household-scoped dashboard metrics', async () => {
      const today = new Date();
      const threeDaysLater = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const twentyDaysLater = new Date(today.getTime() + 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Item 1: Expiring in 3 days ($2.00 * 2 = $4.00)
      await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Yogurt',
          category: 'dairy',
          quantity: 2,
          unit: 'piece',
          expiry_date: threeDaysLater,
          estimated_unit_price: 2.00
        });

      // Item 2: Expiring in 20 days ($5.00 * 1 = $5.00)
      await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Rice Bag',
          category: 'pantry',
          quantity: 1,
          unit: 'pack',
          expiry_date: twentyDaysLater,
          estimated_unit_price: 5.00
        });

      // Item 3: Expired 2 days ago ($1.50 * 1 = $1.50)
      await request(app)
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Old Salad',
          category: 'produce',
          quantity: 1,
          unit: 'piece',
          expiry_date: twoDaysAgo,
          estimated_unit_price: 1.50
        });

      const res = await request(app)
        .get('/api/v1/dashboard')
        .set('Authorization', `Bearer ${userToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');

      const data = res.body.data;
      assert.ok(data.summary);
      assert.equal(data.summary.totalActiveItems, 3);
      assert.equal(data.summary.totalQuantity, 4);
      assert.equal(data.summary.totalEstimatedValue, 10.50); // 4.00 + 5.00 + 1.50
      assert.equal(data.summary.expiringSoonCount, 1); // Item 1 (within 7 days)
      assert.equal(data.summary.expiredCount, 1); // Item 3 (< today)

      // Use-First items should list Yogurt first (earliest upcoming expiry)
      assert.ok(Array.isArray(data.useFirst));
      assert.ok(data.useFirst.length >= 1);
      assert.equal(data.useFirst[0].name, 'Yogurt');
    });
  });
});
