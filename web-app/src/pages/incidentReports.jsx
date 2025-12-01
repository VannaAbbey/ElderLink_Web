// src/pages/incidentReports.jsx
import React, { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { AuthContext } from "../contexts/authcontext";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp
} from "firebase/firestore";
import Navbar from "./navbar";
import CustomAlertModal from "./customAlertModal";
import "../css/incidentReports.css";

export default function IncidentReports() {
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const [incidents, setIncidents] = useState([]);
  const [filteredIncidents, setFilteredIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAllIncidents, setShowAllIncidents] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [newStatus, setNewStatus] = useState("");
  const [currentAdminName, setCurrentAdminName] = useState("");
  const [showCustomAlert, setShowCustomAlert] = useState(false);
  const [customAlertMessage, setCustomAlertMessage] = useState("");
  const [customAlertTitle, setCustomAlertTitle] = useState("");
  
  // Custom alert function
  const showAlert = (message, title = "Alert") => {
    setCustomAlertMessage(message);
    setCustomAlertTitle(title);
    setShowCustomAlert(true);
  };

  const closeAlert = () => {
    setShowCustomAlert(false);
  };
  
  // Set today's date as default
  const getTodayDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };
  
  const [selectedDate, setSelectedDate] = useState(getTodayDate());
  
  // Store user and elderly data for quick lookup
  const [usersData, setUsersData] = useState({});
  const [elderlyData, setElderlyData] = useState({});

  // Fetch current admin name
  useEffect(() => {
    const fetchAdminName = async () => {
      console.log("🔍 AuthContext user:", user);
      
      if (!user) {
        console.warn("⚠️ User is NULL - You might not be logged in!");
        // Try to get user from Firebase Auth directly as backup
        const currentUser = auth.currentUser;
        console.log("🔍 Firebase Auth currentUser:", currentUser);
        
        if (currentUser) {
          console.log("✅ Found user from Firebase Auth directly");
          try {
            const adminDoc = await getDoc(doc(db, "users", currentUser.uid));
            if (adminDoc.exists()) {
              const adminData = adminDoc.data();
              console.log("📋 Admin data from Firestore:", adminData);
              const fullName = `${adminData.user_fname || ""} ${adminData.user_lname || ""}`.trim();
              
              if (!fullName) {
                setCurrentAdminName(currentUser.email || "Admin User");
                console.log("✅ Using fallback name:", currentUser.email || "Admin User");
              } else {
                setCurrentAdminName(fullName);
                console.log("✅ Admin name loaded:", fullName);
              }
            }
          } catch (error) {
            console.error("❌ Error fetching admin name:", error);
            setCurrentAdminName(currentUser.email || "Admin User");
          }
        } else {
          console.error("❌ No user logged in at all!");
          setCurrentAdminName("Admin User");
        }
        return;
      }
      
      try {
        console.log("🔍 Fetching admin name for user:", user.uid);
        const adminDoc = await getDoc(doc(db, "users", user.uid));
        if (adminDoc.exists()) {
          const adminData = adminDoc.data();
          console.log("📋 Admin data from Firestore:", adminData);
          console.log("👤 First name:", adminData.user_fname);
          console.log("👤 Last name:", adminData.user_lname);
          
          const fullName = `${adminData.user_fname || ""} ${adminData.user_lname || ""}`.trim();
          
          if (!fullName) {
            console.error("⚠️ Admin name is empty! Check if user_fname and user_lname exist in Firestore");
            // Set a fallback name so updates can still work
            setCurrentAdminName(user.email || "Admin User");
            console.log("✅ Using fallback name:", user.email || "Admin User");
          } else {
            setCurrentAdminName(fullName);
            console.log("✅ Admin name loaded:", fullName);
          }
        } else {
          console.warn("⚠️ Admin document not found for user:", user.uid);
          // Set fallback name
          setCurrentAdminName(user.email || "Admin User");
        }
      } catch (error) {
        console.error("❌ Error fetching admin name:", error);
        // Set fallback name on error
        setCurrentAdminName(user.email || "Admin User");
      }
    };
    fetchAdminName();
  }, [user]);

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

  // Open status update modal
  const handleOpenStatusModal = (incident) => {
    setSelectedIncident(incident);
    setNewStatus(incident.incident_status || "Ongoing");
    setShowStatusModal(true);
  };

  // Close status update modal
  const handleCloseStatusModal = () => {
    setShowStatusModal(false);
    setSelectedIncident(null);
    setNewStatus("");
  };

  // Update incident status
  const handleUpdateStatus = async () => {
    if (!selectedIncident || !newStatus) {
      showAlert("Unable to update status. Please try again.", "Error");
      return;
    }

    console.log("📝 Current admin name value:", currentAdminName);
    console.log("📝 Admin name length:", currentAdminName.length);
    console.log("📝 User object:", user);

    // Ensure admin name is loaded (should be instant, but check just in case)
    if (!currentAdminName || currentAdminName.trim() === "") {
      console.error("⚠️ Admin name not loaded yet. Current value:", currentAdminName);
      // Use email as fallback if name is not available
      const fallbackName = user?.email || "Admin User";
      console.log("📝 Using fallback name:", fallbackName);
      
      try {
        const incidentRef = doc(db, "incident_report", selectedIncident.id);
        const oldStatus = selectedIncident.incident_status || "Ongoing";

        // Create update log entry with fallback name
        // Note: Use new Date() instead of serverTimestamp() inside arrayUnion
        const updateLog = {
          updatedBy: fallbackName,
          updatedAt: new Date(),
          oldStatus: oldStatus,
          newStatus: newStatus
        };

        // Update the incident document
        await updateDoc(incidentRef, {
          incident_status: newStatus,
          status_updates: arrayUnion(updateLog),
          last_updated_by: fallbackName,
          last_updated_at: serverTimestamp()
        });

        console.log("✅ Incident status updated successfully with fallback name");
        handleCloseStatusModal();
        return;
      } catch (error) {
        console.error("❌ Error updating incident status:", error);
        showAlert("Failed to update status: " + error.message, "Error");
        return;
      }
    }

    console.log("📝 Updating status by:", currentAdminName);

    try {
      const incidentRef = doc(db, "incident_report", selectedIncident.id);
      const oldStatus = selectedIncident.incident_status || "Ongoing";

      // Create update log entry
      // Note: Use new Date() instead of serverTimestamp() inside arrayUnion
      const updateLog = {
        updatedBy: currentAdminName,
        updatedAt: new Date(),
        oldStatus: oldStatus,
        newStatus: newStatus
      };

      // Update the incident document
      await updateDoc(incidentRef, {
        incident_status: newStatus,
        status_updates: arrayUnion(updateLog),
        last_updated_by: currentAdminName,
        last_updated_at: serverTimestamp()
      });

      console.log("✅ Incident status updated successfully");
      handleCloseStatusModal();
    } catch (error) {
      console.error("❌ Error updating incident status:", error);
      showAlert("Failed to update status: " + error.message, "Error");
    }
  };

  // Get status badge color
  const getStatusColor = (status) => {
    switch (status) {
      case "Ongoing":
        return "status-ongoing";
      case "Resolved":
        return "status-resolved";
      case "Under Investigation":
        return "status-investigating";
      case "Closed":
        return "status-closed";
      default:
        return "status-ongoing";
    }
  };

  // Format date and time
  const formatDateTime = (timestamp) => {
    if (!timestamp) return "N/A";
    
    // Handle both Firestore Timestamp and JavaScript Date objects
    let date;
    if (timestamp.toDate) {
      date = timestamp.toDate();
    } else if (timestamp instanceof Date) {
      date = timestamp;
    } else {
      return "N/A";
    }
    
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
      showAlert('No incidents to export', 'No Data');
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
      showAlert('Failed to export PDF: ' + error.message, 'Export Error');
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
                  <th>Status</th>
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
                              <span className="nurse-icon">👨‍⚕️</span>
                              <span className="nurse-name">{name}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="no-nurses">No nurses notified</span>
                      )}
                    </td>
                    <td className="status-cell">
                      <div className="status-container">
                        <div className="status-row">
                          <span className={`status-badge ${getStatusColor(incident.incident_status || "Ongoing")}`}>
                            {incident.incident_status || "Ongoing"}
                          </span>
                          <button 
                            onClick={() => handleOpenStatusModal(incident)} 
                            className="update-status-btn"
                            title="Update incident status"
                          >
                            ✏️
                          </button>
                        </div>
                        {incident.last_updated_by && (
                          <div className="last-updated-info">
                            Updated by {incident.last_updated_by}
                          </div>
                        )}
                      </div>
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

        {/* Status Update Modal */}
        {showStatusModal && selectedIncident && (
          <div className="modal-overlay" onClick={handleCloseStatusModal}>
            <div className="status-modal" onClick={(e) => e.stopPropagation()}>
              <div className="status-modal-header">
                <h2>📝 Update Incident Status</h2>
                <button onClick={handleCloseStatusModal} className="close-modal-btn-x">×</button>
              </div>
              
              <div className="status-modal-content">
                <div className="incident-summary">
                  <p><strong>Incident Type:</strong> {selectedIncident.incident_type}</p>
                  <p><strong>Elderly:</strong> {selectedIncident.elderlyName}</p>
                  <p><strong>Date:</strong> {formatDate(selectedIncident.incident_date_time)}</p>
                  <p><strong>Current Status:</strong> <span className={`status-badge ${getStatusColor(selectedIncident.incident_status || "Ongoing")}`}>{selectedIncident.incident_status || "Ongoing"}</span></p>
                </div>

                <div className="status-select-group">
                  <label htmlFor="status-select">Select New Status:</label>
                  <select 
                    id="status-select"
                    value={newStatus} 
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="status-select"
                  >
                    <option value="Ongoing">Ongoing</option>
                    <option value="Under Investigation">Under Investigation</option>
                    <option value="Resolved">Resolved</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>

                {selectedIncident.status_updates && selectedIncident.status_updates.length > 0 && (
                  <div className="update-history">
                    <h3>Update History:</h3>
                    <div className="history-list">
                      {selectedIncident.status_updates.slice().reverse().map((update, idx) => (
                        <div key={idx} className="history-item">
                          <div className="history-header">
                            <div className="history-admin">👤 {update.updatedBy}</div>
                            <div className="history-time">
                              {update.updatedAt && formatDateTime(update.updatedAt)}
                            </div>
                          </div>
                          <div className="history-change">
                            Changed from <span className={`status-badge-small ${getStatusColor(update.oldStatus)}`}>{update.oldStatus}</span> to <span className={`status-badge-small ${getStatusColor(update.newStatus)}`}>{update.newStatus}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="status-modal-actions">
                <button onClick={handleCloseStatusModal} className="cancel-btn">Cancel</button>
                <button onClick={handleUpdateStatus} className="update-btn">Update Status</button>
              </div>
            </div>
          </div>
        )}

        {/* Custom Alert Modal */}
        <CustomAlertModal
          isOpen={showCustomAlert}
          onClose={closeAlert}
          title={customAlertTitle}
          message={customAlertMessage}
        />
      </div>
    </>
  );
}
