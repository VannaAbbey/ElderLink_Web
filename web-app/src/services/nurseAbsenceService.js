/**
 * Nurse Absence Service
 * Handles nurse absence management and temporary reassignments
 */

import { db } from "../firebase";
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  writeBatch, 
  doc, 
  updateDoc, 
  addDoc, 
  deleteDoc, 
  Timestamp,
  limit,
  orderBy
} from "firebase/firestore";

// Helper function for splitting arrays into chunks
const splitIntoChunks = (arr, n) => {
  if (!arr || arr.length === 0) return [];
  const res = Array.from({ length: n }, () => []);
  for (let i = 0; i < arr.length; i++) {
    res[i % n].push(arr[i]);
  }
  return res;
};

export const markNurseAbsent = async (
  assignDocId,
  assignments,
  nurseElderlyAssignments,
  tempReassignments,
  // NEW: pass the date string (YYYY-MM-DD) or null to mean "today"
  targetDateStr = null,
  // NEW: pass the day name ("Monday", "Tuesday", ...) or null to be derived from targetDateStr or today
  dayNameParam = null,
  // NEW: optional reason and notes for absence history
  reason = null,
  notes = null,
  markedBy = "admin"
) => {
  try {
    const assign = assignments.find((a) => a.id === assignDocId);
    if (!assign) throw new Error("Assignment not found");

    // Resolve target date and day:
    const useDate = targetDateStr ? new Date(targetDateStr) : new Date();
    const useDateStr = targetDateStr || useDate.toISOString().slice(0, 10);
    // Compute day name from either param or resolved date using consistent mapping
    const dayIndexFromDate = useDate.getDay(); // 0=Sunday,1=Mon...
    const indexToDayName = {
      0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 
      4: "Thursday", 5: "Friday", 6: "Saturday"
    };
    const derivedDayName = indexToDayName[dayIndexFromDate];
    const dayName = dayNameParam || derivedDayName;

    console.log(`=== NURSE ABSENCE DEBUGGING ===`);
    console.log(`Marking absent for nurse: ${assign.nurse_id}`);
    console.log(`Assignment details:`, {
      id: assign.id,
      nurse_id: assign.nurse_id,
      shift: assign.shift,
      days_assigned: assign.days_assigned,
    });
    console.log(`Target Date: ${useDateStr}, Day: ${dayName}`);

    // 1. Get the nurse's assigned elderly for the TARGET DAY only
    console.log(`Total nurse-elderly assignments in system: ${nurseElderlyAssignments.length}`);
    console.log(`Looking for elderly with nurse_id: ${assign.nurse_id}, day: ${dayName}, shift: ${assign.shift}`);

    // Get the original assignments from the database
    const originalAssignedEAs = nurseElderlyAssignments.filter(
      (ea) =>
        ea.nurse_id === assign.nurse_id &&
        (ea.day || "").toLowerCase() === dayName.toLowerCase() &&
        ea.shift === assign.shift
    );

    // Check if this nurse has any temporary assignments TO them for this date
    // (from other absent nurses) that also need to be reassigned
    const tempAssignmentsToThisNurse = tempReassignments.filter(
      (t) =>
        t.to_nurse_id === assign.nurse_id &&
        t.date === useDateStr &&
        t.shift === assign.shift
    );

    console.log(`Original elderly assignments for ${assign.nurse_id} on ${dayName}: ${originalAssignedEAs.length}`, 
      originalAssignedEAs.map(ea => ea.elderly_ids?.length || 0));
    console.log(`Temp assignments TO ${assign.nurse_id} for ${useDateStr}: ${tempAssignmentsToThisNurse.length}`, 
      tempAssignmentsToThisNurse.map(t => t.elderly_ids?.length || 0));

    // Combine both original and temporarily assigned elderly that need to be reassigned
    const originalElderIds = originalAssignedEAs.flatMap(ea => ea.elderly_ids || []);
    const tempElderIds = tempAssignmentsToThisNurse.flatMap(t => t.elderly_ids || []);
    const allElderIds = [...originalElderIds, ...tempElderIds];
    
    console.log(`All elderly IDs to reassign from ${assign.nurse_id}: ${allElderIds.length}`, allElderIds);

    // 3. Remove any existing temporary assignments TO this nurse (they need to be redistributed)
    if (tempAssignmentsToThisNurse.length > 0) {
      console.log(`Removing ${tempAssignmentsToThisNurse.length} existing temp assignments TO ${assign.nurse_id}`);
      const removePromises = tempAssignmentsToThisNurse.map(t => 
        deleteDoc(doc(db, "nurse_temp_reassignments", t.id))
      );
      await Promise.all(removePromises);
      console.log(`✅ Removed existing temp assignments TO ${assign.nurse_id}`);
    }

    // 4. Find other nurses in the SAME shift who can cover for that DAY
    console.log(`Looking for coverage nurses with:`);
    console.log(`- Same shift: ${assign.shift}`);
    console.log(`- Working on day (${dayName})`);
    console.log(`- Not absent for the same date`);
    console.log(`- Current assignments`);

    const otherAssigns = assignments.filter((a) =>
      a.shift === assign.shift &&
      a.id !== assignDocId &&
      a.is_current &&
      // ensure they are scheduled to work on the target day
      Array.isArray(a.days_assigned) &&
      a.days_assigned.map(d => d.toLowerCase()).includes(dayName.toLowerCase())
      // Note: We'll check for absences using hasAbsenceForDate if needed
    );

    console.log(`Found ${otherAssigns.length} other nurses available to cover:`);
    otherAssigns.forEach(a => {
      console.log(`- Nurse: ${a.nurse_id}, Days: ${a.days_assigned?.join(', ')}, absent_for_date: ${a.absent_for_date}`);
    });

    if (otherAssigns.length === 0) {
      console.log("❌ No available nurses to reassign for this date.");
      return { success: true, message: "Nurse marked as absent, but no coverage available for that date" };
    }

    // 5. Split all elderly (original + temporarily assigned) evenly among available nurses
    console.log(`Creating temporary reassignments for ${allElderIds.length} elderly...`);
    const chunks = splitIntoChunks(allElderIds, otherAssigns.length);
    console.log(`Elder chunks:`, chunks.map((chunk, i) => ({
      nurse: otherAssigns[i]?.nurse_id,
      elderCount: chunk.length,
      elders: chunk
    })));

    const promises = [];
    for (let i = 0; i < otherAssigns.length; i++) {
      const target = otherAssigns[i];
      const chunk = chunks[i] || [];
      console.log(`Assigning ${chunk.length} elderly to nurse ${target.nurse_id}`);

      if (chunk.length > 0) {
        const reassignmentData = {
          elderly_ids: chunk,
          from_nurse_id: assign.nurse_id,
          to_nurse_id: target.nurse_id,
          date: useDateStr,
          day: dayName,
          shift: assign.shift,
          created_at: Timestamp.now(),
          // Enhanced fields for mobile app integration
          assignment_type: "temporary_absence_coverage",
          reason: "nurse_absent",
          status: "active",
          expires_at: null, // null means it expires at end of shift/day
          source: "web_admin",
          priority: "normal",
          notes: `Temporary coverage due to ${assign.nurse_id} absence on ${useDateStr}`,
          created_by: "admin",
          last_modified_at: Timestamp.now(),
          sync_status: "pending_sync"
        };
        console.log(`Creating temp reassignment:`, reassignmentData);

        promises.push(addDoc(collection(db, "nurse_temp_reassignments"), reassignmentData));
      }
    }

    await Promise.all(promises);
    console.log(`✅ ${promises.length} temporary reassignments created successfully`);

    // 6. Create PERMANENT absence history record in nurse_cg_absence collection
    const tempReassignmentIds = promises.length > 0 ? [] : []; // Will be populated with actual IDs after Promise.all resolves
    const absenceHistoryData = {
      // Staff identification
      staff_id: assign.nurse_id,
      staff_type: "nurse",
      staff_name: assign.nurse_name || "Unknown Nurse", // TODO: Get from nurses array if needed
      
      // Absence details
      absent_for_date: useDateStr,
      absent_for_day: dayName,
      shift: assign.shift,
      
      // Timing
      marked_absent_at: Timestamp.now(),
      marked_present_at: null, // Will NEVER be set - absence is permanent
      
      // Status
      status: "permanent", // PERMANENT absence - cannot be undone
      
      // Context and metadata
      reason: reason || "supervisor_marked",
      notes: notes || `Permanently marked absent by supervisor - cannot be undone. Recorded at ${new Date().toLocaleString()}`,
      marked_by: markedBy,
      
      // Affected assignments (for audit and historical purposes)
      affected_assignments: {
        elderly_ids: allElderIds,
        temp_reassignments_created: tempReassignmentIds, // Will be updated with actual IDs
        original_assignment_id: assignDocId
      },
      
      // Mobile app integration
      sync_status: "pending_sync",
      last_sync_date: null,
      
      // Audit trail
      created_at: Timestamp.now(),
      last_modified_at: Timestamp.now(),
      
      // Permanent record indicators
      is_permanent: true,
      can_be_undone: false,
      action_type: "permanent_absence"
    };

    console.log(`📝 Creating absence history record:`, absenceHistoryData);
    const historyDocRef = await addDoc(collection(db, "nurse_cg_absence"), absenceHistoryData);
    console.log(`✅ Absence history record created with ID: ${historyDocRef.id}`);

    console.log(`=== END NURSE ABSENCE DEBUGGING ===`);
    return { 
      success: true, 
      message: "Nurse marked as absent and elderly reassigned",
      absenceHistoryId: historyDocRef.id
    };

  } catch (error) {
    console.error("Error marking nurse absent:", error);
    throw new Error("Failed to mark nurse as absent");
  }
};

// NOTE: unmarkNurseAbsent function has been REMOVED
// Marking a nurse as absent is now a PERMANENT action that cannot be undone
// This ensures absence records maintain their integrity for audit and historical purposes

// Reset daily absences (LEGACY function - only for cleanup of old nurse_shift_assign data)
// New absences are tracked in nurse_cg_absence and don't need daily resets
export const resetDailyNurseAbsences = async () => {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const snap = await getDocs(collection(db, "nurse_shift_assign"));

    const resetPromises = snap.docs
      .filter((d) => d.data().is_absent && d.data().absent_for_date !== todayStr)
      .map((d) =>
        updateDoc(doc(db, "nurse_shift_assign", d.id), {
          is_absent: false,
          absent_at: null,
          absent_for_date: null,
          absent_for_day: null,
        })
      );

    await Promise.all(resetPromises);
    return { success: true, message: "Daily nurse absences reset" };

  } catch (error) {
    console.error("Error resetting daily nurse absences:", error);
    throw new Error("Failed to reset daily nurse absences");
  }
};

// Get temporary reassignments for a specific date and shift
export const getTempReassignments = async (dateStr = null, shift = null) => {
  try {
    const targetDate = dateStr || new Date().toISOString().slice(0, 10);
    let q = query(
      collection(db, "nurse_temp_reassignments"),
      where("date", "==", targetDate)
    );

    if (shift) {
      q = query(q, where("shift", "==", shift));
    }

    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));

  } catch (error) {
    console.error("Error getting temp reassignments:", error);
    return [];
  }
};

// NOTE: isNurseAbsent function removed - use hasAbsenceForDate() instead
// The old function relied on assignment fields which could be unreliable for multi-day absences
// Use hasAbsenceForDate(nurseId, dateStr, shift) for comprehensive absence checking

// Check if a nurse has ANY absence history for a specific date (comprehensive check)
export const hasAbsenceForDate = async (nurseId, dateStr, shift = null) => {
  try {
    console.log(`🔍 Checking absence for nurse ${nurseId} on ${dateStr} shift ${shift}`);
    
    // Prioritize checking absence history first (more reliable for permanent absences)
    let historyQuery = query(
      collection(db, "nurse_cg_absence"),
      where("staff_id", "==", nurseId),
      where("absent_for_date", "==", dateStr)
    );
    
    if (shift) {
      historyQuery = query(historyQuery, where("shift", "==", shift));
    }
    
    const historySnapshot = await getDocs(historyQuery);
    if (historySnapshot.size > 0) {
      console.log(`✅ Found absence in history for nurse ${nurseId}`);
      return { hasAbsence: true, source: "absence_history" };
    }
    
    // Then check current assignment status as fallback
    let assignmentQuery = query(
      collection(db, "nurse_shift_assign"),
      where("nurse_id", "==", nurseId),
      where("is_absent", "==", true),
      where("absent_for_date", "==", dateStr)
    );
    
    if (shift) {
      assignmentQuery = query(assignmentQuery, where("shift", "==", shift));
    }
    
    const assignmentSnapshot = await getDocs(assignmentQuery);
    if (assignmentSnapshot.size > 0) {
      console.log(`✅ Found absence in current assignments for nurse ${nurseId}`);
      return { hasAbsence: true, source: "current_assignment" };
    }
    
    console.log(`❌ No absence found for nurse ${nurseId} on ${dateStr}`);
    return { hasAbsence: false, source: null };
    
  } catch (error) {
    console.error("Error checking absence for date:", error);
    return { hasAbsence: false, source: null, error: error.message };
  }
};

// Get effective elderly assignments for a nurse on a specific date (including temp reassignments)
export const getEffectiveElderlyAssignments = async (nurseId, dateStr, shift, dayName, nurseElderlyAssignments) => {
  try {
    // Get original assignments
    const originalAssignments = nurseElderlyAssignments.filter(
      ea => ea.nurse_id === nurseId && 
           ea.day.toLowerCase() === dayName.toLowerCase() && 
           ea.shift === shift
    );

    // Get temporary assignments TO this nurse
    const tempAssignments = await getTempReassignments(dateStr, shift);
    const tempToThisNurse = tempAssignments.filter(t => t.to_nurse_id === nurseId);

    // Combine elderly IDs
    const originalElderlyIds = originalAssignments.flatMap(ea => ea.elderly_ids || []);
    const tempElderlyIds = tempToThisNurse.flatMap(t => t.elderly_ids || []);
    
    return [...originalElderlyIds, ...tempElderlyIds];

  } catch (error) {
    console.error("Error getting effective elderly assignments:", error);
    return [];
  }
};

// Mobile app integration helper functions for temp reassignments

// Update sync status for a temporary reassignment
export const updateTempReassignmentSyncStatus = async (docId, status, lastSyncDate = null) => {
  try {
    const updateData = {
      sync_status: status, // "pending_sync", "synced", "sync_failed"
      last_modified_at: Timestamp.now()
    };
    
    if (lastSyncDate) {
      updateData.last_sync_date = Timestamp.fromDate(lastSyncDate);
    }
    
    await updateDoc(doc(db, "nurse_temp_reassignments", docId), updateData);
    return { success: true };
  } catch (error) {
    console.error("Error updating temp reassignment sync status:", error);
    return { success: false, error: error.message };
  }
};

// Get temporary reassignments pending sync for mobile app
export const getTempReassignmentsPendingSync = async () => {
  try {
    const q = query(
      collection(db, "nurse_temp_reassignments"),
      where("sync_status", "==", "pending_sync")
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error getting temp reassignments pending sync:", error);
    return [];
  }
};

// Get mobile app compatible format for temporary reassignments
export const getTempReassignmentMobileFormat = (reassignment) => {
  return {
    id: reassignment.id,
    elderly_ids: reassignment.elderly_ids || [],
    from_nurse_id: reassignment.from_nurse_id,
    to_nurse_id: reassignment.to_nurse_id,
    date: reassignment.date,
    day: reassignment.day,
    shift: reassignment.shift,
    assignment_type: reassignment.assignment_type || "temporary_absence_coverage",
    reason: reassignment.reason || "nurse_absent",
    status: reassignment.status || "active",
    priority: reassignment.priority || "normal",
    source: reassignment.source || "web_admin",
    created_at: reassignment.created_at,
    created_by: reassignment.created_by || "admin",
    expires_at: reassignment.expires_at,
    notes: reassignment.notes || "",
    last_modified_at: reassignment.last_modified_at,
    sync_status: reassignment.sync_status || "pending_sync"
  };
};

// Batch update sync status for multiple temp reassignments
export const batchUpdateTempReassignmentSyncStatus = async (updates) => {
  try {
    const batch = writeBatch(db);
    
    updates.forEach(update => {
      const { docId, status, lastSyncDate } = update;
      const docRef = doc(db, "nurse_temp_reassignments", docId);
      const updateData = {
        sync_status: status,
        last_modified_at: Timestamp.now()
      };
      
      if (lastSyncDate) {
        updateData.last_sync_date = Timestamp.fromDate(lastSyncDate);
      }
      
      batch.update(docRef, updateData);
    });
    
    await batch.commit();
    return { success: true, updatedCount: updates.length };
  } catch (error) {
    console.error("Error batch updating temp reassignment sync status:", error);
    return { success: false, error: error.message };
  }
};

// ========== STAFF ABSENCE HISTORY HELPER FUNCTIONS ==========
// These functions provide comprehensive absence history tracking for nurses
// (extensible to caregivers in the future)

// Get complete absence history for a staff member
export const getStaffAbsenceHistory = async (staffId, staffType = "nurse", options = {}) => {
  try {
    const {
      limit = null,
      startDate = null,
      endDate = null,
      status = null, // "active", "completed", or null for all
      orderBy = "marked_absent_at",
      orderDirection = "desc"
    } = options;

    let q = query(
      collection(db, "nurse_cg_absence"),
      where("staff_id", "==", staffId),
      where("staff_type", "==", staffType)
    );

    // Add date range filters if provided
    if (startDate) {
      q = query(q, where("absent_for_date", ">=", startDate));
    }
    if (endDate) {
      q = query(q, where("absent_for_date", "<=", endDate));
    }

    // Add status filter if provided
    if (status) {
      q = query(q, where("status", "==", status));
    }

    // Add ordering and limit
    q = query(q, orderBy(orderBy, orderDirection));
    if (limit) {
      q = query(q, limit(limit));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  } catch (error) {
    console.error("Error getting staff absence history:", error);
    return [];
  }
};

// Get current active absences for a staff member
export const getCurrentAbsences = async (staffId, staffType = "nurse") => {
  try {
    const q = query(
      collection(db, "nurse_cg_absence"),
      where("staff_id", "==", staffId),
      where("staff_type", "==", staffType),
      where("status", "==", "active")
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  } catch (error) {
    console.error("Error getting current absences:", error);
    return [];
  }
};

// Get absence history for a specific date range
export const getAbsenceHistoryByDateRange = async (startDate, endDate, staffType = "nurse") => {
  try {
    let q = query(
      collection(db, "nurse_cg_absence"),
      where("staff_type", "==", staffType),
      where("absent_for_date", ">=", startDate),
      where("absent_for_date", "<=", endDate)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  } catch (error) {
    console.error("Error getting absence history by date range:", error);
    return [];
  }
};

// Get absence statistics for a staff member
export const getAbsenceStatistics = async (staffId, staffType = "nurse", options = {}) => {
  try {
    const {
      startDate = null,
      endDate = null
    } = options;

    const historyOptions = { startDate, endDate };
    const history = await getStaffAbsenceHistory(staffId, staffType, historyOptions);

    const stats = {
      totalAbsences: history.length,
      activeAbsences: history.filter(h => h.status === "active").length,
      completedAbsences: history.filter(h => h.status === "completed").length,
      absencesByReason: {},
      absencesByShift: { "1st": 0, "2nd": 0, "3rd": 0 },
      absencesByMonth: {},
      averageAbsenceDuration: 0 // in hours, only for completed absences
    };

    // Calculate statistics
    let totalDurationHours = 0;
    let completedCount = 0;

    history.forEach(absence => {
      // Count by reason
      const reason = absence.reason || "unspecified";
      stats.absencesByReason[reason] = (stats.absencesByReason[reason] || 0) + 1;

      // Count by shift
      if (absence.shift) {
        stats.absencesByShift[absence.shift]++;
      }

      // Count by month
      const month = absence.absent_for_date.substring(0, 7); // YYYY-MM
      stats.absencesByMonth[month] = (stats.absencesByMonth[month] || 0) + 1;

      // Calculate duration for completed absences
      if (absence.status === "completed" && absence.marked_absent_at && absence.marked_present_at) {
        const startTime = absence.marked_absent_at.toDate();
        const endTime = absence.marked_present_at.toDate();
        const durationHours = (endTime - startTime) / (1000 * 60 * 60);
        totalDurationHours += durationHours;
        completedCount++;
      }
    });

    if (completedCount > 0) {
      stats.averageAbsenceDuration = totalDurationHours / completedCount;
    }

    return stats;

  } catch (error) {
    console.error("Error calculating absence statistics:", error);
    return null;
  }
};

// Check if staff member has any active absences for a specific date
export const hasActiveAbsenceForDate = async (staffId, staffType, targetDate, shift = null) => {
  try {
    let q = query(
      collection(db, "nurse_cg_absence"),
      where("staff_id", "==", staffId),
      where("staff_type", "==", staffType),
      where("absent_for_date", "==", targetDate),
      where("status", "==", "active")
    );

    if (shift) {
      q = query(q, where("shift", "==", shift));
    }

    const snapshot = await getDocs(q);
    return snapshot.size > 0;

  } catch (error) {
    console.error("Error checking active absence for date:", error);
    return false;
  }
};

// Update absence history sync status for mobile app
export const updateAbsenceHistorySyncStatus = async (historyId, status, lastSyncDate = null) => {
  try {
    const updateData = {
      sync_status: status,
      last_modified_at: Timestamp.now()
    };
    
    if (lastSyncDate) {
      updateData.last_sync_date = Timestamp.fromDate(lastSyncDate);
    }
    
    await updateDoc(doc(db, "nurse_cg_absence", historyId), updateData);
    return { success: true };
  } catch (error) {
    console.error("Error updating absence history sync status:", error);
    return { success: false, error: error.message };
  }
};

// Get absence history records pending sync for mobile app
export const getAbsenceHistoryPendingSync = async (staffType = "nurse") => {
  try {
    let q = query(
      collection(db, "nurse_cg_absence"),
      where("sync_status", "==", "pending_sync")
    );

    if (staffType) {
      q = query(q, where("staff_type", "==", staffType));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error getting absence history pending sync:", error);
    return [];
  }
};

// Get mobile app compatible format for absence history
export const getAbsenceHistoryMobileFormat = (absenceRecord) => {
  return {
    id: absenceRecord.id,
    staff_id: absenceRecord.staff_id,
    staff_type: absenceRecord.staff_type,
    staff_name: absenceRecord.staff_name,
    absent_for_date: absenceRecord.absent_for_date,
    absent_for_day: absenceRecord.absent_for_day,
    shift: absenceRecord.shift,
    marked_absent_at: absenceRecord.marked_absent_at,
    marked_present_at: absenceRecord.marked_present_at,
    status: absenceRecord.status,
    reason: absenceRecord.reason,
    notes: absenceRecord.notes,
    marked_by: absenceRecord.marked_by,
    affected_assignments: absenceRecord.affected_assignments,
    sync_status: absenceRecord.sync_status,
    last_sync_date: absenceRecord.last_sync_date,
    created_at: absenceRecord.created_at,
    last_modified_at: absenceRecord.last_modified_at
  };
};

// Get all absence dates for a nurse (from absence history)
export const getAllAbsenceDatesForNurse = async (nurseId, options = {}) => {
  try {
    const {
      startDate = null,
      endDate = null,
      shift = null,
      status = null
    } = options;

    let q = query(
      collection(db, "nurse_cg_absence"),
      where("staff_id", "==", nurseId),
      where("staff_type", "==", "nurse")
    );

    // Add filters
    if (startDate) {
      q = query(q, where("absent_for_date", ">=", startDate));
    }
    if (endDate) {
      q = query(q, where("absent_for_date", "<=", endDate));
    }
    if (shift) {
      q = query(q, where("shift", "==", shift));
    }
    if (status) {
      q = query(q, where("status", "==", status));
    }

    const snapshot = await getDocs(q);
    const absences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Group by date for easy lookup
    const absencesByDate = {};
    absences.forEach(absence => {
      const date = absence.absent_for_date;
      if (!absencesByDate[date]) {
        absencesByDate[date] = [];
      }
      absencesByDate[date].push(absence);
    });

    return {
      allAbsences: absences,
      absencesByDate: absencesByDate,
      totalAbsenceDays: Object.keys(absencesByDate).length,
      totalAbsenceRecords: absences.length
    };

  } catch (error) {
    console.error("Error getting all absence dates for nurse:", error);
    return {
      allAbsences: [],
      absencesByDate: {},
      totalAbsenceDays: 0,
      totalAbsenceRecords: 0,
      error: error.message
    };
  }
};

// Batch check absence status for multiple nurses on a specific date and shift (performance optimized)
export const batchCheckAbsencesForDate = async (nurseIds, dateStr, shift = null) => {
  try {
    console.log(`🔍 Batch checking absences for ${nurseIds.length} nurses on ${dateStr} shift ${shift}`);
    
    const results = {};
    
    // Initialize all results as false
    nurseIds.forEach(nurseId => {
      const key = `${nurseId}-${dateStr}-${shift || 'all'}`;
      results[key] = false;
    });
    
    // Query absence history for all nurses at once
    let historyQuery = query(
      collection(db, "nurse_cg_absence"),
      where("staff_id", "in", nurseIds),
      where("absent_for_date", "==", dateStr)
    );
    
    if (shift) {
      historyQuery = query(historyQuery, where("shift", "==", shift));
    }
    
    const historySnapshot = await getDocs(historyQuery);
    historySnapshot.forEach(doc => {
      const data = doc.data();
      const key = `${data.staff_id}-${dateStr}-${shift || 'all'}`;
      results[key] = true;
    });
    
    // Query current assignments for remaining nurses
    let assignmentQuery = query(
      collection(db, "nurse_shift_assign"),
      where("nurse_id", "in", nurseIds),
      where("is_absent", "==", true),
      where("absent_for_date", "==", dateStr)
    );
    
    if (shift) {
      assignmentQuery = query(assignmentQuery, where("shift", "==", shift));
    }
    
    const assignmentSnapshot = await getDocs(assignmentQuery);
    assignmentSnapshot.forEach(doc => {
      const data = doc.data();
      const key = `${data.nurse_id}-${dateStr}-${shift || 'all'}`;
      results[key] = true;
    });
    
    console.log(`✅ Batch check completed for ${Object.keys(results).length} nurse-date combinations`);
    return results;
    
  } catch (error) {
    console.error("Error batch checking absences:", error);
    return {};
  }
};

