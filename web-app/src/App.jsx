import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";

import Navbar from "./pages/navbar";
import Login from "./pages/login";
import Dashboard from "./pages/Dashboard";
import ElderlyManagement from "./pages/elderlyManagement";
import EditCgAssign from "./pages/edit_cg_assign";
import EditCaregiverProfile from "./pages/edit_cg_profile";
import EditNurseProfile from "./pages/edit_nurse_profile";
import Profile_Elderly from "./pages/profileElderly";
import HouseView from "./pages/houseView";
import Notifications from "./pages/Notifications";
import Schedule from "./pages/Schedule";

// ProtectedRoute redirects if user is not logged in
function ProtectedRoute({ user, children }) {
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      console.log("Auth state changed:", currentUser);
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
        {/* Public route */}
        <Route path="/login" element={<Login />} />

        {/* Protected routes */}
        <Route path="/" element={<ProtectedRoute user={user}><Dashboard /></ProtectedRoute>} />
        <Route path="/elderlyManagement" element={<ProtectedRoute user={user}><ElderlyManagement /></ProtectedRoute>} />
        <Route path="/edit_cg_assign" element={<ProtectedRoute user={user}><EditCgAssign /></ProtectedRoute>} />
        <Route path="/edit_cg_profile" element={<ProtectedRoute user={user}><EditCaregiverProfile /></ProtectedRoute>} />
        <Route path="/edit_nurse_profile" element={<ProtectedRoute user={user}><EditNurseProfile /></ProtectedRoute>} />
        <Route path="/profileElderly/:id" element={<ProtectedRoute user={user}><Profile_Elderly /></ProtectedRoute>} />
        <Route path="/house/:houseId" element={<ProtectedRoute user={user}><HouseView /></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute user={user}><Notifications /></ProtectedRoute>} />
        <Route path="/schedule" element={<ProtectedRoute user={user}><Schedule /></ProtectedRoute>} />

        {/* Fallback route */}
        <Route path="*" element={user ? <Navigate to="/" replace /> : <Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}
