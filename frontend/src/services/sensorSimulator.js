// src/services/sensorSimulator.js
// Simulated IoT sensor data and alerts for Smart Storage.
// Deterministic sequence for repeatable demos.

import { SENSOR_THRESHOLDS } from '../config/sensorThresholds'
import initialSensorReadings from '../mocks/sensorReadings.json'
import initialStorageAlerts from '../mocks/storageAlerts.json'

let isRunning = false
let intervalId = null
let lastUpdated = null

let sensors = JSON.parse(JSON.stringify(initialSensorReadings))
let alerts = JSON.parse(JSON.stringify(initialStorageAlerts))

const SIMULATION_INTERVAL_MS = 5000

function getRandomDelta(range) {
  const seed = Date.now()
  const rand = Math.abs(Math.sin(seed)) * 10000
  return ((rand % (range * 2)) - range) / 10
}

function generateSensorValues() {
  sensors = sensors.map((s) => {
    const newSensor = { ...s }
    switch (newSensor.type) {
      case 'temperature':
        newSensor.value = parseFloat((newSensor.value + getRandomDelta(2)).toFixed(1))
        break
      case 'humidity':
        newSensor.value = parseFloat((newSensor.value + getRandomDelta(3)).toFixed(1))
        break
      case 'voc':
        newSensor.value = Math.max(0, Math.round(newSensor.value + getRandomDelta(10)))
        break
      case 'door':
        if (Math.random() < 0.05) newSensor.value = !newSensor.value
        break
      case 'connection':
        const elapsed = (Date.now() - (lastUpdated || Date.now())) / 1000
        newSensor.value = elapsed > SENSOR_THRESHOLDS.connection.disconnectAfterSec ? false : true
        break
      default:
        break
    }
    newSensor.lastUpdated = new Date().toISOString()
    return newSensor
  })
}

function evaluateAlerts() {
  const newAlerts = []
  sensors.forEach((s) => {
    const { type, value, lastUpdated } = s
    let severity = null
    let title = ''
    let message = ''
    if (type === 'temperature') {
      if (value < SENSOR_THRESHOLDS.temperature.critical.min || value > SENSOR_THRESHOLDS.temperature.critical.max) {
        severity = 'critical'
        title = 'Temperature Critical'
        message = `Temperature ${value}°C is outside safe range.`
      } else if (value < SENSOR_THRESHOLDS.temperature.warning.min || value > SENSOR_THRESHOLDS.temperature.warning.max) {
        severity = 'warning'
        title = 'Temperature Warning'
        message = `Temperature ${value}°C is approaching limits.`
      }
    } else if (type === 'humidity') {
      if (value < SENSOR_THRESHOLDS.humidity.critical.min || value > SENSOR_THRESHOLDS.humidity.critical.max) {
        severity = 'critical'
        title = 'Humidity Critical'
        message = `Humidity ${value}% is unsafe.`
      } else if (value < SENSOR_THRESHOLDS.humidity.warning.min || value > SENSOR_THRESHOLDS.humidity.warning.max) {
        severity = 'warning'
        title = 'Humidity Warning'
        message = `Humidity ${value}% is nearing limits.`
      }
    } else if (type === 'voc') {
      if (value > SENSOR_THRESHOLDS.voc.critical.max) {
        severity = 'critical'
        title = 'Air Quality Critical'
        message = `VOC index ${value} indicates poor air quality.`
      } else if (value > SENSOR_THRESHOLDS.voc.warning.max) {
        severity = 'warning'
        title = 'Air Quality Warning'
        message = `VOC index ${value} is elevated.`
      }
    } else if (type === 'door') {
      if (value === true) {
        severity = 'warning'
        title = 'Door Open'
        message = 'Refrigerator door has been open.'
      }
    } else if (type === 'connection') {
      if (value === false) {
        severity = 'critical'
        title = 'Device Disconnected'
        message = 'Sensor device lost connection.'
      }
    }
    if (severity) {
      const alertId = `${type}-${Date.now()}`
      newAlerts.push({
        id: alertId,
        title,
        message,
        severity,
        zone: s.zone || 'unknown',
        isRead: false,
        timestamp: lastUpdated,
        recommendation: severity === 'critical' ? 'Immediate inspection required' : 'Check soon',
        source: 'simulation',
      })
    }
  })
  alerts = [...alerts, ...newAlerts]
}

function tick() {
  if (!isRunning) return
  generateSensorValues()
  evaluateAlerts()
  lastUpdated = new Date().toISOString()
}

export function startSimulation() {
  if (isRunning) return
  isRunning = true
  lastUpdated = new Date().toISOString()
  intervalId = setInterval(tick, SIMULATION_INTERVAL_MS)
}

export function stopSimulation() {
  if (!isRunning) return
  isRunning = false
  clearInterval(intervalId)
  intervalId = null
}

export function getCurrentSensors() {
  return sensors
}

export function getCurrentAlerts() {
  return alerts
}

export function getSimulationInfo() {
  return { isRunning, lastUpdated }
}

export const getSimulationStatus = getSimulationInfo

export default {
  startSimulation,
  stopSimulation,
  getCurrentSensors,
  getCurrentAlerts,
  getSimulationInfo,
  getSimulationStatus,
}
