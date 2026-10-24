import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Multi-Item Ingredient Consumption & Recipe Rescue Suite (Phase 4)', () => {
  let mockDb;
  let authToken;
  let otherAuthToken;
  let defaultUser;
  let defaultHousehold;
  let otherHousehold;
  let originalFetch;

  beforeEach(async () => {
    mockDb = await setupTestDatabase();
    defaultUser = mockDb.defaultUser;
    defaultHousehold = mockDb.defaultHousehold;
    authToken = generateAccessToken(defaultUser);

    // Create other household
    const otherUser = {
      id: crypto.randomUUID(),
      name: 'Other Chef',
      email: 'otherchef@savebite.com',
      token_version: 1
    };
    mockDb.usersTable.set(otherUser.id, otherUser);

    otherHousehold = {
      id: crypto.randomUUID(),
      name: "Other Chef's Household"
    };
    mockDb.householdsTable.set(otherHousehold.id, otherHousehold);

    mockDb.householdMembersTable.set('other-member-uuid', {
      id: 'other-member-uuid',
      household_id: otherHousehold.id,
      user_id: otherUser.id,
      role: 'owner',
      status: 'active'
    });

    otherAuthToken = generateAccessToken(otherUser);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    teardownTestDatabase();
  });

  describe('POST /api/v1/inventory/use-ingredients', () => {
    test('should atomically consume multiple items and track avoided waste for at-risk items', async () => {
      // Item 1: At-risk milk with unit price
      const milkId = crypto.randomUUID();
      mockDb.inventoryItemsTable.set(milkId, {
        id: milkId,
        household_id: defaultHousehold.id,
        name: 'Whole Milk',
        quantity: 2,
        unit: 'bottle',
        estimated_unit_price: 3.50,
        use_first_score: 85,
        freshness_bucket: 'critical',
        status: 'active',
        created_at: new Date().toISOString()
      });

      // Item 2: Safe flour without risk
      const flourId = crypto.randomUUID();
      mockDb.inventoryItemsTable.set(flourId, {
        id: flourId,
        household_id: defaultHousehold.id,
        name: 'All-Purpose Flour',
        quantity: 5,
        unit: 'cup',
        estimated_unit_price: 0.50,
        use_first_score: 20,
        freshness_bucket: 'fresh',
        status: 'active',
        created_at: new Date().toISOString()
      });

      const res = await request(app)
        .post('/api/v1/inventory/use-ingredients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          items: [
            { inventory_item_id: milkId, quantity: 2 }, // fully depleted
            { inventory_item_id: flourId, quantity: 1 }  // partially consumed
          ],
          source: 'recipe_rescue',
          recipe_name: 'Pancakes'
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');

      const data = res.body.data;
      assert.equal(data.consumed_items.length, 2);

      // Verify milk depleted to 0 and marked consumed
      const updatedMilk = mockDb.inventoryItemsTable.get(milkId);
      assert.equal(updatedMilk.quantity, 0);
      assert.equal(updatedMilk.status, 'consumed');

      // Verify flour reduced to 4 and remained active
      const updatedFlour = mockDb.inventoryItemsTable.get(flourId);
      assert.equal(updatedFlour.quantity, 4);
      assert.equal(updatedFlour.status, 'active');

      // Avoided waste savings calculated for at-risk milk (2 * 3.50 = 7.00)
      assert.equal(data.total_avoided_savings, 7.00);

      const avoidedLogs = Array.from(mockDb.avoidedWasteLogTable.values());
      assert.equal(avoidedLogs.length, 1);
      assert.equal(avoidedLogs[0].item_name, 'Whole Milk');
      assert.equal(avoidedLogs[0].estimated_savings, 7.00);
      assert.equal(avoidedLogs[0].recipe_name, 'Pancakes');
    });

    test('should reject atomically when requested quantity exceeds available stock', async () => {
      const cheeseId = crypto.randomUUID();
      mockDb.inventoryItemsTable.set(cheeseId, {
        id: cheeseId,
        household_id: defaultHousehold.id,
        name: 'Cheddar Cheese',
        quantity: 1,
        unit: 'block',
        status: 'active',
        created_at: new Date().toISOString()
      });

      const res = await request(app)
        .post('/api/v1/inventory/use-ingredients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          items: [
            { inventory_item_id: cheeseId, quantity: 5 } // only 1 available!
          ]
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INSUFFICIENT_STOCK');

      // Verify stock was unchanged (strict atomicity)
      const item = mockDb.inventoryItemsTable.get(cheeseId);
      assert.equal(item.quantity, 1);
      assert.equal(item.status, 'active');
    });

    test('should reject if an item belongs to another household', async () => {
      const otherItemId = crypto.randomUUID();
      mockDb.inventoryItemsTable.set(otherItemId, {
        id: otherItemId,
        household_id: otherHousehold.id, // different household
        name: 'Hidden Apples',
        quantity: 3,
        unit: 'piece',
        status: 'active'
      });

      const res = await request(app)
        .post('/api/v1/inventory/use-ingredients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          items: [{ inventory_item_id: otherItemId, quantity: 1 }]
        });

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    test('should reject if item is already inactive or consumed', async () => {
      const consumedId = crypto.randomUUID();
      mockDb.inventoryItemsTable.set(consumedId, {
        id: consumedId,
        household_id: defaultHousehold.id,
        name: 'Finished Milk',
        quantity: 0,
        unit: 'bottle',
        status: 'consumed'
      });

      const res = await request(app)
        .post('/api/v1/inventory/use-ingredients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          items: [{ inventory_item_id: consumedId, quantity: 1 }]
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'ITEM_INACTIVE');
    });
  });

  describe('GET /api/v1/recipes/rescue', () => {
    test('should return recipe rescue suggestions prioritizing at-risk inventory', async () => {
      const tomatoId = crypto.randomUUID();
      mockDb.inventoryItemsTable.set(tomatoId, {
        id: tomatoId,
        household_id: defaultHousehold.id,
        name: 'Ripe Tomatoes',
        quantity: 4,
        unit: 'piece',
        use_first_score: 90,
        adj_days_left: 1.0,
        freshness_bucket: 'critical',
        status: 'active',
        created_at: new Date().toISOString()
      });

      // Mock AI recipe response
      globalThis.fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/recipes/rescue')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              recipes: [
                {
                  id: 'rec-1',
                  title: 'Fresh Tomato Basil Pasta',
                  description: 'A quick 15-minute pasta dish using ripe tomatoes.',
                  prep_time_minutes: 5,
                  cook_time_minutes: 10,
                  servings: 2,
                  ingredients: ['Ripe Tomatoes', 'Pasta', 'Olive Oil', 'Garlic'],
                  instructions: ['Boil pasta', 'Saute tomatoes with garlic', 'Combine and serve'],
                  rescued_ingredients: ['Ripe Tomatoes'],
                  waste_reduction_score: 80
                }
              ]
            })
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      };

      const res = await request(app)
        .get('/api/v1/recipes/rescue')
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.equal(res.body.data.recipes.length, 1);
      assert.equal(res.body.data.recipes[0].title, 'Fresh Tomato Basil Pasta');
      assert.equal(res.body.data.recipes[0].rescued_items.length, 1);
      assert.equal(res.body.data.recipes[0].rescued_items[0].name, 'Ripe Tomatoes');
    });

    test('should return empty recipe list when household inventory is empty', async () => {
      // Clear inventory
      mockDb.inventoryItemsTable.clear();

      const res = await request(app)
        .get('/api/v1/recipes/rescue')
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.recipes.length, 0);
      assert.ok(res.body.data.message.includes('No active inventory'));
    });

    test('should return 502 if AI recipe service returns malformed response', async () => {
      const itemId = crypto.randomUUID();
      mockDb.inventoryItemsTable.set(itemId, {
        id: itemId,
        household_id: defaultHousehold.id,
        name: 'Broccoli',
        quantity: 1,
        unit: 'head',
        status: 'active'
      });

      // AI returns malformed structure (not conforming to Zod schema)
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ unexpected: 'broken payload' })
      });

      const res = await request(app)
        .get('/api/v1/recipes/rescue')
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 502);
      assert.equal(res.body.error.code, 'AI_MALFORMED_RESPONSE');
    });
  });
});
