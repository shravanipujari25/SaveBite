import crypto from 'crypto';
import { pairingTokenRepository } from '../repositories/pairingToken.repository.js';
import { deviceRepository } from '../repositories/device.repository.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../config/logger.js';

export class DevicePairingService {
  constructor(dependencies = {}) {
    this.tokenRepo = dependencies.tokenRepo || pairingTokenRepository;
    this.deviceRepo = dependencies.deviceRepo || deviceRepository;
  }

  /**
   * Generate an ephemeral, cryptographically secure 15-minute pairing token for a household.
   *
   * @param {string} householdId
   * @param {string} userId
   * @param {object} [options={}]
   * @returns {Promise<object>}
   */
  async createPairingToken(householdId, userId, options = {}) {
    // Generate secure 8-character hex code
    const rawCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const token = `PAIR-${rawCode}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const record = await this.tokenRepo.createToken({
      household_id: householdId,
      created_by: userId,
      token,
      device_type: options.device_type || 'esp32_sensor_hub',
      zone: options.zone || 'refrigerator',
      expires_at: expiresAt
    });

    logger.info({ householdId, userId, token: record.token }, 'Device pairing token generated');

    return {
      pairing_token: record.token,
      device_type: record.device_type,
      zone: record.zone,
      expires_at: record.expires_at,
      expires_in_seconds: 900
    };
  }

  /**
   * Complete device pairing using the provided token.
   *
   * @param {string} tokenString
   * @param {object} devicePayload
   * @returns {Promise<object>}
   */
  async pairDevice(tokenString, devicePayload) {
    const validToken = await this.tokenRepo.findValidToken(tokenString);
    if (!validToken) {
      logger.warn({ token: tokenString }, 'Pairing attempt rejected: token invalid, expired, or already used');
      throw new AppError(
        'The provided pairing token is invalid, expired, or has already been used',
        400,
        'INVALID_PAIRING_TOKEN'
      );
    }

    // Generate unique device code for MQTT / IoT identification
    const deviceCode = `DEV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // Register device under the token's household
    const device = await this.deviceRepo.create({
      household_id: validToken.household_id,
      name: devicePayload.device_name || 'Smart Storage Hub',
      device_code: deviceCode,
      device_type: devicePayload.device_type || validToken.device_type || 'esp32_sensor_hub',
      zone: validToken.zone || 'refrigerator',
      source_type: 'physical'
    });

    // Mark pairing token as consumed
    await this.tokenRepo.markTokenUsed(validToken.id, device.id);

    logger.info(
      { deviceId: device.id, deviceCode, householdId: validToken.household_id },
      'Device successfully paired and activated'
    );

    return {
      message: 'Device paired successfully',
      device: {
        id: device.id,
        name: device.name,
        device_code: device.device_code,
        device_type: device.device_type,
        zone: device.zone,
        household_id: device.household_id,
        created_at: device.created_at
      }
    };
  }
}

export const devicePairingService = new DevicePairingService();
export default devicePairingService;
