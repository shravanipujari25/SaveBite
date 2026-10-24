import { deviceRepository } from '../repositories/device.repository.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../config/logger.js';

export class DeviceService {
  constructor(repository = deviceRepository) {
    this.deviceRepo = repository;
  }

  /**
   * Register a new sensor device for the authenticated household.
   *
   * @param {string} householdId
   * @param {object} deviceData
   * @returns {Promise<object>}
   */
  async registerDevice(householdId, deviceData) {
    const device = await this.deviceRepo.create({
      household_id: householdId,
      name: deviceData.name,
      device_code: deviceData.device_code,
      device_type: deviceData.device_type,
      zone: deviceData.zone,
      source_type: deviceData.source_type
    });

    logger.info({ deviceId: device.id, deviceCode: device.device_code, householdId }, 'Device registered successfully');
    return device;
  }

  /**
   * List devices for the authenticated household with optional filters.
   *
   * @param {string} householdId
   * @param {object} [filters]
   * @returns {Promise<object[]>}
   */
  async getDevices(householdId, filters = {}) {
    return this.deviceRepo.findByHousehold(householdId, filters);
  }

  /**
   * Get a single device by ID scoped strictly to the household.
   *
   * @param {string} householdId
   * @param {string} deviceId
   * @returns {Promise<object>}
   */
  async getDeviceById(householdId, deviceId) {
    const device = await this.deviceRepo.findById(deviceId, householdId);
    if (!device) {
      throw new AppError('Device not found', 404, 'NOT_FOUND');
    }
    return device;
  }
}

export const deviceService = new DeviceService();
export default deviceService;
