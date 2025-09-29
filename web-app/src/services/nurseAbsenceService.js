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
  Timestamp 
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
  dayNameParam = null
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

    // 1. Mark the nurse as absent for the target date and day only
    await updateDoc(doc(db, "nurse_shift_assign_v2", assignDocId), {
      is_absent: true,
      absent_at: Timestamp.now(),
      absent_for_date: useDateStr,
      absent_for_day: dayName
    });

    // Update local 'assign' object so subsequent filtering uses the updated value
    assign.is_absent = true;
    assign.absent_for_date = useDateStr;
    assign.absent_for_day = dayName;

    // 2. Get the nurse's assigned elderly for the TARGET DAY only
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
      a.days_assigned.map(d => d.toLowerCase()).includes(dayName.toLowerCase()) &&
      // exclude those marked absent for same date and day
      !(a.is_absent && a.absent_for_date === useDateStr && a.absent_for_day === dayName)
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
    console.log(`=== END NURSE ABSENCE DEBUGGING ===`);
    return { success: true, message: "Nurse marked as absent and elderly reassigned" };

  } catch (error) {
    console.error("Error marking nurse absent:", error);
    throw new Error("Failed to mark nurse as absent");
  }
};

export const unmarkNurseAbsent = async (assignDocId, assignments) => {
  try {
    const assign = assignments.find(a => a.id === assignDocId);
    if (!assign) throw new Error("Assignment not found");

    const todayStr = new Date().toISOString().slice(0, 10);

    // 1. Clear absence for today only
    await updateDoc(doc(db, "nurse_shift_assign_v2", assignDocId), {
      is_absent: false,
      absent_at: null,
      absent_for_date: null,
      absent_for_day: null,
    });

    // 2. Remove temporary reassignments for today from this nurse
    const snap = await getDocs(query(
      collection(db, "nurse_temp_reassignments"),
      where("date", "==", todayStr)
    ));

    const delPromises = snap.docs
      .filter(d => d.data().from_nurse_id === assign.nurse_id)
      .map(d => deleteDoc(doc(db, "nurse_temp_reassignments", d.id)));

    await Promise.all(delPromises);
    return { success: true, message: "Nurse absence cleared" };

  } catch (error) {
    console.error("Error unmarking nurse absent:", error);
    throw new Error("Failed to clear nurse absence");
  }
};

// Reset daily absences
export const resetDailyNurseAbsences = async () => {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const snap = await getDocs(collection(db, "nurse_shift_assign_v2"));

    const resetPromises = snap.docs
      .filter((d) => d.data().is_absent && d.data().absent_for_date !== todayStr)
      .map((d) =>
        updateDoc(doc(db, "nurse_shift_assign_v2", d.id), {
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

// Check if a nurse is absent for a specific date and day
export const isNurseAbsent = (assignment, dateStr, dayName = null) => {
  if (!assignment.is_absent || assignment.absent_for_date !== dateStr) {
    return false;
  }
  
  // If dayName is provided, also check the day
  if (dayName && assignment.absent_for_day) {
    return assignment.absent_for_day.toLowerCase() === dayName.toLowerCase();
  }
  
  return true;
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