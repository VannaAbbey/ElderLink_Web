import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import Navbar from './navbar';
import '../css/shift-logs.css';

export default function ShiftLogs() {
  const [logs, setLogs] = useState([]);
  const [filteredLogs, setFilteredLogs] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [activeShift, setActiveShift] = useState('all');
  const [activeLogType, setActiveLogType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Shift definitions
  const shifts = [
    { key: 'all', name: 'All Shifts' },
    { key: '1st', name: '1st Shift' },
    { key: '2nd', name: '2nd Shift' },
    { key: '3rd', name: '3rd Shift' }
  ];

  const logTypes = [
    { key: 'all', name: 'All Activities', icon: '📋', color: '#6c757d' },
    { key: 'task', name: 'Tasks', icon: '✅', color: '#28a745' },
    { key: 'incident_report', name: 'Incidents', icon: '⚠️', color: '#ffc107' },
    { key: 'emergency_alert', name: 'Emergencies', icon: '🚨', color: '#dc3545' }
  ];

  // Format date to YYYY-MM-DD
  const formatDateString = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Load shift logs from Firestore
  useEffect(() => {
    const loadShiftLogs = async () => {
      try {
        setLoading(true);
        const dateStr = formatDateString(selectedDate);

        console.log('📊 Loading shift logs for:', dateStr);

        // Query logs for the selected date
        const logsQuery = query(
          collection(db, 'cg_shift_logs'),
          where('date_string', '==', dateStr)
        );

        // Set up real-time listener
        const unsubscribe = onSnapshot(logsQuery, (snapshot) => {
          const logsData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));

          // Sort by logged_at in descending order (most recent first)
          logsData.sort((a, b) => {
            const timeA = a.logged_at?.toMillis ? a.logged_at.toMillis() : 0;
            const timeB = b.logged_at?.toMillis ? b.logged_at.toMillis() : 0;
            return timeB - timeA;
          });

          console.log(`✅ Loaded ${logsData.length} logs for ${dateStr}`);
          setLogs(logsData);
          setLoading(false);
        });

        return unsubscribe;
      } catch (error) {
        console.error('Error loading shift logs:', error);
        setLoading(false);
      }
    };

    const unsubscribe = loadShiftLogs();
    return () => {
      if (unsubscribe && typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [selectedDate]);

  // Filter logs based on shift, log type, and search query
  useEffect(() => {
    let filtered = [...logs];

    // Filter by shift (if shift data is available in logs)
    if (activeShift !== 'all') {
      filtered = filtered.filter(log => log.shift === activeShift);
    }

    // Filter by log type
    if (activeLogType !== 'all') {
      filtered = filtered.filter(log => log.log_type === activeLogType);
    }

    // Filter by search query (caregiver name or elderly name)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(log => 
        (log.caregiver_fname && log.caregiver_fname.toLowerCase().includes(query)) ||
        (log.elderly_fname && log.elderly_fname.toLowerCase().includes(query))
      );
    }

    setFilteredLogs(filtered);
  }, [logs, activeShift, activeLogType, searchQuery]);

  // Format timestamp to readable time
  const formatTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  };

  // Format timestamp to full date and time
  const formatDateTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('en-US', { 
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  };

  // Get log icon and color based on type
  const getLogStyle = (logType) => {
    const type = logTypes.find(t => t.key === logType);
    return type || logTypes[0];
  };

  // Get status badge style
  const getStatusStyle = (status) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return { bg: '#d4edda', color: '#155724', text: 'Completed' };
      case 'missed':
        return { bg: '#f8d7da', color: '#721c24', text: 'Missed' };
      case 'pending':
        return { bg: '#fff3cd', color: '#856404', text: 'Pending' };
      default:
        return { bg: '#e2e3e5', color: '#383d41', text: status || 'Unknown' };
    }
  };

  // Export to PDF
  const handleExportPDF = async () => {
    if (filteredLogs.length === 0) {
      alert('No logs to export');
      return;
    }

    try {
      const { exportShiftLogsSummaryToPDF } = await import('../services/shiftLogsExportService');
      
      await exportShiftLogsSummaryToPDF({
        logs: filteredLogs,
        date: selectedDate,
        shift: activeShift,
        logType: activeLogType,
        shifts,
        logTypes
      });
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Failed to export PDF: ' + error.message);
    }
  };

  // Render log card based on type
  const renderLogCard = (log) => {
    const style = getLogStyle(log.log_type);

    return (
      <div key={log.id} className="timeline-item">
        <div className="timeline-marker" style={{ backgroundColor: style.color }}>
          {style.icon}
        </div>
        <div className="timeline-content">
          <div className="log-card">
            <div className="log-header">
              <div className="log-title">
                <span className="log-icon" style={{ color: style.color }}>
                  {style.icon}
                </span>
                <span className="log-type-name">{style.name}</span>
              </div>
              <span className="log-time">{formatTime(log.logged_at)}</span>
            </div>

            <div className="log-body">
              {/* Caregiver and Elderly Info */}
              <div className="log-participants">
                <div className="participant">
                  <strong>👤 Caregiver:</strong> {log.caregiver_fname || 'Unknown'}
                </div>
                {log.elderly_fname && (
                  <div className="participant">
                    <strong>👴 Elderly:</strong> {log.elderly_fname}
                  </div>
                )}
              </div>

              {/* Task-specific details */}
              {log.log_type === 'task' && (
                <div className="log-details">
                  <div className="detail-row">
                    <span className="detail-label">📝 Task:</span>
                    <span className="detail-value">{log.task_description || 'No description'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Status:</span>
                    <span 
                      className="status-badge" 
                      style={{
                        backgroundColor: getStatusStyle(log.task_status).bg,
                        color: getStatusStyle(log.task_status).color
                      }}
                    >
                      {getStatusStyle(log.task_status).text}
                    </span>
                  </div>
                  {log.completion_time && (
                    <div className="detail-row">
                      <span className="detail-label">⏱️ Completed:</span>
                      <span className="detail-value">{formatTime(log.completion_time)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Incident-specific details */}
              {log.log_type === 'incident_report' && (
                <div className="log-details">
                  <div className="detail-row">
                    <span className="detail-label">📋 Type:</span>
                    <span className="detail-value incident-type">{log.incident_type || 'N/A'}</span>
                  </div>
                  {log.inc_reason && (
                    <div className="detail-row">
                      <span className="detail-label">Reason:</span>
                      <span className="detail-value">{log.inc_reason}</span>
                    </div>
                  )}
                  {log.additional_info && (
                    <div className="detail-row">
                      <span className="detail-label">Details:</span>
                      <span className="detail-value">{log.additional_info}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Emergency-specific details */}
              {log.log_type === 'emergency_alert' && (
                <div className="log-details emergency-details">
                  <div className="detail-row">
                    <span className="detail-label">🚨 Emergency Type:</span>
                    <span className="detail-value emergency-type">{log.emergency_type || 'N/A'}</span>
                  </div>
                  {log.additional_info && (
                    <div className="detail-row">
                      <span className="detail-label">Details:</span>
                      <span className="detail-value">{log.additional_info}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Additional info for other log types */}
              {log.log_type !== 'task' && log.log_type !== 'incident_report' && log.log_type !== 'emergency_alert' && log.additional_info && (
                <div className="log-details">
                  <div className="detail-row">
                    <span className="detail-label">Info:</span>
                    <span className="detail-value">{log.additional_info}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="log-footer">
              <span className="logged-at">Logged at: {formatDateTime(log.logged_at)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="shift-logs-container">
      <Navbar />
      <main className="shift-logs-content">
        <div className="shift-logs-header">
          <h1>📊 Shift Logs Monitor</h1>
          <p className="subtitle">Real-time monitoring of all caregiver activities during shifts</p>
        </div>

        {/* Summary Stats */}
        <div className="stats-section">
          <div className="stat-card">
            <div className="stat-icon">📋</div>
            <div className="stat-info">
              <div className="stat-value">{filteredLogs.length}</div>
              <div className="stat-label">Total Logs</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">✅</div>
            <div className="stat-info">
              <div className="stat-value">
                {filteredLogs.filter(l => l.log_type === 'task').length}
              </div>
              <div className="stat-label">Tasks</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">⚠️</div>
            <div className="stat-info">
              <div className="stat-value">
                {filteredLogs.filter(l => l.log_type === 'incident_report').length}
              </div>
              <div className="stat-label">Incidents</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">🚨</div>
            <div className="stat-info">
              <div className="stat-value">
                {filteredLogs.filter(l => l.log_type === 'emergency_alert').length}
              </div>
              <div className="stat-label">Emergencies</div>
            </div>
          </div>
        </div>

        {/* Filters and Controls */}
        <div className="controls-section">
          {/* Row 1: Date and Activity Type */}
          <div className="control-row">
            <div className="control-group-inline">
              <label htmlFor="date-picker">📅 Date</label>
              <input
                id="date-picker"
                type="date"
                value={formatDateString(selectedDate)}
                onChange={(e) => setSelectedDate(new Date(e.target.value + 'T00:00:00'))}
                className="date-picker"
              />
            </div>

            <div className="control-group-inline">
              <label>📋 Activity Type</label>
              <div className="filter-buttons">
                {logTypes.map(type => (
                  <button
                    key={type.key}
                    className={`filter-btn ${activeLogType === type.key ? 'active' : ''}`}
                    onClick={() => setActiveLogType(type.key)}
                    style={activeLogType === type.key ? { 
                      backgroundColor: type.color, 
                      color: 'white',
                      borderColor: type.color
                    } : {}}
                    title={`Filter to show only ${type.name.toLowerCase()} activities`}
                  >
                    {type.icon} {type.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: Shift and Search */}
          <div className="control-row">
            <div className="control-group-inline">
              <label>⏰ Shift</label>
              <div className="filter-buttons">
                {shifts.map(shift => (
                  <button
                    key={shift.key}
                    className={`filter-btn ${activeShift === shift.key ? 'active' : ''}`}
                    onClick={() => setActiveShift(shift.key)}
                    title={`Filter to show activities from ${shift.name.toLowerCase()}`}
                  >
                    {shift.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-group-inline">
              <label htmlFor="search">🔍 Search</label>
              <input
                id="search"
                type="text"
                placeholder="Search by caregiver or elderly name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>
          </div>
        </div>

        {/* Timeline View */}
        <div className="timeline-section">
          <div className="timeline-header">
            <h2>📅 Activity Timeline - {selectedDate.toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}</h2>
            <button onClick={handleExportPDF} className="export-btn-icon" title="Export to PDF / Print">
              📄
            </button>
          </div>

          {loading ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Loading shift logs...</p>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <h3>No logs found</h3>
              <p>There are no shift logs for the selected date and filters.</p>
            </div>
          ) : (
            <div className="timeline">
              {filteredLogs.map(log => renderLogCard(log))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
