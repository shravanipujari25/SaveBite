import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('ESP32 Hardware Direct Telemetry Suite (POST /api/v1/telemetry/device)', () => {
  let mockDb;
  let userA;
  let tokenA;
  let householdA;

  before(async () => {
    mockDb = await setupTestDatabase();

    // Register a household user for viewing readings
    const signupRes = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        name: 'Hardware Test User',
        email: 'hardware.test@savebite.com',
        password: 'Password123!'
      });
    userA = signupRes.body.data.user;
    tokenA = signupRes.body.data.accessToken;
    householdA = signupRes.body.data.household;
  });

  after(() => {
    teardownTestDatabase();
  });

  beforeEach(() => {
    mockDb.sensorReadingsTable.clear();
    mockDb.devicesTable.clear();
    mockDb.deviceEventsTable.clear();
    mockDb.notificationsTable.clear();
  });

  it('should ingest exact ESP32 firmware payload: { deviceId, temperature, humidity, gasValue, timestamp }', async () => {
    // 1. First register the device for Household A
    const devRes = await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'SaveBite Fridge ESP32',
        device_code: 'savebite-fridge-01',
        device_type: 'esp32',
        zone: 'refrigerator',
        source_type: 'physical'
      });
    assert.equal(devRes.status, 201);
    const deviceId = devRes.body.data.device.id;

    // 2. Transmit exact ESP32 payload
    const testTimestamp = new Date().toISOString();
    const res = await request(app)
      .post('/api/v1/telemetry/device')
      .send({
        deviceId: 'savebite-fridge-01',
        temperature: 25.4,
        humidity: 60.0,
        gasValue: 1200,
        timestamp: testTimestamp
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'success');
    assert.ok(res.body.data.reading_id);

    // 3. Verify reading in database
    const reading = mockDb.sensorReadingsTable.get(res.body.data.reading_id);
    assert.ok(reading);
    assert.equal(reading.device_id, deviceId);
    assert.equal(reading.temperature_c, 25.4);
    assert.equal(reading.humidity_percent, 60.0);
    assert.equal(reading.air_quality_raw, 1200);
    assert.equal(reading.air_quality_unit, 'adc_raw');
    assert.equal(reading.source_type, 'physical');

    // 4. Verify reading is retrieved by GET /api/v1/devices/:id/readings
    const getRes = await request(app)
      .get(`/api/v1/devices/${deviceId}/readings`)
      .set('Authorization', `Bearer ${tokenA}`);

    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.readings.length, 1);
    assert.equal(getRes.body.data.readings[0].air_quality_raw, 1200);
    assert.equal(getRes.body.data.readings[0].temperature_c, 25.4);
  });

  it('should handle DHT11 failure cleanly by permitting null temperature and humidity while saving raw gasValue', async () => {
    // Register device
    await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Pantry ESP32',
        device_code: 'savebite-fridge-01',
        device_type: 'esp32',
        zone: 'refrigerator',
        source_type: 'physical'
      });

    // Send payload when DHT read failed
    const res = await request(app)
      .post('/api/v1/telemetry/device')
      .send({
        deviceId: 'savebite-fridge-01',
        temperature: null,
        humidity: null,
        gasValue: 1050
      });

    assert.equal(res.status, 201);
    const reading = mockDb.sensorReadingsTable.get(res.body.data.reading_id);
    assert.ok(reading);
    assert.equal(reading.temperature_c, null);
    assert.equal(reading.humidity_percent, null);
    assert.equal(reading.air_quality_raw, 1050);
  });

  it('should reject invalid payload with missing deviceId', async () => {
    const res = await request(app)
      .post('/api/v1/telemetry/device')
      .send({
        temperature: 25.0,
        humidity: 50.0,
        gasValue: 800
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });
});
