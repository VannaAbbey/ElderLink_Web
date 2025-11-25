import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import { onSnapshot, collection, query, where, writeBatch, doc, getDocs, Timestamp } from "firebase/firestore";
import "../css/schedule.css";
import Navbar from "./navbar";
import { NurseScheduleService } from "../services/nurseScheduleService";
import { markNurseAbsent, getTempReassignments, hasAbsenceForDate, batchCheckAbsencesForDate } from "../services/nurseAbsenceService";
import * as NurseEmergencyService from "../services/nurseEmergencyService";
import * as AttendanceMonitorService from "../services/attendanceMonitorService";
import * as AutoAbsenceMonitor from "../services/autoAbsenceMonitor";
import CustomAlertModal from "./customAlertModal";
import NurseEmergencyCoverageModal from "./nurseEmergencyCoverageModal";

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
  const [activeShift, setActiveShift] = useState(AutoAbsenceMonitor.getCurrentShift() || "1st");
  // Initialize activeDay based on current date
  const getCurrentDayName = () => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[new Date().getDay()];
  };
  const [activeDay, setActiveDay] = useState(getCurrentDayName());
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
  
  // Emergency coverage modal states
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [emergencyOptions, setEmergencyOptions] = useState([]);
  const [selectedDonorChoices, setSelectedDonorChoices] = useState({});
  const [emergencyCount, setEmergencyCount] = useState(0); // Badge count for emergency coverage
  
  // Loading modal state for schedule generation
  const [loadingModal, setLoadingModal] = useState({
    isOpen: false,
    message: "Generating Nurse Schedule..."
  });
  
  // Modal state for custom alerts and confirmations
  const [modal, setModal] = useState({
    isOpen: false,
    type: "alert", // "alert" or "confirm"
    title: "",
    message: "",
    onConfirm: null,
    customClass: "" // For special modal styling (e.g., nurse absence warnings)
  });

  // Initialize service instance
  const nurseScheduleService = new NurseScheduleService(db);

  const shiftDefs = NurseScheduleService.SHIFT_DEFS;
  const daysOfWeek = NurseScheduleService.DAYS_OF_WEEK;

  // ✅ PERFORMANCE FIX: Single effect to load and subscribe to data
  // Combines initial load with real-time listener to avoid duplicate queries
  useEffect(() => {
    // Load houses and elderly once (they don't change frequently)
    (async () => {
      const { houses, elderly } = await nurseScheduleService.loadAllData();
      setHouses(houses);
      setElderlyList(elderly);
    })();

    // Set up real-time listener for nurses only (they change more frequently with new registrations)
    const unsubscribe = onSnapshot(
      query(
        collection(db, "users"), 
        where("user_type", "==", "nurse")
        // Note: user_activation filtering done in-memory to avoid index issues
      ), 
      (snapshot) => {
        const nursesData = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter(nurse => nurse.scheduleStatus !== "inactive" && nurse.user_activation !== false);
        setNurses(nursesData);
        console.log(`✅ Loaded ${nursesData.length} nurses:`, nursesData);
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

  // ✅ REAL-TIME ABSENCE MONITORING: Listen for absence changes in real-time
  useEffect(() => {
    if (nurses.length === 0) return; // Wait for nurses to load
    
    console.log(`🔔 Setting up real-time absence listener for nurses...`);
    
    // Listen to all active absences for nurses
    const absenceQuery = query(
      collection(db, "nurse_cg_absence"),
      where("user_type", "==", "nurse"),
      where("status", "==", "active")
    );
    
    const unsubscribe = onSnapshot(absenceQuery, (snapshot) => {
      console.log(`🔔 Nurse absence data changed! Processing ${snapshot.docs.length} absence records...`);
      
      // Update nurse absence state for all dates and shifts
      const updatedAbsences = {};
      
      snapshot.docs.forEach(doc => {
        const absence = doc.data();
        const key = `${absence.user_id}-${absence.absence_date}-${absence.shift}`;
        updatedAbsences[key] = true; // This nurse is absent
        
        console.log(`   📍 Absence detected: Nurse ${absence.user_id} on ${absence.absence_date} (${absence.shift} shift) - Key: ${key}`);
      });
      
      // ✅ CRITICAL FIX: Replace entire state instead of merging
      // This ensures removed absences (unmarked) are also reflected immediately
      setNurseAbsences(updatedAbsences);
      
      console.log(`✅ Updated absence state with ${Object.keys(updatedAbsences).length} keys:`, Object.keys(updatedAbsences));
    }, (error) => {
      console.error(`❌ Error in nurse absence listener:`, error);
    });
    
    return () => {
      console.log(`🔕 Cleaning up nurse absence listener...`);
      unsubscribe();
    };
  }, [nurses.length]); // Re-subscribe when nurses list changes

  // ❌ REMOVED: Cache clearing on date/shift change
  // The real-time listener handles all absence updates automatically
  // Clearing the cache was causing absences to disappear from the UI

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

  // 🔔 Real-time Attendance Monitor for Nurses - Auto-marks nurses absent from mobile app
  useEffect(() => {
    console.log(`🔔 [NURSE] Setting up real-time attendance monitor...`);
    
    // Process attendance record when new absence is detected
    const handleAttendanceChange = async (attendanceRecord) => {
      // Only process nurse attendance records
      if (attendanceRecord.user_type !== 'nurse') {
        console.log(`⏭️ Skipping non-nurse attendance record`);
        return;
      }
      
      console.log(`\n🚨 [NURSE] ATTENDANCE CHANGE DETECTED - Processing...`);
      
      // Fetch current data for processing
      const currentAssignments = assignments;
      const currentElderlyAssignments = nurseElderlyAssignments;
      const currentTempReassignments = tempReassignments;
      
      // Process the attendance record
      const result = await AttendanceMonitorService.processAttendanceRecord(
        attendanceRecord,
        currentAssignments,
        currentElderlyAssignments,
        currentTempReassignments
      );
      
      if (result.success && result.action === 'marked_absent') {
        console.log(`✅ [NURSE] Auto-marked ${result.userId} as absent - data will refresh via real-time listeners`);
        // Notification removed - UI will automatically update via real-time listeners
      }
    };
    
    // Subscribe to real-time attendance changes
    const unsubscribe = AttendanceMonitorService.subscribeToAttendanceChanges(handleAttendanceChange);
    
    // Batch process any pending nurse attendance records on mount (catch up)
    const processPendingAttendance = async () => {
      if (assignments.length > 0 && nurseElderlyAssignments.length > 0) {
        console.log(`🔄 [NURSE] Checking for pending attendance records...`);
        const result = await AttendanceMonitorService.batchProcessPendingAttendance(
          assignments,
          nurseElderlyAssignments,
          tempReassignments
        );
        
        if (result.processed > 0) {
          console.log(`✅ [NURSE] Batch processed ${result.processed} pending absences`);
        }
      }
    };
    
    processPendingAttendance();
    
    // Start automatic absence monitoring for nurses (checks every minute)
    console.log(`🔔 [NURSE] Starting automatic absence monitoring...`);
    const stopAutoMonitor = AutoAbsenceMonitor.startAutoAbsenceMonitoring(
      () => ({
        assignments,
        elderlyAssigns: nurseElderlyAssignments,
        tempReassigns: tempReassignments,
        onEmergencyDetected: null // Nurses don't have emergency coverage feature
      }),
      async (result) => {
        console.log(`⚠️ [NURSE] Auto-marked ${result.nurses} nurse(s) absent - data will refresh via listeners`);
        // Alert removed - silent auto-absence marking
      }
    );
    
    return () => {
      console.log(`🔕 [NURSE] Unsubscribing from attendance monitor`);
      unsubscribe();
      stopAutoMonitor();
    };
  }, [assignments.length, nurseElderlyAssignments.length, tempReassignments.length]); // Re-run when data is available

  // 🚨 Check for emergency coverage needs and update badge count
  useEffect(() => {
    const checkEmergencies = async () => {
      // Only check if we have schedule info and assignments
      if (!scheduleInfo?.start || !scheduleInfo?.end || assignments.length === 0) {
        setEmergencyCount(0);
        return;
      }

      try {
        // ✅ FIX: Only check CURRENT SELECTED DATE instead of entire schedule
        // This makes the badge update instantly instead of taking 30+ seconds
        const currentDateStr = formatDateString(selectedDate);

        const emergencyCheck = await NurseEmergencyService.checkNurseEmergencyNeedsAndDonors(
          currentDateStr,
          assignments,
          nurseElderlyAssignments,
          tempReassignments
        );

        setEmergencyCount(emergencyCheck.emergencyCount || 0);
      } catch (error) {
        console.error("Error checking emergency count:", error);
        setEmergencyCount(0);
      }
    };

    checkEmergencies();
  }, [scheduleInfo, assignments, nurseElderlyAssignments, tempReassignments, nurseAbsences, selectedDate]);

  const nurseName = (nurseId) => nurseScheduleService.getNurseName(nurseId, nurses);
  const houseName = (houseId) => nurseScheduleService.getHouseName(houseId, houses);
  const elderlyName = (elderlyId) => nurseScheduleService.getElderlyName(elderlyId, elderlyList);

  // Helper functions for modal
  const showAlert = (title, message, customClass = "") => {
    setModal({
      isOpen: true,
      type: "alert",
      title,
      message,
      onConfirm: null,
      customClass
    });
  };

  const showConfirm = (title, message, onConfirm, customClass = "") => {
    setModal({
      isOpen: true,
      type: "confirm",
      title,
      message,
      onConfirm,
      customClass
    });
  };

  const closeModal = () => {
    setModal({
      isOpen: false,
      type: "alert",
      title: "",
      message: "",
      onConfirm: null,
      customClass: ""
    });
  };

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

  // Helper function to check if a day tab should be disabled
  const isDayDisabled = (dayName) => {
    // If no schedule info, don't disable any days
    if (!scheduleInfo?.start || !scheduleInfo?.end) {
      return false;
    }

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

    const targetDayIndex = dayToIndex[dayName];
    if (targetDayIndex === undefined) return false;

    // Calculate the date for this day in the current week of selectedDate
    const currentDate = new Date(selectedDate);
    const currentDayOfWeek = currentDate.getDay();
    const dayDifference = targetDayIndex - currentDayOfWeek;
    const targetDate = new Date(currentDate);
    targetDate.setDate(currentDate.getDate() + dayDifference);

    // Check if target date falls within schedule bounds
    const isWithinBounds = targetDate >= scheduleInfo.start && targetDate <= scheduleInfo.end;
    
    return !isWithinBounds;
  };

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
    
    // Enhanced debug logging
    console.log(`🔍 Absence check: nurseId=${nurseId}, date=${dateStr}, shift=${shift}, key=${key}, result=${isAbsent}`);
    
    if (isAbsent) {
      console.log(`%c🚫 NURSE IS ABSENT: ${nurseId} on ${dateStr} ${shift} shift`, 'color: #FF0000; font-weight: bold; font-size: 14px');
    }
    
    // ✅ FIX: Only return true if explicitly marked as absent
    // If undefined, it means data hasn't loaded yet or nurse is not absent
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
      
      // ⚠️ FIX: Collect all elderly IDs per day WITHOUT duplicates
      // Add regular assignments
      elderlyAssignments.forEach(ea => {
        if (!dayGroups[ea.day]) dayGroups[ea.day] = new Set();
        (ea.elderly_ids || []).forEach(id => dayGroups[ea.day].add(id));
      });
      
      // Add temporary assignments
      tempAssignmentsToNurse.forEach(t => {
        if (!dayGroups[t.day]) dayGroups[t.day] = new Set();
        (t.elderly_ids || []).forEach(id => dayGroups[t.day].add(id));
      });

      // Convert Sets back to arrays for grouping
      const dayGroupsArray = {};
      Object.keys(dayGroups).forEach(day => {
        dayGroupsArray[day] = Array.from(dayGroups[day]);
      });

      // Accordion JSX for schedule-page - Show All Days view
      return (
        <div className="assignment-accordion">
          {Object.entries(dayGroupsArray).map(([day, elderlyIds]) => {
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
                            <div className="elderly-list-container nurse-elderly-list">
                              {elderly.map((e, idx) => (
                                <div key={idx} className="elderly-name-item">
                                  {`${e.elderly_fname} ${e.elderly_lname}`}
                                </div>
                              ))}
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
      // Show specific day grouped by house - use combined elderly IDs WITHOUT duplicates
      // ⚠️ FIX: Use Set to remove duplicate elderly IDs
      const uniqueElderlyIds = Array.from(new Set(allElderlyIds));
      const groupedByHouse = groupElderlyByHouse(uniqueElderlyIds);
      
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
                    <div className="elderly-list-container nurse-elderly-list">
                      {elderly.map((e, idx) => (
                        <div key={idx} className="elderly-name-item">
                          {`${e.elderly_fname} ${e.elderly_lname}`}
                        </div>
                      ))}
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
    console.log(`\n%c📋 FILTERING ASSIGNMENTS`, 'color: #4ECDC4; font-weight: bold; font-size: 14px');
    console.log(`%c   Active Day: ${activeDay}`, 'color: #95E1D3');
    console.log(`%c   Active Shift: ${activeShift}`, 'color: #95E1D3');
    console.log(`%c   Selected Date: ${formatDateString(selectedDate)}`, 'color: #95E1D3; font-weight: bold');
    
    let baseAssignments = [];
    
    if (activeDay === SHOW_ALL_DAYS) {
      baseAssignments = assignments.filter((a) => a.shift === activeShift);
    } else {
      // Filter by both day and date range
      baseAssignments = assignments.filter((a) => {
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
    
    // ✅ ADD EMERGENCY COVERAGE NURSES from temporary_assignments
    const currentDateStr = formatDateString(selectedDate);
    const indexToDayName = {
      0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 
      4: "Thursday", 5: "Friday", 6: "Saturday"
    };
    const currentDayName = activeDay === SHOW_ALL_DAYS ? 
      indexToDayName[selectedDate.getDay()] : 
      activeDay;
    
    // Find emergency coverage temp assignments for current date/shift/day
    const emergencyCoverageAssignments = tempReassignments.filter(tr =>
      tr.date === currentDateStr &&
      tr.shift === activeShift &&
      tr.day === currentDayName &&
      tr.from_user_id === "EMERGENCY_ABSENT" &&
      tr.user_type === "nurse"
    );
    
    console.log(`%c   🚑 Found ${emergencyCoverageAssignments.length} emergency coverage nurses`, 'color: #FF6B6B; font-weight: bold');
    
    // Add emergency coverage nurses as virtual assignments
    emergencyCoverageAssignments.forEach(ec => {
      // Check if this nurse is NOT already in the filtered assignments for this shift
      const alreadyExists = baseAssignments.some(a => a.user_id === ec.to_user_id);
      
      if (!alreadyExists) {
        // Create a virtual assignment for the emergency coverage nurse
        baseAssignments.push({
          id: `emergency_${ec.id}`,
          user_id: ec.to_user_id,
          shift: ec.shift,
          days_assigned: [ec.day],
          is_current: true,
          is_emergency_coverage: true,
          emergency_original_shift: ec.donor_original_shift,
          house_id: null
        });
      }
    });
    
    // ✅ ADD DONOR NURSES IN THEIR ORIGINAL SHIFT
    // Show nurses who are donating to emergency coverage in their original shift
    // with a special flag indicating they're covering another shift
    const donorNursesInOriginalShift = tempReassignments.filter(tr =>
      tr.date === currentDateStr &&
      tr.donor_original_shift === activeShift &&
      tr.day === currentDayName &&
      tr.from_user_id === "EMERGENCY_ABSENT" &&
      tr.user_type === "nurse"
    );
    
    console.log(`%c   👨‍⚕️ Found ${donorNursesInOriginalShift.length} donor nurses in their original shift`, 'color: #4ECDC4; font-weight: bold');
    
    donorNursesInOriginalShift.forEach(donor => {
      console.log(`%c      → Nurse ${donor.to_user_id} donating to ${donor.shift} shift`, 'color: #95E1D3');
      
      // Check if this nurse is already in baseAssignments (their regular assignment)
      const existingIndex = baseAssignments.findIndex(a => a.user_id === donor.to_user_id);
      
      if (existingIndex !== -1) {
        // Mark the existing assignment as donating to emergency coverage
        baseAssignments[existingIndex].is_donating_to_emergency = true;
        baseAssignments[existingIndex].emergency_covering_shift = donor.shift;
      } else {
        // If not found in regular assignments, create a virtual entry
        baseAssignments.push({
          id: `donor_${donor.id}`,
          user_id: donor.to_user_id,
          shift: activeShift,
          is_donating_to_emergency: true,
          emergency_covering_shift: donor.shift,
          days_assigned: [currentDayName],
          is_current: true,
          house_id: null
        });
      }
    });
    
    console.log(`%c   Result: ${baseAssignments.length} assignments total (${baseAssignments.length - emergencyCoverageAssignments.length} regular + ${emergencyCoverageAssignments.length} emergency)`, 'color: #6BCB77; font-weight: bold');
    return baseAssignments;
  };

  // Handle marking nurse as absent
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
        showAlert(
          "Already Marked Absent",
          `${nurseFullName} is already marked as ABSENT for ${dayName}, ${selectedDate.toLocaleDateString()}`
        );
        return;
      }

      // ✅ NEW VALIDATION: Check if this is the only nurse working on this day and shift
      // Get all nurses assigned to this shift and day
      const nursesOnThisShift = assignments.filter(a => 
        a.shift === activeShift &&
        a.is_current &&
        Array.isArray(a.days_assigned) &&
        a.days_assigned.map(d => d.toLowerCase()).includes(dayName.toLowerCase())
      );

      // Count how many are NOT already absent (excluding the nurse we're trying to mark)
      let availableNurseCount = 0;
      for (const assignment of nursesOnThisShift) {
        // Skip the nurse we're trying to mark absent
        if (assignment.user_id === nurseId) continue;
        
        // Check if this nurse is already absent
        const isAbsent = isNurseAbsentForDay(assignment.user_id, selectedDate, activeShift);
        if (!isAbsent) {
          availableNurseCount++;
        }
      }

      console.log(`🔍 Coverage check for ${dayName} ${activeShift} shift:`);
      console.log(`   Total nurses assigned: ${nursesOnThisShift.length}`);
      console.log(`   Available nurses (excluding ${nurseFullName}): ${availableNurseCount}`);

      // Also check if we have absence data but it's still loading
      const absenceKey = `${nurseId}-${targetDateStr}-${activeShift}`;
      if (nurseAbsences[absenceKey] === undefined) {
        // Data is still loading, refresh and check again
        const currentStatus = await refreshNurseAbsenceData(nurseId, targetDateStr, activeShift);
        if (currentStatus) {
          showAlert(
            "Already Marked Absent",
            `${nurseFullName} is already marked as PERMANENTLY ABSENT for ${dayName}, ${selectedDate.toLocaleDateString()}`
          );
          return;
        }
      }

      // Enhanced confirmation dialog
      showConfirm(
        "⚠️ Mark Nurse as Absent",
        `Mark ${nurseFullName} as ABSENT for:\n\n` +
        `• Date: ${selectedDate.toLocaleDateString()}\n` +
        `• Day: ${dayName}\n` +
        `• Shift: ${activeShift}\n\n` +
        `The nurse's elderly assignments will be redistributed to other available nurses.\n\n` +
        `You can undo this action later if needed.\n\n` +
        `Are you sure you want to proceed?`,
        async () => {
          setSaving(true);
          
          try {
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

      // ✅ CHECK FOR EMERGENCY: If marking failed or requires emergency coverage
      if (markResult.requiresEmergency) {
        console.log(`\n%c🆘 EMERGENCY COVERAGE REQUIRED!`, 'color: #FF0000; font-weight: bold; font-size: 16px');
        console.log(`   Shift ${activeShift} on ${dayName} has ZERO coverage!`);
        console.log(`   ${markResult.elderlyWithoutCoverage} elderly without nurses`);
        
        showAlert(
          "🚨 Emergency Coverage Required",
          `${nurseFullName} has been marked absent.\n\n` +
          `⚠️ WARNING: This shift now has ZERO nurse coverage!\n\n` +
          `${markResult.elderlyWithoutCoverage} elderly currently have no assigned nurses.\n\n` +
          `Please use the Emergency Coverage button to assign donor nurses from other shifts.`,
          "emergency-alert"
        );
        
        setSaving(false);
        return; // Don't continue with normal refresh
      }

      // 🔄 REAL-TIME UPDATE: Refresh ALL data to reflect changes immediately
      console.log(`\n%c🔄 REFRESHING ALL DATA FOR REAL-TIME UPDATE`, 'color: #FF6B6B; font-weight: bold; font-size: 14px');
      
      // 1. Refresh temporary reassignments
      console.log(`🔄 Refreshing temporary reassignments for ${targetDateStr}...`);
      const updatedTempAssigns = await getTempReassignments(targetDateStr, activeShift);
      setTempReassignments(updatedTempAssigns);
      console.log(`✅ Temporary reassignments refreshed: ${updatedTempAssigns.length} assignments`);

      // 2. Refresh nurse elderly assignments (to show redistributed assignments)
      console.log(`🔄 Refreshing nurse elderly assignments...`);
      const elderlyAssignsQuery = query(
        collection(db, "elderly_assignments"),
        where("user_type", "==", "nurse")
      );
      const elderlyAssignsSnap = await getDocs(elderlyAssignsQuery);
      const refreshedElderlyAssignments = elderlyAssignsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setNurseElderlyAssignments(refreshedElderlyAssignments);
      console.log(`✅ Nurse elderly assignments refreshed: ${refreshedElderlyAssignments.length} assignments`);

      // 3. Update absence state to mark nurse as absent
      const stateKey = `${nurseId}-${targetDateStr}-${activeShift}`;
      console.log(`\n%c🔄 UPDATING ABSENCE STATE`, 'color: #FF6B6B; font-weight: bold; font-size: 14px');
      console.log(`%c   Key: ${stateKey}`, 'color: #4ECDC4');
      console.log(`%c   Setting to: true (ABSENT)`, 'color: #4ECDC4');
      
      setNurseAbsences(prev => {
        const updated = {
          ...prev,
          [stateKey]: true // We know it's absent since we just marked it
        };
        console.log(`%c   Updated absence state:`, 'color: #95E1D3', updated);
        return updated;
      });
      
      console.log(`✅ Updated absence state for ${nurseId} on ${targetDateStr}`);

      // 4. Force a re-render by refreshing absence data for all nurses on this date
      console.log(`🔄 Refreshing absence data for all nurses on ${targetDateStr}...`);
      const allNurseIds = assignments
        .filter(a => a.shift === activeShift && a.is_current)
        .map(a => a.user_id);
      
      const refreshedAbsences = await batchCheckAbsencesForDate(allNurseIds, targetDateStr, activeShift);
      console.log(`✅ Refreshed absence data for ${Object.keys(refreshedAbsences).length} nurses`);
      
      // Update all absence states at once
      setNurseAbsences(prev => {
        const updated = { ...prev };
        Object.keys(refreshedAbsences).forEach(nurseId => {
          const key = `${nurseId}-${targetDateStr}-${activeShift}`;
          updated[key] = refreshedAbsences[nurseId];
        });
        return updated;
      });

      console.log(`\n%c✅ ALL DATA REFRESHED - REAL-TIME UPDATE COMPLETE`, 'color: #95E1D3; font-weight: bold; font-size: 14px');

            setNotification(`✅ ${nurseFullName} marked as absent. Elderly assignments have been redistributed. You can undo this action if needed.`);
            setTimeout(() => setNotification(""), 7000);

          } catch (error) {
            console.error("Error marking nurse absent:", error);
            setNotification(`❌ Failed to mark nurse as absent: ${error.message}`);
            setTimeout(() => setNotification(""), 5000);
          } finally {
            setSaving(false);
          }
        },
        "nurse-absence-modal" // Custom class for proper centering and styling
      );

    } catch (error) {
      console.error("Error in handleMarkAbsent:", error);
    }
  };

  // Handle undoing nurse absence (reverse the absence marking)
  const handleUndoAbsence = async (nurseId) => {
    try {
      const targetDateStr = formatDateString(selectedDate);
      const indexToDayName = {
        0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 
        4: "Thursday", 5: "Friday", 6: "Saturday"
      };
      const dayName = activeDay === SHOW_ALL_DAYS ? indexToDayName[selectedDate.getDay()] : activeDay;
      const nurseFullName = nurseScheduleService.getNurseName(nurseId, nurses);

      showConfirm(
        "Undo Absence",
        `Undo absence for ${nurseFullName}?\n\n` +
        `• Date: ${selectedDate.toLocaleDateString()}\n` +
        `• Day: ${dayName}\n` +
        `• Shift: ${activeShift}\n\n` +
        `This will restore the nurse's original assignments and redistribute any temporarily assigned elderly.`,
        async () => {
          setSaving(true);
          
          try {
            console.log(`🔄 Undoing absence for nurse ${nurseFullName} on ${targetDateStr} (${dayName})`);
            
            // Call the undo function from nurseAbsenceService
            const { unmarkNurseAbsent } = await import('../services/nurseAbsenceService');
            await unmarkNurseAbsent(nurseId, targetDateStr, activeShift);

            // 🔄 REAL-TIME UPDATE: Refresh ALL data to reflect changes immediately
            console.log(`\n%c🔄 REFRESHING ALL DATA FOR REAL-TIME UPDATE`, 'color: #28a745; font-weight: bold; font-size: 14px');
            
            // 1. Refresh temporary reassignments
            console.log(`🔄 Refreshing temporary reassignments for ${targetDateStr}...`);
            const updatedTempAssigns = await getTempReassignments(targetDateStr, activeShift);
            setTempReassignments(updatedTempAssigns);
            console.log(`✅ Temporary reassignments refreshed: ${updatedTempAssigns.length} assignments`);

            // 2. Refresh nurse elderly assignments (to show restored original assignments)
            console.log(`🔄 Refreshing nurse elderly assignments...`);
            const elderlyAssignsQuery = query(
              collection(db, "elderly_assignments"),
              where("user_type", "==", "nurse")
            );
            const elderlyAssignsSnap = await getDocs(elderlyAssignsQuery);
            const refreshedElderlyAssignments = elderlyAssignsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            setNurseElderlyAssignments(refreshedElderlyAssignments);
            console.log(`✅ Nurse elderly assignments refreshed: ${refreshedElderlyAssignments.length} assignments`);

            // 3. Update absence state to mark nurse as present
            const stateKey = `${nurseId}-${targetDateStr}-${activeShift}`;
            console.log(`\n%c🔄 UPDATING ABSENCE STATE (UNDO)`, 'color: #28a745; font-weight: bold; font-size: 14px');
            console.log(`%c   Key: ${stateKey}`, 'color: #4ECDC4');
            console.log(`%c   Setting to: false (PRESENT)`, 'color: #4ECDC4');
            
            setNurseAbsences(prev => {
              const updated = {
                ...prev,
                [stateKey]: false
              };
              console.log(`%c   Updated absence state:`, 'color: #95E1D3', updated);
              return updated;
            });

            // 4. Force a re-render by clearing and reloading absence data for all nurses on this date
            console.log(`🔄 Refreshing absence data for all nurses on ${targetDateStr}...`);
            const { batchCheckAbsencesForDate } = await import('../services/nurseAbsenceService');
            const allNurseIds = assignments
              .filter(a => a.shift === activeShift && a.is_current)
              .map(a => a.user_id);
            
            const refreshedAbsences = await batchCheckAbsencesForDate(allNurseIds, targetDateStr, activeShift);
            console.log(`✅ Refreshed absence data for ${Object.keys(refreshedAbsences).length} nurses`);
            
            // Update all absence states at once
            setNurseAbsences(prev => {
              const updated = { ...prev };
              Object.keys(refreshedAbsences).forEach(nurseId => {
                const key = `${nurseId}-${targetDateStr}-${activeShift}`;
                updated[key] = refreshedAbsences[nurseId];
              });
              return updated;
            });

            console.log(`\n%c✅ ALL DATA REFRESHED - REAL-TIME UPDATE COMPLETE`, 'color: #95E1D3; font-weight: bold; font-size: 14px');

            setNotification(`✅ ${nurseFullName}'s absence has been undone. Original assignments restored.`);
            setTimeout(() => setNotification(""), 5000);

          } catch (error) {
            console.error("Error undoing nurse absence:", error);
            setNotification(`❌ Failed to undo absence: ${error.message}`);
            setTimeout(() => setNotification(""), 5000);
          } finally {
            setSaving(false);
          }
        }
      );

    } catch (error) {
      console.error("Error in handleUndoAbsence:", error);
    }
  };

  // Clear all nurse schedules from Firestore
  const handleClearAll = async () => {
    showConfirm(
      "Clear All Schedules",
      "Are you sure you want to clear all nurse schedules and elderly assignments? This cannot be undone.",
      async () => {
        setSaving(true);
        
        try {
          console.log("🎯 Clear All button clicked - starting operation...");
          const result = await nurseScheduleService.clearAllSchedules(assignments, nurseElderlyAssignments, nurses);
          
          console.log("🎉 Clear operation completed:", result);
          
          setPendingAssignments({});
          setEditing(false);
          
          // Show success notification
          showAlert(
            "Success",
            `Cleared ${result.shiftDeleteCount} shift assignments and ${result.elderlyDeleteCount} elderly assignments!`
          );
          
        } catch (e) {
          console.error("💥 Clear operation failed:", e);
          showAlert("Error", `Failed to clear schedules: ${e.message}`);
        }
        setSaving(false);
      }
    );
  };

  // Handle automatic schedule generation
  const handleGenerateSchedule = async () => {
    showConfirm(
      "Generate Schedule",
      "This will generate a new schedule with rotating shifts and work-rest patterns. Continue?",
      async () => {
        // Show loading modal immediately
        setLoadingModal({
          isOpen: true,
          message: "Generating Nurse Schedule..."
        });
        
        setScheduleGeneration(prev => ({ ...prev, isGenerating: true }));
        setSaving(true);
        
        try {
          // Use setTimeout to allow UI to update before heavy computation
          await new Promise(resolve => setTimeout(resolve, 100));
          
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
          
          // Update loading message
          setLoadingModal({
            isOpen: true,
            message: "Refreshing nurse data..."
          });
          
          // Refresh nurses data to update scheduleStatus and trigger real-time re-detection
          const { nurses: updatedNurses } = await nurseScheduleService.loadAllData();
          setNurses(updatedNurses);
          
          // Close loading modal
          setLoadingModal({ isOpen: false, message: "" });
          
          const { shiftCounts, minDaily, maxDaily, minRest, maxRest } = result.statistics;
          
          showAlert(
            "Schedule Generated Successfully!",
            `Shifts: 1st (${shiftCounts["1st"]}), 2nd (${shiftCounts["2nd"]}), 3rd (${shiftCounts["3rd"]}) nurses. Working: ${minDaily}-${maxDaily}/day, Resting: ${minRest}-${maxRest}/day. All nurses integrated!`
          );
          
        } catch (e) {
          setLoadingModal({ isOpen: false, message: "" });
          showAlert("Error", `Failed to generate schedule: ${e.message}`);
        } finally {
          setSaving(false);
          setScheduleGeneration(prev => ({ ...prev, isGenerating: false }));
        }
      }
    );
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
      
      showAlert(
        "Success",
        "Nurse schedules saved successfully!"
      );
    } catch (e) {
      console.error("Save all error:", e);
      showAlert("Error", `Failed to save all: ${e.message}`);
    }
    setSaving(false);
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

  // Handle emergency coverage button click
  const handleEmergencyCoverage = async () => {
    try {
      console.log("🚨 Emergency Coverage button clicked for nurses");
      
      // Check if we have schedule info
      if (!scheduleInfo?.start || !scheduleInfo?.end) {
        showAlert(
          "Please generate a schedule first before checking emergency coverage.",
          "No Schedule Found"
        );
        return;
      }
      
      // ✅ FIX: Only check the CURRENT SELECTED DATE instead of entire schedule
      // This makes the modal load instantly instead of taking 30+ seconds
      const currentDateStr = formatDateString(selectedDate);
      
      console.log(`Checking emergency coverage needs for ${currentDateStr}`);
      
      // Check for emergency coverage needs on the selected date only
      const emergencyCheck = await NurseEmergencyService.checkNurseEmergencyNeedsAndDonors(
        currentDateStr,
        assignments,
        nurseElderlyAssignments,
        tempReassignments
      );
      
      if (emergencyCheck.hasEmergency && emergencyCheck.emergencyOptions.length > 0) {
        console.log("✅ Emergencies detected:", emergencyCheck);
        
        // Add date context to each emergency option
        const optionsWithDate = emergencyCheck.emergencyOptions.map(option => ({
          ...option,
          targetDateStr: currentDateStr,
          dayName: emergencyCheck.dayName
        }));
        
        setEmergencyOptions(optionsWithDate);
        setSelectedDonorChoices({});
        setShowEmergencyModal(true);
      } else {
        console.log("✅ No emergency coverage needed");
        showAlert(
          `✅ No emergency coverage needed for ${currentDateStr}.`,
          "No Emergencies"
        );
      }
    } catch (error) {
      console.error("❌ Error checking emergency coverage:", error);
      showAlert(
        `Failed to check emergency coverage needs: ${error.message}`,
        "Error"
      );
    }
  };

  // Execute emergency coverage with selected donors
  const executeEmergencyCoverage = async () => {
    try {
      // Build donor choices array with date information
      const donorChoices = Object.entries(selectedDonorChoices).map(([emergencyKey, choice]) => {
        // Emergency key is in format: "YYYY-MM-DD_ShiftKey"
        const [dateStr, shiftKey] = emergencyKey.split('_');
        return {
          targetDateStr: dateStr,
          emergencyShift: shiftKey,
          donorShift: choice.donorShift,
          nurseId: choice.nurseId
        };
      });
      
      console.log(`🚨 Executing emergency coverage for ${donorChoices.length} emergency...`, donorChoices);
      
      // Group by date for batch processing
      const choicesByDate = {};
      donorChoices.forEach(choice => {
        if (!choicesByDate[choice.targetDateStr]) {
          choicesByDate[choice.targetDateStr] = [];
        }
        choicesByDate[choice.targetDateStr].push(choice);
      });
      
      // Execute for each date
      let totalReassignments = [];
      for (const [targetDateStr, choices] of Object.entries(choicesByDate)) {
        const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const targetDate = new Date(targetDateStr);
        const dayName = daysOfWeek[targetDate.getDay()];
        
        const result = await NurseEmergencyService.activateNurseEmergencyCoverage(
          targetDateStr,
          assignments,
          nurseElderlyAssignments,
          tempReassignments,
          choices
        );
        
        if (result.success && result.emergencyReassignments) {
          totalReassignments.push(...result.emergencyReassignments);
        }
      }
      
      if (totalReassignments.length > 0) {
        showAlert(
          `🚨 Emergency coverage activated!\n\n${totalReassignments.length} emergency reassignment(s) made:\n${totalReassignments.map(er => `• ${er.emergencyShift} covered by nurse from ${er.donorShift}`).join('\n')}`,
          "Emergency Coverage Activated"
        );
        
        // Refresh data
        const selectedDateStr = formatDateString(selectedDate);
        const tempReassigns = await getTempReassignments(selectedDateStr, activeShift);
        setTempReassignments(tempReassigns);
        
        // Reload assignments
        const currentAssigns = await nurseScheduleService.getCurrentNurseAssignments();
        setAssignments(currentAssigns);
        
        const elderlyAssigns = await nurseScheduleService.getCurrentElderlyAssignments();
        setNurseElderlyAssignments(elderlyAssigns);
      } else {
        showAlert("✅ No emergency coverage activated.", "Information");
      }
      
      // Close modal
      setShowEmergencyModal(false);
      setSelectedDonorChoices({});
      setEmergencyOptions([]);
      
    } catch (error) {
      console.error("Error executing emergency coverage:", error);
      showAlert(
        `Failed to execute emergency coverage: ${error.message}`,
        "Error"
      );
    }
  };

  // Cancel emergency coverage modal
  const cancelEmergencyCoverage = () => {
    setShowEmergencyModal(false);
    setSelectedDonorChoices({});
    setEmergencyOptions([]);
  };

  return (
    <div className="schedule-page">
      <Navbar />
      <main className="schedule-container">
        <h2 className="page-title" style={{ marginBottom: 8 }}>Nurse Scheduling</h2>

        {/* Schedule Info Display - Only show in View by Shift mode */}
        {viewMode === "summary" && scheduleInfo && (
          <div className="schedule-inline" style={{ marginBottom: 16 }}>
            <span>
              <strong>Schedule Period:</strong>{" "}
              {scheduleInfo.start?.toLocaleDateString()} → {scheduleInfo.end?.toLocaleDateString()}
            </span>
            <span>
              <strong>Days Left:</strong>{" "}
              {(() => {
                const today = new Date();
                const endDate = scheduleInfo.end;
                const diffTime = endDate - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                return diffDays > 0 ? `${diffDays} day${diffDays !== 1 ? 's' : ''}` : 'Expired';
              })()}
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
              title="Switch to viewing nurses organized by shift"
            >
              View by Shift
            </button>
            <button
              onClick={() => { setViewMode("edit"); setEditing(true); }}
              disabled={viewMode === "edit"}
              className="toggle-btn right"
              title="Switch to edit mode to create or modify nurse schedules"
            >
              Edit
            </button>
          </div>
          
          <div style={{ display: 'flex', gap: '8px' }}>
            {/* Emergency Coverage Button - Right side */}
            {viewMode === "summary" && scheduleInfo && (
              <button
                onClick={handleEmergencyCoverage}
                className="emergency-coverage-btn"
                style={{
                  backgroundColor: '#dc3545',
                  color: 'white',
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  position: 'relative'
                }}
                title="Handle emergency situations by temporarily reassigning nurses between shifts"
              >
                🚨 Emergency Coverage
                {emergencyCount > 0 && (
                  <span className="notification-badge">
                    {emergencyCount}
                  </span>
                )}
              </button>
            )}
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
                title="Automatically generate a new nurse schedule for the selected period"
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
                title="Save all pending nurse schedule changes to the database"
              >
                Save All
              </button>
              <button
                onClick={handleClearAll}
                disabled={saving}
                className="clear-btn"
                style={{ marginLeft: 12 }}
                title="Delete all nurse schedules and assignments from the database"
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
                    title={`View nurses working ${s.name}`}
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
                title="Display nurses scheduled for all days of the week"
              >
                Show All Days
              </button>
              {daysOfWeek.map((day) => {
                const isDisabled = isDayDisabled(day);
                return (
                <button
                  key={day}
                  className={`shift-tab ${activeDay === day ? "active-shift" : ""}`}
                  disabled={isDisabled}
                  style={{
                    opacity: isDisabled ? 0.5 : 1,
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    backgroundColor: isDisabled ? '#e0e0e0' : undefined
                  }}
                  onClick={() => {
                    if (isDisabled) return;
                    
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
                          console.log(`\n%c🔍 DAY TAB CLICKED: ${day}`, 'color: #FF6B6B; font-weight: bold; font-size: 16px');
                          console.log(`%c📆 Changing date from ${currentDate.toISOString().slice(0, 10)} (${daysOfWeek[currentDayOfWeek]}) → ${newDate.toISOString().slice(0, 10)} (${day})`, 'color: #4ECDC4; font-weight: bold');
                          console.log(`%c⏰ Active Shift: ${activeShift}`, 'color: #4ECDC4; font-weight: bold');
                          console.log(`%c\n🔍 Checking for absences with key pattern: nurseId-${newDate.toISOString().slice(0, 10)}-${activeShift}`, 'color: #FFD93D; font-weight: bold');
                          console.log(`%c📊 Current absence state keys:`, 'color: #95E1D3', Object.keys(nurseAbsences));
                          
                          setSelectedDate(newDate);
                        } else {
                          console.log(`%c❌ Date ${newDate.toISOString().slice(0, 10)} is outside schedule bounds - NOT updating`, 'color: #FF6B6B; font-weight: bold');
                        }
                      }
                    }
                  }}
                >
                  {day}
                </button>
                );
              })}
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
                    // Check if this is an emergency coverage assignment OR if nurse is donating to emergency
                    const isEmergencyCoverage = a.is_emergency_coverage === true;
                    const isDonatingToEmergency = a.is_donating_to_emergency === true;
                    
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

                    // If this is emergency coverage, get elderly from temp reassignment
                    if (isEmergencyCoverage) {
                      const tempAssignment = tempReassignments.find(tr =>
                        tr.to_user_id === a.user_id &&
                        tr.date === currentDateStr &&
                        tr.shift === activeShift &&
                        tr.day === currentDay &&
                        tr.from_user_id === "EMERGENCY_ABSENT"
                      );
                      
                      if (tempAssignment && tempAssignment.elderly_ids) {
                        // Create a virtual elderly assignment for accordion display
                        elderlyAssignments = [{
                          user_id: a.user_id,
                          day: currentDay,
                          shift: activeShift,
                          elderly_ids: tempAssignment.elderly_ids
                        }];
                      }
                    } else if (isDonatingToEmergency) {
                      // Nurse is donating to emergency coverage - show NO elderly assignments
                      // Their elderly will be redistributed to other nurses on this shift
                      elderlyAssignments = [];
                    } else if (activeDay === SHOW_ALL_DAYS) {
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
                      
                      // ✅ ADD: Include redistributed elderly from donor nurses
                      const redistribAssignments = tempReassignments.filter(tr =>
                        tr.to_user_id === a.user_id &&
                        tr.assignment_type === "donor_redistribution" &&
                        tr.shift === activeShift
                      );
                      
                      redistribAssignments.forEach(tr => {
                        elderlyAssignments.push({
                          user_id: a.user_id,
                          day: tr.day,
                          shift: tr.shift,
                          elderly_ids: tr.elderly_ids,
                          is_temp_redistribution: true // Mark as temporary
                        });
                      });
                    } else {
                      // Show specific day assignments only if nurse is not absent for that day
                      if (!isNurseAbsentToday) {
                        // ✅ FIX: Don't show original elderly assignments if they're currently on emergency coverage
                        // Check if this nurse is currently covering an emergency on a different shift
                        const isCurrentlyOnEmergencyCoverage = tempReassignments.some(tr =>
                          tr.to_user_id === a.user_id &&
                          tr.date === currentDateStr &&
                          tr.day === currentDay &&
                          tr.from_user_id === "EMERGENCY_ABSENT" &&
                          tr.shift !== activeShift // They're covering a DIFFERENT shift
                        );
                        
                        if (!isCurrentlyOnEmergencyCoverage) {
                          const dayAssignment = nurseElderlyAssignments
                            .find(ea => ea.user_id === a.user_id && ea.day === activeDay && ea.shift === activeShift);
                          if (dayAssignment) {
                            elderlyAssignments = [dayAssignment];
                          }
                        }
                        
                        // ✅ ADD: Include redistributed elderly from donor nurses for this specific day
                        const redistribAssignments = tempReassignments.filter(tr =>
                          tr.to_user_id === a.user_id &&
                          tr.date === currentDateStr &&
                          tr.day === currentDay &&
                          tr.assignment_type === "donor_redistribution" &&
                          tr.shift === activeShift
                        );
                        
                        // ⚠️ FIX: Push redistributed elderly as SEPARATE assignments instead of merging
                        // This prevents duplicates and allows the accordion to group them properly by house
                        redistribAssignments.forEach(tr => {
                          const tempElderlyAssignment = {
                            user_id: a.user_id,
                            day: currentDay,
                            shift: activeShift,
                            elderly_ids: tr.elderly_ids,
                            is_temp_redistribution: true // Mark as temporary
                          };
                          
                          elderlyAssignments.push(tempElderlyAssignment);
                        });
                      }
                    }

                    return (
                      <tr key={a.id} className={isEmergencyCoverage ? "emergency-row" : (isDonatingToEmergency ? "donor-row" : "")}>
                        <td style={{ 
                          fontWeight: 'bold',
                          color: isNurseAbsentToday ? '#999' : (isEmergencyCoverage ? '#dc3545' : (isDonatingToEmergency ? '#ff8c00' : 'inherit')),
                          textDecoration: isNurseAbsentToday ? 'line-through' : 'none'
                        }}>
                          {nurseName(a.user_id)}
                          {isEmergencyCoverage && (
                            <span className="emergency-badge" style={{ 
                              marginLeft: '8px', 
                              fontSize: '0.75em',
                              padding: '2px 6px',
                              backgroundColor: '#dc3545',
                              color: 'white',
                              borderRadius: '4px',
                              fontWeight: 'bold'
                            }}>
                              🚨 EMERGENCY (from {a.emergency_original_shift} shift)
                            </span>
                          )}
                          {isDonatingToEmergency && (
                            <span className="donor-badge" style={{ 
                              marginLeft: '8px', 
                              fontSize: '0.75em',
                              padding: '2px 6px',
                              backgroundColor: '#ff8c00',
                              color: 'white',
                              borderRadius: '4px',
                              fontWeight: 'bold'
                            }}>
                              ⚡ COVERING {a.emergency_covering_shift} SHIFT
                            </span>
                          )}
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
                                <button
                                  className="undo-btn"
                                  onClick={() => handleUndoAbsence(a.user_id)}
                                  disabled={saving}
                                  style={{
                                    backgroundColor: '#28a745',
                                    color: 'white',
                                    border: 'none',
                                    padding: '10px 16px',
                                    borderRadius: '6px',
                                    fontWeight: 'bold',
                                    fontSize: '14px',
                                    cursor: saving ? 'not-allowed' : 'pointer',
                                    transition: 'background-color 0.2s'
                                  }}
                                  onMouseOver={e => !saving && (e.target.style.backgroundColor = '#218838')}
                                  onMouseOut={e => !saving && (e.target.style.backgroundColor = '#28a745')}
                                  title="Undo this nurse's absence and restore their original elderly assignments"
                                >
                                  {saving ? 'Processing...' : '↩️ Undo Absence'}
                                </button>
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
                                  title="Mark this nurse as absent and redistribute their elderly to other nurses"
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

      {/* Custom Alert/Confirm Modal */}
      <CustomAlertModal
        isOpen={modal.isOpen}
        onClose={closeModal}
        onConfirm={modal.onConfirm}
        title={modal.title}
        message={modal.message}
        type={modal.type}
        customClass={modal.customClass}
      />

      {/* Emergency Coverage Modal */}
      <NurseEmergencyCoverageModal
        isOpen={showEmergencyModal}
        emergencyOptions={emergencyOptions}
        selectedDonorChoices={selectedDonorChoices}
        setSelectedDonorChoices={setSelectedDonorChoices}
        nurseName={nurseName}
        onExecute={executeEmergencyCoverage}
        onCancel={cancelEmergencyCoverage}
      />

      {/* Loading Modal for Schedule Generation */}
      {loadingModal.isOpen && (
        <div className="popup-overlay">
          <div className="popup-card">
            <div className="loading-spinner"></div>
            <p style={{ marginTop: '20px', fontSize: '16px', color: '#333' }}>
              {loadingModal.message}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
