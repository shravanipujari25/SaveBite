-- ==============================================================================
-- Migration: 20261024000003_create_iot_and_telemetry.sql
-- Description: Create devices, sensor_readings, device_events, and notifications tables.
--              Enforces physical bounds on measurements, distinguishes simulator vs physical,
--              includes high-performance descending time indexes, RLS policies, updated_at trigger,
--              and configures Supabase Realtime publication membership.
-- ==============================================================================

-- 1. Ensure pgcrypto extension is available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. Devices Table
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    device_code TEXT NOT NULL UNIQUE CHECK (char_length(trim(device_code)) > 0),
    device_type TEXT NOT NULL DEFAULT 'esp32' CHECK (device_type IN ('esp32', 'sensor_node', 'simulator', 'other')),
    zone TEXT NOT NULL DEFAULT 'refrigerator' CHECK (zone IN ('refrigerator', 'freezer', 'pantry', 'counter', 'other')),
    source_type TEXT NOT NULL DEFAULT 'physical' CHECK (source_type IN ('physical', 'simulator')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ==============================================================================
-- 3. Sensor Readings Table (Raw Telemetry Ingestion)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.sensor_readings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    temperature_c NUMERIC(5, 2) CHECK (temperature_c IS NULL OR (temperature_c >= -50.00 AND temperature_c <= 100.00)),
    humidity_percent NUMERIC(5, 2) CHECK (humidity_percent IS NULL OR (humidity_percent >= 0.00 AND humidity_percent <= 100.00)),
    air_quality_raw NUMERIC(10, 2) CHECK (air_quality_raw IS NULL OR air_quality_raw >= 0.00),
    air_quality_unit TEXT DEFAULT 'raw',
    air_quality_index NUMERIC(10, 2),
    source_type TEXT NOT NULL DEFAULT 'physical' CHECK (source_type IN ('physical', 'simulator')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ==============================================================================
-- 4. Device Events Table (Operational Events)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.device_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'door_open', 'door_closed', 'power_cut', 'power_restored',
        'device_online', 'device_offline', 'sensor_error', 'telemetry_received',
        'threshold_breach'
    )),
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    message TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    source_type TEXT NOT NULL DEFAULT 'physical' CHECK (source_type IN ('physical', 'simulator')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ==============================================================================
-- 5. Notifications Table
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
    event_id UUID REFERENCES public.device_events(id) ON DELETE SET NULL,
    type TEXT NOT NULL DEFAULT 'threshold_alert' CHECK (type IN ('threshold_alert', 'operational', 'system', 'inventory')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    read_at TIMESTAMPTZ
);

-- ==============================================================================
-- 6. Indexes for High-Volume Queries & Telemetry
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_devices_household_status ON public.devices (household_id, status);
CREATE INDEX IF NOT EXISTS idx_devices_device_code ON public.devices (device_code);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_device_recorded ON public.sensor_readings (device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_household_recorded ON public.sensor_readings (household_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_device_events_household_occurred ON public.device_events (household_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_events_device_occurred ON public.device_events (device_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_household_unread ON public.notifications (household_id, is_read, created_at DESC);

-- ==============================================================================
-- 7. Automatic updated_at Trigger for Devices
-- ==============================================================================
DROP TRIGGER IF EXISTS tr_devices_updated_at ON public.devices;
CREATE TRIGGER tr_devices_updated_at
    BEFORE UPDATE ON public.devices
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- 8. Enable Row-Level Security (RLS)
-- ==============================================================================
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role access devices" ON public.devices;
CREATE POLICY "Service role access devices" ON public.devices FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role access sensor_readings" ON public.sensor_readings;
CREATE POLICY "Service role access sensor_readings" ON public.sensor_readings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role access device_events" ON public.device_events;
CREATE POLICY "Service role access device_events" ON public.device_events FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role access notifications" ON public.notifications;
CREATE POLICY "Service role access notifications" ON public.notifications FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ==============================================================================
-- 9. Supabase Realtime Publication Configuration
-- ==============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.sensor_readings;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.device_events;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END IF;
END;
$$;
