import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { AIClientService } from '../src/services/aiClient.service.js';
import { IntelligenceService } from '../src/services/intelligence.service.js';
import { InventoryRepository } from '../src/repositories/inventory.repository.js';
import { InventoryService } from '../src/services/inventory.service.js';

describe('Use First AI Priority Scoring Integration', () => {
  const originalFetch = globalThis.fetch;
  let mockDb;
  let defaultHousehold;

  beforeEach(async () => {
    mockDb = await setupTestDatabase();
    defaultHousehold = mockDb.defaultHousehold;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    teardownTestDatabase();
  });

  // 1. The AI client calls POST /priority/score
  // 2. The outgoing request matches the real AI request schema
  test('AI client calls POST /priority/score with the real GroceryItem request schema', async () => {
    let capturedUrl = null;
    let capturedMethod = null;
    let capturedBody = null;

    globalThis.fetch = async (url, options) => {
      capturedUrl = String(url);
      capturedMethod = options.method;
      capturedBody = JSON.parse(options.body);

      return {
        ok: true,
        status: 200,
        json: async () => ({
          as_of_date: '2026-10-25',
          total_items: capturedBody.items.length,
          scored_items: capturedBody.items.map((item, idx) => ({
            item_id: item.item_id,
            product_name: item.product_name,
            product_found: true,
            rank: idx + 1,
            score: 75.0,
            priority_category: 'Orange',
            estimated_remaining_days: 3,
            warnings: [],
            explanation: 'Consume soon'
          }))
        })
      };
    };

    const aiClient = new AIClientService('http://localhost:8000', 2000);
    const payload = [
      {
        item_id: 'item-123',
        product_name: 'Organic Milk',
        purchase_date: '2026-10-20',
        opened: true,
        storage_zone: 'refrigerator',
        package_use_by_date: '2026-10-28'
      }
    ];

    const result = await aiClient.scoreUseFirst(payload);

    assert.ok(capturedUrl.endsWith('/priority/score'), `Expected URL to end with /priority/score, got: ${capturedUrl}`);
    assert.equal(capturedMethod, 'POST');
    assert.ok(capturedBody.items && Array.isArray(capturedBody.items));
    assert.equal(capturedBody.items.length, 1);

    const outgoingItem = capturedBody.items[0];
    assert.equal(outgoingItem.item_id, 'item-123');
    assert.equal(outgoingItem.product_name, 'Organic Milk');
    assert.equal(outgoingItem.purchase_date, '2026-10-20');
    assert.equal(outgoingItem.opened, true);
    assert.equal(outgoingItem.storage_zone, 'refrigerator');
    assert.equal(outgoingItem.package_use_by_date, '2026-10-28');

    assert.equal(result.total_items, 1);
    assert.equal(result.scored_items.length, 1);
  });

  // 3. The AI response containing scored_items is parsed correctly
  // 4. Scores map to the correct inventory item IDs
  test('IntelligenceService correctly parses scored_items and maps scores to matching inventory item IDs', async () => {
    const item1Id = crypto.randomUUID();
    const item2Id = crypto.randomUUID();

    mockDb.inventoryItemsTable.set(item1Id, {
      id: item1Id,
      household_id: defaultHousehold.id,
      name: 'Fresh Strawberries',
      category: 'produce',
      quantity: 1,
      unit: 'pack',
      storage_location: 'refrigerator',
      status: 'active',
      is_opened: true,
      purchase_date: '2026-10-22',
      expiry_date: '2026-10-26',
      adj_days_left: 1.0,
      use_first_score: 0,
      freshness_bucket: 'fresh',
      created_at: new Date().toISOString()
    });

    mockDb.inventoryItemsTable.set(item2Id, {
      id: item2Id,
      household_id: defaultHousehold.id,
      name: 'Greek Yogurt',
      category: 'dairy',
      quantity: 2,
      unit: 'cup',
      storage_location: 'refrigerator',
      status: 'active',
      is_opened: false,
      purchase_date: '2026-10-20',
      expiry_date: '2026-11-05',
      adj_days_left: 11.0,
      use_first_score: 0,
      freshness_bucket: 'fresh',
      created_at: new Date().toISOString()
    });

    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/shelf-life/estimate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ adj_days_left: 2.0, confidence: 0.9 })
        };
      }
      if (urlStr.includes('/priority/score')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            as_of_date: '2026-10-25',
            total_items: 2,
            scored_items: [
              {
                item_id: item1Id,
                product_name: 'Fresh Strawberries',
                product_found: true,
                rank: 1,
                score: 92.5,
                priority_category: 'Red',
                estimated_remaining_days: 1,
                warnings: ['opened_package'],
                explanation: 'Critical urgency'
              },
              {
                item_id: item2Id,
                product_name: 'Greek Yogurt',
                product_found: true,
                rank: 2,
                score: 25.0,
                priority_category: 'Green',
                estimated_remaining_days: 11,
                warnings: [],
                explanation: 'Plenty of time remaining'
              }
            ]
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const intelligence = new IntelligenceService();
    const result = await intelligence.processHousehold(defaultHousehold.id);

    assert.equal(result.itemsProcessed, 2);

    const savedItem1 = mockDb.inventoryItemsTable.get(item1Id);
    assert.equal(savedItem1.use_first_score, 93); // Math.round(92.5)
    assert.equal(savedItem1.freshness_bucket, 'critical'); // Red -> critical

    const savedItem2 = mockDb.inventoryItemsTable.get(item2Id);
    assert.equal(savedItem2.use_first_score, 25);
    assert.equal(savedItem2.freshness_bucket, 'fresh'); // Green -> fresh
  });

  // 5. The returned Use First list follows the AI ranking (use_first_score DESC)
  test('Dashboard returns Use First list sorted by AI priority score descending', async () => {
    const itemLow = crypto.randomUUID();
    const itemHigh = crypto.randomUUID();
    const itemMedium = crypto.randomUUID();

    // Low score (20), but earlier calendar expiry
    mockDb.inventoryItemsTable.set(itemLow, {
      id: itemLow,
      household_id: defaultHousehold.id,
      name: 'Canned Beans',
      quantity: 1,
      status: 'active',
      purchase_date: '2026-10-01',
      expiry_date: '2026-10-28',
      use_first_score: 20,
      freshness_bucket: 'fresh',
      created_at: new Date().toISOString()
    });

    // High score (95), but later calendar expiry
    mockDb.inventoryItemsTable.set(itemHigh, {
      id: itemHigh,
      household_id: defaultHousehold.id,
      name: 'Raw Chicken Breast',
      quantity: 1,
      status: 'active',
      purchase_date: '2026-10-24',
      expiry_date: '2026-10-31',
      use_first_score: 95,
      freshness_bucket: 'critical',
      created_at: new Date().toISOString()
    });

    // Medium score (60)
    mockDb.inventoryItemsTable.set(itemMedium, {
      id: itemMedium,
      household_id: defaultHousehold.id,
      name: 'Sliced Cheddar',
      quantity: 1,
      status: 'active',
      purchase_date: '2026-10-20',
      expiry_date: '2026-10-30',
      use_first_score: 60,
      freshness_bucket: 'use_soon',
      created_at: new Date().toISOString()
    });

    const inventoryRepo = new InventoryRepository();
    const dashboard = await inventoryRepo.getDashboardMetrics(defaultHousehold.id);

    assert.ok(dashboard.useFirst && Array.isArray(dashboard.useFirst));
    assert.equal(dashboard.useFirst.length, 3);

    // AI score order: 95 -> 60 -> 20
    assert.equal(dashboard.useFirst[0].id, itemHigh);
    assert.equal(dashboard.useFirst[1].id, itemMedium);
    assert.equal(dashboard.useFirst[2].id, itemLow);
  });

  // 6. Existing frontend-facing response formats remain compatible
  test('Dashboard preserves frontend compatibility with use_first_score and freshness_bucket', async () => {
    const itemId = crypto.randomUUID();
    mockDb.inventoryItemsTable.set(itemId, {
      id: itemId,
      household_id: defaultHousehold.id,
      name: 'Pasteurized Milk',
      quantity: 1,
      unit: 'bottle',
      status: 'active',
      purchase_date: '2026-10-23',
      expiry_date: '2026-10-28',
      use_first_score: 88,
      freshness_bucket: 'critical',
      created_at: new Date().toISOString()
    });

    const inventoryService = new InventoryService();
    const dashboard = await inventoryService.getDashboard(defaultHousehold.id);

    assert.ok(dashboard.summary);
    assert.ok(dashboard.expiringSoon);
    assert.ok(dashboard.useFirst);
    assert.ok(dashboard.wasteSummary);

    const firstItem = dashboard.useFirst[0];
    assert.equal(firstItem.id, itemId);
    assert.equal(firstItem.name, 'Pasteurized Milk');
    assert.equal(firstItem.use_first_score, 88);
    assert.equal(firstItem.freshness_bucket, 'critical');
  });

  // 7. AI failure activates the existing fallback without crashing the dashboard
  test('AI priority failure gracefully falls back to existing scores without crashing', async () => {
    const itemId = crypto.randomUUID();
    mockDb.inventoryItemsTable.set(itemId, {
      id: itemId,
      household_id: defaultHousehold.id,
      name: 'Tofu',
      category: 'produce',
      quantity: 1,
      status: 'active',
      purchase_date: '2026-10-20',
      expiry_date: '2026-10-29',
      adj_days_left: 4.0,
      use_first_score: 45,
      freshness_bucket: 'fresh',
      created_at: new Date().toISOString()
    });

    // Mock fetch where shelf-life succeeds but priority scoring throws
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/shelf-life/estimate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ adj_days_left: 4.0, confidence: 0.9 })
        };
      }
      if (urlStr.includes('/priority/score')) {
        throw new Error('AI Priority Service Unreachable');
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const intelligence = new IntelligenceService();
    // Must NOT throw
    const result = await intelligence.processHousehold(defaultHousehold.id);

    assert.equal(result.itemsProcessed, 1);
    const itemAfter = mockDb.inventoryItemsTable.get(itemId);
    // Preserves existing score
    assert.equal(itemAfter.use_first_score, 45);
  });

  // 8. Empty inventory is handled correctly
  test('Empty inventory produces 0 items processed and does not call AI', async () => {
    let aiCalled = false;
    globalThis.fetch = async () => {
      aiCalled = true;
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const intelligence = new IntelligenceService();
    const result = await intelligence.processHousehold(defaultHousehold.id);

    assert.equal(result.itemsProcessed, 0);
    assert.equal(result.alertsCreated, 0);
    assert.equal(aiCalled, false);
  });

  // 9. User-entered expiry dates remain unchanged
  test('User-entered expiry dates are never modified by priority scoring', async () => {
    const itemId = crypto.randomUUID();
    const userOriginalExpiry = '2026-11-15';

    mockDb.inventoryItemsTable.set(itemId, {
      id: itemId,
      household_id: defaultHousehold.id,
      name: 'Organic Apples',
      category: 'produce',
      quantity: 4,
      status: 'active',
      purchase_date: '2026-10-20',
      expiry_date: userOriginalExpiry,
      adj_days_left: null,
      use_first_score: 0,
      freshness_bucket: 'fresh',
      created_at: new Date().toISOString()
    });

    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/shelf-life/estimate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ adj_days_left: 21.0, confidence: 0.85 })
        };
      }
      if (urlStr.includes('/priority/score')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            as_of_date: '2026-10-25',
            total_items: 1,
            scored_items: [
              {
                item_id: itemId,
                product_name: 'Organic Apples',
                product_found: true,
                rank: 1,
                score: 15.0,
                priority_category: 'Green',
                estimated_remaining_days: 21,
                warnings: [],
                explanation: 'Low urgency'
              }
            ]
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const intelligence = new IntelligenceService();
    await intelligence.processHousehold(defaultHousehold.id);

    const saved = mockDb.inventoryItemsTable.get(itemId);
    assert.equal(saved.expiry_date, userOriginalExpiry, 'User-entered expiry date must never be modified');
    assert.equal(saved.use_first_score, 15);
  });

  // 10. AI priority client scoreUseFirst does not call /shelf-life/estimate
  test('scoreUseFirst only calls /priority/score and never /shelf-life/estimate', async () => {
    const calledEndpoints = [];

    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      calledEndpoints.push(urlStr);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          as_of_date: '2026-10-25',
          total_items: 1,
          scored_items: [
            {
              item_id: 'abc',
              product_name: 'Milk',
              product_found: true,
              rank: 1,
              score: 80,
              priority_category: 'Red',
              warnings: [],
              explanation: 'Urgent'
            }
          ]
        })
      };
    };

    const aiClient = new AIClientService('http://localhost:8000', 1000);
    await aiClient.scoreUseFirst([
      {
        item_id: 'abc',
        product_name: 'Milk',
        purchase_date: '2026-10-20',
        opened: false
      }
    ]);

    assert.equal(calledEndpoints.length, 1);
    assert.ok(calledEndpoints[0].includes('/priority/score'));
    assert.ok(!calledEndpoints[0].includes('/shelf-life/estimate'));
  });

  // 11. Items missing purchase_date are skipped safely without crashing
  test('Items with missing purchase_date are safely skipped from AI priority scoring', async () => {
    const itemWithDate = crypto.randomUUID();
    const itemWithoutDate = crypto.randomUUID();

    mockDb.inventoryItemsTable.set(itemWithDate, {
      id: itemWithDate,
      household_id: defaultHousehold.id,
      name: 'Yogurt',
      status: 'active',
      purchase_date: '2026-10-21',
      expiry_date: '2026-10-28',
      created_at: new Date().toISOString()
    });

    mockDb.inventoryItemsTable.set(itemWithoutDate, {
      id: itemWithoutDate,
      household_id: defaultHousehold.id,
      name: 'Mystery Leftover',
      status: 'active',
      purchase_date: null, // Null purchase date!
      expiry_date: '2026-10-28',
      created_at: new Date().toISOString()
    });

    let sentItems = [];
    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/shelf-life/estimate')) {
        return { ok: true, status: 200, json: async () => ({ adj_days_left: 3.0, confidence: 0.8 }) };
      }
      if (urlStr.includes('/priority/score')) {
        const body = JSON.parse(opts.body);
        sentItems = body.items;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            as_of_date: '2026-10-25',
            total_items: body.items.length,
            scored_items: body.items.map((it) => ({
              item_id: it.item_id,
              product_name: it.product_name,
              product_found: true,
              rank: 1,
              score: 70,
              priority_category: 'Orange',
              warnings: [],
              explanation: 'OK'
            }))
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const intelligence = new IntelligenceService();
    const result = await intelligence.processHousehold(defaultHousehold.id);

    assert.equal(result.itemsProcessed, 2);
    // Only itemWithDate should have been sent to the AI service
    assert.equal(sentItems.length, 1);
    assert.equal(sentItems[0].item_id, itemWithDate);
  });
});
