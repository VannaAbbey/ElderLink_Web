/**
 * Automatic Absence Monitor Service
 * Automatically marks caregivers/nurses as absent if they don't check in 
 * within 15 minutes after their shift starts
 */

import { db } from "../firebase";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  Timestamp
} from "firebase/firestore";
import { markCaregiverAbsent } from "./absenceService";
import { markNurseAbsent } from "./nurseAbsenceService";

// Shift definitions with start times
const SHIFT_DEFINITIONS = {
  "1st": { start: "06:00", end: "14:00", name: "1st Shift (6:00 AM - 2:00 PM)" },
  "2nd": { start: "14:00", end: "22:00", name: "2nd Shift (2:00 PM - 10:00 PM)" },
  "3rd": { start: "22:00", end: "06:00", name: "3rd Shift (10:00 PM - 6:00 AM)" }
};

// Grace period in minutes after shift start before marking absent
const GRACE_PERIOD_MINUTES = 15;

// 🔧 DEBUG MODE: Set to true to enable immediate testing without waiting for shift times
// When enabled, uses a much shorter check interval and simulated grace period
const DEBUG_MODE = false; // Toggle this for testing
const DEBUG_CHECK_INTERVAL_MS = 10000; // Check every 10 seconds in debug mode (instead of 1 minute)
const DEBUG_GRACE_PERIOD_SECONDS = 30; // Only 30 seconds grace period in debug mode (instead of 15 minutes)

// Days of week mapping
const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Track which shifts have been processed today to prevent duplicate marking
const processedShiftsToday = {};

/**
 * Reset the processed shifts tracker at midnight
 */
const resetProcessedShiftsAtMidnight = () => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  
  const msUntilMidnight = tomorrow - now;
  
  setTimeout(() => {
    console.log(`🔄 Midnight - Resetting processed shifts tracker`);
    for (let key in processedShiftsToday) {
      delete processedShiftsToday[key];
    }
    // Schedule next reset
    resetProcessedShiftsAtMidnight();
  }, msUntilMidnight);
};

// Start the midnight reset timer
resetProcessedShiftsAtMidnight();

/**
 * 🧪 MANUAL TEST TRIGGER - Use this in browser console to test immediately
 * This bypasses all time checks and immediately processes absence marking
 * 
 * Usage in browser console:
 * window.testAutoAbsence()
 * 
 * This will be available when DEBUG_MODE is true
 */
export const setupManualTestTrigger = (getAssignmentData, onAbsenceMarked) => {
  if (DEBUG_MODE && typeof window !== 'undefined') {
    window.testAutoAbsence = async () => {
      console.log(`\n%c🧪 MANUAL TEST TRIGGER - Running auto-absence check NOW`, 'color: #FF1493; font-weight: bold; font-size: 16px');
      
      try {
        const { assignments, elderlyAssigns, tempReassigns, onEmergencyDetected } = getAssignmentData();
        
        if (!assignments || assignments.length === 0) {
          console.error('❌ No assignments loaded yet. Please wait for data to load.');
          return;
        }
        
        // Force the check by passing a very old test start time
        const veryOldTime = new Date(Date.now() - 60000); // 1 minute ago
        
        const result = await autoMarkAbsentUsers(
          assignments,
          elderlyAssigns,
          tempReassigns,
          onEmergencyDetected,
          veryOldTime
        );
        
        console.log(`%c✅ TEST COMPLETE`, 'color: #00FF00; font-weight: bold');
        console.log(`Result:`, result);
        
        if (result.success && result.processed > 0 && onAbsenceMarked) {
          onAbsenceMarked(result);
        }
        
        return result;
      } catch (error) {
        console.error('❌ Test failed:', error);
        return { success: false, error: error.message };
      }
    };
    
    console.log(`%c🧪 TEST TRIGGER READY: Type "window.testAutoAbsence()" in console to test immediately`, 'color: #FF1493; font-weight: bold');
  }
};

/**
 * Get current shift based on current time
 * @returns {string|null} Current shift key ("1st", "2nd", "3rd") or null if between shifts
 */
export const getCurrentShift = () => {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentTime = hours * 60 + minutes; // Total minutes since midnight
  
  // 1st shift: 6:00 AM to 2:00 PM (360 to 840 minutes)
  if (currentTime >= 360 && currentTime < 840) {
    return "1st";
  }
  
  // 2nd shift: 2:00 PM to 10:00 PM (840 to 1320 minutes)
  if (currentTime >= 840 && currentTime < 1320) {
    return "2nd";
  }
  
  // 3rd shift: 10:00 PM to 6:00 AM (1320 to 1440 OR 0 to 360 minutes)
  if (currentTime >= 1320 || currentTime < 360) {
    return "3rd";
  }
  
  return null;
};

/**
 * Check if we're within the grace period for a specific shift
 * @param {string} shift - Shift key ("1st", "2nd", "3rd")
 * @returns {boolean} True if within grace period
 */
export const isWithinGracePeriod = (shift) => {
  if (DEBUG_MODE) {
    // In debug mode, always return true to allow immediate testing
    console.log(`🔧 DEBUG MODE: Grace period check bypassed - always within grace period`);
    return true;
  }
  
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentMinutes = hours * 60 + minutes;
  
  const shiftDef = SHIFT_DEFINITIONS[shift];
  if (!shiftDef) return false;
  
  const [startHour, startMinute] = shiftDef.start.split(':').map(Number);
  const shiftStartMinutes = startHour * 60 + startMinute;
  
  // Handle 3rd shift crossing midnight
  let gracePeriodStart = shiftStartMinutes;
  let gracePeriodEnd = shiftStartMinutes + GRACE_PERIOD_MINUTES;
  
  if (shift === "3rd") {
    // 3rd shift starts at 22:00 (1320 minutes)
    // Grace period: 22:00 to 22:15 (1320 to 1335 minutes)
    if (currentMinutes >= gracePeriodStart && currentMinutes <= gracePeriodEnd) {
      return true;
    }
  } else {
    // For 1st and 2nd shifts
    if (currentMinutes >= gracePeriodStart && currentMinutes <= gracePeriodEnd) {
      return true;
    }
  }
  
  return false;
};

/**
 * Check if current time is past the grace period end for a shift
 * This determines when we should trigger the auto-absence check
 * @param {string} shift - Shift key ("1st", "2nd", "3rd")
 * @param {Date} testStartTime - Optional test start time for debug mode
 * @returns {boolean} True if past grace period end
 */
export const isAtGracePeriodEnd = (shift, testStartTime = null) => {
  if (DEBUG_MODE && testStartTime) {
    // In debug mode, check if DEBUG_GRACE_PERIOD_SECONDS have passed since test start
    const now = new Date();
    const elapsedSeconds = (now - testStartTime) / 1000;
    const isAtEnd = elapsedSeconds >= DEBUG_GRACE_PERIOD_SECONDS;
    
    if (isAtEnd) {
      console.log(`🔧 DEBUG MODE: Grace period ended (${elapsedSeconds.toFixed(1)}s >= ${DEBUG_GRACE_PERIOD_SECONDS}s)`);
    }
    
    return isAtEnd;
  }
  
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentMinutes = hours * 60 + minutes;
  
  const shiftDef = SHIFT_DEFINITIONS[shift];
  if (!shiftDef) return false;
  
  const [startHour, startMinute] = shiftDef.start.split(':').map(Number);
  const shiftStartMinutes = startHour * 60 + startMinute;
  const gracePeriodEnd = shiftStartMinutes + GRACE_PERIOD_MINUTES;
  
  // ✅ FIXED: Check if current time is PAST the grace period end (not just within 1 minute)
  // This allows catching up on missed checks when website is reopened
  // For 3rd shift crossing midnight, handle wrap-around
  if (shift === "3rd") {
    // 3rd shift: 22:00-06:00, grace period ends at 22:15 (1335 minutes)
    // If current time is after 22:15 OR before 06:00, grace period has ended
    if (currentMinutes >= gracePeriodEnd || currentMinutes < 360) {
      return true;
    }
  } else {
    // For 1st and 2nd shifts: simple comparison
    if (currentMinutes >= gracePeriodEnd) {
      return true;
    }
  }
  
  return false;
};

/**
 * Get current date string in YYYY-MM-DD format
 * @returns {string} Date string
 */
const getCurrentDateString = () => {
  return new Date().toISOString().slice(0, 10);
};

/**
 * Get current day name
 * @returns {string} Day name (Monday, Tuesday, etc.)
 */
const getCurrentDayName = () => {
  const now = new Date();
  return DAYS_OF_WEEK[now.getDay()];
};

/**
 * Check if a user has attendance record for today's shift
 * @param {string} userId - User ID
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @param {string} shift - Shift key
 * @param {string} userType - "caregiver" or "nurse"
 * @returns {Promise<boolean>} True if attendance record exists
 */
export const hasAttendanceRecord = async (userId, dateStr, shift, userType) => {
  try {
    const attendanceQuery = query(
      collection(db, "attendance"),
      where("user_id", "==", userId),
      where("date", "==", dateStr),
      where("shift", "==", shift),
      where("user_type", "==", userType)
    );
    
    const snapshot = await getDocs(attendanceQuery);
    return !snapshot.empty;
  } catch (error) {
    console.error("Error checking attendance record:", error);
    return false;
  }
};

/**
 * Check if user is already marked absent
 * @param {string} userId - User ID
 * @param {string} dateStr - Date string
 * @param {string} shift - Shift key
 * @returns {Promise<boolean>} True if already marked absent
 */
const isAlreadyMarkedAbsent = async (userId, dateStr, shift) => {
  try {
    const absenceQuery = query(
      collection(db, "nurse_cg_absence"),
      where("user_id", "==", userId),
      where("absence_date", "==", dateStr),
      where("shift", "==", shift),
      where("status", "==", "active")
    );
    
    const snapshot = await getDocs(absenceQuery);
    return !snapshot.empty;
  } catch (error) {
    console.error("Error checking absence status:", error);
    return false;
  }
};

/**
 * Get all scheduled caregivers/nurses for a specific shift and day
 * @param {Array} assignments - All assignments
 * @param {string} shift - Shift key
 * @param {string} dayName - Day name
 * @param {string} userType - "caregiver" or "nurse"
 * @returns {Array} Array of scheduled users
 */
const getScheduledUsers = (assignments, shift, dayName, userType) => {
  return assignments.filter(a => {
    const matchesShift = a.shift === shift;
    const isCurrent = a.is_current === true;
    const includesDay = (a.days_assigned || [])
      .map(d => d.toLowerCase())
      .includes(dayName.toLowerCase());
    
    // Filter by user type if specified
    let matchesType = true;
    if (userType === "caregiver") {
      matchesType = a.caregiver_id || a.user_type === "caregiver";
    } else if (userType === "nurse") {
      matchesType = !a.caregiver_id && (!a.user_type || a.user_type === "nurse");
    }
    
    return matchesShift && isCurrent && includesDay && matchesType;
  });
};

/**
 * Auto-mark users absent if they haven't checked in after grace period
 * @param {Array} assignments - All shift assignments
 * @param {Array} elderlyAssigns - All elderly assignments
 * @param {Array} tempReassigns - All temporary reassignments
 * @param {Function} onEmergencyDetected - Callback for emergency coverage detection (caregivers only)
 * @param {Date} testStartTime - Optional test start time for debug mode
 * @returns {Promise<Object>} Result summary
 */
export const autoMarkAbsentUsers = async (
  assignments,
  elderlyAssigns,
  tempReassigns,
  onEmergencyDetected = null,
  testStartTime = null
) => {
  try {
    const currentShift = getCurrentShift();
    if (!currentShift) {
      console.log("⏸️ No active shift at this time");
      return { processed: 0, message: "No active shift" };
    }
    
    // Check if we're at the grace period end for this shift
    if (!isAtGracePeriodEnd(currentShift, testStartTime)) {
      return { processed: 0, message: "Not at grace period end" };
    }
    
    const dateStr = getCurrentDateString();
    const dayName = getCurrentDayName();
    
    // Check if we already processed this shift today to prevent duplicate marking
    const processKey = `${dateStr}-${currentShift}`;
    if (processedShiftsToday[processKey]) {
      console.log(`⏭️ Already processed ${currentShift} shift for ${dateStr} - skipping to prevent duplicates`);
      return { processed: 0, message: "Already processed today" };
    }
    
    console.log(`\n%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #FF6B6B; font-weight: bold');
    console.log(`%c⏰ AUTO-ABSENCE CHECK - Grace Period Ended`, 'color: #FF6B6B; font-weight: bold; font-size: 14px');
    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #FF6B6B; font-weight: bold');
    console.log(`%c📅 Date: ${dateStr} (${dayName})`, 'color: #FFD93D');
    console.log(`%c⏰ Shift: ${currentShift} - ${SHIFT_DEFINITIONS[currentShift].name}`, 'color: #FFD93D');
    console.log(`%c🕐 Grace Period: ${GRACE_PERIOD_MINUTES} minutes after shift start`, 'color: #FFD93D');
    
    let caregiverCount = 0;
    let nurseCount = 0;
    const processedUsers = [];
    
    // Get all scheduled caregivers for this shift/day
    const scheduledCaregivers = getScheduledUsers(assignments, currentShift, dayName, "caregiver");
    console.log(`\n%c👥 Scheduled Caregivers: ${scheduledCaregivers.length}`, 'color: #4ECDC4; font-weight: bold');
    
    for (const assignment of scheduledCaregivers) {
      const userId = assignment.user_id || assignment.caregiver_id;
      
      // Check if already marked absent
      const alreadyAbsent = await isAlreadyMarkedAbsent(userId, dateStr, currentShift);
      if (alreadyAbsent) {
        console.log(`⏭️ Caregiver ${userId} already marked absent - skipping`);
        continue;
      }
      
      // Check if they have attendance record
      const hasAttendance = await hasAttendanceRecord(userId, dateStr, currentShift, "caregiver");
      
      if (!hasAttendance) {
        console.log(`\n%c🚨 Auto-marking caregiver ${userId} as ABSENT (no attendance record)`, 'color: #FF6B6B; font-weight: bold');
        
        try {
          // Mark as absent using the same service as manual marking
          await markCaregiverAbsent(
            assignment.id,
            assignments,
            elderlyAssigns,
            tempReassigns,
            dateStr,
            dayName
          );
          
          // Create attendance record to mark them as absent
          await addDoc(collection(db, "attendance"), {
            user_id: userId,
            user_type: "caregiver",
            date: dateStr,
            shift: currentShift,
            is_present: false,
            reason: "Auto-marked absent (no check-in after grace period)",
            auto_marked: true,
            marked_at: Timestamp.now()
          });
          
          caregiverCount++;
          processedUsers.push({ userId, userType: "caregiver" });
          console.log(`✅ Caregiver ${userId} auto-marked absent`);
        } catch (error) {
          console.error(`❌ Error auto-marking caregiver ${userId}:`, error);
        }
      } else {
        console.log(`✓ Caregiver ${userId} has attendance record`);
      }
    }
    
    // Get all scheduled nurses for this shift/day
    const scheduledNurses = getScheduledUsers(assignments, currentShift, dayName, "nurse");
    console.log(`\n%c👨‍⚕️ Scheduled Nurses: ${scheduledNurses.length}`, 'color: #4ECDC4; font-weight: bold');
    
    for (const assignment of scheduledNurses) {
      const userId = assignment.user_id;
      
      // Check if already marked absent
      const alreadyAbsent = await isAlreadyMarkedAbsent(userId, dateStr, currentShift);
      if (alreadyAbsent) {
        console.log(`⏭️ Nurse ${userId} already marked absent - skipping`);
        continue;
      }
      
      // Check if they have attendance record
      const hasAttendance = await hasAttendanceRecord(userId, dateStr, currentShift, "nurse");
      
      if (!hasAttendance) {
        console.log(`\n%c🚨 Auto-marking nurse ${userId} as ABSENT (no attendance record)`, 'color: #FF6B6B; font-weight: bold');
        
        try {
          // Mark as absent using the same service as manual marking
          // Note: We need the nurse-elderly assignments for redistribution
          await markNurseAbsent(
            assignment.id,
            assignments,
            elderlyAssigns, // This should be nurseElderlyAssignments for nurses
            tempReassigns,
            dateStr,
            dayName,
            "Auto-marked absent (no check-in after grace period)",
            null,
            "system"
          );
          
          // Create attendance record to mark them as absent
          await addDoc(collection(db, "attendance"), {
            user_id: userId,
            user_type: "nurse",
            date: dateStr,
            shift: currentShift,
            is_present: false,
            reason: "Auto-marked absent (no check-in after grace period)",
            auto_marked: true,
            marked_at: Timestamp.now()
          });
          
          nurseCount++;
          processedUsers.push({ userId, userType: "nurse" });
          console.log(`✅ Nurse ${userId} auto-marked absent`);
        } catch (error) {
          console.error(`❌ Error auto-marking nurse ${userId}:`, error);
        }
      } else {
        console.log(`✓ Nurse ${userId} has attendance record`);
      }
    }
    
    console.log(`\n%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #95E1D3; font-weight: bold');
    console.log(`%c✅ AUTO-ABSENCE CHECK COMPLETE`, 'color: #95E1D3; font-weight: bold; font-size: 14px');
    console.log(`%c📊 Caregivers marked absent: ${caregiverCount}`, 'color: #95E1D3');
    console.log(`%c📊 Nurses marked absent: ${nurseCount}`, 'color: #95E1D3');
    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`, 'color: #95E1D3; font-weight: bold');
    
    // Mark this shift as processed for today
    processedShiftsToday[processKey] = true;
    console.log(`✅ Marked ${currentShift} shift for ${dateStr} as processed`);
    
    return {
      success: true,
      processed: caregiverCount + nurseCount,
      caregivers: caregiverCount,
      nurses: nurseCount,
      users: processedUsers,
      shift: currentShift,
      date: dateStr
    };
    
  } catch (error) {
    console.error("Error in auto-absence check:", error);
    return {
      success: false,
      processed: 0,
      error: error.message
    };
  }
};

/**
 * Start automatic absence monitoring with periodic checks
 * Checks every minute to see if we're at the grace period end
 * @param {Function} getAssignmentData - Function that returns { assignments, elderlyAssigns, tempReassigns }
 * @param {Function} onAbsenceMarked - Callback when users are marked absent
 * @returns {Function} Stop function to clear interval
 */
export const startAutoAbsenceMonitoring = (getAssignmentData, onAbsenceMarked = null) => {
  const checkInterval = DEBUG_MODE ? DEBUG_CHECK_INTERVAL_MS : 60000;
  const gracePeriodDisplay = DEBUG_MODE 
    ? `${DEBUG_GRACE_PERIOD_SECONDS} seconds (DEBUG MODE)`
    : `${GRACE_PERIOD_MINUTES} minutes`;
  
  console.log(`\n%c🔔 STARTING AUTO-ABSENCE MONITORING`, 'color: #4ECDC4; font-weight: bold; font-size: 14px');
  console.log(`%c⏰ Check interval: ${DEBUG_MODE ? '10 seconds (DEBUG)' : '1 minute'}`, 'color: #4ECDC4');
  console.log(`%c⌛ Grace period: ${gracePeriodDisplay}`, 'color: #4ECDC4');
  
  if (DEBUG_MODE) {
    console.log(`%c🔧 DEBUG MODE ENABLED - Testing made easy!`, 'color: #FF6B6B; font-weight: bold; font-size: 14px');
    console.log(`%c   • No need to wait for actual shift times`, 'color: #FFD93D');
    console.log(`%c   • Grace period is only 30 seconds`, 'color: #FFD93D');
    console.log(`%c   • Checks every 10 seconds`, 'color: #FFD93D');
    console.log(`%c   • To test: Just ensure users have no attendance record\n`, 'color: #FFD93D');
  }
  
  const testStartTime = DEBUG_MODE ? new Date() : null;
  
  // Setup manual test trigger in debug mode
  if (DEBUG_MODE) {
    setupManualTestTrigger(getAssignmentData, onAbsenceMarked);
  }
  
  // Check every minute (60000 ms) in production, or every 10 seconds in debug mode
  const intervalId = setInterval(async () => {
    try {
      const { assignments, elderlyAssigns, tempReassigns, onEmergencyDetected } = getAssignmentData();
      
      if (!assignments || assignments.length === 0) {
        return; // Skip if no assignments loaded yet
      }
      
      const result = await autoMarkAbsentUsers(
        assignments,
        elderlyAssigns,
        tempReassigns,
        onEmergencyDetected,
        testStartTime
      );
      
      if (result.success && result.processed > 0 && onAbsenceMarked) {
        onAbsenceMarked(result);
      }
    } catch (error) {
      console.error("Error in auto-absence monitoring interval:", error);
    }
  }, checkInterval);
  
  // Return stop function
  return () => {
    console.log(`🔕 STOPPING AUTO-ABSENCE MONITORING`);
    clearInterval(intervalId);
  };
};
