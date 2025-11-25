// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// Security
import SessionValidator from "./contexts/SessionValidator";

// Pages
import App from "./App.jsx";
import Login from "./pages/login.jsx";
import Dashboard from "./pages/dashboard.jsx"; 
import ElderlyManagement from "./pages/elderlyManagement.jsx";
import EditCaregiverProfile from "./pages/edit_cg_profile.jsx";
import EditNurseProfile from "./pages/edit_nurse_profile.jsx";
import ProfileCaregiver from "./pages/profileCaregiver.jsx";
import ProfileNurse from "./pages/profileNurse.jsx";
import Profile_Elderly from "./pages/profileElderly.jsx";
import HouseView from "./pages/houseView.jsx";
import Notifications from "./pages/notifications.jsx";
import Schedule from "./pages/schedule.jsx";
import Accounts from "./pages/accounts.jsx";
import EditAdminProfile from "./pages/edit_admin_profile.jsx";
import EditElderlyProfile from "./pages/edit_elderly_profile";
import EditCaregiverOverlay from "./pages/edit_cg_overlay"; // ✅ added
import EditNurseOverlay from "./pages/edit_nurse_overlay"; // ✅ added
import NurseSchedule from "./pages/nurse-schedule.jsx";
import IncidentReports from "./pages/incidentReports.jsx";
import ShiftLogs from "./pages/shift-logs.jsx";
import MedicationManagement from "./pages/medication_management.jsx";
import VitalMonitoring from "./pages/vital_monitoring.jsx";


ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    {/* 🔐 Session Validator - Monitors for multiple simultaneous logins */}
    <SessionValidator />
    
    <Routes>
      {/* Default route redirects to login */}
      <Route path="/" element={<Navigate to="/login" replace />} />

      {/* App routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/elderlyManagement" element={<ElderlyManagement />} /> 
      <Route path="/edit_cg_profile" element={<EditCaregiverProfile />} />
      <Route path="/edit_admin_profile" element={<EditAdminProfile />} />
      <Route path="/edit_nurse_profile" element={<EditNurseProfile />} />
      <Route path="/profileCaregiver/:id" element={<ProfileCaregiver />} />
      <Route path="/profileNurse/:id" element={<ProfileNurse />} />
      <Route path="/profileElderly/:id" element={<Profile_Elderly />} />
      <Route path="/house/:houseId" element={<HouseView />} />
      <Route path="/notifications" element={<Notifications />} />
      <Route path="/schedule" element={<Schedule />} />
      <Route path="/accounts" element={<Accounts />} />
      <Route path="/edit_elderly_profile/:id" element={<EditElderlyProfile />} />
      <Route path="/edit_caregiver_overlay/:id" element={<EditCaregiverOverlay />} /> {/* ✅ added */}
      <Route path="/edit_nurse_overlay/:id" element={<EditNurseOverlay />} /> {/* ✅ added */}
      <Route path="/nurse-schedule" element={<NurseSchedule />} />
      <Route path="/incident-reports" element={<IncidentReports />} />
      <Route path="/shift-logs" element={<ShiftLogs />} />
      <Route path="/summary-vitals-meds" element={<MedicationManagement />} />
      <Route path="/vital-monitoring" element={<VitalMonitoring />} />

    </Routes>
  </BrowserRouter>
);
