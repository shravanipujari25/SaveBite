import { z } from 'zod';

export const createPairingTokenSchema = z.object({
  device_name: z.string().trim().max(100).optional().nullable(),
  device_type: z.string().trim().max(50).optional().nullable()
});

export const pairDeviceSchema = z.object({
  pairing_token: z.string().trim().min(6, 'Pairing token must be at least 6 characters').max(64),
  device_name: z.string().trim().min(1, 'Device name is required').max(100),
  device_type: z.string().trim().max(50).optional().default('esp32_sensor_hub')
});
