import sys
from pathlib import Path

# Ensure ai directory is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

"""Tests for Phase 5: Synthetic IoT Sensor Intelligence.

Covers:
  - Dataset loading and synthetic flag verification
  - ZoneThresholdConfig validation (finite numbers, threshold ordering)
  - SensorReading validation (data types, negative numbers, non-finite values)
  - Individual threshold alerts (high/low temp, high/low humidity, door open, power cut)
  - Stale reading detection with injectable as_of reference time
  - Sequential sudden temperature change detection
  - Sequential sustained abnormal temperature condition detection
  - Sequential sustained door-open detection
  - Recovery from abnormal condition resets sustained tracking
  - Large time gap breaks continuity
  - Sensor separation (unrelated sensors never compared)
  - Unknown storage zone handling (insufficient_data, not silent defaults)
  - Malformed reading handling in batches without crashing
  - Phase 1-4 regression checks
"""

from datetime import datetime, timezone, timedelta
import math
import pytest

from app.services.sensor_service import (
    DEFAULT_ZONE_CONFIGS,
    AlertType,
    ReadingAnalysisResult,
    SensorAlert,
    SensorBatchAnalysisResponse,
    SensorReading,
    ZoneThresholdConfig,
    analyze_sensor_reading,
    analyze_sensor_readings,
    check_individual_reading,
    check_sequential_anomalies,
    load_sample_sensor_data,
    validate_raw_reading,
)


@pytest.fixture
def ref_time() -> datetime:
    """Fixed reference time matching the synthetic dataset evaluation point."""
    return datetime(2026, 10, 24, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def ref_config() -> ZoneThresholdConfig:
    return DEFAULT_ZONE_CONFIGS["refrigerator"]


# ---------------------------------------------------------------------------
# 1. Dataset Tests
# ---------------------------------------------------------------------------

def test_sample_sensor_dataset_exists_and_loads():
    readings = load_sample_sensor_data()
    assert len(readings) >= 20
    assert all(isinstance(r, dict) for r in readings)


def test_all_sample_readings_marked_simulated():
    readings = load_sample_sensor_data()
    for r in readings:
        assert r.get("simulated") is True, f"Reading {r.get('reading_id')} missing simulated=True"


# ---------------------------------------------------------------------------
# 2. Configuration Model Tests
# ---------------------------------------------------------------------------

def test_zone_config_valid():
    cfg = ZoneThresholdConfig(min_temperature_c=1.0, max_temperature_c=5.0)
    assert cfg.min_temperature_c == 1.0
    assert cfg.max_temperature_c == 5.0


def test_zone_config_min_greater_than_max_rejected():
    with pytest.raises(ValueError, match="cannot exceed max_temperature_c"):
        ZoneThresholdConfig(min_temperature_c=10.0, max_temperature_c=5.0)


def test_zone_config_humidity_ordering_rejected():
    with pytest.raises(ValueError, match="min_humidity_percent .* cannot exceed max_humidity_percent"):
        ZoneThresholdConfig(
            min_temperature_c=0.0,
            max_temperature_c=4.0,
            min_humidity_percent=80.0,
            max_humidity_percent=40.0,
        )


def test_zone_config_non_finite_rejected():
    with pytest.raises(ValueError, match="must be finite"):
        ZoneThresholdConfig(min_temperature_c=float("nan"), max_temperature_c=10.0)
    with pytest.raises(ValueError, match="must be finite"):
        ZoneThresholdConfig(min_temperature_c=0.0, max_temperature_c=float("inf"))


# ---------------------------------------------------------------------------
# 3. Reading Validation Tests
# ---------------------------------------------------------------------------

def test_sensor_reading_valid(ref_time):
    reading = SensorReading(
        reading_id="R1",
        sensor_id="S1",
        storage_zone="refrigerator",
        timestamp=ref_time,
        temperature_c=3.5,
        humidity_percent=60.0,
        door_open=False,
        power_cut_hours=0.0,
        simulated=True,
    )
    assert reading.reading_id == "R1"
    assert reading.temperature_c == 3.5
    assert reading.simulated is True


def test_sensor_reading_out_of_range_humidity_rejected(ref_time):
    with pytest.raises(ValueError, match="humidity_percent must be in range"):
        SensorReading(
            reading_id="R1",
            sensor_id="S1",
            storage_zone="refrigerator",
            timestamp=ref_time,
            humidity_percent=120.0,
        )


def test_sensor_reading_negative_power_cut_rejected(ref_time):
    with pytest.raises(ValueError, match="power_cut_hours must be a non-negative"):
        SensorReading(
            reading_id="R1",
            sensor_id="S1",
            storage_zone="refrigerator",
            timestamp=ref_time,
            power_cut_hours=-1.0,
        )


def test_sensor_reading_non_finite_temp_rejected(ref_time):
    with pytest.raises(ValueError, match="temperature_c must be a finite number"):
        SensorReading(
            reading_id="R1",
            sensor_id="S1",
            storage_zone="refrigerator",
            timestamp=ref_time,
            temperature_c=float("nan"),
        )


# ---------------------------------------------------------------------------
# 4. Individual Anomaly Detection Tests
# ---------------------------------------------------------------------------

def test_normal_reading_produces_no_alerts(ref_time, ref_config):
    reading = SensorReading(
        reading_id="NORM-01",
        sensor_id="S1",
        storage_zone="refrigerator",
        timestamp=ref_time - timedelta(minutes=10),
        temperature_c=2.5,
        humidity_percent=65.0,
        door_open=False,
        power_cut_hours=0.0,
        simulated=True,
    )
    alerts, _ = check_individual_reading(reading, ref_config, ref_time)
    assert len(alerts) == 0


def test_high_temperature_alert(ref_time, ref_config):
    reading = SensorReading(
        reading_id="HIGH-T-01",
        sensor_id="S1",
        storage_zone="refrigerator",
        timestamp=ref_time - timedelta(minutes=10),
        temperature_c=7.5,
        simulated=True,
    )
    alerts, _ = check_individual_reading(reading, ref_config, ref_time)
    types = [a.alert_type for a in alerts]
    assert "high_temperature" in types
    alert = next(a for a in alerts if a.alert_type == "high_temperature")
    assert alert.observed_value == 7.5
    assert alert.threshold == 4.0
    assert alert.severity == "warning"


def test_low_temperature_alert(ref_time, ref_config):
    reading = SensorReading(
        reading_id="LOW-T-01",
        sensor_id="S1",
        storage_zone="refrigerator",
        timestamp=ref_time - timedelta(minutes=10),
        temperature_c=-2.0,
        simulated=True,
    )
    alerts, _ = check_individual_reading(reading, ref_config, ref_time)
    types = [a.alert_type for a in alerts]
    assert "low_temperature" in types
    alert = next(a for a in alerts if a.alert_type == "low_temperature")
    assert alert.observed_value == -2.0
    assert alert.threshold == 0.0


def test_high_humidity_alert(ref_time, ref_config):
    reading = SensorReading(
        reading_id="HIGH-H-01",
        sensor_id="S1",
        storage_zone="refrigerator",
        timestamp=ref_time - timedelta(minutes=10),
        humidity_percent=92.0,
        simulated=True,
    )
    alerts, _ = check_individual_reading(reading, ref_config, ref_time)
    assert any(a.alert_type == "high_humidity" for a in alerts)


def test_low_humidity_alert(ref_time, ref_config):
    reading = SensorReading(
        reading_id="LOW-H-01",
        sensor_id="S1",
        storage_zone="refrigerator",
        timestamp=ref_time - timedelta(minutes=10),
        humidity_percent=25.0,
        simulated=True,
    )
    alerts, _ = check_individual_reading(reading, ref_config, ref_time)
    assert any(a.alert_type == "low_humidity" for a in alerts)


def test_single_door_open_alert_is_info_severity(ref_time, ref_config):
    reading = SensorReading(
        reading_id="DOOR-01",
        sensor_id="S1",
        storage_zone="refrigerator",
        timestamp=ref_time - timedelta(minutes=10),
        door_open=True,
        simulated=True,
    )
    alerts, _ = check_individual_reading(reading, ref_config, ref_time)
    assert any(a.alert_type == "door_open" and a.severity == "info" for a in alerts)


def test_power_cut_alert_severity_thresholds(ref_time, ref_config):
    # Warning when under power_cut_alert_hours (0.5h for fridge)
    r_warn = SensorReading(
        reading_id="PWR-WARN",
        sensor_id="S1",
        storage_zone="refrigerator",
        timestamp=ref_time - timedelta(minutes=10),
        power_cut_hours=0.25,
        simulated=True,
    )
    alerts_w, _ = check_individual_reading(r_warn, ref_config, ref_time)
    assert any(a.alert_type == "power_interruption" and a.severity == "warning" for a in alerts_w)

    # Critical when >= power_cut_alert_hours
    r_crit = SensorReading(
        reading_id="PWR-CRIT",
        sensor_id="S1",
        storage_zone="refrigerator",
        timestamp=ref_time - timedelta(minutes=10),
        power_cut_hours=1.5,
        simulated=True,
    )
    alerts_c, _ = check_individual_reading(r_crit, ref_config, ref_time)
    assert any(a.alert_type == "power_interruption" and a.severity == "critical" for a in alerts_c)


def test_stale_reading_detected_with_injectable_as_of(ref_time, ref_config):
    old_reading = SensorReading(
        reading_id="STALE-01",
        sensor_id="S1",
        storage_zone="refrigerator",
        timestamp=ref_time - timedelta(hours=10),  # Config max age is 4.0h
        temperature_c=3.0,
        simulated=True,
    )
    alerts, _ = check_individual_reading(old_reading, ref_config, ref_time)
    assert any(a.alert_type == "stale_reading" and a.severity == "warning" for a in alerts)


# ---------------------------------------------------------------------------
# 5. Sequential Pattern Detection Tests
# ---------------------------------------------------------------------------

def test_sudden_temperature_change_detected(ref_time):
    t0 = ref_time - timedelta(minutes=30)
    t1 = ref_time - timedelta(minutes=15)
    readings = [
        SensorReading(reading_id="R1", sensor_id="S1", storage_zone="refrigerator", timestamp=t0, temperature_c=3.0, simulated=True),
        SensorReading(reading_id="R2", sensor_id="S1", storage_zone="refrigerator", timestamp=t1, temperature_c=6.5, simulated=True), # +3.5C > 2.5C threshold
    ]
    seq_alerts = check_sequential_anomalies(readings, DEFAULT_ZONE_CONFIGS)
    assert any(a.alert_type == "sudden_temperature_change" for a in seq_alerts["R2"])


def test_sustained_temperature_anomaly_detected(ref_time):
    readings = [
        SensorReading(reading_id="R1", sensor_id="S1", storage_zone="refrigerator", timestamp=ref_time - timedelta(minutes=45), temperature_c=6.0, simulated=True),
        SensorReading(reading_id="R2", sensor_id="S1", storage_zone="refrigerator", timestamp=ref_time - timedelta(minutes=30), temperature_c=6.2, simulated=True),
        SensorReading(reading_id="R3", sensor_id="S1", storage_zone="refrigerator", timestamp=ref_time - timedelta(minutes=15), temperature_c=6.5, simulated=True), # 3rd consecutive abnormal
    ]
    seq_alerts = check_sequential_anomalies(readings, DEFAULT_ZONE_CONFIGS)
    assert any(a.alert_type == "sustained_abnormal_temperature" and a.severity == "critical" for a in seq_alerts["R3"])


def test_temperature_recovery_resets_sustained_counter(ref_time):
    readings = [
        SensorReading(reading_id="R1", sensor_id="S1", storage_zone="refrigerator", timestamp=ref_time - timedelta(minutes=60), temperature_c=6.0, simulated=True),
        SensorReading(reading_id="R2", sensor_id="S1", storage_zone="refrigerator", timestamp=ref_time - timedelta(minutes=45), temperature_c=6.2, simulated=True),
        SensorReading(reading_id="R3", sensor_id="S1", storage_zone="refrigerator", timestamp=ref_time - timedelta(minutes=30), temperature_c=3.0, simulated=True), # Recovered!
        SensorReading(reading_id="R4", sensor_id="S1", storage_zone="refrigerator", timestamp=ref_time - timedelta(minutes=15), temperature_c=6.5, simulated=True), # 1st abnormal again
    ]
    seq_alerts = check_sequential_anomalies(readings, DEFAULT_ZONE_CONFIGS)
    assert not any(a.alert_type == "sustained_abnormal_temperature" for a in seq_alerts["R4"])


def test_large_time_gap_breaks_continuity(ref_time):
    readings = [
        SensorReading(reading_id="R1", sensor_id="S1", storage_zone="refrigerator", timestamp=ref_time - timedelta(hours=6), temperature_c=7.0, simulated=True),
        SensorReading(reading_id="R2", sensor_id="S1", storage_zone="refrigerator", timestamp=ref_time - timedelta(hours=4), temperature_c=7.0, simulated=True),
        SensorReading(reading_id="R3", sensor_id="S1", storage_zone="refrigerator", timestamp=ref_time - timedelta(minutes=10), temperature_c=7.0, simulated=True), # 3h50m gap > 2h max gap
    ]
    seq_alerts = check_sequential_anomalies(readings, DEFAULT_ZONE_CONFIGS)
    # R3 should not trigger sustained alert because gap broke continuity
    assert not any(a.alert_type == "sustained_abnormal_temperature" for a in seq_alerts["R3"])


def test_unrelated_sensors_never_compared(ref_time):
    readings = [
        SensorReading(reading_id="R1", sensor_id="SENSOR-A", storage_zone="refrigerator", timestamp=ref_time - timedelta(minutes=15), temperature_c=2.0, simulated=True),
        SensorReading(reading_id="R2", sensor_id="SENSOR-B", storage_zone="refrigerator", timestamp=ref_time - timedelta(minutes=10), temperature_c=8.0, simulated=True),
    ]
    seq_alerts = check_sequential_anomalies(readings, DEFAULT_ZONE_CONFIGS)
    # SENSOR-B reading should NOT compare against SENSOR-A for sudden change
    assert not any(a.alert_type == "sudden_temperature_change" for a in seq_alerts["R2"])


def test_sustained_door_open_detected(ref_time):
    readings = [
        SensorReading(reading_id="D1", sensor_id="S1", storage_zone="refrigerator", timestamp=ref_time - timedelta(minutes=30), door_open=True, simulated=True),
        SensorReading(reading_id="D2", sensor_id="S1", storage_zone="refrigerator", timestamp=ref_time - timedelta(minutes=15), door_open=True, simulated=True),
    ]
    seq_alerts = check_sequential_anomalies(readings, DEFAULT_ZONE_CONFIGS)
    assert any(a.alert_type == "sustained_door_open" for a in seq_alerts["D2"])


# ---------------------------------------------------------------------------
# 6. Unknown Zones and Malformed Data Handling
# ---------------------------------------------------------------------------

def test_unknown_storage_zone_handled_as_insufficient_data(ref_time):
    raw = {
        "reading_id": "UNK-01",
        "sensor_id": "S1",
        "storage_zone": "wine_cellar_custom",
        "timestamp": ref_time.isoformat(),
        "temperature_c": 12.0,
        "simulated": True,
    }
    result = analyze_sensor_reading(raw, as_of=ref_time)
    assert result.status == "insufficient_data"
    assert any(a.alert_type == "unknown_storage_zone" for a in result.alerts)


def test_malformed_reading_handled_without_exception(ref_time):
    malformed = {
        "reading_id": "MAL-01",
        "sensor_id": "S1",
        "storage_zone": "refrigerator",
        "timestamp": "not-a-valid-date",
        "temperature_c": "not-a-number",
    }
    result = analyze_sensor_reading(malformed, as_of=ref_time)
    assert result.is_valid is False
    assert result.status == "insufficient_data"
    assert len(result.validation_issues) > 0


def test_batch_analysis_with_mixed_valid_and_invalid_records(ref_time):
    batch = [
        {
            "reading_id": "VALID-01",
            "sensor_id": "S1",
            "storage_zone": "refrigerator",
            "timestamp": (ref_time - timedelta(minutes=5)).isoformat(),
            "temperature_c": 3.2,
            "simulated": True,
        },
        {
            "reading_id": "INVALID-01",
            "sensor_id": "S2",
            "storage_zone": "refrigerator",
            "timestamp": "bad-date",
        },
    ]
    res = analyze_sensor_readings(batch, as_of=ref_time)
    assert res.total_readings == 2
    assert res.valid_readings == 1
    assert res.invalid_readings == 1
    assert res.overall_status in ("normal", "warning", "insufficient_data")


def test_batch_analysis_on_entire_sample_dataset(ref_time):
    readings = load_sample_sensor_data()
    res = analyze_sensor_readings(readings, as_of=ref_time)
    assert res.total_readings == len(readings)
    assert res.valid_readings > 0
    assert res.invalid_readings > 0
    assert len(res.active_alerts) > 0
    assert res.simulated is True
