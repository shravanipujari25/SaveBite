# SaveBite: Custom Node.js & JWT Authentication Postman Guide

This guide provides end-to-end instructions for testing the SaveBite custom email/password authentication system using Postman, curl, or any REST client.

---

## 1. Prerequisites & Environment Setup

1. **Start the SaveBite Backend**:
   ```bash
   cd backend
   npm run dev
   ```
   The backend server starts listening on `http://localhost:5000`.

2. **Base URL**:
   ```
   {{baseUrl}} = http://localhost:5000/api/v1
   ```

3. **Postman Collection Setup**:
   - Create a new Collection named `SaveBite Custom Auth`.
   - In the Collection settings, add a Collection Variable:
     - Variable: `accessToken`
     - Initial Value: *(leave blank)*

---

## 2. API Endpoints Testing Workflow

### Step 1: User Signup
Registers a new user account with strong password hashing (`bcrypt`) and automatically issues an access token.

- **Method**: `POST`
- **URL**: `http://localhost:5000/api/v1/auth/signup`
- **Headers**:
  ```http
  Content-Type: application/json
  ```
- **Body** (raw JSON):
  ```json
  {
    "name": "Alex Chef",
    "email": "alex.chef@savebite.com",
    "password": "StrongPassword123!"
  }
  ```
- **Tests Script (Postman)**:
  ```javascript
  pm.test("Status code is 201 Created", function () {
    pm.response.to.have.status(201);
  });

  const response = pm.response.json();
  if (response.data && response.data.accessToken) {
    pm.collectionVariables.set("accessToken", response.data.accessToken);
    console.log("Access token saved to collection variable");
  }
  ```
- **Expected Response (201 Created)**:
  ```json
  {
    "status": "success",
    "data": {
      "user": {
        "id": "e8a93cb2-68bb-4b9d-9c31-4ad9c2d1b849",
        "name": "Alex Chef",
        "email": "alex.chef@savebite.com",
        "role": "user",
        "createdAt": "2026-10-24T16:00:00.000Z",
        "updatedAt": "2026-10-24T16:00:00.000Z"
      },
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```

---

### Step 2: User Signin
Authenticates existing credentials, validates against bcrypt password hash, and issues a fresh signed JWT with the user's active `tokenVersion`.

- **Method**: `POST`
- **URL**: `http://localhost:5000/api/v1/auth/signin`
- **Headers**:
  ```http
  Content-Type: application/json
  ```
- **Body** (raw JSON):
  ```json
  {
    "email": "alex.chef@savebite.com",
    "password": "StrongPassword123!"
  }
  ```
- **Tests Script (Postman)**:
  ```javascript
  pm.test("Status code is 200 OK", function () {
    pm.response.to.have.status(200);
  });

  const response = pm.response.json();
  if (response.data && response.data.accessToken) {
    pm.collectionVariables.set("accessToken", response.data.accessToken);
    console.log("Updated accessToken collection variable");
  }
  ```
- **Expected Response (200 OK)**:
  ```json
  {
    "status": "success",
    "data": {
      "user": {
        "id": "e8a93cb2-68bb-4b9d-9c31-4ad9c2d1b849",
        "name": "Alex Chef",
        "email": "alex.chef@savebite.com",
        "role": "user",
        "createdAt": "2026-10-24T16:00:00.000Z",
        "updatedAt": "2026-10-24T16:00:00.000Z"
      },
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```

---

### Step 3: Current User Profile (Authenticated)
Verifies the Bearer JWT token, validates `tokenVersion`, loads the database record, and returns the safe user profile.

- **Method**: `GET`
- **URL**: `http://localhost:5000/api/v1/auth/me`
- **Authorization**:
  - Type: **Bearer Token**
  - Token: `{{accessToken}}`
- **Expected Response (200 OK)**:
  ```json
  {
    "status": "success",
    "data": {
      "user": {
        "id": "e8a93cb2-68bb-4b9d-9c31-4ad9c2d1b849",
        "name": "Alex Chef",
        "email": "alex.chef@savebite.com",
        "role": "user",
        "createdAt": "2026-10-24T16:00:00.000Z",
        "updatedAt": "2026-10-24T16:00:00.000Z"
      }
    }
  }
  ```

---

### Step 4: Invalid Authentication Verification

#### A. Missing Token
- Send `GET http://localhost:5000/api/v1/auth/me` without any `Authorization` header.
- **Expected Response (401 Unauthorized)**:
  ```json
  {
    "status": "error",
    "message": "Missing Authorization header with Bearer token"
  }
  ```

#### B. Malformed Token
- Send `GET http://localhost:5000/api/v1/auth/me` with header `Authorization: Bearer not-a-valid-jwt`.
- **Expected Response (401 Unauthorized)**:
  ```json
  {
    "status": "error",
    "message": "Invalid access token format"
  }
  ```

#### C. Tampered Signature
- Send `GET http://localhost:5000/api/v1/auth/me` with a modified or tampered JWT.
- **Expected Response (401 Unauthorized)**:
  ```json
  {
    "status": "error",
    "message": "Invalid or expired access token"
  }
  ```

---

### Step 5: Logout & Server-Side Token Revocation Verification

The SaveBite custom authentication architecture features **immediate server-side token invalidation** via `token_version` tracking in PostgreSQL:

1. **Invoke Logout**:
   - **Method**: `POST`
   - **URL**: `http://localhost:5000/api/v1/auth/logout`
   - **Authorization**: Bearer Token `{{accessToken}}`
   - **Expected Response (200 OK)**:
     ```json
     {
       "status": "success",
       "message": "Logged out successfully. Active sessions have been invalidated."
     }
     ```

2. **Verify That the Revoked Token Can No Longer Access Protected Routes**:
   - Re-send `GET http://localhost:5000/api/v1/auth/me` using the same `{{accessToken}}`.
   - **Expected Response (401 Unauthorized)**:
     ```json
     {
       "status": "error",
       "message": "Token has been revoked. Please sign in again."
     }
     ```
   This confirms that tokens are genuinely revoked server-side immediately upon logout, preventing replay attacks.

---

### Step 6: Negative Security Tests

#### Duplicate Registration Rejection
- Re-run `POST http://localhost:5000/api/v1/auth/signup` with `alex.chef@savebite.com`.
- **Expected Response (409 Conflict)**:
  ```json
  {
    "status": "error",
    "message": "Email is already registered"
  }
  ```

#### Credential Guessing Mitigation
- Send `POST http://localhost:5000/api/v1/auth/signin` with unknown email or wrong password.
- **Expected Response (401 Unauthorized)**:
  ```json
  {
    "status": "error",
    "message": "Invalid email or password"
  }
  ```
  *(Generic response prevents user enumeration attacks)*.
