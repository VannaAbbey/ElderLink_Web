import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
  doc,
  writeBatch,
} from "firebase/firestore";
import "./schedule.css";
import Navbar from "./navbar";

export default function NurseSchedule() {
  const [nurses, setNurses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [pendingAssignments, setPendingAssignments] = useState({});
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [viewMode, setViewMode] = useState("summary");
  const [activeShift, setActiveShift] = useState("1st");
  const [activeDay, setActiveDay] = useState("Monday");
  const SHOW_ALL_DAYS = "__ALL_DAYS__";

  const shiftDefs = [
    { name: "6:00 AM - 2:00 PM", key: "1st", startTime: "06:00", endTime: "14:00" },
    { name: "2:00 PM - 10:00 PM", key: "2nd", startTime: "14:00", endTime: "22:00" },
    { name: "10:00 PM - 6:00 AM", key: "3rd", startTime: "22:00", endTime: "06:00" },
    { name: "Rest Day", key: "rest", startTime: "", endTime: "" }
  ];

  const daysOfWeek = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

  // Load nurses
  useEffect(() => {
    (async () => {
      const nurseSnap = await getDocs(
        query(collection(db, "users"), where("user_type", "==", "nurse"))
      );
      setNurses(nurseSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    })();
  }, []);

  // Listen for assignments
  useEffect(() => {
    const q = query(
      collection(db, "nurse_shift_assign_v2"),
      where("is_current", "==", true)
    );
    const unsub = onSnapshot(q, (snap) => {
      setAssignments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // Initialize pending assignments when entering edit mode
  useEffect(() => {
    if (viewMode === "edit") {
      const init = {};
      nurses.forEach((n) => {
        // reconstruct: day -> shift
        const current = assignments.filter((a) => a.nurse_id === n.id);
        const dayToShift = {};
        current.forEach((a) => {
          a.days_assigned.forEach((day) => {
            dayToShift[day] = a.shift;
          });
        });
        init[n.id] = dayToShift;
      });
      setPendingAssignments(init);
    }
  }, [viewMode, assignments, nurses]);

  const nurseName = (nurseId) => {
    const nurse = nurses.find((n) => n.id === nurseId);
    return nurse ? `${nurse.user_fname} ${nurse.user_lname}` : "Unknown Nurse";
  };

  // Clear all nurse schedules from Firestore
  const handleClearAll = async () => {
    if (!window.confirm("Are you sure you want to clear all nurse schedules? This cannot be undone.")) return;
    setSaving(true);
    const batch = writeBatch(db);
    // Find all assignment docs for current nurses
    assignments.forEach((a) => {
      if (nurses.some((n) => n.id === a.nurse_id)) {
        batch.delete(doc(db, "nurse_shift_assign_v2", a.id));
      }
    });
    try {
      await batch.commit();
      setPendingAssignments({});
      setEditing(false);
    } catch (e) {
      alert("Failed to clear schedules: " + e.message);
    }
    setSaving(false);
  };

  const [notification, setNotification] = useState("");

  const handleSaveAll = async () => {
    setSaving(true);
    const batch = writeBatch(db);

    for (const nurseId of Object.keys(pendingAssignments)) {
      const dayToShift = pendingAssignments[nurseId];

      // Group by shift
      const byShift = {};
      Object.entries(dayToShift).forEach(([day, shift]) => {
        if (shift !== "rest") {
          if (!byShift[shift]) byShift[shift] = [];
          byShift[shift].push(day);
        }
      });

      // Create/update docs
      for (const [shift, days] of Object.entries(byShift)) {
        const docId = `${nurseId}_${shift}`;
        const ref = doc(db, "nurse_shift_assign_v2", docId);
        const shiftDef = shiftDefs.find((s) => s.key === shift);
        const payload = {
          nurse_id: nurseId,
          shift,
          shift_name: shiftDef?.name || "",
          start_time: shiftDef?.startTime || "",
          end_time: shiftDef?.endTime || "",
          days_assigned: days,
          is_current: true,
          created_at: new Date(),
        };
        batch.set(ref, payload, { merge: true });
      }
    }

    try {
      await batch.commit();
      // Do NOT reset pendingAssignments or editing, keep the UI as is
      setNotification("Nurse schedules updated successfully.");
    } catch (e) {
      alert("Failed to save all: " + e.message);
    }
    setSaving(false);
    // Hide notification after 2 seconds
    setTimeout(() => setNotification(""), 2000);
  };

  return (
    <div className="schedule-page">
      <Navbar />
      <main className="schedule-container">
        <h2 className="page-title" style={{ marginBottom: 8 }}>Nurse Scheduling</h2>

        {/* Toggle buttons */}
        <div className="button-toggle">
          <button
            onClick={() => { setViewMode("summary"); setEditing(false); }}
            disabled={viewMode === "summary"}
            className="toggle-btn left"
          >
            View by Shift
          </button>
          <button
            onClick={() => { setViewMode("edit"); setEditing(true); }}
            disabled={viewMode === "edit"}
            className="toggle-btn right"
          >
            Edit
          </button>
        </div>

        {/* EDIT MODE */}
        {viewMode === "edit" && (
          <>
            {notification && (
              <div style={{ color: 'green', marginBottom: 8, textAlign: 'center', fontWeight: 'bold' }}>
                {notification}
              </div>
            )}
            <div className="table-container">
              <table className="schedule-table weekly-visual">
                <thead>
                  <tr>
                    <th>Nurse</th>
                    {daysOfWeek.map((day) => (
                      <th key={day}>{day}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {nurses.map((nurse) => {
                    const dayToShift = pendingAssignments[nurse.id] || {};
                    return (
                      <tr key={nurse.id}>
                        <td>{nurseName(nurse.id)}</td>
                        {daysOfWeek.map((day) => (
                          <td key={nurse.id + day} style={{ textAlign: "center" }}>
                            <select
                              value={dayToShift[day] || "rest"}
                              onChange={(e) => {
                                const val = e.target.value;
                                setPendingAssignments((prev) => ({
                                  ...prev,
                                  [nurse.id]: {
                                    ...prev[nurse.id],
                                    [day]: val,
                                  },
                                }));
                              }}
                            >
                              {shiftDefs.map((shift) => (
                                <option key={shift.key} value={shift.key}>{shift.name}</option>
                              ))}
                            </select>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="save-container">
              <button
                onClick={handleSaveAll}
                disabled={saving || Object.keys(pendingAssignments).length === 0}
                className="save-btn"
              >
                Save All
              </button>
              <button
                onClick={handleClearAll}
                disabled={saving}
                className="clear-btn"
                style={{ marginLeft: 12 }}
              >
                Clear All
              </button>
            </div>
          </>
        )}

        {/* SUMMARY MODE */}
        {viewMode === "summary" && (
          <div className="table-container">
            <div className="shift-tabs">
              {shiftDefs.filter(s => s.key !== "rest").map((s) => (
                <button
                  key={s.key}
                  className={`shift-tab ${activeShift === s.key ? "active-shift" : ""}`}
                  onClick={() => setActiveShift(s.key)}
                >
                  {s.name}
                </button>
              ))}
            </div>

            <div className="day-tabs">
              <button
                key={SHOW_ALL_DAYS}
                className={`day-tab${activeDay === SHOW_ALL_DAYS ? " active-day" : ""}`}
                onClick={() => setActiveDay(SHOW_ALL_DAYS)}
              >
                Show All Days
              </button>
              {daysOfWeek.map((day) => (
                <button
                  key={day}
                  className={`day-tab${activeDay === day ? " active-day" : ""}`}
                  onClick={() => setActiveDay(day)}
                >
                  {day}
                </button>
              ))}
            </div>

            <table className="schedule-table shift-summary">
              <thead>
                <tr>
                  <th>Nurse</th>
                </tr>
              </thead>
              <tbody>
                {(activeDay === SHOW_ALL_DAYS
                  ? assignments.filter((a) => a.shift === activeShift)
                  : assignments.filter((a) => a.shift === activeShift && a.days_assigned.includes(activeDay))
                ).length > 0 ? (
                  (activeDay === SHOW_ALL_DAYS
                    ? assignments.filter((a) => a.shift === activeShift)
                    : assignments.filter((a) => a.shift === activeShift && a.days_assigned.includes(activeDay))
                  ).map((a) => (
                    <tr key={a.id}>
                      <td>{nurseName(a.nurse_id)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td style={{ textAlign: "center", color: "#888" }}>
                      <em>{activeDay === SHOW_ALL_DAYS ? "No Nurse Assigned for this shift." : "No Nurse Assigned for this day."}</em>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
