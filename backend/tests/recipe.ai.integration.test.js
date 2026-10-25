import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken } from '../src/utils/token.js';
import { AIClientService } from '../src/services/aiClient.service.js';
import { RecipeRescueService } from '../src/services/recipeRescue.service.js';

describe('Recipe Suggestions AI Integration Suite', () => {
  const originalFetch = globalThis.fetch;
  let mockDb;
  let defaultHousehold;
  let defaultUser;
  let authToken;

  beforeEach(async () => {
    mockDb = await setupTestDatabase();
    defaultUser = mockDb.defaultUser;
    defaultHousehold = mockDb.defaultHousehold;
    authToken = generateAccessToken(defaultUser);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    teardownTestDatabase();
  });

  describe('A. Endpoint and request construction', () => {
    test('AI client calls POST /recipes/recommend with the FastAPI request schema', async () => {
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
            total_recipes_evaluated: 1,
            total_recommendations: 1,
            recommendations: [
              {
                recipe_id: 'REC-001',
                name: 'Tomato Rice',
                rank: 1,
                score: 95.0,
                score_breakdown: {
                  ingredient_availability: 40.0,
                  near_expiry_utilization: 30.0,
                  use_first_utilization: 20.0,
                  missing_ingredient_component: 5.0
                },
                preparation_status: 'fully_preparable',
                matched_ingredients: [],
                use_first_ingredients: ['Tomato'],
                near_expiry_ingredients: ['Tomato'],
                missing_ingredients: [],
                insufficient_ingredients: [],
                unavailable_ingredients: [],
                optional_missing_ingredients: [],
                reasons: ['All required ingredients available'],
                preparation_time_minutes: 25,
                servings: 2,
                instructions: ['Cook rice', 'Fold tomatoes'],
                simulated: false
              }
            ]
          })
        };
      };

      const aiClient = new AIClientService('http://localhost:8000', 2000);
      const inventoryPayload = [
        {
          inventory_item_id: 'item-1',
          product_name: 'Tomato',
          quantity: 2.0,
          unit: 'unit',
          purchase_date: '2026-10-20',
          expiry_date: '2026-10-28',
          opened: false,
          status: 'available',
          simulated: false
        }
      ];

      const res = await aiClient.rescueRecipes({
        inventory: inventoryPayload,
        priority_data: { 'item-1': 'Red' },
        limit: 5
      });

      assert.ok(capturedUrl.endsWith('/recipes/recommend'), `Expected URL to end with /recipes/recommend, got ${capturedUrl}`);
      assert.equal(capturedMethod, 'POST');
      assert.equal(capturedBody.limit, 5);
      assert.deepEqual(capturedBody.priority_data, { 'item-1': 'Red' });
      assert.equal(capturedBody.inventory.length, 1);
      assert.equal(capturedBody.inventory[0].inventory_item_id, 'item-1');
      assert.equal(capturedBody.inventory[0].product_name, 'Tomato');
      assert.equal(capturedBody.inventory[0].quantity, 2.0);
      assert.equal(capturedBody.inventory[0].unit, 'unit');

      assert.ok(res.recommendations);
      assert.equal(res.recommendations.length, 1);
    });

    test('RecipeRescueService maps household inventory to InventoryItem schema without exposing sensitive data', async () => {
      const itemId = crypto.randomUUID();
      mockDb.inventoryItemsTable.set(itemId, {
        id: itemId,
        household_id: defaultHousehold.id,
        name: 'Fresh Spinach',
        quantity: 250,
        unit: 'g',
        category: 'produce',
        storage_location: 'refrigerator',
        purchase_date: '2026-10-21',
        expiry_date: '2026-10-27',
        is_opened: true,
        use_first_score: 85,
        freshness_bucket: 'critical',
        status: 'active',
        created_at: new Date().toISOString()
      });

      let capturedPayload = null;
      globalThis.fetch = async (url, options) => {
        capturedPayload = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            as_of_date: '2026-10-25',
            total_recipes_evaluated: 10,
            total_recommendations: 0,
            recommendations: []
          })
        };
      };

      const service = new RecipeRescueService();
      await service.getRescueRecipes(defaultHousehold.id, { limit: 8 });

      assert.ok(capturedPayload);
      assert.equal(capturedPayload.limit, 8);
      assert.equal(capturedPayload.inventory.length, 1);

      const inv = capturedPayload.inventory[0];
      assert.equal(inv.inventory_item_id, itemId);
      assert.equal(inv.product_name, 'Fresh Spinach');
      assert.equal(inv.quantity, 250);
      assert.equal(inv.unit, 'g');
      assert.equal(inv.purchase_date, '2026-10-21');
      assert.equal(inv.expiry_date, '2026-10-27');
      assert.equal(inv.opened, true);
      assert.equal(inv.status, 'available');
      // Verify no sensitive internal fields sent
      assert.equal(inv.household_id, undefined);
      assert.equal(inv.created_by, undefined);

      assert.equal(capturedPayload.priority_data[itemId], 'Red');
    });

    test('Empty inventory gracefully returns empty recipes without calling AI service', async () => {
      mockDb.inventoryItemsTable.clear();

      let aiCalled = false;
      globalThis.fetch = async () => {
        aiCalled = true;
        return { ok: true, status: 200, json: async () => ({}) };
      };

      const res = await request(app)
        .get('/api/v1/recipes/rescue')
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.equal(res.body.data.recipes.length, 0);
      assert.ok(res.body.data.message.includes('No active inventory'));
      assert.equal(aiCalled, false);
    });
  });

  describe('B. Successful AI response transformation & frontend compatibility', () => {
    test('Transforms AI recommendation format into existing frontend contract with rescued items', async () => {
      const spinachId = crypto.randomUUID();
      mockDb.inventoryItemsTable.set(spinachId, {
        id: spinachId,
        household_id: defaultHousehold.id,
        name: 'Baby Spinach',
        quantity: 100,
        unit: 'g',
        category: 'produce',
        use_first_score: 90,
        adj_days_left: 1.0,
        freshness_bucket: 'critical',
        expiry_date: '2026-10-26',
        status: 'active',
        created_at: new Date().toISOString()
      });

      globalThis.fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/recipes/recommend')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              as_of_date: '2026-10-25',
              total_recipes_evaluated: 25,
              total_recommendations: 1,
              recommendations: [
                {
                  recipe_id: 'REC-SPINACH-1',
                  name: 'Sauteed Garlic Spinach',
                  rank: 1,
                  score: 92.0,
                  score_breakdown: {
                    ingredient_availability: 40.0,
                    near_expiry_utilization: 30.0,
                    use_first_utilization: 20.0,
                    missing_ingredient_component: 2.0
                  },
                  preparation_status: 'fully_preparable',
                  matched_ingredients: [
                    {
                      ingredient_name: 'Baby Spinach',
                      required_quantity: 100.0,
                      required_unit: 'g',
                      available_quantity: 100.0,
                      available_unit: 'g',
                      missing_quantity: 0.0,
                      status: 'available',
                      optional: false,
                      near_expiry: true,
                      priority_category: 'Red',
                      matched_inventory_ids: [spinachId]
                    }
                  ],
                  use_first_ingredients: ['Baby Spinach'],
                  near_expiry_ingredients: ['Baby Spinach'],
                  missing_ingredients: [],
                  insufficient_ingredients: [],
                  unavailable_ingredients: [],
                  optional_missing_ingredients: [],
                  reasons: ['Prioritizes near-expiry Baby Spinach.'],
                  preparation_time_minutes: 10,
                  servings: 2,
                  instructions: ['Wash spinach', 'Saute in pan for 3 minutes with garlic'],
                  simulated: false
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

      const recipe = res.body.data.recipes[0];
      assert.equal(recipe.id, 'REC-SPINACH-1');
      assert.equal(recipe.title, 'Sauteed Garlic Spinach');
      assert.equal(recipe.prep_time_minutes, 10);
      assert.equal(recipe.servings, 2);
      assert.equal(recipe.difficulty, 'Easy');
      assert.equal(recipe.waste_reduction_score, 92);
      assert.equal(recipe.instructions.length, 2);

      // Verify rescued items mapped correctly
      assert.equal(recipe.rescued_items.length, 1);
      assert.equal(recipe.rescued_items[0].id, spinachId);
      assert.equal(recipe.rescued_items[0].name, 'Baby Spinach');
      assert.equal(recipe.rescued_items[0].freshness_bucket, 'critical');
      assert.equal(recipe.rescued_items[0].use_first_score, 90);
    });
  });

  describe('C. Failure scenarios & resilience', () => {
    test('Handles AI connection refusal (ECONNREFUSED) with 502 without crashing', async () => {
      const itemId = crypto.randomUUID();
      mockDb.inventoryItemsTable.set(itemId, {
        id: itemId,
        household_id: defaultHousehold.id,
        name: 'Carrots',
        quantity: 3,
        status: 'active'
      });

      globalThis.fetch = async () => {
        const err = new Error('connect ECONNREFUSED 127.0.0.1:8000');
        err.code = 'ECONNREFUSED';
        throw err;
      };

      const res = await request(app)
        .get('/api/v1/recipes/rescue')
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 502);
      assert.equal(res.body.error.code, 'AI_SERVICE_UNAVAILABLE');
    });

    test('Handles AI timeout with 504 Gateway Timeout', async () => {
      const itemId = crypto.randomUUID();
      mockDb.inventoryItemsTable.set(itemId, {
        id: itemId,
        household_id: defaultHousehold.id,
        name: 'Apples',
        quantity: 2,
        status: 'active'
      });

      globalThis.fetch = async () => {
        const err = new Error('The operation was aborted');
        err.name = 'TimeoutError';
        throw err;
      };

      const res = await request(app)
        .get('/api/v1/recipes/rescue')
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 504);
      assert.equal(res.body.error.code, 'AI_SERVICE_TIMEOUT');
    });

    test('Handles malformed AI responses with 502 AI_MALFORMED_RESPONSE without fabricating fake recipes', async () => {
      const itemId = crypto.randomUUID();
      mockDb.inventoryItemsTable.set(itemId, {
        id: itemId,
        household_id: defaultHousehold.id,
        name: 'Mushrooms',
        quantity: 1,
        status: 'active'
      });

      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ unexpected_key: 'broken' })
      });

      const res = await request(app)
        .get('/api/v1/recipes/rescue')
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 502);
      assert.equal(res.body.error.code, 'AI_MALFORMED_RESPONSE');
    });
  });

  describe('D. Regression protection & data integrity', () => {
    test('Recipe generation NEVER modifies inventory quantities, statuses, or user expiry dates', async () => {
      const itemId = crypto.randomUUID();
      const originalExpiry = '2026-10-30';
      const originalQuantity = 5;

      mockDb.inventoryItemsTable.set(itemId, {
        id: itemId,
        household_id: defaultHousehold.id,
        name: 'Organic Milk',
        quantity: originalQuantity,
        unit: 'bottle',
        purchase_date: '2026-10-22',
        expiry_date: originalExpiry,
        status: 'active',
        use_first_score: 75,
        created_at: new Date().toISOString()
      });

      globalThis.fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/recipes/recommend')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              as_of_date: '2026-10-25',
              total_recipes_evaluated: 5,
              total_recommendations: 1,
              recommendations: [
                {
                  recipe_id: 'REC-MILK',
                  name: 'Milk Pancakes',
                  rank: 1,
                  score: 80.0,
                  score_breakdown: {
                    ingredient_availability: 40.0,
                    near_expiry_utilization: 20.0,
                    use_first_utilization: 15.0,
                    missing_ingredient_component: 5.0
                  },
                  preparation_status: 'fully_preparable',
                  matched_ingredients: [],
                  preparation_time_minutes: 20,
                  servings: 4,
                  instructions: ['Mix and cook'],
                  simulated: false
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

      // Verify item state in DB is completely untouched
      const itemAfter = mockDb.inventoryItemsTable.get(itemId);
      assert.equal(itemAfter.quantity, originalQuantity);
      assert.equal(itemAfter.expiry_date, originalExpiry);
      assert.equal(itemAfter.status, 'active');
    });

    test('Strict household isolation is preserved when querying recipes', async () => {
      const otherHouseholdId = crypto.randomUUID();
      const otherItemId = crypto.randomUUID();

      // Item in other household
      mockDb.inventoryItemsTable.set(otherItemId, {
        id: otherItemId,
        household_id: otherHouseholdId,
        name: 'Secret Caviar',
        quantity: 1,
        status: 'active'
      });

      let capturedInventory = null;
      globalThis.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        capturedInventory = body.inventory;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            as_of_date: '2026-10-25',
            total_recipes_evaluated: 0,
            total_recommendations: 0,
            recommendations: []
          })
        };
      };

      // Calling for defaultHousehold (which has 0 items)
      mockDb.inventoryItemsTable.clear();
      mockDb.inventoryItemsTable.set(otherItemId, {
        id: otherItemId,
        household_id: otherHouseholdId,
        name: 'Secret Caviar',
        quantity: 1,
        status: 'active'
      });

      const res = await request(app)
        .get('/api/v1/recipes/rescue')
        .set('Authorization', `Bearer ${authToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.recipes.length, 0);
      // AI was not called with other household's item
      assert.equal(capturedInventory, null);
    });
  });
});
