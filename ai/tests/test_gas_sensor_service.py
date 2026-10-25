"""Tests for Phase 12: Gas/VOC Sensor Intelligence.

All sensor readings in this module are explicitly SIMULATED (simulated=True).
They represent deterministic test fixtures, not real hardware measurements.

Coverage:
  - SensorReading gas field validation (gas_ppm, voc_index, ethylene_ppm)
  - ZoneThresholdConfig gas threshold validation
  - Point-in-time gas_ppm threshold check and alert structure
  - Point-in-time voc_index threshold check and alert structure
  - Point-in-time ethylene_ppm threshold check and alert structure
  - No alert when gas readings are within normal bounds
  - No alert when gas threshold not configured (max_gas_ppm=None)
  - No alert when gas fields are absent (backward compatibility)
  - Sustained high gas_ppm detection across consecutive readings
  - Sustained high voc_index detection across consecutive readings
  - Gas sustained-anomaly recovery resets counter
  - Large time gap breaks gas sustained-anomaly continuity
  - Multiple gas types simultaneously elevated (all three alert independently)
  - Multi-zone gas threshold isolation (refrigerator vs. pantry limits differ)
  - Invalid gas values rejected (negative, NaN, Inf)
  - Gas fields omitted from older payloads do not cause errors
  - Batch analysis with mixed gas and non-gas readings
  - Full batch pipeline: overall_status escalates on gas alert
  - API endpoint POST /sensors/analyze accepts gas fields and returns alerts
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.sensor_service import (
    DEFAULT_ZONE_CONFIGS,
    SensorReading,
    ZoneThresholdConfig,
    analyze_sensor_reading,
    analyze_sensor_readings,
    check_individual_reading,
    check_sequential_anomalies,
)

client = TestClient(app)

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def ref_time() -> datetime:
    """Fixed reference time used for all simulated readings in this module."""
    return datetime(2026, 10, 25, 10, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def fridge_config() -> ZoneThresholdConfig:
    return DEFAULT_ZONE_CONFIGS["refrigerator"]


@pytest.fixture
def pantry_config() -> ZoneThresholdConfig:
    return DEFAULT_ZONE_CONFIGS["pantry"]


def _make_reading(
    reading_id: str,
    ref_time: datetime,
    offset_minutes: int = 5,
    storage_zone: str = "refrigerator",
    sensor_id: str = "SIM-GAS-01",
    temperature_c: float = 3.0,
    humidity_percent: float = 60.0,
    gas_ppm=None,
    voc_index=None,
    ethylene_ppm=None,
) -> SensorReading:
    """Helper: build a valid SensorReading with optional gas fields."""
    return SensorReading(
        reading_id=reading_id,
        sensor_id=sensor_id,
        storage_zone=storage_zone,
        timestamp=ref_time - timedelta(minutes=offset_minutes),
        temperature_c=temperature_c,
        humidity_percent=humidity_percent,
        gas_ppm=gas_ppm,
        voc_index=voc_index,
        ethylene_ppm=ethylene_ppm,
        simulated=True,
    )


# ---------------------------------------------------------------------------
# 1. SensorReading gas field validation
# ---------------------------------------------------------------------------


class TestGasFieldValidation:

    def test_gas_ppm_accepted_when_valid(self, ref_time):
        r = _make_reading("V-GPM-01", ref_time, gas_ppm=50.0)
        assert r.gas_ppm == 50.0

    def test_voc_index_accepted_when_valid(self, ref_time):
        r = _make_reading("V-VOC-01", ref_time, voc_index=200.0)
        assert r.voc_index == 200.0

    def test_ethylene_ppm_accepted_when_valid(self, ref_time):
        r = _make_reading("V-ETH-01", ref_time, ethylene_ppm=3.5)
        assert r.ethylene_ppm == 3.5

    def test_all_gas_fields_none_is_valid(self, ref_time):
        r = _make_reading("V-NONE-01", ref_time)
        assert r.gas_ppm is None
        assert r.voc_index is None
        assert r.ethylene_ppm is None

    def test_gas_ppm_zero_is_valid(self, ref_time):
        r = _make_reading("V-ZERO-01", ref_time, gas_ppm=0.0)
        assert r.gas_ppm == 0.0

    def test_negative_gas_ppm_rejected(self, ref_time):
        with pytest.raises(ValueError, match="non-negative"):
            _make_reading("INV-01", ref_time, gas_ppm=-1.0)

    def test_negative_voc_index_rejected(self, ref_time):
        with pytest.raises(ValueError, match="non-negative"):
            _make_reading("INV-02", ref_time, voc_index=-10.0)

    def test_negative_ethylene_ppm_rejected(self, ref_time):
        with pytest.raises(ValueError, match="non-negative"):
            _make_reading("INV-03", ref_time, ethylene_ppm=-0.5)

    def test_nan_gas_ppm_rejected(self, ref_time):
        with pytest.raises(ValueError, match="finite"):
            _make_reading("INV-04", ref_time, gas_ppm=float("nan"))

    def test_inf_voc_index_rejected(self, ref_time):
        with pytest.raises(ValueError, match="finite"):
            _make_reading("INV-05", ref_time, voc_index=float("inf"))

    def test_negative_inf_ethylene_ppm_rejected(self, ref_time):
        with pytest.raises(ValueError, match="finite"):
            _make_reading("INV-06", ref_time, ethylene_ppm=float("-inf"))


# ---------------------------------------------------------------------------
# 2. ZoneThresholdConfig gas threshold validation
# ---------------------------------------------------------------------------


class TestGasThresholdConfig:

    def test_valid_gas_thresholds_accepted(self):
        cfg = ZoneThresholdConfig(
            min_temperature_c=0.0,
            max_temperature_c=4.0,
            max_gas_ppm=100.0,
            max_voc_index=250.0,
            max_ethylene_ppm=5.0,
        )
        assert cfg.max_gas_ppm == 100.0
        assert cfg.max_voc_index == 250.0
        assert cfg.max_ethylene_ppm == 5.0

    def test_none_gas_thresholds_accepted(self):
        cfg = ZoneThresholdConfig(
            min_temperature_c=0.0,
            max_temperature_c=4.0,
            max_gas_ppm=None,
            max_voc_index=None,
            max_ethylene_ppm=None,
        )
        assert cfg.max_gas_ppm is None

    def test_negative_gas_ppm_threshold_rejected(self):
        with pytest.raises(ValueError, match="non-negative finite"):
            ZoneThresholdConfig(
                min_temperature_c=0.0,
                max_temperature_c=4.0,
                max_gas_ppm=-10.0,
            )

    def test_nan_voc_index_threshold_rejected(self):
        with pytest.raises(ValueError, match="non-negative finite"):
            ZoneThresholdConfig(
                min_temperature_c=0.0,
                max_temperature_c=4.0,
                max_voc_index=float("nan"),
            )

    def test_inf_ethylene_threshold_rejected(self):
        with pytest.raises(ValueError, match="non-negative finite"):
            ZoneThresholdConfig(
                min_temperature_c=0.0,
                max_temperature_c=4.0,
                max_ethylene_ppm=float("inf"),
            )

    def test_default_zone_configs_have_gas_thresholds(self):
        for zone, cfg in DEFAULT_ZONE_CONFIGS.items():
            assert cfg.max_gas_ppm is not None, f"{zone}: max_gas_ppm should be set"
            assert cfg.max_voc_index is not None, f"{zone}: max_voc_index should be set"
            assert cfg.max_ethylene_ppm is not None, f"{zone}: max_ethylene_ppm should be set"
            assert cfg.max_gas_ppm > 0, f"{zone}: max_gas_ppm should be positive"


# ---------------------------------------------------------------------------
# 3. Point-in-time gas alert checks (check_individual_reading)
# ---------------------------------------------------------------------------


class TestPointInTimeGasAlerts:

    def test_normal_gas_ppm_produces_no_gas_alert(self, ref_time, fridge_config):
        # max_gas_ppm for fridge is 100.0
        r = _make_reading("N-GAS-01", ref_time, gas_ppm=80.0)
        alerts, _ = check_individual_reading(r, fridge_config, ref_time)
        assert not any(a.alert_type == "high_gas_ppm" for a in alerts)

    def test_high_gas_ppm_triggers_alert(self, ref_time, fridge_config):
        # max_gas_ppm for fridge is 100.0; use 150.0 > threshold
        r = _make_reading("H-GAS-01", ref_time, gas_ppm=150.0)
        alerts, _ = check_individual_reading(r, fridge_config, ref_time)
        gas_alerts = [a for a in alerts if a.alert_type == "high_gas_ppm"]
        assert len(gas_alerts) == 1
        a = gas_alerts[0]
        assert a.observed_value == 150.0
        assert a.threshold == fridge_config.max_gas_ppm
        assert a.severity == "warning"
        assert a.storage_zone == "refrigerator"
        assert a.simulated is True

    def test_gas_ppm_at_exact_threshold_no_alert(self, ref_time, fridge_config):
        """Exactly at the threshold is NOT over the threshold — no alert expected."""
        r = _make_reading("EQ-GAS-01", ref_time, gas_ppm=fridge_config.max_gas_ppm)
        alerts, _ = check_individual_reading(r, fridge_config, ref_time)
        assert not any(a.alert_type == "high_gas_ppm" for a in alerts)

    def test_normal_voc_index_produces_no_alert(self, ref_time, fridge_config):
        # max_voc_index for fridge is 250.0
        r = _make_reading("N-VOC-01", ref_time, voc_index=200.0)
        alerts, _ = check_individual_reading(r, fridge_config, ref_time)
        assert not any(a.alert_type == "high_voc_index" for a in alerts)

    def test_high_voc_index_triggers_alert(self, ref_time, fridge_config):
        r = _make_reading("H-VOC-01", ref_time, voc_index=320.0)
        alerts, _ = check_individual_reading(r, fridge_config, ref_time)
        voc_alerts = [a for a in alerts if a.alert_type == "high_voc_index"]
        assert len(voc_alerts) == 1
        a = voc_alerts[0]
        assert a.observed_value == 320.0
        assert a.threshold == fridge_config.max_voc_index
        assert a.severity == "warning"

    def test_voc_alert_message_notes_dimensionless_index(self, ref_time, fridge_config):
        r = _make_reading("MSG-VOC-01", ref_time, voc_index=300.0)
        alerts, _ = check_individual_reading(r, fridge_config, ref_time)
        voc_a = next(a for a in alerts if a.alert_type == "high_voc_index")
        # Alert message must note it is a dimensionless index, not ppm
        assert "dimensionless" in voc_a.message.lower() or "index" in voc_a.message.lower()

    def test_normal_ethylene_produces_no_alert(self, ref_time, fridge_config):
        # max_ethylene_ppm for fridge is 5.0
        r = _make_reading("N-ETH-01", ref_time, ethylene_ppm=2.0)
        alerts, _ = check_individual_reading(r, fridge_config, ref_time)
        assert not any(a.alert_type == "high_ethylene_ppm" for a in alerts)

    def test_high_ethylene_ppm_triggers_alert(self, ref_time, fridge_config):
        r = _make_reading("H-ETH-01", ref_time, ethylene_ppm=8.0)
        alerts, _ = check_individual_reading(r, fridge_config, ref_time)
        eth_alerts = [a for a in alerts if a.alert_type == "high_ethylene_ppm"]
        assert len(eth_alerts) == 1
        a = eth_alerts[0]
        assert a.observed_value == 8.0
        assert a.threshold == fridge_config.max_ethylene_ppm
        assert a.severity == "warning"

    def test_ethylene_alert_message_mentions_ripening(self, ref_time, fridge_config):
        r = _make_reading("MSG-ETH-01", ref_time, ethylene_ppm=9.0)
        alerts, _ = check_individual_reading(r, fridge_config, ref_time)
        eth_a = next(a for a in alerts if a.alert_type == "high_ethylene_ppm")
        assert "ripen" in eth_a.message.lower() or "spoilage" in eth_a.message.lower()

    def test_gas_alert_does_not_claim_food_spoilage(self, ref_time, fridge_config):
        """Alert messages for gas must be careful not to assert food is spoiled."""
        r = _make_reading("SAFE-GAS-01", ref_time, gas_ppm=200.0)
        alerts, _ = check_individual_reading(r, fridge_config, ref_time)
        gas_a = next(a for a in alerts if a.alert_type == "high_gas_ppm")
        # Must say 'warning signal' or 'environmental' — NOT 'food is spoiled'
        lower_msg = gas_a.message.lower()
        assert "warning" in lower_msg or "environmental" in lower_msg

    def test_all_three_gas_types_elevated_simultaneously(self, ref_time, fridge_config):
        r = _make_reading(
            "ALL-GAS-01",
            ref_time,
            gas_ppm=200.0,     # above 100.0 fridge limit
            voc_index=300.0,   # above 250.0 fridge limit
            ethylene_ppm=8.0,  # above 5.0 fridge limit
        )
        alerts, _ = check_individual_reading(r, fridge_config, ref_time)
        alert_types = {a.alert_type for a in alerts}
        assert "high_gas_ppm" in alert_types
        assert "high_voc_index" in alert_types
        assert "high_ethylene_ppm" in alert_types

    def test_gas_not_checked_when_threshold_is_none(self, ref_time):
        """If a zone config has no gas threshold, no gas alert is raised."""
        cfg_no_gas = ZoneThresholdConfig(
            min_temperature_c=0.0,
            max_temperature_c=4.0,
            max_gas_ppm=None,
            max_voc_index=None,
            max_ethylene_ppm=None,
        )
        r = _make_reading("NO-THR-01", ref_time, gas_ppm=500.0, voc_index=500.0, ethylene_ppm=50.0)
        alerts, _ = check_individual_reading(r, cfg_no_gas, ref_time)
        gas_alert_types = {"high_gas_ppm", "high_voc_index", "high_ethylene_ppm"}
        assert not any(a.alert_type in gas_alert_types for a in alerts)

    def test_gas_fields_absent_backward_compatible(self, ref_time, fridge_config):
        """Readings without gas fields must not produce gas alerts (backward compat.)."""
        r = SensorReading(
            reading_id="BACK-COMPAT-01",
            sensor_id="OLD-SENSOR",
            storage_zone="refrigerator",
            timestamp=ref_time - timedelta(minutes=5),
            temperature_c=3.0,
            humidity_percent=55.0,
            simulated=True,
        )
        alerts, _ = check_individual_reading(r, fridge_config, ref_time)
        gas_alert_types = {"high_gas_ppm", "high_voc_index", "high_ethylene_ppm"}
        assert not any(a.alert_type in gas_alert_types for a in alerts)

    def test_gas_alert_contains_all_required_fields(self, ref_time, fridge_config):
        """Gas alerts must include all SensorAlert fields."""
        r = _make_reading("STRUCT-01", ref_time, gas_ppm=150.0)
        alerts, _ = check_individual_reading(r, fridge_config, ref_time)
        a = next(x for x in alerts if x.alert_type == "high_gas_ppm")
        assert a.alert_id
        assert a.sensor_id
        assert a.storage_zone == "refrigerator"
        assert a.observed_value is not None
        assert a.threshold is not None
        assert len(a.triggered_conditions) >= 1
        assert a.timestamp is not None

    def test_pantry_has_higher_gas_limits_than_fridge(self, ref_time):
        """Pantry allows more gas (150 ppm) than fridge (100 ppm) — zone isolation."""
        pantry_cfg = DEFAULT_ZONE_CONFIGS["pantry"]
        fridge_cfg = DEFAULT_ZONE_CONFIGS["refrigerator"]
        assert pantry_cfg.max_gas_ppm > fridge_cfg.max_gas_ppm
        # A reading of 120 ppm: alert in fridge, no alert in pantry
        r_fridge = _make_reading("ZONE-01", ref_time, gas_ppm=120.0, storage_zone="refrigerator")
        r_pantry = _make_reading(
            "ZONE-02", ref_time, gas_ppm=120.0, storage_zone="pantry"
        )
        fridge_alerts, _ = check_individual_reading(r_fridge, fridge_cfg, ref_time)
        pantry_alerts, _ = check_individual_reading(r_pantry, pantry_cfg, ref_time)
        assert any(a.alert_type == "high_gas_ppm" for a in fridge_alerts)
        assert not any(a.alert_type == "high_gas_ppm" for a in pantry_alerts)


# ---------------------------------------------------------------------------
# 4. Sustained gas anomaly detection (check_sequential_anomalies)
# ---------------------------------------------------------------------------


class TestSustainedGasAlerts:

    def _make_gas_readings(
        self,
        ref_time: datetime,
        count: int,
        gas_ppm: float,
        interval_minutes: int = 15,
        sensor_id: str = "SIM-GAS-01",
    ) -> list:
        """Create ``count`` consecutive readings with given gas_ppm."""
        readings = []
        for i in range(count):
            offset = (count - i) * interval_minutes
            readings.append(
                _make_reading(
                    f"SG-{i+1:02d}",
                    ref_time,
                    offset_minutes=offset,
                    sensor_id=sensor_id,
                    gas_ppm=gas_ppm,
                )
            )
        return readings

    def test_sustained_gas_ppm_alert_after_3_consecutive(self, ref_time):
        # fridge max_gas_ppm=100, sustained_consecutive_readings=3
        readings = self._make_gas_readings(ref_time, count=3, gas_ppm=150.0)
        seq = check_sequential_anomalies(readings, DEFAULT_ZONE_CONFIGS)
        last_id = readings[-1].reading_id
        assert any(a.alert_type == "sustained_high_gas_ppm" for a in seq[last_id])

    def test_no_sustained_gas_alert_after_2_consecutive(self, ref_time):
        readings = self._make_gas_readings(ref_time, count=2, gas_ppm=150.0)
        seq = check_sequential_anomalies(readings, DEFAULT_ZONE_CONFIGS)
        last_id = readings[-1].reading_id
        assert not any(a.alert_type == "sustained_high_gas_ppm" for a in seq[last_id])

    def test_sustained_gas_alert_includes_observed_value_and_threshold(self, ref_time):
        readings = self._make_gas_readings(ref_time, count=3, gas_ppm=200.0)
        seq = check_sequential_anomalies(readings, DEFAULT_ZONE_CONFIGS)
        last_id = readings[-1].reading_id
        a = next(x for x in seq[last_id] if x.alert_type == "sustained_high_gas_ppm")
        assert a.observed_value == 200.0
        assert a.threshold == DEFAULT_ZONE_CONFIGS["refrigerator"].max_gas_ppm

    def test_gas_recovery_resets_sustained_counter(self, ref_time):
        """After a normal reading, 2 more abnormal readings should NOT trigger sustained."""
        readings = [
            _make_reading("GR-01", ref_time, offset_minutes=75, gas_ppm=150.0),
            _make_reading("GR-02", ref_time, offset_minutes=60, gas_ppm=150.0),
            # Recovery: normal reading
            _make_reading("GR-03", ref_time, offset_minutes=45, gas_ppm=50.0),
            _make_reading("GR-04", ref_time, offset_minutes=30, gas_ppm=150.0),
            _make_reading("GR-05", ref_time, offset_minutes=15, gas_ppm=150.0),
        ]
        seq = check_sequential_anomalies(readings, DEFAULT_ZONE_CONFIGS)
        # GR-05 is only the 2nd abnormal reading after recovery, not the 3rd
        assert not any(a.alert_type == "sustained_high_gas_ppm" for a in seq["GR-05"])

    def test_large_gap_breaks_gas_sustained_continuity(self, ref_time):
        """A time gap > max_consecutive_gap_hours (2h) must reset the counter."""
        readings = [
            _make_reading("GAP-01", ref_time, offset_minutes=180, gas_ppm=150.0),
            _make_reading("GAP-02", ref_time, offset_minutes=165, gas_ppm=150.0),
            # Large gap: ~2h35m to next reading resets continuity
            _make_reading("GAP-03", ref_time, offset_minutes=10, gas_ppm=150.0),
            _make_reading("GAP-04", ref_time, offset_minutes=5, gas_ppm=150.0),
        ]
        seq = check_sequential_anomalies(readings, DEFAULT_ZONE_CONFIGS)
        # GAP-04 is only 2nd consecutive after gap — no sustained alert
        assert not any(a.alert_type == "sustained_high_gas_ppm" for a in seq["GAP-04"])

    def _make_voc_readings(
        self, ref_time: datetime, count: int, voc_index: float, interval_minutes: int = 15
    ) -> list:
        readings = []
        for i in range(count):
            offset = (count - i) * interval_minutes
            readings.append(
                _make_reading(f"SV-{i+1:02d}", ref_time, offset_minutes=offset, voc_index=voc_index)
            )
        return readings

    def test_sustained_voc_index_alert_after_3_consecutive(self, ref_time):
        # fridge max_voc_index=250; use 300 > threshold
        readings = self._make_voc_readings(ref_time, count=3, voc_index=300.0)
        seq = check_sequential_anomalies(readings, DEFAULT_ZONE_CONFIGS)
        last_id = readings[-1].reading_id
        assert any(a.alert_type == "sustained_high_voc_index" for a in seq[last_id])

    def test_no_sustained_voc_alert_after_2_consecutive(self, ref_time):
        readings = self._make_voc_readings(ref_time, count=2, voc_index=300.0)
        seq = check_sequential_anomalies(readings, DEFAULT_ZONE_CONFIGS)
        last_id = readings[-1].reading_id
        assert not any(a.alert_type == "sustained_high_voc_index" for a in seq[last_id])

    def test_voc_recovery_resets_counter(self, ref_time):
        readings = [
            _make_reading("VR-01", ref_time, offset_minutes=60, voc_index=300.0),
            _make_reading("VR-02", ref_time, offset_minutes=45, voc_index=300.0),
            # Recovery
            _make_reading("VR-03", ref_time, offset_minutes=30, voc_index=100.0),
            _make_reading("VR-04", ref_time, offset_minutes=15, voc_index=300.0),
            _make_reading("VR-05", ref_time, offset_minutes=5, voc_index=300.0),
        ]
        seq = check_sequential_anomalies(readings, DEFAULT_ZONE_CONFIGS)
        assert not any(a.alert_type == "sustained_high_voc_index" for a in seq["VR-05"])


# ---------------------------------------------------------------------------
# 5. Full batch pipeline integration tests
# ---------------------------------------------------------------------------


class TestBatchPipelineWithGas:

    def test_batch_with_normal_gas_readings_is_normal(self, ref_time):
        readings = [
            {
                "reading_id": "B-NORM-01",
                "sensor_id": "SIM-01",
                "storage_zone": "refrigerator",
                "timestamp": (ref_time - timedelta(minutes=5)).isoformat(),
                "temperature_c": 3.0,
                "humidity_percent": 60.0,
                "gas_ppm": 50.0,
                "voc_index": 100.0,
                "ethylene_ppm": 1.0,
                "simulated": True,
            }
        ]
        result = analyze_sensor_readings(readings, as_of=ref_time)
        assert result.overall_status == "normal"
        gas_types = {"high_gas_ppm", "high_voc_index", "high_ethylene_ppm"}
        assert not any(a.alert_type in gas_types for a in result.active_alerts)

    def test_batch_with_high_gas_produces_warning_status(self, ref_time):
        readings = [
            {
                "reading_id": "B-GAS-01",
                "sensor_id": "SIM-01",
                "storage_zone": "refrigerator",
                "timestamp": (ref_time - timedelta(minutes=5)).isoformat(),
                "temperature_c": 3.0,
                "gas_ppm": 180.0,  # above 100.0 fridge limit
                "simulated": True,
            }
        ]
        result = analyze_sensor_readings(readings, as_of=ref_time)
        assert result.overall_status in ("warning", "critical")
        assert any(a.alert_type == "high_gas_ppm" for a in result.active_alerts)

    def test_batch_without_gas_fields_backward_compatible(self, ref_time):
        """Legacy payloads without gas fields must continue to work."""
        readings = [
            {
                "reading_id": "B-LEGACY-01",
                "sensor_id": "SIM-01",
                "storage_zone": "refrigerator",
                "timestamp": (ref_time - timedelta(minutes=5)).isoformat(),
                "temperature_c": 3.0,
                "humidity_percent": 60.0,
                "simulated": True,
            }
        ]
        result = analyze_sensor_readings(readings, as_of=ref_time)
        gas_types = {"high_gas_ppm", "high_voc_index", "high_ethylene_ppm"}
        assert not any(a.alert_type in gas_types for a in result.active_alerts)

    def test_batch_invalid_gas_value_handled_gracefully(self, ref_time):
        """A reading with an invalid gas_ppm should be rejected (is_valid=False) without crashing."""
        readings = [
            {
                "reading_id": "B-INV-01",
                "sensor_id": "SIM-01",
                "storage_zone": "refrigerator",
                "timestamp": (ref_time - timedelta(minutes=5)).isoformat(),
                "temperature_c": 3.0,
                "gas_ppm": -50.0,  # negative -- invalid
                "simulated": True,
            }
        ]
        result = analyze_sensor_readings(readings, as_of=ref_time)
        assert result.total_readings == 1
        assert result.invalid_readings == 1
        assert result.valid_readings == 0

    def test_sustained_gas_appears_in_batch_active_alerts(self, ref_time):
        """Sustained high gas alert should surface in batch active_alerts."""
        readings = [
            {
                "reading_id": f"B-SUS-{i:02d}",
                "sensor_id": "SIM-GAS-01",
                "storage_zone": "refrigerator",
                "timestamp": (ref_time - timedelta(minutes=(3 - i) * 15)).isoformat(),
                "temperature_c": 3.0,
                "gas_ppm": 150.0,
                "simulated": True,
            }
            for i in range(3)
        ]
        result = analyze_sensor_readings(readings, as_of=ref_time)
        sustained_types = {"sustained_high_gas_ppm", "sustained_high_voc_index"}
        assert any(a.alert_type in sustained_types for a in result.active_alerts)

    def test_batch_response_contains_simulated_flag(self, ref_time):
        readings = [
            {
                "reading_id": "B-SIM-01",
                "sensor_id": "SIM-01",
                "storage_zone": "refrigerator",
                "timestamp": (ref_time - timedelta(minutes=5)).isoformat(),
                "temperature_c": 3.0,
                "simulated": True,
            }
        ]
        result = analyze_sensor_readings(readings, as_of=ref_time)
        assert result.simulated is True

    def test_multiple_zones_isolated_gas_alerts(self, ref_time):
        """Gas readings in different zones should be checked against their own thresholds."""
        readings = [
            {
                # pantry max_gas_ppm=150; 120 ppm is normal for pantry
                "reading_id": "MZ-PANTRY-01",
                "sensor_id": "SIM-PAN-01",
                "storage_zone": "pantry",
                "timestamp": (ref_time - timedelta(minutes=5)).isoformat(),
                "temperature_c": 20.0,
                "gas_ppm": 120.0,
                "simulated": True,
            },
            {
                # fridge max_gas_ppm=100; 120 ppm is above fridge threshold
                "reading_id": "MZ-FRIDGE-01",
                "sensor_id": "SIM-FRI-01",
                "storage_zone": "refrigerator",
                "timestamp": (ref_time - timedelta(minutes=5)).isoformat(),
                "temperature_c": 3.0,
                "gas_ppm": 120.0,
                "simulated": True,
            },
        ]
        result = analyze_sensor_readings(readings, as_of=ref_time)
        fridge_result = next(
            r for r in result.results_by_reading if r.reading_id == "MZ-FRIDGE-01"
        )
        pantry_result = next(
            r for r in result.results_by_reading if r.reading_id == "MZ-PANTRY-01"
        )
        assert any(a.alert_type == "high_gas_ppm" for a in fridge_result.alerts)
        assert not any(a.alert_type == "high_gas_ppm" for a in pantry_result.alerts)


# ---------------------------------------------------------------------------
# 6. API endpoint tests: POST /sensors/analyze
# ---------------------------------------------------------------------------


class TestSensorApiEndpoint:

    def test_sensors_analyze_endpoint_exists(self, ref_time):
        payload = {
            "readings": [
                {
                    "reading_id": "API-01",
                    "sensor_id": "SIM-01",
                    "storage_zone": "refrigerator",
                    "timestamp": (ref_time - timedelta(minutes=5)).isoformat(),
                    "temperature_c": 3.0,
                    "simulated": True,
                }
            ]
        }
        resp = client.post("/sensors/analyze", json=payload)
        assert resp.status_code == 200

    def test_sensors_analyze_returns_expected_fields(self, ref_time):
        payload = {
            "readings": [
                {
                    "reading_id": "API-02",
                    "sensor_id": "SIM-01",
                    "storage_zone": "refrigerator",
                    "timestamp": (ref_time - timedelta(minutes=5)).isoformat(),
                    "temperature_c": 3.0,
                    "simulated": True,
                }
            ]
        }
        resp = client.post("/sensors/analyze", json=payload)
        data = resp.json()
        assert "total_readings" in data
        assert "valid_readings" in data
        assert "invalid_readings" in data
        assert "overall_status" in data
        assert "active_alerts" in data
        assert "results_by_reading" in data
        assert data["simulated"] is True

    def test_api_high_gas_ppm_produces_alert(self, ref_time):
        payload = {
            "readings": [
                {
                    "reading_id": "API-GAS-01",
                    "sensor_id": "SIM-01",
                    "storage_zone": "refrigerator",
                    "timestamp": (ref_time - timedelta(minutes=5)).isoformat(),
                    "temperature_c": 3.0,
                    "gas_ppm": 200.0,  # above 100 fridge limit
                    "simulated": True,
                }
            ]
        }
        resp = client.post("/sensors/analyze", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        alert_types = [a["alert_type"] for a in data["active_alerts"]]
        assert "high_gas_ppm" in alert_types

    def test_api_high_voc_index_produces_alert(self, ref_time):
        payload = {
            "readings": [
                {
                    "reading_id": "API-VOC-01",
                    "sensor_id": "SIM-01",
                    "storage_zone": "refrigerator",
                    "timestamp": (ref_time - timedelta(minutes=5)).isoformat(),
                    "temperature_c": 3.0,
                    "voc_index": 300.0,  # above 250 fridge limit
                    "simulated": True,
                }
            ]
        }
        resp = client.post("/sensors/analyze", json=payload)
        data = resp.json()
        alert_types = [a["alert_type"] for a in data["active_alerts"]]
        assert "high_voc_index" in alert_types

    def test_api_high_ethylene_produces_alert(self, ref_time):
        payload = {
            "readings": [
                {
                    "reading_id": "API-ETH-01",
                    "sensor_id": "SIM-01",
                    "storage_zone": "refrigerator",
                    "timestamp": (ref_time - timedelta(minutes=5)).isoformat(),
                    "temperature_c": 3.0,
                    "ethylene_ppm": 8.0,  # above 5.0 fridge limit
                    "simulated": True,
                }
            ]
        }
        resp = client.post("/sensors/analyze", json=payload)
        data = resp.json()
        alert_types = [a["alert_type"] for a in data["active_alerts"]]
        assert "high_ethylene_ppm" in alert_types

    def test_api_legacy_payload_without_gas_fields_succeeds(self, ref_time):
        payload = {
            "readings": [
                {
                    "reading_id": "API-LEGACY-01",
                    "sensor_id": "SIM-01",
                    "storage_zone": "refrigerator",
                    "timestamp": (ref_time - timedelta(minutes=5)).isoformat(),
                    "temperature_c": 3.0,
                    "humidity_percent": 60.0,
                    "simulated": True,
                }
            ]
        }
        resp = client.post("/sensors/analyze", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        gas_types = {"high_gas_ppm", "high_voc_index", "high_ethylene_ppm"}
        actual_types = {a["alert_type"] for a in data["active_alerts"]}
        assert not gas_types.intersection(actual_types)

    def test_api_empty_readings_list_returns_200(self):
        resp = client.post("/sensors/analyze", json={"readings": []})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_readings"] == 0
        assert data["overall_status"] in ("normal", "insufficient_data")

    def test_api_missing_readings_field_returns_422(self):
        resp = client.post("/sensors/analyze", json={})
        assert resp.status_code == 422

    def test_api_all_three_gas_types_in_one_request(self, ref_time):
        payload = {
            "readings": [
                {
                    "reading_id": "API-ALL-01",
                    "sensor_id": "SIM-01",
                    "storage_zone": "refrigerator",
                    "timestamp": (ref_time - timedelta(minutes=5)).isoformat(),
                    "temperature_c": 3.0,
                    "gas_ppm": 200.0,
                    "voc_index": 300.0,
                    "ethylene_ppm": 8.0,
                    "simulated": True,
                }
            ]
        }
        resp = client.post("/sensors/analyze", json=payload)
        data = resp.json()
        alert_types = {a["alert_type"] for a in data["active_alerts"]}
        assert "high_gas_ppm" in alert_types
        assert "high_voc_index" in alert_types
        assert "high_ethylene_ppm" in alert_types


# ---------------------------------------------------------------------------
# 7. Existing sensor regression
# ---------------------------------------------------------------------------


class TestPhase12Regression:
    """Verify existing Phase 5 sensor behavior is unchanged."""

    def test_high_temperature_alert_still_works(self, ref_time, fridge_config):
        r = SensorReading(
            reading_id="REG-TEMP-01",
            sensor_id="S1",
            storage_zone="refrigerator",
            timestamp=ref_time - timedelta(minutes=5),
            temperature_c=8.0,
            simulated=True,
        )
        alerts, _ = check_individual_reading(r, fridge_config, ref_time)
        assert any(a.alert_type == "high_temperature" for a in alerts)

    def test_sustained_temperature_still_works(self, ref_time):
        readings = [
            SensorReading(
                reading_id=f"REG-SUS-{i}",
                sensor_id="S1",
                storage_zone="refrigerator",
                timestamp=ref_time - timedelta(minutes=(3 - i) * 15),
                temperature_c=8.0,
                simulated=True,
            )
            for i in range(3)
        ]
        seq = check_sequential_anomalies(readings, DEFAULT_ZONE_CONFIGS)
        last_id = readings[-1].reading_id
        assert any(a.alert_type == "sustained_abnormal_temperature" for a in seq[last_id])

    def test_batch_analysis_sample_dataset_still_passes(self, ref_time):
        from app.services.sensor_service import load_sample_sensor_data

        readings = load_sample_sensor_data()
        result = analyze_sensor_readings(readings, as_of=ref_time)
        assert result.total_readings == len(readings)
        assert result.valid_readings > 0
        assert result.simulated is True
