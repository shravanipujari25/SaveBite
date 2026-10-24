/**
 * CORS & Complete Backend Integration Verification Suite
 * Verifies all preflight OPTIONS requests and actual API responses
 * specifically targeting Origin: http://localhost:5174
 */

const BASE_URL = 'http://localhost:5000/api/v1';
const TEST_ORIGIN = 'http://localhost:5174';

async function run() {
  console.log('===============================================================');
  console.log(`TESTING CORS & ENDPOINTS WITH ORIGIN: ${TEST_ORIGIN}`);
  console.log('===============================================================\n');

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`✓ [PASS] ${testName}`);
      if (details) console.log(`         ${details}`);
      passedTests++;
    } else {
      console.error(`✗ [FAIL] ${testName}`);
      if (details) console.error(`         ${details}`);
      failedTests++;
    }
  }

  // 1. Test CORS Preflight (OPTIONS) for all previously failing routes
  const preflightEndpoints = [
    { name: 'Inventory Active List', path: '/inventory?status=active&limit=100', method: 'GET' },
    { name: 'Dashboard Metrics', path: '/dashboard', method: 'GET' },
    { name: 'Notifications (limit=10)', path: '/notifications?limit=10', method: 'GET' },
    { name: 'Notifications (limit=20)', path: '/notifications?limit=20', method: 'GET' },
    { name: 'User Signup', path: '/auth/signup', method: 'POST' },
    { name: 'Notifications Read-All', path: '/notifications/read-all', method: 'PATCH' },
  ];

  console.log('--- 1. Testing OPTIONS Preflight Requests ---');
  for (const ep of preflightEndpoints) {
    try {
      const res = await fetch(`${BASE_URL}${ep.path}`, {
        method: 'OPTIONS',
        headers: {
          'Origin': TEST_ORIGIN,
          'Access-Control-Request-Method': ep.method,
          'Access-Control-Request-Headers': 'Content-Type, Authorization'
        }
      });

      const allowOrigin = res.headers.get('access-control-allow-origin');
      const allowCreds = res.headers.get('access-control-allow-credentials');
      const allowMethods = res.headers.get('access-control-allow-methods');

      const isSuccess = (res.status === 204 || res.status === 200) && allowOrigin === TEST_ORIGIN;
      assert(
        isSuccess,
        `OPTIONS ${ep.path}`,
        `Status: ${res.status}, Allow-Origin: ${allowOrigin}, Allow-Creds: ${allowCreds}, Methods: ${allowMethods}`
      );
    } catch (err) {
      assert(false, `OPTIONS ${ep.path}`, `Network error: ${err.message}`);
    }
  }

  console.log('\n--- 2. Testing User Signup with CORS ---');
  let signupToken = null;
  const uniqueEmail = `cors_test_user_${Date.now()}@savebite.com`;
  try {
    const res = await fetch(`${BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: {
        'Origin': TEST_ORIGIN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'CORS Test User',
        email: uniqueEmail,
        password: 'TestPassword123!'
      })
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const data = await res.json();
    assert(
      res.status === 201 && allowOrigin === TEST_ORIGIN && data.data?.accessToken,
      'POST /auth/signup (Real Account Creation)',
      `Status: ${res.status}, Created User: ${data.data?.user?.email}, Allow-Origin: ${allowOrigin}`
    );
    signupToken = data.data?.accessToken;
  } catch (err) {
    assert(false, 'POST /auth/signup', `Error: ${err.message}`);
  }

  console.log('\n--- 3. Testing Signin with Demo Credentials & CORS ---');
  let authToken = null;
  try {
    const res = await fetch(`${BASE_URL}/auth/signin`, {
      method: 'POST',
      headers: {
        'Origin': TEST_ORIGIN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'demo@savebite.com',
        password: 'DemoPassword123!'
      })
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const data = await res.json();
    authToken = data.data?.accessToken;
    assert(
      res.status === 200 && allowOrigin === TEST_ORIGIN && authToken,
      'POST /auth/signin',
      `Status: ${res.status}, Logged In User: ${data.data?.user?.email}, Allow-Origin: ${allowOrigin}`
    );
  } catch (err) {
    assert(false, 'POST /auth/signin', `Error: ${err.message}`);
  }

  const authHeaders = {
    'Origin': TEST_ORIGIN,
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`
  };

  console.log('\n--- 4. Testing Authenticated Core Data Retrieval with CORS ---');

  // A. Inventory Active List
  try {
    const res = await fetch(`${BASE_URL}/inventory?status=active&limit=100`, {
      method: 'GET',
      headers: authHeaders
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const data = await res.json();
    const items = data.data?.items || [];
    assert(
      res.status === 200 && allowOrigin === TEST_ORIGIN && Array.isArray(items),
      'GET /inventory?status=active&limit=100',
      `Status: ${res.status}, Items Count: ${items.length}, Allow-Origin: ${allowOrigin}`
    );
  } catch (err) {
    assert(false, 'GET /inventory?status=active&limit=100', `Error: ${err.message}`);
  }

  // B. Dashboard Metrics
  try {
    const res = await fetch(`${BASE_URL}/dashboard`, {
      method: 'GET',
      headers: authHeaders
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const data = await res.json();
    assert(
      res.status === 200 && allowOrigin === TEST_ORIGIN && data.data?.summary,
      'GET /dashboard',
      `Status: ${res.status}, Active Items: ${data.data?.summary?.totalActiveItems}, Expiring Soon: ${data.data?.summary?.expiringSoonCount}`
    );
  } catch (err) {
    assert(false, 'GET /dashboard', `Error: ${err.message}`);
  }

  // C. Notifications (limit=10)
  try {
    const res = await fetch(`${BASE_URL}/notifications?limit=10`, {
      method: 'GET',
      headers: authHeaders
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const data = await res.json();
    const notifs = data.data?.notifications || [];
    assert(
      res.status === 200 && allowOrigin === TEST_ORIGIN && Array.isArray(notifs),
      'GET /notifications?limit=10',
      `Status: ${res.status}, Notifications Count: ${notifs.length}`
    );
  } catch (err) {
    assert(false, 'GET /notifications?limit=10', `Error: ${err.message}`);
  }

  // D. Notifications (limit=20)
  try {
    const res = await fetch(`${BASE_URL}/notifications?limit=20`, {
      method: 'GET',
      headers: authHeaders
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const data = await res.json();
    const notifs = data.data?.notifications || [];
    assert(
      res.status === 200 && allowOrigin === TEST_ORIGIN && Array.isArray(notifs),
      'GET /notifications?limit=20',
      `Status: ${res.status}, Notifications Count: ${notifs.length}`
    );
  } catch (err) {
    assert(false, 'GET /notifications?limit=20', `Error: ${err.message}`);
  }

  // E. Mark All Notifications as Read (New endpoint)
  try {
    const res = await fetch(`${BASE_URL}/notifications/read-all`, {
      method: 'PATCH',
      headers: authHeaders
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const data = await res.json();
    assert(
      res.status === 200 && allowOrigin === TEST_ORIGIN && data.status === 'success',
      'PATCH /notifications/read-all',
      `Status: ${res.status}, Marked Count: ${data.data?.count}, Allow-Origin: ${allowOrigin}`
    );
  } catch (err) {
    assert(false, 'PATCH /notifications/read-all', `Error: ${err.message}`);
  }

  // F. Waste Analytics (period=month)
  try {
    const res = await fetch(`${BASE_URL}/analytics/waste?period=month`, {
      method: 'GET',
      headers: authHeaders
    });
    const data = await res.json();
    assert(
      res.status === 200 && data.status === 'success',
      'GET /analytics/waste?period=month',
      `Status: ${res.status}, Total Items Wasted: ${data.data?.total_items_wasted}`
    );
  } catch (err) {
    assert(false, 'GET /analytics/waste?period=month', `Error: ${err.message}`);
  }

  // G. Savings Analytics
  try {
    const res = await fetch(`${BASE_URL}/analytics/savings`, {
      method: 'GET',
      headers: authHeaders
    });
    const data = await res.json();
    assert(
      res.status === 200 && data.status === 'success',
      'GET /analytics/savings',
      `Status: ${res.status}, Total Estimated Savings: ₹${data.data?.total_estimated_savings}`
    );
  } catch (err) {
    assert(false, 'GET /analytics/savings', `Error: ${err.message}`);
  }

  // H. Most Wasted Items
  try {
    const res = await fetch(`${BASE_URL}/analytics/most-wasted`, {
      method: 'GET',
      headers: authHeaders
    });
    const data = await res.json();
    assert(
      res.status === 200 && data.status === 'success',
      'GET /analytics/most-wasted',
      `Status: ${res.status}, Unique Wasted Items: ${data.data?.total_unique_items_wasted}`
    );
  } catch (err) {
    assert(false, 'GET /analytics/most-wasted', `Error: ${err.message}`);
  }

  // I. User Profile
  try {
    const res = await fetch(`${BASE_URL}/profile`, {
      method: 'GET',
      headers: authHeaders
    });
    const data = await res.json();
    assert(
      res.status === 200 && data.data?.user?.email,
      'GET /profile',
      `Status: ${res.status}, Profile Name: ${data.data?.user?.name}`
    );
  } catch (err) {
    assert(false, 'GET /profile', `Error: ${err.message}`);
  }

  // J. Devices & Telemetry
  try {
    const res = await fetch(`${BASE_URL}/devices`, {
      method: 'GET',
      headers: authHeaders
    });
    const data = await res.json();
    const devices = data.data?.devices || [];
    assert(
      res.status === 200 && Array.isArray(devices),
      'GET /devices',
      `Status: ${res.status}, Registered Devices: ${devices.length}`
    );
  } catch (err) {
    assert(false, 'GET /devices', `Error: ${err.message}`);
  }

  console.log('\n===============================================================');
  console.log(`VERIFICATION SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

run();
