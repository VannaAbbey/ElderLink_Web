// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import Login from "./pages/login.jsx";
import Dashboard from "./pages/dashboard.jsx"; 
import ElderlyProfile from "./pages/elderly_profile.jsx";
import Sebastian from "./pages/sebastian.jsx";
import Emmanuel from "./pages/emmanuel.jsx";
import Charbell from "./pages/charbell.jsx";
import Rose from "./pages/rose.jsx";
import Gabriel from "./pages/gabriel.jsx";



ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/elderly_profile" element={<ElderlyProfile />} /> 
      <Route path="/sebastian" element={<Sebastian />} /> 
      <Route path="/emmanuel" element={<Emmanuel />} />
      <Route path="/charbell" element={<Charbell />} />
      <Route path="/rose" element={<Rose />} />
      <Route path="/gabriel" element={<Gabriel />} />
    </Routes>
  </BrowserRouter>
);
