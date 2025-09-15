import React, { useState } from "react";
import Navbar from "./navbar";
import EditCgProfile from "./edit_cg_profile";
import EditNurseProfile from "./edit_nurse_profile";
import "./accounts.css"; 

export default function Accounts() {
  const [activeTab, setActiveTab] = useState("caregiver");

  return (
    <div>
      <Navbar />

      <div className="accounts-container">
        <h1 className="accounts-title">Accounts Management</h1>

        {/* --- Tabs --- */}
        <div className="accounts-tabs">
          <button onClick={() => setActiveTab("caregiver")}
            className={`accounts-tab ${activeTab === "caregiver" ? "active" : ""}`}> Caregivers
          </button>

          <button onClick={() => setActiveTab("nurse")}
            className={`accounts-tab ${activeTab === "nurse" ? "active" : ""}`}> Nurses
          </button>
        </div>

        {/* --- Content --- */}
        <div className="accounts-content">
          {activeTab === "caregiver" && <EditCgProfile />}
          {activeTab === "nurse" && <EditNurseProfile />}
        </div>
      </div>
    </div>
  );
}
