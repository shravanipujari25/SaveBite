# SaveBite — Phase 5: Manual Database Schema & RLS Audit Reference

## 1. Overview & Architecture

SaveBite uses **Supabase PostgreSQL** exclusively as a managed relational database.

### Critical Authentication Architecture: Custom JWT vs Supabase Auth
- **Authentication Engine:** SaveBite uses a custom Node.js/Express authentication system (`bcryptjs` password hashing and signed `jsonwebtoken` tokens).
- **Database Client:** The backend accesses PostgreSQL using Supabase's `service_role` key (`SUPABASE_SECRET_KEY`).
- **Authorization Enforcement:** Because client requests do not use Supabase Auth sessions, database-level `auth.uid()` evaluates to `NULL` for backend queries. Therefore, **all household isolation, data partitioning, role verification, and ownership checks are strictly enforced in the backend application tier** via parameterized SQL queries bounded to `req.household.id`.
- **Database RLS Defense-in-Depth:** RLS is enabled on all tables with explicit policies granting full access to `service_role` and preventing unintended public or anonymous leakage.

---

## 2. Complete Phase 1–5 Database Schema Reference

If setting up a fresh Supabase database or confirming schema completeness, run the following SQL statements in the **Supabase Dashboard -> SQL Editor**.

```sql
-- ==============================================================================
-- SaveBite Complete Database Schema (Phases 1 - 5)
-- ==============================================================================

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Core Users Table
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(trim(name)) >= 2),
    email TEXT NOT NULL UNIQUE CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    token_version INT NOT NULL DEFAULT 1 CHECK (token_version >= 1),
    avatar_url TEXT DEFAULT '',
    preferences JSONB DEFAULT '{"theme": "system", "email_notifications": true}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON public.users (lower(email));

-- 3. Households Table
CREATE TABLE IF NOT EXISTS public.households (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(trim(name)) >= 2),
    settings JSONB DEFAULT '{"alert_on_critical": true, "alert_on_use_soon": true, "timezone": "UTC", "currency": "USD"}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. Household Memberships Table
CREATE TABLE IF NOT EXISTS public.household_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_household_members_user_household UNIQUE (user_id, household_id)
);
CREATE INDEX IF NOT EXISTS idx_household_members_lookup ON public.household_members (user_id, status);

-- 5. Inventory Items Table (Enhanced with Phase 4 Intelligence Columns)
CREATE TABLE IF NOT EXISTS public.inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    category TEXT NOT NULL DEFAULT 'other',
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    unit TEXT NOT NULL DEFAULT 'piece',
    purchase_date DATE,
    expiry_date DATE,
    storage_location TEXT NOT NULL DEFAULT 'pantry' CHECK (storage_location IN ('refrigerator', 'freezer', 'pantry', 'countertop')),
    estimated_unit_price NUMERIC(10, 2) CHECK (estimated_unit_price >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'wasted', 'archived')),
    is_opened BOOLEAN NOT NULL DEFAULT false,
    opened_at TIMESTAMPTZ,
    freshness_score NUMERIC(5, 2),
    adj_days_left NUMERIC(5, 2),
    use_first_score INT DEFAULT 0 CHECK (use_first_score >= 0 AND use_first_score <= 100),
    freshness_bucket TEXT DEFAULT 'fresh' CHECK (freshness_bucket IN ('fresh', 'use_soon', 'critical', 'expired')),
    last_intelligence_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_inventory_items_household_status ON public.inventory_items (household_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_items_use_first ON public.inventory_items (household_id, use_first_score DESC) WHERE status = 'active';

-- 6. Inventory Lifecycle Events Table
CREATE TABLE IF NOT EXISTS public.inventory_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    quantity_change NUMERIC(10, 2) NOT NULL,
    unit TEXT NOT NULL,
    notes TEXT,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_inventory_events_household ON public.inventory_events (household_id, created_at DESC);

-- 7. Waste Log Table
CREATE TABLE IF NOT EXISTS public.waste_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
    item_name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT 'spoiled',
    estimated_value NUMERIC(10, 2) DEFAULT 0.00 CHECK (estimated_value >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    wasted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    recorded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_waste_log_household ON public.waste_log (household_id, wasted_at DESC);

-- 8. IoT Devices Table
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    device_code TEXT NOT NULL UNIQUE,
    device_type TEXT NOT NULL DEFAULT 'esp32_sensor_hub',
    zone TEXT NOT NULL DEFAULT 'refrigerator',
    source_type TEXT NOT NULL DEFAULT 'physical' CHECK (source_type IN ('physical', 'simulator')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_devices_household ON public.devices (household_id, is_active);

-- 9. Sensor Readings Table
CREATE TABLE IF NOT EXISTS public.sensor_readings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    temperature_c NUMERIC(5, 2),
    humidity_percent NUMERIC(5, 2),
    air_quality_raw NUMERIC(8, 2),
    air_quality_unit TEXT NOT NULL DEFAULT 'raw',
    air_quality_index INT,
    source_type TEXT NOT NULL DEFAULT 'physical' CHECK (source_type IN ('physical', 'simulator')),
    metadata JSONB DEFAULT '{}'::jsonb,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_device ON public.sensor_readings (device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_household ON public.sensor_readings (household_id, recorded_at DESC);

-- 10. Device Events Table
CREATE TABLE IF NOT EXISTS public.device_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_device_events_household ON public.device_events (household_id, created_at DESC);

-- 11. Notifications Table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
    event_id UUID REFERENCES public.device_events(id) ON DELETE SET NULL,
    type TEXT NOT NULL DEFAULT 'threshold_alert',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_notifications_household ON public.notifications (household_id, is_read, created_at DESC);

-- 12. Receipts & Receipt Items Tables (Phase 3)
CREATE TABLE IF NOT EXISTS public.receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    image_url TEXT,
    merchant_name TEXT,
    purchase_date DATE,
    total_amount NUMERIC(10, 2),
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsing', 'parsed', 'failed')),
    confidence NUMERIC(5, 2),
    raw_ai_response JSONB,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_receipts_household ON public.receipts (household_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    raw_name TEXT NOT NULL,
    normalized_name TEXT,
    category TEXT NOT NULL DEFAULT 'other',
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
    unit TEXT NOT NULL DEFAULT 'piece',
    unit_price NUMERIC(10, 2),
    total_price NUMERIC(10, 2),
    confidence NUMERIC(5, 2) NOT NULL DEFAULT 1.0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
    created_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON public.receipt_items (receipt_id, status);

-- 13. Freshness Scans Table (Phase 3)
CREATE TABLE IF NOT EXISTS public.freshness_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    image_path TEXT,
    freshness_score NUMERIC(5, 2) NOT NULL CHECK (freshness_score >= 0 AND freshness_score <= 100),
    status_label TEXT,
    confidence NUMERIC(5, 2) NOT NULL DEFAULT 1.0,
    notes TEXT,
    scanned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_freshness_scans_item ON public.freshness_scans (inventory_item_id, created_at DESC);

-- 14. Shopping List Items Table (Phase 4)
CREATE TABLE IF NOT EXISTS public.shopping_list_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit TEXT NOT NULL DEFAULT 'piece',
    category TEXT DEFAULT 'other',
    notes TEXT,
    is_purchased BOOLEAN NOT NULL DEFAULT false,
    purchased_at TIMESTAMPTZ,
    added_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_shopping_list_household ON public.shopping_list_items (household_id, is_purchased);

-- 15. Avoided Waste Log Table (Phase 4)
CREATE TABLE IF NOT EXISTS public.avoided_waste_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
    item_name TEXT NOT NULL,
    quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    estimated_savings NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (estimated_savings >= 0),
    source TEXT NOT NULL DEFAULT 'recipe_rescue',
    recipe_name TEXT,
    recorded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_avoided_waste_household ON public.avoided_waste_log (household_id, consumed_at DESC);

-- 16. Device Pairing Tokens Table (Phase 4)
CREATE TABLE IF NOT EXISTS public.device_pairing_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    device_type TEXT NOT NULL DEFAULT 'esp32_sensor_hub',
    zone TEXT NOT NULL DEFAULT 'refrigerator',
    expires_at TIMESTAMPTZ NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT false,
    used_at TIMESTAMPTZ,
    paired_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_token ON public.device_pairing_tokens (token);

-- ==============================================================================
-- 17. Row Level Security (RLS) Configuration for service_role Access
-- ==============================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waste_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freshness_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avoided_waste_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_pairing_tokens ENABLE ROW LEVEL SECURITY;

-- Grant service_role policy on all tables
DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'users', 'households', 'household_members', 'inventory_items',
        'inventory_events', 'waste_log', 'devices', 'sensor_readings',
        'device_events', 'notifications', 'receipts', 'receipt_items',
        'freshness_scans', 'shopping_list_items', 'avoided_waste_log',
        'device_pairing_tokens'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I_service_role_policy ON public.%I', tbl, tbl);
        EXECUTE format('CREATE POLICY %I_service_role_policy ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', tbl, tbl);
    END LOOP;
END $$;
```

---

## 3. Schema Verification Queries

Execute these quick verification queries to confirm table health in Supabase:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'inventory_items'
ORDER BY ordinal_position;
```
