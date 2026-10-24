# SaveBite Frontend — Phase 0: Foundation Setup

SaveBite is a mobile-first grocery intelligence and food-waste management web application designed to help households track inventory freshness, monitor IoT storage conditions, plan waste-less meals, and reduce food waste and grocery expenses.

> **Tagline**: *"Save Food. Save Money. Waste Less."*  
> **Aesthetic Identity**: Fresh emerald green & warm oatmeal cream, rounded cards, tactile micro-interactions, mobile-first navigation.

---

## 1. Quick Start & Commands

### Prerequisites
- Node.js (v18+)
- npm (v9+)

### Installation
```bash
# From workspace root:
cd frontend

# Install dependencies (React 19, Tailwind v4, React Router 7, Recharts 3, Supabase, Lucide):
npm install --legacy-peer-deps
```

### Running Locally
```bash
# Start local Vite development server:
npm run dev

# The app will be running at:
http://localhost:5173/
```

### Production Build & Verification
```bash
npm run build
npm run preview
```

---

## 2. Project Structure

```text
frontend/
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── common/
│   │   │   ├── Badge.jsx             # Freshness & category badges
│   │   │   ├── Button.jsx            # Reusable button with variants & loading state
│   │   │   ├── Card.jsx              # Rounded container cards with hover effects
│   │   │   ├── EmptyState.jsx        # Illustrated empty state container
│   │   │   ├── ErrorState.jsx        # Fallback error state with retry action
│   │   │   ├── Input.jsx             # Accessible input with icon slots & validation
│   │   │   ├── LoadingSpinner.jsx    # Spinner & skeleton placeholder animations
│   │   │   └── Modal.jsx             # Dialog overlay with keyboard & backdrop controls
│   │   ├── layout/
│   │   │   ├── BottomNav.jsx         # Mobile 5-target bottom navigation
│   │   │   ├── NotificationBell.jsx  # Alert bell with interactive dropdown
│   │   │   ├── Sidebar.jsx           # Desktop navigation with live climate telemetry pill
│   │   │   ├── TopHeader.jsx         # Shared header with breadcrumb & actions
│   │   │   └── UserProfileMenu.jsx   # Profile dropdown & sign-out trigger
│   │   ├── dashboard/
│   │   │   ├── ExpiryAlerts.jsx      # Urgent expiry card with "Rescue Meal" link
│   │   │   ├── FreshnessDonut.jsx    # Recharts freshness distribution donut
│   │   │   └── MetricsSummary.jsx    # KPI summary cards
│   │   ├── pantry/
│   │   │   ├── PantryFilterBar.jsx   # Search + location & status filter pills
│   │   │   └── PantryItemCard.jsx    # Grocery card with days remaining & actions
│   │   └── storage/
│   │       ├── SensorGauge.jsx       # Real-time IoT temperature/humidity/ethylene card
│   │       └── StorageCard.jsx       # Zone status preview card
│   ├── pages/
│   │   ├── DashboardPage.jsx         # KPI overview, donut chart, urgent alerts
│   │   ├── PantryPage.jsx            # Grocery inventory list, search & filter
│   │   ├── AddGroceryPage.jsx        # Grocery logging form with emoji presets
│   │   ├── StoragePage.jsx           # IoT hardware telemetry & climate diagnostics
│   │   ├── RecipesPage.jsx           # Waste-less recipes matching expiring groceries
│   │   ├── ShoppingListPage.jsx      # Auto-restock list with interactive checkboxes
│   │   ├── AnalyticsPage.jsx         # Waste trends Recharts bar chart & savings
│   │   ├── AssistantPage.jsx         # SaveBite AI copilot chat interface
│   │   ├── ProfilePage.jsx           # Household members & dietary preferences
│   │   ├── SettingsPage.jsx          # Regional units, alerts & API status
│   │   ├── LoginPage.jsx             # Authentication login with demo credentials
│   │   ├── SignupPage.jsx            # Registration page
│   │   └── NotFoundPage.jsx          # Custom 404 page
│   ├── layouts/
│   │   ├── AppLayout.jsx             # Sidebar + Header + BottomNav shared shell
│   │   └── AuthLayout.jsx            # Minimalist brand card authentication shell
│   ├── api/
│   │   └── client.js                 # Unified API client with live/mock modes & localStorage
│   ├── mocks/
│   │   ├── pantryItems.json          # 10 realistic grocery items across zones
│   │   ├── freshnessBuckets.json     # Summary counts & distribution metrics
│   │   ├── dashboardMetrics.json     # Waste reduction, carbon, and savings metrics
│   │   ├── sensorReadings.json       # Fridge, freezer & pantry IoT node metrics
│   │   ├── storageAlerts.json        # Climate alerts (temperature, ethylene gas, door)
│   │   ├── recipes.json              # Waste-less recipes with matched ingredients
│   │   ├── shoppingList.json         # Auto-replenishment shopping entries
│   │   ├── wasteAnalytics.json       # Weekly trends & top wasted categories
│   │   ├── userPreferences.json      # Household profile, units & notification flags
│   │   └── assistantConversations.json # AI chat prompts & recommendations
│   ├── hooks/
│   │   ├── useDashboard.js           # Dashboard metrics & freshness loader
│   │   └── useStorage.js             # IoT sensors & storage alerts polling
│   ├── context/
│   │   ├── AuthContext.jsx           # User authentication state & mock login/logout
│   │   ├── NotificationContext.jsx   # Live storage alerts & mark-as-read state
│   │   └── PantryContext.jsx         # Centralized pantry inventory state
│   ├── lib/
│   │   └── supabase.js               # Safe fallback Supabase client initialization
│   ├── utils/
│   │   ├── formatters.js             # Currency, date, and temperature formatters
│   │   └── freshness.js              # Freshness calculations & badge color tokens
│   ├── App.jsx                       # React Router configuration
│   ├── main.jsx                      # React 19 root
│   └── index.css                     # Tailwind CSS v4 setup & theme variables
├── .env                              # Local development environment defaults
├── .env.example                      # Template environment variables
├── package.json
└── README.md
```

---

## 3. Application Routes

| Path | Layout | Description |
| :--- | :--- | :--- |
| `/login` | `AuthLayout` | Sign in with demo credentials or custom account |
| `/signup` | `AuthLayout` | Register household profile and preferences |
| `/` | Redirect | Redirects to `/dashboard` |
| `/dashboard` | `AppLayout` | High-level pantry overview, freshness donut, metrics |
| `/pantry` | `AppLayout` | Inventory management, search, zone filter |
| `/groceries/add` | `AppLayout` | Grocery logging form with preset expiry shortcuts |
| `/storage` | `AppLayout` | IoT sensor telemetry (temperature, humidity, ethylene) |
| `/recipes` | `AppLayout` | Waste-less recipes prioritized by expiring pantry items |
| `/shopping-list` | `AppLayout` | Auto-replenishment list with checkbox completion |
| `/analytics` | `AppLayout` | Weekly waste trends, financial loss, ecological impact |
| `/assistant` | `AppLayout` | Context-aware AI assistant chat interface |
| `/profile` | `AppLayout` | Household admin, dietary restrictions, eco streaks |
| `/settings` | `AppLayout` | Currency, temperature units, push alert toggles |
| `*` | Custom | 404 Not Found error page |

---

## 4. Proposed Backend Contracts & API Specifications

The frontend client in `src/api/client.js` is designed with an interchangeable interface. When `VITE_USE_MOCKS=false`, all calls route directly to `VITE_API_BASE_URL`.

### A. Pantry & Inventory Endpoints

#### `GET /api/pantry`
- **Response `200 OK`**:
```json
[
  {
    "id": "item_01",
    "name": "Organic Whole Milk",
    "category": "Dairy & Eggs",
    "quantity": 1,
    "unit": "liter",
    "location": "fridge",
    "storageZone": "Shelf 2 - Top",
    "purchaseDate": "2026-10-18",
    "expiryDate": "2026-10-25",
    "freshnessScore": 25,
    "status": "critical",
    "estimatedCost": 4.29,
    "barcode": "8901030928114",
    "imageEmoji": "🥛",
    "notes": "Opened 2 days ago."
  }
]
```

#### `POST /api/pantry`
- **Request Body**:
```json
{
  "name": "string (required)",
  "category": "string (required)",
  "quantity": "number (required)",
  "unit": "string (required)",
  "location": "fridge | pantry | freezer",
  "storageZone": "string (optional)",
  "expiryDate": "YYYY-MM-DD (required)",
  "estimatedCost": "number (optional)",
  "imageEmoji": "string (optional)",
  "notes": "string (optional)"
}
```
- **Response `201 Created`**: Returns the saved item object including generated `id`.

#### `PUT /api/pantry/:id`
- **Request Body**: Partial update object.
- **Response `200 OK`**: Updated item object.

#### `DELETE /api/pantry/:id`
- **Response `200 OK`**: `{ "success": true, "id": "item_01" }`

---

### B. IoT Telemetry & MQTT Specifications

#### Sensor Node Telemetry Contract
- **MQTT Topic**: `savebite/devices/{nodeId}/telemetry`
- **Publish Frequency**: Every 60 seconds (or immediately on threshold violation / door open)
- **Quality of Service**: QoS 1

```json
{
  "nodeId": "sensor_fridge_01",
  "zone": "fridge",
  "temperature": 3.8,
  "unitTemp": "°C",
  "humidity": 68.0,
  "unitHumidity": "%",
  "ethyleneGasPpm": 0.4,
  "ethyleneStatus": "Normal",
  "doorOpen": false,
  "doorOpenDurationSeconds": 0,
  "batteryLevel": 92,
  "timestamp": "2026-10-24T10:12:00Z"
}
```

#### Storage Alerts Contract
- **Endpoint**: `GET /api/storage/alerts`
- **MQTT Topic**: `savebite/alerts/{householdId}`
- **Payload**:
```json
[
  {
    "id": "alert_01",
    "severity": "critical | warning | info",
    "type": "ethylene_gas | temperature_spike | door_open | expiry_urgent",
    "sensorNodeId": "sensor_pantry_01",
    "zone": "pantry",
    "title": "Ethylene Gas Warning in Pantry",
    "message": "Pantry sensor detected 0.9 ppm ethylene gas.",
    "recommendation": "Isolate ripe avocados to prevent premature spoilage.",
    "timestamp": "2026-10-24T09:45:00Z",
    "isRead": false
  }
]
```

---

### C. Proposed Supabase Database Schema

```sql
-- 1. Households
CREATE TABLE households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Household Users
CREATE TABLE household_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  display_name TEXT,
  avatar_url TEXT
);

-- 3. Pantry Items
CREATE TABLE pantry_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'pcs',
  location TEXT NOT NULL CHECK (location IN ('fridge', 'pantry', 'freezer')),
  storage_zone TEXT,
  purchase_date DATE DEFAULT CURRENT_DATE,
  expiry_date DATE NOT NULL,
  freshness_score INT DEFAULT 100,
  status TEXT DEFAULT 'fresh',
  estimated_cost NUMERIC(10,2),
  barcode TEXT,
  image_emoji TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. IoT Sensor Nodes
CREATE TABLE sensor_nodes (
  id TEXT PRIMARY KEY,
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  zone TEXT NOT NULL,
  location_name TEXT NOT NULL,
  last_temperature NUMERIC,
  last_humidity NUMERIC,
  last_ethylene NUMERIC,
  last_door_status BOOLEAN DEFAULT false,
  battery_level INT,
  last_seen TIMESTAMPTZ DEFAULT now()
);

-- 5. Storage Alerts
CREATE TABLE storage_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  node_id TEXT REFERENCES sensor_nodes(id),
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  recommendation TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Shopping List Entries
CREATE TABLE shopping_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  quantity NUMERIC DEFAULT 1,
  unit TEXT DEFAULT 'pack',
  estimated_price NUMERIC(10,2),
  is_auto_suggested BOOLEAN DEFAULT false,
  is_completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 5. Quality & Compliance Checklist

- [x] **React 19 + Vite 8**: Fast, modern bundling with zero build errors.
- [x] **Tailwind CSS v4**: Theme configured via `@theme` in `src/index.css`.
- [x] **Direct Route Navigation**: Verified direct URL routing across all 13 application routes.
- [x] **Safe Supabase Initialization**: `src/lib/supabase.js` safely guards against missing credentials and prevents runtime crashes.
- [x] **Reusable UI Primitives**: `Button`, `Input`, `Card`, `Badge`, `Modal`, `LoadingSpinner`, `EmptyState`, and `ErrorState`.
- [x] **Realistic Mock Engine**: Client supports localStorage persistence for adding/removing items, ticking off shopping items, and dismissing alerts.
- [x] **Production Build Verified**: Passes `npm run build` with clean bundles.
