"""SaveBite Synthetic IoT Sensor Intelligence Service.

Phase 5: Rule-based analysis of synthetic IoT sensor telemetry for
grocery storage environments (refrigerator, freezer, pantry).

Detects:
  - Temperature limit excursions (high / low)
  - Humidity limit excursions (high / low)
  - Sudden temperature changes between consecutive readings
  - Sustained abnormal temperature conditions across consecutive readings
  - Persistent door-open events
  - Power interruptions
  - Stale readings
  - Missing, invalid, non-finite, and unknown zone data

IMPORTANT FOOD SAFETY & ARCHITECTURAL LIMITATION:
Abnormal sensor readings indicate an environmental anomaly in the storage zone;
they do NOT constitute empirical or biological proof that food has spoiled,
nor do they calculate scientifically validated shelf-life reduction multipliers.
All generated data is explicitly simulated (simulated=True).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import math
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple, Union

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Enums & Types
# ---------------------------------------------------------------------------

AlertSeverity = Literal["info", "warning", "critical"]

AlertType = Literal[
    "high_temperature",
    "low_temperature",
    "high_humidity",
    "low_humidity",
    "sudden_temperature_change",
    "sustained_abnormal_temperature",
    "door_open",
    "sustained_door_open",
    "power_interruption",
    "stale_reading",
    "high_gas_ppm",
    "sustained_high_gas_ppm",
    "high_voc_index",
    "sustained_high_voc_index",
    "high_ethylene_ppm",
    "unknown_storage_zone",
    "data_validation_error",
]

OverallStatus = Literal["normal", "warning", "critical", "insufficient_data"]


# ---------------------------------------------------------------------------
# Configuration Models
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ZoneThresholdConfig:
    """Configurable environmental thresholds for a specific storage zone.

    Attributes:
        min_temperature_c: Lower temperature bound in Celsius.
        max_temperature_c: Upper temperature bound in Celsius.
        min_humidity_percent: Minimum acceptable relative humidity (0–100%).
        max_humidity_percent: Maximum acceptable relative humidity (0–100%).
        sudden_temp_change_threshold_c: Max allowed temperature change between consecutive readings.
        sustained_consecutive_readings: Number of consecutive abnormal readings to trigger sustained alert.
        max_door_open_readings: Consecutive door_open=True readings before sustained door-open alert.
        power_cut_alert_hours: Threshold in hours above which power cuts trigger critical alerts.
        max_reading_age_hours: Threshold in hours beyond which a reading is considered stale.
        max_consecutive_gap_hours: Max allowed time gap between consecutive readings to consider continuity.
    """

    min_temperature_c: float
    max_temperature_c: float
    min_humidity_percent: Optional[float] = None
    max_humidity_percent: Optional[float] = None
    sudden_temp_change_threshold_c: float = 3.0
    sustained_consecutive_readings: int = 3
    max_door_open_readings: int = 2
    power_cut_alert_hours: float = 1.0
    max_reading_age_hours: float = 6.0
    max_consecutive_gap_hours: float = 2.0
    max_gas_ppm: Optional[float] = None
    max_voc_index: Optional[float] = None
    max_ethylene_ppm: Optional[float] = None

    def __post_init__(self) -> None:
        for attr in ("min_temperature_c", "max_temperature_c", "sudden_temp_change_threshold_c"):
            val = getattr(self, attr)
            if math.isnan(val) or math.isinf(val):
                raise ValueError(f"ZoneThresholdConfig.{attr} must be finite, got {val}")
        if self.min_temperature_c > self.max_temperature_c:
            raise ValueError(
                f"min_temperature_c ({self.min_temperature_c}) cannot exceed max_temperature_c ({self.max_temperature_c})"
            )
        if self.min_humidity_percent is not None and self.max_humidity_percent is not None:
            if self.min_humidity_percent > self.max_humidity_percent:
                raise ValueError(
                    f"min_humidity_percent ({self.min_humidity_percent}) cannot exceed max_humidity_percent ({self.max_humidity_percent})"
                )
        for gas_attr in ("max_gas_ppm", "max_voc_index", "max_ethylene_ppm"):
            val = getattr(self, gas_attr)
            if val is not None:
                if math.isnan(val) or math.isinf(val) or val < 0.0:
                    raise ValueError(f"ZoneThresholdConfig.{gas_attr} must be a non-negative finite number, got {val}")


# Centralized default storage-zone thresholds (illustrative development defaults)
DEFAULT_ZONE_CONFIGS: Dict[str, ZoneThresholdConfig] = {
    "refrigerator": ZoneThresholdConfig(
        min_temperature_c=0.0,
        max_temperature_c=4.0,
        min_humidity_percent=40.0,
        max_humidity_percent=85.0,
        sudden_temp_change_threshold_c=2.5,
        sustained_consecutive_readings=3,
        max_door_open_readings=2,
        power_cut_alert_hours=0.5,
        max_reading_age_hours=4.0,
        max_consecutive_gap_hours=2.0,
        max_gas_ppm=100.0,
        max_voc_index=250.0,
        max_ethylene_ppm=5.0,
    ),
    "freezer": ZoneThresholdConfig(
        min_temperature_c=-30.0,
        max_temperature_c=-18.0,
        min_humidity_percent=None,
        max_humidity_percent=90.0,
        sudden_temp_change_threshold_c=3.0,
        sustained_consecutive_readings=3,
        max_door_open_readings=2,
        power_cut_alert_hours=1.0,
        max_reading_age_hours=4.0,
        max_consecutive_gap_hours=2.0,
        max_gas_ppm=50.0,
        max_voc_index=150.0,
        max_ethylene_ppm=1.0,
    ),
    "pantry": ZoneThresholdConfig(
        min_temperature_c=10.0,
        max_temperature_c=25.0,
        min_humidity_percent=30.0,
        max_humidity_percent=65.0,
        sudden_temp_change_threshold_c=5.0,
        sustained_consecutive_readings=3,
        max_door_open_readings=3,
        power_cut_alert_hours=4.0,
        max_reading_age_hours=12.0,
        max_consecutive_gap_hours=3.0,
        max_gas_ppm=150.0,
        max_voc_index=300.0,
        max_ethylene_ppm=10.0,
    ),
}


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

class SensorReading(BaseModel):
    """Input contract for a single IoT sensor reading.

    Gas/VOC fields are optional and sensor-type-specific. They must NOT be used
    interchangeably; each field represents a distinct measurement modality:

    - ``gas_ppm``: Generic calibrated gas concentration in parts-per-million (ppm).
      Reported by multi-gas sensors (e.g. MQ-series, SGP30 in ppm-equivalent mode).
      Represents total VOC load or a specific gas, depending on sensor calibration.
      Threshold meaning depends on sensor calibration — document sensor model in
      production integrations.

    - ``voc_index``: A dimensionless index (0–500) reported by sensors such as the
      Sensirion SGP41 or SGP40. 0 = no VOC activity detected; higher values indicate
      increasing VOC load. This is NOT a ppm measurement and should not be compared
      to ppm thresholds.

    - ``ethylene_ppm``: Ethylene gas concentration in ppm (C2H4). Only set this
      field when a sensor explicitly measures and reports calibrated ethylene
      (e.g. a dedicated electrochemical ethylene sensor). Ethylene is a ripening
      hormone; elevated concentrations may accelerate spoilage of nearby produce.
      Do NOT estimate this from generic VOC sensors.

    IMPORTANT: Elevated gas readings are environmental warning signals. They do NOT
    constitute proof that food has spoiled or is unsafe to consume.
    """

    reading_id: str = Field(..., description="Unique reading identifier.")
    sensor_id: str = Field(..., description="Identifier of the sensor device.")
    storage_zone: str = Field(..., description="Storage zone (e.g. 'refrigerator', 'freezer', 'pantry').")
    timestamp: datetime = Field(..., description="ISO 8601 timestamp of the reading.")
    temperature_c: Optional[float] = Field(None, description="Observed temperature in Celsius.")
    humidity_percent: Optional[float] = Field(None, description="Relative humidity percentage [0, 100].")
    door_open: Optional[bool] = Field(None, description="Door state if monitored.")
    power_cut_hours: Optional[float] = Field(0.0, description="Duration of power interruption in hours.")
    # --------------- Gas / VOC sensor fields (Phase 12) ---------------
    gas_ppm: Optional[float] = Field(
        None,
        description=(
            "Generic gas/VOC concentration in parts-per-million (ppm). Reported by "
            "calibrated multi-gas or VOC sensors. Meaning depends on sensor calibration — "
            "document sensor model in production integrations. Must be >= 0."
        ),
    )
    voc_index: Optional[float] = Field(
        None,
        description=(
            "Dimensionless VOC index (typical range 0–500). Reported by sensors such as "
            "the Sensirion SGP41/SGP40. This is NOT a ppm measurement and is not comparable "
            "to gas_ppm values. Must be >= 0."
        ),
    )
    ethylene_ppm: Optional[float] = Field(
        None,
        description=(
            "Ethylene (C2H4) concentration in ppm, reported exclusively by dedicated "
            "ethylene-selective sensors. Do NOT populate from generic VOC sensors. "
            "Must be >= 0."
        ),
    )
    simulated: bool = Field(True, description="Must be true for synthetic data.")

    @field_validator("reading_id", "sensor_id", "storage_zone")
    @classmethod
    def validate_non_empty_strings(cls, v: str) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Field cannot be empty or whitespace-only.")
        return v.strip().lower() if cls.__name__ == "storage_zone" else v.strip()

    @field_validator("temperature_c")
    @classmethod
    def validate_temperature(cls, v: Optional[float]) -> Optional[float]:
        if v is not None:
            if not isinstance(v, (int, float)) or math.isnan(v) or math.isinf(v):
                raise ValueError(f"temperature_c must be a finite number, got {v}")
        return v

    @field_validator("humidity_percent")
    @classmethod
    def validate_humidity(cls, v: Optional[float]) -> Optional[float]:
        if v is not None:
            if not isinstance(v, (int, float)) or math.isnan(v) or math.isinf(v):
                raise ValueError(f"humidity_percent must be a finite number, got {v}")
            if not (0.0 <= v <= 100.0):
                raise ValueError(f"humidity_percent must be in range [0, 100], got {v}")
        return v

    @field_validator("power_cut_hours")
    @classmethod
    def validate_power_cut(cls, v: Optional[float]) -> Optional[float]:
        if v is not None:
            if not isinstance(v, (int, float)) or math.isnan(v) or math.isinf(v) or v < 0:
                raise ValueError(f"power_cut_hours must be a non-negative finite number, got {v}")
        return v

    @field_validator("gas_ppm", "voc_index", "ethylene_ppm")
    @classmethod
    def validate_gas_fields(cls, v: Optional[float]) -> Optional[float]:
        """Reject negative, NaN, and infinite gas readings."""
        if v is not None:
            if not isinstance(v, (int, float)) or math.isnan(v) or math.isinf(v):
                raise ValueError(f"Gas field must be a finite number, got {v}")
            if v < 0.0:
                raise ValueError(f"Gas field must be non-negative, got {v}")
        return v


class SensorAlert(BaseModel):
    """Structured notification for an anomalous condition or data issue."""

    alert_id: str = Field(..., description="Deterministic alert identifier.")
    sensor_id: str
    storage_zone: str
    alert_type: AlertType
    severity: AlertSeverity
    message: str
    observed_value: Optional[Union[float, str, bool]] = None
    threshold: Optional[Union[float, str, bool]] = None
    triggered_conditions: List[str]
    timestamp: datetime
    simulated: bool = True


class ReadingAnalysisResult(BaseModel):
    """Analysis result for an individual reading."""

    reading_id: str
    sensor_id: str
    storage_zone: str
    timestamp: datetime
    simulated: bool
    status: OverallStatus
    is_valid: bool
    validation_issues: List[str] = Field(default_factory=list)
    alerts: List[SensorAlert] = Field(default_factory=list)
    explanation: str


class SensorBatchAnalysisResponse(BaseModel):
    """Aggregated analysis response for a batch of sensor telemetry."""

    as_of: datetime
    total_readings: int
    valid_readings: int
    invalid_readings: int
    overall_status: OverallStatus
    active_alerts: List[SensorAlert]
    results_by_reading: List[ReadingAnalysisResult]
    simulated: bool = True
    caveat: str = (
        "Phase 5 synthetic sensor intelligence identifies environmental deviations using rule-based "
        "heuristics. It does not prove food spoilage and does not calculate empirical shelf-life reduction."
    )


# ---------------------------------------------------------------------------
# Core Analysis & Rule Implementation
# ---------------------------------------------------------------------------

def validate_raw_reading(raw_dict: Dict[str, Any]) -> Tuple[Optional[SensorReading], List[str]]:
    """Validate a raw dictionary against SensorReading schema, capturing errors safely.

    Returns:
        (validated_reading, list_of_validation_error_messages)
    """
    errors: List[str] = []
    if not isinstance(raw_dict, dict):
        return None, ["Record is not a valid dictionary/object."]

    # Check for required fields before pydantic parse to give clear messages
    for req in ("reading_id", "sensor_id", "storage_zone", "timestamp"):
        if req not in raw_dict or raw_dict[req] is None or (isinstance(raw_dict[req], str) and not raw_dict[req].strip()):
            errors.append(f"Missing or empty required field: '{req}'.")

    if errors:
        return None, errors

    try:
        # Normalize storage zone
        clean_dict = dict(raw_dict)
        if isinstance(clean_dict.get("storage_zone"), str):
            clean_dict["storage_zone"] = clean_dict["storage_zone"].strip().lower()

        reading = SensorReading(**clean_dict)
        return reading, []
    except Exception as exc:
        return None, [f"Validation error: {exc}"]


def check_individual_reading(
    reading: SensorReading,
    config: ZoneThresholdConfig,
    as_of: datetime,
) -> Tuple[List[SensorAlert], List[str]]:
    """Evaluate point-in-time checks on a single valid reading:
      - High / low temperature
      - High / low humidity
      - Door open
      - Power interruption
      - Stale reading

    Returns:
        (alerts, explanation_parts)
    """
    alerts: List[SensorAlert] = []
    explanations: List[str] = []
    rid = reading.reading_id
    sid = reading.sensor_id
    zone = reading.storage_zone
    ts = reading.timestamp

    # 1. Stale reading detection
    # Ensure timezone awareness
    reading_dt = ts if ts.tzinfo is not None else ts.replace(tzinfo=timezone.utc)
    as_of_dt = as_of if as_of.tzinfo is not None else as_of.replace(tzinfo=timezone.utc)
    age_seconds = (as_of_dt - reading_dt).total_seconds()
    age_hours = age_seconds / 3600.0

    if age_hours > config.max_reading_age_hours:
        alerts.append(
            SensorAlert(
                alert_id=f"ALT-{rid}-STALE",
                sensor_id=sid,
                storage_zone=zone,
                alert_type="stale_reading",
                severity="warning",
                message=f"Reading is stale ({age_hours:.1f} hours old, max allowed {config.max_reading_age_hours:.1f}h).",
                observed_value=round(age_hours, 2),
                threshold=config.max_reading_age_hours,
                triggered_conditions=[
                    f"Observed reading age {age_hours:.1f}h exceeds threshold of {config.max_reading_age_hours:.1f}h."
                ],
                timestamp=ts,
                simulated=reading.simulated,
            )
        )
        explanations.append(f"Reading is stale by {age_hours:.1f} hours.")

    # 2. Temperature checks
    if reading.temperature_c is not None:
        t = reading.temperature_c
        if t > config.max_temperature_c:
            alerts.append(
                SensorAlert(
                    alert_id=f"ALT-{rid}-TEMP-HIGH",
                    sensor_id=sid,
                    storage_zone=zone,
                    alert_type="high_temperature",
                    severity="warning",
                    message=f"Observed temperature ({t:.1f}°C) exceeded configured maximum ({config.max_temperature_c:.1f}°C).",
                    observed_value=t,
                    threshold=config.max_temperature_c,
                    triggered_conditions=[
                        f"Temperature {t:.1f}°C is above maximum limit of {config.max_temperature_c:.1f}°C for zone '{zone}'."
                    ],
                    timestamp=ts,
                    simulated=reading.simulated,
                )
            )
            explanations.append(f"Temperature high ({t:.1f}°C > {config.max_temperature_c:.1f}°C).")
        elif t < config.min_temperature_c:
            alerts.append(
                SensorAlert(
                    alert_id=f"ALT-{rid}-TEMP-LOW",
                    sensor_id=sid,
                    storage_zone=zone,
                    alert_type="low_temperature",
                    severity="warning",
                    message=f"Observed temperature ({t:.1f}°C) fell below configured minimum ({config.min_temperature_c:.1f}°C).",
                    observed_value=t,
                    threshold=config.min_temperature_c,
                    triggered_conditions=[
                        f"Temperature {t:.1f}°C is below minimum limit of {config.min_temperature_c:.1f}°C for zone '{zone}'."
                    ],
                    timestamp=ts,
                    simulated=reading.simulated,
                )
            )
            explanations.append(f"Temperature low ({t:.1f}°C < {config.min_temperature_c:.1f}°C).")

    # 3. Humidity checks
    if reading.humidity_percent is not None:
        h = reading.humidity_percent
        if config.max_humidity_percent is not None and h > config.max_humidity_percent:
            alerts.append(
                SensorAlert(
                    alert_id=f"ALT-{rid}-HUM-HIGH",
                    sensor_id=sid,
                    storage_zone=zone,
                    alert_type="high_humidity",
                    severity="warning",
                    message=f"Observed humidity ({h:.1f}%) exceeded configured maximum ({config.max_humidity_percent:.1f}%).",
                    observed_value=h,
                    threshold=config.max_humidity_percent,
                    triggered_conditions=[
                        f"Relative humidity {h:.1f}% exceeds limit of {config.max_humidity_percent:.1f}% for zone '{zone}'."
                    ],
                    timestamp=ts,
                    simulated=reading.simulated,
                )
            )
            explanations.append(f"Humidity high ({h:.1f}% > {config.max_humidity_percent:.1f}%).")
        elif config.min_humidity_percent is not None and h < config.min_humidity_percent:
            alerts.append(
                SensorAlert(
                    alert_id=f"ALT-{rid}-HUM-LOW",
                    sensor_id=sid,
                    storage_zone=zone,
                    alert_type="low_humidity",
                    severity="info",
                    message=f"Observed humidity ({h:.1f}%) fell below configured minimum ({config.min_humidity_percent:.1f}%).",
                    observed_value=h,
                    threshold=config.min_humidity_percent,
                    triggered_conditions=[
                        f"Relative humidity {h:.1f}% is below limit of {config.min_humidity_percent:.1f}% for zone '{zone}'."
                    ],
                    timestamp=ts,
                    simulated=reading.simulated,
                )
            )
            explanations.append(f"Humidity low ({h:.1f}% < {config.min_humidity_percent:.1f}%).")

    # 4. Door-open event
    if reading.door_open is True:
        alerts.append(
            SensorAlert(
                alert_id=f"ALT-{rid}-DOOR-OPEN",
                sensor_id=sid,
                storage_zone=zone,
                alert_type="door_open",
                severity="info",
                message=f"Storage zone door is open.",
                observed_value=True,
                threshold=False,
                triggered_conditions=[f"Door status is open for sensor '{sid}' in zone '{zone}'."],
                timestamp=ts,
                simulated=reading.simulated,
            )
        )
        explanations.append("Door open reported.")

    # 5. Power interruption
    if reading.power_cut_hours is not None and reading.power_cut_hours > 0:
        p = reading.power_cut_hours
        severity: AlertSeverity = "critical" if p >= config.power_cut_alert_hours else "warning"
        alerts.append(
            SensorAlert(
                alert_id=f"ALT-{rid}-POWER-CUT",
                sensor_id=sid,
                storage_zone=zone,
                alert_type="power_interruption",
                severity=severity,
                message=f"Power interruption of {p:.2f} hours detected.",
                observed_value=p,
                threshold=config.power_cut_alert_hours,
                triggered_conditions=[
                    f"Power interruption duration {p:.2f}h recorded (critical threshold: {config.power_cut_alert_hours:.2f}h)."
                ],
                timestamp=ts,
                simulated=reading.simulated,
            )
        )
        explanations.append(f"Power interruption ({p:.2f}h).")

    # 6. Gas/VOC checks (Phase 12)
    # Each gas field is checked independently; they represent distinct measurement modalities.

    # 6a. gas_ppm — generic calibrated gas/VOC concentration
    if reading.gas_ppm is not None and config.max_gas_ppm is not None:
        g = reading.gas_ppm
        if g > config.max_gas_ppm:
            alerts.append(
                SensorAlert(
                    alert_id=f"ALT-{rid}-GAS-HIGH",
                    sensor_id=sid,
                    storage_zone=zone,
                    alert_type="high_gas_ppm",
                    severity="warning",
                    message=(
                        f"Observed gas concentration ({g:.1f} ppm) exceeded configured maximum "
                        f"({config.max_gas_ppm:.1f} ppm). This is an environmental warning signal — "
                        "it does not confirm food spoilage."
                    ),
                    observed_value=g,
                    threshold=config.max_gas_ppm,
                    triggered_conditions=[
                        f"gas_ppm {g:.1f} ppm exceeds zone '{zone}' threshold of {config.max_gas_ppm:.1f} ppm."
                    ],
                    timestamp=ts,
                    simulated=reading.simulated,
                )
            )
            explanations.append(f"Gas/VOC elevated ({g:.1f} ppm > {config.max_gas_ppm:.1f} ppm).")

    # 6b. voc_index — dimensionless VOC index (e.g. Sensirion SGP41); NOT comparable to gas_ppm
    if reading.voc_index is not None and config.max_voc_index is not None:
        vi = reading.voc_index
        if vi > config.max_voc_index:
            alerts.append(
                SensorAlert(
                    alert_id=f"ALT-{rid}-VOC-HIGH",
                    sensor_id=sid,
                    storage_zone=zone,
                    alert_type="high_voc_index",
                    severity="warning",
                    message=(
                        f"Observed VOC index ({vi:.0f}) exceeded configured maximum ({config.max_voc_index:.0f}). "
                        "VOC index is a dimensionless index, not a ppm measurement. "
                        "This is an environmental warning signal."
                    ),
                    observed_value=vi,
                    threshold=config.max_voc_index,
                    triggered_conditions=[
                        f"voc_index {vi:.0f} exceeds zone '{zone}' threshold of {config.max_voc_index:.0f}."
                    ],
                    timestamp=ts,
                    simulated=reading.simulated,
                )
            )
            explanations.append(f"VOC index elevated ({vi:.0f} > {config.max_voc_index:.0f}).")

    # 6c. ethylene_ppm — only from dedicated ethylene-selective sensors
    if reading.ethylene_ppm is not None and config.max_ethylene_ppm is not None:
        e = reading.ethylene_ppm
        if e > config.max_ethylene_ppm:
            alerts.append(
                SensorAlert(
                    alert_id=f"ALT-{rid}-ETHYLENE-HIGH",
                    sensor_id=sid,
                    storage_zone=zone,
                    alert_type="high_ethylene_ppm",
                    severity="warning",
                    message=(
                        f"Observed ethylene concentration ({e:.2f} ppm) exceeded configured maximum "
                        f"({config.max_ethylene_ppm:.2f} ppm C2H4). Elevated ethylene may accelerate "
                        "ripening/spoilage of nearby produce. Inspect storage zone."
                    ),
                    observed_value=e,
                    threshold=config.max_ethylene_ppm,
                    triggered_conditions=[
                        f"ethylene_ppm {e:.2f} ppm exceeds zone '{zone}' threshold of {config.max_ethylene_ppm:.2f} ppm."
                    ],
                    timestamp=ts,
                    simulated=reading.simulated,
                )
            )
            explanations.append(f"Ethylene elevated ({e:.2f} ppm > {config.max_ethylene_ppm:.2f} ppm C2H4).")

    return alerts, explanations


def check_sequential_anomalies(
    readings: List[SensorReading],
    zone_configs: Dict[str, ZoneThresholdConfig],
) -> Dict[str, List[SensorAlert]]:
    """Analyze sequential relationships across chronologically sorted readings
    grouped by (sensor_id, storage_zone):
      - Sudden temperature changes between consecutive readings
      - Sustained abnormal temperature across consecutive readings
      - Sustained door-open status across consecutive readings

    Returns:
        Dict mapping reading_id to list of sequential alerts.
    """
    sequential_alerts: Dict[str, List[SensorAlert]] = {r.reading_id: [] for r in readings}

    # Group by (sensor_id, storage_zone)
    groups: Dict[Tuple[str, str], List[SensorReading]] = {}
    for r in readings:
        groups.setdefault((r.sensor_id, r.storage_zone), []).append(r)

    for (sensor_id, zone), group_readings in groups.items():
        config = zone_configs.get(zone)
        if config is None or len(group_readings) < 2:
            continue

        # Sort chronologically
        sorted_group = sorted(group_readings, key=lambda x: x.timestamp)

        # Track consecutive temperature anomalies, door opens, and gas anomalies
        consecutive_temp_abnormal: List[SensorReading] = []
        consecutive_door_open: List[SensorReading] = []
        consecutive_gas_abnormal: List[SensorReading] = []
        consecutive_voc_abnormal: List[SensorReading] = []

        prev_reading: Optional[SensorReading] = None

        for curr in sorted_group:
            curr_ts = curr.timestamp if curr.timestamp.tzinfo is not None else curr.timestamp.replace(tzinfo=timezone.utc)

            # Check gap with prev_reading
            gap_ok = True
            if prev_reading is not None:
                prev_ts = prev_reading.timestamp if prev_reading.timestamp.tzinfo is not None else prev_reading.timestamp.replace(tzinfo=timezone.utc)
                delta_hours = (curr_ts - prev_ts).total_seconds() / 3600.0

                if delta_hours > config.max_consecutive_gap_hours:
                    gap_ok = False
                    # Large gap breaks continuity for all sustained-anomaly counters
                    consecutive_temp_abnormal = []
                    consecutive_door_open = []
                    consecutive_gas_abnormal = []
                    consecutive_voc_abnormal = []
                elif prev_reading.temperature_c is not None and curr.temperature_c is not None:
                    # Check sudden change
                    temp_diff = abs(curr.temperature_c - prev_reading.temperature_c)
                    if temp_diff >= config.sudden_temp_change_threshold_c:
                        sequential_alerts[curr.reading_id].append(
                            SensorAlert(
                                alert_id=f"ALT-{curr.reading_id}-SUDDEN-TEMP",
                                sensor_id=sensor_id,
                                storage_zone=zone,
                                alert_type="sudden_temperature_change",
                                severity="warning",
                                message=(
                                    f"Sudden temperature change of {temp_diff:.1f}°C detected "
                                    f"(from {prev_reading.temperature_c:.1f}°C to {curr.temperature_c:.1f}°C in {delta_hours * 60:.0f} min)."
                                ),
                                observed_value=round(temp_diff, 2),
                                threshold=config.sudden_temp_change_threshold_c,
                                triggered_conditions=[
                                    f"Temperature delta {temp_diff:.1f}°C exceeds threshold of {config.sudden_temp_change_threshold_c:.1f}°C."
                                ],
                                timestamp=curr.timestamp,
                                simulated=curr.simulated,
                            )
                        )

            # Sustained temperature evaluation
            if curr.temperature_c is not None:
                is_abnormal = (
                    curr.temperature_c > config.max_temperature_c
                    or curr.temperature_c < config.min_temperature_c
                )
                if is_abnormal and gap_ok:
                    consecutive_temp_abnormal.append(curr)
                    if len(consecutive_temp_abnormal) >= config.sustained_consecutive_readings:
                        count = len(consecutive_temp_abnormal)
                        sequential_alerts[curr.reading_id].append(
                            SensorAlert(
                                alert_id=f"ALT-{curr.reading_id}-SUSTAINED-TEMP",
                                sensor_id=sensor_id,
                                storage_zone=zone,
                                alert_type="sustained_abnormal_temperature",
                                severity="critical",
                                message=(
                                    f"Sustained abnormal temperature across {count} consecutive readings "
                                    f"(current: {curr.temperature_c:.1f}°C)."
                                ),
                                observed_value=curr.temperature_c,
                                threshold=config.max_temperature_c,
                                triggered_conditions=[
                                    f"{count} consecutive readings violated temperature bounds without recovery."
                                ],
                                timestamp=curr.timestamp,
                                simulated=curr.simulated,
                            )
                        )
                else:
                    # Normal reading resets sustained counter
                    consecutive_temp_abnormal = []

            # Sustained door-open evaluation
            if curr.door_open is True and gap_ok:
                consecutive_door_open.append(curr)
                if len(consecutive_door_open) >= config.max_door_open_readings:
                    count = len(consecutive_door_open)
                    sequential_alerts[curr.reading_id].append(
                        SensorAlert(
                            alert_id=f"ALT-{curr.reading_id}-SUSTAINED-DOOR",
                            sensor_id=sensor_id,
                            storage_zone=zone,
                            alert_type="sustained_door_open",
                            severity="warning",
                            message=f"Door remained open across {count} consecutive readings.",
                            observed_value=True,
                            threshold=False,
                            triggered_conditions=[
                                f"Door observed open across {count} consecutive readings."
                            ],
                            timestamp=curr.timestamp,
                            simulated=curr.simulated,
                        )
                    )
            else:
                consecutive_door_open = []

            # Sustained gas_ppm evaluation (Phase 12)
            if curr.gas_ppm is not None and config.max_gas_ppm is not None:
                gas_abnormal = curr.gas_ppm > config.max_gas_ppm
                if gas_abnormal and gap_ok:
                    consecutive_gas_abnormal.append(curr)
                    if len(consecutive_gas_abnormal) >= config.sustained_consecutive_readings:
                        count = len(consecutive_gas_abnormal)
                        sequential_alerts[curr.reading_id].append(
                            SensorAlert(
                                alert_id=f"ALT-{curr.reading_id}-SUSTAINED-GAS",
                                sensor_id=sensor_id,
                                storage_zone=zone,
                                alert_type="sustained_high_gas_ppm",
                                severity="warning",
                                message=(
                                    f"Sustained elevated gas/VOC concentration across {count} consecutive readings "
                                    f"(current: {curr.gas_ppm:.1f} ppm). Inspect storage zone for source."
                                ),
                                observed_value=curr.gas_ppm,
                                threshold=config.max_gas_ppm,
                                triggered_conditions=[
                                    f"{count} consecutive readings exceeded gas_ppm threshold of {config.max_gas_ppm:.1f} ppm without recovery."
                                ],
                                timestamp=curr.timestamp,
                                simulated=curr.simulated,
                            )
                        )
                else:
                    consecutive_gas_abnormal = []

            # Sustained voc_index evaluation (Phase 12)
            if curr.voc_index is not None and config.max_voc_index is not None:
                voc_abnormal = curr.voc_index > config.max_voc_index
                if voc_abnormal and gap_ok:
                    consecutive_voc_abnormal.append(curr)
                    if len(consecutive_voc_abnormal) >= config.sustained_consecutive_readings:
                        count = len(consecutive_voc_abnormal)
                        sequential_alerts[curr.reading_id].append(
                            SensorAlert(
                                alert_id=f"ALT-{curr.reading_id}-SUSTAINED-VOC",
                                sensor_id=sensor_id,
                                storage_zone=zone,
                                alert_type="sustained_high_voc_index",
                                severity="warning",
                                message=(
                                    f"Sustained elevated VOC index across {count} consecutive readings "
                                    f"(current: {curr.voc_index:.0f}). Inspect storage zone ventilation."
                                ),
                                observed_value=curr.voc_index,
                                threshold=config.max_voc_index,
                                triggered_conditions=[
                                    f"{count} consecutive readings exceeded voc_index threshold of {config.max_voc_index:.0f} without recovery."
                                ],
                                timestamp=curr.timestamp,
                                simulated=curr.simulated,
                            )
                        )
                else:
                    consecutive_voc_abnormal = []

            prev_reading = curr

    return sequential_alerts


# ---------------------------------------------------------------------------
# Public Service API
# ---------------------------------------------------------------------------

def analyze_sensor_reading(
    reading_input: Union[SensorReading, Dict[str, Any]],
    zone_configs: Optional[Dict[str, ZoneThresholdConfig]] = None,
    as_of: Optional[datetime] = None,
) -> ReadingAnalysisResult:
    """Analyze a single sensor reading."""
    configs = zone_configs if zone_configs is not None else DEFAULT_ZONE_CONFIGS
    ref_time = as_of if as_of is not None else datetime.now(timezone.utc)

    # 1. Validation
    if isinstance(reading_input, SensorReading):
        reading = reading_input
        issues: List[str] = []
    else:
        reading, issues = validate_raw_reading(reading_input)

    if reading is None:
        rid = reading_input.get("reading_id", "UNKNOWN_ID") if isinstance(reading_input, dict) else "UNKNOWN_ID"
        sid = reading_input.get("sensor_id", "UNKNOWN_SENSOR") if isinstance(reading_input, dict) else "UNKNOWN_SENSOR"
        zone = str(reading_input.get("storage_zone", "unknown")) if isinstance(reading_input, dict) else "unknown"
        ts_raw = reading_input.get("timestamp") if isinstance(reading_input, dict) else None
        ts = ts_raw if isinstance(ts_raw, datetime) else ref_time

        alert = SensorAlert(
            alert_id=f"ALT-{rid}-VAL-ERR",
            sensor_id=sid,
            storage_zone=zone,
            alert_type="data_validation_error",
            severity="warning",
            message=f"Reading failed validation: {'; '.join(issues)}",
            observed_value=None,
            threshold=None,
            triggered_conditions=issues,
            timestamp=ts,
            simulated=True,
        )
        return ReadingAnalysisResult(
            reading_id=rid,
            sensor_id=sid,
            storage_zone=zone,
            timestamp=ts,
            simulated=True,
            status="insufficient_data",
            is_valid=False,
            validation_issues=issues,
            alerts=[alert],
            explanation=f"Malformed reading rejected: {'; '.join(issues)}",
        )

    # 2. Storage zone resolution
    zone_cfg = configs.get(reading.storage_zone)
    if zone_cfg is None:
        alert = SensorAlert(
            alert_id=f"ALT-{reading.reading_id}-UNK-ZONE",
            sensor_id=reading.sensor_id,
            storage_zone=reading.storage_zone,
            alert_type="unknown_storage_zone",
            severity="warning",
            message=f"Storage zone '{reading.storage_zone}' is not configured in threshold registry.",
            observed_value=reading.storage_zone,
            threshold=None,
            triggered_conditions=[f"Config registry has no entry for zone '{reading.storage_zone}'."],
            timestamp=reading.timestamp,
            simulated=reading.simulated,
        )
        return ReadingAnalysisResult(
            reading_id=reading.reading_id,
            sensor_id=reading.sensor_id,
            storage_zone=reading.storage_zone,
            timestamp=reading.timestamp,
            simulated=reading.simulated,
            status="insufficient_data",
            is_valid=True,
            validation_issues=[],
            alerts=[alert],
            explanation=f"Zone '{reading.storage_zone}' has no configured threshold settings.",
        )

    # 3. Individual checks
    alerts, explanations = check_individual_reading(reading, zone_cfg, ref_time)

    # Determine status
    if any(a.severity == "critical" for a in alerts):
        status: OverallStatus = "critical"
    elif any(a.severity == "warning" for a in alerts):
        status = "warning"
    else:
        status = "normal"

    expl = " ".join(explanations) if explanations else "Normal operating conditions observed."

    return ReadingAnalysisResult(
        reading_id=reading.reading_id,
        sensor_id=reading.sensor_id,
        storage_zone=reading.storage_zone,
        timestamp=reading.timestamp,
        simulated=reading.simulated,
        status=status,
        is_valid=True,
        validation_issues=[],
        alerts=alerts,
        explanation=expl,
    )


def analyze_sensor_readings(
    readings_input: List[Union[SensorReading, Dict[str, Any]]],
    zone_configs: Optional[Dict[str, ZoneThresholdConfig]] = None,
    as_of: Optional[datetime] = None,
) -> SensorBatchAnalysisResponse:
    """Analyze a batch of sensor readings, performing both individual and sequential checks."""
    configs = zone_configs if zone_configs is not None else DEFAULT_ZONE_CONFIGS
    ref_time = as_of if as_of is not None else datetime.now(timezone.utc)

    results: List[ReadingAnalysisResult] = []
    valid_readings: List[SensorReading] = []
    all_alerts: List[SensorAlert] = []

    # 1. Process individual readings
    for raw in readings_input:
        res = analyze_sensor_reading(raw, zone_configs=configs, as_of=ref_time)
        results.append(res)
        if res.is_valid:
            # Reconstruct validated reading object
            if isinstance(raw, SensorReading):
                valid_readings.append(raw)
            else:
                v_reading, _ = validate_raw_reading(raw)
                if v_reading:
                    valid_readings.append(v_reading)

    # 2. Sequential analysis on valid readings
    sequential_map = check_sequential_anomalies(valid_readings, configs)

    # 3. Merge sequential alerts into results
    for res in results:
        extra_alerts = sequential_map.get(res.reading_id, [])
        if extra_alerts:
            res.alerts.extend(extra_alerts)
            extra_msgs = [a.message for a in extra_alerts]
            res.explanation = f"{res.explanation} " + " ".join(extra_msgs)

            # Re-evaluate status
            if any(a.severity == "critical" for a in res.alerts):
                res.status = "critical"
            elif any(a.severity == "warning" for a in res.alerts):
                res.status = "warning"

        all_alerts.extend(res.alerts)

    # Batch overall status
    if any(r.status == "critical" for r in results):
        batch_status: OverallStatus = "critical"
    elif any(r.status == "warning" for r in results):
        batch_status = "warning"
    elif any(r.status == "insufficient_data" for r in results):
        batch_status = "insufficient_data"
    else:
        batch_status = "normal"

    return SensorBatchAnalysisResponse(
        as_of=ref_time,
        total_readings=len(readings_input),
        valid_readings=len(valid_readings),
        invalid_readings=len(readings_input) - len(valid_readings),
        overall_status=batch_status,
        active_alerts=all_alerts,
        results_by_reading=results,
        simulated=True,
    )


def load_sample_sensor_data(file_path: Optional[Union[str, Path]] = None) -> List[Dict[str, Any]]:
    """Load the synthetic IoT sensor dataset from disk."""
    if file_path is None:
        target_path = Path(__file__).resolve().parent.parent / "data" / "sample_sensor_data.json"
    else:
        target_path = Path(file_path)

    if not target_path.exists():
        raise FileNotFoundError(f"Synthetic sensor dataset not found at {target_path}")

    with open(target_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    return data.get("readings", [])
