import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('IoT Telemetry Ingestion & Smart Storage Suite (/api/v1/telemetry & /api/v1/notifications)', () => {
  let mockDb;
  let userA;
  let tokenA;
  let householdA;
  let deviceA;

  let userB;
  let tokenB;
  let householdB;
  let deviceB;

  before(async () => {
    mockDb = await setupTestDatabase();

    // Register User A
    const signupResA = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        name: 'Telemetry Alice',
        email: 'alice.telemetry@savebite.com',
        password: 'Password123!'
      });
    userA = signupResA.body.data.user;
    tokenA = signupResA.body.data.accessToken;
    householdA = signupResA.body.data.household;

    // Register User B
    const signupResB = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        name: 'Telemetry Bob',
        email: 'bob.telemetry@savebite.com',
        password: 'Password123!'
      });
    userB = signupResB.body.data.user;
    tokenB = signupResB.body.data.accessToken;
    householdB = signupResB.body.data.household;
  });

  after(() => {
    teardownTestDatabase();
  });

  beforeEach(async () => {
    mockDb.devicesTable.clear();
    mockDb.sensorReadingsTable.clear();
    mockDb.deviceEventsTable.clear();
    mockDb.notificationsTable.clear();

    // Provision Device A for Household A
    const devResA = await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Alice Smart Fridge',
        device_code: 'ESP32-FRIDGE-01',
        device_type: 'esp32',
        zone: 'refrigerator',
        source_type: 'physical'
      });
    deviceA = devResA.body.data.device;

    // Provision Device B for Household B
    const devResB = await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        name: 'Bob Smart Pantry',
        device_code: 'ESP32-PANTRY-01',
        device_type: 'esp32',
        zone: 'pantry',
        source_type: 'physical'
      });
    deviceB = devResB.body.data.device;
  });

  describe('1. HTTP Telemetry Ingestion (POST /api/v1/telemetry)', () => {
    it('should ingest valid sensor readings and update device last_seen_at', async () => {
      const recordedAt = new Date().toISOString();

      const res = await request(app)
        .post('/api/v1/telemetry')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          device_code: 'ESP32-FRIDGE-01',
          recorded_at: recordedAt,
          source_type: 'physical',
          readings: {
            temperature_c: 4.2,
            humidity_percent: 65.0,
            air_quality_raw: 180,
            air_quality_unit: 'raw'
          },
          metadata: {
            sensor_model: 'DHT22 + MQ-135',
            firmware_version: '1.2.0'
          }
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.status, 'success');
      assert.ok(res.body.data.reading_id);
      assert.ok(res.body.data.received_at);

      // Verify reading was stored in database
      const reading = mockDb.sensorReadingsTable.get(res.body.data.reading_id);
      assert.ok(reading);
      assert.equal(reading.temperature_c, 4.2);
      assert.equal(reading.humidity_percent, 65.0);
      assert.equal(reading.air_quality_raw, 180);
      assert.equal(reading.air_quality_unit, 'raw');
      assert.equal(reading.source_type, 'physical');
      assert.equal(reading.metadata.firmware_version, '1.2.0');

      // Verify device last_seen_at was updated
      const updatedDevice = mockDb.devicesTable.get(deviceA.id);
      assert.ok(updatedDevice.last_seen_at);
    });

    it('should permit missing measurements when a sensor does not provide them', async () => {
      // Humidity only sensor
      const res = await request(app)
        .post('/api/v1/telemetry')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          device_code: 'ESP32-FRIDGE-01',
          readings: {
            humidity_percent: 55.4
          }
        });

      assert.equal(res.status, 201);
      const reading = mockDb.sensorReadingsTable.get(res.body.data.reading_id);
      assert.equal(reading.humidity_percent, 55.4);
      assert.equal(reading.temperature_c, null);
      assert.equal(reading.air_quality_raw, null);
    });

    it('should distinguish simulator source from physical device source', async () => {
      const res = await request(app)
        .post('/api/v1/telemetry')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          device_code: 'ESP32-FRIDGE-01',
          source_type: 'simulator',
          readings: {
            temperature_c: 3.5
          }
        });

      assert.equal(res.status, 201);
      const reading = mockDb.sensorReadingsTable.get(res.body.data.reading_id);
      assert.equal(reading.source_type, 'simulator');
    });

    it('should reject unknown/unregistered device code with 404', async () => {
      const res = await request(app)
        .post('/api/v1/telemetry')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          device_code: 'NON-EXISTENT-DEVICE',
          readings: { temperature_c: 5.0 }
        });

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'DEVICE_NOT_FOUND');
    });

    it('should prevent cross-household telemetry injection (403 Forbidden)', async () => {
      // User B attempts to submit telemetry for User A's device
      const res = await request(app)
        .post('/api/v1/telemetry')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          device_code: 'ESP32-FRIDGE-01', // Belongs to Household A
          readings: { temperature_c: 5.0 }
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN_DEVICE');
    });

    it('should reject invalid measurement ranges (e.g., humidity > 100%, temperature > 100°C)', async () => {
      // Humidity out of physical bounds
      const res1 = await request(app)
        .post('/api/v1/telemetry')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          device_code: 'ESP32-FRIDGE-01',
          readings: { humidity_percent: 150.0 }
        });
      assert.equal(res1.status, 400);

      // Temperature out of sensor specification
      const res2 = await request(app)
        .post('/api/v1/telemetry')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          device_code: 'ESP32-FRIDGE-01',
          readings: { temperature_c: 500.0 }
        });
      assert.equal(res2.status, 400);

      // Negative gas reading
      const res3 = await request(app)
        .post('/api/v1/telemetry')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          device_code: 'ESP32-FRIDGE-01',
          readings: { air_quality_raw: -10 }
        });
      assert.equal(res3.status, 400);
    });

    it('should reject unreasonable future timestamps', async () => {
      const farFuture = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours ahead

      const res = await request(app)
        .post('/api/v1/telemetry')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          device_code: 'ESP32-FRIDGE-01',
          recorded_at: farFuture,
          readings: { temperature_c: 4.0 }
        });

      assert.equal(res.status, 400);
      assert.match(res.body.error.details[0].message, /future/i);
    });
  });

  describe('2. Historical Readings Query (GET /api/v1/devices/:id/readings)', () => {
    beforeEach(async () => {
      const now = Date.now();
      // Insert 3 readings for Device A spaced 1 hour apart
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/v1/telemetry')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({
            device_code: 'ESP32-FRIDGE-01',
            recorded_at: new Date(now - i * 3600000).toISOString(),
            readings: {
              temperature_c: 4.0 + i,
              humidity_percent: 60.0 + i
            }
          });
      }
    });

    it('should retrieve readings for authorized device ordered newest first', async () => {
      const res = await request(app)
        .get(`/api/v1/devices/${deviceA.id}/readings`)
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.ok(res.body.data.device);
      assert.equal(res.body.data.readings.length, 3);

      // Verify newest first ordering
      const r = res.body.data.readings;
      assert.ok(new Date(r[0].recorded_at) >= new Date(r[1].recorded_at));
      assert.ok(new Date(r[1].recorded_at) >= new Date(r[2].recorded_at));
    });

    it('should filter readings by time range (from, to)', async () => {
      const now = Date.now();
      const fromTime = new Date(now - 1.5 * 3600000).toISOString();
      const toTime = new Date(now + 60000).toISOString();

      const res = await request(app)
        .get(`/api/v1/devices/${deviceA.id}/readings?from=${encodeURIComponent(fromTime)}&to=${encodeURIComponent(toTime)}`)
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(res.status, 200);
      // Only 2 readings within the last 1.5 hours
      assert.equal(res.body.data.readings.length, 2);
    });

    it('should return 404 when User B queries User A device readings', async () => {
      const res = await request(app)
        .get(`/api/v1/devices/${deviceA.id}/readings`)
        .set('Authorization', `Bearer ${tokenB}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });
  });

  describe('3. Operational Threshold Breaches & Notifications', () => {
    it('should create operational event and notification when temperature exceeds threshold', async () => {
      // High temperature (15°C in refrigerator, well above 10.0°C threshold)
      const res = await request(app)
        .post('/api/v1/telemetry')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          device_code: 'ESP32-FRIDGE-01',
          readings: {
            temperature_c: 15.5
          }
        });

      assert.equal(res.status, 201);

      // Verify device_events record was created
      assert.equal(mockDb.deviceEventsTable.size, 1);
      const event = Array.from(mockDb.deviceEventsTable.values())[0];
      assert.equal(event.event_type, 'threshold_breach');
      assert.equal(event.severity, 'warning');
      assert.equal(event.household_id, householdA.id);

      // Verify notification was created for Household A
      assert.equal(mockDb.notificationsTable.size, 1);
      const notif = Array.from(mockDb.notificationsTable.values())[0];
      assert.equal(notif.type, 'threshold_alert');
      assert.equal(notif.severity, 'warning');
      assert.match(notif.title, /temperature/i);
      assert.equal(notif.is_read, false);
      assert.equal(notif.household_id, householdA.id);
    });

    it('should respect notification cooldown window to prevent alert flooding', async () => {
      // First high temp reading
      await request(app)
        .post('/api/v1/telemetry')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          device_code: 'ESP32-FRIDGE-01',
          readings: { temperature_c: 16.0 }
        });
      assert.equal(mockDb.notificationsTable.size, 1);

      // Immediate second high temp reading (within 15m cooldown)
      await request(app)
        .post('/api/v1/telemetry')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          device_code: 'ESP32-FRIDGE-01',
          readings: { temperature_c: 16.5 }
        });

      // No duplicate notification should be flooded
      assert.equal(mockDb.notificationsTable.size, 1);
    });

    it('should create preliminary notification on raw air quality sensor spike without claiming toxic gas', async () => {
      const res = await request(app)
        .post('/api/v1/telemetry')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          device_code: 'ESP32-FRIDGE-01',
          readings: {
            air_quality_raw: 450.0 // Above 400.0 threshold
          }
        });

      assert.equal(res.status, 201);
      assert.equal(mockDb.notificationsTable.size, 1);
      const notif = Array.from(mockDb.notificationsTable.values())[0];
      assert.match(notif.title, /air quality/i);
      // Must NOT claim specific toxic gas identified
      assert.match(notif.message, /preliminary/i);
    });
  });

  describe('4. Notifications API (GET & PATCH /api/v1/notifications)', () => {
    let notifAId;

    beforeEach(async () => {
      // Trigger a notification for Household A
      await request(app)
        .post('/api/v1/telemetry')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          device_code: 'ESP32-FRIDGE-01',
          readings: { temperature_c: 18.0 }
        });

      const notifs = Array.from(mockDb.notificationsTable.values());
      notifAId = notifs[0].id;
    });

    it('should list notifications belonging only to authenticated household', async () => {
      const resA = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(resA.status, 200);
      assert.equal(resA.body.data.notifications.length, 1);
      assert.equal(resA.body.data.notifications[0].id, notifAId);

      // User B should see 0 notifications (isolation verified)
      const resB = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${tokenB}`);

      assert.equal(resB.status, 200);
      assert.equal(resB.body.data.notifications.length, 0);
    });

    it('should mark notification as read and set read_at safely and idempotently', async () => {
      const resRead1 = await request(app)
        .patch(`/api/v1/notifications/${notifAId}/read`)
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(resRead1.status, 200);
      assert.equal(resRead1.body.data.notification.is_read, true);
      assert.ok(resRead1.body.data.notification.read_at);
      const firstReadAt = resRead1.body.data.notification.read_at;

      // Idempotent repeat
      const resRead2 = await request(app)
        .patch(`/api/v1/notifications/${notifAId}/read`)
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(resRead2.status, 200);
      assert.equal(resRead2.body.data.notification.read_at, firstReadAt);
    });

    it('should return 404 when User B attempts to mark User A notification as read', async () => {
      const res = await request(app)
        .patch(`/api/v1/notifications/${notifAId}/read`)
        .set('Authorization', `Bearer ${tokenB}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });
  });
});
