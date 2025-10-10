import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import { onSnapshot, collection, query, where } from "firebase/firestore";
import "./schedule.css";
import Navbar from "./navbar";
import { NurseScheduleService } from "../services/nurseScheduleService";
import { markNurseAbsent, getTempReassignments, hasAbsenceForDate, batchCheckAbsencesForDate } from "../services/nurseAbsenceService";

export default function NurseSchedule() {
  const [nurses, setNurses] = useState([]);
  const [houses, setHouses] = useState([]);
  const [elderlyList, setElderlyList] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [nurseElderlyAssignments, setNurseElderlyAssignments] = useState([]);
  const [tempReassignments, setTempReassignments] = useState([]);
  // Removed caregiver dependencies - nurses work with all elderly in houses
  const [pendingAssignments, setPendingAssignments] = useState({});
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [viewMode, setViewMode] = useState("summary");
  const [activeShift, setActiveShift] = useState("1st");
  const [activeDay, setActiveDay] = useState("Sunday");
  const [notification, setNotification] = useState("");
  const [scheduleGeneration, setScheduleGeneration] = useState({
    isGenerating: false,
    currentPeriod: null,
    periodDuration: 30, // days
    lastShiftRotation: {} // nurseId -> lastShift
  });
  const [expandedHouses, setExpandedHouses] = useState(new Set()); // Track which house sections are expanded
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [scheduleInfo, setScheduleInfo] = useState(null);
  const [newNurses, setNewNurses] = useState([]); // Track new nurses not in current schedule
  const [nurseAbsences, setNurseAbsences] = useState({}); // Track absence status by nurse-date-shift
  const SHOW_ALL_DAYS = "__ALL_DAYS__";

  // Initialize service instance
  const nurseScheduleService = new NurseScheduleService(db);

  const shiftDefs = NurseScheduleService.SHIFT_DEFS;
  const daysOfWeek = NurseScheduleService.DAYS_OF_WEEK;

  // Load nurses, houses, and elderly
  useEffect(() => {
    (async () => {
      const { nurses, houses, elderly } = await nurseScheduleService.loadAllData();
      setNurses(nurses);
      setHouses(houses);
      setElderlyList(elderly);
    })();
  }, []);

  // Real-time listener for nurses to detect new nurses immediately
  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, "users"), where("user_type", "==", "nurse")), 
      (snapshot) => {
        const nursesData = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter(nurse => nurse.scheduleStatus !== "inactive");
        setNurses(nursesData);
      }
    );
    
    return () => unsubscribe();
  }, []);

  // Removed caregiver dependency listeners - nurses now work with all elderly in assigned houses

  // Listen for assignments
  useEffect(() => {
    const unsub = nurseScheduleService.subscribeToNurseShiftAssignments(setAssignments);
    return () => unsub();
  }, []);

  // Listen for nurse-elderly assignments
  useEffect(() => {
    const unsub = nurseScheduleService.subscribeToNurseElderlyAssignments(setNurseElderlyAssignments);
    return () => unsub();
  }, []);

  // Load temporary reassignments when date or shift changes
  useEffect(() => {
    const loadTempReassignments = async () => {
      if (activeShift && selectedDate) {
        const dateStr = formatDateString(selectedDate);
        const tempAssigns = await getTempReassignments(dateStr, activeShift);
        setTempReassignments(tempAssigns);
      }
    };
    loadTempReassignments();
  }, [selectedDate, activeShift]);

  // Load comprehensive absence data for current context (batch optimized)
  useEffect(() => {
    const loadAbsenceData = async () => {
      if (nurses.length > 0 && selectedDate && activeShift) {
        const dateStr = formatDateString(selectedDate);
        
        // Check which nurses need absence data loading
        const nursesNeedingData = nurses.filter(nurse => {
          const key = `${nurse.id}-${dateStr}-${activeShift}`;
          return nurseAbsences[key] === undefined;
        });
        
        if (nursesNeedingData.length > 0) {
          console.log(`📊 Batch loading absence data for ${nursesNeedingData.length} nurses on ${dateStr} - ${activeShift}`);
          
          // Use batch function for better performance
          const nurseIds = nursesNeedingData.map(n => n.id);
          const batchResults = await batchCheckAbsencesForDate(nurseIds, dateStr, activeShift);
          
          // Update state with batch results while preserving existing data
          setNurseAbsences(prev => {
            const updated = { ...prev };
            nursesNeedingData.forEach(nurse => {
              const key = `${nurse.id}-${dateStr}-${activeShift}`;
              const batchKey = `${nurse.id}-${dateStr}-${activeShift}`;
              updated[key] = batchResults[batchKey] || false;
            });
            return updated;
          });
          
          console.log(`✅ Batch loaded absence data for ${nursesNeedingData.length} nurses`);
        }
      }
    };
    loadAbsenceData();
  }, [nurses.length, selectedDate, activeShift]); // Optimized dependencies

  // Initialize pending assignments when entering edit mode
  useEffect(() => {
    if (viewMode === "edit") {
      const initShifts = nurseScheduleService.initializePendingAssignments(nurses, assignments);
      setPendingAssignments(initShifts);
    }
  }, [viewMode, assignments, nurses]);

  // Detect new nurses when nurses change (real-time updates)
  useEffect(() => {
    if (nurses.length > 0) {
      const detectedNewNurses = nurseScheduleService.detectNewNurses(nurses, assignments);
      setNewNurses(detectedNewNurses);
    }
  }, [nurses]); // Listen to nurses array changes for real-time updates

  // Check for schedule expiration and auto-regenerate if needed
  useEffect(() => {
    const checkScheduleExpiration = () => {
      if (nurseScheduleService.checkScheduleExpiration(assignments)) {
        console.log('Schedule expired, auto-generating new schedule...');
        handleGenerateSchedule();
      }
    };
    
    // Check every hour for expiration
    const interval = setInterval(checkScheduleExpiration, 60 * 60 * 1000);
    
    // Also check immediately on component mount
    checkScheduleExpiration();
    
    return () => clearInterval(interval);
  }, [assignments.length]);

  // Track schedule info from assignments for date picker validation
  useEffect(() => {
    if (!assignments || assignments.length === 0) return;

    // Get the first current assignment (they share same start/end dates)
    const currentAssign = assignments.find(a => a.is_current);
    if (!currentAssign) return;

    const start = currentAssign.schedule_period?.start_date?.toDate();
    const end = currentAssign.schedule_period?.end_date?.toDate();

    // Only set schedule info if both dates exist
    if (start && end) {
      setScheduleInfo({ start, end });
    } else {
      // Clear schedule info if dates don't exist (allows unrestricted date selection)
      setScheduleInfo(null);
    }
  }, [assignments]);

  // Validate selected date when schedule info changes
  useEffect(() => {
    if (scheduleInfo?.start && scheduleInfo?.end) {
      const today = new Date();
      const start = scheduleInfo.start;
      const end = scheduleInfo.end;
      
      // If selected date is outside schedule range, reset to today (if within range) or start date
      if (selectedDate < start || selectedDate > end) {
        if (today >= start && today <= end) {
          setSelectedDate(today);
        } else {
          setSelectedDate(start);
        }
      }
    }
  }, [scheduleInfo, selectedDate]);

  const nurseName = (nurseId) => nurseScheduleService.getNurseName(nurseId, nurses);
  const houseName = (houseId) => nurseScheduleService.getHouseName(houseId, houses);
  const elderlyName = (elderlyId) => nurseScheduleService.getElderlyName(elderlyId, elderlyList);

  // Date formatting function
  const formatDateString = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Get elderly assigned to nurse for a specific day
  const getElderlyForNurseDay = (nurseId, day) => 
    nurseScheduleService.getElderlyForNurseDay(nurseId, day, nurseElderlyAssignments);

  // Get house for elderly (group elderly by house)
  const getHouseForElderly = (elderlyId) => 
    nurseScheduleService.getHouseForElderly(elderlyId, elderlyList);

  // Helper function to refresh absence data for a specific nurse
  const refreshNurseAbsenceData = async (nurseId, dateStr, shift) => {
    try {
      const result = await hasAbsenceForDate(nurseId, dateStr, shift);
      const key = `${nurseId}-${dateStr}-${shift}`;
      setNurseAbsences(prev => ({
        ...prev,
        [key]: result.hasAbsence
      }));
      return result.hasAbsence;
    } catch (error) {
      console.error("Error refreshing nurse absence data:", error);
      return false;
    }
  };

  // Helper function to check if nurse is absent on a specific date and day (comprehensive check)
  const isNurseAbsentForDay = (nurseId, date, shift) => {
    const dateStr = formatDateString(date);
    const key = `${nurseId}-${dateStr}-${shift}`;
    
    // Use comprehensive absence data from nurse_cg_absence collection
    const isAbsent = nurseAbsences[key];
    
    // If we don't have the data, trigger a refresh but return false for now
    if (isAbsent === undefined) {
      refreshNurseAbsenceData(nurseId, dateStr, shift);
      return false;
    }
    
    return isAbsent === true;
  };

  // ========== ACCORDION FUNCTIONALITY SECTION ==========
  // This section contains all accordion-related functions for the schedule-page component
  
  // Get house assignments for display purposes
  const getNurseHouseAssignments = (nurseId, day, shift) => {
    const assignment = nurseElderlyAssignments.find(
      (a) => a.user_id === nurseId && a.day === day && a.shift === shift
    );
    return assignment?.house_id || [];
  };

  // Group elderly by house for better display
  const groupElderlyByHouse = (elderlyIds) => 
    nurseScheduleService.groupElderlyByHouse(elderlyIds, elderlyList);

  // Toggle house expansion for accordion
  const toggleHouseExpansion = (nurseId, houseId) => {
    const key = `${nurseId}-${houseId}`;
    setExpandedHouses(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  // Create accordion content for elderly assignments within schedule-page
  const createAccordionContent = (elderlyAssignments, activeShift, activeDay, nurseId) => {
    if (activeShift === "3rd") {
      return <em style={{ color: "#888" }}>No elderly assigned for 3rd shift</em>;
    }

    // Get temporary reassignments TO this nurse for the current date
    const dateStr = formatDateString(selectedDate);
    const indexToDayName = {
      0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 
      4: "Thursday", 5: "Friday", 6: "Saturday"
    };
    const currentDay = activeDay === SHOW_ALL_DAYS ? 
      indexToDayName[selectedDate.getDay()] : 
      activeDay;
    
    // Check if this nurse is absent for the current date and day (comprehensive check)
    const isThisNurseAbsent = isNurseAbsentForDay(nurseId, selectedDate, activeShift);
    
    // Don't show temp assignments if the nurse is absent
    const tempAssignmentsToNurse = !isThisNurseAbsent ? tempReassignments.filter(t => 
      t.to_user_id === nurseId && 
      t.date === dateStr && 
      t.shift === activeShift &&
      (activeDay === SHOW_ALL_DAYS || t.day.toLowerCase() === activeDay.toLowerCase())
    ) : [];

    // Get all elderly IDs from both regular and temporary assignments
    const regularElderlyIds = elderlyAssignments.flatMap(ea => ea.elderly_ids || []);
    const tempElderlyIds = tempAssignmentsToNurse.flatMap(t => t.elderly_ids || []);
    const allElderlyIds = [...regularElderlyIds, ...tempElderlyIds];

    if (allElderlyIds.length === 0) {
      return <em style={{ color: "#888" }}>No elderly assigned</em>;
    }

    if (activeDay === SHOW_ALL_DAYS) {
      // Group by day first, then by house
      const dayGroups = {};
      
      // Add regular assignments
      elderlyAssignments.forEach(ea => {
        if (!dayGroups[ea.day]) dayGroups[ea.day] = [];
        dayGroups[ea.day].push(...(ea.elderly_ids || []));
      });
      
      // Add temporary assignments
      tempAssignmentsToNurse.forEach(t => {
        if (!dayGroups[t.day]) dayGroups[t.day] = [];
        dayGroups[t.day].push(...(t.elderly_ids || []));
      });

      // Accordion JSX for schedule-page - Show All Days view
      return (
        <div className="assignment-accordion">
          {Object.entries(dayGroups).map(([day, elderlyIds]) => {
            const groupedByHouse = groupElderlyByHouse(elderlyIds);
            return (
              <div key={day} className="day-group">
                <strong className="day-header">{day}:</strong>
                {Object.keys(groupedByHouse).length > 0 ? (
                  <div className="house-accordions">
                    {Object.entries(groupedByHouse).map(([houseId, elderly]) => {
                      const expansionKey = `${nurseId}-${houseId}-${day}`;
                      const isExpanded = expandedHouses.has(expansionKey);
                      return (
                        <div key={houseId} className="house-accordion">
                          <div 
                            className="house-header"
                            onClick={() => toggleHouseExpansion(nurseId, `${houseId}-${day}`)}
                          >
                            <div className="house-info">
                              <span className="house-name">{houseName(houseId)} ({elderly.length})</span>
                            </div>
                            <span className="expand-icon">{isExpanded ? '−' : '+'}</span>
                          </div>
                          {isExpanded && (
                            <div className="elderly-list">
                              {elderly.map(e => `${e.elderly_fname} ${e.elderly_lname}`).join(", ")}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <span className="no-assignments">No assignments</span>
                )}
              </div>
            );
          })}
        </div>
      );
    } else {
      // Show specific day grouped by house - use combined elderly IDs
      const groupedByHouse = groupElderlyByHouse(allElderlyIds);
      
      if (Object.keys(groupedByHouse).length === 0) {
        return <em style={{ color: "#888" }}>No assignments</em>;
      }

      // Accordion JSX for schedule-page - Specific Day view
      return (
        <div className="assignment-accordion">
          <div className="house-accordions">
            {Object.entries(groupedByHouse).map(([houseId, elderly]) => {
              const expansionKey = `${nurseId}-${houseId}`;
              const isExpanded = expandedHouses.has(expansionKey);
              return (
                <div key={houseId} className="house-accordion">
                  <div 
                    className="house-header"
                    onClick={() => toggleHouseExpansion(nurseId, houseId)}
                  >
                    <div className="house-info">
                      <span className="house-name">{houseName(houseId)} ({elderly.length})</span>
                    </div>
                    <span className="expand-icon">{isExpanded ? '−' : '+'}</span>
                  </div>
                  {isExpanded && (
                    <div className="elderly-list">
                      {elderly.map(e => `${e.elderly_fname} ${e.elderly_lname}`).join(", ")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {tempElderlyIds.length > 0 && (
            <div style={{ fontSize: '0.8em', color: '#007bff', marginTop: '8px', fontStyle: 'italic' }}>
              + {tempElderlyIds.length} temporarily assigned from absent nurses
            </div>
          )}
        </div>
      );
    }
  };
  // ========== END OF ACCORDION FUNCTIONALITY SECTION ==========

  // Filter assignments based on selected date
  const getFilteredAssignments = () => {
    if (activeDay === SHOW_ALL_DAYS) {
      return assignments.filter((a) => a.shift === activeShift);
    } else {
      // Filter by both day and date range
      return assignments.filter((a) => {
        const matchesShift = a.shift === activeShift;
        const matchesDay = a.days_assigned.includes(activeDay);
        
        // Check if selected date falls within assignment date range (if date fields exist)
        const startDate = a.schedule_period?.start_date?.toDate();
        const endDate = a.schedule_period?.end_date?.toDate();
        
        // If no date range is specified, just match shift and day
        if (!startDate || !endDate) {
          return matchesShift && matchesDay;
        }
        
        // If date range exists, check if selected date falls within it
        const selectedDateObj = new Date(selectedDate);
        const withinDateRange = selectedDateObj >= startDate && selectedDateObj <= endDate;
        
        return matchesShift && matchesDay && withinDateRange;
      });
    }
  };

  // Handle marking nurse as absent (PERMANENT - cannot be undone)
  const handleMarkAbsent = async (assignmentId, nurseId) => {
    try {
      // Get the target date and day name
      const targetDateStr = formatDateString(selectedDate);
      const indexToDayName = {
        0: "Sunday",
        1: "Monday", 
        2: "Tuesday",
        3: "Wednesday",
        4: "Thursday",
        5: "Friday",
        6: "Saturday"
      };
      const dayName = activeDay === SHOW_ALL_DAYS ? indexToDayName[selectedDate.getDay()] : activeDay;

      const nurseFullName = nurseScheduleService.getNurseName(nurseId, nurses);
      
      // Check if nurse is already marked absent for this specific date and day using comprehensive check
      const isAlreadyAbsent = isNurseAbsentForDay(nurseId, selectedDate, activeShift);
      if (isAlreadyAbsent) {
        alert(`${nurseFullName} is already marked as PERMANENTLY ABSENT for ${dayName}, ${selectedDate.toLocaleDateString()}`);
        return;
      }
      
      // Also check if we have absence data but it's still loading
      const absenceKey = `${nurseId}-${targetDateStr}-${activeShift}`;
      if (nurseAbsences[absenceKey] === undefined) {
        // Data is still loading, refresh and check again
        const currentStatus = await refreshNurseAbsenceData(nurseId, targetDateStr, activeShift);
        if (currentStatus) {
          alert(`${nurseFullName} is already marked as PERMANENTLY ABSENT for ${dayName}, ${selectedDate.toLocaleDateString()}`);
          return;
        }
      }

      // Enhanced confirmation dialog with permanent warning
      const confirmed = window.confirm(
        `⚠️ PERMANENT ACTION - CANNOT BE UNDONE ⚠️\n\n` +
        `Mark ${nurseFullName} as ABSENT for:\n` +
        `• Date: ${selectedDate.toLocaleDateString()}\n` +
        `• Day: ${dayName}\n` +
        `• Shift: ${activeShift}\n\n` +
        `⚠️ WARNING: This action is PERMANENT and CANNOT be reversed!\n\n` +
        `The nurse will remain marked as absent for this specific date and shift permanently.\n` +
        `Their elderly assignments will be redistributed to other available nurses.\n\n` +
        `Are you absolutely sure you want to proceed?`
      );
      
      if (!confirmed) return;

      setSaving(true);
      
      console.log(`🚨 PERMANENTLY marking nurse ${nurseFullName} as absent for ${targetDateStr} (${dayName})`);
      console.log(`Current absence state:`, nurseAbsences[absenceKey]);
      
      const markResult = await markNurseAbsent(
        assignmentId,
        assignments,
        nurseElderlyAssignments,
        tempReassignments,
        targetDateStr,
        dayName,
        'supervisor_marked', // reason
        `Permanently marked absent by supervisor on ${new Date().toLocaleString()}`, // notes
        'supervisor' // marked by
      );

      // Refresh temporary reassignments
      const updatedTempAssigns = await getTempReassignments(targetDateStr, activeShift);
      setTempReassignments(updatedTempAssigns);

      // Immediately update absence state to reflect the new absence (optimistic update)
      const stateKey = `${nurseId}-${targetDateStr}-${activeShift}`;
      setNurseAbsences(prev => ({
        ...prev,
        [stateKey]: true // We know it's absent since we just marked it
      }));
      
      console.log(`✅ Updated absence state for ${nurseId} on ${targetDateStr}`);

      // Force a refresh of absence data to ensure persistence across tab switches
      setTimeout(async () => {
        const verifyResult = await hasAbsenceForDate(nurseId, targetDateStr, activeShift);
        console.log(`🔍 Verification: Nurse ${nurseId} absence status:`, verifyResult);
        if (verifyResult.hasAbsence) {
          const verifyKey = `${nurseId}-${targetDateStr}-${activeShift}`;
          setNurseAbsences(prev => ({
            ...prev,
            [verifyKey]: true
          }));
        }
      }, 1000);

      setNotification(`🔒 ${nurseFullName} PERMANENTLY marked as absent. This action cannot be undone. Elderly assignments redistributed.`);
      setTimeout(() => setNotification(""), 7000);

    } catch (error) {
      console.error("Error marking nurse absent:", error);
      setNotification(`❌ Failed to mark nurse as absent: ${error.message}`);
      setTimeout(() => setNotification(""), 5000);
    } finally {
      setSaving(false);
    }
  };

  // Clear all nurse schedules from Firestore
  const handleClearAll = async () => {
    if (!window.confirm("Are you sure you want to clear all nurse schedules and elderly assignments? This cannot be undone.")) return;
    setSaving(true);
    
    try {
      console.log("🎯 Clear All button clicked - starting operation...");
      const result = await nurseScheduleService.clearAllSchedules(assignments, nurseElderlyAssignments, nurses);
      
      console.log("🎉 Clear operation completed:", result);
      
      setPendingAssignments({});
      setEditing(false);
      
      // Show success notification
      setNotification(`✅ Cleared ${result.shiftDeleteCount} shift assignments and ${result.elderlyDeleteCount} elderly assignments!`);
      setTimeout(() => setNotification(""), 5000);
      
    } catch (e) {
      console.error("💥 Clear operation failed:", e);
      alert("Failed to clear schedules: " + e.message);
    }
    setSaving(false);
  };

  // Handle automatic schedule generation
  const handleGenerateSchedule = async () => {
    if (!window.confirm("This will generate a new 1-month schedule with rotating shifts and work-rest patterns. Continue?")) return;
    
    setScheduleGeneration(prev => ({ ...prev, isGenerating: true }));
    setSaving(true);
    
    try {
      const result = await nurseScheduleService.generateAndSaveSchedule(
        nurses, 
        assignments, 
        nurseElderlyAssignments, 
        scheduleGeneration.lastShiftRotation, 
        elderlyList, 
        houses,
        scheduleGeneration.periodDuration
      );
      
      setPendingAssignments(result.monthlyAssignments);
      setScheduleGeneration(prev => ({
        ...prev,
        lastShiftRotation: result.updatedShiftRotation
      }));
      
      // Refresh nurses data to update scheduleStatus and trigger real-time re-detection
      const { nurses: updatedNurses } = await nurseScheduleService.loadAllData();
      setNurses(updatedNurses);
      
      const { shiftCounts, minDaily, maxDaily, minRest, maxRest } = result.statistics;
      
      setNotification(`✅ Schedule generated! Shifts: 1st (${shiftCounts["1st"]}), 2nd (${shiftCounts["2nd"]}), 3rd (${shiftCounts["3rd"]}) nurses. Working: ${minDaily}-${maxDaily}/day, Resting: ${minRest}-${maxRest}/day. All nurses integrated!`);
      setTimeout(() => setNotification(""), 7000);
      
    } catch (e) {
      alert("Failed to generate schedule: " + e.message);
    } finally {
      setSaving(false);
      setScheduleGeneration(prev => ({ ...prev, isGenerating: false }));
    }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    
    try {
      await nurseScheduleService.saveAllSchedules(
        pendingAssignments, 
        nurses, 
        elderlyList, 
        houses
      );
      
      // Clear pending assignments
      setPendingAssignments({});
      
      // Refresh nurses data to update scheduleStatus and trigger real-time re-detection
      const { nurses: updatedNurses } = await nurseScheduleService.loadAllData();
      setNurses(updatedNurses);
      
      setNotification("✅ Nurse schedules saved successfully! Elderly assignments redistributed considering temporary reassignments.");
    } catch (e) {
      console.error("Save all error:", e);
      alert("Failed to save all: " + e.message);
    }
    setSaving(false);
    // Hide notification after 3 seconds
    setTimeout(() => setNotification(""), 3000);
  };

  // Handle copying schedule from existing nurse to new nurse
  const handleCopySchedule = (fromNurseId, toNurseId) => {
    const copiedSchedule = nurseScheduleService.copyScheduleFromNurse(fromNurseId, toNurseId, assignments);
    setPendingAssignments(prev => ({
      ...prev,
      [toNurseId]: copiedSchedule
    }));
    setNotification(`✅ Copied schedule to ${nurseName(toNurseId)}`);
    setTimeout(() => setNotification(""), 3000);
  };

  // Handle assigning specific shift to new nurse
  const handleAssignShift = (nurseId, shift) => {
    const shiftSchedule = nurseScheduleService.createBalancedSchedule(shift);
    setPendingAssignments(prev => ({
      ...prev,
      [nurseId]: shiftSchedule
    }));
    setNotification(`✅ Assigned ${shift} shift to ${nurseName(nurseId)}`);
    setTimeout(() => setNotification(""), 3000);
  };

  return (
    <div className="schedule-page">
      <Navbar />
      <main className="schedule-container">
        <h2 className="page-title" style={{ marginBottom: 8 }}>Nurse Scheduling</h2>

        {/* Schedule Info Display */}
        {scheduleInfo && (
          <div className="schedule-inline" style={{ marginBottom: 16 }}>
            <span>
              <strong>Schedule Period:</strong>{" "}
              {scheduleInfo.start?.toLocaleDateString()} → {scheduleInfo.end?.toLocaleDateString()}
            </span>
            <span>
              <strong>Selected Date:</strong> {selectedDate.toLocaleDateString()}
            </span>
          </div>
        )}

        {/* Toggle buttons */}
        <div className="button-toggle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
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
          
          {viewMode === "edit" && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                Period:
                <select
                  value={scheduleGeneration.periodDuration}
                  onChange={(e) => setScheduleGeneration(prev => ({
                    ...prev,
                    periodDuration: parseInt(e.target.value)
                  }))}
                  style={{ marginLeft: '4px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }}
                >
                  <option value={7}>1 Week</option>
                  <option value={14}>2 Weeks</option>
                  <option value={30}>1 Month</option>
                  <option value={60}>2 Months</option>
                </select>
              </label>
              
              <button
                onClick={handleGenerateSchedule}
                disabled={saving || scheduleGeneration.isGenerating}
                className="generate-btn"
                style={{ 
                  backgroundColor: '#28a745', 
                  color: 'white',
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: saving || scheduleGeneration.isGenerating ? 'not-allowed' : 'pointer'
                }}
              >
                {scheduleGeneration.isGenerating ? 'Generating...' : '🔄 Generate Schedule'}
              </button>
            </div>
          )}
        </div>

        {/* EDIT MODE */}
        {viewMode === "edit" && (
          <>
            {notification && (
              <div style={{ color: 'green', marginBottom: 8, textAlign: 'center', fontWeight: 'bold' }}>
                {notification}
              </div>
            )}
            
            {/* New Nurses Alert */}
            {newNurses.length > 0 && (
              <div className="new-nurses-alert" style={{ 
                background: 'linear-gradient(135deg, #fff3cd, #ffeaa7)', 
                border: '2px solid #28a745', 
                borderRadius: '8px', 
                padding: '12px 16px', 
                marginBottom: '16px', 
                textAlign: 'center',
                boxShadow: '0 4px 8px rgba(40, 167, 69, 0.2)'
              }}>
                <strong style={{ color: '#28a745', fontSize: '16px' }}>
                  🎉 {newNurses.length} New Nurse{newNurses.length > 1 ? 's' : ''} Detected!
                </strong>
                <div style={{ color: '#666', fontSize: '14px', marginTop: '4px' }}>
                  {newNurses.map(n => nurseName(n.id)).join(', ')} ready for scheduling
                </div>
              </div>
            )}
            <div className="table-container">
              {/* New Nurses Section - Moved to Top for Better Visibility */}
              {newNurses.length > 0 && (
                <>
                  <h3 style={{ marginBottom: '16px', color: '#28a745' }}>
                    🆕 New Nurses ({newNurses.length})
                  </h3>
                  <div className="new-nurses-info" style={{ 
                    background: '#e8f5e8', 
                    border: '1px solid #28a745', 
                    borderRadius: '8px', 
                    padding: '12px', 
                    marginBottom: '16px',
                    fontSize: '14px'
                  }}>
                    <strong>New nurses detected!</strong> These nurses are not yet included in the current schedule. 
                    Use the quick assignment buttons to integrate them.
                  </div>
                  
                  <table className="nurse-edit-table new-nurse-table weekly-visual">
                    <thead>
                      <tr>
                        <th>New Nurse</th>
                        <th>Quick Actions</th>
                        {daysOfWeek.map((day) => (
                          <th key={day}>{day}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {newNurses.map((nurse) => {
                        const dayToShift = pendingAssignments[nurse.id] || {};
                        const hasSchedule = Object.keys(dayToShift).length > 0;
                        
                        return (
                          <tr key={nurse.id} className="new-nurse-row">
                            <td style={{ fontWeight: 'bold', color: '#28a745' }}>
                              {nurseName(nurse.id)}
                              <div style={{ fontSize: '0.8em', color: '#666', fontWeight: 'normal' }}>
                                Not scheduled
                              </div>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <div className="quick-actions">
                                <select
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val.startsWith('copy-')) {
                                      const fromNurseId = val.replace('copy-', '');
                                      handleCopySchedule(fromNurseId, nurse.id);
                                    } else if (val && val !== '') {
                                      handleAssignShift(nurse.id, val);
                                    }
                                    e.target.value = '';
                                  }}
                                  style={{ 
                                    fontSize: '12px', 
                                    padding: '4px', 
                                    marginBottom: '4px',
                                    width: '100%',
                                    border: hasSchedule ? '2px solid #28a745' : '1px solid #ccc'
                                  }}
                                >
                                  <option value="">Quick Assign...</option>
                                  <optgroup label="Copy Schedule">
                                    {nurses.filter(n => !newNurses.some(nn => nn.id === n.id) && assignments.some(a => a.user_id === n.id)).map(existingNurse => (
                                      <option key={`copy-${existingNurse.id}`} value={`copy-${existingNurse.id}`}>
                                        Copy from {nurseName(existingNurse.id)}
                                      </option>
                                    ))}
                                  </optgroup>
                                  <optgroup label="Assign Shift">
                                    <option value="1st">1st Shift (6AM-2PM)</option>
                                    <option value="2nd">2nd Shift (2PM-10PM)</option>
                                    <option value="3rd">3rd Shift (10PM-6AM)</option>
                                  </optgroup>
                                </select>
                              </div>
                            </td>
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
                                  style={{
                                    backgroundColor: dayToShift[day] && dayToShift[day] !== 'rest' ? '#e8f5e8' : '#fff'
                                  }}
                                >
                                  {shiftDefs.map((shift) => (
                                    <option key={shift.key} value={shift.key}>{shift.name}</option>
                                  ))}
                                </select>
                                {(dayToShift[day] === "1st" || dayToShift[day] === "2nd") && (
                                  <div style={{ fontSize: '0.7em', color: '#28a745', marginTop: '2px' }}>
                                    House + elderly assigned
                                  </div>
                                )}
                                {dayToShift[day] === "3rd" && (
                                  <div style={{ fontSize: '0.7em', color: '#999', marginTop: '2px' }}>
                                    No vital signs
                                  </div>
                                )}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}

              {/* Existing Scheduled Nurses */}
              {nurses.filter(nurse => !newNurses.some(n => n.id === nurse.id)).length > 0 && (
                <>
                  <div style={{ marginTop: newNurses.length > 0 ? '32px' : '0' }}>
                    <h3 style={{ marginBottom: '16px', color: '#216386' }}>Current Schedule</h3>
                  </div>
                  <table className="nurse-edit-table weekly-visual">
                    <thead>
                      <tr>
                        <th>Nurse</th>
                        {daysOfWeek.map((day) => (
                          <th key={day}>{day}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {nurses.filter(nurse => !newNurses.some(n => n.id === nurse.id)).map((nurse) => {
                        const dayToShift = pendingAssignments[nurse.id] || {};
                        return (
                          <tr key={nurse.id}>
                            <td style={{ fontWeight: 'bold' }}>{nurseName(nurse.id)}</td>
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
                                {(dayToShift[day] === "1st" || dayToShift[day] === "2nd") && (
                                  <div style={{ fontSize: '0.7em', color: '#0066cc', marginTop: '2px' }}>
                                    House + elderly assigned
                                  </div>
                                )}
                                {dayToShift[day] === "3rd" && (
                                  <div style={{ fontSize: '0.7em', color: '#999', marginTop: '2px' }}>
                                    No vital signs
                                  </div>
                                )}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}


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
            <div className="table-header">
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

              <div className="date-picker-top-right">
                <label htmlFor="nurse-date-picker" className="date-picker-label">
                  Select Date:
                </label>
                <input
                  id="nurse-date-picker"
                  type="date"
                  className="date-picker-input"
                  value={formatDateString(selectedDate)}
                  min={scheduleInfo?.start ? formatDateString(scheduleInfo.start) : undefined}
                  max={scheduleInfo?.end ? formatDateString(scheduleInfo.end) : undefined}
                  onChange={(e) => {
                    const newDate = new Date(e.target.value);
                    setSelectedDate(newDate);
                    
                    // Update active day based on selected date
                    const indexToDayName = {
                      0: "Sunday",
                      1: "Monday", 
                      2: "Tuesday",
                      3: "Wednesday",
                      4: "Thursday",
                      5: "Friday",
                      6: "Saturday"
                    };
                    
                    const selectedDayName = indexToDayName[newDate.getDay()];
                    
                    // Only update activeDay if not showing all days
                    if (activeDay !== SHOW_ALL_DAYS) {
                      setActiveDay(selectedDayName);
                    }
                  }}
                />
              </div>
            </div>

            <div className="shift-tabs" style={{ marginTop: '15px' }}>
              <button
                key={SHOW_ALL_DAYS}
                className={`shift-tab ${activeDay === SHOW_ALL_DAYS ? "active-shift" : ""}`}
                onClick={() => setActiveDay(SHOW_ALL_DAYS)}
              >
                Show All Days
              </button>
              {daysOfWeek.map((day) => (
                <button
                  key={day}
                  className={`shift-tab ${activeDay === day ? "active-shift" : ""}`}
                  onClick={() => {
                    setActiveDay(day);
                    
                    // Update the date picker to match the selected day
                    if (day !== SHOW_ALL_DAYS) {
                      const currentDate = new Date(selectedDate);
                      const currentDayOfWeek = currentDate.getDay(); // 0=Sunday, 1=Monday, etc.
                      
                      // Map day names to JavaScript's getDay() values
                      const dayToIndex = {
                        "Sunday": 0,
                        "Monday": 1,
                        "Tuesday": 2,
                        "Wednesday": 3,
                        "Thursday": 4,
                        "Friday": 5,
                        "Saturday": 6
                      };
                      
                      const targetDayIndex = dayToIndex[day];
                      
                      if (targetDayIndex !== undefined) {
                        // Calculate the difference in days
                        const dayDifference = targetDayIndex - currentDayOfWeek;
                        
                        // Create new date by adding the difference
                        const newDate = new Date(currentDate);
                        newDate.setDate(currentDate.getDate() + dayDifference);
                        
                        // Only update if the new date is within schedule bounds (if they exist)
                        const isWithinBounds = !scheduleInfo || 
                          (newDate >= scheduleInfo.start && newDate <= scheduleInfo.end);
                        
                        if (isWithinBounds) {
                          setSelectedDate(newDate);
                        }
                      }
                    }
                  }}
                >
                  {day}
                </button>
              ))}
            </div>

            <table className="schedule-table shift-summary nurse-schedule-table">
              <thead>
                <tr>
                  <th>Nurse</th>
                  <th>House Assignments</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {getFilteredAssignments().length > 0 ? (
                  getFilteredAssignments().map((a) => {
                    // Get elderly assignments for this nurse
                    let elderlyAssignments = [];
                    
                    // Check if nurse is absent for the current context
                    const currentDateStr = formatDateString(selectedDate);
                    const indexToDayName = {
                      0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 
                      4: "Thursday", 5: "Friday", 6: "Saturday"
                    };
                    const currentDay = activeDay === SHOW_ALL_DAYS ? 
                      indexToDayName[selectedDate.getDay()] : 
                      activeDay;
                    
                    const isNurseAbsentToday = isNurseAbsentForDay(a.user_id, selectedDate, activeShift);

                    if (activeDay === SHOW_ALL_DAYS) {
                      // Show all days' assignments, but filter out days when nurse is absent
                      const allDaysAssignments = nurseElderlyAssignments
                        .filter(ea => {
                          const assignmentMatches = ea.user_id === a.user_id && ea.shift === activeShift;
                          // Check if nurse is absent for this specific day
                          const isAbsentForThisDay = a.is_absent && 
                            a.absent_for_date === currentDateStr && 
                            a.absent_for_day === ea.day;
                          return assignmentMatches && !isAbsentForThisDay;
                        });
                      elderlyAssignments = allDaysAssignments;
                    } else {
                      // Show specific day assignments only if nurse is not absent for that day
                      if (!isNurseAbsentToday) {
                        const dayAssignment = nurseElderlyAssignments
                          .find(ea => ea.user_id === a.user_id && ea.day === activeDay && ea.shift === activeShift);
                        if (dayAssignment) {
                          elderlyAssignments = [dayAssignment];
                        }
                      }
                    }

                    return (
                      <tr key={a.id}>
                        <td style={{ 
                          fontWeight: 'bold',
                          color: isNurseAbsentToday ? '#999' : 'inherit',
                          textDecoration: isNurseAbsentToday ? 'line-through' : 'none'
                        }}>
                          {nurseName(a.user_id)}
                          {isNurseAbsentToday && <span style={{ color: '#dc3545', fontSize: '0.8em', marginLeft: '8px' }}>(ABSENT)</span>}
                        </td>
                        <td>
                          {isNurseAbsentToday ? 
                            <em style={{ color: "#888" }}>Nurse is absent - assignments redistributed</em> :
                            createAccordionContent(elderlyAssignments, activeShift, activeDay, a.user_id)
                          }
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {(() => {
                            const indexToDayName = {
                              0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 
                              4: "Thursday", 5: "Friday", 6: "Saturday"
                            };
                            const contextDay = activeDay === SHOW_ALL_DAYS ? 
                              indexToDayName[selectedDate.getDay()] : activeDay;
                            
                            const isAbsentForContext = isNurseAbsentForDay(a.user_id, selectedDate, activeShift);

                            if (isAbsentForContext) {
                              return (
                                <div style={{
                                  padding: '10px 16px',
                                  backgroundColor: '#dc3545',
                                  color: 'white',
                                  borderRadius: '6px',
                                  fontWeight: 'bold',
                                  fontSize: '14px',
                                  textAlign: 'center',
                                  border: '2px solid #b02a37'
                                }}>
                                  🔒 PERMANENTLY ABSENT
                                  <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.9 }}>
                                    {contextDay}, {selectedDate.toLocaleDateString()}
                                  </div>
                                </div>
                              );
                            } else {
                              return (
                                <button
                                  className="absent-btn"
                                  onClick={() => handleMarkAbsent(a.id, a.user_id)}
                                  disabled={saving}
                                  style={{
                                    backgroundColor: '#dc3545',
                                    color: 'white',
                                    border: 'none',
                                    padding: '10px 16px',
                                    borderRadius: '6px',
                                    fontWeight: 'bold',
                                    fontSize: '14px',
                                    cursor: saving ? 'not-allowed' : 'pointer',
                                    transition: 'background-color 0.2s'
                                  }}
                                  onMouseOver={e => !saving && (e.target.style.backgroundColor = '#c82333')}
                                  onMouseOut={e => !saving && (e.target.style.backgroundColor = '#dc3545')}
                                >
                                  {saving ? 'Processing...' : '🚫 Mark as Absent'}
                                </button>
                              );
                            }
                          })()}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={3} style={{ textAlign: "center", color: "#888" }}>
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
