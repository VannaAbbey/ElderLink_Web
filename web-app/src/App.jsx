// src/App.jsx
import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";

// Pages
import Navbar from "./pages/navbar";
import Login from "./pages/login";
import Dashboard from "./pages/Dashboard";
import ElderlyManagement from "./pages/elderlyManagement";
import EditCgAssign from "./pages/edit_cg_assign";
import EditCaregiverProfile from "./pages/edit_cg_profile";
import EditNurseProfile from "./pages/edit_nurse_profile";
import Profile_Elderly from "./pages/profileElderly";
import ProfileCaregiver from "./pages/profileCaregiver";
import ProfileNurse from "./pages/profileNurse";
import HouseView from "./pages/houseView";
import Notifications from "./pages/Notifications";
import Schedule from "./pages/Schedule";
import Accounts from "./pages/accounts";
import EditAdminProfile from "./pages/edit_admin_profile";
import EditElderlyProfile from "./pages/edit_elderly_profile";

// --- ProtectedRoute Component ---
function ProtectedRoute({ user, children }) {
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// --- App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <Router>
      {user && <Navbar />}
      <Routes>
        {/* Public Route */}
        <Route path="/login" element={<Login />} />

        {/* Protected Routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute user={user}>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/elderlyManagement"
          element={
            <ProtectedRoute user={user}>
              <ElderlyManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/edit_cg_assign"
          element={
            <ProtectedRoute user={user}>
              <EditCgAssign />
            </ProtectedRoute>
          }
        />
        <Route
          path="/edit_cg_profile"
          element={
            <ProtectedRoute user={user}>
              <EditCaregiverProfile />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profileCaregiver/:id"
          element={
            <ProtectedRoute user={user}>
              <ProfileCaregiver />
            </ProtectedRoute>
          }
        />
        <Route
          path="/edit_nurse_profile"
          element={
            <ProtectedRoute user={user}>
              <EditNurseProfile />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profileNurse/:id"
          element={
            <ProtectedRoute user={user}>
              <ProfileNurse />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profileElderly/:id"
          element={
            <ProtectedRoute user={user}>
              <Profile_Elderly />
            </ProtectedRoute>
          }
        />
        <Route
          path="/house/:houseId"
          element={
            <ProtectedRoute user={user}>
              <HouseView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <ProtectedRoute user={user}>
              <Notifications />
            </ProtectedRoute>
          }
        />
        <Route
          path="/schedule"
          element={
            <ProtectedRoute user={user}>
              <Schedule />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounts"
          element={
            <ProtectedRoute user={user}>
              <Accounts />
            </ProtectedRoute>
          }
        />

        <Route
          path="/edit_admin_profile"
          element={
            <ProtectedRoute user={user}>
              <EditAdminProfile />
            </ProtectedRoute>
          }
        />

          <Route path="/edit_elderly_profile/:id" element={<EditElderlyProfile />} /> {/* ✅ new route */}


        {/* Fallback Route */}
        <Route
          path="*"
          element={<Navigate to={user ? "/" : "/login"} replace />}
        />
      </Routes>
    </Router>
  );
}
