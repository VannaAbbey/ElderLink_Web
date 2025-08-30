// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import Login from "./pages/login.jsx";
import Dashboard from "./pages/dashboard.jsx"; 
import ElderlyManagement from "./pages/elderlyManagement.jsx";
import EditCgAssign from "./pages/edit_cg_assign.jsx";
import EditCaregiverProfile from "./pages/edit_cg_profile";
import EditNurseProfile from "./pages/edit_nurse_profile";
import Profile_Elderly from "./pages/profileElderly.jsx";
import HouseView from "./pages/houseView";



ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/elderlyManagement" element={<ElderlyManagement />} /> 
      <Route path="/edit_cg_assign" element={<EditCgAssign />} />
      <Route path="/edit_cg_profile" element={<EditCaregiverProfile />} />
      <Route path="/edit_nurse_profile" element={<EditNurseProfile />} />
      <Route path="/profileElderly/:id" element={<Profile_Elderly />} />
      <Route path="/house/:houseId" element={<HouseView />} />

    </Routes>
  </BrowserRouter>
);
