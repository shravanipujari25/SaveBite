import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken } from '../src/utils/token.js';
import { receiptRepository } from '../src/repositories/receipt.repository.js';

describe('Receipt Upload, Parsing & Confirmation Suite (Phase 3)', () => {
  let mockDb;
  let authToken;
  let otherAuthToken;
  let defaultUser;
  let defaultHousehold;
  let originalFetch;

  // Valid file buffers with true magic bytes
  const validJpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const validPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
  const invalidTextBuffer = Buffer.from('Plain text contents that do not match image or pdf signatures');

  beforeEach(async () => {
    mockDb = await setupTestDatabase();
    defaultUser = mockDb.defaultUser;
    defaultHousehold = mockDb.defaultHousehold;

    authToken = generateAccessToken(defaultUser);

    // Create a second household user for isolation tests
    const otherUser = {
      id: '22222222-3333-4444-5555-666666666666',
      name: 'Other Chef',
      email: 'other@savebite.com',
      token_version: 1
    };
    mockDb.usersTable.set(otherUser.id, otherUser);

    const otherHousehold = {
      id: 'hhhhhhhh-2222-3333-4444-555555555555',
      name: "Other Household"
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

    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    teardownTestDatabase();
  });

  describe('POST /api/v1/receipts/upload', () => {
    test('should successfully upload a valid JPEG receipt and register in database', async () => {
      const res = await request(app)
        .post('/api/v1/receipts/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', validJpegBuffer, 'receipt.jpg');

      assert.equal(res.status, 201);
      assert.equal(res.body.status, 'success');
      assert.ok(res.body.data.receipt.id);
      assert.equal(res.body.data.receipt.household_id, defaultHousehold.id);
      assert.equal(res.body.data.receipt.status, 'uploaded');
      assert.equal(res.body.data.receipt.mime_type, 'image/jpeg');

      // Verify stored in mock database
      const stored = mockDb.receiptsTable.get(res.body.data.receipt.id);
      assert.ok(stored);
      assert.equal(stored.file_name, 'receipt.jpg');
    });

    test('should successfully upload when using the "receipt" alias form field name', async () => {
      const res = await request(app)
        .post('/api/v1/receipts/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('receipt', validJpegBuffer, 'receipt_alias.jpg');

      assert.equal(res.status, 201);
      assert.equal(res.body.status, 'success');
      assert.ok(res.body.data.receipt.id);
      assert.equal(res.body.data.receipt.file_name, 'receipt_alias.jpg');
    });

    test('should successfully upload a valid PDF receipt', async () => {
      const res = await request(app)
        .post('/api/v1/receipts/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', validPdfBuffer, 'grocery_invoice.pdf');

      assert.equal(res.status, 201);
      assert.equal(res.body.status, 'success');
      assert.equal(res.body.data.receipt.mime_type, 'application/pdf');
    });

    test('should reject unsupported file format with 415 Unsupported Media Type', async () => {
      const res = await request(app)
        .post('/api/v1/receipts/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', invalidTextBuffer, 'notes.txt');

      assert.equal(res.status, 415);
      assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
    });

    test('should reject request missing file with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/receipts/upload')
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'FILE_MISSING');
    });

    test('should reject empty file with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/receipts/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', Buffer.alloc(0), 'empty.jpg');

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'EMPTY_FILE');
    });

    test('should reject request without authentication with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/receipts/upload')
        .attach('file', validJpegBuffer, 'receipt.jpg');

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    test('should reject user without household membership with 403 Forbidden', async () => {
      const unattachedUser = {
        id: '99999999-0000-1111-2222-333333333333',
        name: 'No Household User',
        email: 'nohousehold@savebite.com',
        token_version: 1
      };
      mockDb.usersTable.set(unattachedUser.id, unattachedUser);
      const unattachedToken = generateAccessToken(unattachedUser);

      const res = await request(app)
        .post('/api/v1/receipts/upload')
        .set('Authorization', `Bearer ${unattachedToken}`)
        .attach('file', validJpegBuffer, 'receipt.jpg');

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN_HOUSEHOLD');
    });

    test('should reject file exceeding maximum size limit with 413 Payload Too Large', async () => {
      // 11MB file buffer
      const oversizedBuffer = Buffer.alloc(11 * 1024 * 1024);
      oversizedBuffer[0] = 0xFF;
      oversizedBuffer[1] = 0xD8;
      oversizedBuffer[2] = 0xFF;

      const res = await request(app)
        .post('/api/v1/receipts/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', oversizedBuffer, 'huge_receipt.jpg');

      assert.equal(res.status, 413);
      assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
    });

    test('should return 500 when Supabase Storage upload fails', async () => {
      mockDb.client.__storageFailUpload = true;

      const res = await request(app)
        .post('/api/v1/receipts/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', validJpegBuffer, 'receipt.jpg');

      assert.equal(res.status, 500);
      assert.equal(res.body.error.code, 'STORAGE_UPLOAD_FAILED');
    });

    test('should rollback and remove uploaded storage file if database insert fails', async () => {
      const origCreateReceipt = receiptRepository.createReceipt;
      receiptRepository.createReceipt = async () => {
        throw new Error('Simulated database insert failure');
      };

      try {
        const res = await request(app)
          .post('/api/v1/receipts/upload')
          .set('Authorization', `Bearer ${authToken}`)
          .attach('file', validJpegBuffer, 'receipt.jpg');

        assert.equal(res.status, 500);
        assert.ok(mockDb.client.__removedStoragePaths);
        assert.equal(mockDb.client.__removedStoragePaths.length, 1);
        assert.ok(mockDb.client.__removedStoragePaths[0].includes('households/'));
      } finally {
        receiptRepository.createReceipt = origCreateReceipt;
      }
    });
  });

  describe('POST /api/v1/receipts/:receiptId/parse', () => {
    let testReceiptId;

    beforeEach(async () => {
      testReceiptId = crypto.randomUUID();
      mockDb.receiptsTable.set(testReceiptId, {
        id: testReceiptId,
        household_id: defaultHousehold.id,
        uploaded_by: defaultUser.id,
        storage_path: `households/${defaultHousehold.id}/receipts/${testReceiptId}.jpg`,
        file_name: 'test_receipt.jpg',
        mime_type: 'image/jpeg',
        file_size_bytes: 1024,
        status: 'uploaded',
        created_at: new Date().toISOString()
      });
    });

    test('should parse receipt via AI, auto-create high-confidence items, and leave low-confidence items pending', async () => {
      // Mock AI endpoints: /receipt/parse and /normalize
      globalThis.fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/receipt/parse')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              items: [
                {
                  name: 'ORG WHOLE MILK 1GAL',
                  quantity: 1,
                  unit: 'bottle',
                  unit_price: 4.99,
                  total_price: 4.99,
                  confidence: 0.95 // High confidence
                },
                {
                  name: 'UNCL BANANAS BUNCH',
                  quantity: 2,
                  unit: 'lb',
                  unit_price: 0.69,
                  total_price: 1.38,
                  confidence: 0.70 // Low confidence -> < 0.85 threshold
                }
              ],
              purchase_date: '2026-10-24',
              merchant_name: 'Supermart'
            })
          };
        }

        if (urlStr.endsWith('/normalize')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              normalized_name: 'Organic Whole Milk',
              category: 'dairy',
              unit: 'bottle',
              storage_location: 'refrigerator',
              confidence: 0.98
            })
          };
        }

        return { ok: false, status: 404 };
      };

      const res = await request(app)
        .post(`/api/v1/receipts/${testReceiptId}/parse`)
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.equal(res.body.data.receipt_id, testReceiptId);
      assert.equal(res.body.data.status, 'parsed');
      assert.equal(res.body.data.auto_created_count, 1);
      assert.equal(res.body.data.pending_count, 1);

      // Verify the high-confidence item was created in inventory
      const invItems = Array.from(mockDb.inventoryItemsTable.values());
      assert.equal(invItems.length, 1);
      assert.equal(invItems[0].name, 'Organic Whole Milk');
      assert.equal(invItems[0].category, 'dairy');
      assert.equal(invItems[0].storage_location, 'refrigerator');
    });

    test('should gracefully handle product normalization failure by preserving raw item', async () => {
      globalThis.fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/receipt/parse')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              items: [
                {
                  name: 'SPECIAL ARTISAN CHEESE',
                  quantity: 1,
                  unit: 'piece',
                  unit_price: 8.50,
                  total_price: 8.50,
                  confidence: 0.90
                }
              ]
            })
          };
        }

        if (urlStr.endsWith('/normalize')) {
          // Simulate normalization service failure
          return {
            ok: false,
            status: 500,
            text: async () => 'Internal AI model normalization crash'
          };
        }

        return { ok: false, status: 404 };
      };

      const res = await request(app)
        .post(`/api/v1/receipts/${testReceiptId}/parse`)
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      // When normalization fails, confidence drops to 0.9 * 0.5 = 0.45 (< 0.85), so item remains pending
      assert.equal(res.body.data.pending_count, 1);
      assert.equal(res.body.data.items[0].raw_name, 'SPECIAL ARTISAN CHEESE');
    });

    test('should return 504 Gateway Timeout when AI service times out', async () => {
      globalThis.fetch = async () => {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        throw err;
      };

      const res = await request(app)
        .post(`/api/v1/receipts/${testReceiptId}/parse`)
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 504);
      assert.equal(res.body.error.code, 'AI_SERVICE_TIMEOUT');

      // Verify receipt status was updated to failed
      const receipt = mockDb.receiptsTable.get(testReceiptId);
      assert.equal(receipt.status, 'failed');
    });

    test('should return 502 Bad Gateway when AI service returns malformed response', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          unexpected_key: 'malformed_data_structure'
        })
      });

      const res = await request(app)
        .post(`/api/v1/receipts/${testReceiptId}/parse`)
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 502);
      assert.equal(res.body.error.code, 'AI_MALFORMED_RESPONSE');
    });

    test('should prevent cross-household receipt parsing with 404', async () => {
      const res = await request(app)
        .post(`/api/v1/receipts/${testReceiptId}/parse`)
        .set('Authorization', `Bearer ${otherAuthToken}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'RECEIPT_NOT_FOUND');
    });
  });

  describe('Low-Confidence Item Confirmation & Rejection', () => {
    let testReceiptId;
    let pendingLineId;
    let autoCreatedLineId;

    beforeEach(async () => {
      testReceiptId = crypto.randomUUID();
      pendingLineId = crypto.randomUUID();
      autoCreatedLineId = crypto.randomUUID();

      mockDb.receiptsTable.set(testReceiptId, {
        id: testReceiptId,
        household_id: defaultHousehold.id,
        status: 'parsed',
        created_at: new Date().toISOString()
      });

      mockDb.receiptItemsTable.set(pendingLineId, {
        id: pendingLineId,
        receipt_id: testReceiptId,
        household_id: defaultHousehold.id,
        raw_name: 'UNCL BANANAS',
        normalized_name: 'Bananas',
        category: 'produce',
        quantity: 3,
        unit: 'piece',
        unit_price: 0.50,
        confidence: 0.65,
        status: 'pending',
        inventory_item_id: null
      });

      mockDb.receiptItemsTable.set(autoCreatedLineId, {
        id: autoCreatedLineId,
        receipt_id: testReceiptId,
        household_id: defaultHousehold.id,
        raw_name: 'WHOLE MILK',
        normalized_name: 'Whole Milk',
        category: 'dairy',
        quantity: 1,
        unit: 'bottle',
        confidence: 0.95,
        status: 'auto_created',
        inventory_item_id: 'existing-inv-item-id'
      });
    });

    test('GET /api/v1/receipts/:receiptId/items - should return all parsed line items for household', async () => {
      const res = await request(app)
        .get(`/api/v1/receipts/${testReceiptId}/items`)
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.equal(res.body.data.items.length, 2);
    });

    test('POST /api/v1/receipts/:receiptId/items/:lineId/confirm - should confirm item with user corrections and add to inventory', async () => {
      const res = await request(app)
        .post(`/api/v1/receipts/${testReceiptId}/items/${pendingLineId}/confirm`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Fresh Cavendish Bananas',
          category: 'produce',
          quantity: 6,
          unit: 'piece',
          storage_location: 'counter',
          purchase_date: '2026-10-24'
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.equal(res.body.data.line_item.status, 'confirmed');
      assert.ok(res.body.data.inventory_item.id);
      assert.equal(res.body.data.inventory_item.name, 'Fresh Cavendish Bananas');
      assert.equal(res.body.data.inventory_item.storage_location, 'counter');
    });

    test('should reject duplicate confirmation with 409 Conflict', async () => {
      const res = await request(app)
        .post(`/api/v1/receipts/${testReceiptId}/items/${autoCreatedLineId}/confirm`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Milk Duplicate' });

      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'ALREADY_CONFIRMED');
    });

    test('POST /api/v1/receipts/:receiptId/items/:lineId/reject - should mark item as rejected', async () => {
      const res = await request(app)
        .post(`/api/v1/receipts/${testReceiptId}/items/${pendingLineId}/reject`)
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.equal(res.body.data.line_item.status, 'rejected');

      const updated = mockDb.receiptItemsTable.get(pendingLineId);
      assert.equal(updated.status, 'rejected');
    });

    test('should prevent rejecting an item that has already been created in inventory (409 Conflict)', async () => {
      const res = await request(app)
        .post(`/api/v1/receipts/${testReceiptId}/items/${autoCreatedLineId}/reject`)
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'ITEM_ALREADY_CREATED');
    });

    test('should prevent cross-household confirmation with 404 Line Item Not Found', async () => {
      const res = await request(app)
        .post(`/api/v1/receipts/${testReceiptId}/items/${pendingLineId}/confirm`)
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .send({ name: 'Cross Household Hack' });

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'LINE_ITEM_NOT_FOUND');
    });
  });
});
