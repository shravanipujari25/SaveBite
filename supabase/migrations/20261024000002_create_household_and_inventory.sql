-- ==============================================================================
-- Migration: 20261024000002_create_household_and_inventory.sql
-- Description: Create households, household_members, inventory_items, waste_log,
--              and inventory_events tables. Includes constraints, performance indexes,
--              Row-Level Security (RLS), updated_at triggers, atomic user+household
--              creation function, and backfill for existing users.
-- ==============================================================================

-- 1. Ensure pgcrypto extension is available for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. Households Table
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.households (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ==============================================================================
-- 3. Household Memberships Table
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.household_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_household_members_user_household UNIQUE (household_id, user_id)
);

-- ==============================================================================
-- 4. Inventory Items Table
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    category TEXT DEFAULT 'other' CHECK (category IN (
        'produce', 'dairy', 'bakery', 'meat', 'pantry',
        'beverages', 'frozen', 'leftovers', 'snacks', 'other'
    )),
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    unit TEXT NOT NULL CHECK (unit IN (
        'g', 'kg', 'ml', 'l', 'piece', 'pack', 'oz', 'lb', 'can', 'bottle', 'item', 'serving'
    )),
    purchase_date DATE,
    expiry_date DATE,
    storage_location TEXT NOT NULL DEFAULT 'pantry' CHECK (storage_location IN (
        'refrigerator', 'freezer', 'pantry', 'counter', 'other'
    )),
    estimated_unit_price NUMERIC(10, 2) CHECK (estimated_unit_price IS NULL OR estimated_unit_price >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'wasted', 'archived')),
    is_opened BOOLEAN NOT NULL DEFAULT false,
    opened_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ==============================================================================
-- 5. Food Waste Log Table
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.waste_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
    item_name TEXT NOT NULL,
    quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('expired', 'spoiled', 'damaged', 'leftover', 'other')),
    estimated_value NUMERIC(10, 2) CHECK (estimated_value IS NULL OR estimated_value >= 0),
    wasted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    recorded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ==============================================================================
-- 6. Inventory Events / Lifecycle Audit History Table
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'created', 'consumed', 'wasted', 'opened', 'updated', 'archived', 'manual_purchase'
    )),
    quantity_change NUMERIC(10, 2),
    unit TEXT,
    notes TEXT,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ==============================================================================
-- 7. Performance and Filtering Indexes
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_household_members_user_status ON public.household_members (user_id, status);
CREATE INDEX IF NOT EXISTS idx_household_members_household_user ON public.household_members (household_id, user_id);

CREATE INDEX IF NOT EXISTS idx_inventory_items_household_status ON public.inventory_items (household_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_items_household_expiry ON public.inventory_items (household_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_inventory_items_household_category ON public.inventory_items (household_id, category);
CREATE INDEX IF NOT EXISTS idx_inventory_items_household_storage ON public.inventory_items (household_id, storage_location);

CREATE INDEX IF NOT EXISTS idx_waste_log_household_wasted_at ON public.waste_log (household_id, wasted_at);
CREATE INDEX IF NOT EXISTS idx_waste_log_inventory_item ON public.waste_log (inventory_item_id);

CREATE INDEX IF NOT EXISTS idx_inventory_events_household_created ON public.inventory_events (household_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_events_item_id ON public.inventory_events (inventory_item_id);

-- ==============================================================================
-- 8. Automatic updated_at Timestamp Triggers
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_households_updated_at ON public.households;
CREATE TRIGGER tr_households_updated_at
    BEFORE UPDATE ON public.households
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_household_members_updated_at ON public.household_members;
CREATE TRIGGER tr_household_members_updated_at
    BEFORE UPDATE ON public.household_members
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_inventory_items_updated_at ON public.inventory_items;
CREATE TRIGGER tr_inventory_items_updated_at
    BEFORE UPDATE ON public.inventory_items
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- 9. Atomic User and Household Creation Stored Procedure
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.create_user_with_household(
    p_name TEXT,
    p_email TEXT,
    p_password_hash TEXT,
    p_role TEXT DEFAULT 'user',
    p_household_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_household_id UUID;
    v_member_id UUID;
    v_household_name TEXT;
    v_user_record RECORD;
    v_household_record RECORD;
    v_normalized_email TEXT;
BEGIN
    v_normalized_email := LOWER(TRIM(p_email));
    v_household_name := COALESCE(NULLIF(TRIM(p_household_name), ''), TRIM(p_name) || '''s Household');

    -- Check if user already exists
    IF EXISTS (SELECT 1 FROM public.users WHERE LOWER(email) = v_normalized_email) THEN
        RAISE EXCEPTION 'Email is already registered' USING ERRCODE = '23505';
    END IF;

    -- 1. Insert user into public.users
    INSERT INTO public.users (name, email, password_hash, role, token_version)
    VALUES (TRIM(p_name), v_normalized_email, p_password_hash, COALESCE(p_role, 'user'), 1)
    RETURNING id, name, email, role, token_version, created_at, updated_at
    INTO v_user_record;

    v_user_id := v_user_record.id;

    -- 2. Insert default household
    INSERT INTO public.households (name)
    VALUES (v_household_name)
    RETURNING id, name, created_at, updated_at
    INTO v_household_record;

    v_household_id := v_household_record.id;

    -- 3. Add user as owner in household_members
    INSERT INTO public.household_members (household_id, user_id, role, status)
    VALUES (v_household_id, v_user_id, 'owner', 'active')
    RETURNING id INTO v_member_id;

    RETURN jsonb_build_object(
        'user', jsonb_build_object(
            'id', v_user_record.id,
            'name', v_user_record.name,
            'email', v_user_record.email,
            'role', v_user_record.role,
            'token_version', v_user_record.token_version,
            'created_at', v_user_record.created_at,
            'updated_at', v_user_record.updated_at
        ),
        'household', jsonb_build_object(
            'id', v_household_record.id,
            'name', v_household_record.name,
            'role', 'owner',
            'status', 'active',
            'created_at', v_household_record.created_at
        )
    );
END;
$$;

-- ==============================================================================
-- 10. Enable Row Level Security (RLS) on all new tables
-- ==============================================================================
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waste_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_events ENABLE ROW LEVEL SECURITY;

-- Note on RLS and Custom JWTs:
-- The application utilizes custom Node.js JWT authentication with bcrypt.
-- Server-side database operations are executed through the backend with parameterized
-- household scoping and verified user claims. The service_role has administrative access.
DROP POLICY IF EXISTS "Service role access households" ON public.households;
CREATE POLICY "Service role access households" ON public.households FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role access household_members" ON public.household_members;
CREATE POLICY "Service role access household_members" ON public.household_members FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role access inventory_items" ON public.inventory_items;
CREATE POLICY "Service role access inventory_items" ON public.inventory_items FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role access waste_log" ON public.waste_log;
CREATE POLICY "Service role access waste_log" ON public.waste_log FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role access inventory_events" ON public.inventory_events;
CREATE POLICY "Service role access inventory_events" ON public.inventory_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ==============================================================================
-- 11. Safe Data Backfill Strategy for Pre-existing Users
-- ==============================================================================
-- Automatically provisions a default household and owner membership for any
-- existing application user who does not yet belong to a household.
DO $$
DECLARE
    u RECORD;
    v_hh_id UUID;
BEGIN
    FOR u IN
        SELECT id, name
        FROM public.users u_inner
        WHERE NOT EXISTS (
            SELECT 1 FROM public.household_members hm WHERE hm.user_id = u_inner.id
        )
    LOOP
        INSERT INTO public.households (name)
        VALUES (TRIM(u.name) || '''s Household')
        RETURNING id INTO v_hh_id;

        INSERT INTO public.household_members (household_id, user_id, role, status)
        VALUES (v_hh_id, u.id, 'owner', 'active')
        ON CONFLICT (household_id, user_id) DO NOTHING;
    END LOOP;
END;
$$;
