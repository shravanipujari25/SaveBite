import { deviceRepository } from '../repositories/device.repository.js';
import { sensorReadingRepository } from '../repositories/sensorReading.repository.js';
import { deviceEventRepository } from '../repositories/deviceEvent.repository.js';
import { notificationRepository } from '../repositories/notification.repository.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../config/logger.js';
import env from '../config/env.js';

export class TelemetryService {
  constructor(
    deviceRepo = deviceRepository,
    readingRepo = sensorReadingRepository,
    eventRepo = deviceEventRepository,
    notifRepo = notificationRepository
  ) {
    this.deviceRepo = deviceRepo;
    this.readingRepo = readingRepo;
    this.eventRepo = eventRepo;
    this.notifRepo = notifRepo;
  }

  /**
   * Ingest a telemetry payload from HTTP or MQTT.
   *
   * @param {object} payload
   * @param {string} [callerHouseholdId] - If provided from HTTP user context, validates device ownership
   * @returns {Promise<{ reading_id: string, recorded_at: string, received_at: string }>}
   */
  async ingest(payload, callerHouseholdId = null) {
    const deviceCode = payload.device_code.trim();

    // 1. Resolve registered device from database
    const device = await this.deviceRepo.findByCode(deviceCode);
    if (!device) {
      logger.warn({ deviceCode }, 'Telemetry rejected: Device not registered');
      throw new AppError(`Device code '${deviceCode}' is not registered`, 404, 'DEVICE_NOT_FOUND');
    }

    // 2. Strict household authorization check
    if (callerHouseholdId && device.household_id !== callerHouseholdId) {
      logger.warn(
        { deviceCode, callerHouseholdId, deviceHouseholdId: device.household_id },
        'Telemetry rejected: Device belongs to another household'
      );
      throw new AppError('Access denied: Device belongs to another household', 403, 'FORBIDDEN_DEVICE');
    }

    const recordedAt = payload.recorded_at || new Date().toISOString();
    const receivedAt = new Date().toISOString();
    const readings = payload.readings || {};

    // 3. Persist raw measurement record
    const reading = await this.readingRepo.create({
      device_id: device.id,
      household_id: device.household_id,
      recorded_at: recordedAt,
      received_at: receivedAt,
      temperature_c: readings.temperature_c ?? null,
      humidity_percent: readings.humidity_percent ?? null,
      air_quality_raw: readings.air_quality_raw ?? null,
      air_quality_unit: readings.air_quality_unit || 'raw',
      air_quality_index: readings.air_quality_index ?? null,
      source_type: payload.source_type || device.source_type || 'physical',
      metadata: payload.metadata || {}
    });

    // 4. Update device last_seen_at
    await this.deviceRepo.updateLastSeen(device.id, receivedAt);

    // 5. Evaluate preliminary operational thresholds (Non-AI, explicit rules)
    await this._checkOperationalThresholds(device, readings, recordedAt);

    logger.info(
      { readingId: reading.id, deviceId: device.id, householdId: device.household_id, sourceType: reading.source_type },
      'Telemetry reading ingested successfully'
    );

    return {
      reading_id: reading.id,
      recorded_at: reading.recorded_at,
      received_at: reading.received_at
    };
  }

  /**
   * Evaluate simple preliminary threshold rules and generate operational alerts if not on cooldown.
   *
   * @private
   */
  async _checkOperationalThresholds(device, readings, occurredAt) {
    try {
      // Temperature check
      if (typeof readings.temperature_c === 'number') {
        const temp = readings.temperature_c;
        if (temp > env.TEMP_HIGH_ALERT_C || temp < env.TEMP_LOW_ALERT_C) {
          const isHigh = temp > env.TEMP_HIGH_ALERT_C;
          const recentAlert = await this.notifRepo.findRecentAlert(
            device.household_id,
            device.id,
            'threshold_alert',
            15 // 15-minute cooldown
          );

          if (!recentAlert) {
            const message = isHigh
              ? `Elevated temperature of ${temp}°C detected in ${device.zone}. Warning threshold: ${env.TEMP_HIGH_ALERT_C}°C.`
              : `Low temperature of ${temp}°C detected in ${device.zone}. Low threshold: ${env.TEMP_LOW_ALERT_C}°C.`;

            const event = await this.eventRepo.create({
              device_id: device.id,
              household_id: device.household_id,
              event_type: 'threshold_breach',
              severity: 'warning',
              message,
              occurred_at: occurredAt,
              source_type: device.source_type,
              metadata: { measurement: 'temperature_c', value: temp }
            });

            await this.notifRepo.create({
              household_id: device.household_id,
              device_id: device.id,
              event_id: event.id,
              type: 'threshold_alert',
              title: isHigh ? 'Temperature High Warning' : 'Temperature Low Warning',
              message,
              severity: 'warning'
            });

            logger.info({ deviceId: device.id, temp }, 'Operational temperature threshold notification created');
          }
        }
      }

      // Air quality raw sensor threshold check (Preliminary notice, NOT AI gas classification)
      if (typeof readings.air_quality_raw === 'number') {
        const rawGas = readings.air_quality_raw;
        if (rawGas >= env.AIR_QUALITY_ALERT_RAW) {
          const recentAlert = await this.notifRepo.findRecentAlert(
            device.household_id,
            device.id,
            'threshold_alert',
            15 // 15-minute cooldown
          );

          if (!recentAlert) {
            const message = `Sensor in ${device.zone} reported elevated raw gas measurement (${rawGas} ${readings.air_quality_unit || 'raw'}). Preliminary sensor notice; pending AI review.`;

            const event = await this.eventRepo.create({
              device_id: device.id,
              household_id: device.household_id,
              event_type: 'threshold_breach',
              severity: 'warning',
              message,
              occurred_at: occurredAt,
              source_type: device.source_type,
              metadata: { measurement: 'air_quality_raw', value: rawGas }
            });

            await this.notifRepo.create({
              household_id: device.household_id,
              device_id: device.id,
              event_id: event.id,
              type: 'threshold_alert',
              title: 'Air Quality Sensor Threshold Notice',
              message,
              severity: 'warning'
            });

            logger.info({ deviceId: device.id, rawGas }, 'Preliminary air quality threshold notification created');
          }
        }
      }
    } catch (err) {
      // Operational threshold evaluation failure should not block telemetry ingestion
      logger.warn({ err: err.message }, 'Failed to evaluate operational thresholds');
    }
  }

  /**
   * Retrieve readings for a device scoped to a household.
   *
   * @param {string} householdId
   * @param {string} deviceId
   * @param {object} queryParams
   * @returns {Promise<{ device: object, readings: object[] }>}
   */
  async getDeviceReadings(householdId, deviceId, queryParams) {
    const device = await this.deviceRepo.findById(deviceId, householdId);
    if (!device) {
      throw new AppError('Device not found in household', 404, 'NOT_FOUND');
    }

    const readings = await this.readingRepo.findReadings(deviceId, householdId, queryParams);

    return {
      device: {
        id: device.id,
        name: device.name,
        device_code: device.device_code,
        zone: device.zone,
        source_type: device.source_type,
        status: device.status,
        last_seen_at: device.last_seen_at
      },
      readings
    };
  }
}

export const telemetryService = new TelemetryService();
export default telemetryService;
