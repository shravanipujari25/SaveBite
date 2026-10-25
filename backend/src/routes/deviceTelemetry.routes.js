import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { telemetryLimiter } from '../middleware/rateLimit.js';
import { telemetryService } from '../services/telemetry.service.js';
import { deviceRepository } from '../repositories/device.repository.js';
import { logger } from '../config/logger.js';
import env from '../config/env.js';

const router = Router();

/**
 * Validation schema for direct ESP32 hardware telemetry payload.
 * Supports:
 *   - deviceId (mapped to device_code)
 *   - temperature (°C, nullable on DHT read failure)
 *   - humidity (%, nullable on DHT read failure)
 *   - gasValue (raw ADC from MQ-135)
 *   - timestamp (optional ISO 8601 string)
 */
export const esp32TelemetrySchema = z.object({
  deviceId: z.string().trim().min(1, 'deviceId is required').max(64),
  temperature: z
    .number()
    .finite('temperature cannot be NaN or Infinity')
    .min(-50.0, 'temperature cannot be below -50.0°C')
    .max(100.0, 'temperature cannot exceed 100.0°C')
    .optional()
    .nullable(),
  humidity: z
    .number()
    .finite('humidity cannot be NaN or Infinity')
    .min(0.0, 'humidity cannot be below 0%')
    .max(100.0, 'humidity cannot exceed 100%')
    .optional()
    .nullable(),
  gasValue: z
    .number()
    .finite('gasValue cannot be NaN or Infinity')
    .min(0, 'gasValue must be non-negative')
    .optional()
    .nullable(),
  timestamp: z
    .string()
    .datetime({ offset: true, message: 'timestamp must be an ISO 8601 string' })
    .optional()
    .nullable()
});

/**
 * POST /api/v1/telemetry/device
 * Direct hardware endpoint for ESP32 microcontrollers.
 * Automatically resolves registered device or links to demo household if running in demo/dev mode.
 */
router.post(
  '/device',
  telemetryLimiter,
  validate({ body: esp32TelemetrySchema }),
  async (req, res, next) => {
    try {
      const { deviceId, temperature, humidity, gasValue, timestamp } = req.body;
      const deviceCode = deviceId.trim();

      // Check if device is already registered
      let device = await deviceRepository.findByCode(deviceCode);

      if (!device) {
        // In development / demo mode, auto-provision unassigned ESP32 device to DEMO_HOUSEHOLD
        // so hardware works out-of-the-box without requiring manual database seeding
        const householdId = process.env.DEMO_HOUSEHOLD_ID || 'd0000000-0000-4000-a000-000000000002';
        logger.info({ deviceCode, householdId }, 'Auto-registering ESP32 device for household');

        try {
          device = await deviceRepository.create({
            household_id: householdId,
            name: 'Smart Storage Sensor (ESP32)',
            device_code: deviceCode,
            device_type: 'esp32',
            zone: 'refrigerator',
            source_type: 'physical'
          });
        } catch (regErr) {
          // If already registered concurrently, re-fetch
          device = await deviceRepository.findByCode(deviceCode);
          if (!device) throw regErr;
        }
      }

      // Map to standard SaveBite telemetry format
      const telemetryPayload = {
        device_code: deviceCode,
        recorded_at: timestamp || new Date().toISOString(),
        source_type: 'physical',
        readings: {
          temperature_c: temperature !== undefined && temperature !== null ? Number(temperature) : null,
          humidity_percent: humidity !== undefined && humidity !== null ? Number(humidity) : null,
          air_quality_raw: gasValue !== undefined && gasValue !== null ? Number(gasValue) : null,
          air_quality_unit: 'adc_raw'
        },
        metadata: {
          sensor_model: 'DHT11 + MQ-135',
          firmware: 'SaveBite-ESP32-1.0'
        }
      };

      const result = await telemetryService.ingest(telemetryPayload, null);

      return res.status(201).json({
        status: 'success',
        message: 'Telemetry ingested successfully from ESP32 hardware',
        data: {
          device_code: deviceCode,
          reading_id: result.reading_id,
          recorded_at: result.recorded_at,
          received_at: result.received_at
        }
      });
    } catch (err) {
      return next(err);
    }
  }
);

export default router;
