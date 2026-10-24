import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Camera Upload & Freshness Analysis Suite (Phase 3)', () => {
  let mockDb;
  let authToken;
  let otherAuthToken;
  let testItemId;
  let otherHouseholdItemId;
  let originalFetch;

  // Valid binary image buffer with JPEG signature (FF D8 FF)
  const validImageBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
  // PDF buffer - valid for receipts, but invalid for camera scans
  const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

  beforeEach(async () => {
    mockDb = await setupTestDatabase();
    const defaultUser = mockDb.defaultUser;
    const defaultHousehold = mockDb.defaultHousehold;

    authToken = generateAccessToken(defaultUser);

    testItemId = crypto.randomUUID();
    mockDb.inventoryItemsTable.set(testItemId, {
      id: testItemId,
      household_id: defaultHousehold.id,
      name: 'Fresh Strawberries',
      category: 'produce',
      quantity: 1,
      unit: 'pack',
      storage_location: 'refrigerator',
      status: 'active',
      freshness_score: null,
      created_at: new Date().toISOString()
    });

    // Create a second household user and item for isolation checks
    const otherUser = {
      id: '22222222-3333-4444-5555-666666666666',
      name: 'Other Chef',
      email: 'other@savebite.com',
      token_version: 1
    };
    mockDb.usersTable.set(otherUser.id, otherUser);

    const otherHousehold = {
      id: 'hhhhhhhh-2222-3333-4444-555555555555',
      name: 'Other Household'
    };
    mockDb.householdsTable.set(otherHousehold.id, otherHousehold);

    mockDb.householdMembersTable.set('other-member-id', {
      id: 'other-member-id',
      household_id: otherHousehold.id,
      user_id: otherUser.id,
      status: 'active',
      role: 'owner'
    });

    otherAuthToken = generateAccessToken(otherUser);

    otherHouseholdItemId = crypto.randomUUID();
    mockDb.inventoryItemsTable.set(otherHouseholdItemId, {
      id: otherHouseholdItemId,
      household_id: otherHousehold.id,
      name: 'Avocado',
      category: 'produce',
      status: 'active'
    });

    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    teardownTestDatabase();
  });

  test('POST /api/v1/inventory/:itemId/freshness-scan - should analyze camera image, store scan history, and return score with disclaimer', async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/freshness/analyze')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            freshness_score: 82.5,
            status: 'fresh',
            confidence: 0.94,
            notes: 'Vibrant red pigmentation, firm texture, no surface molds detected.'
          })
        };
      }
      return { ok: false, status: 404 };
    };

    const res = await request(app)
      .post(`/api/v1/inventory/${testItemId}/freshness-scan`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', validImageBuffer, 'strawberry.jpg');

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
    assert.ok(res.body.data.scan_id);
    assert.equal(res.body.data.inventory_item_id, testItemId);
    assert.equal(res.body.data.freshness_score, 82.5);
    assert.equal(res.body.data.status, 'fresh');
    assert.equal(res.body.data.confidence, 0.94);
    assert.ok(res.body.data.disclaimer.includes('does not guarantee food safety'));

    // Verify scan record was saved in freshness_scans table
    const storedScan = mockDb.freshnessScansTable.get(res.body.data.scan_id);
    assert.ok(storedScan);
    assert.equal(storedScan.inventory_item_id, testItemId);
    assert.equal(storedScan.freshness_score, 82.5);

    // Verify inventory item was updated with freshness_score
    const updatedItem = mockDb.inventoryItemsTable.get(testItemId);
    assert.equal(updatedItem.freshness_score, 82.5);
  });

  test('should reject PDF format for camera freshness scan with 415 Unsupported Media Type', async () => {
    const res = await request(app)
      .post(`/api/v1/inventory/${testItemId}/freshness-scan`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', pdfBuffer, 'document.pdf');

    assert.equal(res.status, 415);
    assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
  });

  test('should reject request missing image attachment with 400 Bad Request', async () => {
    const res = await request(app)
      .post(`/api/v1/inventory/${testItemId}/freshness-scan`)
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'FILE_MISSING');
  });

  test('should prevent cross-household freshness scan with 404 Item Not Found', async () => {
    const res = await request(app)
      .post(`/api/v1/inventory/${otherHouseholdItemId}/freshness-scan`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', validImageBuffer, 'scan.jpg');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'ITEM_NOT_FOUND');
  });

  test('should return 504 Gateway Timeout when AI freshness endpoint times out', async () => {
    globalThis.fetch = async () => {
      const err = new Error('AI analysis timed out');
      err.name = 'TimeoutError';
      throw err;
    };

    const res = await request(app)
      .post(`/api/v1/inventory/${testItemId}/freshness-scan`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', validImageBuffer, 'scan.jpg');

    assert.equal(res.status, 504);
    assert.equal(res.body.error.code, 'AI_SERVICE_TIMEOUT');
  });
});
