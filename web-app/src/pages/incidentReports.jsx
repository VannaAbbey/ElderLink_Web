// src/pages/incidentReports.jsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  getDoc
} from "firebase/firestore";
import Navbar from "./navbar";
import "../css/incidentReports.css";

export default function IncidentReports() {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState([]);
  const [filteredIncidents, setFilteredIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAllIncidents, setShowAllIncidents] = useState(false);
  
  // Set today's date as default
  const getTodayDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };
  
  const [selectedDate, setSelectedDate] = useState(getTodayDate());
  
  // Store user and elderly data for quick lookup
  const [usersData, setUsersData] = useState({});
  const [elderlyData, setElderlyData] = useState({});

  // Fetch all incidents in real-time
  useEffect(() => {
    console.log("📋 Fetching incident reports from Firestore...");
    
    const q = query(
      collection(db, "incident_report"), 
      orderBy("incident_date_time", "desc")
    );
    
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      console.log(`✅ Found ${snapshot.docs.length} incident reports`);
      
      const incidentData = await Promise.all(
        snapshot.docs.map(async (docSnap) => {
          const data = docSnap.data();
          console.log("📄 Processing incident:", docSnap.id, "elderly_id:", data.elderly_id);
          
          // Fetch caregiver name if user_id_cg exists
          let caregiverName = "Unknown Caregiver";
          if (data.user_id_cg) {
            try {
              const cgDoc = await getDoc(doc(db, "users", data.user_id_cg));
              if (cgDoc.exists()) {
                const cgData = cgDoc.data();
                caregiverName = `${cgData.user_fname || ""} ${cgData.user_lname || ""}`.trim();
              }
            } catch (error) {
              console.error("Error fetching caregiver:", error);
            }
          }
          
          // Fetch nurse names if user_id_nu exists (array)
          let nurseNames = [];
          if (data.user_id_nu && Array.isArray(data.user_id_nu)) {
            nurseNames = await Promise.all(
              data.user_id_nu.map(async (nurseId) => {
                try {
                  const nuDoc = await getDoc(doc(db, "users", nurseId));
                  if (nuDoc.exists()) {
                    const nuData = nuDoc.data();
                    return `${nuData.user_fname || ""} ${nuData.user_lname || ""}`.trim();
                  }
                } catch (error) {
                  console.error("Error fetching nurse:", error);
                }
                return "Unknown Nurse";
              })
            );
          }
          
          // Fetch elderly name if elderly_id exists
          let elderlyName = "Unknown Elderly";
          if (data.elderly_id) {
            try {
              console.log(`🔍 Fetching elderly data for ID: ${data.elderly_id}`);
              const elderlyDoc = await getDoc(doc(db, "elderly", data.elderly_id));
              if (elderlyDoc.exists()) {
                const elderlyData = elderlyDoc.data();
                console.log("✅ Found elderly data:", elderlyData);
                // Fixed: Use elderly_fname and elderly_lname (not fname/lname)
                elderlyName = `${elderlyData.elderly_fname || ""} ${elderlyData.elderly_lname || ""}`.trim();
                if (!elderlyName) {
                  elderlyName = "Unknown Elderly";
                }
              } else {
                console.warn(`⚠️ No elderly document found for ID: ${data.elderly_id}`);
              }
            } catch (error) {
              console.error("Error fetching elderly:", error);
            }
          }
          
          return {
            id: docSnap.id,
            ...data,
            caregiverName,
            nurseNames,
            elderlyName
          };
        })
      );
      
      setIncidents(incidentData);
      setFilteredIncidents(incidentData);
      setLoading(false);
    }, (error) => {
      console.error("❌ Error fetching incidents:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Filter incidents by selected date
  useEffect(() => {
    if (showAllIncidents || !selectedDate) {
      setFilteredIncidents(incidents);
      return;
    }

    const filtered = incidents.filter((incident) => {
      if (!incident.incident_date_time) return false;
      const incidentDate = incident.incident_date_time.toDate();
      const selectedDateObj = new Date(selectedDate);
      
      return (
        incidentDate.getFullYear() === selectedDateObj.getFullYear() &&
        incidentDate.getMonth() === selectedDateObj.getMonth() &&
        incidentDate.getDate() === selectedDateObj.getDate()
      );
    });

    setFilteredIncidents(filtered);
  }, [selectedDate, incidents, showAllIncidents]);

  // Toggle show all incidents
  const handleShowAllIncidents = () => {
    setShowAllIncidents(true);
    setSelectedDate(""); // Clear the selected date when showing all
  };

  // Format date and time
  const formatDateTime = (timestamp) => {
    if (!timestamp) return "N/A";
    const date = timestamp.toDate();
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return "N/A";
    const date = timestamp.toDate();
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return "N/A";
    const date = timestamp.toDate();
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  };

  // Export to PDF
  const handleExportPDF = async () => {
    if (filteredIncidents.length === 0) {
      alert('No incidents to export');
      return;
    }

    try {
      const { exportIncidentReportsToPDF } = await import('../services/incidentReportsExportService');
      
      await exportIncidentReportsToPDF({
        incidents: filteredIncidents,
        showAllIncidents,
        selectedDate,
        formatDate,
        formatTime,
        formatDateTime
      });
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Failed to export PDF: ' + error.message);
    }
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="incident-reports-container">
          <div className="loading-state">
            <div className="spinner"></div>
            <h3>Loading Incident Reports...</h3>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="incident-reports-container">
        {/* Header */}
        <div className="incident-header">
          <div className="incident-header-left">
            <h1>📋 Incident Reports</h1>
            <p className="incident-subtitle">
              View all incident reports submitted by caregivers and nurses
            </p>
          </div>
          <div className="incident-stats">
            <div className="stat-card">
              <div className="stat-number">{filteredIncidents.length}</div>
              <div className="stat-label">
                {showAllIncidents ? "Total Reports" : selectedDate ? "Filtered Reports" : "Total Reports"}
              </div>
            </div>
          </div>
        </div>

        {/* Date Filter */}
        <div className="date-filter-container">
          <button 
            onClick={handleShowAllIncidents} 
            className="show-all-btn"
            title="Display all incident reports from all dates"
          >
            📋 Show All Incidents
          </button>
          <div className="date-filter-group">
            <label htmlFor="date-filter">📅 Filter by Date:</label>
            <input
              type="date"
              id="date-filter"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setShowAllIncidents(false);
              }}
              className="date-filter-input"
            />
          </div>
        </div>

        {/* Incidents Table */}
        {filteredIncidents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <h3>No Incident Reports Found</h3>
            <p>
              {showAllIncidents 
                ? "No incidents have been reported yet."
                : selectedDate 
                  ? "No incidents reported on the selected date." 
                  : "No incidents have been reported yet."}
            </p>
          </div>
        ) : (
          <div className="incidents-table-container">
            <div className="table-header">
              <h2>📋 Incident Reports Table</h2>
              <button 
                onClick={handleExportPDF} 
                className="table-export-btn" 
                title="Export incident reports to PDF for printing or sharing"
                disabled={filteredIncidents.length === 0}
              >
                📄
              </button>
            </div>
            <table className="incidents-table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Incident Type</th>
                  <th>Elderly Involved</th>
                  <th>House</th>
                  <th>Reported By</th>
                  <th>Nurses Notified</th>
                  <th>Additional Information</th>
                </tr>
              </thead>
              <tbody>
                {filteredIncidents.map((incident) => (
                  <tr key={incident.id}>
                    <td>
                      <div className="incident-date">
                        {formatDate(incident.incident_date_time)}
                      </div>
                      <div className="incident-time">
                        {formatTime(incident.incident_date_time)}
                      </div>
                    </td>
                    <td>
                      <span className="incident-type-badge">
                        {incident.incident_type || "N/A"}
                      </span>
                    </td>
                    <td className="elderly-name">
                      {incident.elderlyName || "Unknown"}
                    </td>
                    <td className="house-badge">
                      {incident.house_id || "N/A"}
                    </td>
                    <td className="caregiver-name">
                      {incident.caregiverName || "Unknown"}
                    </td>
                    <td className="nurses-list">
                      {incident.nurseNames && incident.nurseNames.length > 0 ? (
                        <div className="nurses-names">
                          {incident.nurseNames.map((name, idx) => (
                            <div key={idx} className="nurse-name-item">
                              👨‍⚕️ {name}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="no-nurses">No nurses notified</span>
                      )}
                    </td>
                    <td className="additional-info">
                      {incident.additional_info || "No additional information provided."}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
