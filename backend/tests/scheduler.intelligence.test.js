import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { IntelligenceService } from '../src/services/intelligence.service.js';
import { SchedulerService } from '../src/services/scheduler.service.js';

describe('Scheduled Intelligence & Risk Alerts Suite (Phase 4)', () => {
  let mockDb;
  let defaultHousehold;
  let otherHousehold;
  let originalFetch;

  beforeEach(async () => {
    mockDb = await setupTestDatabase();
    defaultHousehold = mockDb.defaultHousehold;

    // Create a second household for cross-household isolation tests
    otherHousehold = {
      id: crypto.randomUUID(),
      name: 'Secondary Household',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    mockDb.householdsTable.set(otherHousehold.id, otherHousehold);

    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    teardownTestDatabase();
  });

  test('should process active items, call AI services, and update intelligence fields', async () => {
    const itemId = crypto.randomUUID();
    mockDb.inventoryItemsTable.set(itemId, {
      id: itemId,
      household_id: defaultHousehold.id,
      name: 'Organic Whole Milk',
      category: 'dairy',
      quantity: 1,
      unit: 'bottle',
      storage_location: 'refrigerator',
      status: 'active',
      is_opened: true,
      expiry_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      adj_days_left: null,
      use_first_score: 0,
      freshness_bucket: 'fresh',
      created_at: new Date().toISOString()
    });

    // Mock AI responses: /shelf-life/estimate and /use-first/score
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/shelf-life/estimate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            adj_days_left: 1.5,
            confidence: 0.95,
            risk_factors: ['opened_package', 'dairy']
          })
        };
      }

      if (urlStr.includes('/use-first/score')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            scores: [
              {
                item_id: itemId,
                use_first_score: 85,
                freshness_bucket: 'critical',
                recommendation: 'Use in cooking or freeze immediately'
              }
            ]
          })
        };
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' })
      };
    };

    const intelligence = new IntelligenceService({
      inventoryRepo: undefined,
      aiClient: undefined
    });

    const result = await intelligence.processHousehold(defaultHousehold.id);

    assert.equal(result.itemsProcessed, 1);
    assert.equal(result.alertsCreated, 1);

    const updatedItem = mockDb.inventoryItemsTable.get(itemId);
    assert.equal(updatedItem.adj_days_left, 1.5);
    assert.equal(updatedItem.use_first_score, 85);
    assert.equal(updatedItem.freshness_bucket, 'critical');
    assert.ok(updatedItem.last_intelligence_at);

    // Verify notification was generated for transition to critical
    const notifications = Array.from(mockDb.notificationsTable.values());
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].household_id, defaultHousehold.id);
    assert.equal(notifications[0].type, 'risk_transition');
    assert.equal(notifications[0].severity, 'critical');
    assert.ok(notifications[0].title.includes('Organic Whole Milk'));
  });

  test('should avoid duplicate alerts when risk state has not changed', async () => {
    const itemId = crypto.randomUUID();
    mockDb.inventoryItemsTable.set(itemId, {
      id: itemId,
      household_id: defaultHousehold.id,
      name: 'Baby Spinach',
      category: 'produce',
      quantity: 1,
      unit: 'bag',
      storage_location: 'refrigerator',
      status: 'active',
      is_opened: false,
      expiry_date: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
      adj_days_left: 1.0,
      use_first_score: 85,
      freshness_bucket: 'critical',
      created_at: new Date().toISOString()
    });

    // Seed existing recent notification for this item
    const notifId = crypto.randomUUID();
    mockDb.notificationsTable.set(notifId, {
      id: notifId,
      household_id: defaultHousehold.id,
      type: 'risk_transition',
      title: 'Critical Expiry Risk: Baby Spinach',
      message: 'Baby Spinach has estimated 1.0 days remaining.',
      severity: 'critical',
      created_at: new Date().toISOString()
    });

    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/shelf-life/estimate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ adj_days_left: 1.0, confidence: 0.9 })
        };
      }
      if (urlStr.includes('/use-first/score')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            scores: [{ item_id: itemId, use_first_score: 85, freshness_bucket: 'critical' }]
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const intelligence = new IntelligenceService();
    const result = await intelligence.processHousehold(defaultHousehold.id);

    assert.equal(result.itemsProcessed, 1);
    // Duplicate alert suppressed
    assert.equal(result.alertsCreated, 0);
  });

  test('should gracefully handle AI timeout and fallback without crashing or corrupting data', async () => {
    const itemId = crypto.randomUUID();
    mockDb.inventoryItemsTable.set(itemId, {
      id: itemId,
      household_id: defaultHousehold.id,
      name: 'Greek Yogurt',
      category: 'dairy',
      quantity: 2,
      unit: 'cup',
      storage_location: 'refrigerator',
      status: 'active',
      expiry_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      adj_days_left: null,
      use_first_score: 0,
      freshness_bucket: 'fresh',
      created_at: new Date().toISOString()
    });

    // Mock AI service failure / timeout
    globalThis.fetch = async () => {
      throw new Error('Connection timeout to FastAPI AI service');
    };

    const intelligence = new IntelligenceService();
    const result = await intelligence.processHousehold(defaultHousehold.id);

    assert.equal(result.itemsProcessed, 1);
    const updated = mockDb.inventoryItemsTable.get(itemId);
    // Preserved or calendar fallback without crashing
    assert.ok(updated.adj_days_left !== undefined);
  });

  test('should maintain strict household isolation during scheduled job', async () => {
    // Add item to household 1
    const itemH1 = crypto.randomUUID();
    mockDb.inventoryItemsTable.set(itemH1, {
      id: itemH1,
      household_id: defaultHousehold.id,
      name: 'Item H1',
      status: 'active',
      quantity: 1,
      created_at: new Date().toISOString()
    });

    // Add item to household 2
    const itemH2 = crypto.randomUUID();
    mockDb.inventoryItemsTable.set(itemH2, {
      id: itemH2,
      household_id: otherHousehold.id,
      name: 'Item H2',
      status: 'active',
      quantity: 1,
      created_at: new Date().toISOString()
    });

    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);
      const body = JSON.parse(opts.body || '{}');

      // Verify that when items are processed, only one household's items are passed
      if (urlStr.includes('/use-first/score')) {
        const itemIds = body.items.map((i) => i.id);
        const hasH1 = itemIds.includes(itemH1);
        const hasH2 = itemIds.includes(itemH2);
        // Can never mix both households together in a single AI payload
        assert.ok(!(hasH1 && hasH2), 'Household items must never be mixed in AI requests');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            scores: itemIds.map((id) => ({ item_id: id, use_first_score: 40, freshness_bucket: 'fresh' }))
          })
        };
      }

      if (urlStr.includes('/shelf-life/estimate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ adj_days_left: 5.0, confidence: 0.8 })
        };
      }

      return { ok: false, status: 404, json: async () => ({}) };
    };

    const intelligence = new IntelligenceService();
    const result = await intelligence.processAllHouseholds();

    assert.equal(result.totalItemsProcessed, 2);
  });

  test('SchedulerService should prevent overlapping execution when job is running', async () => {
    let mockResolver;
    const pendingPromise = new Promise((resolve) => {
      mockResolver = resolve;
    });

    const mockIntelligence = {
      processAllHouseholds: async () => {
        await pendingPromise;
        return { householdsProcessed: 1, totalItemsProcessed: 1, totalAlertsCreated: 0 };
      }
    };

    const scheduler = new SchedulerService({
      intelligenceService: mockIntelligence
    });

    // Launch first job
    const run1 = scheduler.runJob();
    assert.equal(scheduler.isRunning, true);

    // Launch second overlapping job while first is still active
    const run2 = await scheduler.runJob();
    // Overlapping execution must be skipped and return null
    assert.equal(run2, null);

    // Resolve first job
    mockResolver();
    const result1 = await run1;
    assert.ok(result1);
    assert.equal(scheduler.isRunning, false);
  });
});
