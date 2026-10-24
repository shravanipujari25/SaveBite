import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { seedDemo, DEMO_IDS } from '../scripts/seed-demo.js';
import { createMockDatabaseClient } from './helpers/mockSupabase.js';

describe('Seed Demo Script Test Suite (Phase 5)', () => {
  let mock;

  beforeEach(async () => {
    mock = await createMockDatabaseClient();
  });

  it('should seed complete 7-day realistic demo dataset', async () => {
    const summary = await seedDemo(mock.client);

    assert.equal(summary.user, 'demo@savebite.com');
    assert.equal(summary.household, 'SaveBite Demo Smart Kitchen');
    assert.equal(summary.itemsSeeded, 10);
    assert.equal(summary.shoppingItemsSeeded, 3);
    assert.equal(summary.sensorReadingsSeeded, 21);
    assert.equal(summary.deviceEventsSeeded, 3);
    assert.equal(summary.notificationsSeeded, 3);
    assert.equal(summary.wasteRecordsSeeded, 2);
    assert.equal(summary.avoidedWasteRecordsSeeded, 2);

    // Verify user exists in database
    const { data: user } = await mock.client.from('users').select('*').eq('id', DEMO_IDS.USER_ID).maybeSingle();
    assert.ok(user, 'Demo user must exist');
    assert.equal(user.email, 'demo@savebite.com');

    // Verify household exists
    const { data: household } = await mock.client.from('households').select('*').eq('id', DEMO_IDS.HOUSEHOLD_ID).maybeSingle();
    assert.ok(household, 'Demo household must exist');

    // Verify membership exists
    const { data: member } = await mock.client.from('household_members').select('*').eq('id', DEMO_IDS.MEMBERSHIP_ID).maybeSingle();
    assert.ok(member, 'Demo membership must exist');
    assert.equal(member.role, 'owner');

    // Verify device exists with simulator flag
    const { data: device } = await mock.client.from('devices').select('*').eq('id', DEMO_IDS.DEVICE_ID).maybeSingle();
    assert.ok(device, 'Demo device must exist');
    assert.equal(device.source_type, 'simulator');

    // Verify inventory items have 7 distinct categories
    const { data: items } = await mock.client.from('inventory_items').select('*').eq('household_id', DEMO_IDS.HOUSEHOLD_ID);
    assert.equal(items.length, 10);
    const categories = new Set(items.map((i) => i.category));
    assert.ok(categories.size >= 6, 'Must cover multiple grocery categories');
    assert.ok(categories.has('produce'));
    assert.ok(categories.has('dairy'));
    assert.ok(categories.has('bakery'));
    assert.ok(categories.has('pantry'));
    assert.ok(categories.has('beverages'));
    assert.ok(categories.has('frozen'));
    assert.ok(categories.has('leftovers'));

    // Verify sensor readings carry simulator source_type
    const { data: readings } = await mock.client.from('sensor_readings').select('*').eq('device_id', DEMO_IDS.DEVICE_ID);
    assert.equal(readings.length, 21);
    for (const r of readings) {
      assert.equal(r.source_type, 'simulator', 'All demo readings must be flagged as simulator');
    }
  });

  it('should be strictly idempotent and not duplicate data on repeated runs', async () => {
    // Run 1: initial seed
    const firstSummary = await seedDemo(mock.client);
    assert.equal(firstSummary.itemsSeeded, 10);

    // Snapshot counts after run 1
    const { data: itemsRun1 } = await mock.client.from('inventory_items').select('*').eq('household_id', DEMO_IDS.HOUSEHOLD_ID);
    const { data: readingsRun1 } = await mock.client.from('sensor_readings').select('*').eq('device_id', DEMO_IDS.DEVICE_ID);
    const { data: eventsRun1 } = await mock.client.from('device_events').select('*').eq('device_id', DEMO_IDS.DEVICE_ID);
    const { data: notifsRun1 } = await mock.client.from('notifications').select('*').eq('household_id', DEMO_IDS.HOUSEHOLD_ID);
    const { data: wasteRun1 } = await mock.client.from('waste_log').select('*').eq('household_id', DEMO_IDS.HOUSEHOLD_ID);

    // Run 2: re-seed on same database
    const secondSummary = await seedDemo(mock.client);
    assert.equal(secondSummary.itemsSeeded, 10);

    // Snapshot counts after run 2
    const { data: itemsRun2 } = await mock.client.from('inventory_items').select('*').eq('household_id', DEMO_IDS.HOUSEHOLD_ID);
    const { data: readingsRun2 } = await mock.client.from('sensor_readings').select('*').eq('device_id', DEMO_IDS.DEVICE_ID);
    const { data: eventsRun2 } = await mock.client.from('device_events').select('*').eq('device_id', DEMO_IDS.DEVICE_ID);
    const { data: notifsRun2 } = await mock.client.from('notifications').select('*').eq('household_id', DEMO_IDS.HOUSEHOLD_ID);
    const { data: wasteRun2 } = await mock.client.from('waste_log').select('*').eq('household_id', DEMO_IDS.HOUSEHOLD_ID);

    assert.equal(itemsRun2.length, itemsRun1.length, 'Item count must remain identical');
    assert.equal(readingsRun2.length, readingsRun1.length, 'Reading count must remain identical');
    assert.equal(eventsRun2.length, eventsRun1.length, 'Event count must remain identical');
    assert.equal(notifsRun2.length, notifsRun1.length, 'Notification count must remain identical');
    assert.equal(wasteRun2.length, wasteRun1.length, 'Waste log count must remain identical');
  });

  it('should refuse to run when NODE_ENV is set to production', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await assert.rejects(
        async () => {
          await seedDemo(mock.client);
        },
        /Refusing to seed demo data in production environment/
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
