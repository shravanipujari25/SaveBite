import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Smart Shopping List & Purchase Intelligence Comprehensive Suite', () => {
  let mockDb;
  let authToken;
  let otherAuthToken;
  let defaultUser;
  let defaultHousehold;
  let otherHousehold;

  beforeEach(async () => {
    mockDb = await setupTestDatabase();
    defaultUser = mockDb.defaultUser;
    defaultHousehold = mockDb.defaultHousehold;
    authToken = generateAccessToken(defaultUser);

    // Other user and household
    const otherUser = {
      id: crypto.randomUUID(),
      name: 'Other Neighbor',
      email: 'neighbor@savebite.com',
      token_version: 1
    };
    mockDb.usersTable.set(otherUser.id, otherUser);

    otherHousehold = {
      id: crypto.randomUUID(),
      name: 'Neighbor Household'
    };
    mockDb.householdsTable.set(otherHousehold.id, otherHousehold);

    mockDb.householdMembersTable.set('neighbor-member-uuid', {
      id: 'neighbor-member-uuid',
      household_id: otherHousehold.id,
      user_id: otherUser.id,
      role: 'owner',
      status: 'active'
    });

    otherAuthToken = generateAccessToken(otherUser);
  });

  afterEach(() => {
    teardownTestDatabase();
  });

  test('1. Pantry-aware duplicate detection with usable stock and expiry dates', async () => {
    // Add existing milk to pantry
    const itemId = crypto.randomUUID();
    mockDb.inventoryItemsTable.set(itemId, {
      id: itemId,
      household_id: defaultHousehold.id,
      name: 'Whole Milk',
      quantity: 2,
      unit: 'litre',
      storage_location: 'refrigerator',
      expiry_date: '2026-11-05',
      status: 'active'
    });

    // Check pre-evaluation duplicate endpoint
    const evalRes = await request(app)
      .post('/api/v1/shopping-list/evaluate-duplicate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Whole Milk',
        quantity: 1,
        unit: 'litre'
      });

    assert.equal(evalRes.status, 200);
    assert.equal(evalRes.body.data.warnings.length, 1);
    assert.equal(evalRes.body.data.pantryMatch.existing_quantity, 2);
    assert.equal(evalRes.body.data.pantryMatch.is_sufficient, true);
    assert.equal(evalRes.body.data.pantryMatch.surplus, 1);

    // Adding item generates warning but preserves item
    const addRes = await request(app)
      .post('/api/v1/shopping-list')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Whole Milk',
        quantity: 1,
        unit: 'litre'
      });

    assert.equal(addRes.status, 201);
    assert.equal(addRes.body.data.warnings.length, 1);
    assert.ok(addRes.body.data.item.id);
  });

  test('2. Expired pantry items are not counted as usable stock in duplicate check', async () => {
    // Add EXPIRED milk
    const itemId = crypto.randomUUID();
    mockDb.inventoryItemsTable.set(itemId, {
      id: itemId,
      household_id: defaultHousehold.id,
      name: 'Organic Milk',
      quantity: 2,
      unit: 'litre',
      storage_location: 'refrigerator',
      expiry_date: '2026-10-01', // Expired
      status: 'active'
    });

    const evalRes = await request(app)
      .post('/api/v1/shopping-list/evaluate-duplicate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Organic Milk',
        quantity: 1,
        unit: 'litre'
      });

    assert.equal(evalRes.status, 200);
    // Because usable stock is 0 (expired), no overbuy warning
    assert.equal(evalRes.body.data.warnings.length, 0);
  });

  test('3. Low-stock recommendations are generated when stock falls below minimum threshold', async () => {
    // Add low-stock rice (0.5 kg available vs min 2.0 kg)
    const itemId = crypto.randomUUID();
    mockDb.inventoryItemsTable.set(itemId, {
      id: itemId,
      household_id: defaultHousehold.id,
      name: 'Basmati Rice',
      quantity: 0.5,
      unit: 'kg',
      min_stock_level: 2.0,
      preferred_stock_level: 3.0,
      storage_location: 'pantry',
      expiry_date: '2026-12-31',
      status: 'active'
    });

    const recRes = await request(app)
      .get('/api/v1/shopping-list/recommendations')
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(recRes.status, 200);
    const recs = recRes.body.data.recommendations;
    const riceRec = recs.find(r => r.name === 'Basmati Rice');
    assert.ok(riceRec, 'Basmati Rice should be recommended');
    assert.equal(riceRec.type, 'stock_based');
    // Suggested: preferred_stock (3.0) - current (0.5) = 2.5
    assert.equal(riceRec.suggested_quantity, 2.5);
  });

  test('4. Consumption-based suggestions generated from actual recorded consumption history', async () => {
    const itemId = crypto.randomUUID();
    mockDb.inventoryItemsTable.set(itemId, {
      id: itemId,
      household_id: defaultHousehold.id,
      name: 'Oat Milk',
      quantity: 0.5,
      unit: 'litre',
      storage_location: 'refrigerator',
      status: 'active'
    });

    // Record realistic consumption events
    const evt1 = crypto.randomUUID();
    mockDb.inventoryEventsTable.set(evt1, {
      id: evt1,
      household_id: defaultHousehold.id,
      inventory_item_id: itemId,
      event_type: 'consumed',
      quantity_change: -3,
      unit: 'litre',
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    });

    const evt2 = crypto.randomUUID();
    mockDb.inventoryEventsTable.set(evt2, {
      id: evt2,
      household_id: defaultHousehold.id,
      inventory_item_id: itemId,
      event_type: 'consumed',
      quantity_change: -4,
      unit: 'litre',
      created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
    });

    const recRes = await request(app)
      .get('/api/v1/shopping-list/recommendations')
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(recRes.status, 200);
    const recs = recRes.body.data.recommendations;
    const oatRec = recs.find(r => r.name === 'Oat Milk');
    assert.ok(oatRec, 'Oat Milk should be recommended based on consumption');
    assert.equal(oatRec.type, 'consumption_based');
    assert.ok(oatRec.reason.includes('typically consume'));
  });

  test('5. Mark item purchased updates pantry inventory and audit event', async () => {
    // 1. Create shopping item
    const shopId = crypto.randomUUID();
    mockDb.shoppingListTable.set(shopId, {
      id: shopId,
      household_id: defaultHousehold.id,
      name: 'Greek Yogurt',
      quantity: 2,
      unit: 'cup',
      category: 'dairy',
      is_purchased: false,
      created_at: new Date().toISOString()
    });

    // 2. Mark purchased
    const purchaseRes = await request(app)
      .post(`/api/v1/shopping-list/${shopId}/purchase`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        purchased_quantity: 2,
        purchase_price: 5.50,
        purchase_date: '2026-10-25',
        expiry_date: '2026-11-15',
        storage_location: 'refrigerator'
      });

    assert.equal(purchaseRes.status, 200);
    assert.equal(purchaseRes.body.data.item.is_purchased, true);
    assert.equal(purchaseRes.body.data.inventoryItem.name, 'Greek Yogurt');
    assert.equal(purchaseRes.body.data.inventoryItem.quantity, 2);

    // Verify it exists in inventoryItemsTable
    const inventoryId = purchaseRes.body.data.inventoryItem.id;
    assert.ok(mockDb.inventoryItemsTable.has(inventoryId));

    // 3. Prevent duplicate addition if purchase endpoint is called again
    const retryRes = await request(app)
      .post(`/api/v1/shopping-list/${shopId}/purchase`)
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(retryRes.status, 200);
    assert.equal(retryRes.body.data.message, 'Item has already been purchased');
  });

  test('6. Partial purchase leaves remaining quantity on shopping list', async () => {
    const shopId = crypto.randomUUID();
    mockDb.shoppingListTable.set(shopId, {
      id: shopId,
      household_id: defaultHousehold.id,
      name: 'Coffee Beans',
      quantity: 3,
      unit: 'bag',
      category: 'pantry',
      is_purchased: false,
      created_at: new Date().toISOString()
    });

    // Buy only 1 of 3
    const purchaseRes = await request(app)
      .post(`/api/v1/shopping-list/${shopId}/purchase`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        purchased_quantity: 1,
        purchase_price: 12.00
      });

    assert.equal(purchaseRes.status, 200);
    assert.equal(purchaseRes.body.data.partial, true);
    // Remaining quantity on shopping list should be 2
    assert.equal(purchaseRes.body.data.item.quantity, 2);
    assert.equal(purchaseRes.body.data.item.is_purchased, false);
  });

  test('7. Strict household isolation: cannot access or purchase another household list item', async () => {
    const otherShopId = crypto.randomUUID();
    mockDb.shoppingListTable.set(otherShopId, {
      id: otherShopId,
      household_id: otherHousehold.id,
      name: 'Private Caviar',
      quantity: 1,
      unit: 'jar',
      is_purchased: false,
      created_at: new Date().toISOString()
    });

    // Default user tries to get it
    const getRes = await request(app)
      .get(`/api/v1/shopping-list/${otherShopId}`)
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(getRes.status, 404);

    // Default user tries to purchase it
    const purchaseRes = await request(app)
      .post(`/api/v1/shopping-list/${otherShopId}/purchase`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ purchased_quantity: 1 });

    assert.equal(purchaseRes.status, 404);
  });
});
