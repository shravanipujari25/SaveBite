import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken } from '../src/utils/token.js';
import { openFoodFactsService } from '../src/services/openFoodFacts.service.js';

describe('Barcode Lookup Suite — Open Food Facts (Phase 3)', () => {
  let mockDb;
  let authToken;
  let originalFetch;

  beforeEach(async () => {
    mockDb = await setupTestDatabase();
    authToken = generateAccessToken(mockDb.defaultUser);

    originalFetch = globalThis.fetch;
    // Clear in-memory cache between test runs
    openFoodFactsService.cache.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    teardownTestDatabase();
  });

  test('GET /api/v1/barcodes/:barcode - should successfully lookup and normalize product details', async () => {
    const testBarcode = '8901030928114';

    globalThis.fetch = async (url, opts) => {
      // Verify User-Agent header was included
      assert.ok(opts.headers['User-Agent'].includes('SaveBite'));

      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 1,
          product: {
            product_name: 'Maggi 2-Minute Noodles',
            brands: 'Nestle',
            categories: 'Groceries, Noodles, Instant noodles',
            ingredients_text: 'Wheat flour, palm oil, salt, mineral',
            quantity: '70 g',
            image_front_url: 'https://images.openfoodfacts.org/images/products/maggi.jpg'
          }
        })
      };
    };

    const res = await request(app)
      .get(`/api/v1/barcodes/${testBarcode}`)
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
    assert.equal(res.body.data.product.barcode, testBarcode);
    assert.equal(res.body.data.product.name, 'Maggi 2-Minute Noodles');
    assert.equal(res.body.data.product.brand, 'Nestle');
    assert.deepEqual(res.body.data.product.categories, ['Groceries', 'Noodles', 'Instant noodles']);
    assert.equal(res.body.data.product.verified, true);
    assert.ok(res.body.data.product.attribution);

    // Verify it did NOT auto-create an inventory item
    assert.equal(mockDb.inventoryItemsTable.size, 0);
  });

  test('should return cached result on consecutive calls without secondary HTTP dispatch', async () => {
    const testBarcode = '0711425902188';
    let fetchCallCount = 0;

    globalThis.fetch = async () => {
      fetchCallCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 1,
          product: {
            product_name: 'Organic Whole Milk',
            brands: 'Horizon Organic'
          }
        })
      };
    };

    // First call
    const res1 = await request(app)
      .get(`/api/v1/barcodes/${testBarcode}`)
      .set('Authorization', `Bearer ${authToken}`);
    assert.equal(res1.status, 200);
    assert.equal(fetchCallCount, 1);

    // Second call should hit in-memory cache
    const res2 = await request(app)
      .get(`/api/v1/barcodes/${testBarcode}`)
      .set('Authorization', `Bearer ${authToken}`);
    assert.equal(res2.status, 200);
    assert.equal(fetchCallCount, 1);
  });

  test('should return 404 when product is not found in Open Food Facts database', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 0,
        status_verbose: 'product not found'
      })
    });

    const res = await request(app)
      .get('/api/v1/barcodes/9999999999999')
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'PRODUCT_NOT_FOUND');
  });

  test('should return 504 Gateway Timeout when external Open Food Facts service times out', async () => {
    globalThis.fetch = async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    };

    const res = await request(app)
      .get('/api/v1/barcodes/8901030928114')
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(res.status, 504);
    assert.equal(res.body.error.code, 'UPSTREAM_TIMEOUT');
  });

  test('should return 502 when Open Food Facts returns a 5xx server error', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable'
    });

    const res = await request(app)
      .get('/api/v1/barcodes/8901030928114')
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'UPSTREAM_SERVICE_ERROR');
  });

  test('should reject invalid barcode format (letters, short or long length) with 400 Bad Request', async () => {
    const resLetters = await request(app)
      .get('/api/v1/barcodes/invalid-barcode-code')
      .set('Authorization', `Bearer ${authToken}`);
    assert.equal(resLetters.status, 400);

    const resShort = await request(app)
      .get('/api/v1/barcodes/1234')
      .set('Authorization', `Bearer ${authToken}`);
    assert.equal(resShort.status, 400);

    const resLong = await request(app)
      .get('/api/v1/barcodes/12345678901234567890')
      .set('Authorization', `Bearer ${authToken}`);
    assert.equal(resLong.status, 400);
  });
});
