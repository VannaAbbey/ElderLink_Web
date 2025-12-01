import React, { useState, useEffect, useRef, useContext } from "react";
import { db, auth } from "../firebase";
import {
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
  writeBatch,
  doc,
  addDoc,
  Timestamp,
  getDoc,
  arrayUnion,
  serverTimestamp
} from "firebase/firestore";
import "../css/schedule.css";
import "../css/activity-log.css";
import Navbar from "./navbar";
import { AuthContext } from "../contexts/authcontext";
import * as ScheduleService from "../services/scheduleService";
import * as NewCaregiverService from "../services/newCaregiverService";
import * as EmergencyService from "../services/emergencyService";
import * as AbsenceService from "../services/absenceService";
import * as AttendanceMonitorService from "../services/attendanceMonitorService";
import * as AutoAbsenceMonitor from "../services/autoAbsenceMonitor";
import { exportScheduleToPDF } from "../services/scheduleExportService";
import {
  formatDateString,
  isCaregiverAbsent,
  getCaregiverAbsenceDetails,
  areWorkDaysConsecutive,
  isProvidingEmergencyCoverage,
  getEmergencyCoverageDetails,
  caregiverName
} from "../services/scheduleHelpers";
import CustomAlertModal from "./customAlertModal";
import ConfirmationModal from "./confirmationModal";
import EmergencyCoverageModal from "./emergencyCoverageModal";
import NewCaregiverModal from "./newCaregiverModal";
import SearchResultsDropdown from "./searchResultsDropdown";
import ScheduleCustomizationModal from "./scheduleCustomizationModal";


export default function Schedule() {
  const { user } = useContext(AuthContext);
  const [currentAdminName, setCurrentAdminName] = useState("");
  const [activityLogs, setActivityLogs] = useState([]);
  const [showActivityLog, setShowActivityLog] = useState(false);
  
  const [caregivers, setCaregivers] = useState([]);
  const [houses, setHouses] = useState([]);
  const [elderlyList, setElderlyList] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [elderlyAssigns, setElderlyAssigns] = useState([]);
  const [tempReassigns, setTempReassigns] = useState([]);
  const [absences, setAbsences] = useState([]);
  
  // Track undo operations to prevent emergency modal from appearing during undo
  const undoInProgress = useRef(false);

  const [duration, setDuration] = useState(6);
  const [customDuration, setCustomDuration] = useState("");
  const [showOverlay, setShowOverlay] = useState(false);
  const [pendingDuration, setPendingDuration] = useState(6);
  const [showCustomizationModal, setShowCustomizationModal] = useState(false);
  const [customizationSettings, setCustomizationSettings] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const [viewMode, setViewMode] = useState("current");
  const [activeHouseId, setActiveHouseId] = useState(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  
  // Emergency coverage modal states
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [emergencyOptions, setEmergencyOptions] = useState([]);
  const [selectedDonorChoices, setSelectedDonorChoices] = useState({});
  const [emergencyCount, setEmergencyCount] = useState(0); // Badge count for emergency coverage
  
  // New caregiver integration modal states
  const [showNewCaregiverModal, setShowNewCaregiverModal] = useState(false);
  const [unassignedCaregivers, setUnassignedCaregivers] = useState([]);
  const [unassignedCount, setUnassignedCount] = useState(0); // Badge count for notification
  const [selectedNewCaregiver, setSelectedNewCaregiver] = useState(null);
  const [integrationMode, setIntegrationMode] = useState('auto'); // 'auto' or 'manual'
  const [manualAssignment, setManualAssignment] = useState({
    house: '',
    shift: '',
    workDays: []
  });
  const [systemRecommendations, setSystemRecommendations] = useState([]);
  const [selectedRecommendation, setSelectedRecommendation] = useState(null);
  const [isIntegrating, setIsIntegrating] = useState(false); // Loading state for integration
  
  // State for tracking which caregiver's elderly list is expanded
  const [expandedElderlyLists, setExpandedElderlyLists] = useState(new Set());
  
  // ========== DAYS OF WEEK TABS - COMMENT OUT BELOW LINES TO REMOVE ==========
  // Initialize activeDay based on current date
  const getCurrentDayName = () => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTime = hours * 60 + minutes;
    
    // For 3rd shift between midnight (00:00) and 6 AM (360 minutes),
    // return the PREVIOUS day since that's when the shift started
    const currentShift = AutoAbsenceMonitor.getCurrentShift();
    if (currentShift === "3rd" && currentTime >= 0 && currentTime < 360) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return days[yesterday.getDay()];
    }
    
    return days[now.getDay()];
  };
  const [activeDay, setActiveDay] = useState(getCurrentDayName());
  // ========== END DAYS OF WEEK TABS SECTION ==========

  // Search functionality states
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchResults, setSearchResults] = useState([]);

  const [scheduleInfo, setScheduleInfo] = useState(null);
  const [daysLeft, setDaysLeft] = useState(null);
  const [showAbsentConfirm, setShowAbsentConfirm] = useState(false);
  const [pendingAbsentAssignment, setPendingAbsentAssignment] = useState(null);

  // Custom alert modal states
  const [showCustomAlert, setShowCustomAlert] = useState(false);
  const [customAlertMessage, setCustomAlertMessage] = useState("");
  const [customAlertTitle, setCustomAlertTitle] = useState("Notification");

  // Auto-regeneration notification modal
  const [showAutoRegenModal, setShowAutoRegenModal] = useState(false);
  const [autoRegenInfo, setAutoRegenInfo] = useState({ start: null, end: null, version: 0 });

  // 🔧 DEBUG MODE: Set to true to use minutes instead of months for testing auto-regeneration
  const DEBUG_MODE = false; // Toggle this to enable/disable debug mode
  const [debugMinutes, setDebugMinutes] = useState(""); // Input for debug minutes

  // 3-shift schedule definitions
  const shiftDefs = [
    { name: "1st Shift (6:00 AM - 2:00 PM)", key: "1st", time_range: { start: "06:00", end: "14:00" } },
    { name: "2nd Shift (2:00 PM - 10:00 PM)", key: "2nd", time_range: { start: "14:00", end: "22:00" } },
    { name: "3rd Shift (10:00 PM - 6:00 AM)", key: "3rd", time_range: { start: "22:00", end: "06:00" } },
  ];
  const [activeShift, setActiveShift] = useState(AutoAbsenceMonitor.getCurrentShift() || shiftDefs[0].key);

  const [currentVersion, setCurrentVersion] = useState(0);

  const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  // Helper function to get the correct date for temp reassignment matching
  // For 3rd shift, we need to check both the current date and previous date
  // because 3rd shift runs from 10 PM to 6 AM (crosses midnight)
  const getRelevantDatesForShift = (dateStr, shift) => {
    if (shift === "3rd") {
      // For 3rd shift, include both the date and the previous day
      // because temp reassignments created at 10 PM yesterday are still valid until 6 AM today
      const currentDate = new Date(dateStr);
      const previousDate = new Date(currentDate);
      previousDate.setDate(previousDate.getDate() - 1);
      return [dateStr, previousDate.toISOString().slice(0, 10)];
    }
    return [dateStr]; // For 1st and 2nd shifts, only use the exact date
  };

  // Custom alert function to replace native alert()
  const showAlert = (message, title = "Notification") => {
    setCustomAlertMessage(message);
    setCustomAlertTitle(title);
    setShowCustomAlert(true);
  };

  const closeCustomAlert = () => {
    setShowCustomAlert(false);
    setCustomAlertMessage("");
    setCustomAlertTitle("Notification");
  };

  // Search functionality
  const handleSearch = (query) => {
    setSearchQuery(query);
    
    if (!query.trim()) {
      setShowSearchResults(false);
      setSearchResults([]);
      return;
    }

    const results = [];
    const selectedDateStr = formatDateString(selectedDate);
    const queryLower = query.toLowerCase();

    // Search through all assignments
    assignments.forEach(assignment => {
      if (!assignment.is_current) return;

      const caregiver = caregivers.find(cg => cg.id === assignment.user_id);
      if (!caregiver) return;

      const caregiverName = `${caregiver.user_fname} ${caregiver.user_lname}`.toLowerCase();
      
      // Check if caregiver name matches search query
      if (caregiverName.includes(queryLower)) {
        const house = houses.find(h => h.house_id === assignment.house_id);
        const houseName = house?.house_name || assignment.house_id;
        
        // Get absence status
        const absenceDetails = getCaregiverAbsenceDetails(assignment.user_id, selectedDateStr, absences);
        
        // Get assigned elderly for this caregiver
        const assignedElderly = getDisplayedEldersFor(assignment.user_id);
        
        // Check if providing emergency coverage
        const isEmergency = isProvidingEmergencyCoverage(assignment.user_id, selectedDateStr, tempReassigns);
        
        results.push({
          caregiver: caregiver,
          assignment: assignment,
          houseName: houseName,
          absenceDetails: absenceDetails,
          assignedElderly: assignedElderly,
          isEmergency: isEmergency
        });
      }
    });

    setSearchResults(results);
    setShowSearchResults(true);
  };

  const clearSearch = () => {
    setSearchQuery("");
    setShowSearchResults(false);
    setSearchResults([]);
  };

  const navigateToCaregiver = (houseId, shift) => {
    setActiveHouseId(houseId);
    setActiveShift(shift);
    setShowSearchResults(false);
  };

  // Fetch admin name for logging
  const [adminFirstName, setAdminFirstName] = useState("");
  const [adminLastName, setAdminLastName] = useState("");
  
  useEffect(() => {
    const fetchAdminName = async () => {
      try {
        let currentUser = user;
        
        if (!currentUser) {
          currentUser = auth.currentUser;
        }

        if (currentUser) {
          const userDocRef = doc(db, "users", currentUser.uid);
          const userDocSnap = await getDoc(userDocRef);
          
          if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            const fullName = `${userData.user_fname || ""} ${userData.user_lname || ""}`.trim();
            setCurrentAdminName(fullName || currentUser.email || "Admin User");
            setAdminFirstName(userData.user_fname || "");
            setAdminLastName(userData.user_lname || "");
          } else {
            setCurrentAdminName(currentUser.email || "Admin User");
          }
        } else {
          setCurrentAdminName("System");
        }
      } catch (error) {
        console.error("Error fetching admin name:", error);
        setCurrentAdminName(user?.email || "System");
      }
    };

    fetchAdminName();
  }, [user]);

  // Fetch activity logs for schedule
  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(
        collection(db, "schedule_activity_logs"),
        where("log_type", "==", "schedule_management")
      ),
      (snapshot) => {
        const logs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        // Sort by timestamp, most recent first
        logs.sort((a, b) => {
          const timeA = a.timestamp?.toDate?.() || new Date(a.timestamp);
          const timeB = b.timestamp?.toDate?.() || new Date(b.timestamp);
          return timeB - timeA;
        });
        setActivityLogs(logs);
      }
    );

    return () => unsubscribe();
  }, []);


  useEffect(() => {
    (async () => {
      await loadStaticData();
      await loadAllAssignments();
      await loadAllElderlyAssigns();
      await loadTempReassigns();
    })();
  }, []);

  useEffect(() => {
    const savedDuration = localStorage.getItem("schedule_duration");
    const savedCustom = localStorage.getItem("schedule_custom");
    if (savedDuration) setDuration(parseInt(savedDuration));
    if (savedCustom) setCustomDuration(savedCustom);
  }, []);


  useEffect(() => {
    loadAllAssignments();
  }, [viewMode]);

  useEffect(() => {
    const checkAutoReshuffle = async () => {
      if (assignments.length === 0) {
        if (DEBUG_MODE) console.log(`🔧 DEBUG: No assignments found, skipping check`);
        return;
      }

      // Find the latest current assignment
      const currentAssigns = assignments.filter(a => a.is_current);
      if (!currentAssigns.length) {
        if (DEBUG_MODE) console.log(`🔧 DEBUG: No current assignments found, skipping check`);
        return;
      }

      // 🔧 DEBUG MODE: Log first assignment structure
      if (DEBUG_MODE) {
        console.log(`🔧 DEBUG: Total assignments: ${assignments.length}, Current assignments: ${currentAssigns.length}`);
        console.log(`🔧 DEBUG: First assignment structure:`, currentAssigns[0]);
      }

      // Get the latest end_date among all current assignments
      // Check both root level end_date and nested schedule_period.end_date
      const latestEnd = currentAssigns
        .map(a => {
          // Try schedule_period.end_date first (new structure), then fall back to root end_date (old structure)
          const endDate = a.schedule_period?.end_date || a.end_date;
          return endDate?.toDate ? endDate.toDate() : null;
        })
        .filter(date => date !== null) // Filter out null dates
        .sort((a, b) => b - a)[0];

      const now = new Date();

      // 🔧 DEBUG MODE: More verbose logging and earlier trigger check
      if (DEBUG_MODE) {
        console.log(`🔧 DEBUG: Auto-reshuffle check running...`);
        console.log(`🔧 DEBUG: Current time: ${now.toLocaleString()}`);
        console.log(`🔧 DEBUG: Schedule end time: ${latestEnd?.toLocaleString() || 'UNDEFINED - NO END_DATE FOUND!'}`);
        if (!latestEnd) {
          console.log(`🔧 DEBUG: ❌ NO END_DATE FOUND in assignments! Check database structure.`);
          console.log(`🔧 DEBUG: Sample assignment:`, currentAssigns[0]);
        }
        if (latestEnd) {
          const timeDiff = now - latestEnd;
          const secondsDiff = Math.floor(timeDiff / 1000);
          console.log(`🔧 DEBUG: Time difference: ${secondsDiff} seconds (${timeDiff > 0 ? 'PAST' : 'FUTURE'})`);
        }
      }

      if (latestEnd && now > latestEnd) {
        console.log("🚨 Auto reshuffle triggered!");
        const months = customDuration ? parseInt(customDuration) : duration;
        
        try {
          setIsGenerating(true);
          await handleScheduleGeneration(months);
          
          // Show auto-regeneration notification modal
          await new Promise(resolve => setTimeout(resolve, 500)); // Wait for DB sync
          const newAssignments = await ScheduleService.fetchAssignments(true);
          
          if (newAssignments && newAssignments.length > 0) {
            const firstAssignment = newAssignments[0];
            let start, end, version;
            
            // Try schedule_period first (new structure), then fall back to root level (old structure)
            if (firstAssignment.schedule_period) {
              start = firstAssignment.schedule_period.start_date?.toDate?.() || 
                      (firstAssignment.schedule_period.start_date ? new Date(firstAssignment.schedule_period.start_date) : null);
              end = firstAssignment.schedule_period.end_date?.toDate?.() || 
                    (firstAssignment.schedule_period.end_date ? new Date(firstAssignment.schedule_period.end_date) : null);
            } else {
              start = firstAssignment.start_date?.toDate?.() || 
                      (firstAssignment.start_date ? new Date(firstAssignment.start_date) : null);
              end = firstAssignment.end_date?.toDate?.() || 
                    (firstAssignment.end_date ? new Date(firstAssignment.end_date) : null);
            }
            
            version = firstAssignment.version || 0;
            
            setAutoRegenInfo({ start, end, version });
            setShowAutoRegenModal(true);
          }
        } catch (error) {
          console.error("Error during auto-regeneration:", error);
          showAlert("Auto-regeneration failed. Please generate schedule manually.", "Error");
        } finally {
          setIsGenerating(false);
        }
      }
    };

    // Initial check
    checkAutoReshuffle();
    
    // 🔧 Set up interval to check every 10 seconds (or every 5 seconds in debug mode)
    const intervalMs = DEBUG_MODE ? 5000 : 30000; // 5 seconds in debug, 30 seconds in production
    const intervalId = setInterval(() => {
      checkAutoReshuffle();
    }, intervalMs);
    
    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
  }, [assignments, DEBUG_MODE, customDuration, duration]); // runs when dependencies change

    // inside your Schedule component
  useEffect(() => {
    // build the query to only get current schedules
    const q = query(
      collection(db, "house_shift_assignments"),
      where("is_current", "==", true),
      where("user_type", "==", "caregiver")
    );

    // attach real-time listener
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      setAssignments(data); // 🔹 update state immediately
    });

    // cleanup listener on unmount
    return () => unsubscribe();
  }, []); // 👈 runs only once when component mounts

  useEffect(() => {
  if (viewMode === "history") {
    const q = query(
      collection(db, "house_shift_assignments"),
      where("is_current", "==", false),
      where("user_type", "==", "caregiver")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      setAssignments(data);
    });

    return () => unsubscribe();
  }
}, [viewMode]);

  useEffect(() => {
    const q = query(
      collection(db, "elderly_assignments"),
      where("status", "==", "active"),
      where("is_current", "==", true),
      where("user_type", "==", "caregiver")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setElderlyAssigns(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "temporary_assignments"),
      (snapshot) => {
        setTempReassigns(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    );
    return () => unsubscribe();
  }, []);

  // Monitor unassigned caregivers in real-time
  useEffect(() => {
    const checkUnassignedCaregivers = async () => {
      try {
        // Get all active caregivers
        const allCaregiversSnapshot = await getDocs(
          query(collection(db, "users"), where("user_type", "==", "caregiver"))
        );
        
        // Get current assignments
        const currentAssignmentsSnapshot = await getDocs(
          query(
            collection(db, "house_shift_assignments"), 
            where("is_current", "==", true),
            where("user_type", "==", "caregiver")
          )
        );
        
        const assignedCaregiverIds = new Set();
        currentAssignmentsSnapshot.docs.forEach(doc => {
          assignedCaregiverIds.add(doc.data().user_id);
        });
        
        // Count unassigned active caregivers (exclude resigned/deactivated)
        // IMPORTANT: Must match the filter logic in newCaregiverService.js detectUnassignedCaregivers()
        let count = 0;
        allCaregiversSnapshot.docs.forEach(doc => {
          const data = doc.data();
          // Check both user_status AND user_activation (matches service filter)
          const isActive = data.user_activation !== false; // Exclude deactivated caregivers
          const isResigned = data.user_status === "resigned" || data.user_status === "deactivated";
          const isAssigned = assignedCaregiverIds.has(doc.id);
          
          // Only count caregivers that are: active, not resigned, and not assigned
          if (isActive && !isResigned && !isAssigned) {
            count++;
          }
        });
        
        setUnassignedCount(count);
      } catch (error) {
        console.error("Error checking unassigned caregivers:", error);
      }
    };

    // Check immediately on mount
    checkUnassignedCaregivers();

    // Set up real-time listeners for both users and assignments
    const unsubscribeUsers = onSnapshot(
      query(collection(db, "users"), where("user_type", "==", "caregiver")),
      () => checkUnassignedCaregivers()
    );

    const unsubscribeAssignments = onSnapshot(
      query(
        collection(db, "house_shift_assignments"),
        where("is_current", "==", true),
        where("user_type", "==", "caregiver")
      ),
      () => checkUnassignedCaregivers()
    );

    return () => {
      unsubscribeUsers();
      unsubscribeAssignments();
    };
  }, []);

  // 🔔 Real-time Attendance Monitor - Auto-marks users absent from mobile app
  useEffect(() => {
    // Handle emergency coverage detection
    const handleEmergencyDetected = (emergencyCheck) => {
      console.log(`\n%c🚨🚨🚨 EMERGENCY COVERAGE DETECTED! 🚨🚨🚨`, 'color: #FF0000; font-weight: bold; font-size: 18px; background: #FFF3CD; padding: 10px;');
      console.log(`%c${emergencyCheck.emergencyCount} house/shift(s) with ZERO coverage!`, 'color: #FF6B6B; font-weight: bold; font-size: 16px');
      
      // Update emergency count badge (but don't auto-show modal)
      setEmergencyOptions(emergencyCheck.emergencyOptions);
      setEmergencyCount(emergencyCheck.emergencyCount); // Update badge count
      
      // Just show notification alert (no automatic modal)
      showAlert(
        `🚨 EMERGENCY: ${emergencyCheck.emergencyCount} house/shift(s) have NO caregivers available! Please click the "Emergency Coverage" button to assign coverage.`,
        `🚨 Emergency Coverage Required`
      );
    };
    
    // Process attendance record when new absence is detected
    const handleAttendanceChange = async (attendanceRecord) => {
      console.log(`\n🚨 ATTENDANCE CHANGE DETECTED - Processing...`);
      
      // Process the attendance record with emergency detection callback
      const result = await AttendanceMonitorService.processAttendanceRecord(
        attendanceRecord,
        assignments,
        elderlyAssigns,
        tempReassigns,
        handleEmergencyDetected // Pass emergency callback
      );
      
      if (result.success && (result.action === 'marked_absent' || result.action === 'marked_absent_with_emergency')) {
        // Data will automatically refresh via real-time listeners
        console.log(`✅ Auto-marked ${result.userId} as absent - real-time listeners will update UI automatically`);
        
        // REMOVED: Manual data refresh calls - real-time listeners handle this
        // await loadAllAssignments();
        // await loadAllElderlyAssigns();
        // await loadTempReassigns();
        
        // REMOVED: Auto-absence notification popup
        // The UI will automatically update to show the absence (red row, Undo button)
        // No need for additional popup notifications
      }
    };
    
    // Subscribe to real-time attendance changes
    const unsubscribe = AttendanceMonitorService.subscribeToAttendanceChanges(handleAttendanceChange);
    
    // Batch process any pending attendance records on mount (catch up)
    const processPendingAttendance = async () => {
      if (assignments.length > 0 && elderlyAssigns.length > 0) {
        console.log(`🔄 Checking for pending attendance records...`);
        const result = await AttendanceMonitorService.batchProcessPendingAttendance(
          assignments,
          elderlyAssigns,
          tempReassigns,
          null, // dateStr (null = today)
          handleEmergencyDetected // Pass emergency callback for batch processing too
        );
        
        if (result.processed > 0) {
          console.log(`✅ Batch processed ${result.processed} pending absences - real-time listeners will update UI`);
          
          if (result.emergenciesDetected > 0) {
            console.log(`%c🚨 ${result.emergenciesDetected} emergency situation(s) detected during batch processing!`, 'color: #FF6B6B; font-weight: bold');
          }
          
          // REMOVED: Manual data refresh - real-time listeners handle this
          // await loadAllAssignments();
          // await loadAllElderlyAssigns();
          // await loadTempReassigns();
        }
      }
    };
    
    processPendingAttendance();
    
    // Start automatic absence monitoring (checks every minute for users who haven't checked in)
    console.log(`🔔 Starting automatic absence monitoring for caregivers...`);
    const stopAutoMonitor = AutoAbsenceMonitor.startAutoAbsenceMonitoring(
      () => ({
        assignments,
        elderlyAssigns,
        tempReassigns,
        onEmergencyDetected: handleEmergencyDetected,
        logActivity: logScheduleActivity
      }),
      async (result) => {
        console.log(`⚠️ Auto-marked ${result.processed} user(s) absent - real-time listeners will update UI automatically`);
        // REMOVED: Manual data refresh - real-time listeners handle this
        // await loadAllAssignments();
        // await loadAllElderlyAssigns();
        // await loadTempReassigns();
        // Alert removed - silent auto-absence marking
      }
    );
    
    return () => {
      unsubscribe();
      stopAutoMonitor();
    };
  }, [assignments.length, elderlyAssigns.length, tempReassigns.length]); // Re-run when data is available

  useEffect(() => {
    // Debug: Query ALL absences to see what's in the database
    const debugQuery = async () => {
      const allAbsencesSnapshot = await getDocs(collection(db, "nurse_cg_absence"));
      console.log(`🔍 DEBUG: Total records in nurse_cg_absence collection: ${allAbsencesSnapshot.docs.length}`);
      if (allAbsencesSnapshot.docs.length > 0) {
        console.log(`🔍 DEBUG: All absence records:`, allAbsencesSnapshot.docs.map(d => ({
          id: d.id,
          user_id: d.data().user_id,
          absence_date: d.data().absence_date,
          absence_type: d.data().absence_type,
          status: d.data().status,
          is_leave: d.data().is_leave,
          do_not_clear: d.data().do_not_clear,
          created_at: d.data().created_at?.toDate?.()
        })));
      }
    };
    debugQuery();
    
    // SUPER DEBUG: Listen to ALL documents in the collection to catch status changes
    const debugUnsubscribe = onSnapshot(
      collection(db, "nurse_cg_absence"),
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const data = change.doc.data();
          if (change.type === "added") {
            console.log(`%c🆕 NEW absence record created:`, 'color: #00FF00; font-weight: bold', {
              id: change.doc.id,
              user_id: data.user_id,
              absence_date: data.absence_date,
              status: data.status,
              absence_type: data.absence_type
            });
          }
          if (change.type === "modified") {
            console.log(`%c✏️ MODIFIED absence record:`, 'color: #FFA500; font-weight: bold; font-size: 14px', {
              id: change.doc.id,
              user_id: data.user_id,
              absence_date: data.absence_date,
              NEW_status: data.status,
              absence_type: data.absence_type
            });
            
            // Special alert for status changes to "unmarked" - this is the UNDO action
            if (data.status === "unmarked") {
              console.log(`%c🔄 UNDO DETECTED IN LISTENER - Status changed to "UNMARKED"`, 'color: #00FFFF; font-weight: bold; font-size: 16px; background: #000; padding: 5px');
              console.log(`%c   User: ${data.user_id}`, 'color: #00FFFF; font-weight: bold');
              console.log(`%c   Date: ${data.absence_date}`, 'color: #00FFFF; font-weight: bold');
              console.log(`%c   Shift: ${data.shift}`, 'color: #00FFFF; font-weight: bold');
              console.log(`%c   Document ID: ${change.doc.id}`, 'color: #00FFFF; font-weight: bold');
              console.log(`%c   ⚡ This should trigger the main listener to remove this record from absences array`, 'color: #00FFFF');
            }
            
            console.warn(`%c🚨 ALERT: Absence record modified - Document ${change.doc.id}`, 'color: #FFA500; font-weight: bold');
          }
          if (change.type === "removed") {
            console.log(`%c🗑️ DELETED absence record:`, 'color: #FF0000; font-weight: bold', {
              id: change.doc.id,
              user_id: data.user_id,
              absence_date: data.absence_date
            });
          }
        });
      }
    );
    
    const unsubscribe = onSnapshot(
      query(
        collection(db, "nurse_cg_absence"),
        where("status", "==", "active")
      ),
      (snapshot) => {
        // Log document changes specifically for the ACTIVE absences listener
        snapshot.docChanges().forEach((change) => {
          const data = change.doc.data();
          if (change.type === "removed") {
            console.log(`%c📤 REMOVED from active absences (listener detected status changed away from "active"):`, 
              'color: #FF00FF; font-weight: bold; font-size: 15px; background: #000; padding: 5px');
            console.log(`%c   User: ${data.user_id}`, 'color: #FF00FF; font-weight: bold');
            console.log(`%c   Date: ${data.absence_date}`, 'color: #FF00FF; font-weight: bold');
            console.log(`%c   Document ID: ${change.doc.id}`, 'color: #FF00FF; font-weight: bold');
            console.log(`%c   ✅ This is GOOD - it means the undo worked!`, 'color: #00FF00; font-weight: bold; font-size: 14px');
          }
        });
        
        const absencesData = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        console.log(`%c✅ ACTIVE ABSENCES LISTENER - Loaded ${absencesData.length} active absences`, 
          'color: #00FF00; font-weight: bold');
        if (absencesData.length > 0) {
          console.log(`Sample absences:`, absencesData.slice(0, 3).map(a => ({
            user_id: a.user_id,
            absence_date: a.absence_date,
            absence_type: a.absence_type,
            status: a.status
          })));
        } else {
          console.warn(`⚠️ No active absences found. This might mean:`);
          console.warn(`  1. No absence records exist at all`);
          console.warn(`  2. All records have status != "active"`);
          console.warn(`  3. There's a database query issue`);
        }
        setAbsences(absencesData);
      },
      (error) => {
        console.error(`❌ Error loading absences:`, error);
      }
    );
    return () => {
      unsubscribe();
      debugUnsubscribe();
    };
  }, []);

  // Fetch and display schedule info from current assignments (regardless of view mode)
  useEffect(() => {
    const fetchScheduleInfo = async () => {
      try {
        // Always fetch current assignments to show schedule info
        const currentAssignments = await ScheduleService.fetchAssignments(true);
        
        if (!currentAssignments || currentAssignments.length === 0) {
          console.log("📅 No current assignments found - schedule info will be blank");
          setScheduleInfo(null);
          setDaysLeft(null);
          return;
        }

        // Get the first current assignment (they all share same start/end dates)
        const firstAssignment = currentAssignments[0];
        
        // Handle both old format (start_date/end_date at root) and new format (inside schedule_period)
        let start, end;
        
        if (firstAssignment.schedule_period) {
          // New format - dates are inside schedule_period object
          console.log("📅 Reading schedule info from schedule_period:", firstAssignment.schedule_period);
          start = firstAssignment.schedule_period.start_date?.toDate ? 
                  firstAssignment.schedule_period.start_date.toDate() : 
                  new Date(firstAssignment.schedule_period.start_date);
          end = firstAssignment.schedule_period.end_date?.toDate ? 
                firstAssignment.schedule_period.end_date.toDate() : 
                new Date(firstAssignment.schedule_period.end_date);
        } else {
          // Old format - dates at root level (fallback for older schedules)
          console.log("📅 Reading schedule info from root level (old format)");
          start = firstAssignment.start_date?.toDate ? 
                  firstAssignment.start_date.toDate() : 
                  (firstAssignment.start_date ? new Date(firstAssignment.start_date) : null);
          end = firstAssignment.end_date?.toDate ? 
                firstAssignment.end_date.toDate() : 
                (firstAssignment.end_date ? new Date(firstAssignment.end_date) : null);
        }

        if (start && end) {
          console.log(`📅 Schedule info loaded: ${start.toLocaleDateString()} → ${end.toLocaleDateString()}`);
          setScheduleInfo({ start, end });

          // Compute countdown days
          const today = new Date();
          const diffMs = end.getTime() - today.getTime();
          const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          const daysLeftCount = diffDays > 0 ? diffDays : 0;
          console.log(`📅 Days left: ${daysLeftCount}`);
          setDaysLeft(daysLeftCount);
        } else {
          console.warn("⚠️ Schedule dates are missing or invalid");
          setScheduleInfo(null);
          setDaysLeft(null);
        }
      } catch (error) {
        console.error("❌ Error fetching schedule info:", error);
        setScheduleInfo(null);
        setDaysLeft(null);
      }
    };

    fetchScheduleInfo();
  }, [viewMode]); // Re-fetch when view mode changes to ensure info is always up to date

  // Separate effect to handle date validation when schedule info changes
  useEffect(() => {
    if (scheduleInfo?.start && scheduleInfo?.end) {
      const { start, end } = scheduleInfo;
      const currentSelected = selectedDate;
      
      // If the currently selected date is outside the schedule range, reset it
      if (currentSelected < start || currentSelected > end) {
        // Choose today if it's within range, otherwise use start date
        const today = new Date();
        const newSelectedDate = (today >= start && today <= end) ? today : start;
        setSelectedDate(newSelectedDate);
        
        // Update the day tab to match
        const dayName = daysOfWeek[newSelectedDate.getDay() === 0 ? 6 : newSelectedDate.getDay() - 1];
        setActiveDay(dayName);
      }
    }
  }, [scheduleInfo]);

  // Monitor for emergency coverage needs (real-time check)
  // NOTE: Only updates the badge count - modal only shows when admin clicks Emergency Coverage button
  useEffect(() => {
    const checkEmergencies = async () => {
      // Skip emergency check if undo operation is in progress
      if (undoInProgress.current) {
        console.log('⏸️ Skipping emergency check - undo operation in progress');
        return;
      }
      
      if (assignments.length === 0 || elderlyAssigns.length === 0) {
        setEmergencyCount(0);
        return;
      }

      try {
        const selectedDateStr = formatDateString(selectedDate);
        const emergencyCheck = await EmergencyService.checkEmergencyNeedsAndDonors(
          selectedDateStr, 
          assignments, 
          elderlyAssigns, 
          tempReassigns
        );
        
        if (emergencyCheck.hasEmergency) {
          setEmergencyCount(emergencyCheck.emergencyCount);
          console.log(`🚨 Found ${emergencyCheck.emergencyCount} emergency situations for ${selectedDateStr} (badge updated - modal will not auto-show)`);
        } else {
          setEmergencyCount(0);
        }
      } catch (error) {
        console.error("Error checking for emergencies:", error);
        setEmergencyCount(0);
      }
    };

    checkEmergencies();
  }, [selectedDate, assignments, elderlyAssigns, tempReassigns, absences]); // Re-check when these change

  // --- Loaders ---
  const loadStaticData = async () => {
    try {
      const data = await ScheduleService.fetchStaticData();
      
      // Filter out resigned caregivers (user_activation === false)
      const activeCaregivers = data.caregivers.filter(cg => cg.user_activation !== false);
      const resignedCount = data.caregivers.length - activeCaregivers.length;
      
      if (resignedCount > 0) {
        console.log(`📊 Filtered out ${resignedCount} resigned caregiver(s) from schedule display`);
      }
      
      setCaregivers(activeCaregivers);
      setHouses(data.houses);
      setElderlyList(data.elderly);

      // Set H001 (St. Sebastian) as default house if present
      if (!activeHouseId && data.houses.length) {
        const defaultHouse = data.houses.find(h => h.house_id === "H001") || data.houses[0];
        setActiveHouseId(defaultHouse.house_id);
      }

      const v = await ScheduleService.getMaxVersion();
      setCurrentVersion(v);
    } catch (error) {
      console.error("Error loading static data:", error);
      showAlert("Failed to load data. Please refresh the page.", "Error");
    }
  };

  const loadAllAssignments = async () => {
    try {
      const isCurrent = viewMode === "current";
      const data = await ScheduleService.fetchAssignments(isCurrent);
      setAssignments(data);
    } catch (error) {
      console.error("Error loading assignments:", error);
    }
  };

  const loadAllElderlyAssigns = async () => {
    try {
      const data = await ScheduleService.fetchElderlyAssignments();
      setElderlyAssigns(data);
    } catch (error) {
      console.error("Error loading elderly assignments:", error);
    }
  };

  const loadTempReassigns = async () => {
    try {
      const data = await ScheduleService.fetchTempReassignments();
      setTempReassigns(data);
    } catch (error) {
      console.error("Error loading temp reassignments:", error);
    }
  };

  // Activity logging function
  const logScheduleActivity = async (action, details = {}) => {
    try {
      await addDoc(collection(db, "schedule_activity_logs"), {
        action: action,
        performed_by: details.performed_by || currentAdminName || user?.email || "System",
        timestamp: Timestamp.now(),
        details: details.description || "",
        log_type: "schedule_management",
        metadata: {
          ...details.metadata,
          admin_fname: adminFirstName || undefined,
          admin_lname: adminLastName || undefined
        }
      });
      console.log(`📝 Logged activity: ${action}`);
    } catch (error) {
      console.error("Error logging schedule activity:", error);
    }
  };

  // Schedule generation function - now uses API service
  const handleScheduleGeneration = async (months, customization = null) => {
    try {
      // 🔧 DEBUG MODE: Use minutes instead of months if debug mode is enabled
      let durationInMonths = months;
      if (DEBUG_MODE && debugMinutes && parseInt(debugMinutes) > 0) {
        // Convert minutes to a fractional month value for the database
        // 1 month ≈ 43800 minutes (30 days * 24 hours * 60 minutes)
        durationInMonths = parseInt(debugMinutes) / 43800;
        console.log(`🔧 DEBUG: Using ${debugMinutes} minutes (${durationInMonths.toFixed(6)} months) for schedule duration`);
      }
      
      const result = await ScheduleService.generateSchedule(durationInMonths, {
        caregivers,
        houses,
        elderly: elderlyList,
        customization // Pass customization settings to the service
      });
      
      if (result.success) {
        console.log("Schedule generated successfully:", result.message);
        
        // 🔧 DEBUG MODE: Log the actual end date for verification
        if (DEBUG_MODE && debugMinutes) {
          const endDate = new Date();
          endDate.setMinutes(endDate.getMinutes() + parseInt(debugMinutes));
          console.log(`🔧 DEBUG: Schedule should expire at: ${endDate.toLocaleString()}`);
        }
        
        // Log schedule generation activity
        await logScheduleActivity("Schedule Generated", {
          performed_by: currentAdminName || user?.email || "Admin User",
          description: `Generated ${durationInMonths}-month caregiver schedule (Version ${result.version})${customization ? ' with custom settings' : ''}`,
          metadata: {
            duration_months: durationInMonths,
            version: result.version,
            caregivers_count: caregivers.length,
            houses_count: houses.length,
            has_customization: !!customization
          }
        });
        
        setCurrentVersion(result.version);
        // Refresh data after generation
        await loadAllAssignments();
        await loadAllElderlyAssigns();
      }
    } catch (error) {
      console.error("Error generating schedule:", error);
      throw error; // Re-throw so calling function can handle it
    }
  };

  const confirmGenerate = async (customization = null) => {
    setIsGenerating(true);
    setShowOverlay(false);
    setShowCustomizationModal(false);
    
    // Extract duration from customization if available
    const months = customization?.duration || 6; // Default to 6 months
    
    if (customization) {
      setCustomizationSettings(customization);
    }
    
    try {
      await handleScheduleGeneration(months, customization);
      
      // Refresh schedule info immediately after generation
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for DB operations
      const currentAssignments = await ScheduleService.fetchAssignments(true);
      
      if (currentAssignments && currentAssignments.length > 0) {
        const firstAssignment = currentAssignments[0];
        let start, end;
        
        if (firstAssignment.schedule_period) {
          start = firstAssignment.schedule_period.start_date?.toDate?.() || new Date(firstAssignment.schedule_period.start_date);
          end = firstAssignment.schedule_period.end_date?.toDate?.() || new Date(firstAssignment.schedule_period.end_date);
        } else {
          start = firstAssignment.start_date?.toDate?.() || new Date(firstAssignment.start_date);
          end = firstAssignment.end_date?.toDate?.() || new Date(firstAssignment.end_date);
        }
        
        if (start && end) {
          setScheduleInfo({ start, end });
          const now = new Date();
          const diffTime = end - now;
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          setDaysLeft(diffDays >= 0 ? diffDays : 0);
          console.log("✅ Schedule info updated after generation");
        }
      }
      
      setShowSuccess(true);
    } catch (err) {
      console.error("Error generating schedule:", err);
      showAlert("Something went wrong. Please try again.", "Error");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateClick = () => {
    setShowCustomizationModal(true);
  };

  // Manual emergency coverage activation - now with modal
  const handleEmergencyCoverage = async () => {
    console.log("🚨 Emergency Coverage button clicked");
    
    try {
      const selectedDateStr = formatDateString(selectedDate);
      console.log(`📅 Checking emergency needs for date: ${selectedDateStr}`);
      console.log(`📊 Current assignments count: ${assignments.length}`);
      console.log(`👵 Current elderly assignments count: ${elderlyAssigns.length}`);
      console.log(`🔄 Current temp reassignments count: ${tempReassigns.length}`);
      
      const emergencyCheck = await EmergencyService.checkEmergencyNeedsAndDonors(selectedDateStr, assignments, elderlyAssigns, tempReassigns);
      console.log("🔍 Emergency check result:", emergencyCheck);
      
      if (!emergencyCheck.hasEmergency) {
        console.log("✅ No emergency coverage needed");
        setEmergencyCount(0); // Update badge count to 0
        showAlert("✅ No emergency coverage needed for this date.", "Success");
        return;
      }
      
      console.log(`🆘 Found ${emergencyCheck.emergencyCount} emergencies`);
      console.log("🎯 Emergency options:", emergencyCheck.emergencyOptions);
      
      // Initialize selected donor choices with suggested donors
      const initialChoices = {};
      emergencyCheck.emergencyOptions.forEach(option => {
        if (option.suggestedDonor) {
          initialChoices[`${option.emergencyHouse}_${option.emergencyShift}`] = {
            donorHouse: option.suggestedDonor.house,
            caregiverId: option.suggestedDonor.presentCaregivers[0]?.caregiverId
          };
        }
      });
      
      console.log("💡 Initial donor choices:", initialChoices);
      
      setEmergencyOptions(emergencyCheck.emergencyOptions);
      setEmergencyCount(emergencyCheck.emergencyCount); // Update badge count
      setSelectedDonorChoices(initialChoices);
      setShowEmergencyModal(true);
      
      console.log("✅ Modal should be showing now");
      
    } catch (error) {
      console.error("❌ Error checking emergency coverage:", error);
      showAlert(`Failed to check emergency coverage needs: ${error.message}`, "Error");
    }
  };

  // Execute emergency coverage with selected donors (ONE at a time)
  const executeEmergencyCoverage = async () => {
    try {
      const selectedDateStr = formatDateString(selectedDate);
      
      // Create donor choices array for the API (now only contains ONE emergency)
      const donorChoices = Object.entries(selectedDonorChoices).map(([key, choice]) => {
        const [house, shift] = key.split('_');
        return {
          emergencyHouse: house,
          emergencyShift: shift,
          donorHouse: choice.donorHouse,
          caregiverId: choice.caregiverId
        };
      });
      
      console.log(`🚨 Executing emergency coverage for ${donorChoices.length} emergency...`);
      
      const result = await EmergencyService.activateEmergencyCoverage(selectedDateStr, assignments, elderlyAssigns, tempReassigns, donorChoices);
      
      if (result.success) {
        if (result.emergencyReassignments?.length > 0) {
          const emergencyCount = result.emergencyReassignments.length;
          
          // Log emergency coverage activity
          await logScheduleActivity("Emergency Coverage Activated", {
            performed_by: currentAdminName || user?.email || "Admin User",
            description: `Activated emergency coverage for ${emergencyCount} emergency situation(s) on ${selectedDateStr}`,
            metadata: {
              date: selectedDateStr,
              emergencies_resolved: emergencyCount,
              reassignments: result.emergencyReassignments.map(er => ({
                emergency_house: er.emergencyHouse,
                emergency_shift: er.emergencyShift,
                donor_house: er.donorHouse,
                caregiver_assigned: er.caregiverName
              }))
            }
          });
          
          showAlert(`🚨 Emergency coverage activated!\n\n${emergencyCount} emergency reassignment(s) made:\n${result.emergencyReassignments.map(er => `• ${er.emergencyHouse} ${er.emergencyShift} covered by caregiver from ${er.donorHouse}`).join('\n')}`, "Emergency Coverage Activated");
          
          // Refresh data to show changes
          await loadAllAssignments();
          await loadAllElderlyAssigns();
          await loadTempReassigns();
          
          // Close modal temporarily
          setShowEmergencyModal(false);
          setEmergencyOptions([]);
          setSelectedDonorChoices({});
          
          // Re-check for remaining emergencies
          console.log(`🔍 Checking for remaining emergencies after resolving one...`);
          
          // Wait a bit for data to sync
          setTimeout(async () => {
            try {
              // Re-fetch latest data
              const latestAssignments = await ScheduleService.fetchAssignments(true);
              const latestElderlyAssigns = await ScheduleService.fetchElderlyAssignments();
              const latestTempReassigns = await ScheduleService.fetchTempReassignments();
              
              const emergencyCheck = await EmergencyService.checkEmergencyNeedsAndDonors(
                selectedDateStr, 
                latestAssignments, 
                latestElderlyAssigns, 
                latestTempReassigns
              );
              
              if (emergencyCheck.hasEmergency) {
                console.log(`🆘 Found ${emergencyCheck.emergencyCount} more emergencies!`);
                
                // Update emergency data (but don't auto-show modal again)
                setEmergencyOptions(emergencyCheck.emergencyOptions);
                setEmergencyCount(emergencyCheck.emergencyCount); // Update badge count
                setSelectedDonorChoices({});
                
                showAlert(
                  `✅ First emergency resolved!\n\n🚨 However, ${emergencyCheck.emergencyCount} more emergency situation${emergencyCheck.emergencyCount > 1 ? 's remain' : ' remains'}. Please click "Emergency Coverage" button again to assign remaining coverage.`,
                  "More Emergencies Found"
                );
              } else {
                console.log(`✅ All emergencies resolved!`);
                setEmergencyCount(0); // Update badge count to 0
                showAlert("✅ All emergencies have been resolved! No more critical coverage gaps.", "All Clear");
              }
            } catch (recheckError) {
              console.error("Error re-checking emergencies:", recheckError);
            }
          }, 1500);
        } else {
          showAlert("✅ No emergency coverage activated.", "Information");
          setShowEmergencyModal(false);
          setEmergencyCount(0); // Update badge count to 0
        }
      }
      
    } catch (error) {
      console.error("Error executing emergency coverage:", error);
      showAlert("Failed to execute emergency coverage. Please try again.", "Error");
    }
  };

  const cancelEmergencyCoverage = () => {
    setShowEmergencyModal(false);
    setEmergencyOptions([]);
    setSelectedDonorChoices({});
  };

  // New Caregiver Integration functions
  const handleNewCaregiverIntegration = async () => {
    console.log(`%c🔧 TEST: Console logging is working! Button clicked.`, 'color: red; font-size: 14px; font-weight: bold;');
    try {
      // Refresh static data first to ensure we have latest caregiver info
      await loadStaticData();
      
      // Then detect unassigned caregivers
      const unassigned = await NewCaregiverService.detectUnassignedCaregivers();
      
      if (unassigned.length === 0) {
        showAlert("All caregivers are already assigned to the current schedule.", "No Unassigned Caregivers");
        return;
      }
      
      setUnassignedCaregivers(unassigned);
      setShowNewCaregiverModal(true);
      
    } catch (error) {
      console.error("Error detecting unassigned caregivers:", error);
      showAlert("Failed to check for unassigned caregivers. Please try again.", "Error");
    }
  };

  const handleCaregiverSelection = async (caregiverId) => {
    setSelectedNewCaregiver(caregiverId);
    setSelectedRecommendation(null); // Reset selected recommendation
    
    if (integrationMode === 'auto') {
      // Generate system recommendations
      try {
        const recommendations = await NewCaregiverService.generateCaregiverRecommendations(caregiverId, assignments, houses);
        setSystemRecommendations(recommendations);
      } catch (error) {
        console.error("Error generating recommendations:", error);
        showAlert("Failed to generate recommendations. Please try manual assignment.", "Error");
      }
    }
  };

  const executeNewCaregiverIntegration = async () => {
    if (!selectedNewCaregiver) {
      showAlert("Please select a caregiver first.", "No Caregiver Selected");
      return;
    }
    
    // Prevent double submission
    if (isIntegrating) {
      console.log("⚠️ Integration already in progress, ignoring duplicate request");
      return;
    }

    try {
      setIsIntegrating(true); // Start loading
      
      let assignmentData;
      
      if (integrationMode === 'auto') {
        if (!selectedRecommendation) {
          showAlert("Please select a system recommendation first.", "No Recommendation Selected");
          setIsIntegrating(false);
          return;
        }
        // Use the selected recommendation
        assignmentData = selectedRecommendation;
      } else if (integrationMode === 'manual') {
        // Validate manual assignment
        if (!manualAssignment.house || !manualAssignment.shift || manualAssignment.workDays.length === 0) {
          showAlert("Please complete all manual assignment fields (house, shift, and at least 1 work day).", "Incomplete Assignment");
          setIsIntegrating(false);
          return;
        }
        assignmentData = manualAssignment;
      } else {
        showAlert("Please select assignment options.", "No Assignment Data");
        setIsIntegrating(false);
        return;
      }

      // Execute the integration
      const result = await NewCaregiverService.integrateNewCaregiver(selectedNewCaregiver, assignmentData, assignments, elderlyAssigns, houses);
      
      if (result.success) {
        console.log(`✅ Integration successful: ${result.elderlyAssigned} elderly assigned to new caregiver, ${result.totalElderlyRedistributed} total redistributed`);
        console.log(`%c🎉 INTEGRATION COMPLETED SUCCESSFULLY!`, 'color: green; font-size: 16px; font-weight: bold;');
        console.log(`%cNew caregiver assignments: ${result.elderlyAssigned}`, 'color: green; font-weight: bold;');
        console.log(`%cTotal redistributed: ${result.totalElderlyRedistributed}`, 'color: blue; font-weight: bold;');
        
        // Log new caregiver integration activity
        const newCaregiverInfo = caregivers.find(c => c.user_id === selectedNewCaregiver);
        await logScheduleActivity("Caregiver Added to Schedule", {
          performed_by: currentAdminName || user?.email || "Admin User",
          description: `Integrated ${newCaregiverInfo?.user_fname || 'New'} ${newCaregiverInfo?.user_lname || 'Caregiver'} into schedule (${assignmentData.house}, ${assignmentData.shift} Shift, ${assignmentData.workDays.join(', ')})`,
          metadata: {
            caregiver_id: selectedNewCaregiver,
            caregiver_name: `${newCaregiverInfo?.user_fname} ${newCaregiverInfo?.user_lname}`,
            house: assignmentData.house,
            shift: assignmentData.shift,
            work_days: assignmentData.workDays,
            elderly_assigned: result.elderlyAssigned,
            total_redistributed: result.totalElderlyRedistributed,
            integration_mode: integrationMode
          }
        });
        
        // Optimized data refresh - run in parallel for faster loading
        console.log("🔄 Refreshing all schedule data after integration...");
        
        await Promise.all([
          loadStaticData(),
          loadAllAssignments(),
          loadAllElderlyAssigns()
        ]);
        
        console.log("✅ Data refresh completed after caregiver integration");
        
        showAlert(`Successfully integrated caregiver into the schedule!\n\nAssigned to: ${assignmentData.house}\nShift: ${assignmentData.shift}\nWork Days: ${assignmentData.workDays.join(', ')}\n\nTotal elderly redistributed: ${result.totalElderlyRedistributed}\nNew caregiver assigned: ${result.elderlyAssigned} elderly`, "Integration Successful");
        
        // Reset modal state
        setShowNewCaregiverModal(false);
        setSelectedNewCaregiver(null);
        setIntegrationMode('auto');
        setManualAssignment({ house: '', shift: '', workDays: [] });
        setSystemRecommendations([]);
        setSelectedRecommendation(null);
        
      } else {
        showAlert(result.message || "Failed to integrate caregiver.", "Integration Failed");
      }
      
    } catch (error) {
      console.error("Error integrating new caregiver:", error);
      showAlert("Failed to integrate caregiver. Please try again.", "Error");
    } finally {
      setIsIntegrating(false); // Stop loading
    }
  };

  const cancelNewCaregiverIntegration = () => {
    setShowNewCaregiverModal(false);
    setSelectedNewCaregiver(null);
    setIntegrationMode('auto');
    setManualAssignment({ house: '', shift: '', workDays: [] });
    setSystemRecommendations([]);
    setSelectedRecommendation(null);
    setUnassignedCaregivers([]);
  };

  // Handle PDF export
  const handleExportPDF = async () => {
    try {
      if (!scheduleInfo || !scheduleInfo.start || !scheduleInfo.end) {
        showAlert("No schedule available to export. Please generate a schedule first.", "No Schedule");
        return;
      }

      console.log("📄 Preparing to export schedule to PDF...");
      
      await exportScheduleToPDF({
        scheduleInfo,
        assignments: assignments.filter(a => a.is_current), // Only export current assignments
        elderlyAssigns,
        caregivers,
        houses,
        elderlyList,
        shiftDefs,
        daysOfWeek,
        currentVersion
      });
      
      // PDF downloads silently - no success alert needed
      console.log("✅ PDF export completed successfully");
    } catch (error) {
      console.error("PDF export error:", error);
      showAlert(`Failed to export PDF: ${error.message}\n\nPlease try again or contact support if the issue persists.`, "Export Failed");
    }
  };

  const closeSuccess = () => setShowSuccess(false);
  const cancelGenerate = () => setShowOverlay(false);

  // --- Absent handling - now uses API service ---
  const markAbsent = async (assignDocId) => {
    // Store the assignment and show confirmation popup
    const assignment = assignments.find(a => a.id === assignDocId);
    if (assignment) {
      setPendingAbsentAssignment({ assignDocId, assignment });
      setShowAbsentConfirm(true);
    }
  };

  const confirmMarkAbsent = async () => {
    if (!pendingAbsentAssignment) return;
    
    try {
      const selectedDateStr = formatDateString(selectedDate);
      const dayName = daysOfWeek[selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1];
      
      console.log(`Marking absent for exact date: ${selectedDateStr} (${dayName})`);
      
      // Use new emergency coverage function
      const result = await AbsenceService.markCaregiverAbsentWithEmergencyCheck(
        pendingAbsentAssignment.assignDocId, 
        assignments, 
        elderlyAssigns, 
        tempReassigns,
        selectedDateStr,
        dayName
      );
      
      if (result.success) {
        // Refresh data after marking absent
        await loadAllAssignments();
        await loadAllElderlyAssigns();
        await loadTempReassigns();
        
        // Log absence marking activity
        const caregiverInfo = caregivers.find(c => c.user_id === pendingAbsentAssignment.userId);
        await logScheduleActivity("Caregiver Marked Absent", {
          performed_by: currentAdminName || user?.email || "Admin User",
          description: `Marked ${caregiverInfo?.user_fname || 'Caregiver'} ${caregiverInfo?.user_lname || ''} as absent on ${dayName}, ${selectedDateStr} (${pendingAbsentAssignment.shift} Shift, ${pendingAbsentAssignment.houseId})`,
          metadata: {
            caregiver_id: pendingAbsentAssignment.userId,
            caregiver_name: `${caregiverInfo?.user_fname} ${caregiverInfo?.user_lname}`,
            date: selectedDateStr,
            day: dayName,
            shift: pendingAbsentAssignment.shift,
            house_id: pendingAbsentAssignment.houseId,
            marked_by_type: "manual"
          }
        });
        
        // Check if emergency coverage is needed and notify admin (but don't auto-show modal)
        if (result.emergencyCheck && result.emergencyCheck.hasEmergency) {
          console.log(`🚨 Emergency coverage needed after marking absence! Badge will be updated.`);
          
          // Update emergency count (badge notification)
          setEmergencyCount(result.emergencyCheck.emergencyCount);
          
          // Show an alert about the emergency - admin can click Emergency Coverage button to handle it
          showAlert(
            `✅ Caregiver marked as absent successfully.\n\n🚨 NOTICE: Emergency coverage is now required for ${result.emergencyCheck.emergencyCount} house/shift(s).\n\nPlease click the "Emergency Coverage" button to assign coverage.`, 
            "Absence Marked - Emergency Detected"
          );
        } else {
          // No emergency coverage needed
          showAlert("✅ Caregiver marked as absent successfully.", "Success");
        }
      }
    } catch (error) {
      console.error("Error marking caregiver absent:", error);
      showAlert("Failed to mark caregiver as absent. Please try again.", "Error");
    } finally {
      setShowAbsentConfirm(false);
      setPendingAbsentAssignment(null);
    }
  };

  const cancelMarkAbsent = () => {
    setShowAbsentConfirm(false);
    setPendingAbsentAssignment(null);
  };

  // --- Unmark absent (UNDO) ---
  const unmarkAbsent = async (userId, shift, houseId, userType = "caregiver") => {
    try {
      const targetDateStr = formatDateString(selectedDate);
      
      console.log(`🔄 Unmarking ${userType} as absent:`, {
        userId,
        shift,
        houseId,
        date: targetDateStr
      });

      // Set undo flag to prevent emergency detection during the operation
      undoInProgress.current = true;
      console.log('🔒 Undo operation started - emergency detection paused');

      const result = await AbsenceService.unmarkAbsent(
        userId,
        targetDateStr,
        shift,
        houseId,
        userType
      );

      if (result.success) {
        console.log(`\n%c━━━ RELOADING ASSIGNMENTS ━━━`, 'color: #00FFFF; font-weight: bold; font-size: 14px');
        
        // Construct detailed success message based on redistribution status
        let message = `Successfully unmarked ${userType} as absent.`;
        
        if (result.stillAbsentCount > 0) {
          message += `\n\n⚠️ ${result.stillAbsentCount} other caregiver(s) still absent in ${houseId} ${shift} shift.`;
          message += `\n\n🔄 Elderly have been redistributed among available caregivers.`;
        } else {
          message += `\n\n✅ All caregivers are now present. Original assignments have been restored.`;
        }
        
        if (result.emergencyCoverageRemoved) {
          message += `\n\n🚨 Emergency coverage has been removed for ${houseId} ${shift} shift.`;
        }
        
        if (result.deletedTempAssignments > 0) {
          message += `\n\n📋 ${result.deletedTempAssignments} temporary assignment(s) have been removed.`;
        }

        // IMPORTANT: Reload ALL data BEFORE re-enabling emergency detection
        // This ensures the UI reflects the changes and prevents emergency modal from showing
        console.log(`\n%c━━━ RELOADING ASSIGNMENTS ━━━`, 'color: #00FF00; font-weight: bold; font-size: 14px');
        await loadAllAssignments();
        await loadAllElderlyAssigns();
        await loadTempReassigns();
        
        // Force refresh emergency coverage count to reflect the new state
        console.log(`🔄 Refreshing emergency coverage status after undo...`);
        const selectedDateStr = formatDateString(selectedDate);
        try {
          const emergencyCheck = await EmergencyService.checkEmergencyNeedsAndDonors(
            selectedDateStr,
            assignments,
            elderlyAssigns,
            tempReassigns
          );
          setEmergencyCount(emergencyCheck.emergencyCount || 0);
          console.log(`✅ Emergency count updated: ${emergencyCheck.emergencyCount || 0}`);
        } catch (emerError) {
          console.warn("Warning: Could not refresh emergency count after undo:", emerError);
          setEmergencyCount(0); // Reset to 0 on error
        }
        
        // Success - real-time listener will automatically update absences array
        console.log(`\n%c✅ UNDO COMPLETE - All data refreshed successfully`, 'color: #00FF00; font-weight: bold; font-size: 14px');

        // Re-enable emergency detection AFTER data is reloaded and emergency count is refreshed
        // This allows the emergency check to run with fresh data
        setTimeout(() => {
          undoInProgress.current = false;
          console.log('🔓 Undo operation complete - emergency detection resumed');
        }, 1000);

        // Log the undo action
        await logScheduleActivity("Caregiver Absence Unmarked (UNDO)", {
          description: `Unmarked caregiver absence for ${userId} on ${targetDateStr} (${shift} Shift) - restored original assignments`,
          metadata: {
            caregiver_id: userId,
            date: targetDateStr,
            shift: shift,
            house_id: houseId,
            deleted_temp_assignments: result.deletedTempAssignments,
            emergency_coverage_removed: result.emergencyCoverageRemoved,
            still_absent_count: result.stillAbsentCount
          }
        });

        // Now show the success message
        showAlert(message, "Absence Unmarked");
      } else {
        // If undo failed, re-enable emergency detection
        undoInProgress.current = false;
        console.log('🔓 Undo operation failed - emergency detection resumed');
        showAlert(result.message, "Error");
      }

    } catch (error) {
      console.error("Error unmarking absent:", error);
      // Re-enable emergency detection on error
      undoInProgress.current = false;
      console.log('🔓 Undo operation error - emergency detection resumed');
      showAlert(
        `Failed to unmark absence: ${error.message}`,
        "Error"
      );
    }
  };

  // --- Reset outdated absences (from previous days only) on component mount ---
  // useEffect(() => {
  //   const resetOutdatedAbsences = async () => {
  //     try {
  //       console.log("🔄 Schedule component mounted - checking for outdated absences...");
  //       const result = await AbsenceService.resetDailyAbsences();
  //       console.log("📋 Reset result:", result);
  //       await loadAllAssignments();
  //     } catch (error) {
  //       console.error("Error resetting outdated absences:", error);
  //     }
  //   };

  //   resetOutdatedAbsences();
  // }, []);

  const getDisplayedEldersFor = (caregiverId) => {
  const selectedDateStr = formatDateString(selectedDate);
  
  // Use the selected date from date picker to determine the day
  const dayName = daysOfWeek[selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1];
  
  console.log(`=== DISPLAYING ELDERLY FOR CAREGIVER ${caregiverId} ===`);
  console.log(`Selected date: ${selectedDateStr} (${dayName}), Current version: ${currentVersion}`);
  
  // First, check if this caregiver is marked as absent for this specific date
  const isAbsentForThisDate = isCaregiverAbsent(caregiverId, selectedDateStr, absences);
  
  if (isAbsentForThisDate) {
    console.log(`Caregiver ${caregiverId} is marked ABSENT for ${selectedDateStr} - showing no elderly assignments`);
    return []; // Return empty array - all elderly should be reassigned to others
  }
  
  const base = elderlyAssigns
    .filter(
      (ea) =>
        ea.user_id === caregiverId &&
        ea.assign_version === currentVersion &&
        ea.day?.toLowerCase() === dayName.toLowerCase()
    )
    .flatMap((ea) => ea.elderly_ids || []); // Handle array structure
  
  console.log(`Base assignments for ${caregiverId} on ${dayName}: ${base.length}`, base);

  // Get relevant dates for the current shift (handles 3rd shift crossing midnight)
  const relevantDates = getRelevantDatesForShift(selectedDateStr, activeShift);
  console.log(`Relevant dates for ${activeShift} shift: ${relevantDates.join(', ')}`);

  const toTemp = tempReassigns
    .filter(
      (t) =>
        t.to_user_id === caregiverId &&
        relevantDates.includes(t.date) && // Check if temp reassignment date is in relevant dates
        t.assign_version === currentVersion
    )
    .flatMap((t) => t.elderly_ids || []); // Handle array structure
    
  console.log(`Temp assignments TO ${caregiverId} for ${selectedDateStr}: ${toTemp.length}`, toTemp);

  const fromTemp = tempReassigns
    .filter(
      (t) =>
        t.from_user_id === caregiverId &&
        relevantDates.includes(t.date) && // Check if temp reassignment date is in relevant dates
        t.assign_version === currentVersion
    )
    .flatMap((t) => t.elderly_ids || []); // Handle array structure
    
  console.log(`Temp assignments FROM ${caregiverId} for ${selectedDateStr}: ${fromTemp.length}`, fromTemp);

  const finalIds = [...new Set(base.filter((id) => !fromTemp.includes(id)).concat(toTemp))]; // Remove duplicates
  console.log(`Final elderly IDs for ${caregiverId}: ${finalIds.length}`, finalIds);
  
  const elders = finalIds
    .map((id) => {
      const elderly = elderlyList.find((e) => e.id === id);
      if (!elderly) {
        console.warn(`⚠️ Elderly not found: ${id}. Available elderly:`, 
          elderlyList.slice(0, 3).map(e => ({ id: e.id, name: `${e.elderly_fname} ${e.elderly_lname}` }))
        );
        return { id: id, elderly_fname: "Unknown", elderly_lname: `(${id.substring(0, 8)}...)` };
      }
      return elderly;
    })
    .filter(Boolean);

  console.log(`Final elderly objects for ${caregiverId}:`, elders.map(e => `${e.elderly_fname} ${e.elderly_lname}`));
  console.log(`=== END DISPLAY DEBUG ===`);
  
  return elders;
};

  // Get emergency coverage assignments for display
  const getEmergencyCoverageAssignments = () => {
    const selectedDateStr = formatDateString(selectedDate);
    const dayName = daysOfWeek[selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1];
    
    // Get relevant dates for the current shift (handles 3rd shift crossing midnight)
    const relevantDates = getRelevantDatesForShift(selectedDateStr, activeShift);
    
    // Find emergency coverage temp assignments
    const emergencyTempAssigns = tempReassigns.filter(tr => 
      relevantDates.includes(tr.date) && // Use relevant dates instead of exact match
      tr.from_user_id === "EMERGENCY_ABSENT"
    );
    
    // Group by caregiver to create virtual assignments
    const emergencyAssignments = [];
    const emergencyCaregivers = new Set();
    
    emergencyTempAssigns.forEach(ta => {
      emergencyCaregivers.add(ta.to_user_id);
    });
    
    // For each emergency caregiver, find which house/shift they're covering
    emergencyCaregivers.forEach(caregiverId => {
      // Get the first emergency temp assignment to parse the reason
      const firstEmergencyAssign = emergencyTempAssigns.find(ta => ta.to_user_id === caregiverId);
      
      if (firstEmergencyAssign) {
        let emergencyHouseId, emergencyShift;
        
        // Try to get from dedicated fields first
        if (firstEmergencyAssign.emergency_house) {
          emergencyHouseId = firstEmergencyAssign.emergency_house;
        }
        
        if (firstEmergencyAssign.emergency_shift) {
          emergencyShift = firstEmergencyAssign.emergency_shift;
        }
        
        // If not available, parse from reason (for backward compatibility)
        if (!emergencyHouseId || !emergencyShift) {
          const reasonMatch = firstEmergencyAssign.reason?.match(/Emergency coverage for (\w+) (\w+) shift/i);
          if (reasonMatch) {
            emergencyHouseId = emergencyHouseId || reasonMatch[1];
            emergencyShift = emergencyShift || reasonMatch[2];
          }
        }
        
        // Last resort: find absent caregiver in emergency house for this date to get shift
        if (!emergencyShift && emergencyHouseId) {
          const selectedDateStr = formatDateString(selectedDate);
          const absentInEmergencyHouse = assignments.find(a => 
            a.house_id === emergencyHouseId && 
            a.is_current &&
            a.is_absent && 
            a.absent_for_date === selectedDateStr &&
            (a.days_assigned || []).map(d => d.toLowerCase()).includes(dayName.toLowerCase())
          );
          emergencyShift = absentInEmergencyHouse?.shift || "1st"; // Default fallback
        }
        
        if (emergencyHouseId && emergencyShift) {
          
          console.log(`🚨 Emergency caregiver ${caregiverId} should appear in ${emergencyHouseId} ${emergencyShift} shift`);
          
          // Find the shift times by looking at any assignment with this shift
          const referenceAssignment = assignments.find(a => a.shift === emergencyShift && a.is_current);
          const startTime = referenceAssignment?.start_time || "06:00";
          const endTime = referenceAssignment?.end_time || "14:00";
          
          // Create a virtual assignment for the emergency caregiver in the emergency house/shift
          emergencyAssignments.push({
            id: `emergency_${caregiverId}_${emergencyHouseId}_${emergencyShift}`,
            user_id: caregiverId,
            house_id: emergencyHouseId,
            shift: emergencyShift,
            days_assigned: [dayName],
            is_current: true,
            is_emergency_coverage: true,
            start_time: startTime,
            end_time: endTime,
            version: currentVersion
          });
        } else {
          console.error(`Could not parse emergency coverage reason: ${firstEmergencyAssign.reason}`);
        }
      }
    });
    
    console.log(`📋 Created ${emergencyAssignments.length} emergency coverage virtual assignments`);
    return emergencyAssignments;
  };

  const filteredAssignments = (() => {
    const selectedDateStr = formatDateString(selectedDate);
    const dayName = daysOfWeek[selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1];
    
    // Get emergency coverage caregivers for this date
    const emergencyCaregivers = tempReassigns
      .filter(tr => tr.date === selectedDateStr && tr.from_user_id === "EMERGENCY_ABSENT")
      .map(tr => tr.to_user_id);
    
    console.log(`🚨 Emergency caregivers for ${selectedDateStr}:`, emergencyCaregivers);
    
    // Filter regular assignments
    const regularAssignments = assignments.filter((a) => {
      if (viewMode === "current" && !a.is_current) return false;
      if (viewMode === "previous" && a.is_current) return false;
      if (activeHouseId && a.house_id !== activeHouseId) return false;
      if (activeShift && a.shift !== activeShift) return false;
      
      if (!(a.days_assigned || []).map(d => d.toLowerCase()).includes(dayName.toLowerCase())) return false;
      
      // EXCLUDE caregivers who are providing emergency coverage (they'll appear in the emergency house)
      if (emergencyCaregivers.includes(a.user_id)) {
        console.log(`❌ EXCLUDING emergency caregiver ${a.user_id} from their original house ${a.house_id} ${a.shift}`);
        return false;
      }
      
      return true;
    });
    
    // Add emergency coverage assignments
    const emergencyAssignments = getEmergencyCoverageAssignments().filter(ea => {
      if (activeHouseId && ea.house_id !== activeHouseId) return false;
      if (activeShift && ea.shift !== activeShift) return false;
      return true;
    });
    
    console.log(`📊 Final assignments: ${regularAssignments.length} regular + ${emergencyAssignments.length} emergency`);
    console.log("🚨 Emergency assignments:", emergencyAssignments);
    
    return [...regularAssignments, ...emergencyAssignments];
  })();

  const deleteCollection = async (collectionName) => {
    const snap = await getDocs(collection(db, collectionName));
    const batch = writeBatch(db);

    snap.docs.forEach((docSnap) => {
      batch.delete(doc(db, collectionName, docSnap.id));
    });

    await batch.commit();
    console.log(`${collectionName} cleared`);
  };

  const handleClearSchedule = async () => {
    if (!window.confirm("Are you sure you want to clear the generated schedule? This will delete all assignments in the database...")) return;

    try {
      const result = await ScheduleService.clearSchedule();
      if (result.success) {
        showAlert("Schedule cleared successfully!", "Success");
        // reload state so UI updates
        await loadAllAssignments();
        await loadAllElderlyAssigns();
        await loadTempReassigns();
      } else {
        showAlert(`Failed to clear schedule: ${result.message}`, "Error");
      }
    } catch (error) {
      console.error("Error clearing schedule:", error);
      showAlert(`Failed to clear schedule: ${error.message || "Unknown error occurred"}`, "Error");
    }
  };

  const handleCleanupOrphanedAssignments = async () => {
    if (!window.confirm("This will remove assignments for caregivers/elderly that no longer exist in the system. Are you sure?")) return;

    try {
      // Clean up both caregiver and elderly assignments
      const [caregiverResult, elderlyResult] = await Promise.all([
        ScheduleService.findOrphanedAssignments(true),
        ScheduleService.findOrphanedElderlyAssignments(true)
      ]);
      
      const totalCleaned = caregiverResult.count + elderlyResult.count;
      
      if (totalCleaned > 0) {
        showAlert(
          `Successfully cleaned up:\n• ${caregiverResult.count} orphaned caregiver assignment(s)\n• ${elderlyResult.count} orphaned elderly assignment(s)\n\nThe "Unknown" entries should now be gone.`, 
          "Cleanup Complete"
        );
        // Reload data to reflect changes
        await loadStaticData();
        await loadAllAssignments();
        await loadAllElderlyAssigns();
      } else {
        showAlert("No orphaned assignments found. All assignments have valid caregivers and elderly.", "Nothing to Clean");
      }
    } catch (error) {
      console.error("Error cleaning up orphaned assignments:", error);
      showAlert(`Failed to clean up assignments: ${error.message || "Unknown error occurred"}`, "Error");
    }
  };

  const handleDatabaseMaintenance = async () => {
    if (!window.confirm(
      "This will remove old inactive records older than 90 days from the database.\n\n" +
      "This includes:\n" +
      "• Old inactive house assignments\n" +
      "• Old inactive elderly assignments\n" +
      "• Expired temporary assignments\n" +
      "• Old absence records\n\n" +
      "Current schedules and recent data will NOT be affected.\n\n" +
      "Continue with database maintenance?"
    )) return;

    try {
      setIsGenerating(true); // Use loading spinner
      const result = await ScheduleService.cleanupOldScheduleData(90); // Keep last 90 days
      
      if (result.success) {
        showAlert(
          `Database maintenance completed successfully!\n\n` +
          `Records removed:\n` +
          `• Old house assignments: ${result.details.houseAssignments}\n` +
          `• Old elderly assignments: ${result.details.elderlyAssignments}\n` +
          `• Old temporary assignments: ${result.details.tempAssignments}\n` +
          `• Old absence records: ${result.details.absences}\n\n` +
          `Total cleaned: ${Object.values(result.details).reduce((a, b) => a + b, 0)} records`,
          "✅ Maintenance Complete"
        );
      } else {
        showAlert(result.message, "Maintenance Failed");
      }
    } catch (error) {
      console.error("Error during database maintenance:", error);
      showAlert(`Database maintenance failed: ${error.message || "Unknown error occurred"}`, "Error");
    } finally {
      setIsGenerating(false);
    }
  };

  // Sort houses by house_id (H001 to H005)
  const sortedHouses = [...houses].sort((a, b) => {
    // Extract numeric part for comparison
    const numA = parseInt(a.house_id.replace(/\D/g, ""), 10);
    const numB = parseInt(b.house_id.replace(/\D/g, ""), 10);
    return numA - numB;
  });

  return (
    <div className="schedule-page">

      <Navbar /> {/* Always on top */}
    <main className="schedule-container">

      <h1 className="page-title">Caregiver Scheduling</h1>

      <div className="toggle-header">
        <div className="toggle-buttons">
          {/* <button
            className={`toggle-btn ${viewMode === "current" ? "active" : ""}`}
          > 
            Current Schedule
          </button>
          <button
            onClick={() => { setViewMode("previous"); }}
            className={`toggle-btn schedule-history-btn ${viewMode === "previous" ? "active" : ""}`}
          >
            Caregiver Schedule History
          </button> */}
        </div>

        {scheduleInfo && (
          <div className="schedule-inline">
            <span>
              <strong>Schedule:</strong>{" "}
              {scheduleInfo.start?.toLocaleDateString()} → {scheduleInfo.end?.toLocaleDateString()}
            </span>
            <span>
              <strong>Days Left:</strong> {daysLeft} {daysLeft === 1 ? "day" : "days"}
            </span>
          </div>
        )}
      </div>

      <div className="control-panel">
        <button onClick={handleGenerateClick} title="Generate a new caregiver schedule for the selected period">Generate Schedule</button>
        <button onClick={handleClearSchedule} className="clear-schedule-btn" title="Delete all current caregiver schedules and assignments">Clear Schedule</button>
        {/* <button onClick={handleCleanupOrphanedAssignments} className="cleanup-btn">🧹 Fix Unknown</button> */}
        {/* <button onClick={handleDatabaseMaintenance} className="db-maintenance-btn">🗑️ Database Cleanup</button> */}
        <button 
          onClick={handleEmergencyCoverage} 
          className="emergency-coverage-btn"
          disabled={!scheduleInfo}
          title="Handle emergency situations by temporarily reassigning caregivers between houses"
        >
          🚨 Emergency Coverage
          {scheduleInfo && emergencyCount > 0 && (
            <span className="notification-badge">{emergencyCount}</span>
          )}
        </button>
        <button 
          onClick={handleNewCaregiverIntegration} 
          className="integration-btn"
          title="Integrate newly registered caregivers into the current schedule"
        >
          👥 Add Caregiver
          {unassignedCount > 0 && (
            <span className="notification-badge">{unassignedCount}</span>
          )}
        </button>
        <button onClick={handleExportPDF} className="export-pdf-btn" disabled={!scheduleInfo} title="Export the current schedule to PDF for printing or sharing">📄 Download Schedule</button>
        <button 
          onClick={() => setShowActivityLog(!showActivityLog)} 
          className="activity-log-btn"
          title="View schedule activity history and changes"
        >
          📋 Activity Log
          {activityLogs.length > 0 && (
            <span className="notification-badge">{activityLogs.length}</span>
          )}
        </button>
      </div>

      {/* Search Bar */}
      <div className="search-panel">
        <div className="search-input-wrapper">
          <input
            type="text"
            placeholder="🔍 Search caregiver by name..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="caregiver-search-input"
          />
          {searchQuery && (
            <button onClick={clearSearch} className="clear-search-btn" title="Clear search query">
              ✕
            </button>
          )}
        </div>
        
        <SearchResultsDropdown
          isOpen={showSearchResults}
          searchQuery={searchQuery}
          searchResults={searchResults}
          onNavigate={navigateToCaregiver}
        />
      </div>

      {showOverlay && (
        <div className="overlay">
          <div className="overlay-content">
            <p>Are you sure you want to generate schedule for {pendingDuration} month(s)?</p>
            <button onClick={confirmGenerate} title="Confirm and proceed with schedule generation">Yes, Generate</button>
            <button onClick={cancelGenerate} title="Cancel schedule generation">Cancel</button>
          </div>
        </div>
      )}

      {isGenerating && (
        <div className="popup-overlay">
          <div className="popup-card">
            <div className="loading-spinner"></div>
            <p>Generating Schedule... Please wait</p>
          </div>
        </div>
      )}

      {showSuccess && (
        <div className="overlay">
          <div className="overlay-content">
            <p>Generation of Schedule is <b>Successful!</b></p>
            <button onClick={closeSuccess} title="Close this notification">OK</button>
          </div>
        </div>
      )}

      <div className="house-tabs">
        {sortedHouses.map((h) => (
          <button key={h.house_id} className={`house-tab ${activeHouseId === h.house_id ? "active" : ""}`} onClick={() => setActiveHouseId(h.house_id)} title={`View caregivers assigned to ${h.house_name}`}>
            {h.house_name}
          </button>
        ))}
      </div>

      <div className="table-container">
        <div className="table-header">
          <div className="shift-tabs">
            {shiftDefs.map((s) => (
              <button key={s.key} className={`shift-tab ${activeShift === s.key ? "active-shift" : ""}`} onClick={() => setActiveShift(s.key)} title={`View caregivers working ${s.name}`}>{s.name}</button>
            ))}
          </div>
          
          {/* ========== DAYS OF WEEK TABS - COMMENT OUT THIS SECTION TO REMOVE ========== */}
          <div className="day-tabs">
            {daysOfWeek.map((day) => (
              <button
                key={day}
                className={`day-tab ${activeDay === day ? "active-day" : ""}`}
                onClick={() => {
                  console.log(`\n📅 ========== DAY TAB CLICKED: ${day} ==========`);
                  setActiveDay(day);
                  // Update the date picker to show a date that matches this day
                  const currentDate = new Date(selectedDate);
                  const currentDayIndex = currentDate.getDay() === 0 ? 6 : currentDate.getDay() - 1;
                  const targetDayIndex = daysOfWeek.indexOf(day);
                  const dayDiff = targetDayIndex - currentDayIndex;
                  
                  const newDate = new Date(currentDate);
                  newDate.setDate(currentDate.getDate() + dayDiff);
                  setSelectedDate(newDate);
                  
                  // Log all elderly assignments for this day and shift
                  console.log(`🏠 House: ${activeHouseId || 'All Houses'}, Shift: ${activeShift}, Day: ${day}`);
                  
                  const relevantElderlyAssignments = elderlyAssigns.filter(ea => 
                    ea.day === day && 
                    ea.shift === activeShift &&
                    ea.user_type === "caregiver"
                  );
                  
                  console.log(`📋 Found ${relevantElderlyAssignments.length} elderly assignment(s) for ${day}:`);
                  relevantElderlyAssignments.forEach((ea, index) => {
                    const caregiver = caregivers.find(c => c.id === ea.user_id);
                    const caregiverFullName = caregiver ? `${caregiver.user_fname} ${caregiver.user_lname}` : `Unknown (${ea.user_id})`;
                    
                    console.log(`  ${index + 1}. 👤 Caregiver: ${caregiverFullName}`);
                    console.log(`     🆔 Assignment ID: ${ea.id}`);
                    console.log(`     👵 Elderly Count: ${ea.elderly_ids?.length || 0}`);
                    console.log(`     📍 House: ${ea.house_id || 'N/A'}`);
                    console.log(`     ⏰ Shift: ${ea.shift}`);
                    console.log(`     📆 Day: ${ea.day}`);
                  });
                  
                  console.log(`========================================\n`);
                }}
              >
                {day.slice(0, 3)}
              </button>
            ))}
          </div>
          {/* ========== END DAYS OF WEEK TABS SECTION ========== */}
          
          <div className="date-picker-top-right">
            <label htmlFor="date-picker" className="date-picker-label">
              Select Date:
            </label>
            <input
              id="date-picker"
              type="date"
              className="date-picker-input"
              value={formatDateString(selectedDate)}
              min={scheduleInfo?.start ? formatDateString(scheduleInfo.start) : undefined}
              max={scheduleInfo?.end ? formatDateString(scheduleInfo.end) : undefined}
              onChange={(e) => {
                // Create date in local timezone to avoid timezone issues
                const dateParts = e.target.value.split('-');
                const year = parseInt(dateParts[0]);
                const month = parseInt(dateParts[1]) - 1; // Month is 0-indexed
                const day = parseInt(dateParts[2]);
                const newDate = new Date(year, month, day);
                setSelectedDate(newDate);
                
                // Sync the day tabs with the selected date
                const dayName = daysOfWeek[newDate.getDay() === 0 ? 6 : newDate.getDay() - 1];
                setActiveDay(dayName);
              }}
            />
          </div>
        </div>

        <table className="schedule-table">
          <thead>
            <tr>
              <th>Caregiver Name</th>
              <th>Work Days</th>
              <th>Elderly Assigned</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredAssignments.map((a) => {
              const selectedDateStr = formatDateString(selectedDate);
              
              // Use the selected date from date picker to determine the day
              const dayName = daysOfWeek[selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1];
              
              // Check absence status using centralized collection with detailed info
              const absenceDetails = getCaregiverAbsenceDetails(a.user_id, selectedDateStr, absences);
              const isAbsent = absenceDetails.isAbsent;
              const isOnLeave = absenceDetails.type === "on_leave";
              
              // Check if providing emergency coverage
              const isEmergency = isProvidingEmergencyCoverage(a.user_id, selectedDateStr, tempReassigns);
              const emergencyDetails = isEmergency ? getEmergencyCoverageDetails(a.user_id, selectedDateStr, tempReassigns) : null;
              
              // Debug logging for absent status
              if (isAbsent) {
                console.log(`ABSENT CHECK - ${caregiverName(a.user_id, caregivers)}:`, {
                  caregiverId: a.user_id,
                  selectedDateStr: selectedDateStr,
                  isAbsent: isAbsent,
                  assignmentId: a.id,
                  className: "absent-row"
                });
              }
              
              let elders = getDisplayedEldersFor(a.user_id);
              elders = elders.slice().sort((e1, e2) => {
                const n1 = `${e1.elderly_fname} ${e1.elderly_lname}`.toLowerCase();
                const n2 = `${e2.elderly_fname} ${e2.elderly_lname}`.toLowerCase();
                return n1.localeCompare(n2);
              });
              
              // Determine row styling - priority: on leave > absent > emergency > normal
              let rowClassName = "";
              if (isOnLeave) {
                rowClassName = "on-leave-row";
              } else if (isAbsent) {
                rowClassName = "absent-row";
              } else if (isEmergency) {
                rowClassName = "emergency-row";
              }
              
              // Find the elderly assignment ID for this caregiver on this day
              const elderlyAssignment = elderlyAssigns.find(ea => 
                ea.user_id === a.user_id && 
                ea.day === dayName && 
                ea.shift === activeShift &&
                ea.user_type === "caregiver"
              );
              
              console.log(`ROW RENDER - ${caregiverName(a.user_id, caregivers)} (Assignment ID: ${a.id}): className="${rowClassName}", isAbsent=${isAbsent}, isEmergency=${isEmergency}, Elderly Assignment ID: ${elderlyAssignment?.id || 'N/A'}`);
              
              return (
                <tr key={a.id} className={rowClassName}>
                  <td>
                    {isEmergency && <span className="emergency-badge">🚨</span>}
                    {caregiverName(a.user_id, caregivers)}
                  </td>
                  <td>{(a.days_assigned || []).slice().sort((d1, d2) => daysOfWeek.indexOf(d1) - daysOfWeek.indexOf(d2)).join(", ")}</td>
                  <td>
                    {(() => {
                      const isExpanded = expandedElderlyLists.has(a.id);
                      const displayedElders = isExpanded ? elders : elders.slice(0, 3);
                      const hasMore = elders.length > 3;
                      
                      return (
                        <div className={`elderly-list-container ${!isExpanded ? 'expanded-full' : ''}`}>
                          {displayedElders.map((e, idx) => (
                            <div key={idx} className="elderly-name-item">
                              {`${e.elderly_fname} ${e.elderly_lname}`}
                            </div>
                          ))}
                          {hasMore && !isExpanded && (
                            <div 
                              className="elderly-view-more-btn" 
                              onClick={() => setExpandedElderlyLists(prev => new Set([...prev, a.id]))}
                            >
                              View More ({elders.length - 3} more)
                            </div>
                          )}
                          {isExpanded && hasMore && (
                            <div 
                              className="elderly-view-more-btn" 
                              onClick={() => setExpandedElderlyLists(prev => {
                                const newSet = new Set(prev);
                                newSet.delete(a.id);
                                return newSet;
                              })}
                            >
                              View Less
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td>
                    {isOnLeave ? (
                      <span className="on-leave-text">
                        🏖️ On Leave on {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}<br/>
                        {absenceDetails.reason && (
                          <small className="leave-notice">
                            {absenceDetails.reason}
                          </small>
                        )}
                      </span>
                    ) : isAbsent ? (
                      <button 
                        onClick={() => unmarkAbsent(a.user_id, a.shift, a.house_id, "caregiver")} 
                        className="unabsent-btn"
                        title="Undo this caregiver's absence and restore their original elderly assignments"
                      >
                        ↩️ Undo Absent
                      </button>
                    ) : isEmergency ? (
                      <span className="leave-warning">
                        🚨 Emergency Coverage<br/>
                        <small>
                          {emergencyDetails.originalHouse && emergencyDetails.emergencyHouse 
                            ? `Moved from ${emergencyDetails.originalHouse} to cover ${emergencyDetails.emergencyHouse}`
                            : emergencyDetails.reason}
                        </small>
                      </span>
                    ) : (
                      <button onClick={() => markAbsent(a.id)} className="absent-btn" title="Mark this caregiver as absent and redistribute their elderly to other caregivers">
                        Mark Absent for {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Activity Log Section */}
        {showActivityLog && (
          <div className="activity-log-section">
            <h2>Schedule Activity Log</h2>
            {activityLogs.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#6c757d', padding: '20px' }}>
                No activity logs recorded yet.
              </p>
            ) : (
              <div className="activity-timeline">
                {activityLogs.map((log, index) => {
                  // Format timestamp
                  let timestampStr = 'Unknown time';
                  if (log.timestamp) {
                    try {
                      const date = log.timestamp.toDate ? log.timestamp.toDate() : new Date(log.timestamp);
                      timestampStr = date.toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      });
                    } catch (e) {
                      console.error('Error formatting timestamp:', e);
                    }
                  }

                  return (
                    <div key={log.id || index} className="activity-item">
                      <div className="activity-header">
                        <span className="activity-admin">{log.performed_by || 'Unknown'}</span>
                        <span className="activity-time">{timestampStr}</span>
                      </div>
                      <div className="activity-action">
                        <strong>{log.action}</strong>
                      </div>
                      {log.details && (
                        <div className="activity-details">{log.details}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      </main>

      {/* Confirmation Popup */}
      <ConfirmationModal
        isOpen={showAbsentConfirm && !!pendingAbsentAssignment}
        caregiverName={pendingAbsentAssignment ? caregiverName(pendingAbsentAssignment.assignment.user_id, caregivers) : ''}
        onConfirm={confirmMarkAbsent}
        onCancel={cancelMarkAbsent}
      />

      {/* Emergency Coverage Modal */}
      <EmergencyCoverageModal
        isOpen={showEmergencyModal}
        emergencyOptions={emergencyOptions}
        selectedDonorChoices={selectedDonorChoices}
        setSelectedDonorChoices={setSelectedDonorChoices}
        caregiverName={(id) => caregiverName(id, caregivers)}
        onExecute={executeEmergencyCoverage}
        onCancel={cancelEmergencyCoverage}
      />

      {/* New Caregiver Integration Modal */}
      <NewCaregiverModal
        isOpen={showNewCaregiverModal}
        unassignedCaregivers={unassignedCaregivers}
        selectedNewCaregiver={selectedNewCaregiver}
        handleCaregiverSelection={handleCaregiverSelection}
        integrationMode={integrationMode}
        setIntegrationMode={setIntegrationMode}
        setSelectedRecommendation={setSelectedRecommendation}
        systemRecommendations={systemRecommendations}
        selectedRecommendation={selectedRecommendation}
        manualAssignment={manualAssignment}
        setManualAssignment={setManualAssignment}
        houses={houses}
        shiftDefs={shiftDefs}
        daysOfWeek={daysOfWeek}
        areWorkDaysConsecutive={(workDays) => areWorkDaysConsecutive(workDays, daysOfWeek)}
        onExecute={executeNewCaregiverIntegration}
        onCancel={cancelNewCaregiverIntegration}
        isIntegrating={isIntegrating}
      />

      {/* Custom Alert Modal */}
      <CustomAlertModal
        isOpen={showCustomAlert}
        title={customAlertTitle}
        message={customAlertMessage}
        onClose={closeCustomAlert}
      />

      {/* Auto-Regeneration Notification Modal */}
      {showAutoRegenModal && (
        <div className="popup-overlay">
          <div className="popup-content auto-regen-success-popup">
            <div className="popup-title auto-regen-success-title">
              <span className="auto-regen-success-icon">🔄</span>
              <span>Schedule Automatically Updated!</span>
            </div>
            <div className="auto-regen-success-content">
              <p style={{ marginBottom: '15px' }}>
                The previous schedule period has expired, and a new schedule has been automatically generated.
              </p>
              
              <div style={{ 
                backgroundColor: '#ecf0f1', 
                padding: '15px', 
                borderRadius: '8px',
                marginBottom: '15px'
              }}>
                <div style={{ marginBottom: '8px' }}>
                  <strong>📅 New Schedule Period:</strong>
                </div>
                <div style={{ paddingLeft: '10px' }}>
                  {autoRegenInfo.start?.toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                  <br />
                  <span style={{ color: '#95a5a6' }}>→</span>
                  <br />
                  {autoRegenInfo.end?.toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </div>
              </div>

              <div style={{ 
                backgroundColor: '#e8f5e9', 
                padding: '12px', 
                borderRadius: '8px',
                fontSize: '14px'
              }}>
                <strong>✅ Version:</strong> {autoRegenInfo.version}
                <br />
                <strong>✅ Status:</strong> All caregivers have been reassigned
                <br />
                <strong>✅ Coverage:</strong> Complete daily coverage maintained
              </div>
            </div>
            <div className="popup-buttons">
              <button 
                className="popup-btn yes auto-regen-confirm-btn" 
                onClick={() => {
                  setShowAutoRegenModal(false);
                  setAutoRegenInfo({ start: null, end: null, version: 0 });
                }}
                title="Acknowledge the new schedule and close this notification"
              >
                Got it, thanks!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Customization Modal */}
      <ScheduleCustomizationModal
        isOpen={showCustomizationModal}
        onClose={() => setShowCustomizationModal(false)}
        onGenerate={confirmGenerate}
        houses={houses}
        caregivers={caregivers}
      />

    </div>
  );
}