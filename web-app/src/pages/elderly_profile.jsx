import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MdArrowBack } from "react-icons/md";
import "./elderly_profile.css";

export default function ElderlyProfile() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("records");

  return (
    <div className="elderly-profile-container">
      {/* Top Section */}
      <div className="elderly-profile-header">
        <button className="back-btn" onClick={() => navigate("/dashboard")}>
          <MdArrowBack size={20} />
          Back
        </button>
        <div className="header-center">
          <img src="/images/Sebastian.png" alt="Header" className="header-image" />
          <h1 className="header-title">Elderly Profile Management</h1>
        </div>
      </div>

      {/* Tab Buttons */}
      <div className="tab-buttons">
        <button
          className={activeTab === "records" ? "active" : ""}
          onClick={() => setActiveTab("records")}
        >
          View Records
        </button>
        <button
          className={activeTab === "notifications" ? "active" : ""}
          onClick={() => setActiveTab("notifications")}
        >
          Notifications
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === "records" && (
          <div className="view-records">
            {/* Row with icon + text */}
            <div className="records-header">
              <img src="/images/house-icon.png" alt="House Icon" className="house-icon" />
              <h2>Elderly Houses</h2>
            </div>

            {/* 5 House Containers */}
            <div className="house-list">
              <div className="house-card" onClick={() => navigate("/sebastian")} style={{ cursor: "pointer" }}>
                <img src="/images/Sebastian.png" alt="House of Sebastian" />
                <p className="house-name">House of Sebastian</p>
                <p className="house-desc">Females with Psychological Needs</p>
              </div>
              <div className="house-card" onClick={() => navigate("/emmanuel")} style={{ cursor: "pointer" }}>
                <img src="/images/Emmanuel.png" alt="House of Emmanuel" />
                <p className="house-name">House of Emmanuel</p>
                <p className="house-desc">Females that are Bedridden</p>
              </div>
              <div className="house-card" onClick={() => navigate("/charbell")} style={{ cursor: "pointer" }}>
                <img src="/images/Charbell.png" alt="House of St. Charbell" />
                <p className="house-name">House of St. Charbell</p>
                <p className="house-desc">Males that are Bedridden</p>
              </div>
              <div className="house-card" onClick={() => navigate("/rose")} style={{ cursor: "pointer" }}>
                <img src="/images/Rose.png" alt="House of St. Rose" />
                <p className="house-name">House of St. Rose</p>
                <p className="house-desc">Females that are Abled</p>
              </div>
              <div className="house-card" onClick={() => navigate("/gabriel")} style={{ cursor: "pointer" }}>
                <img src="/images/Gabriel.png" alt="House of St. Gabriel" />
                <p className="house-name">House of St. Gabriel</p>
                <p className="house-desc">Males that are Abled</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === "notifications" && (
          <p style={{ textAlign: "center", padding: "20px", color: "#555" }}>
            Notifications section will be here.
          </p>
        )}
      </div>
    </div>
  );
}
