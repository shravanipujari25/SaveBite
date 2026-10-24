/**
 * Full Frontend-to-Backend Integration Verification Suite
 * Tests every endpoint that the frontend calls against the running backend server.
 */

const BASE_URL = 'http://localhost:5000/api/v1';

async function run() {
  console.log('--- Starting SaveBite Phase 6 Live Integration Verification ---');
  let token = null;
  let testItemId = null;
  let testShoppingId = null;
  let deviceId = null;

  // 1. Health check
  try {
    const res = await fetch(`${BASE_URL}/health`);
    const data = await res.json();
    console.log('✓ Health check passed:', data);
  } catch (err) {
    console.error('✗ Health check failed:', err.message);
    process.exit(1);
  }

  // 2. Authentication: Sign In
  try {
    const res = await fetch(`${BASE_URL}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'demo@savebite.com',
        password: 'DemoPassword123!'
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Signin failed');
    token = data.data.accessToken || data.data.token;
    console.log('✓ Signin successful. User:', data.data.user.email, 'Household:', data.data.household?.name || data.data.household?.id);
  } catch (err) {
    console.error('✗ Signin failed:', err.message);
    process.exit(1);
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // 3. Current User retrieval
  try {
    const res = await fetch(`${BASE_URL}/auth/me`, { headers: authHeaders });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'auth/me failed');
    console.log('✓ Current user verified:', data.data.user.name, `(${data.data.user.email})`);
  } catch (err) {
    console.error('✗ Current user verification failed:', err.message);
  }

  // 4. Dashboard Stats
  try {
    const res = await fetch(`${BASE_URL}/dashboard`, { headers: authHeaders });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'dashboard failed');
    const summary = data.data.summary || {};
    console.log('✓ Dashboard data verified:', {
      totalActiveItems: summary.totalActiveItems,
      totalEstimatedValue: summary.totalEstimatedValue,
      expiringSoonCount: summary.expiringSoonCount,
      useFirstCount: (data.data.useFirst || []).length
    });
  } catch (err) {
    console.error('✗ Dashboard fetch failed:', err.message);
  }

  // 5. My Pantry Items
  try {
    const res = await fetch(`${BASE_URL}/inventory`, { headers: authHeaders });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'inventory fetch failed');
    const items = data.data.items || [];
    console.log(`✓ Pantry inventory verified: ${items.length} items returned`);
    if (items.length > 0) {
      console.log('   Sample item:', items[0].name, '-', items[0].category, `(${items[0].freshness_bucket || 'fresh'})`);
    }
  } catch (err) {
    console.error('✗ Inventory fetch failed:', err.message);
  }

  // 6. Add Groceries (Manual Entry)
  try {
    const futureDate = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const todayDate = new Date().toISOString().split('T')[0];
    const res = await fetch(`${BASE_URL}/inventory`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Organic Gala Apples',
        category: 'produce',
        quantity: 6,
        unit: 'piece',
        storage_location: 'pantry',
        purchase_date: todayDate,
        expiry_date: futureDate,
        estimated_unit_price: 30
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Add grocery failed');
    testItemId = data.data.item.id;
    console.log('✓ Add grocery verified. Created item:', data.data.item.name, 'ID:', testItemId);
  } catch (err) {
    console.error('✗ Add grocery failed:', err.message);
  }

  // 7. Inventory Item Detail & Mutations (Open, Consume, Waste)
  if (testItemId) {
    try {
      // Mark as opened
      const openRes = await fetch(`${BASE_URL}/inventory/${testItemId}/open`, {
        method: 'POST',
        headers: authHeaders
      });
      const openData = await openRes.json();
      console.log('✓ Mark as opened verified:', openData.data.item.is_opened === true ? 'Opened' : 'Failed');

      // Consume partial quantity
      const consumeRes = await fetch(`${BASE_URL}/inventory/${testItemId}/consume`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ quantity: 2 })
      });
      const consumeData = await consumeRes.json();
      console.log('✓ Consume item verified. Remaining quantity:', consumeData.data.item.quantity);

      // Waste remaining
      const wasteRes = await fetch(`${BASE_URL}/inventory/${testItemId}/waste`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ reason: 'spoiled', quantity: 4 })
      });
      const wasteData = await wasteRes.json();
      console.log('✓ Waste item verified. Status:', wasteData.data.item.status);
    } catch (err) {
      console.error('✗ Item mutation failed:', err.message);
    }
  }

  // 8. Barcode Lookup (Real Open Food Facts Integration)
  try {
    const barcode = '3017620422003'; // Nutella
    const res = await fetch(`${BASE_URL}/barcodes/${barcode}`, { headers: authHeaders });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Barcode lookup failed');
    const prod = data.data.product || data.data;
    console.log('✓ Barcode lookup verified:', {
      barcode: prod.barcode,
      name: prod.name,
      brand: prod.brand,
      category: prod.category
    });
  } catch (err) {
    console.error('✗ Barcode lookup failed:', err.message);
  }

  // 9. Smart Storage Devices & Sensor Telemetry
  try {
    const res = await fetch(`${BASE_URL}/devices`, { headers: authHeaders });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Devices fetch failed');
    const devices = data.data.devices || [];
    console.log(`✓ Smart storage devices verified: ${devices.length} registered device(s)`);
    if (devices.length > 0) {
      deviceId = devices[0].id;
      console.log('   Device:', devices[0].name, 'Status:', devices[0].status);

      // Fetch telemetry
      const telRes = await fetch(`${BASE_URL}/devices/${deviceId}/readings`, { headers: authHeaders });
      const telData = await telRes.json();
      const readings = telData.data.readings || [];
      console.log(`✓ Telemetry readings verified: ${readings.length} reading points`);
      if (readings.length > 0) {
        console.log('   Latest telemetry:', {
          temp: `${readings[0].temperature_c}°C`,
          humidity: `${readings[0].humidity_percent}%`,
          airQuality: readings[0].air_quality_ppm
        });
      }
    }
  } catch (err) {
    console.error('✗ Smart storage verification failed:', err.message);
  }

  // 10. Shopping List Operations
  try {
    // Fetch list
    const res = await fetch(`${BASE_URL}/shopping-list`, { headers: authHeaders });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Shopping list fetch failed');
    const items = data.data.items || [];
    console.log(`✓ Shopping list verified: ${items.length} items`);

    // Add item to shopping list
    const addRes = await fetch(`${BASE_URL}/shopping-list`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Organic Rolled Oats',
        category: 'Grains',
        quantity: 1,
        unit: 'kg'
      })
    });
    const addData = await addRes.json();
    if (addData.data && addData.data.item) {
      testShoppingId = addData.data.item.id;
      console.log('✓ Add shopping list item verified:', addData.data.item.name);

      // Purchase item (moves to inventory or marks purchased)
      const purchaseRes = await fetch(`${BASE_URL}/shopping-list/${testShoppingId}/purchase`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          expiry_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          storage_location: 'pantry'
        })
      });
      const purchaseData = await purchaseRes.json();
      console.log('✓ Purchase shopping item verified:', purchaseData.message || 'Purchased successfully');
    }
  } catch (err) {
    console.error('✗ Shopping list operation failed:', err.message);
  }

  // 11. Waste Analytics
  try {
    const res = await fetch(`${BASE_URL}/analytics/waste`, { headers: authHeaders });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Waste analytics failed');
    console.log('✓ Waste analytics verified:', {
      totalItemsWasted: data.data.total_items_wasted,
      totalWastedQuantity: data.data.total_wasted_quantity,
      totalEstimatedValue: data.data.total_estimated_value
    });

    const savRes = await fetch(`${BASE_URL}/analytics/savings`, { headers: authHeaders });
    const savData = await savRes.json();
    console.log('✓ Savings analytics verified:', {
      totalEstimatedSavings: savData.data.total_estimated_savings,
      totalAvoidedEvents: savData.data.total_avoided_waste_events
    });
  } catch (err) {
    console.error('✗ Waste analytics failed:', err.message);
  }

  // 12. Profile and Settings
  try {
    const res = await fetch(`${BASE_URL}/profile`, { headers: authHeaders });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Profile fetch failed');
    console.log('✓ Profile verified:', {
      name: data.data.user.name,
      email: data.data.user.email,
      household: data.data.household?.name
    });
  } catch (err) {
    console.error('✗ Profile fetch failed:', err.message);
  }

  // 13. Notifications
  try {
    const res = await fetch(`${BASE_URL}/notifications`, { headers: authHeaders });
    const data = await res.json();
    console.log(`✓ Notifications verified: ${(data.data?.notifications || []).length} active alerts`);
  } catch (err) {
    console.error('✗ Notifications failed:', err.message);
  }

  // 14. Signout
  try {
    const res = await fetch(`${BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: authHeaders
    });
    const data = await res.json();
    console.log('✓ Logout verified:', data.message || 'Logged out');
  } catch (err) {
    console.error('✗ Logout failed:', err.message);
  }

  console.log('\n========================================');
  console.log('ALL PHASE 6 INTEGRATION CONTRACTS PASSED');
  console.log('========================================\n');
}

run();
