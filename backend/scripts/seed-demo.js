import bcrypt from 'bcryptjs';
import env from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { getDatabaseClient } from '../src/config/supabase.js';

export const DEMO_IDS = {
  USER_ID: 'd0000000-0000-4000-a000-000000000001',
  HOUSEHOLD_ID: 'd0000000-0000-4000-a000-000000000002',
  MEMBERSHIP_ID: 'd0000000-0000-4000-a000-000000000003',
  DEVICE_ID: 'd0000000-0000-4000-a000-000000000004',
  DEVICE_CODE: 'DEV-DEMO-ESP32-01',
  ITEMS: {
    STRAWBERRIES: 'd0000000-0000-4000-a000-000000000011',
    AVOCADOS: 'd0000000-0000-4000-a000-000000000012',
    MILK: 'd0000000-0000-4000-a000-000000000013',
    YOGURT: 'd0000000-0000-4000-a000-000000000014',
    SOURDOUGH: 'd0000000-0000-4000-a000-000000000015',
    OLIVE_OIL: 'd0000000-0000-4000-a000-000000000016',
    PASTA: 'd0000000-0000-4000-a000-000000000017',
    ORANGE_JUICE: 'd0000000-0000-4000-a000-000000000018',
    BLUEBERRIES: 'd0000000-0000-4000-a000-000000000019',
    VEG_CURRY: 'd0000000-0000-4000-a000-000000000020'
  },
  SHOPPING: {
    BASIL: 'd0000000-0000-4000-a000-000000000031',
    EGGS: 'd0000000-0000-4000-a000-000000000032',
    ALMOND_MILK: 'd0000000-0000-4000-a000-000000000033'
  },
  WASTE: {
    BREAD: 'd0000000-0000-4000-a000-000000000041',
    LEMON: 'd0000000-0000-4000-a000-000000000042'
  },
  AVOIDED_WASTE: {
    MILK_SAVED: 'd0000000-0000-4000-a000-000000000051',
    AVOCADO_SAVED: 'd0000000-0000-4000-a000-000000000052'
  }
};

/**
 * Idempotent upsert helper for Supabase mock or live table.
 */
async function upsertRecord(db, table, record, conflictCol = 'id') {
  // First check if record exists by conflict column
  const { data: existing } = await db
    .from(table)
    .select(conflictCol)
    .eq(conflictCol, record[conflictCol])
    .maybeSingle();

  if (existing) {
    const { data: updated, error } = await db
      .from(table)
      .update(record)
      .eq(conflictCol, record[conflictCol])
      .select('*')
      .single();
    if (error) throw error;
    return updated;
  }

  const { data: created, error } = await db
    .from(table)
    .insert(record)
    .select('*')
    .single();

  if (error) throw error;
  return created;
}

/**
 * Main demo seeding function.
 *
 * @param {object} [client] - Optional database client override (used in automated tests)
 * @returns {Promise<object>} Summary of seeded counts
 */
export async function seedDemo(client = null) {
  // 1. Safety Guard: Refuse to execute against production environments
  if (process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production') {
    logger.fatal('Safety check failed: seed-demo script is strictly prohibited in production!');
    throw new Error('Refusing to seed demo data in production environment.');
  }

  const db = (client && typeof client.from === 'function')
    ? client
    : (client && client.client && typeof client.client.from === 'function')
      ? client.client
      : getDatabaseClient();
  const now = new Date();
  const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const daysAhead = (days) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  logger.info('Starting SaveBite demo data seeding (approximately 7 days of activity)...');

  // 2. Demo User
  const passwordHash = await bcrypt.hash('DemoPassword123!', 10);
  const demoUser = await upsertRecord(db, 'users', {
    id: DEMO_IDS.USER_ID,
    name: 'Demo Chef',
    email: 'demo@savebite.com',
    password_hash: passwordHash,
    role: 'user',
    token_version: 1
  });

  // 3. Demo Household
  const demoHousehold = await upsertRecord(db, 'households', {
    id: DEMO_IDS.HOUSEHOLD_ID,
    name: 'SaveBite Demo Smart Kitchen'
  });

  // 4. Household Membership
  await upsertRecord(db, 'household_members', {
    id: DEMO_IDS.MEMBERSHIP_ID,
    household_id: demoHousehold.id,
    user_id: demoUser.id,
    role: 'owner',
    status: 'active'
  });

  // 5. IoT Smart Device (Refrigerator Sensor Hub)
  const demoDevice = await upsertRecord(db, 'devices', {
    id: DEMO_IDS.DEVICE_ID,
    household_id: demoHousehold.id,
    name: 'Main Refrigerator Hub',
    device_code: DEMO_IDS.DEVICE_CODE,
    device_type: 'esp32_sensor_hub',
    zone: 'refrigerator',
    source_type: 'simulator'
  });

  // 6. Inventory Items (10 realistic items spanning 7 categories)
  const itemsToSeed = [
    {
      id: DEMO_IDS.ITEMS.STRAWBERRIES,
      name: 'Organic Strawberries',
      category: 'produce',
      quantity: 1,
      unit: 'pack',
      storage_location: 'refrigerator',
      estimated_unit_price: 4.99,
      purchase_date: daysAgo(5),
      expiry_date: daysAhead(1),
      is_opened: false,
      use_first_score: 92,
      adj_days_left: 1,
      freshness_bucket: 'use_soon',
      status: 'active'
    },
    {
      id: DEMO_IDS.ITEMS.AVOCADOS,
      name: 'Hass Avocados',
      category: 'produce',
      quantity: 2,
      unit: 'piece',
      storage_location: 'counter',
      estimated_unit_price: 1.50,
      purchase_date: daysAgo(3),
      expiry_date: daysAhead(2),
      is_opened: false,
      use_first_score: 75,
      adj_days_left: 2,
      freshness_bucket: 'use_soon',
      status: 'active'
    },
    {
      id: DEMO_IDS.ITEMS.MILK,
      name: 'Whole Milk',
      category: 'dairy',
      quantity: 1,
      unit: 'bottle',
      storage_location: 'refrigerator',
      estimated_unit_price: 3.79,
      purchase_date: daysAgo(6),
      expiry_date: daysAhead(2),
      is_opened: true,
      opened_at: daysAgo(4),
      use_first_score: 88,
      adj_days_left: 1,
      freshness_bucket: 'use_soon',
      status: 'active'
    },
    {
      id: DEMO_IDS.ITEMS.YOGURT,
      name: 'Greek Yogurt',
      category: 'dairy',
      quantity: 2,
      unit: 'item',
      storage_location: 'refrigerator',
      estimated_unit_price: 1.99,
      purchase_date: daysAgo(4),
      expiry_date: daysAhead(8),
      is_opened: false,
      use_first_score: 30,
      adj_days_left: 7,
      freshness_bucket: 'fresh',
      status: 'active'
    },
    {
      id: DEMO_IDS.ITEMS.SOURDOUGH,
      name: 'Artisan Sourdough Loaf',
      category: 'bakery',
      quantity: 1,
      unit: 'item',
      storage_location: 'pantry',
      estimated_unit_price: 5.50,
      purchase_date: daysAgo(2),
      expiry_date: daysAhead(2),
      is_opened: true,
      opened_at: daysAgo(2),
      use_first_score: 65,
      adj_days_left: 2,
      freshness_bucket: 'use_soon',
      status: 'active'
    },
    {
      id: DEMO_IDS.ITEMS.OLIVE_OIL,
      name: 'Extra Virgin Olive Oil',
      category: 'pantry',
      quantity: 1,
      unit: 'bottle',
      storage_location: 'pantry',
      estimated_unit_price: 12.99,
      purchase_date: daysAgo(7),
      expiry_date: daysAhead(180),
      is_opened: true,
      opened_at: daysAgo(7),
      use_first_score: 10,
      adj_days_left: 180,
      freshness_bucket: 'fresh',
      status: 'active'
    },
    {
      id: DEMO_IDS.ITEMS.PASTA,
      name: 'Fusilli Pasta',
      category: 'pantry',
      quantity: 2,
      unit: 'pack',
      storage_location: 'pantry',
      estimated_unit_price: 1.89,
      purchase_date: daysAgo(7),
      expiry_date: daysAhead(365),
      is_opened: false,
      use_first_score: 5,
      adj_days_left: 365,
      freshness_bucket: 'fresh',
      status: 'active'
    },
    {
      id: DEMO_IDS.ITEMS.ORANGE_JUICE,
      name: 'Cold Pressed Orange Juice',
      category: 'beverages',
      quantity: 1,
      unit: 'bottle',
      storage_location: 'refrigerator',
      estimated_unit_price: 4.29,
      purchase_date: daysAgo(4),
      expiry_date: daysAhead(3),
      is_opened: true,
      opened_at: daysAgo(2),
      use_first_score: 72,
      adj_days_left: 3,
      freshness_bucket: 'use_soon',
      status: 'active'
    },
    {
      id: DEMO_IDS.ITEMS.BLUEBERRIES,
      name: 'Wild Blueberries',
      category: 'frozen',
      quantity: 1,
      unit: 'pack',
      storage_location: 'freezer',
      estimated_unit_price: 3.99,
      purchase_date: daysAgo(7),
      expiry_date: daysAhead(120),
      is_opened: false,
      use_first_score: 15,
      adj_days_left: 120,
      freshness_bucket: 'fresh',
      status: 'active'
    },
    {
      id: DEMO_IDS.ITEMS.VEG_CURRY,
      name: 'Leftover Vegetable Curry',
      category: 'leftovers',
      quantity: 1,
      unit: 'serving',
      storage_location: 'refrigerator',
      estimated_unit_price: 6.00,
      purchase_date: daysAgo(3),
      expiry_date: daysAhead(1),
      is_opened: true,
      opened_at: daysAgo(3),
      use_first_score: 95,
      adj_days_left: 1,
      freshness_bucket: 'use_soon',
      status: 'active'
    }
  ];

  for (const item of itemsToSeed) {
    await upsertRecord(db, 'inventory_items', {
      ...item,
      household_id: demoHousehold.id,
      created_by: demoUser.id,
      currency: 'USD'
    });
  }

  // 7. Shopping List Items
  const shoppingToSeed = [
    {
      id: DEMO_IDS.SHOPPING.BASIL,
      name: 'Fresh Basil',
      quantity: 1,
      unit: 'pack',
      category: 'produce',
      is_purchased: false
    },
    {
      id: DEMO_IDS.SHOPPING.EGGS,
      name: 'Pasture-Raised Eggs',
      quantity: 12,
      unit: 'piece',
      category: 'dairy',
      is_purchased: false
    },
    {
      id: DEMO_IDS.SHOPPING.ALMOND_MILK,
      name: 'Unsweetened Almond Milk',
      quantity: 1,
      unit: 'bottle',
      category: 'dairy',
      is_purchased: true,
      purchased_at: daysAgo(2)
    }
  ];

  for (const shop of shoppingToSeed) {
    await upsertRecord(db, 'shopping_list_items', {
      ...shop,
      household_id: demoHousehold.id,
      created_by: demoUser.id
    });
  }

  // 8. Waste Records (Realistic minor food waste)
  const wasteToSeed = [
    {
      id: DEMO_IDS.WASTE.BREAD,
      household_id: demoHousehold.id,
      inventory_item_id: DEMO_IDS.ITEMS.SOURDOUGH,
      quantity: 0.5,
      unit: 'pack',
      reason: 'spoiled',
      estimated_value: 1.75,
      wasted_at: daysAgo(2),
      recorded_by: demoUser.id
    },
    {
      id: DEMO_IDS.WASTE.LEMON,
      household_id: demoHousehold.id,
      inventory_item_id: null,
      quantity: 1,
      unit: 'piece',
      reason: 'spoiled',
      estimated_value: 0.75,
      wasted_at: daysAgo(4),
      recorded_by: demoUser.id
    }
  ];

  for (const w of wasteToSeed) {
    await upsertRecord(db, 'waste_log', w);
  }

  // 9. Avoided Waste Savings Log (Recipe rescue consumption)
  const avoidedToSeed = [
    {
      id: DEMO_IDS.AVOIDED_WASTE.MILK_SAVED,
      household_id: demoHousehold.id,
      inventory_item_id: DEMO_IDS.ITEMS.MILK,
      item_name: 'Whole Milk',
      quantity: 1,
      unit: 'bottle',
      estimated_savings: 3.79,
      source: 'recipe_rescue',
      recipe_name: 'Custard Pudding',
      recorded_by: demoUser.id,
      consumed_at: daysAgo(1)
    },
    {
      id: DEMO_IDS.AVOIDED_WASTE.AVOCADO_SAVED,
      household_id: demoHousehold.id,
      inventory_item_id: DEMO_IDS.ITEMS.AVOCADOS,
      item_name: 'Hass Avocados',
      quantity: 1,
      unit: 'piece',
      estimated_savings: 1.50,
      source: 'recipe_rescue',
      recipe_name: 'Guacamole Dip',
      recorded_by: demoUser.id,
      consumed_at: daysAgo(2)
    }
  ];

  let avoidedWasteRecordsSeeded = 0;
  for (const a of avoidedToSeed) {
    try {
      await upsertRecord(db, 'avoided_waste_logs', a);
      avoidedWasteRecordsSeeded++;
    } catch (err) {
      logger.debug({ error: err.message }, 'avoided_waste_logs table not available, skipping record');
    }
  }

  // 10. Device Events (Door open, temperature alert, online)
  const eventsToSeed = [
    {
      id: 'd0000000-0000-4000-a000-000000000061',
      device_id: demoDevice.id,
      household_id: demoHousehold.id,
      event_type: 'device_online',
      description: 'Main Refrigerator Hub connected and telemetry active',
      created_at: daysAgo(7)
    },
    {
      id: 'd0000000-0000-4000-a000-000000000062',
      device_id: demoDevice.id,
      household_id: demoHousehold.id,
      event_type: 'door_open',
      description: 'Refrigerator door was left ajar for 4 minutes',
      metadata: { duration_seconds: 240 },
      created_at: daysAgo(2)
    },
    {
      id: 'd0000000-0000-4000-a000-000000000063',
      device_id: demoDevice.id,
      household_id: demoHousehold.id,
      event_type: 'door_closed',
      description: 'Refrigerator door closed',
      created_at: daysAgo(2)
    }
  ];

  for (const ev of eventsToSeed) {
    await upsertRecord(db, 'device_events', ev);
  }

  // 11. Sensor Readings Spanning ~7 Days (Simulator source)
  const readingsCount = 21; // ~3 readings per day for 7 days
  for (let i = 0; i < readingsCount; i++) {
    const ageDays = (readingsCount - 1 - i) * (7 / readingsCount);
    const readingId = `d0000000-0000-4000-a000-${String(100 + i).padStart(12, '0')}`;

    // Normally 3.5 to 4.5 C; temperature spike to 8.5 C during the door open event 2 days ago
    const isDoorOpenSpike = ageDays >= 1.9 && ageDays <= 2.1;
    const temp = isDoorOpenSpike ? 8.5 : Number((3.6 + (i % 5) * 0.2).toFixed(1));
    const humidity = isDoorOpenSpike ? 75.0 : Number((64.0 + (i % 6) * 1.5).toFixed(1));
    const airQuality = isDoorOpenSpike ? 420.0 : Number((140.0 + (i % 7) * 8).toFixed(1));

    await upsertRecord(db, 'sensor_readings', {
      id: readingId,
      device_id: demoDevice.id,
      household_id: demoHousehold.id,
      temperature_c: temp,
      humidity_percent: humidity,
      air_quality_raw: airQuality,
      air_quality_unit: 'raw',
      source_type: 'simulator',
      recorded_at: daysAgo(ageDays),
      received_at: daysAgo(ageDays),
      metadata: { simulated: true, batch_index: i }
    });
  }

  // 12. Household Notifications
  const notificationsToSeed = [
    {
      id: 'd0000000-0000-4000-a000-000000000081',
      household_id: demoHousehold.id,
      device_id: demoDevice.id,
      type: 'threshold_alert',
      title: 'Elevated Temperature Detected in Refrigerator',
      message: 'Temperature in refrigerator reached 8.5°C (door left ajar).',
      severity: 'warning',
      is_read: true,
      read_at: daysAgo(1.9),
      created_at: daysAgo(2)
    },
    {
      id: 'd0000000-0000-4000-a000-000000000082',
      household_id: demoHousehold.id,
      type: 'inventory',
      title: 'Critical Expiry Risk: Leftover Vegetable Curry',
      message: 'Leftover Vegetable Curry has estimated 0.8 days remaining (Use-First score: 95).',
      severity: 'critical',
      is_read: false,
      created_at: daysAgo(0.5)
    },
    {
      id: 'd0000000-0000-4000-a000-000000000083',
      household_id: demoHousehold.id,
      type: 'inventory',
      title: 'Critical Expiry Risk: Organic Strawberries',
      message: 'Organic Strawberries has estimated 1.0 days remaining (Use-First score: 92).',
      severity: 'critical',
      is_read: false,
      created_at: daysAgo(0.2)
    }
  ];

  for (const n of notificationsToSeed) {
    await upsertRecord(db, 'notifications', n);
  }

  const summary = {
    user: demoUser.email,
    household: demoHousehold.name,
    itemsSeeded: itemsToSeed.length,
    shoppingItemsSeeded: shoppingToSeed.length,
    sensorReadingsSeeded: readingsCount,
    deviceEventsSeeded: eventsToSeed.length,
    notificationsSeeded: notificationsToSeed.length,
    wasteRecordsSeeded: wasteToSeed.length,
    avoidedWasteRecordsSeeded
  };

  logger.info(summary, 'SaveBite demo data successfully seeded (idempotent)!');
  return summary;
}

// Auto-run if executed directly via CLI
if (process.argv[1] && process.argv[1].endsWith('seed-demo.js')) {
  seedDemo()
    .then((summary) => {
      console.log('✅ Demo seeding finished successfully:');
      console.table(summary);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Demo seeding failed:', err.message);
      process.exit(1);
    });
}
