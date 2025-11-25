import React, { useEffect, useState, useRef } from "react";
import { db } from "../firebase";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  getDoc,
  doc
} from "firebase/firestore";
import Navbar from "./navbar";
import "../css/medication_management.css";
import "../css/incidentReports.css";
import { exportMedicationRecordsToPDF, exportMedicationRecordsToCSV } from "../services/medicationExportService";

export default function MedicationManagement() {
  const [medications, setMedications] = useState([]);
  const [medTakes, setMedTakes] = useState([]);
  const [combined, setCombined] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // default date = today
  const getTodayDate = () => new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(getTodayDate());

  // Export overlay state/ref
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef(null);

  useEffect(() => {
    if (!exportMenuOpen) return;
    function handleClick(e) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setExportMenuOpen(false);
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') setExportMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [exportMenuOpen]);

  useEffect(() => {
    // subscribe to medications collection
    const qMed = query(collection(db, "medications"), orderBy("created_at", "desc"));
    const unsubMed = onSnapshot(qMed, (snap) => {
      const meds = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMedications(meds);
    }, (err) => console.error("medications snapshot error", err));

    // subscribe to medication_takes collection
    const qTakes = query(collection(db, "medication_takes"), orderBy("scheduled_date", "desc"));
    const unsubTakes = onSnapshot(qTakes, (snap) => {
      const takes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMedTakes(takes);
      setLoading(false);
    }, (err) => {
      console.error("medication_takes snapshot error", err);
      setLoading(false);
    });

    return () => {
      unsubMed();
      unsubTakes();
    };
  }, []);

  // combine meds and takes into rows
  useEffect(() => {
    const medsMap = {};
    medications.forEach((m) => {
      medsMap[m.medication_id || m.id || ""] = m;
    });

    const rows = medTakes.map((take) => {
      const med = medsMap[take.medication_id] || {};

      const nurseName = take.completed_by_name || take.nurse_name || med.created_nurse_name || "Unknown Nurse";
      const elderlyName = take.elderly_name || med.elderly_name || "Unknown Elderly";
      const medicationName = take.medication_name || med.medication_name || "Unknown Medication";
      const takeLabel = take.take_ordinal || (take.take_number ? `${take.take_number}` : "-");
      const time = take.scheduled_time
        ? formatScheduledTime(take.scheduled_time)
        : med.one_time_date
          ? formatTimeFromTimestamp(med.one_time_date)
          : "-";
      const status = take.status || "pending";

      return {
        id: take.id,
        nurseName,
        elderlyName,
        elderlyId: take.elderly_id || med.elderly_id || null,
        medicationName,
        medicationId: take.medication_id || med.medication_id || null,
        takeLabel,
        time,
        status,
        scheduled_date: take.scheduled_date
      };
    });

    setCombined(rows);
  }, [medications, medTakes]);

  // Apply date filter and status filter
  let filtered = combined;
  if (!showAll && selectedDate) {
    filtered = filtered.filter((row) => {
      if (!row.scheduled_date) return false;
      try {
        const d = row.scheduled_date.toDate ? row.scheduled_date.toDate() : new Date(row.scheduled_date);
        const s = new Date(selectedDate);
        return d.getFullYear() === s.getFullYear() && d.getMonth() === s.getMonth() && d.getDate() === s.getDate();
      } catch (e) {
        return false;
      }
    });
  }

  if (statusFilter && statusFilter !== 'all') {
    filtered = filtered.filter((row) => (row.status || '').toLowerCase() === statusFilter);
  }

  // Apply text search (nurse, elderly, medication)
  if (searchQuery && searchQuery.trim() !== '') {
    const q = searchQuery.trim().toLowerCase();
    filtered = filtered.filter((row) => {
      const nurse = (row.nurseName || '').toLowerCase();
      const elderly = (row.elderlyName || '').toLowerCase();
      const med = (row.medicationName || '').toLowerCase();
      return nurse.includes(q) || elderly.includes(q) || med.includes(q);
    });
  }

  function formatTimeFromTimestamp(ts) {
    try {
      const date = ts.toDate ? ts.toDate() : new Date(ts);
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (e) {
      return "-";
    }
  }

  // Format scheduled_time strings like "18:00:00" to "6:00 PM"
  function formatScheduledTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return "-";
    // Expect formats like HH:MM or HH:MM:SS
    const parts = timeStr.split(":");
    if (parts.length < 2) return timeStr;
    const hh = parseInt(parts[0], 10);
    const mm = parseInt(parts[1], 10) || 0;

    if (Number.isNaN(hh) || Number.isNaN(mm)) return timeStr;

    // Create a Date object today with that hour/minute
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  const handleShowAll = () => {
    setShowAll(true);
    setSelectedDate("");
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="incident-reports-container">
          <div className="loading-state">
            <div className="spinner"></div>
            <h3>Loading Medication Management...</h3>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="summary-vitals-meds-page">
      <Navbar />
      <main className="summary-vitals-meds-container">
        <div className="incident-header">
          <div className="incident-header-left">
            <h1>💊 Medication Management</h1>
            <p className="incident-subtitle">Summary of medication administration and takes</p>
          </div>
          <div className="incident-stats">
            <div className="stat-card">
              <div className="stat-number">{filtered.length}</div>
              <div className="stat-label">
                {showAll ? "Total Records" : selectedDate ? "Filtered Records" : "Total Records"}
              </div>
            </div>
          </div>
        </div>

        <div className="date-filter-container">
          <button onClick={handleShowAll} className="show-all-btn">📋 Show All Records</button>
          <div className="date-filter-group">
            <label htmlFor="date-filter">📅 Filter by Date:</label>
            <input
              type="date"
              id="date-filter"
              value={selectedDate}
              onChange={(e) => { setSelectedDate(e.target.value); setShowAll(false); }}
              className="date-filter-input"
            />
            <label htmlFor="status-filter">Status:</label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="date-filter-input"
            >
              <option value="all">All</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
              <option value="missed">Missed</option>
            </select>
            <input
              type="text"
              placeholder="Search nurse, elderly, medication..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="date-filter-input"
              style={{ minWidth: '220px' }}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">💊</div>
            <h3>No Medication Management Records Found</h3>
            <p>{showAll ? "No medication records available." : "No medication records for the selected date."}</p>
          </div>
        ) : (
          <div className="incidents-table-container">
            <div className="table-header">
              {/* header removed - main header above is used */}
              <button
                onClick={() => setExportMenuOpen(true)}
                className="table-export-btn"
                title="Export medication records"
                disabled={filtered.length === 0}
              >
                📄
              </button>

              {exportMenuOpen && (
                <div className="export-overlay" onClick={() => setExportMenuOpen(false)}>
                  <div className="export-dialog" ref={exportMenuRef} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                    <h3 style={{ marginTop: 0, textAlign: 'center', fontSize: '20px', fontWeight: 600 }}>📄 Export Record</h3>
                    <p style={{ marginTop: 0, marginBottom: 12, textAlign: 'center' }}>Choose an export format for the current view.</p>

                    <div className="export-options">
                      <button
                        className="export-option"
                        onClick={async () => {
                          try {
                            await exportMedicationRecordsToPDF({ rows: filtered, showAll, selectedDate, statusFilter });
                          } catch (err) {
                            alert('Failed to export PDF: ' + (err.message || err));
                          } finally {
                            setExportMenuOpen(false);
                          }
                        }}
                      >
                        <span className="icon">📄</span> Export PDF
                      </button>

                      <button
                        className="export-option"
                        onClick={() => {
                          try {
                            exportMedicationRecordsToCSV({ rows: filtered, showAll, selectedDate, statusFilter });
                          } catch (err) {
                            alert('Failed to export CSV: ' + (err.message || err));
                          } finally {
                            setExportMenuOpen(false);
                          }
                        }}
                      >
                        <span className="icon">📥</span> Export Excel (.csv)
                      </button>
                    </div>

                    <button className="export-cancel" onClick={() => setExportMenuOpen(false)} style={{ marginTop: 12 }}>Cancel</button>
                  </div>
                </div>
              )}

            </div>
            <table className="incidents-table">
              <thead>
                <tr>
                  <th>Nurse</th>
                  <th>Elderly</th>
                  <th>Medication Name</th>
                  <th>Take</th>
                  <th>Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td className="caregiver-name">{row.nurseName}</td>
                    <td className="elderly-name">{row.elderlyName}</td>
                    <td>{row.medicationName}</td>
                    <td>{row.takeLabel}</td>
                    <td>{row.time}</td>
                    <td>
                      <span className={"incident-type-badge " + (row.status === 'completed' ? 'completed' : row.status === 'missed' ? 'missed' : 'pending') }>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
