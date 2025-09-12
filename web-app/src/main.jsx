// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import Login from "./pages/login.jsx";
import Dashboard from "./pages/dashboard.jsx"; 
import ElderlyManagement from "./pages/elderlyManagement.jsx";
import EditCaregiverProfile from "./pages/edit_cg_profile.jsx";
import EditNurseProfile from "./pages/edit_nurse_profile.jsx";
import Profile_Elderly from "./pages/profileElderly.jsx";
import HouseView from "./pages/houseView.jsx";
import Notifications from "./pages/notifications.jsx";
import Schedule from "./pages/schedule.jsx";
import ScheduleV2 from "./pages/schedule-v2.jsx";



ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/elderlyManagement" element={<ElderlyManagement />} /> 
      <Route path="/edit_cg_profile" element={<EditCaregiverProfile />} />
      <Route path="/edit_nurse_profile" element={<EditNurseProfile />} />
      <Route path="/profileElderly/:id" element={<Profile_Elderly />} />
      <Route path="/house/:houseId" element={<HouseView />} />
      <Route path="/notifications" element={<Notifications />} />
      <Route path="/schedule" element={<Schedule />} />
      <Route path="/schedule-v2" element={<ScheduleV2 />} />
    </Routes>
  </BrowserRouter>
);
