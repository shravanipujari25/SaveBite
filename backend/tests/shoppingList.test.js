import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Shopping List CRUD & Overbuy Warnings Suite (Phase 4)', () => {
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

    // Create another household
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

  test('should create shopping list item without warnings when no pantry item or duplicate exists', async () => {
    const res = await request(app)
      .post('/api/v1/shopping-list')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Avocados',
        quantity: 3,
        unit: 'piece',
        category: 'produce'
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'success');
    assert.equal(res.body.data.item.name, 'Avocados');
    assert.equal(res.body.data.item.quantity, 3);
    assert.equal(res.body.data.warnings.length, 0);
  });

  test('should flag deterministic overbuy warning when similar item already exists in pantry', async () => {
    // Add existing milk to pantry
    const itemId = crypto.randomUUID();
    mockDb.inventoryItemsTable.set(itemId, {
      id: itemId,
      household_id: defaultHousehold.id,
      name: 'Organic Whole Milk',
      quantity: 2,
      unit: 'bottle',
      storage_location: 'refrigerator',
      expiry_date: '2026-11-01',
      status: 'active'
    });

    const res = await request(app)
      .post('/api/v1/shopping-list')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Whole Milk',
        quantity: 1,
        unit: 'bottle'
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.warnings.length, 1);
    assert.equal(res.body.data.warnings[0].type, 'inventory_overbuy_warning');
    assert.ok(res.body.data.warnings[0].message.includes('refrigerator'));
    // Item is preserved, not automatically removed
    assert.ok(res.body.data.item.id);
  });

  test('should flag duplicate warning when item is already on unpurchased shopping list', async () => {
    const existingId = crypto.randomUUID();
    mockDb.shoppingListTable.set(existingId, {
      id: existingId,
      household_id: defaultHousehold.id,
      name: 'Almond Butter',
      quantity: 1,
      unit: 'jar',
      is_purchased: false,
      created_at: new Date().toISOString()
    });

    const res = await request(app)
      .post('/api/v1/shopping-list')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Almond Butter',
        quantity: 2,
        unit: 'jar'
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.data.warnings.some((w) => w.type === 'shopping_list_duplicate_warning'));
  });

  test('should list shopping list items with strict household isolation', async () => {
    // Household 1 item
    const id1 = crypto.randomUUID();
    mockDb.shoppingListTable.set(id1, {
      id: id1,
      household_id: defaultHousehold.id,
      name: 'Apples',
      quantity: 5,
      unit: 'piece',
      is_purchased: false,
      created_at: new Date().toISOString()
    });

    // Household 2 item
    const id2 = crypto.randomUUID();
    mockDb.shoppingListTable.set(id2, {
      id: id2,
      household_id: otherHousehold.id,
      name: 'Pears',
      quantity: 2,
      unit: 'piece',
      is_purchased: false,
      created_at: new Date().toISOString()
    });

    const res = await request(app)
      .get('/api/v1/shopping-list')
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.items.length, 1);
    assert.equal(res.body.data.items[0].name, 'Apples');

    // Other user only sees their own
    const otherRes = await request(app)
      .get('/api/v1/shopping-list')
      .set('Authorization', `Bearer ${otherAuthToken}`);

    assert.equal(otherRes.status, 200);
    assert.equal(otherRes.body.data.items.length, 1);
    assert.equal(otherRes.body.data.items[0].name, 'Pears');
  });

  test('should update, mark purchased, and delete shopping list items', async () => {
    const itemId = crypto.randomUUID();
    mockDb.shoppingListTable.set(itemId, {
      id: itemId,
      household_id: defaultHousehold.id,
      name: 'Olive Oil',
      quantity: 1,
      unit: 'bottle',
      is_purchased: false,
      created_at: new Date().toISOString()
    });

    // 1. Update
    const updateRes = await request(app)
      .patch(`/api/v1/shopping-list/${itemId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ quantity: 2, notes: 'Extra virgin' });

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.data.item.quantity, 2);
    assert.equal(updateRes.body.data.item.notes, 'Extra virgin');

    // 2. Mark purchased
    const purchaseRes = await request(app)
      .post(`/api/v1/shopping-list/${itemId}/purchase`)
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(purchaseRes.status, 200);
    assert.equal(purchaseRes.body.data.item.is_purchased, true);
    assert.ok(purchaseRes.body.data.item.purchased_at);

    // 3. Delete
    const deleteRes = await request(app)
      .delete(`/api/v1/shopping-list/${itemId}`)
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.body.data.success, true);
    assert.equal(mockDb.shoppingListTable.has(itemId), false);
  });
});
