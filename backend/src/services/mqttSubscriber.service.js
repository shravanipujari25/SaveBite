import mqtt from 'mqtt';
import env from '../config/env.js';
import { logger } from '../config/logger.js';
import { telemetryService } from './telemetry.service.js';
import { ingestTelemetrySchema } from '../schemas/telemetry.schema.js';

export class MqttSubscriberService {
  constructor(service = telemetryService) {
    this.telemetryService = service;
    this.client = null;
    this.isConnected = false;
    this.isStopping = false;
  }

  /**
   * Start MQTT subscriber if MQTT_ENABLED is true.
   * Non-blocking: will not prevent HTTP server from starting if broker is unreachable.
   */
  start() {
    if (!env.MQTT_ENABLED) {
      logger.info('MQTT ingestion is disabled (MQTT_ENABLED=false). HTTP telemetry remains active.');
      return;
    }

    try {
      logger.info({ brokerUrl: env.MQTT_BROKER_URL, topic: env.MQTT_TELEMETRY_TOPIC }, 'Initializing MQTT subscriber');

      const options = {
        clientId: `${env.MQTT_CLIENT_ID}-${Math.random().toString(16).substring(2, 8)}`,
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 10000,
        ...(env.MQTT_USERNAME ? { username: env.MQTT_USERNAME } : {}),
        ...(env.MQTT_PASSWORD ? { password: env.MQTT_PASSWORD } : {})
      };

      this.client = mqtt.connect(env.MQTT_BROKER_URL, options);

      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('MQTT client connected to broker');

        this.client.subscribe(env.MQTT_TELEMETRY_TOPIC, { qos: 1 }, (err) => {
          if (err) {
            logger.error({ err: err.message }, 'Failed to subscribe to MQTT topic');
          } else {
            logger.info({ topic: env.MQTT_TELEMETRY_TOPIC }, 'MQTT subscribed successfully');
          }
        });
      });

      this.client.on('message', async (topic, messageBuffer) => {
        await this._handleMessage(topic, messageBuffer);
      });

      this.client.on('error', (err) => {
        logger.warn({ err: err.message }, 'MQTT client encountered error (will retry automatically)');
      });

      this.client.on('offline', () => {
        this.isConnected = false;
        logger.debug('MQTT client is offline');
      });

      this.client.on('reconnect', () => {
        logger.debug('MQTT client attempting reconnection to broker');
      });
    } catch (err) {
      logger.error({ err: err.message }, 'Unexpected error initializing MQTT client');
    }
  }

  /**
   * Parse and validate incoming MQTT telemetry message.
   *
   * Expected topic structure: `savebite/:householdId/:deviceCode/telemetry`
   *
   * @private
   */
  async _handleMessage(topic, messageBuffer) {
    try {
      const rawText = messageBuffer.toString('utf-8');
      let payload;

      try {
        payload = JSON.parse(rawText);
      } catch (parseErr) {
        logger.warn({ topic, error: parseErr.message }, 'Discarding malformed JSON in MQTT message');
        return;
      }

      // Parse topic components: savebite/:householdId/:deviceCode/telemetry
      const segments = topic.split('/');
      let topicHouseholdId = null;
      let topicDeviceCode = null;

      if (segments.length >= 4) {
        topicHouseholdId = segments[1];
        topicDeviceCode = segments[2];
      }

      // Ensure device_code is present in payload or fallback to topic segment
      if (!payload.device_code && topicDeviceCode) {
        payload.device_code = topicDeviceCode;
      }

      // Validate schema
      const validation = ingestTelemetrySchema.safeParse(payload);
      if (!validation.success) {
        logger.warn(
          { topic, issues: validation.error.issues.map((i) => i.message) },
          'Discarding MQTT telemetry with invalid payload schema'
        );
        return;
      }

      // Ingest via unified telemetry service with household verification
      await this.telemetryService.ingest(validation.data, topicHouseholdId || null);
    } catch (err) {
      logger.warn({ topic, error: err.message }, 'Failed to process MQTT telemetry message');
    }
  }

  /**
   * Gracefully stop the MQTT subscriber client.
   */
  async stop() {
    this.isStopping = true;
    if (this.client) {
      return new Promise((resolve) => {
        this.client.end(false, {}, () => {
          this.isConnected = false;
          logger.info('MQTT client closed gracefully');
          resolve();
        });
      });
    }
  }
}

export const mqttSubscriberService = new MqttSubscriberService();
export default mqttSubscriberService;
