import { deviceService } from '../services/device.service.js';
import { telemetryService } from '../services/telemetry.service.js';
import { devicePairingService } from '../services/devicePairing.service.js';

export class DeviceController {
  constructor(dService = deviceService, tService = telemetryService, pService = devicePairingService) {
    this.deviceService = dService;
    this.telemetryService = tService;
    this.pairingService = pService;
  }

  /**
   * POST /api/v1/devices
   * Register a new sensor device for the authenticated household.
   */
  createDevice = async (req, res, next) => {
    try {
      const device = await this.deviceService.registerDevice(req.household.id, req.body);
      return res.status(201).json({
        status: 'success',
        data: { device }
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * GET /api/v1/devices
   * List devices for the authenticated household.
   */
  getDevices = async (req, res, next) => {
    try {
      const devices = await this.deviceService.getDevices(req.household.id, req.query);
      return res.status(200).json({
        status: 'success',
        data: { devices }
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * GET /api/v1/devices/:id
   * Get single device details.
   */
  getDeviceById = async (req, res, next) => {
    try {
      const device = await this.deviceService.getDeviceById(req.household.id, req.params.id);
      return res.status(200).json({
        status: 'success',
        data: { device }
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * GET /api/v1/devices/:id/readings
   * Get historical telemetry readings for a device.
   */
  getReadings = async (req, res, next) => {
    try {
      const result = await this.telemetryService.getDeviceReadings(
        req.household.id,
        req.params.id,
        req.query
      );
      return res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * POST /api/v1/devices/pairing-token
   * Generate an ephemeral 15-minute pairing token for an IoT node.
   */
  createPairingToken = async (req, res, next) => {
    try {
      const result = await this.pairingService.createPairingToken(
        req.household.id,
        req.user.id,
        req.body
      );
      return res.status(201).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * POST /api/v1/devices/pair
   * Complete pairing for an IoT hardware node using a valid token.
   */
  pairDevice = async (req, res, next) => {
    try {
      const result = await this.pairingService.pairDevice(
        req.body.pairing_token,
        req.body
      );
      return res.status(201).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      return next(err);
    }
  };
}

export const deviceController = new DeviceController();
export default deviceController;
