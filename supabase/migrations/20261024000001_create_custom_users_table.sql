-- ==============================================================================
-- Migration: 20261024000001_create_custom_users_table.sql
-- Description: Create standalone public.users table for custom Node.js/Express
--              email/password authentication using bcrypt and JWT.
--              Includes security triggers, email normalization, and token versioning.
-- ==============================================================================

-- 1. Ensure pgcrypto extension is available for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Create standalone application users table
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    token_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Case-insensitive unique index on email to guarantee uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON public.users (LOWER(email));

-- 4. Index on user role for authorization filtering
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users (role);

-- 5. Automatic updated_at timestamp trigger
CREATE OR REPLACE FUNCTION public.handle_users_updated_at()
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

DROP TRIGGER IF EXISTS tr_users_updated_at ON public.users;
CREATE TRIGGER tr_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_users_updated_at();

-- 6. Privilege escalation guard trigger on public.users
-- Prevents clients from updating their own role or mutating immutable user IDs
CREATE OR REPLACE FUNCTION public.enforce_user_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Prevent altering primary key / user ID
    IF NEW.id <> OLD.id THEN
        RAISE EXCEPTION 'User ID is immutable and cannot be changed'
            USING ERRCODE = '42501';
    END IF;

    -- Prevent modifying role unless explicitly executed by server database superuser/service_role
    IF NEW.role IS DISTINCT FROM OLD.role AND current_user NOT IN ('postgres', 'service_role') THEN
        RAISE EXCEPTION 'Role modifications are restricted to administrators'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_user_security ON public.users;
CREATE TRIGGER tr_enforce_user_security
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_user_security();

-- 7. Database access and RLS Note:
-- Custom application JWTs are issued by the Node.js backend and are not Supabase Auth JWTs.
-- Therefore, PostgreSQL RLS policies relying on auth.uid() do not evaluate custom JWT claims.
-- Application data access is managed through the backend using parameterized queries and
-- application-level ownership and role verification.
