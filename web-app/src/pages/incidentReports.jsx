// src/pages/incidentReports.jsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  orderBy,
  where,
  getDocs,
  Timestamp 
} from "firebase/firestore";
import Navbar from "./navbar";
import "../css/incidentReports.css";

export default function IncidentReports() {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState([]);
  const [filteredIncidents, setFilteredIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDateRange, setFilterDateRange] = useState("all");

  // Form states
  const [formData, setFormData] = useState({
    incident_title: "",
    incident_date: "",
    incident_time: "",
    reported_by: "",
    reporter_type: "caregiver",
    elderly_involved: "",
    house_name: "",
    location_details: "",
    severity: "low",
    incident_type: "fall",
    description: "",
    actions_taken: "",
    witnesses: "",
    status: "pending",
    follow_up_required: false,
    follow_up_notes: ""
  });

  // Fetch all incidents in real-time
  useEffect(() => {
    const q = query(collection(db, "incident_reports"), orderBy("incident_date", "desc"));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const incidentData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));
      setIncidents(incidentData);
      setFilteredIncidents(incidentData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Filter incidents based on search and filters
  useEffect(() => {
    let filtered = [...incidents];

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(incident => 
        incident.incident_title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        incident.elderly_involved?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        incident.house_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        incident.reported_by?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Severity filter
    if (filterSeverity !== "all") {
      filtered = filtered.filter(incident => incident.severity === filterSeverity);
    }

    // Status filter
    if (filterStatus !== "all") {
      filtered = filtered.filter(incident => incident.status === filterStatus);
    }

    // Date range filter
    if (filterDateRange !== "all") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      filtered = filtered.filter(incident => {
        const incidentDate = incident.incident_date?.toDate ? incident.incident_date.toDate() : new Date(incident.incident_date);
        
        switch(filterDateRange) {
          case "today":
            return incidentDate >= today;
          case "week":
            const weekAgo = new Date(today);
            weekAgo.setDate(weekAgo.getDate() - 7);
            return incidentDate >= weekAgo;
          case "month":
            const monthAgo = new Date(today);
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            return incidentDate >= monthAgo;
          default:
            return true;
        }
      });
    }

    setFilteredIncidents(filtered);
  }, [searchTerm, filterSeverity, filterStatus, filterDateRange, incidents]);

  // Handle form input changes
  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value
    }));
  };

  // Add new incident
  const handleAddIncident = async (e) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, "incident_reports"), {
        ...formData,
        incident_date: Timestamp.fromDate(new Date(formData.incident_date)),
        created_at: Timestamp.now(),
        updated_at: Timestamp.now()
      });
      
      alert("✅ Incident report submitted successfully!");
      setShowAddModal(false);
      resetForm();
    } catch (error) {
      console.error("Error adding incident:", error);
      alert("❌ Failed to submit incident report.");
    }
  };

  // Update incident
  const handleUpdateIncident = async (e) => {
    e.preventDefault();
    try {
      const incidentRef = doc(db, "incident_reports", selectedIncident.id);
      await updateDoc(incidentRef, {
        ...formData,
        incident_date: formData.incident_date instanceof Date 
          ? Timestamp.fromDate(formData.incident_date)
          : Timestamp.fromDate(new Date(formData.incident_date)),
        updated_at: Timestamp.now()
      });
      
      alert("✅ Incident report updated successfully!");
      setShowEditModal(false);
      setSelectedIncident(null);
      resetForm();
    } catch (error) {
      console.error("Error updating incident:", error);
      alert("❌ Failed to update incident report.");
    }
  };

  // Delete incident
  const handleDeleteIncident = async (incidentId) => {
    if (!window.confirm("⚠️ Are you sure you want to delete this incident report? This action cannot be undone.")) {
      return;
    }

    try {
      await deleteDoc(doc(db, "incident_reports", incidentId));
      alert("✅ Incident report deleted successfully!");
    } catch (error) {
      console.error("Error deleting incident:", error);
      alert("❌ Failed to delete incident report.");
    }
  };

  // Open edit modal with selected incident data
  const openEditModal = (incident) => {
    setSelectedIncident(incident);
    setFormData({
      incident_title: incident.incident_title || "",
      incident_date: incident.incident_date?.toDate ? incident.incident_date.toDate().toISOString().split('T')[0] : "",
      incident_time: incident.incident_time || "",
      reported_by: incident.reported_by || "",
      reporter_type: incident.reporter_type || "caregiver",
      elderly_involved: incident.elderly_involved || "",
      house_name: incident.house_name || "",
      location_details: incident.location_details || "",
      severity: incident.severity || "low",
      incident_type: incident.incident_type || "fall",
      description: incident.description || "",
      actions_taken: incident.actions_taken || "",
      witnesses: incident.witnesses || "",
      status: incident.status || "pending",
      follow_up_required: incident.follow_up_required || false,
      follow_up_notes: incident.follow_up_notes || ""
    });
    setShowEditModal(true);
  };

  // Open view modal
  const openViewModal = (incident) => {
    setSelectedIncident(incident);
    setShowViewModal(true);
  };

  // Reset form
  const resetForm = () => {
    setFormData({
      incident_title: "",
      incident_date: "",
      incident_time: "",
      reported_by: "",
      reporter_type: "caregiver",
      elderly_involved: "",
      house_name: "",
      location_details: "",
      severity: "low",
      incident_type: "fall",
      description: "",
      actions_taken: "",
      witnesses: "",
      status: "pending",
      follow_up_required: false,
      follow_up_notes: ""
    });
  };

  // Get severity badge class
  const getSeverityClass = (severity) => {
    switch(severity) {
      case "critical": return "severity-critical";
      case "high": return "severity-high";
      case "medium": return "severity-medium";
      case "low": return "severity-low";
      default: return "severity-low";
    }
  };

  // Get status badge class
  const getStatusClass = (status) => {
    switch(status) {
      case "resolved": return "status-resolved";
      case "in_progress": return "status-progress";
      case "pending": return "status-pending";
      default: return "status-pending";
    }
  };

  return (
    <div className="schedule-page">
      <Navbar />
      <main className="incident-reports-container">
        <div className="incident-header">
          <div className="incident-header-left">
            <h1>📋 Incident Reports</h1>
            <p className="incident-subtitle">Manage and track incident reports</p>
          </div>
          <button className="add-incident-btn" onClick={() => setShowAddModal(true)}>
            ➕ New Incident Report
          </button>
        </div>

      {/* Filters Section */}
      <div className="incident-filters">
        <div className="filter-row">
          <div className="search-box">
            <input
              type="text"
              placeholder="🔍 Search incidents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)}>
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
          </select>

          <select value={filterDateRange} onChange={(e) => setFilterDateRange(e.target.value)}>
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
          </select>
        </div>

        <div className="filter-summary">
          Showing <strong>{filteredIncidents.length}</strong> of <strong>{incidents.length}</strong> incidents
        </div>
      </div>

      {/* Incidents Table */}
      {loading ? (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading incidents...</p>
        </div>
      ) : filteredIncidents.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <h3>No incidents found</h3>
          <p>No incident reports match your current filters.</p>
        </div>
      ) : (
        <div className="incidents-table-container">
          <table className="incidents-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Title</th>
                <th>Elderly</th>
                <th>House</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Reported By</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredIncidents.map((incident) => (
                <tr key={incident.id}>
                  <td className="incident-date">
                    {incident.incident_date?.toDate 
                      ? incident.incident_date.toDate().toLocaleDateString() 
                      : new Date(incident.incident_date).toLocaleDateString()}
                  </td>
                  <td className="incident-title">{incident.incident_title}</td>
                  <td>{incident.elderly_involved || "N/A"}</td>
                  <td>{incident.house_name || "N/A"}</td>
                  <td>
                    <span className="incident-type-badge">
                      {incident.incident_type}
                    </span>
                  </td>
                  <td>
                    <span className={`severity-badge ${getSeverityClass(incident.severity)}`}>
                      {incident.severity}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge ${getStatusClass(incident.status)}`}>
                      {incident.status === "in_progress" ? "In Progress" : incident.status}
                    </span>
                  </td>
                  <td>{incident.reported_by}</td>
                  <td className="incident-actions">
                    <button 
                      className="action-btn view-btn" 
                      onClick={() => openViewModal(incident)}
                      title="View Details"
                    >
                      👁️
                    </button>
                    <button 
                      className="action-btn edit-btn" 
                      onClick={() => openEditModal(incident)}
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button 
                      className="action-btn delete-btn" 
                      onClick={() => handleDeleteIncident(incident.id)}
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Incident Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content incident-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>➕ New Incident Report</h2>
              <button className="close-btn" onClick={() => setShowAddModal(false)}>✕</button>
            </div>

            <form onSubmit={handleAddIncident} className="incident-form">
              <div className="form-grid">
                <div className="form-group full-width">
                  <label>Incident Title *</label>
                  <input
                    type="text"
                    name="incident_title"
                    value={formData.incident_title}
                    onChange={handleInputChange}
                    required
                    placeholder="Brief description of the incident"
                  />
                </div>

                <div className="form-group">
                  <label>Date *</label>
                  <input
                    type="date"
                    name="incident_date"
                    value={formData.incident_date}
                    onChange={handleInputChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Time</label>
                  <input
                    type="time"
                    name="incident_time"
                    value={formData.incident_time}
                    onChange={handleInputChange}
                  />
                </div>

                <div className="form-group">
                  <label>Reported By *</label>
                  <input
                    type="text"
                    name="reported_by"
                    value={formData.reported_by}
                    onChange={handleInputChange}
                    required
                    placeholder="Name of reporter"
                  />
                </div>

                <div className="form-group">
                  <label>Reporter Type</label>
                  <select name="reporter_type" value={formData.reporter_type} onChange={handleInputChange}>
                    <option value="caregiver">Caregiver</option>
                    <option value="nurse">Nurse</option>
                    <option value="admin">Admin</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Elderly Involved</label>
                  <input
                    type="text"
                    name="elderly_involved"
                    value={formData.elderly_involved}
                    onChange={handleInputChange}
                    placeholder="Name of elderly (if applicable)"
                  />
                </div>

                <div className="form-group">
                  <label>House Name</label>
                  <input
                    type="text"
                    name="house_name"
                    value={formData.house_name}
                    onChange={handleInputChange}
                    placeholder="E.g., Charbell, Emmanuel"
                  />
                </div>

                <div className="form-group">
                  <label>Incident Type *</label>
                  <select name="incident_type" value={formData.incident_type} onChange={handleInputChange} required>
                    <option value="fall">Fall</option>
                    <option value="medication_error">Medication Error</option>
                    <option value="behavioral">Behavioral Issue</option>
                    <option value="injury">Injury</option>
                    <option value="medical_emergency">Medical Emergency</option>
                    <option value="property_damage">Property Damage</option>
                    <option value="safety_hazard">Safety Hazard</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Severity *</label>
                  <select name="severity" value={formData.severity} onChange={handleInputChange} required>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>

                <div className="form-group full-width">
                  <label>Location Details</label>
                  <input
                    type="text"
                    name="location_details"
                    value={formData.location_details}
                    onChange={handleInputChange}
                    placeholder="Specific location where incident occurred"
                  />
                </div>

                <div className="form-group full-width">
                  <label>Description *</label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    required
                    rows="4"
                    placeholder="Detailed description of what happened..."
                  />
                </div>

                <div className="form-group full-width">
                  <label>Actions Taken</label>
                  <textarea
                    name="actions_taken"
                    value={formData.actions_taken}
                    onChange={handleInputChange}
                    rows="3"
                    placeholder="Immediate actions taken in response to the incident..."
                  />
                </div>

                <div className="form-group full-width">
                  <label>Witnesses</label>
                  <input
                    type="text"
                    name="witnesses"
                    value={formData.witnesses}
                    onChange={handleInputChange}
                    placeholder="Names of witnesses (if any)"
                  />
                </div>

                <div className="form-group">
                  <label>Status</label>
                  <select name="status" value={formData.status} onChange={handleInputChange}>
                    <option value="pending">Pending</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>

                <div className="form-group checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      name="follow_up_required"
                      checked={formData.follow_up_required}
                      onChange={handleInputChange}
                    />
                    Follow-up Required
                  </label>
                </div>

                {formData.follow_up_required && (
                  <div className="form-group full-width">
                    <label>Follow-up Notes</label>
                    <textarea
                      name="follow_up_notes"
                      value={formData.follow_up_notes}
                      onChange={handleInputChange}
                      rows="3"
                      placeholder="Details about required follow-up actions..."
                    />
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="submit-btn">
                  Submit Report
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Incident Modal */}
      {showViewModal && selectedIncident && (
        <div className="modal-overlay" onClick={() => setShowViewModal(false)}>
          <div className="modal-content incident-modal view-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>👁️ Incident Details</h2>
              <button className="close-btn" onClick={() => setShowViewModal(false)}>✕</button>
            </div>

            <div className="incident-details">
              <div className="detail-section">
                <h3>📋 Basic Information</h3>
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="detail-label">Title:</span>
                    <span className="detail-value">{selectedIncident.incident_title}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Date:</span>
                    <span className="detail-value">
                      {selectedIncident.incident_date?.toDate 
                        ? selectedIncident.incident_date.toDate().toLocaleDateString() 
                        : new Date(selectedIncident.incident_date).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Time:</span>
                    <span className="detail-value">{selectedIncident.incident_time || "N/A"}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Type:</span>
                    <span className="detail-value">{selectedIncident.incident_type}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Severity:</span>
                    <span className={`severity-badge ${getSeverityClass(selectedIncident.severity)}`}>
                      {selectedIncident.severity}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Status:</span>
                    <span className={`status-badge ${getStatusClass(selectedIncident.status)}`}>
                      {selectedIncident.status === "in_progress" ? "In Progress" : selectedIncident.status}
                    </span>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h3>👥 People & Location</h3>
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="detail-label">Reported By:</span>
                    <span className="detail-value">{selectedIncident.reported_by}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Reporter Type:</span>
                    <span className="detail-value">{selectedIncident.reporter_type}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Elderly Involved:</span>
                    <span className="detail-value">{selectedIncident.elderly_involved || "N/A"}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">House:</span>
                    <span className="detail-value">{selectedIncident.house_name || "N/A"}</span>
                  </div>
                  <div className="detail-item full-width">
                    <span className="detail-label">Location:</span>
                    <span className="detail-value">{selectedIncident.location_details || "N/A"}</span>
                  </div>
                  <div className="detail-item full-width">
                    <span className="detail-label">Witnesses:</span>
                    <span className="detail-value">{selectedIncident.witnesses || "None"}</span>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h3>📝 Description</h3>
                <p className="detail-description">{selectedIncident.description}</p>
              </div>

              <div className="detail-section">
                <h3>🚑 Actions Taken</h3>
                <p className="detail-description">{selectedIncident.actions_taken || "No actions documented yet."}</p>
              </div>

              {selectedIncident.follow_up_required && (
                <div className="detail-section follow-up-section">
                  <h3>⚠️ Follow-up Required</h3>
                  <p className="detail-description">{selectedIncident.follow_up_notes || "No follow-up notes provided."}</p>
                </div>
              )}

              <div className="detail-section metadata-section">
                <div className="detail-item">
                  <span className="detail-label">Created:</span>
                  <span className="detail-value">
                    {selectedIncident.created_at?.toDate 
                      ? selectedIncident.created_at.toDate().toLocaleString() 
                      : "N/A"}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Last Updated:</span>
                  <span className="detail-value">
                    {selectedIncident.updated_at?.toDate 
                      ? selectedIncident.updated_at.toDate().toLocaleString() 
                      : "N/A"}
                  </span>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setShowViewModal(false)}>
                Close
              </button>
              <button className="edit-btn" onClick={() => {
                setShowViewModal(false);
                openEditModal(selectedIncident);
              }}>
                Edit Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Incident Modal */}
      {showEditModal && selectedIncident && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content incident-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>✏️ Edit Incident Report</h2>
              <button className="close-btn" onClick={() => setShowEditModal(false)}>✕</button>
            </div>

            <form onSubmit={handleUpdateIncident} className="incident-form">
              <div className="form-grid">
                <div className="form-group full-width">
                  <label>Incident Title *</label>
                  <input
                    type="text"
                    name="incident_title"
                    value={formData.incident_title}
                    onChange={handleInputChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Date *</label>
                  <input
                    type="date"
                    name="incident_date"
                    value={formData.incident_date}
                    onChange={handleInputChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Time</label>
                  <input
                    type="time"
                    name="incident_time"
                    value={formData.incident_time}
                    onChange={handleInputChange}
                  />
                </div>

                <div className="form-group">
                  <label>Reported By *</label>
                  <input
                    type="text"
                    name="reported_by"
                    value={formData.reported_by}
                    onChange={handleInputChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Reporter Type</label>
                  <select name="reporter_type" value={formData.reporter_type} onChange={handleInputChange}>
                    <option value="caregiver">Caregiver</option>
                    <option value="nurse">Nurse</option>
                    <option value="admin">Admin</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Elderly Involved</label>
                  <input
                    type="text"
                    name="elderly_involved"
                    value={formData.elderly_involved}
                    onChange={handleInputChange}
                  />
                </div>

                <div className="form-group">
                  <label>House Name</label>
                  <input
                    type="text"
                    name="house_name"
                    value={formData.house_name}
                    onChange={handleInputChange}
                  />
                </div>

                <div className="form-group">
                  <label>Incident Type *</label>
                  <select name="incident_type" value={formData.incident_type} onChange={handleInputChange} required>
                    <option value="fall">Fall</option>
                    <option value="medication_error">Medication Error</option>
                    <option value="behavioral">Behavioral Issue</option>
                    <option value="injury">Injury</option>
                    <option value="medical_emergency">Medical Emergency</option>
                    <option value="property_damage">Property Damage</option>
                    <option value="safety_hazard">Safety Hazard</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Severity *</label>
                  <select name="severity" value={formData.severity} onChange={handleInputChange} required>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>

                <div className="form-group full-width">
                  <label>Location Details</label>
                  <input
                    type="text"
                    name="location_details"
                    value={formData.location_details}
                    onChange={handleInputChange}
                  />
                </div>

                <div className="form-group full-width">
                  <label>Description *</label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    required
                    rows="4"
                  />
                </div>

                <div className="form-group full-width">
                  <label>Actions Taken</label>
                  <textarea
                    name="actions_taken"
                    value={formData.actions_taken}
                    onChange={handleInputChange}
                    rows="3"
                  />
                </div>

                <div className="form-group full-width">
                  <label>Witnesses</label>
                  <input
                    type="text"
                    name="witnesses"
                    value={formData.witnesses}
                    onChange={handleInputChange}
                  />
                </div>

                <div className="form-group">
                  <label>Status</label>
                  <select name="status" value={formData.status} onChange={handleInputChange}>
                    <option value="pending">Pending</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>

                <div className="form-group checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      name="follow_up_required"
                      checked={formData.follow_up_required}
                      onChange={handleInputChange}
                    />
                    Follow-up Required
                  </label>
                </div>

                {formData.follow_up_required && (
                  <div className="form-group full-width">
                    <label>Follow-up Notes</label>
                    <textarea
                      name="follow_up_notes"
                      value={formData.follow_up_notes}
                      onChange={handleInputChange}
                      rows="3"
                    />
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setShowEditModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="submit-btn">
                  Update Report
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </main>
    </div>
  );
}
