/**
 * Attendance Monitor Service
 * Monitors the "attendance" collection from mobile app and automatically marks
 * caregivers/nurses as absent when they fail to check in
 */

import { db } from "../firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  Timestamp,
  addDoc,
  orderBy,
  limit
} from "firebase/firestore";
import { markCaregiverAbsent } from "./absenceService";
import { markNurseAbsent } from "./nurseAbsenceService";
import { checkEmergencyNeedsAndDonors } from "./emergencyService";

/**
 * Check if a user is marked absent in the attendance collection
 * @param {string} userId - User ID (caregiver or nurse)
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @param {string} shift - Shift (1st, 2nd, 3rd)
 * @param {string} userType - User type (caregiver or nurse)
 * @returns {Promise<Object>} { isAbsent: boolean, attendanceRecord: Object|null }
 */
export const checkAttendanceStatus = async (userId, dateStr, shift, userType) => {
  try {
    console.log(`🔍 Checking attendance for ${userType} ${userId} on ${dateStr} ${shift} shift`);
    
    const attendanceQuery = query(
      collection(db, "attendance"),
      where("user_id", "==", userId),
      where("date", "==", dateStr),
      where("shift", "==", shift),
      where("user_type", "==", userType)
    );
    
    const snapshot = await getDocs(attendanceQuery);
    
    if (snapshot.empty) {
      console.log(`⚠️ No attendance record found - user may not have checked in yet`);
      return { isAbsent: false, attendanceRecord: null, noRecord: true };
    }
    
    // Get the most recent attendance record for this date/shift
    const attendanceRecord = snapshot.docs[0].data();
    const isAbsent = attendanceRecord.is_present === false;
    
    if (isAbsent) {
      console.log(`❌ User marked as ABSENT in attendance system`);
      console.log(`   Reason: ${attendanceRecord.reason || 'No reason provided'}`);
    } else {
      console.log(`✅ User marked as PRESENT in attendance system`);
    }
    
    return {
      isAbsent,
      attendanceRecord: {
        id: snapshot.docs[0].id,
        ...attendanceRecord
      },
      noRecord: false
    };
    
  } catch (error) {
    console.error("Error checking attendance status:", error);
    return { isAbsent: false, attendanceRecord: null, noRecord: true, error: error.message };
  }
};

/**
 * Get all attendance records for a specific date
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @returns {Promise<Array>} Array of attendance records
 */
export const getAttendanceForDate = async (dateStr) => {
  try {
    const attendanceQuery = query(
      collection(db, "attendance"),
      where("date", "==", dateStr)
    );
    
    const snapshot = await getDocs(attendanceQuery);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
  } catch (error) {
    console.error("Error fetching attendance records:", error);
    return [];
  }
};

/**
 * Process an attendance record and automatically mark user as absent if needed
 * @param {Object} attendanceRecord - Attendance record from mobile app
 * @param {Array} assignments - Current shift assignments (caregiver or nurse)
 * @param {Array} elderlyAssigns - Current elderly assignments
 * @param {Array} tempReassigns - Current temporary reassignments
 * @param {Function} onEmergencyDetected - Optional callback when emergency coverage is needed
 * @returns {Promise<Object>} Result of absence marking
 */
export const processAttendanceRecord = async (attendanceRecord, assignments, elderlyAssigns, tempReassigns, onEmergencyDetected = null) => {
  try {
    const { user_id, date, shift, user_type, is_present, reason } = attendanceRecord;
    
    // Only process if user is marked as ABSENT
    if (is_present !== false) {
      console.log(`✅ User ${user_id} is present - no action needed`);
      return { success: true, action: 'none', message: 'User is present' };
    }
    
    console.log(`\n%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #FF6B6B; font-weight: bold');
    console.log(`%c🚨 AUTO-MARKING ${user_type.toUpperCase()} AS ABSENT FROM ATTENDANCE`, 'color: #FF6B6B; font-weight: bold; font-size: 14px');
    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #FF6B6B; font-weight: bold');
    console.log(`%c📍 User ID: ${user_id}`, 'color: #FFD93D');
    console.log(`%c📅 Date: ${date}`, 'color: #FFD93D');
    console.log(`%c⏰ Shift: ${shift}`, 'color: #FFD93D');
    console.log(`%c👤 Type: ${user_type}`, 'color: #FFD93D');
    console.log(`%c📝 Reason: ${reason || 'No reason provided'}`, 'color: #FFD93D');
    
    // Check if already marked absent in the absence system
    const existingAbsence = await checkIfAlreadyMarkedAbsent(user_id, date, shift, user_type);
    
    if (existingAbsence) {
      console.log(`%cℹ️ User already marked absent in absence system - skipping`, 'color: #4ECDC4');
      return { success: true, action: 'skip', message: 'Already marked absent in system' };
    }
    
    // Find the assignment for this user/date/shift
    const assignment = findAssignmentForUser(user_id, date, shift, assignments);
    
    if (!assignment) {
      console.log(`%c⚠️ No assignment found for user ${user_id} on ${date} ${shift} shift`, 'color: #FF6B6B');
      return { success: false, action: 'error', message: 'No assignment found for user' };
    }
    
    console.log(`%c✅ Found assignment:`, 'color: #95E1D3', assignment);
    
    // Convert date string to day name
    const dayName = convertDateToDayName(date);
    
    // Mark as absent using the appropriate service
    let result;
    if (user_type === "caregiver") {
      console.log(`%c📞 Calling markCaregiverAbsent...`, 'color: #4ECDC4');
      result = await markCaregiverAbsent(
        assignment.id,
        assignments,
        elderlyAssigns,
        tempReassigns,
        date, // targetDateStr
        dayName // dayNameParam
      );
    } else if (user_type === "nurse") {
      console.log(`%c📞 Calling markNurseAbsent...`, 'color: #4ECDC4');
      // Import nurse-specific data if needed
      result = await markNurseAbsent(
        assignment.id,
        assignments,
        elderlyAssigns,
        tempReassigns,
        date, // targetDateStr
        dayName, // dayNameParam
        reason || "Absent from mobile attendance", // reason
        `Auto-marked from attendance system`, // notes
        "system" // markedBy
      );
    } else {
      console.log(`%c⚠️ Unknown user type: ${user_type}`, 'color: #FF6B6B');
      return { success: false, action: 'error', message: 'Unknown user type' };
    }
    
    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #95E1D3; font-weight: bold');
    console.log(`%c✅ AUTO-ABSENCE MARKING COMPLETE`, 'color: #95E1D3; font-weight: bold; font-size: 14px');
    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`, 'color: #95E1D3; font-weight: bold');
    
    // 🚨 CHECK FOR EMERGENCY COVERAGE NEEDS (only for caregivers)
    if (user_type === "caregiver") {
      console.log(`\n%c🚨 CHECKING FOR EMERGENCY COVERAGE NEEDS...`, 'color: #FF6B6B; font-weight: bold; font-size: 14px');
      
      try {
        const emergencyCheck = await checkEmergencyNeedsAndDonors(date, assignments, elderlyAssigns, tempReassigns);
        
        if (emergencyCheck.hasEmergency) {
          console.log(`%c🆘 EMERGENCY DETECTED: ${emergencyCheck.emergencyCount} house/shift(s) with ZERO coverage!`, 'color: #FF6B6B; font-weight: bold; font-size: 16px');
          console.log(`%cEmergency details:`, 'color: #FFD93D', emergencyCheck.emergencyOptions);
          
          // Trigger callback to show emergency modal to admin
          if (onEmergencyDetected) {
            onEmergencyDetected(emergencyCheck);
          }
          
          return {
            success: true,
            action: 'marked_absent_with_emergency',
            message: `Successfully marked ${user_type} as absent - EMERGENCY COVERAGE NEEDED`,
            userId: user_id,
            date,
            shift,
            reason,
            emergencyDetected: true,
            emergencyCheck
          };
        } else {
          console.log(`%c✅ No emergency coverage needed - sufficient coverage available`, 'color: #95E1D3; font-weight: bold');
        }
      } catch (emergencyError) {
        console.error(`%c⚠️ Error checking emergency coverage:`, 'color: #FF6B6B', emergencyError);
        // Continue even if emergency check fails
      }
    }
    
    return {
      success: true,
      action: 'marked_absent',
      message: `Successfully marked ${user_type} as absent`,
      userId: user_id,
      date,
      shift,
      reason,
      emergencyDetected: false
    };
    
  } catch (error) {
    console.error("Error processing attendance record:", error);
    return {
      success: false,
      action: 'error',
      message: error.message,
      error
    };
  }
};

/**
 * Check if user is already marked absent in the absence system
 * @param {string} userId - User ID
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @param {string} shift - Shift
 * @param {string} userType - User type
 * @returns {Promise<boolean>} True if already marked absent
 */
const checkIfAlreadyMarkedAbsent = async (userId, dateStr, shift, userType) => {
  try {
    const absenceQuery = query(
      collection(db, "nurse_cg_absence"),
      where("user_id", "==", userId),
      where("absence_date", "==", dateStr),
      where("shift", "==", shift),
      where("user_type", "==", userType),
      where("status", "==", "active")
    );
    
    const snapshot = await getDocs(absenceQuery);
    return !snapshot.empty;
    
  } catch (error) {
    console.error("Error checking existing absence:", error);
    return false;
  }
};

/**
 * Find assignment for a specific user/date/shift
 * @param {string} userId - User ID
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @param {string} shift - Shift
 * @param {Array} assignments - Array of assignments
 * @returns {Object|null} Assignment object or null
 */
const findAssignmentForUser = (userId, dateStr, shift, assignments) => {
  const dayName = convertDateToDayName(dateStr);
  
  // Find assignment that matches user, shift, and includes this day
  const assignment = assignments.find(a => {
    const matchesUser = a.user_id === userId || a.caregiver_id === userId;
    const matchesShift = a.shift === shift;
    const isCurrent = a.is_current === true;
    const includesDay = (a.days_assigned || [])
      .map(d => d.toLowerCase())
      .includes(dayName.toLowerCase());
    
    return matchesUser && matchesShift && isCurrent && includesDay;
  });
  
  return assignment || null;
};

/**
 * Convert date string (YYYY-MM-DD) to day name (Monday, Tuesday, etc.)
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @returns {string} Day name
 */
const convertDateToDayName = (dateStr) => {
  const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const date = new Date(dateStr + "T00:00:00"); // Add time to avoid timezone issues
  const dayIndex = date.getDay();
  return daysOfWeek[dayIndex];
};

/**
 * Set up real-time listener for attendance changes
 * This will automatically process new attendance records as they come in
 * @param {Function} onAttendanceChange - Callback function when attendance changes
 * @returns {Function} Unsubscribe function
 */
export const subscribeToAttendanceChanges = (onAttendanceChange) => {
  console.log("🔔 Setting up real-time attendance monitor...");
  
  // Listen for attendance records marked as absent (is_present = false)
  const attendanceQuery = query(
    collection(db, "attendance"),
    where("is_present", "==", false)
  );
  
  const unsubscribe = onSnapshot(attendanceQuery, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const attendanceRecord = {
          id: change.doc.id,
          ...change.doc.data()
        };
        
        console.log(`\n🆕 NEW ABSENCE DETECTED FROM MOBILE APP:`);
        console.log(`   User: ${attendanceRecord.user_id} (${attendanceRecord.user_type})`);
        console.log(`   Date: ${attendanceRecord.date}`);
        console.log(`   Shift: ${attendanceRecord.shift}`);
        console.log(`   Reason: ${attendanceRecord.reason}`);
        
        // Trigger callback
        if (onAttendanceChange) {
          onAttendanceChange(attendanceRecord);
        }
      }
    });
  }, (error) => {
    console.error("Error in attendance listener:", error);
  });
  
  console.log("✅ Attendance monitor active");
  return unsubscribe;
};

/**
 * Batch process all pending attendance records
 * Use this on component mount to catch up on any missed attendance records
 * @param {Array} assignments - Current shift assignments
 * @param {Array} elderlyAssigns - Current elderly assignments
 * @param {Array} tempReassigns - Current temporary reassignments
 * @param {string} dateStr - Optional date to process (defaults to today)
 * @param {Function} onEmergencyDetected - Optional callback when emergency coverage is needed
 * @returns {Promise<Object>} Summary of processed records
 */
export const batchProcessPendingAttendance = async (assignments, elderlyAssigns, tempReassigns, dateStr = null, onEmergencyDetected = null) => {
  try {
    const targetDate = dateStr || new Date().toISOString().slice(0, 10);
    
    console.log(`\n%c🔄 BATCH PROCESSING ATTENDANCE RECORDS FOR ${targetDate}`, 'color: #4ECDC4; font-weight: bold; font-size: 14px');
    
    // Get all attendance records for the date where is_present = false
    const attendanceQuery = query(
      collection(db, "attendance"),
      where("date", "==", targetDate),
      where("is_present", "==", false)
    );
    
    const snapshot = await getDocs(attendanceQuery);
    const absentRecords = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    console.log(`📊 Found ${absentRecords.length} absent records to process`);
    
    const results = {
      total: absentRecords.length,
      processed: 0,
      skipped: 0,
      errors: 0,
      emergenciesDetected: 0,
      details: []
    };
    
    for (const record of absentRecords) {
      const result = await processAttendanceRecord(record, assignments, elderlyAssigns, tempReassigns, onEmergencyDetected);
      
      if (result.action === 'marked_absent' || result.action === 'marked_absent_with_emergency') {
        results.processed++;
        if (result.emergencyDetected) {
          results.emergenciesDetected++;
        }
      } else if (result.action === 'skip') {
        results.skipped++;
      } else if (result.action === 'error') {
        results.errors++;
      }
      
      results.details.push(result);
    }
    
    console.log(`\n%c✅ BATCH PROCESSING COMPLETE`, 'color: #95E1D3; font-weight: bold');
    console.log(`   Total: ${results.total}`);
    console.log(`   Processed: ${results.processed}`);
    console.log(`   Skipped: ${results.skipped}`);
    console.log(`   Errors: ${results.errors}`);
    if (results.emergenciesDetected > 0) {
      console.log(`%c   🚨 Emergencies Detected: ${results.emergenciesDetected}`, 'color: #FF6B6B; font-weight: bold');
    }
    console.log('');
    
    return results;
    
  } catch (error) {
    console.error("Error in batch processing:", error);
    return {
      total: 0,
      processed: 0,
      skipped: 0,
      errors: 1,
      details: [],
      error: error.message
    };
  }
};

/**
 * Get attendance summary for a user
 * @param {string} userId - User ID
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} Attendance summary
 */
export const getUserAttendanceSummary = async (userId, startDate, endDate) => {
  try {
    const attendanceQuery = query(
      collection(db, "attendance"),
      where("user_id", "==", userId),
      where("date", ">=", startDate),
      where("date", "<=", endDate)
    );
    
    const snapshot = await getDocs(attendanceQuery);
    const records = snapshot.docs.map(doc => doc.data());
    
    const summary = {
      total: records.length,
      present: records.filter(r => r.is_present === true).length,
      absent: records.filter(r => r.is_present === false).length,
      attendanceRate: 0,
      records
    };
    
    if (summary.total > 0) {
      summary.attendanceRate = ((summary.present / summary.total) * 100).toFixed(2);
    }
    
    return summary;
    
  } catch (error) {
    console.error("Error getting attendance summary:", error);
    return {
      total: 0,
      present: 0,
      absent: 0,
      attendanceRate: 0,
      records: [],
      error: error.message
    };
  }
};

/**
 * Check for users who should have checked in but haven't (no attendance record)
 * This can be used to identify users who didn't open the mobile app at all
 * @param {string} dateStr - Date to check (YYYY-MM-DD)
 * @param {string} shift - Shift to check
 * @param {Array} assignments - Current assignments
 * @returns {Promise<Array>} Array of users with missing attendance records
 */
export const findMissingAttendanceRecords = async (dateStr, shift, assignments) => {
  try {
    const dayName = convertDateToDayName(dateStr);
    
    // Get all users who should be working on this date/shift
    const expectedUsers = assignments.filter(a => {
      const matchesShift = a.shift === shift;
      const isCurrent = a.is_current === true;
      const includesDay = (a.days_assigned || [])
        .map(d => d.toLowerCase())
        .includes(dayName.toLowerCase());
      
      return matchesShift && isCurrent && includesDay;
    });
    
    console.log(`🔍 Expected ${expectedUsers.length} users to work on ${dateStr} ${shift} shift`);
    
    // Get all attendance records for this date/shift
    const attendanceQuery = query(
      collection(db, "attendance"),
      where("date", "==", dateStr),
      where("shift", "==", shift)
    );
    
    const snapshot = await getDocs(attendanceQuery);
    const checkedInUsers = new Set(
      snapshot.docs.map(doc => doc.data().user_id)
    );
    
    // Find users who didn't check in
    const missingUsers = expectedUsers.filter(a => {
      const userId = a.user_id || a.caregiver_id;
      return !checkedInUsers.has(userId);
    });
    
    console.log(`⚠️ Found ${missingUsers.length} users with missing attendance records`);
    
    return missingUsers.map(a => ({
      userId: a.user_id || a.caregiver_id,
      userType: a.user_type,
      houseId: a.house_id,
      shift: a.shift,
      assignmentId: a.id
    }));
    
  } catch (error) {
    console.error("Error finding missing attendance records:", error);
    return [];
  }
};
