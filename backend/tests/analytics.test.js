import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Analytics & Savings Intelligence Suite (Phase 4)', () => {
  let mockDb;
  let authToken;
  let defaultUser;
  let defaultHousehold;

  beforeEach(async () => {
    mockDb = await setupTestDatabase();
    defaultUser = mockDb.defaultUser;
    defaultHousehold = mockDb.defaultHousehold;
    authToken = generateAccessToken(defaultUser);
  });

  afterEach(() => {
    teardownTestDatabase();
  });

  test('GET /api/v1/analytics/waste aggregates records and value by period', async () => {
    const now = new Date();
    const waste1 = crypto.randomUUID();
    mockDb.wasteLogTable.set(waste1, {
      id: waste1,
      household_id: defaultHousehold.id,
      item_name: 'Strawberries',
      category: 'produce',
      quantity: 1,
      unit: 'pack',
      reason: 'spoiled',
      estimated_value: 4.50,
      wasted_at: now.toISOString()
    });

    const waste2 = crypto.randomUUID();
    mockDb.wasteLogTable.set(waste2, {
      id: waste2,
      household_id: defaultHousehold.id,
      item_name: 'Cheddar Cheese',
      category: 'dairy',
      quantity: 0.5,
      unit: 'block',
      reason: 'mold',
      estimated_value: 3.00,
      wasted_at: now.toISOString()
    });

    const res = await request(app)
      .get('/api/v1/analytics/waste?period=month')
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
    assert.equal(res.body.data.total_items_wasted, 2);
    assert.equal(res.body.data.total_wasted_quantity, 1.5);
    assert.equal(res.body.data.total_estimated_value, 7.50);
    assert.equal(res.body.data.reasons_breakdown.spoiled, 1);
    assert.equal(res.body.data.reasons_breakdown.mold, 1);
  });

  test('GET /api/v1/analytics/most-wasted ranks items by monetary value and groups units', async () => {
    const now = new Date();
    const id1 = crypto.randomUUID();
    mockDb.wasteLogTable.set(id1, {
      id: id1,
      household_id: defaultHousehold.id,
      item_name: 'Avocado',
      quantity: 2,
      unit: 'piece',
      estimated_value: 5.00,
      wasted_at: now.toISOString()
    });

    const id2 = crypto.randomUUID();
    mockDb.wasteLogTable.set(id2, {
      id: id2,
      household_id: defaultHousehold.id,
      item_name: 'avocado', // lowercase variant for normalization test
      quantity: 1,
      unit: 'piece',
      estimated_value: 2.50,
      wasted_at: now.toISOString()
    });

    const id3 = crypto.randomUUID();
    mockDb.wasteLogTable.set(id3, {
      id: id3,
      household_id: defaultHousehold.id,
      item_name: 'Bread',
      quantity: 1,
      unit: 'loaf',
      estimated_value: 3.00,
      wasted_at: now.toISOString()
    });

    const res = await request(app)
      .get('/api/v1/analytics/most-wasted?period=month')
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(res.status, 200);
    const mostWasted = res.body.data.most_wasted_items;
    assert.equal(mostWasted.length, 2);
    // Avocado should be top with 7.50 value and 2 events
    assert.equal(mostWasted[0].item_name.toLowerCase(), 'avocado');
    assert.equal(mostWasted[0].total_estimated_value, 7.50);
    assert.equal(mostWasted[0].waste_events_count, 2);
    assert.equal(mostWasted[0].quantities_by_unit.piece, 3);
  });

  test('GET /api/v1/analytics/savings retrieves avoided-waste values from logs', async () => {
    const now = new Date();
    const saveId = crypto.randomUUID();
    mockDb.avoidedWasteLogTable.set(saveId, {
      id: saveId,
      household_id: defaultHousehold.id,
      item_name: 'Ripe Bananas',
      quantity: 4,
      unit: 'piece',
      estimated_savings: 2.40,
      source: 'recipe_rescue',
      recipe_name: 'Banana Bread',
      consumed_at: now.toISOString()
    });

    const res = await request(app)
      .get('/api/v1/analytics/savings?period=month')
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.total_avoided_waste_events, 1);
    assert.equal(res.body.data.total_estimated_savings, 2.40);
    assert.equal(res.body.data.savings_by_source.recipe_rescue, 2.40);
  });

  test('GET /api/v1/analytics/monthly-comparison handles zero-baseline division cleanly', async () => {
    // Current month waste ($10.00), previous month zero waste
    const now = new Date();
    const curYear = now.getUTCFullYear();
    const curMonth = String(now.getUTCMonth() + 1).padStart(2, '0');
    const targetMonth = `${curYear}-${curMonth}`;

    const wasteId = crypto.randomUUID();
    mockDb.wasteLogTable.set(wasteId, {
      id: wasteId,
      household_id: defaultHousehold.id,
      item_name: 'Steak',
      quantity: 1,
      unit: 'piece',
      estimated_value: 15.00,
      wasted_at: now.toISOString()
    });

    const res = await request(app)
      .get(`/api/v1/analytics/monthly-comparison?month=${targetMonth}`)
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');

    const comparison = res.body.data.waste_cost_comparison;
    assert.equal(comparison.current, 15.00);
    assert.equal(comparison.previous, 0.00);
    assert.equal(comparison.absolute_change, 15.00);
    // Should safely report 100% instead of NaN or Infinity
    assert.equal(comparison.percentage_change, 100.0);
  });
});
