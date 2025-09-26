/**
 * Absence Service
 * Handles caregiver absence management and temporary reassignments
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

// Import functions that this service depends on
import { fetchAssignments } from "./scheduleApi_backup";

// Helper function for splitting arrays into chunks
const splitIntoChunks = (arr, n) => {
  if (!arr || arr.length === 0) return [];
  const res = Array.from({ length: n }, () => []);
  for (let i = 0; i < arr.length; i++) {
    res[i % n].push(arr[i]);
  }
  return res;
};

export const markCaregiverAbsent = async (
  assignDocId,
  assignments,
  elderlyAssigns,
  tempReassigns,
  // NEW: pass the date string (YYYY-MM-DD) or null to mean "today"
  targetDateStr = null,
  // NEW: pass the day name ("Monday", "Tuesday", ...) or null to be derived from targetDateStr or today
  dayNameParam = null
) => {
  try {
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const assign = assignments.find((a) => a.id === assignDocId);
    if (!assign) throw new Error("Assignment not found");

    // Resolve target date and day:
    const useDate = targetDateStr ? new Date(targetDateStr) : new Date();
    const useDateStr = targetDateStr || useDate.toISOString().slice(0, 10);
    // Compute day name from either param or resolved date
    const dayIndexFromDate = useDate.getDay(); // 0=Sunday,1=Mon...
    const derivedDayName = daysOfWeek[dayIndexFromDate === 0 ? 6 : dayIndexFromDate - 1];
    const dayName = dayNameParam || derivedDayName;

    console.log(`=== ABSENCE DEBUGGING ===`);
    console.log(`Marking absent for caregiver: ${assign.caregiver_id}`);
    console.log(`Assignment details:`, {
      id: assign.id,
      house_id: assign.house_id,
      shift: assign.shift,
      days_assigned: assign.days_assigned,
      version: assign.version
    });
    console.log(`Target Date: ${useDateStr}, Day: ${dayName}`);

    // 1. Mark the caregiver as absent for the target date only
    await updateDoc(doc(db, "cg_house_assign", assignDocId), {
      is_absent: true,
      absent_at: Timestamp.now(),
      absent_for_date: useDateStr
    });

    // Update local 'assign' object so subsequent filtering uses the updated value (avoid stale UI props)
    assign.is_absent = true;
    assign.absent_for_date = useDateStr;

    // 2. Get the caregiver's assigned elderly for the TARGET DAY only
    console.log(`Total elderly assignments in system: ${elderlyAssigns.length}`);
    console.log(`Looking for elderly with caregiver_id: ${assign.caregiver_id}, version: ${assign.version}, day: ${dayName}`);

    // First, get the original assignments from the database
    const originalAssignedEAs = elderlyAssigns.filter(
      (ea) =>
        ea.caregiver_id === assign.caregiver_id &&
        ea.assign_version === assign.version &&
        (ea.day || "").toLowerCase() === dayName.toLowerCase()
    );

    // Then, check if this caregiver has any temporary assignments TO them for this date
    // (from other absent caregivers) that also need to be reassigned
    const tempAssignmentsToThisCaregiver = tempReassigns.filter(
      (t) =>
        t.to_caregiver_id === assign.caregiver_id &&
        t.date === useDateStr &&
        t.assign_version === assign.version
    );

    console.log(`Original elderly assignments for ${assign.caregiver_id} on ${dayName}: ${originalAssignedEAs.length}`, originalAssignedEAs.map(ea => ea.elderly_id));
    console.log(`Temp assignments TO ${assign.caregiver_id} for ${useDateStr}: ${tempAssignmentsToThisCaregiver.length}`, tempAssignmentsToThisCaregiver.map(t => t.elderly_id));

    // Combine both original and temporarily assigned elderly that need to be reassigned
    const originalElderIds = originalAssignedEAs.map((ea) => ea.elderly_id);
    const tempElderIds = tempAssignmentsToThisCaregiver.map((t) => t.elderly_id);
    const allElderIds = [...originalElderIds, ...tempElderIds];
    
    console.log(`All elderly IDs to reassign from ${assign.caregiver_id}: ${allElderIds.length}`, allElderIds);

    // 3. Remove any existing temporary assignments TO this caregiver (they need to be redistributed)
    if (tempAssignmentsToThisCaregiver.length > 0) {
      console.log(`Removing ${tempAssignmentsToThisCaregiver.length} existing temp assignments TO ${assign.caregiver_id}`);
      const removePromises = tempAssignmentsToThisCaregiver.map(t => 
        deleteDoc(doc(db, "temp_reassignments", t.id))
      );
      await Promise.all(removePromises);
      console.log(`✅ Removed existing temp assignments TO ${assign.caregiver_id}`);
    }

    // 4. Find other caregivers in the SAME house & shift who can cover for that DAY
    console.log(`Looking for coverage caregivers with:`);
    console.log(`- Same house: ${assign.house_id}`);
    console.log(`- Same shift: ${assign.shift}`);
    console.log(`- Working on day (${dayName})`);
    console.log(`- Not absent for the same date`);
    console.log(`- Current assignments`);

    const otherAssigns = assignments.filter((a) =>
      a.house_id === assign.house_id &&
      a.shift === assign.shift &&
      a.id !== assignDocId &&
      a.is_current &&
      // ensure they are scheduled to work on the target day
      Array.isArray(a.days_assigned) &&
      a.days_assigned.map(d => d.toLowerCase()).includes(dayName.toLowerCase()) &&
      // exclude those marked absent for same date
      !(a.is_absent && a.absent_for_date === useDateStr)
    );

    console.log(`Found ${otherAssigns.length} other caregivers available to cover:`);
    otherAssigns.forEach(a => {
      console.log(`- Caregiver: ${a.caregiver_id}, Days: ${a.days_assigned?.join(', ')}, absent_for_date: ${a.absent_for_date}`);
    });

    if (otherAssigns.length === 0) {
      console.log("❌ No available caregivers to reassign for this date.");
      return { success: true, message: "Caregiver marked as absent, but no coverage available for that date" };
    }

    // 5. Split all elderly (original + temporarily assigned) evenly among available caregivers
    console.log(`Creating temporary reassignments for ${allElderIds.length} elderly...`);
    const chunks = splitIntoChunks(allElderIds, otherAssigns.length);
    console.log(`Elder chunks:`, chunks.map((chunk, i) => ({
      caregiver: otherAssigns[i]?.caregiver_id,
      elderCount: chunk.length,
      elders: chunk
    })));

    const promises = [];
    for (let i = 0; i < otherAssigns.length; i++) {
      const target = otherAssigns[i];
      const chunk = chunks[i] || [];
      console.log(`Assigning ${chunk.length} elderly to caregiver ${target.caregiver_id}`);

      for (const eid of chunk) {
        const reassignmentData = {
          elderly_id: eid,
          from_caregiver_id: assign.caregiver_id,
          to_caregiver_id: target.caregiver_id,
          date: useDateStr,           // use the target date
          assign_version: assign.version,
          created_at: Timestamp.now(),
        };
        console.log(`Creating temp reassignment:`, reassignmentData);

        promises.push(addDoc(collection(db, "temp_reassignments"), reassignmentData));
      }
    }

    await Promise.all(promises);
    console.log(`✅ ${promises.length} temporary reassignments created successfully`);
    console.log(`=== END ABSENCE DEBUGGING ===`);
    return { success: true, message: "Caregiver marked as absent and elderly reassigned" };

  } catch (error) {
    console.error("Error marking caregiver absent:", error);
    throw new Error("Failed to mark caregiver as absent");
  }
};

export const unmarkCaregiverAbsent = async (assignDocId, assignments) => {
  try {
    const assign = assignments.find(a => a.id === assignDocId);
    if (!assign) throw new Error("Assignment not found");

    const todayStr = new Date().toISOString().slice(0, 10);

    // 1. Clear absence for today only
    await updateDoc(doc(db, "cg_house_assign", assignDocId), {
      is_absent: false,
      absent_at: null,
      absent_for_date: null,
    });

    // 2. Remove temporary reassignments for today from this caregiver
    const snap = await getDocs(query(
      collection(db, "temp_reassignments"),
      where("date", "==", todayStr)
    ));

    const delPromises = snap.docs
      .filter(d => d.data().from_caregiver_id === assign.caregiver_id)
      .map(d => deleteDoc(doc(db, "temp_reassignments", d.id)));

    await Promise.all(delPromises);
    return { success: true, message: "Caregiver absence cleared" };

  } catch (error) {
    console.error("Error unmarking caregiver absent:", error);
    throw new Error("Failed to clear caregiver absence");
  }
};

// Reset daily absences
export const resetDailyAbsences = async () => {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const snap = await getDocs(collection(db, "cg_house_assign"));

    const resetPromises = snap.docs
      .filter((d) => d.data().is_absent && d.data().absent_for_date !== todayStr)
      .map((d) =>
        updateDoc(doc(db, "cg_house_assign", d.id), {
          is_absent: false,
          absent_at: null,
          absent_for_date: null,
        })
      );

    await Promise.all(resetPromises);
    return { success: true, message: "Daily absences reset" };

  } catch (error) {
    console.error("Error resetting daily absences:", error);
    throw new Error("Failed to reset daily absences");
  }
};

// Enhanced absence marking with emergency coverage check (returns emergency info, doesn't auto-execute)
export const markCaregiverAbsentWithEmergencyCheck = async (
  assignDocId,
  assignments,
  elderlyAssigns,
  tempReassigns,
  targetDateStr = null,
  dayNameParam = null
) => {
  try {
    // First, mark the caregiver absent using existing function
    await markCaregiverAbsent(assignDocId, assignments, elderlyAssigns, tempReassigns, targetDateStr, dayNameParam);
    
    // Then check if emergency coverage is needed
    const useDate = targetDateStr ? new Date(targetDateStr) : new Date();
    const useDateStr = targetDateStr || useDate.toISOString().slice(0, 10);
    
    console.log(`🔍 Checking if emergency coverage needed after marking absence for ${useDateStr}`);
    
    // Refresh assignments to get updated state
    const refreshedAssignments = await fetchAssignments(true);
    
    // Dynamically import the emergency function to avoid circular dependency
    const { checkEmergencyNeedsAndDonors } = await import('./emergencyService');
    
    // Check for emergency coverage needs (but don't auto-execute)
    const emergencyCheck = await checkEmergencyNeedsAndDonors(useDateStr, refreshedAssignments, elderlyAssigns, tempReassigns);
    
    return {
      success: true,
      absenceMarked: true,
      emergencyCheck: emergencyCheck
    };
    
  } catch (error) {
    console.error("Error in absence marking with emergency check:", error);
    throw error;
  }
};
