import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { NotificationProvider } from './context/NotificationContext'
import { PantryProvider } from './context/PantryContext'

// Route Guards
import ProtectedRoute from './components/common/ProtectedRoute'
import PublicRoute from './components/common/PublicRoute'

// Layouts
import AppLayout from './layouts/AppLayout'
import AuthLayout from './layouts/AuthLayout'

// Application Pages
import DashboardPage from './pages/DashboardPage'
import PantryPage from './pages/PantryPage'
import AddGroceryPage from './pages/AddGroceryPage'
import StoragePage from './pages/StoragePage'
import RecipesPage from './pages/RecipesPage'
import ShoppingListPage from './pages/ShoppingListPage'
import AnalyticsPage from './pages/AnalyticsPage'
import AssistantPage from './pages/AssistantPage'
import ProfilePage from './pages/ProfilePage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import NotFoundPage from './pages/NotFoundPage'

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <PantryProvider>
            <Routes>
              {/* Root redirect to Dashboard (guarded) */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />

              {/* Public Authentication Routes (Guarded from logged-in users) */}
              <Route element={<PublicRoute />}>
                <Route element={<AuthLayout />}>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/signup" element={<SignupPage />} />
                </Route>
              </Route>

              {/* Protected Application Routes (Requires Authentication) */}
              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/pantry" element={<PantryPage />} />
                  <Route path="/groceries/add" element={<AddGroceryPage />} />
                  <Route path="/storage" element={<StoragePage />} />
                  <Route path="/recipes" element={<RecipesPage />} />
                  <Route path="/shopping-list" element={<ShoppingListPage />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                  <Route path="/assistant" element={<AssistantPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>

              {/* 404 Route */}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </PantryProvider>
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
