import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('IoT Device Management API Suite (/api/v1/devices)', () => {
  let mockDb;
  let userA;
  let tokenA;
  let householdA;

  let userB;
  let tokenB;
  let householdB;

  before(async () => {
    mockDb = await setupTestDatabase();

    // Register User A
    const signupResA = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        name: 'Device Owner Alice',
        email: 'alice.devices@savebite.com',
        password: 'Password123!'
      });
    userA = signupResA.body.data.user;
    tokenA = signupResA.body.data.accessToken;
    householdA = signupResA.body.data.household;

    // Register User B
    const signupResB = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        name: 'Device Owner Bob',
        email: 'bob.devices@savebite.com',
        password: 'Password123!'
      });
    userB = signupResB.body.data.user;
    tokenB = signupResB.body.data.accessToken;
    householdB = signupResB.body.data.household;
  });

  after(() => {
    teardownTestDatabase();
  });

  beforeEach(() => {
    mockDb.devicesTable.clear();
    mockDb.sensorReadingsTable.clear();
    mockDb.deviceEventsTable.clear();
    mockDb.notificationsTable.clear();
  });

  describe('1. Device Registration (POST /api/v1/devices)', () => {
    it('should successfully register a physical ESP32 device for authenticated household', async () => {
      const res = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Main Refrigerator Sensor',
          device_code: 'SAVE-ESP32-001',
          device_type: 'esp32',
          zone: 'refrigerator',
          source_type: 'physical'
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.status, 'success');
      assert.ok(res.body.data.device);

      const device = res.body.data.device;
      assert.equal(device.name, 'Main Refrigerator Sensor');
      assert.equal(device.device_code, 'SAVE-ESP32-001');
      assert.equal(device.device_type, 'esp32');
      assert.equal(device.zone, 'refrigerator');
      assert.equal(device.source_type, 'physical');
      assert.equal(device.status, 'active');
      assert.equal(device.household_id, householdA.id);
      assert.ok(device.id);

      // Security check: Never return device credentials or private secrets
      assert.equal(device.secret, undefined);
      assert.equal(device.password, undefined);
    });

    it('should register a simulator device with simulator source_type', async () => {
      const res = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Pantry Simulator Node',
          device_code: 'SIM-PANTRY-01',
          device_type: 'simulator',
          zone: 'pantry',
          source_type: 'simulator'
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.device.source_type, 'simulator');
      assert.equal(res.body.data.device.device_type, 'simulator');
    });

    it('should reject invalid device registration payload (missing name or code)', async () => {
      // Missing name
      const res1 = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: '',
          device_code: 'SAVE-ESP32-002'
        });
      assert.equal(res1.status, 400);
      assert.equal(res1.body.error.code, 'VALIDATION_ERROR');

      // Missing device_code
      const res2 = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Freezer Node'
        });
      assert.equal(res2.status, 400);

      // Invalid zone
      const res3 = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Freezer Node',
          device_code: 'SAVE-ESP32-003',
          zone: 'outer_space'
        });
      assert.equal(res3.status, 400);
    });

    it('should reject duplicate device_code registration by another household (409 Conflict)', async () => {
      // User A registers device
      await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Alice Sensor',
          device_code: 'COLLISION-001',
          zone: 'refrigerator'
        });

      // User B attempts to register the same device_code
      const resB = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          name: 'Bob Imposter Sensor',
          device_code: 'COLLISION-001',
          zone: 'pantry'
        });

      assert.equal(resB.status, 409);
      assert.equal(resB.body.error.code, 'DEVICE_CODE_EXISTS');
    });

    it('should be idempotent if re-registered by the same household', async () => {
      const payload = {
        name: 'Idempotent Sensor',
        device_code: 'IDEM-001',
        zone: 'freezer'
      };

      const res1 = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(payload);
      assert.equal(res1.status, 201);

      const res2 = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(payload);
      assert.ok([200, 201].includes(res2.status));
      assert.equal(res2.body.data.device.id, res1.body.data.device.id);
    });
  });

  describe('2. Device Listing & Isolation (GET /api/v1/devices)', () => {
    beforeEach(async () => {
      // User A registers 2 devices
      await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Fridge Sensor',
          device_code: 'A-FRIDGE-01',
          zone: 'refrigerator',
          source_type: 'physical'
        });

      await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Pantry Simulator',
          device_code: 'A-PANTRY-01',
          zone: 'pantry',
          source_type: 'simulator'
        });

      // User B registers 1 device
      await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          name: 'Bob Freezer',
          device_code: 'B-FREEZER-01',
          zone: 'freezer',
          source_type: 'physical'
        });
    });

    it('should return only devices belonging to the authenticated household', async () => {
      const resA = await request(app)
        .get('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenA}`);

      assert.equal(resA.status, 200);
      assert.equal(resA.body.data.devices.length, 2);

      const codesA = resA.body.data.devices.map((d) => d.device_code);
      assert.ok(codesA.includes('A-FRIDGE-01'));
      assert.ok(codesA.includes('A-PANTRY-01'));
      assert.equal(codesA.includes('B-FREEZER-01'), false); // User B device must never appear

      const resB = await request(app)
        .get('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenB}`);

      assert.equal(resB.status, 200);
      assert.equal(resB.body.data.devices.length, 1);
      assert.equal(resB.body.data.devices[0].device_code, 'B-FREEZER-01');
    });

    it('should filter devices by zone and source_type', async () => {
      // Zone filter
      const resZone = await request(app)
        .get('/api/v1/devices?zone=refrigerator')
        .set('Authorization', `Bearer ${tokenA}`);
      assert.equal(resZone.status, 200);
      assert.equal(resZone.body.data.devices.length, 1);
      assert.equal(resZone.body.data.devices[0].device_code, 'A-FRIDGE-01');

      // Source type filter
      const resSource = await request(app)
        .get('/api/v1/devices?source_type=simulator')
        .set('Authorization', `Bearer ${tokenA}`);
      assert.equal(resSource.status, 200);
      assert.equal(resSource.body.data.devices.length, 1);
      assert.equal(resSource.body.data.devices[0].device_code, 'A-PANTRY-01');
    });

    it('should return 404 when User B queries User A device by ID', async () => {
      // Get User A device ID
      const resListA = await request(app)
        .get('/api/v1/devices')
        .set('Authorization', `Bearer ${tokenA}`);
      const userADeviceId = resListA.body.data.devices[0].id;

      // User B attempts to fetch User A's device
      const resB = await request(app)
        .get(`/api/v1/devices/${userADeviceId}`)
        .set('Authorization', `Bearer ${tokenB}`);

      assert.equal(resB.status, 404);
      assert.equal(resB.body.error.code, 'NOT_FOUND');
    });

    it('should reject unauthenticated requests to device endpoints (401)', async () => {
      const res = await request(app).get('/api/v1/devices');
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });
  });
});
