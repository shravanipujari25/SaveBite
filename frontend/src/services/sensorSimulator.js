// src/services/sensorSimulator.js
/**
 * SaveBite Frontend Sensor Simulation Engine
 * Generates realistic, smoothly oscillating simulated sensor readings for:
 *   - Temperature (°C)
 *   - Humidity (%)
 *   - Gas Value (MQ-135 ADC raw index)
 * Reuses SENSOR_THRESHOLDS boundary definitions and supports scenario modes:
 *   - 'normal' (within safe boundaries)
 *   - 'warning' (elevated readings approaching limits)
 *   - 'critical' (outside safe boundaries)
 *   - 'fluctuating' (smooth natural drifts with occasional boundary tests)
 */

import { SENSOR_THRESHOLDS } from '../config/sensorThresholds'

// Preset boundary ranges based on SENSOR_THRESHOLDS
export const SENSOR_BOUNDARIES = {
  temperature: {
    min: SENSOR_THRESHOLDS.temperature.critical.min, // 0°C
    max: SENSOR_THRESHOLDS.temperature.critical.max, // 10°C
    warningMin: SENSOR_THRESHOLDS.temperature.warning.min, // 2°C
    warningMax: SENSOR_THRESHOLDS.temperature.warning.max, // 8°C
    optimalMin: 2.5,
    optimalMax: 5.5,
    unit: '°C'
  },
  humidity: {
    min: SENSOR_THRESHOLDS.humidity.critical.min, // 20%
    max: SENSOR_THRESHOLDS.humidity.critical.max, // 80%
    warningMin: SENSOR_THRESHOLDS.humidity.warning.min, // 30%
    warningMax: SENSOR_THRESHOLDS.humidity.warning.max, // 70%
    optimalMin: 55,
    optimalMax: 70,
    unit: '%'
  },
  gasValue: {
    normalMax: SENSOR_THRESHOLDS.voc.warning.max, // 150 (raw index)
    warningMax: SENSOR_THRESHOLDS.voc.critical.max, // 250
    criticalMax: 500,
    unit: 'ADC'
  }
}

// Internal simulation state
let isRunning = true
let currentMode = 'fluctuating' // 'normal' | 'warning' | 'critical' | 'fluctuating'
let listeners = new Set()
let intervalId = null

// Initial state for simulated primary sensor node
let currentReading = {
  temperature: 4.2,
  humidity: 62,
  gasValue: 118,
  lastSync: new Date().toISOString()
}

// Generate realistic starting history (20 points spaced by 5 seconds)
function generateInitialHistory() {
  const points = []
  const now = Date.now()
  for (let i = 19; i >= 0; i--) {
    const timestamp = new Date(now - i * 5000).toISOString()
    const wave = Math.sin((20 - i) * 0.4)
    points.push({
      time: timestamp,
      temperature: Number((3.8 + wave * 0.6).toFixed(1)),
      humidity: Math.round(62 + wave * 3),
      gasValue: Math.round(115 + Math.abs(wave) * 12)
    })
  }
  return points
}

let history = generateInitialHistory()

/**
 * Evaluates boundary condition for a metric and returns status and alert info.
 */
export function evaluateCondition(temp, hum, gas) {
  let severity = 'normal'
  const alerts = []
  const now = new Date().toISOString()

  // Temperature evaluation
  if (temp !== null && temp !== undefined) {
    if (temp <= SENSOR_BOUNDARIES.temperature.min || temp >= SENSOR_BOUNDARIES.temperature.max) {
      severity = 'critical'
      alerts.push({
        id: `temp-crit-${now}`,
        severity: 'critical',
        type: 'temperature_alert',
        title: 'Critical Temperature Alert',
        message: `Temperature is at ${temp}°C, which exceeds food-preservation boundaries (${SENSOR_BOUNDARIES.temperature.warningMin}°C - ${SENSOR_BOUNDARIES.temperature.warningMax}°C).`,
        recommendation: 'Check refrigerator door seal and cooling compressor immediately.',
        timestamp: now
      })
    } else if (temp < SENSOR_BOUNDARIES.temperature.warningMin || temp > SENSOR_BOUNDARIES.temperature.warningMax) {
      if (severity !== 'critical') severity = 'warning'
      alerts.push({
        id: `temp-warn-${now}`,
        severity: 'warning',
        type: 'temperature_alert',
        title: 'Temperature Variance Notice',
        message: `Temperature is at ${temp}°C, approaching boundary limits.`,
        recommendation: 'Keep storage door closed and monitor cooling recovery.',
        timestamp: now
      })
    }
  }

  // Humidity evaluation
  if (hum !== null && hum !== undefined) {
    if (hum <= SENSOR_BOUNDARIES.humidity.min || hum >= SENSOR_BOUNDARIES.humidity.max) {
      severity = 'critical'
      alerts.push({
        id: `hum-crit-${now}`,
        severity: 'critical',
        type: 'humidity_alert',
        title: 'Critical Humidity Level',
        message: `Moisture level at ${hum}% poses high spoilage and condensation risk.`,
        recommendation: 'Inspect container ventilation and wipe excess interior condensation.',
        timestamp: now
      })
    } else if (hum < SENSOR_BOUNDARIES.humidity.warningMin || hum > SENSOR_BOUNDARIES.humidity.warningMax) {
      if (severity !== 'critical') severity = 'warning'
      alerts.push({
        id: `hum-warn-${now}`,
        severity: 'warning',
        type: 'humidity_alert',
        title: 'Humidity Variance Notice',
        message: `Moisture at ${hum}% is drifting from the ideal 55% - 70% range.`,
        recommendation: 'Verify produce drawers are sealed properly.',
        timestamp: now
      })
    }
  }

  // Gas Sensor evaluation (MQ-135 index)
  if (gas !== null && gas !== undefined) {
    if (gas > SENSOR_BOUNDARIES.gasValue.warningMax) {
      severity = 'critical'
      alerts.push({
        id: `gas-crit-${now}`,
        severity: 'critical',
        type: 'gas_alert',
        title: 'Elevated Gas / VOC Alert',
        message: `Gas sensor reading is at ${gas} ADC, indicating high organic volatile buildup.`,
        recommendation: 'Inspect produce for over-ripening or active decay.',
        timestamp: now
      })
    } else if (gas > SENSOR_BOUNDARIES.gasValue.normalMax) {
      if (severity !== 'critical') severity = 'warning'
      alerts.push({
        id: `gas-warn-${now}`,
        severity: 'warning',
        type: 'gas_alert',
        title: 'Gas Level Warning',
        message: `Gas sensor reading elevated at ${gas} ADC.`,
        recommendation: 'Early ethylene or aroma release detected from storage.',
        timestamp: now
      })
    }
  }

  return { severity, alerts }
}

/**
 * Step generator with smooth organic wave + jitter
 */
let stepCounter = 0
function generateNextReading() {
  stepCounter++
  const time = new Date().toISOString()
  let temp, hum, gas

  if (currentMode === 'normal') {
    // Kept strictly within optimal safe bands
    const wave = Math.sin(stepCounter * 0.25)
    temp = Number((3.6 + wave * 0.8 + (Math.random() * 0.2 - 0.1)).toFixed(1))
    hum = Math.round(63 + wave * 4 + (Math.random() * 2 - 1))
    gas = Math.round(110 + Math.abs(wave) * 15 + Math.random() * 5)
  } else if (currentMode === 'warning') {
    // Drifts into warning range (e.g. 8.4°C temp, 74% hum, 195 gas)
    const wave = Math.sin(stepCounter * 0.3)
    temp = Number((8.2 + wave * 0.5 + Math.random() * 0.2).toFixed(1))
    hum = Math.round(73 + wave * 3 + Math.random() * 2)
    gas = Math.round(185 + Math.abs(wave) * 20 + Math.random() * 5)
  } else if (currentMode === 'critical') {
    // Drifts into critical danger range (e.g. 11.8°C temp, 84% hum, 320 gas)
    const wave = Math.sin(stepCounter * 0.3)
    temp = Number((11.5 + wave * 0.7 + Math.random() * 0.3).toFixed(1))
    hum = Math.round(83 + wave * 3 + Math.random() * 2)
    gas = Math.round(310 + Math.abs(wave) * 30 + Math.random() * 10)
  } else {
    // 'fluctuating' default: mostly healthy with smooth natural cycles that occasionally touch warnings
    const longWave = Math.sin(stepCounter * 0.08) // Long period cycle
    const fastWave = Math.cos(stepCounter * 0.35) * 0.4
    temp = Number((4.0 + longWave * 2.2 + fastWave + (Math.random() * 0.15 - 0.07)).toFixed(1))
    hum = Math.round(62 + longWave * 9 + (Math.random() * 2 - 1))
    gas = Math.round(120 + Math.max(0, longWave) * 45 + Math.abs(fastWave) * 15)
  }

  currentReading = {
    temperature: temp,
    humidity: hum,
    gasValue: gas,
    lastSync: time
  }

  // Update rolling history buffer (keep last 25 readings)
  history.push({
    time,
    temperature: temp,
    humidity: hum,
    gasValue: gas
  })
  if (history.length > 25) {
    history.shift()
  }

  notifyListeners()
}

function notifyListeners() {
  const data = getCurrentSensorPayload()
  listeners.forEach((cb) => {
    try {
      cb(data)
    } catch (e) {
      console.error('Error notifying sensor simulation listener:', e)
    }
  })
}

/**
 * Returns formatted simulated device node compatible with existing frontend gauges.
 */
export function getCurrentSensorPayload() {
  const { severity, alerts } = evaluateCondition(
    currentReading.temperature,
    currentReading.humidity,
    currentReading.gasValue
  )

  const node = {
    nodeId: 'simulated_node_01',
    name: 'Smart Storage Sensor (Simulated)',
    locationName: 'Primary Fresh Food Zone',
    zone: 'fridge',
    sourceType: 'simulator',
    temperature: currentReading.temperature,
    unitTemp: '°C',
    humidity: currentReading.humidity,
    unitHumidity: '%',
    gasValue: currentReading.gasValue,
    deviceCode: 'SIM-ESP32-NODE-01',
    status: isRunning ? 'online' : 'offline',
    conditionSeverity: severity,
    lastSync: currentReading.lastSync,
    readingsHistory: [...history]
  }

  return {
    sensors: [node],
    alerts,
    isRunning,
    currentMode,
    lastUpdated: currentReading.lastSync
  }
}

/**
 * Subscription helper for React hooks to receive real-time ticks without re-rendering loops.
 */
export function subscribeToSimulator(callback) {
  listeners.add(callback)
  // Send current value immediately
  callback(getCurrentSensorPayload())
  return () => {
    listeners.delete(callback)
  }
}

/**
 * Controls: start, stop, reset, setMode
 */
export function startSimulation() {
  if (intervalId) return
  isRunning = true
  intervalId = setInterval(generateNextReading, 5000)
  notifyListeners()
}

export function stopSimulation() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  isRunning = false
  notifyListeners()
}

export function toggleSimulation() {
  if (isRunning) {
    stopSimulation()
  } else {
    startSimulation()
  }
}

export function setSimulationMode(mode) {
  if (['normal', 'warning', 'critical', 'fluctuating'].includes(mode)) {
    currentMode = mode
    generateNextReading()
  }
}

export function resetSimulation() {
  stepCounter = 0
  currentMode = 'fluctuating'
  currentReading = {
    temperature: 4.2,
    humidity: 62,
    gasValue: 118,
    lastSync: new Date().toISOString()
  }
  history = generateInitialHistory()
  notifyListeners()
}

// Auto-start simulation in frontend runtime
startSimulation()

export default {
  getCurrentSensorPayload,
  subscribeToSimulator,
  startSimulation,
  stopSimulation,
  toggleSimulation,
  setSimulationMode,
  resetSimulation,
  evaluateCondition,
  SENSOR_BOUNDARIES
}
