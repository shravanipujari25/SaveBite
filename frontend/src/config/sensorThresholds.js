// src/config/sensorThresholds.js
// Demonstration thresholds for Smart Storage simulation.
// These are NOT certified food‑safety standards. Adjust as needed for demos.

export const SENSOR_THRESHOLDS = {
  temperature: {
    warning: { min: 2, max: 8 }, // °C typical fridge range
    critical: { min: 0, max: 10 },
  },
  humidity: {
    warning: { min: 30, max: 70 }, // % relative humidity
    critical: { min: 20, max: 80 },
  },
  voc: {
    // unitless index; higher means poorer air quality
    warning: { max: 150 },
    critical: { max: 250 },
  },
  doorOpen: {
    // boolean – door open for >30 seconds triggers warning
    warningDurationSec: 30,
  },
  connection: {
    // simulated disconnect alert
    disconnectAfterSec: 120,
  },
};
