import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MqttSubscriberService } from '../src/services/mqttSubscriber.service.js';

describe('MQTT Resilience & Backend Startup Suite (Phase 5)', () => {
  let mockTelemetryService;
  let service;

  beforeEach(() => {
    mockTelemetryService = {
      ingestTelemetry: async () => ({ reading: { id: 'r-1' } })
    };
    service = new MqttSubscriberService(mockTelemetryService);
  });

  it('should remain cleanly idle and inactive when MQTT_ENABLED is false', () => {
    // Service starts without errors when disabled
    service.start();
    assert.equal(service.isConnected, false);
    assert.equal(service.client, null);
  });

  it('should safely discard malformed JSON in incoming MQTT messages without crashing', async () => {
    let ingestCalled = false;
    mockTelemetryService.ingestTelemetry = async () => {
      ingestCalled = true;
    };

    const invalidBuffer = Buffer.from('NOT_VALID_JSON{{{', 'utf-8');
    await service._handleMessage('savebite/hh-1/dev-1/telemetry', invalidBuffer);

    assert.equal(ingestCalled, false, 'Ingest must not be invoked for invalid JSON');
  });

  it('should safely discard messages that fail Zod telemetry schema validation', async () => {
    let ingestCalled = false;
    mockTelemetryService.ingestTelemetry = async () => {
      ingestCalled = true;
    };

    // Missing device_code and invalid temperature
    const invalidPayload = JSON.stringify({
      readings: { temperature_c: 9999 }
    });
    const buffer = Buffer.from(invalidPayload, 'utf-8');
    await service._handleMessage('savebite/hh-1/dev-1/telemetry', buffer);

    assert.equal(ingestCalled, false, 'Ingest must not be invoked for schema-invalid payload');
  });

  it('should correctly ingest valid MQTT telemetry payload', async () => {
    let receivedPayload = null;
    let receivedHouseholdId = null;

    mockTelemetryService.ingest = async (payload, hhId) => {
      receivedHouseholdId = hhId;
      receivedPayload = payload;
      return { id: 'reading-123' };
    };

    const validPayload = JSON.stringify({
      device_code: 'ESP32-DEV-01',
      source_type: 'simulator',
      readings: {
        temperature_c: 4.1,
        humidity_percent: 62.0,
        air_quality_raw: 140.0
      }
    });

    const buffer = Buffer.from(validPayload, 'utf-8');
    await service._handleMessage('savebite/household-abc/ESP32-DEV-01/telemetry', buffer);

    assert.equal(receivedHouseholdId, 'household-abc');
    assert.equal(receivedPayload.device_code, 'ESP32-DEV-01');
    assert.equal(receivedPayload.source_type, 'simulator');
    assert.equal(receivedPayload.readings.temperature_c, 4.1);
  });

  it('should stop cleanly when stop() is called', async () => {
    await service.stop();
    assert.equal(service.isConnected, false);
  });
});
