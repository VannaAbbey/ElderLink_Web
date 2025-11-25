import React, { useEffect, useState, useRef } from "react";
import { db } from "../firebase";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import Navbar from "./navbar";
import { FaChartLine } from 'react-icons/fa';
import "../css/medication_management.css";
import "../css/incidentReports.css";
import "../css/vital-monitoring.css";

export default function VitalMonitoring() {
  const [logs, setLogs] = useState([]);
  const [rows, setRows] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalHistory, setModalHistory] = useState([]);
  const [modalElderly, setModalElderly] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef(null);
  const [showAll, setShowAll] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const getTodayDate = () => new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(getTodayDate());

  useEffect(() => {
    // Listen to activity logs ordered newest -> oldest
    try {
      const q = query(collection(db, "vitals_activity_logs"), orderBy("timestamp", "desc"));
      const unsub = onSnapshot(
        q,
        (snap) => {
          const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setLogs(docs);
          setLoading(false);
        },
        (err) => {
          console.error("vitals_activity_logs snapshot error", err);
          setLoading(false);
        }
      );

      return () => unsub();
    } catch (e) {
      console.warn("Failed to subscribe to vitals_activity_logs, falling back to empty", e);
      setLogs([]);
      setLoading(false);
    }
  }, []);

  // Close export menu on outside click
  useEffect(() => {
    const onDocClick = (e) => {
      if (!exportMenuRef.current) return;
      if (!exportMenuRef.current.contains(e.target)) setExportMenuOpen(false);
    };
    if (exportMenuOpen) document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [exportMenuOpen]);

  // Map activity logs to table rows
  useEffect(() => {
    // We want only one table row per elderly per calendar date. If activity logs contain
    // multiple entries for the same elderly on the same date, keep the latest entry
    // (by timestamp) for the table row. This preserves the table as one record per
    // elderly/day while the trend modal will render all readings for that day.
    const byKey = {};
    logs
      .filter((l) => l && (l.action_type === "vitals_update" || l.action_type === "vitals_missed" || l.action_type === "vitals_updated"))
      .forEach((l) => {
        const newVal = l.new_value || {};
        const bp = newVal.blood_pressure || "-";
        const pulse = newVal.pulse_rate || newVal.pulse_rate || "-";
        const temp = newVal.temperature || "-";
        const rr = newVal.respiratory_rate || "-";
        const o2 = newVal.oxygen_saturation || newVal.oxygen_saturation || "-";
        const nurseName = l.nurse_name || l.nurse || "Unknown Nurse";
        const elderlyName = l.elderly_name || l.elderly || "Unknown Elderly";
        const ts = l.timestamp && l.timestamp.toDate ? l.timestamp.toDate() : new Date(l.timestamp || l.created_at || Date.now());
        const time = ts ? ts.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }) : "-";
        const status = (l.action_type === "vitals_missed") ? "missed" : "completed";

        // determine calendar date key (YYYY-MM-DD) using local time
        const dateKey = l.assigned_date || l.assignedDate || `${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,'0')}-${String(ts.getDate()).padStart(2,'0')}`;
        const mapKey = `${elderlyName}::${dateKey}`;

        const entry = {
          id: l.activity_id || l.id,
          nurseName,
          elderlyName,
          bloodPressure: bp,
          pulse,
          temperature: temp,
          respiratoryRate: rr,
          oxygenSaturation: o2,
          time,
          status,
          assigned_date: dateKey,
          raw: l,
          _ts: ts
        };

        // Keep the latest by timestamp
        if (!byKey[mapKey] || (byKey[mapKey]._ts && entry._ts && byKey[mapKey]._ts < entry._ts)) {
          byKey[mapKey] = entry;
        }
      });

    setRows(Object.values(byKey));
  }, [logs]);

    // Open trend modal: build history for this elderly from logs
    function openTrendModal(row) {
      const elderKey = row.raw?.elderly_id || row.raw?.elderly_id || row.elderlyName;
      const history = logs
        .filter(l => (l.elderly_id === elderKey) || (l.elderly_name === row.elderlyName))
        .map(l => ({
          timestamp: l.timestamp || l.created_at || null,
          bp: (l.new_value && l.new_value.blood_pressure) || null,
          pulse: (l.new_value && l.new_value.pulse_rate) || null,
          temp: (l.new_value && l.new_value.temperature) || null,
          rr: (l.new_value && l.new_value.respiratory_rate) || null,
          o2: (l.new_value && l.new_value.oxygen_saturation) || null
        }))
        .filter(x => x.timestamp)
        .sort((a,b) => {
          const ta = a.timestamp.toDate ? a.timestamp.toDate() : new Date(a.timestamp);
          const tb = b.timestamp.toDate ? b.timestamp.toDate() : new Date(b.timestamp);
          return ta - tb;
        });

      setModalHistory(history);
      setModalElderly({ id: elderKey, name: row.elderlyName });
      setModalOpen(true);
    }

  // Filters
  let filtered = rows;
  if (!showAll && selectedDate) {
    filtered = filtered.filter((r) => {
      if (!r.assigned_date) return false;
      try {
        // assigned_date stored as YYYY-MM-DD string per your sample
        return r.assigned_date === selectedDate;
      } catch (e) {
        return false;
      }
    });
  }

  if (statusFilter && statusFilter !== "all") {
    filtered = filtered.filter((r) => (r.status || "").toLowerCase() === statusFilter);
  }

  if (searchQuery && searchQuery.trim() !== "") {
    const q = searchQuery.trim().toLowerCase();
    filtered = filtered.filter((r) => {
      return (
        (r.nurseName || "").toLowerCase().includes(q) ||
        (r.elderlyName || "").toLowerCase().includes(q)
      );
    });
  }

  function formatTimeFromTimestamp(ts) {
    try {
      const date = ts && ts.toDate ? ts.toDate() : new Date(ts);
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
    } catch (e) {
      return "-";
    }
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
            <h3>Loading Vital Monitoring...</h3>
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
            <h1>🫀 Vital Monitoring</h1>
            <p className="incident-subtitle">Latest recorded elderly vitals</p>
          </div>
          <div className="incident-stats">
            <div className="stat-card">
              <div className="stat-number">{filtered.length}</div>
              <div className="stat-label">{showAll ? "Total Records" : selectedDate ? "Filtered Records" : "Total Records"}</div>
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
            <select id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="date-filter-input">
              <option value="all">All</option>
              <option value="completed">Completed</option>
              <option value="missed">Missed</option>
            </select>

            <input
              type="text"
              placeholder="Search nurse, elderly..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="date-filter-input"
              style={{ minWidth: '220px' }}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🫀</div>
            <h3>No Vital Records Found</h3>
            <p>{showAll ? "No vital records available." : "No vital records for the selected date."}</p>
          </div>
        ) : (
          <div className="incidents-table-container">
            <div className="table-header" style={{ position: 'relative' }}>
              <button
                onClick={(e) => { e.stopPropagation(); setExportMenuOpen((s) => !s); }}
                className="table-export-btn"
                title="Export vital records"
                disabled={filtered.length === 0}
              >
                📄
              </button>

              {exportMenuOpen && (
                <div className="export-overlay" onClick={() => setExportMenuOpen(false)}>
                    <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
                      <h3 style={{ textAlign: 'center', margin: '0 0 8px 0' }}>📄 Export Record</h3>
                      <p style={{ marginTop: 0, marginBottom: 12, textAlign: 'center' }}>Choose an export format for the current view.</p>

                    <div className="export-options">
                      <button className="export-option" onClick={async () => {
                        setExportMenuOpen(false);
                        try {
                          const { exportVitalsToPDF } = await import('../services/vitalsExportService');
                          await exportVitalsToPDF({ rows: filtered, showAll, selectedDate, statusFilter });
                        } catch (err) {
                          alert('Failed to export PDF: ' + (err.message || err));
                        }
                      }}>
                        <span className="icon">📄</span> Export PDF
                      </button>

                      <button className="export-option" onClick={async () => {
                        setExportMenuOpen(false);
                        try {
                          const { exportVitalsToCSV } = await import('../services/vitalsExportService');
                          await exportVitalsToCSV({ rows: filtered, showAll, selectedDate, statusFilter });
                        } catch (err) {
                          alert('Failed to export Excel (CSV): ' + (err.message || err));
                        }
                      }}>
                        <span className="icon">📥</span> Export Excel (.csv)
                      </button>
                    </div>
                    <button className="export-cancel" onClick={() => setExportMenuOpen(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            <table className="incidents-table">
              <thead>
                <tr>
                  <th>Nurse Name</th>
                  <th>Elderly Name</th>
                  <th>BP</th>
                  <th>Pulse</th>
                  <th>Temp</th>
                  <th>RR</th>
                  <th>O2 Sat</th>
                  <th>Status</th>
                  <th style={{ width: '48px', textAlign: 'center' }}>Trend</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="caregiver-name">{r.nurseName}</td>
                    <td className="elderly-name">{r.elderlyName}</td>
                    <td>{r.bloodPressure}</td>
                    <td>{r.pulse}</td>
                    <td>{r.temperature}</td>
                    <td>{r.respiratoryRate}</td>
                    <td>{r.oxygenSaturation}</td>
                    <td>
                      <span className={"incident-type-badge " + (r.status === 'completed' ? 'completed' : r.status === 'missed' ? 'missed' : 'pending') }>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className="trend-btn"
                        title={`View trend for ${r.elderlyName}`}
                        onClick={() => openTrendModal(r)}
                      >
                        <FaChartLine />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      {/* Trend modal rendered here so it overlays the page when opened */}
      <VitalTrendModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        elderly={modalElderly}
        history={modalHistory}
      />
    </div>
  );
}

// Modal component appended after default export for simplicity
export function VitalTrendModal({ isOpen, onClose, elderly, history }) {
  // Always call hooks in this component (do not early-return before hooks).
  // The modal's presence in the DOM will be gated by `isOpen` when rendering.
  // wrap modal rendering in a try/catch to avoid white-screen on runtime errors
  if (!Array.isArray(history)) history = [];

  // Helper: parse systolic from BP string '120/80'
  const parseSystolic = (bp) => {
    if (!bp || typeof bp !== 'string') return null;
    const parts = bp.split('/');
    const v = parseInt(parts[0], 10);
    return Number.isNaN(v) ? null : v;
  };

  // Build arrays
  const points = history.map(h => {
    const t = h.timestamp.toDate ? h.timestamp.toDate() : new Date(h.timestamp);
    return {
      ts: t,
      bp: parseSystolic(h.bp),
      pulse: h.pulse ? Number(h.pulse) : null,
      temp: h.temp ? Number(h.temp) : null,
      rr: h.rr ? Number(h.rr) : null,
      o2: h.o2 ? Number(h.o2) : null
    };
  });

  // Build a map keyed by calendar date (YYYY-MM-DD) keeping the latest reading for that day
  // Build a map keyed by calendar date (YYYY-MM-DD) containing arrays of readings
  // (we keep all readings for a day so the modal can show multiple points per date)
  const pointsByDate = {};
  points.forEach(p => {
    const key = `${p.ts.getFullYear()}-${String(p.ts.getMonth()+1).padStart(2,'0')}-${String(p.ts.getDate()).padStart(2,'0')}`;
    if (!pointsByDate[key]) pointsByDate[key] = [];
    pointsByDate[key].push(p);
  });
  // sort readings within each day chronologically
  Object.keys(pointsByDate).forEach(k => pointsByDate[k].sort((a,b) => a.ts - b.ts));

  // Helper to compare same calendar day
  const sameDay = (a, b) => {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  };

  // month selection state (used to generate full-month date ticks)
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  // Only set default month once from history when modal is first mounted/opened
  const initialMonthSetRef = useRef(false);
  useEffect(() => {
    if (!initialMonthSetRef.current && history && history.length > 0) {
      const last = history[history.length - 1];
      const lastDate = last.timestamp && last.timestamp.toDate ? last.timestamp.toDate() : new Date(last.timestamp);
      const ym = `${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, '0')}`;
      setSelectedMonth(ym);
      initialMonthSetRef.current = true;
    }
  }, [history]);

  // Build date ticks for the full selected month (user picks the month via <input type="month">)
  let dateTicks = [];
  try {
    const [yStr, mStr] = (selectedMonth || '').split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    if (!Number.isNaN(y) && !Number.isNaN(m)) {
      // deterministic month tick generation to avoid Date mutation/timezone issues
      const lastDay = new Date(y, m, 0).getDate();
      for (let day = 1; day <= lastDay; day++) {
        dateTicks.push(new Date(y, m - 1, day));
      }
    }
  } catch (e) {
    dateTicks = [];
  }

  // debug log to help verify tick generation
  try {
    // eslint-disable-next-line no-console
    console.log('VitalTrendModal dateTicks', selectedMonth, dateTicks.length, dateTicks[0], dateTicks[dateTicks.length-1]);
  } catch (e) {}

  // If no month ticks (invalid selection) but we have point data, fall back to range-of-points ticks
  // Only use the fallback when the user has not selected a month (selectedMonth falsy)
  if ((!dateTicks || dateTicks.length === 0) && (!selectedMonth || selectedMonth.trim() === '') && points.length > 0) {
    const start = new Date(points[0].ts);
    const end = new Date(points[points.length - 1].ts);
    const diffDays = Math.round((end - start) / (24 * 3600 * 1000));
    if (diffDays < 6) {
      // expand to at least 7 days centered on range end
      const extra = 6 - diffDays;
      start.setDate(start.getDate() - extra);
    }
    dateTicks = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dateTicks.push(new Date(d));
    }
  }

  // Metrics to render and colors
  const metrics = [
    { key: 'bp', label: 'Systolic BP', color: '#ef4444' },
    { key: 'pulse', label: 'Pulse', color: '#10b981' },
    { key: 'temp', label: 'Temp', color: '#f97316' },
    { key: 'rr', label: 'RR', color: '#2563eb' },
    { key: 'o2', label: 'O2 Sat', color: '#8b5cf6' }
  ];

  // Determine min/max for Y scale (full-range from all points)
  // Collect only finite numeric values from all metrics
  const fullNumericValues = points.flatMap(p => metrics.map(m => p[m.key])).filter(v => typeof v === 'number' && Number.isFinite(v));
  const hasNumeric = fullNumericValues.length > 0;
  const fullYMin = hasNumeric ? Math.min(...fullNumericValues) : 0;
  const fullYMax = hasNumeric ? Math.max(...fullNumericValues) : 1;

  // Y domain state — will update to follow visible range when user scrolls
  const [yDomain, setYDomain] = useState({ min: fullYMin, max: fullYMax });

  // Debugging: log important values when modal opens to help trace missing labels/points
  useEffect(() => {
    try {
      // only log when this modal is actually open
      if (!isOpen) return;
      // eslint-disable-next-line no-console
      console.debug('VitalTrendModal: points count', points.length);
      // eslint-disable-next-line no-console
      console.debug('VitalTrendModal: fullNumericValues', fullNumericValues);
      // eslint-disable-next-line no-console
      console.debug('VitalTrendModal: fullYMin/fullYMax', fullYMin, fullYMax);
      // eslint-disable-next-line no-console
      console.debug('VitalTrendModal: dateTicks', selectedMonth, dateTicks.length, dateTicks[0], dateTicks[dateTicks.length - 1]);
    } catch (e) {}
  }, [isOpen]);

  // Helper: update Y domain using values from visible dateTicks indices
  const updateYDomainForVisible = (startIndex, endIndex) => {
    const vals = [];
    if (dateTicks && dateTicks.length > 0) {
      for (let i = Math.max(0, startIndex); i <= Math.min(dateTicks.length - 1, endIndex); i++) {
        const dt = dateTicks[i];
        const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
        const arr = pointsByDate[key] || [];
        arr.forEach(p => metrics.forEach(m => { const v = p[m.key]; if (v != null) vals.push(v); }));
      }
    }
    if (vals.length === 0) {
      // no visible values — fallback to full range
      setYDomain({ min: fullYMin, max: fullYMax });
      return;
    }
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) {
      // expand small constant ranges for visual clarity
      min = Math.max(0, min - 1);
      max = max + 1;
    }
    // add padding
    const span = Math.max(1, (max - min));
    const pad = Math.max(1, span * 0.12);
    setYDomain({ min: Math.floor(min - pad), max: Math.ceil(max + pad) });
  };

  // Layout constants — increased so the modal/chart has more room
  const width = 900;
  const height = 380;
  const padding = { top: 28, right: 24, bottom: 48, left: 64 };

  // Compute SVG drawing width based on number of date ticks so chart can be scrolled
  const svgWidth = (typeof dateTicks !== 'undefined' && dateTicks.length > 0)
    ? Math.max(width, padding.left + padding.right + (dateTicks.length - 1) * 120, 900)
    : width;

  // scale helpers
  const xFor = (i) => {
    const usable = svgWidth - padding.left - padding.right;
    if (!dateTicks || dateTicks.length <= 1) return padding.left + usable / 2;
    return padding.left + (i / (dateTicks.length - 1)) * usable;
  };
  const yFor = (v) => {
    const usable = height - padding.top - padding.bottom;
    // invert scale using dynamic yDomain
    const min = (typeof yDomain.min !== 'undefined') ? yDomain.min : fullYMin;
    const max = (typeof yDomain.max !== 'undefined') ? yDomain.max : fullYMax;
    const span = (max === min) ? 1 : (max - min);
    return padding.top + usable - ((v - min) / span) * usable;
  };

  // trend summary: compare first and last
  const summarize = (key) => {
    const vals = points.map(p => p[key]).filter(v => v != null);
    if (vals.length === 0) return { trend: 'no-data', value: null, desc: 'No data' };
    const last = vals[vals.length - 1];
    if (vals.length === 1) {
      return { trend: 'single', value: last, desc: '' };
    }
    const first = vals[0];
    const diff = last - first;
    const pct = (Math.abs(diff) / (first || 1)) * 100;
    let state = 'stable';
    if (pct >= 5) state = diff > 0 ? 'increasing' : 'declining';
    const desc = (state === 'stable') ? state : `${state}, change ${diff.toFixed(1)}`;
    return { trend: state, value: last, desc };
  };

  const metricSummaries = metrics.map(m => summarize(m.key));

  // prepare a fully chronological list of all readings (across days)
  const allPointsSorted = points.slice().sort((a,b) => a.ts - b.ts);

  // intra-day x-offset (px) to separate multiple readings on the same date
  const intraGap = 18;

  // ref for scrollable chart container
  const chartContainerRef = useRef(null);
  const isDownRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const pointerIdRef = useRef(null);
  const [centerDateLabel, setCenterDateLabel] = useState('');
  

  const scrollChartBy = (offset) => {
    const c = chartContainerRef.current;
    if (!c) return;
    const target = Math.max(0, Math.min(c.scrollWidth - c.clientWidth, c.scrollLeft + offset));
    try {
      c.scrollTo({ left: target, behavior: 'smooth' });
    } catch (e) {
      c.scrollLeft = target;
    }
  };

  

  // Pointer-based drag handlers (unified mouse/touch + robust capture)
  const onPointerDown = (e) => {
    const container = chartContainerRef.current;
    if (!container) return;
    try { container.setPointerCapture && container.setPointerCapture(e.pointerId); } catch (_) {}
    pointerIdRef.current = e.pointerId;
    isDownRef.current = true;
    container.classList.add('dragging');
    startXRef.current = e.clientX - container.getBoundingClientRect().left;
    scrollLeftRef.current = container.scrollLeft;
    // add global listeners so pointermove/up still fire even if pointer moves over SVG or outside container
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const onPointerMove = (e) => {
    const container = chartContainerRef.current;
    if (!container || !isDownRef.current) return;
    e.preventDefault();
    const x = e.clientX - container.getBoundingClientRect().left;
    const walk = (x - startXRef.current) * 1;
    container.scrollLeft = scrollLeftRef.current - walk;
  };

  const onPointerUp = (e) => {
    const container = chartContainerRef.current;
    if (!container) return;
    try { container.releasePointerCapture && container.releasePointerCapture(pointerIdRef.current); } catch (_){ }
    pointerIdRef.current = null;
    isDownRef.current = false;
    container.classList.remove('dragging');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  // Update center date label based on current scroll position
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    const update = () => {
      if (!dateTicks || dateTicks.length === 0) {
        setCenterDateLabel('');
        return;
      }
      const center = container.scrollLeft + container.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < dateTicks.length; i++) {
        const dx = Math.abs(xFor(i) - center);
        if (dx < bestDist) {
          bestDist = dx;
          best = i;
        }
      }
      const d = dateTicks[best];
      setCenterDateLabel(d ? d.toLocaleDateString() : '');
    };

    // call initially
    update();
    container.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      container.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [dateTicks, svgWidth]);

  // Recompute y-domain as the user scrolls so left-side numbers follow the visible range
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || !dateTicks || dateTicks.length === 0) return;
    let raf = null;
    const handleScroll = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // compute visible index range
        const left = container.scrollLeft;
        const right = left + container.clientWidth;
        let startIndex = 0; let endIndex = dateTicks.length - 1;
        for (let i = 0; i < dateTicks.length; i++) {
          const x = xFor(i);
          if (x >= left && startIndex === 0) { startIndex = Math.max(0, i - 1); break; }
        }
        for (let i = dateTicks.length - 1; i >= 0; i--) {
          const x = xFor(i);
          if (x <= right) { endIndex = Math.min(dateTicks.length - 1, i + 1); break; }
        }
        updateYDomainForVisible(startIndex, endIndex);
      });
    };

    // initial domain set
    updateYDomainForVisible(0, Math.min(dateTicks.length - 1, Math.floor(container.clientWidth / 120)));

    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [dateTicks, svgWidth, pointsByDate]);

  // Auto-center chart to today's date (or nearest within selected month) when modal opens or month changes
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || !dateTicks || dateTicks.length === 0) return;
    const today = new Date();
    // find index of today's date within dateTicks
    let idx = dateTicks.findIndex(d => d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate());
    if (idx === -1) {
      // if today is outside selected month, choose nearest: start or end
      const first = dateTicks[0];
      const last = dateTicks[dateTicks.length - 1];
      if (today < first) idx = 0;
      else if (today > last) idx = dateTicks.length - 1;
      else {
        // fallback to closest by date distance
        let best = 0; let bestDiff = Infinity;
        for (let i = 0; i < dateTicks.length; i++) {
          const diff = Math.abs(dateTicks[i] - today);
          if (diff < bestDiff) { bestDiff = diff; best = i; }
        }
        idx = best;
      }
    }
    const targetX = xFor(idx) - container.clientWidth / 2;
    const left = Math.max(0, Math.min(container.scrollWidth - container.clientWidth, targetX));
    // wait for layout to settle so scrollWidth is accurate
    // wait for layout to settle so scrollWidth is accurate; try twice if needed
    requestAnimationFrame(() => {
      try { container.scrollTo({ left, behavior: 'smooth' }); } catch (e) { container.scrollLeft = left; }
      // in case layout still changes (images/fonts), schedule a small follow-up
      setTimeout(() => {
        try { container.scrollTo({ left, behavior: 'smooth' }); } catch (e) { container.scrollLeft = left; }
      }, 120);
    });
  }, [selectedMonth, svgWidth]);

  // If the modal is not open, do not render the overlay/DOM. Hooks above are still called.
  if (!isOpen) return null;

  return (
    <div className="trend-modal-overlay" onClick={onClose}>
      <div className="trend-modal" onClick={(e) => e.stopPropagation()} style={{ width: '1100px', maxWidth: '96vw', maxHeight: '90vh', overflow: 'auto', padding: 16 }}>
        <div className="trend-modal-header">
          <h3>{elderly?.name} — Vital Trends</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="trend-explanation">
          <p>The chart shows recent values for each vital. Colors indicate metric categories.</p>
          <div style={{ marginTop: 8, marginBottom: 8 }}>
            <label style={{ fontSize: 13, marginRight: 8 }}>Month:</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={{ padding: '4px 8px' }}
            />
            <div className="trend-debug" style={{ display: 'inline-block', marginLeft: 12, fontSize: 12, color: '#374151' }}>
              Showing {dateTicks.length || 0} day(s)
            </div>
          </div>
          <div className="trend-summary">
            {metricSummaries.map((s, i) => (
              <div key={i} className="trend-summary-item">
                <strong style={{ color: metrics[i].color }}>{metrics[i].label}</strong>:
                <span style={{ marginLeft: 8, color: metrics[i].color, fontWeight: 600 }}>
                  {s.value != null ? s.value : s.desc}
                  {s.value != null && s.desc ? ` (${s.desc})` : null}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative' }} className="trend-chart-area">
          {/* y-axis DOM labels (fixed to left of the chart area) */}
          <div className="trend-y-labels" aria-hidden style={{ position: 'absolute', left: 6, top: 8, width: padding.left - 8, height: height + 'px', pointerEvents: 'none', zIndex: 80, background: '#fff', paddingRight: 6, boxSizing: 'border-box' }}>
            {(() => {
              const lines = 4;
              const min = (typeof yDomain.min !== 'undefined') ? yDomain.min : fullYMin;
              const max = (typeof yDomain.max !== 'undefined') ? yDomain.max : fullYMax;
              const span = (max - min) || 1;
              // show labels descending (top = max)
              if (!hasNumeric) return null;
              const formatYLabel = (v, span) => {
                // preserve whole numbers for large spans, show one decimal for moderate spans,
                // and two decimals for very small spans
                if (Math.abs(span) >= 50) return String(Math.round(v));
                if (Math.abs(span) >= 1) return (Math.round(v * 10) / 10).toString().replace(/\.0$/, '');
                return v.toFixed(2);
              };
              return Array.from({ length: lines + 1 }).map((_, i) => {
                const v = max - (i / lines) * span;
                const y = yFor(v);
                const display = formatYLabel(v, span);
                return (
                  <div key={i} style={{ position: 'absolute', left: 0, top: (y - 8) + 'px', width: '100%', textAlign: 'right', fontSize: 11, color: '#6b7280' }}>{display}</div>
                );
              });
            })()}
          </div>

          <div
            className="trend-chart-wrap"
            ref={chartContainerRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
          {/* floating center date indicator */}
          <div className="trend-current-date" aria-hidden>{centerDateLabel}</div>
          <div className="trend-chart-inner" style={{ width: svgWidth + 'px', minWidth: svgWidth + 'px' }}>
            <svg width={svgWidth} height={height} className="trend-svg">
            {/* axes */}
            <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="#ddd" />
            <line x1={padding.left} y1={height - padding.bottom} x2={svgWidth - padding.right} y2={height - padding.bottom} stroke="#ddd" />

            {/* grid horizontal labels */}
            {(() => {
              const lines = 4;
              const min = (typeof yDomain.min !== 'undefined') ? yDomain.min : fullYMin;
              const max = (typeof yDomain.max !== 'undefined') ? yDomain.max : fullYMax;
              const span = (max - min) || 1;
              return Array.from({ length: lines + 1 }).map((_, i) => {
                const v = max - (i / lines) * span;
                const y = yFor(v);
                return (
                  <g key={i}>
                    <line x1={padding.left} x2={svgWidth - padding.right} y1={y} y2={y} stroke="#f3f4f6" />
                  </g>
                );
              });
            })()}

            {/* metric lines: connect all chronological readings (including multiples per day) */}
            {metrics.map((m) => (
              <g key={m.key}>
                <path
                  d={allPointsSorted.map((p, idx) => {
                    const key = `${p.ts.getFullYear()}-${String(p.ts.getMonth()+1).padStart(2,'0')}-${String(p.ts.getDate()).padStart(2,'0')}`;
                    const dayIndex = dateTicks.findIndex(d => d.getFullYear() === p.ts.getFullYear() && d.getMonth() === p.ts.getMonth() && d.getDate() === p.ts.getDate());
                    if (dayIndex === -1) return null;
                    const dayArr = pointsByDate[key] || [];
                    const posIndex = dayArr.findIndex(x => x === p);
                    const centerX = xFor(dayIndex);
                    const x = centerX + ((posIndex - (dayArr.length - 1) / 2) * intraGap);
                    const val = p[m.key];
                    if (val == null) return null;
                    const y = yFor(val);
                    return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                  }).filter(Boolean).join(' ')}
                  fill="none"
                  stroke={m.color}
                  strokeWidth={2}
                />

                {/* draw circles for each reading */}
                {allPointsSorted.map((p, idx) => {
                  const key = `${p.ts.getFullYear()}-${String(p.ts.getMonth()+1).padStart(2,'0')}-${String(p.ts.getDate()).padStart(2,'0')}`;
                  const dayIndex = dateTicks.findIndex(d => d.getFullYear() === p.ts.getFullYear() && d.getMonth() === p.ts.getMonth() && d.getDate() === p.ts.getDate());
                  if (dayIndex === -1) return null;
                  const dayArr = pointsByDate[key] || [];
                  const posIndex = dayArr.findIndex(x => x === p);
                  const centerX = xFor(dayIndex);
                  const x = centerX + ((posIndex - (dayArr.length - 1) / 2) * intraGap);
                  const val = p[m.key];
                  if (val == null) return null;
                  return <circle key={m.key + '_' + idx} cx={x} cy={yFor(val)} r={3} fill={m.color} />;
                })}
              </g>
            ))}

            {/* x labels (dates) */}
            {dateTicks.map((d, i) => (
              <text key={i} x={xFor(i)} y={height - padding.bottom + 14} fontSize={10} textAnchor="middle" fill="#374151">{d.toLocaleDateString()}</text>
            ))}
            </svg>
            {/* HTML-based x-axis labels so they remain visible and don't get clipped by SVG rendering issues */}
            <div className="trend-x-labels" style={{ position: 'relative', height: 28 }}>
              {dateTicks.map((d, i) => (
                <div
                  key={i}
                  className="trend-x-label"
                  style={{ position: 'absolute', left: xFor(i) + 'px', transform: 'translateX(-50%)', top: 2, fontSize: 11, color: '#374151' }}
                >
                  {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="trend-footer">
          <p className="trend-interpretation">Interpretation: {metricSummaries.map((s,i)=> {
            const label = metrics[i].label;
            if (s.value != null) return `${label}: ${s.value}${s.desc ? ' ('+s.desc +')' : ''}`;
            return `${label}: ${s.desc}`;
          }).join('; ')}</p>
        </div>
      </div>
    </div>
    </div>
  );
}



