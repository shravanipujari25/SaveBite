# SaveBite: Secure Google OAuth & Supabase Backend Integration Guide

This guide details the architecture, manual setup procedures, security controls, and testing instructions for the SaveBite backend authentication system integrating Supabase Auth, PostgreSQL, and Google OAuth.

---

## 1. Architecture Overview

```
+-------------------------------------------------------------+
|                     Client (Frontend)                       |
|   1. Initiates Google OAuth via Supabase Client SDK         |
|   2. Receives Supabase session & Bearer access token        |
|   3. Sends 'Authorization: Bearer <access_token>' to API    |
+------------------------------+------------------------------+
                               |
                               | HTTPS + Bearer JWT
                               v
+-------------------------------------------------------------+
|                  SaveBite Express Backend                   |
|   1. Strict CORS & Helmet security header enforcement       |
|   2. Global & auth-specific rate limiting                   |
|   3. Bearer token extraction & validation                   |
|   4. Cryptographic signature & status verification          |
|      via Supabase Auth API (supabase.auth.getUser)          |
|   5. User identity derivation (strictly from claims)        |
|   6. User-scoped Supabase client creation (passes JWT)      |
+------------------------------+------------------------------+
                               |
                               | User-Scoped Queries (RLS)
                               v
+-------------------------------------------------------------+
|                 Supabase PostgreSQL Database                |
|   1. auth.users table (managed by Supabase Auth)            |
|   2. public.profiles table (synced via database trigger)    |
|   3. PostgreSQL Row-Level Security (RLS) policies           |
|   4. Anti-privilege escalation security triggers            |
+-------------------------------------------------------------+
```

### Key Principles
- **Frontend Isolation**: The frontend owns the Google OAuth popup/redirect initiation and token acquisition. The backend is strictly a stateless API verifying tokens and executing business logic.
- **Least-Privilege Database Access**: Backend requests forward the caller's JWT using a user-scoped Supabase client. Queries run directly subject to PostgreSQL Row-Level Security (`auth.uid() = id`). Elevated `service_role` keys are never shared with clients or exposed to frontend code.
- **Zero-Trust Identity**: User ID and email from incoming request bodies or query parameters are strictly ignored. The authenticated user identity is derived exclusively from verified cryptographic claims.

---

## 2. Google Cloud Console Setup

> [!IMPORTANT]
> Google Cloud configuration must be completed manually in your Google Cloud Project console.

1. Navigate to the [Google Cloud Console](https://console.cloud.google.com/).
2. Select or create your SaveBite Google Cloud project.
3. Open **APIs & Services** > **OAuth consent screen**:
   - User Type: **External** (or Internal for organization-restricted testing).
   - App name: `SaveBite`.
   - User support email: Select your admin email.
   - Developer contact information: Enter your email address.
   - Scopes: Add `.../auth/userinfo.email`, `.../auth/userinfo.profile`, and `openid`.
4. Open **APIs & Services** > **Credentials**:
   - Click **Create Credentials** > **OAuth client ID**.
   - Application type: **Web application**.
   - Name: `SaveBite Supabase Client`.
   - **Authorized JavaScript origins**:
     - `http://localhost:5173` (Local frontend development)
     - `https://your-production-domain.com` (Production frontend)
   - **Authorized redirect URIs**:
     - Enter the Supabase Auth Callback URL from your Supabase project:
       `https://<your-supabase-project-id>.supabase.co/auth/v1/callback`
5. Click **Create** and securely copy:
   - **Client ID**
   - **Client Secret**

---

## 3. Supabase Dashboard Configuration

### Enable Google Provider
1. Log in to your [Supabase Dashboard](https://supabase.com/dashboard).
2. Select your project and navigate to **Authentication** > **Providers**.
3. Locate **Google** and toggle it **Enabled**.
4. Paste the credentials obtained from Google Cloud Console:
   - **Client ID**: Your Google OAuth Client ID.
   - **Client Secret**: Your Google OAuth Client Secret.
5. Click **Save**.

### Configure Redirect URLs
1. Navigate to **Authentication** > **URL Configuration**.
2. Set **Site URL**:
   - Development: `http://localhost:5173`
   - Production: `https://your-production-domain.com`
3. Under **Redirect URLs**, add:
   - `http://localhost:5173/**`
   - `https://your-production-domain.com/**`
4. Click **Save**.

---

## 4. Database Migrations & Row-Level Security

The database schema and policies are provided in:
`supabase/migrations/20261024000000_create_profiles_table.sql`

### How to Apply the Migration

#### Option A: Supabase CLI (Recommended for Local & CI/CD)
```bash
# Link your project (if not linked)
npx supabase link --project-ref <your-supabase-project-id>

# Apply pending migrations
npx supabase db push
```

#### Option B: Supabase Dashboard SQL Editor
1. Open **SQL Editor** in your Supabase dashboard.
2. Open the file `supabase/migrations/20261024000000_create_profiles_table.sql`.
3. Paste the contents into the SQL Editor and click **Run**.

### Security Rules Enforced by the Migration
1. **Foreign Key**: `public.profiles.id` references `auth.users(id) ON DELETE CASCADE`.
2. **Automatic Provisioning**: The `on_auth_user_created` trigger automatically provisions a `public.profiles` row when a user logs in via Google OAuth for the first time, extracting `full_name` and `avatar_url` from raw user metadata.
3. **Row-Level Security (RLS)**:
   - Users can only read their own profile (`auth.uid() = id`).
   - Users can only update their own profile (`auth.uid() = id`).
4. **Privilege Escalation Guard**: The `tr_enforce_profile_security` trigger blocks any non-admin client from modifying the `role` field or changing the immutable profile `id`.

---

## 5. Backend Environment Variables

Configure your local environment by copying `backend/.env.example` to `backend/.env`:

```bash
cd backend
cp .env.example .env
```

Set the appropriate values:
```env
# Runtime environment
NODE_ENV=development

# Server port
PORT=5000

# Strict CORS allowed origin
FRONTEND_URL=http://localhost:5173

# Supabase configuration
SUPABASE_URL=https://<your-project-id>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<your-supabase-anon-or-publishable-key>
SUPABASE_SECRET_KEY=<your-supabase-service-role-secret-key>

# Logging
LOG_LEVEL=info
```

> [!WARNING]
> Never commit `backend/.env` to source control. `SUPABASE_SECRET_KEY` has elevated system privileges and must never be exposed to clients or browser code.

---

## 6. Backend API Endpoints

### 1. Minimal Health Check
- **Endpoint**: `GET /api/v1/health`
- **Authentication**: None required.
- **Response**:
  ```json
  {
    "status": "healthy",
    "timestamp": "2026-10-24T15:30:00.000Z",
    "uptime": 142
  }
  ```

### 2. Current User Profile
- **Endpoint**: `GET /api/v1/auth/me`
- **Authentication**: Required (`Authorization: Bearer <supabase_access_token>`).
- **Response (200 OK)**:
  ```json
  {
    "status": "success",
    "data": {
      "user": {
        "id": "c7a1c5d3-8b7a-4c28-94b2-29ec3840e671",
        "email": "user@example.com",
        "full_name": "Jane Doe",
        "avatar_url": "https://lh3.googleusercontent.com/...",
        "role": "user",
        "created_at": "2026-10-24T10:00:00.000Z",
        "updated_at": "2026-10-24T10:00:00.000Z"
      }
    }
  }
  ```
- **Error Responses**:
  - `401 Unauthorized`: Missing, expired, malformed, or invalid signature tokens.
  - `429 Too Many Requests`: Triggered if auth rate limit threshold is exceeded.

### 3. Session Logout Hook
- **Endpoint**: `POST /api/v1/auth/logout`
- **Authentication**: Required (`Authorization: Bearer <supabase_access_token>`).
- **Response (200 OK)**:
  ```json
  {
    "status": "success",
    "message": "Logged out successfully. Please clear client-side credentials."
  }
  ```

---

## 7. Verifying Token Verification Against Live Backend

Once your Supabase project and Google OAuth provider are configured:

1. Obtain a valid Supabase access token via the frontend login or Supabase Auth API:
   ```bash
   ACCESS_TOKEN="<your_test_access_token>"
   ```
2. Verify token against the running backend:
   ```bash
   curl -i -X GET http://localhost:5000/api/v1/auth/me \
     -H "Authorization: Bearer $ACCESS_TOKEN" \
     -H "Origin: http://localhost:5173"
   ```
3. Test invalid token rejection:
   ```bash
   curl -i -X GET http://localhost:5000/api/v1/auth/me \
     -H "Authorization: Bearer invalid.token.value" \
     -H "Origin: http://localhost:5173"
   ```
   Should return `401 Unauthorized` with `{"error":{"code":"UNAUTHORIZED","message":"Invalid or expired access token"}}`.

4. Test unapproved CORS origin rejection:
   ```bash
   curl -i -X GET http://localhost:5000/api/v1/health \
     -H "Origin: http://malicious-site.com"
   ```
   Should return `403 Forbidden` with `{"error":{"code":"CORS_REJECTED","message":"CORS origin unauthorized"}}`.

---

## 8. Frontend Integration Requirements (Documented — Frontend Unmodified)

Per strict instructions, `frontend/` has not been modified. To connect the frontend when frontend development begins:

1. **Supabase Client Installation** (in `frontend/`):
   Install `@supabase/supabase-js`.
2. **Google OAuth Trigger**:
   ```javascript
   import { createClient } from '@supabase/supabase-js';

   const supabase = createClient(
     import.meta.env.VITE_SUPABASE_URL,
     import.meta.env.VITE_SUPABASE_ANON_KEY
   );

   export const signInWithGoogle = async () => {
     const { data, error } = await supabase.auth.signInWithOAuth({
       provider: 'google',
       options: {
         redirectTo: `${window.location.origin}/auth/callback`
       }
     });
     if (error) console.error('OAuth initiation failed:', error.message);
   };
   ```
3. **Forwarding Access Token to Backend**:
   When making requests to backend endpoints (such as `GET /api/v1/auth/me`), attach the Supabase access token:
   ```javascript
   const { data: { session } } = await supabase.auth.getSession();
   const token = session?.access_token;

   const response = await fetch('http://localhost:5000/api/v1/auth/me', {
     headers: {
       'Authorization': `Bearer ${token}`
     }
   });
   const result = await response.json();
   ```
4. **Logout Flow**:
   Clear the local session using `supabase.auth.signOut()` and notify the backend:
   ```javascript
   await fetch('http://localhost:5000/api/v1/auth/logout', {
     method: 'POST',
     headers: { 'Authorization': `Bearer ${token}` }
   });
   await supabase.auth.signOut();
   ```
