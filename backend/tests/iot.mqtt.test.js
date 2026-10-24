import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { MqttSubscriberService } from '../src/services/mqttSubscriber.service.js';
import { TelemetryService } from '../src/services/telemetry.service.js';
import { deviceRepository } from '../src/repositories/device.repository.js';
import { sensorReadingRepository } from '../src/repositories/sensorReading.repository.js';

describe('MQTT Ingestion & Subscriber Resilience Suite', () => {
  let mockDb;
  let testDevice;
  let defaultHousehold;
  let mqttSubscriber;

  before(async () => {
    mockDb = await setupTestDatabase();
    defaultHousehold = mockDb.defaultHousehold;

    // Register a test device
    testDevice = await deviceRepository.create({
      household_id: defaultHousehold.id,
      name: 'MQTT Test Node',
      device_code: 'MQTT-ESP32-001',
      device_type: 'esp32',
      zone: 'pantry',
      source_type: 'physical'
    });

    const telemetryService = new TelemetryService(deviceRepository, sensorReadingRepository);
    mqttSubscriber = new MqttSubscriberService(telemetryService);
  });

  after(() => {
    teardownTestDatabase();
  });

  beforeEach(() => {
    mockDb.sensorReadingsTable.clear();
    mockDb.deviceEventsTable.clear();
    mockDb.notificationsTable.clear();
  });

  it('should parse and ingest valid MQTT telemetry message via topic savebite/:householdId/:deviceCode/telemetry', async () => {
    const topic = `savebite/${defaultHousehold.id}/${testDevice.device_code}/telemetry`;
    const payload = {
      device_code: testDevice.device_code,
      recorded_at: new Date().toISOString(),
      source_type: 'physical',
      readings: {
        temperature_c: 21.5,
        humidity_percent: 45.0,
        air_quality_raw: 120
      },
      metadata: {
        firmware: '2.0.1'
      }
    };

    const messageBuffer = Buffer.from(JSON.stringify(payload));
    await mqttSubscriber._handleMessage(topic, messageBuffer);

    // Verify reading was saved in sensor_readings table
    assert.equal(mockDb.sensorReadingsTable.size, 1);
    const reading = Array.from(mockDb.sensorReadingsTable.values())[0];
    assert.equal(reading.device_id, testDevice.id);
    assert.equal(reading.temperature_c, 21.5);
    assert.equal(reading.humidity_percent, 45.0);
    assert.equal(reading.air_quality_raw, 120);
    assert.equal(reading.metadata.firmware, '2.0.1');
  });

  it('should reject MQTT telemetry when topic household does not match registered device household', async () => {
    const forgedHouseholdId = '99999999-9999-9999-9999-999999999999';
    const topic = `savebite/${forgedHouseholdId}/${testDevice.device_code}/telemetry`;
    const payload = {
      device_code: testDevice.device_code,
      readings: { temperature_c: 22.0 }
    };

    const messageBuffer = Buffer.from(JSON.stringify(payload));
    await mqttSubscriber._handleMessage(topic, messageBuffer);

    // Verification: Reading must NOT be ingested due to household mismatch
    assert.equal(mockDb.sensorReadingsTable.size, 0);
  });

  it('should safely handle and discard malformed JSON in MQTT buffer without throwing or crashing', async () => {
    const topic = `savebite/${defaultHousehold.id}/${testDevice.device_code}/telemetry`;
    const invalidBuffer = Buffer.from('NOT_VALID_JSON_SYNTAX{{{');

    // Must not throw uncaught exception
    await assert.doesNotReject(async () => {
      await mqttSubscriber._handleMessage(topic, invalidBuffer);
    });

    assert.equal(mockDb.sensorReadingsTable.size, 0);
  });

  it('should safely discard MQTT messages with invalid measurement types (e.g., negative gas or humidity > 100)', async () => {
    const topic = `savebite/${defaultHousehold.id}/${testDevice.device_code}/telemetry`;
    const invalidPayload = {
      device_code: testDevice.device_code,
      readings: { humidity_percent: 125.0 } // Invalid > 100%
    };

    await mqttSubscriber._handleMessage(topic, Buffer.from(JSON.stringify(invalidPayload)));
    assert.equal(mockDb.sensorReadingsTable.size, 0);
  });

  it('should start and stop gracefully when MQTT is disabled without crashing the process', async () => {
    // start() with MQTT_ENABLED=false does nothing and logs safely
    mqttSubscriber.start();
    assert.equal(mqttSubscriber.isConnected, false);

    // stop() should resolve cleanly
    await assert.doesNotReject(async () => {
      await mqttSubscriber.stop();
    });
  });
});
