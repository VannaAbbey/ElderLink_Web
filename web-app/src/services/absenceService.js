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

// Helper function to check if a user is absent on a specific date
export const checkUserAbsence = async (userId, absenceDate, userType = null) => {
  try {
    let q = query(
      collection(db, "nurse_cg_absence"),
      where("user_id", "==", userId),
      where("absence_date", "==", absenceDate),
      where("status", "==", "active")
    );
    
    if (userType) {
      q = query(q, where("user_type", "==", userType));
    }
    
    const snap = await getDocs(q);
    return !snap.empty;
  } catch (error) {
    console.error("❌ Error checking user absence:", error);
    return false;
  }
};

// Helper function to get all absences for a specific date
export const getAbsencesForDate = async (absenceDate) => {
  try {
    const q = query(
      collection(db, "nurse_cg_absence"),
      where("absence_date", "==", absenceDate),
      where("status", "==", "active")
    );
    
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error("Error fetching absences for date:", error);
    return [];
  }
};

// Unmark caregiver/nurse as absent (UNDO absence)
export const unmarkAbsent = async (
  userId,
  targetDateStr,
  shift,
  houseId,
  userType = "caregiver"
) => {
  try {
    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #FFD700; font-weight: bold');
    console.log(`%c🔄 START UNDO ABSENCE OPERATION`, 'color: #FFD700; font-weight: bold; font-size: 14px');
    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #FFD700; font-weight: bold');
    console.log(`%c📍 User ID: ${userId}`, 'color: #FFD700');
    console.log(`%c📅 Date: ${targetDateStr}`, 'color: #FFD700');
    console.log(`%c⏰ Shift: ${shift}`, 'color: #FFD700');
    console.log(`%c🏠 House: ${houseId}`, 'color: #FFD700');
    console.log(`%c👤 User Type: ${userType}`, 'color: #FFD700');

    console.log(`%c\nSTEP 1: Update Absence Record to "Unmarked"`, 'color: #FFD700; font-weight: bold');
    
    // 1. Find and update the absence record to "unmarked" status
    const absenceQuery = query(
      collection(db, "nurse_cg_absence"),
      where("user_id", "==", userId),
      where("absence_date", "==", targetDateStr),
      where("shift", "==", shift),
      where("status", "==", "active")
    );

    const absenceSnap = await getDocs(absenceQuery);
    
    if (absenceSnap.empty) {
      console.warn(`⚠️ No active absence record found for user ${userId} on ${targetDateStr}`);
      return { success: false, message: "No active absence record found" };
    }

    // Update absence status to "unmarked" (keep the record for audit trail)
    const absenceDoc = absenceSnap.docs[0];
    const absenceData = absenceDoc.data();
    
    await updateDoc(doc(db, "nurse_cg_absence", absenceDoc.id), {
      status: "unmarked",
      unmarked_at: Timestamp.now(),
      unmarked_by: "admin"
    });

    console.log(`%c✅ Absence record updated to "unmarked"`, 'color: #FFD700');

    console.log(`%c\nSTEP 2: Check for Other Absent Caregivers in Same House/Shift`, 'color: #FFD700; font-weight: bold');

    // 2. Get all OTHER caregivers who are STILL ABSENT in the same house/shift/date
    const allAbsencesQuery = query(
      collection(db, "nurse_cg_absence"),
      where("absence_date", "==", targetDateStr),
      where("shift", "==", shift),
      where("house_id", "==", houseId),
      where("status", "==", "active") // Still active (not unmarked)
    );

    const allAbsencesSnap = await getDocs(allAbsencesQuery);
    const stillAbsentUserIds = allAbsencesSnap.docs.map(d => d.data().user_id);
    
    console.log(`👥 Other caregivers still absent: ${stillAbsentUserIds.length}`);

    console.log(`\nSTEP 3: Delete ALL Related Temporary Assignments for House ${houseId}`);

    // 3. Delete ALL temporary reassignments for this shift/date/house
    // Since we're doing full redistribution in STEP 4, we delete ALL temp assignments
    // for this specific house/shift/date to start fresh
    const tempReassignQuery = query(
      collection(db, "temporary_assignments"),
      where("date", "==", targetDateStr),
      where("shift", "==", shift)
    );

    const tempSnap = await getDocs(tempReassignQuery);
    
    // Filter for this specific house only (since we can't use from_house_id/to_house_id in query)
    // We need to check if the temp assignment involves caregivers from this house
    const batch = writeBatch(db);
    let deletedCount = 0;
    let emergencyCoverageRemoved = false;

    console.log(`   Found ${tempSnap.docs.length} total temp assignments for ${targetDateStr} ${shift} shift`);

    // Get all caregiver IDs for this house/shift to identify relevant temp assignments
    const houseCaregiversQuery = query(
      collection(db, "house_shift_assignments"),
      where("house_id", "==", houseId),
      where("shift", "==", shift),
      where("is_current", "==", true)
    );
    const houseCaregiverSnap = await getDocs(houseCaregiversQuery);
    const houseCaregiverIds = new Set(houseCaregiverSnap.docs.map(d => d.data().user_id));
    
    console.log(`   House ${houseId} has ${houseCaregiverIds.size} caregivers:`, Array.from(houseCaregiverIds));

    tempSnap.docs.forEach((docSnap, index) => {
      const data = docSnap.data();
      
      // Only delete temp assignments that involve caregivers from THIS house
      const involvesThisHouse = houseCaregiverIds.has(data.from_user_id) || houseCaregiverIds.has(data.to_user_id);
      
      if (involvesThisHouse) {
        console.log(`   📄 Temp Assignment ${index + 1}/${tempSnap.docs.length} (HOUSE ${houseId}):`, {
          id: docSnap.id,
          shift: data.shift,
          from_user_id: data.from_user_id,
          to_user_id: data.to_user_id,
          elderly_count: (data.elderly_ids || []).length
        });
        
        batch.delete(docSnap.ref);
        deletedCount++;
        console.log(`   🗑️  Marked for deletion: ${docSnap.id}`);
        
        // Check if emergency coverage
        if (data.is_emergency === true) {
          emergencyCoverageRemoved = true;
        }
      } else {
        console.log(`   ⏭️  Skipping temp assignment ${docSnap.id} (different house)`);
      }
    });

    if (deletedCount > 0) {
      await batch.commit();
      console.log(`✅ Deleted ${deletedCount} temporary assignments for house ${houseId}`);
    } else {
      console.log(`ℹ️ No temporary assignments to delete for house ${houseId}`);
    }

    console.log(`\nSTEP 4: FULL REDISTRIBUTION`);

    // 4. ALWAYS REDISTRIBUTE ALL ELDERLY when there are still absent caregivers
    // This ensures fair distribution among ALL present caregivers, including the one we just unmarked
    if (stillAbsentUserIds.length > 0) {
      console.log(`🔄 Full redistribution needed - ${stillAbsentUserIds.length} caregivers still absent`);
      
      // Convert date to day name
      const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      const targetDate = new Date(targetDateStr + "T00:00:00");
      const dayIndex = targetDate.getDay();
      const dayName = daysOfWeek[dayIndex === 0 ? 6 : dayIndex - 1];
      
      console.log(`   Day: ${dayName}, House: ${houseId}, Shift: ${shift}`);

      // 🔧 FIX: Collect elderly ONLY from ABSENT caregivers, not from present ones!
      // This prevents redistributing the unmarked caregiver's original assignments
      const elderlyFromAbsentCaregivers = new Set();
      
      // Get base elderly assignments for this house/shift/day
      // NOTE: house_id is stored as an ARRAY ["H003"], so use array-contains
      const elderlyAssignQuery = query(
        collection(db, "elderly_assignments"),
        where("house_id", "array-contains", houseId),
        where("shift", "==", shift),
        where("day", "==", dayName),
        where("status", "==", "active"),
        where("is_current", "==", true),
        where("user_type", "==", "caregiver")
      );
      
      const elderlyAssignSnap = await getDocs(elderlyAssignQuery);
      console.log(`📊 Found ${elderlyAssignSnap.docs.length} elderly assignment documents for house/shift`);
      
      // Only collect elderly from ABSENT caregivers
      elderlyAssignSnap.docs.forEach(docSnap => {
        const data = docSnap.data();
        const caregiverUserId = data.user_id;
        const elderlyIds = data.elderly_ids || [];
        
        // ✅ Only add if this caregiver is STILL ABSENT
        if (stillAbsentUserIds.includes(caregiverUserId)) {
          elderlyIds.forEach(id => elderlyFromAbsentCaregivers.add(id));
          console.log(`   📦 Collecting ${elderlyIds.length} elderly from ABSENT caregiver: ${caregiverUserId}`);
        } else {
          console.log(`   ⏭️  Skipping ${elderlyIds.length} elderly from PRESENT caregiver: ${caregiverUserId}`);
        }
      });
      
      const elderlyToRedistribute = Array.from(elderlyFromAbsentCaregivers);
      console.log(`Total elderly to redistribute (from absent caregivers only): ${elderlyToRedistribute.length}`);
      
      // Find ALL AVAILABLE caregivers (not absent, including the one we just unmarked)
      const assignmentsQuery = query(
        collection(db, "house_shift_assignments"),
        where("house_id", "==", houseId),
        where("shift", "==", shift),
        where("is_current", "==", true)
      );
      
      const assignmentsSnap = await getDocs(assignmentsQuery);
      const availableCaregivers = assignmentsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(a => {
          const isAbsent = stillAbsentUserIds.includes(a.user_id);
          const worksOnDay = (a.days_assigned || []).map(d => d.toLowerCase()).includes(dayName.toLowerCase());
          return !isAbsent && worksOnDay;
        });
      
      console.log(`👥 Available caregivers: ${availableCaregivers.length} (including ${userId})`);
      
      if (availableCaregivers.length > 0 && elderlyToRedistribute.length > 0) {
        // Redistribute ALL elderly evenly among ALL available caregivers
        const chunks = splitIntoChunks(elderlyToRedistribute, availableCaregivers.length);
        const redistributeBatch = writeBatch(db);
        
        for (let i = 0; i < availableCaregivers.length; i++) {
          const caregiver = availableCaregivers[i];
          const elderlyChunk = chunks[i];
          
          if (elderlyChunk && elderlyChunk.length > 0) {
            const tempAssignRef = doc(collection(db, "temporary_assignments"));
            redistributeBatch.set(tempAssignRef, {
              from_user_id: "FULL_REDISTRIBUTION",
              to_user_id: caregiver.user_id,
              elderly_ids: elderlyChunk,
              date: targetDateStr,
              day: dayName,
              shift: shift,
              from_house_id: houseId,
              to_house_id: houseId,
              reason: `Full redistribution after unmarking ${userId}`,
              assignment_type: "full_redistribution",
              created_at: Timestamp.now(),
              assign_version: caregiver.version || 1
            });
          }
        }
        
        await redistributeBatch.commit();
        console.log(`✅ Redistributed ${elderlyToRedistribute.length} elderly among ${availableCaregivers.length} caregivers`);
      } else if (availableCaregivers.length === 0) {
        console.log(`⚠️ No available caregivers for redistribution`);
      } else if (elderlyToRedistribute.length === 0) {
        console.log(`ℹ️ No elderly to redistribute`);
      }
    } else {
      console.log(`✅ No redistribution needed - all caregivers present`);
    }

    console.log(`\nSTEP 5: Update Attendance Record (if exists)`);

    // 5. Update attendance collection - set is_present back to true
    // This is important for cases where the absence was auto-marked from the mobile app
    try {
      const attendanceQuery = query(
        collection(db, "attendance"),
        where("user_id", "==", userId),
        where("date", "==", targetDateStr),
        where("shift", "==", shift),
        where("user_type", "==", userType)
      );
      
      const attendanceSnap = await getDocs(attendanceQuery);
      
      if (!attendanceSnap.empty) {
        const attendanceDoc = attendanceSnap.docs[0];
        await updateDoc(doc(db, "attendance", attendanceDoc.id), {
          is_present: true,
          updated_at: Timestamp.now(),
          updated_by: "admin",
          update_reason: "Absence unmarked by admin"
        });
        console.log(`✅ Updated attendance record - set is_present = true`);
      } else {
        console.log(`ℹ️ No attendance record found to update (absence may have been manually marked)`);
      }
    } catch (attendanceError) {
      console.warn(`⚠️ Could not update attendance record:`, attendanceError.message);
      // Don't fail the entire operation if attendance update fails
    }

    console.log(`\nSTEP 6: Log Activity`);

    // 6. Log the unmark action
    await addDoc(collection(db, "activity_logs"), {
      action: `${userType} Absence Unmarked (UNDO)`,
      user_id: userId,
      date: targetDateStr,
      shift: shift,
      house_id: houseId,
      user_type: userType,
      unmarked_by: "admin",
      original_absence_type: absenceData.absence_type || "absent",
      temporary_assignments_deleted: deletedCount,
      emergency_coverage_removed: emergencyCoverageRemoved,
      still_absent_count: stillAbsentUserIds.length,
      redistributed_elderly: stillAbsentUserIds.length > 0,
      timestamp: Timestamp.now()
    });

    console.log(`✅ UNDO ABSENCE COMPLETE - Deleted: ${deletedCount}, Still absent: ${stillAbsentUserIds.length}, Redistributed: ${stillAbsentUserIds.length > 0}\n`);

    return {
      success: true,
      message: `Successfully unmarked ${userType} as absent`,
      deletedTempAssignments: deletedCount,
      emergencyCoverageRemoved,
      stillAbsentCount: stillAbsentUserIds.length,
      redistributed: stillAbsentUserIds.length > 0,
      userId,
      date: targetDateStr,
      shift,
      houseId
    };

  } catch (error) {
    console.error("%c❌ ERROR IN UNDO ABSENCE:", 'color: #FF0000; font-weight: bold; font-size: 16px', error);
    throw new Error(`Failed to unmark absence: ${error.message}`);
  }
};

// Helper function to get all absences for multiple users on a specific date
export const checkMultipleUserAbsences = async (userIds, absenceDate) => {
  try {
    if (!userIds || userIds.length === 0) return {};
    
    const q = query(
      collection(db, "nurse_cg_absence"),
      where("user_id", "in", userIds),
      where("absence_date", "==", absenceDate),
      where("status", "==", "active")
    );
    
    const snap = await getDocs(q);
    const absenceMap = {};
    snap.docs.forEach(d => {
      const data = d.data();
      absenceMap[data.user_id] = { id: d.id, ...data };
    });
    
    return absenceMap;
  } catch (error) {
    console.error("Error checking multiple user absences:", error);
    return {};
  }
};

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

    // Get the user ID from the assignment (it's stored as user_id, not caregiver_id)
    const userId = assign.user_id || assign.caregiver_id;
    if (!userId) {
      throw new Error("Assignment has no user_id or caregiver_id");
    }

    console.log(`Marking absent: ${userId}, Date: ${useDateStr}, Day: ${dayName}`);

    // 1. Create absence record in centralized collection
    const absenceRecord = {
      user_id: userId,
      user_type: "caregiver",
      absence_date: useDateStr,
      created_at: Timestamp.now(),
      marked_by: "admin",
      status: "active",
      absence_type: "absent",
      house_id: assign.house_id,
      shift: assign.shift,
      assignment_version: assign.version
    };
    
    await addDoc(collection(db, "nurse_cg_absence"), absenceRecord);
    console.log(`✅ Created absence record for ${userId} on ${useDateStr}`);

    // 2. Get the caregiver's assigned elderly for the TARGET DAY only
    // First, get the original assignments from the database
    const originalAssignedEAs = elderlyAssigns.filter(
      (ea) =>
        ea.user_id === userId &&
        ea.assign_version === assign.version &&
        (ea.day || "").toLowerCase() === dayName.toLowerCase()
    );

    // Then, check if this caregiver has any temporary assignments TO them for this date
    // (from other absent caregivers) that also need to be reassigned
    const tempAssignmentsToThisCaregiver = tempReassigns.filter(
      (t) =>
        t.to_user_id === userId &&
        t.date === useDateStr &&
        t.assign_version === assign.version
    );

    // Combine both original and temporarily assigned elderly that need to be reassigned
    const originalElderIds = originalAssignedEAs.flatMap((ea) => ea.elderly_ids || []);
    const tempElderIds = tempAssignmentsToThisCaregiver.flatMap((t) => t.elderly_ids || []);
    
    console.log(`Original elderly: ${originalElderIds.length}, Temp elderly: ${tempElderIds.length}`);

    // 3. COMPREHENSIVE CLEANUP: Remove ALL temporary assignments for this date/shift/house combination
    const allRelevantTempAssignments = tempReassigns.filter(
      (t) =>
        t.date === useDateStr &&
        t.assign_version === assign.version &&
        // Either FROM this caregiver OR TO this caregiver OR involving the same house/shift
        (t.from_user_id === userId || 
         t.to_user_id === userId ||
         // Check if the temp assignment involves caregivers in the same house/shift
         assignments.some(a => 
           (a.user_id === t.from_user_id || a.user_id === t.to_user_id) &&
           a.house_id === assign.house_id && 
           a.shift === assign.shift
         ))
    );

    console.log(`Cleaning up ${allRelevantTempAssignments.length} temp assignments for comprehensive redistribution`);
    
    // Collect ALL elderly from the temp assignments that will be removed
    const elderlyFromRemovedTempAssignments = allRelevantTempAssignments.flatMap(t => t.elderly_ids || []);
    
    // Update allElderIds to include elderly from all temp assignments being cleaned up
    // Remove duplicates in case the same elderly appears in multiple temp assignments
    const allElderIds = [...new Set([...originalElderIds, ...elderlyFromRemovedTempAssignments])];
    console.log(`Total unique elderly to redistribute: ${allElderIds.length}`);

    // Remove all relevant temp assignments
    if (allRelevantTempAssignments.length > 0) {
      const batch = writeBatch(db);
      allRelevantTempAssignments.forEach((t) => {
        batch.delete(doc(db, "temporary_assignments", t.id));
      });
      await batch.commit();
      console.log(`✅ Removed ${allRelevantTempAssignments.length} temp assignments for clean redistribution`);
    }

    // 4. Find other caregivers in the SAME house & shift who can cover for that DAY

    // Get potential coverage caregivers (same house/shift/day)
    const potentialCaregivers = assignments.filter((a) =>
      a.house_id === assign.house_id &&
      a.shift === assign.shift &&
      a.id !== assignDocId &&
      a.is_current &&
      // ensure they are scheduled to work on the target day
      Array.isArray(a.days_assigned) &&
      a.days_assigned.map(d => d.toLowerCase()).includes(dayName.toLowerCase())
    );

    // Check absence status for all potential caregivers
    const caregiverIds = potentialCaregivers.map(a => a.user_id || a.caregiver_id);
    const absenceMap = await checkMultipleUserAbsences(caregiverIds, useDateStr);
    
    // Filter out absent caregivers
    const otherAssigns = potentialCaregivers.filter(a => !absenceMap[a.user_id || a.caregiver_id]);

    console.log(`Found ${otherAssigns.length} caregivers available to cover`);

    // 5. Split all elderly (original + temporarily assigned) evenly among available caregivers
    // ✅ FIXED: Proceed with redistribution even if only 1 caregiver remains (or none)
    // If no caregivers available, the elderly will remain without coverage but absence is still recorded
    // ✅ FIXED: Proceed with redistribution even if only 1 caregiver remains (or none)
    // If no caregivers available, the elderly will remain without coverage but absence is still recorded
    
    const promises = [];
    
    if (otherAssigns.length > 0) {
      const chunks = splitIntoChunks(allElderIds, otherAssigns.length);
      console.log(`Creating ${chunks.length} temporary reassignments for ${allElderIds.length} elderly`);
    for (let i = 0; i < otherAssigns.length; i++) {
      const target = otherAssigns[i];
      const chunk = chunks[i] || [];
      
      // Skip if no elderly to assign to this caregiver
      if (chunk.length === 0) continue;
      
      const targetUserId = target.user_id || target.caregiver_id;

      // Create single document with elderly_ids array instead of individual documents
      const reassignmentData = {
        elderly_ids: chunk,
        from_user_id: userId,
        to_user_id: targetUserId,
        user_type: "caregiver",
        assignment_type: "absence_coverage",
        day: dayName,
        shift: assign.shift,
        status: "active",
        expires_at: null,
        date: useDateStr,
        assign_version: assign.version,
        created_at: Timestamp.now(),
      };

        promises.push(addDoc(collection(db, "temporary_assignments"), reassignmentData));
      }
    } else {
      console.log(`⚠️ No caregivers available for coverage - ${allElderIds.length} elderly will be without assignment`);
    }

    if (promises.length > 0) {
      await Promise.all(promises);
      console.log(`✅ ${promises.length} temporary reassignments created successfully\n`);
    }
    
    return { 
      success: true, 
      message: otherAssigns.length > 0 
        ? "Caregiver marked as absent and elderly reassigned" 
        : "Caregiver marked as absent, but no coverage available"
    };

  } catch (error) {
    console.error("Error marking caregiver absent:", error);
    throw new Error("Failed to mark caregiver as absent");
  }
};

// Reset daily absences (only clears outdated absences from previous days, preserves today's absences)
// export const resetDailyAbsences = async () => {
//   try {
//     const todayStr = new Date().toISOString().slice(0, 10);
//     console.log(`🧹 Resetting outdated absences. Today is: ${todayStr}`);

//     // Get all active absence records
//     const absenceQuery = query(
//       collection(db, "nurse_cg_absence"),
//       where("status", "==", "active")
//     );
    
//     const absenceSnap = await getDocs(absenceQuery);
//     console.log(`Found ${absenceSnap.docs.length} active absence records to check`);
    
//     // Filter to only outdated records (NOT today's records)
//     const outdatedRecords = absenceSnap.docs.filter(d => {
//       const absenceDate = d.data().absence_date;
//       const isToday = absenceDate === todayStr;
//       console.log(`Absence record: ${d.data().user_id} on ${absenceDate} - isToday: ${isToday}`);
//       return !isToday; // Keep today's records, remove older ones
//     });
    
//     console.log(`Found ${outdatedRecords.length} outdated absence records to clear (preserving ${absenceSnap.docs.length - outdatedRecords.length} today's records)`);
    
//     if (outdatedRecords.length === 0) {
//       console.log(`✅ No outdated absence records to clear`);
//       return { success: true, message: "No outdated absences to reset" };
//     }

//     // Update outdated records to "cleared" status
//     const resetPromises = outdatedRecords.map((d) =>
//       updateDoc(doc(db, "nurse_cg_absence", d.id), {
//         status: "cleared",
//         cleared_at: Timestamp.now()
//       })
//     );

//     await Promise.all(resetPromises);
//     console.log(`✅ Cleared ${resetPromises.length} outdated absence records (preserved today's absences)`);
//     return { success: true, message: `Cleared ${resetPromises.length} outdated absences` };

//   } catch (error) {
//     console.error("Error resetting daily absences:", error);
//     throw new Error("Failed to reset daily absences");
//   }
// };

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
    
    // Dynamically import the emergency function to avoid circular dependency
    const { checkEmergencyNeedsAndDonors } = await import('./emergencyService');
    
    // Check for emergency coverage needs (but don't auto-execute)
    const emergencyCheck = await checkEmergencyNeedsAndDonors(useDateStr, assignments, elderlyAssigns, tempReassigns);
    
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

// Process approved leave request - mark caregiver/nurse as "on leave" for multiple days
export const processApprovedLeave = async (
  leaveRequestData,
  assignments,
  elderlyAssigns,
  tempReassigns
) => {
  try {
    // Ensure we have the correct user ID (could be caregiver_id or user_id)
    const userId = leaveRequestData.user_id || leaveRequestData.caregiver_id;
    console.log(`🏖️ Processing leave for ${userId}: ${leaveRequestData.start_date} to ${leaveRequestData.end_date}`);

    if (!userId) {
      throw new Error("No user ID found in leave request data (checked both user_id and caregiver_id fields)");
    }

    // Handle different date formats (Firebase Timestamp or string)
    const startDate = leaveRequestData.start_date?.toDate ? leaveRequestData.start_date.toDate() : new Date(leaveRequestData.start_date);
    const endDate = leaveRequestData.end_date?.toDate ? leaveRequestData.end_date.toDate() : new Date(leaveRequestData.end_date);
    
    if (isNaN(startDate) || isNaN(endDate)) {
      throw new Error(`Invalid date format in leave request: start=${leaveRequestData.start_date}, end=${leaveRequestData.end_date}`);
    }
    
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    
    let processedDays = 0;
    let skippedDays = 0;
    const results = [];

    // Calculate total days in leave period for logging
    const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    // Loop through each day in the leave period
    for (let currentDate = new Date(startDate); currentDate <= endDate; currentDate.setDate(currentDate.getDate() + 1)) {
      const dateStr = currentDate.toISOString().slice(0, 10);
      const dayIndex = currentDate.getDay(); // 0=Sunday,1=Monday...
      const dayName = daysOfWeek[dayIndex === 0 ? 6 : dayIndex - 1]; // Convert to our format

      console.log(`\n📅 ========== Processing Day ${processedDays + skippedDays + 1}/${totalDays} ==========`);
      console.log(`Date: ${dateStr} (${dayName}), Day index: ${dayIndex}`);

      // Find the user's assignment for this day
      const userAssignment = assignments.find((a) =>
        (a.user_id === userId || a.caregiver_id === userId) &&
        a.is_current &&
        Array.isArray(a.days_assigned) &&
        a.days_assigned.map(d => d.toLowerCase()).includes(dayName.toLowerCase())
      );

      console.log(`🔍 Looking for assignment: user_id/caregiver_id=${userId}, is_current=true, days_assigned includes "${dayName}"`);
      if (userAssignment) {
        console.log(`✅ Found assignment:`, {
          id: userAssignment.id,
          house_id: userAssignment.house_id,
          shift: userAssignment.shift,
          days_assigned: userAssignment.days_assigned
        });
      } else {
        console.log(`❌ No assignment found. Available assignments for user:`, 
          assignments.filter(a => a.user_id === userId || a.caregiver_id === userId).map(a => ({
            id: a.id,
            is_current: a.is_current,
            days_assigned: a.days_assigned,
            house_id: a.house_id,
            shift: a.shift
          }))
        );
      }

      if (!userAssignment) {
        console.log(`⏭️ Skipping ${dateStr} - user not scheduled to work on ${dayName}`);
        skippedDays++;
        continue;
      }

      // Check if already marked absent/on leave for this date
      const existingAbsence = await checkUserAbsence(userId, dateStr, leaveRequestData.user_type);
      if (existingAbsence) {
        console.log(`⏭️ Skipping ${dateStr} - already marked as absent/on leave`);
        skippedDays++;
        continue;
      }

      try {
        // Create "on leave" absence record
        const absenceRecord = {
          user_id: userId,
          user_type: leaveRequestData.user_type || "caregiver",
          absence_date: dateStr,
          created_at: Timestamp.now(),
          marked_by: "admin",
          status: "active",
          absence_type: "on_leave", // Mark as on leave instead of absent
          leave_request_id: leaveRequestData.id, // Reference to the original leave request
          leave_reason: leaveRequestData.reason,
          house_id: userAssignment.house_id,
          shift: userAssignment.shift,
          assignment_version: userAssignment.version,
          is_leave: true, // Flag to prevent auto-clearing
          do_not_clear: true // Extra protection flag
        };
        
        const absenceDocRef = await addDoc(collection(db, "nurse_cg_absence"), absenceRecord);
        console.log(`✅ Created leave record for ${userId} on ${dateStr} (ID: ${absenceDocRef.id})`);

        // If this is a caregiver, handle elderly redistribution
        if (leaveRequestData.user_type === "caregiver" || !leaveRequestData.user_type) {
          console.log(`👴 Checking elderly assignments for redistribution...`);
          console.log(`Looking for elderly_assignments with: user_id=${userId}, version=${userAssignment.version}, day=${dayName}`);
          
          // Get the caregiver's assigned elderly for this day
          const originalAssignedEAs = elderlyAssigns.filter(
            (ea) =>
              ea.user_id === userId &&
              ea.assign_version === userAssignment.version &&
              (ea.day || "").toLowerCase() === dayName.toLowerCase()
          );

          console.log(`📋 Found ${originalAssignedEAs.length} original elderly assignments for ${dayName}`);

          // Get temp assignments TO this caregiver for this date
          const tempAssignmentsToThisCaregiver = tempReassigns.filter(
            (t) =>
              t.to_user_id === userId &&
              t.date === dateStr &&
              t.assign_version === userAssignment.version
          );

          console.log(`📋 Found ${tempAssignmentsToThisCaregiver.length} temp assignments TO this caregiver for ${dateStr}`);

          // Combine all elderly that need redistribution
          const originalElderIds = originalAssignedEAs.flatMap((ea) => ea.elderly_ids || []);
          const tempElderIds = tempAssignmentsToThisCaregiver.flatMap((t) => t.elderly_ids || []);
          
          console.log(`👴 Original elderly IDs (${originalElderIds.length}):`, originalElderIds);
          console.log(`👴 Temp elderly IDs (${tempElderIds.length}):`, tempElderIds);
          
          // Remove temp assignments TO this caregiver for this date
          if (tempAssignmentsToThisCaregiver.length > 0) {
            const removePromises = tempAssignmentsToThisCaregiver.map(t => 
              deleteDoc(doc(db, "temporary_assignments", t.id))
            );
            await Promise.all(removePromises);
          }

          // Find available caregivers for coverage
          console.log(`🔍 Looking for coverage caregivers in house ${userAssignment.house_id}, shift ${userAssignment.shift}, day ${dayName}`);
          
          const availableCaregivers = assignments.filter((a) =>
            a.house_id === userAssignment.house_id &&
            a.shift === userAssignment.shift &&
            a.id !== userAssignment.id &&
            a.is_current &&
            Array.isArray(a.days_assigned) &&
            a.days_assigned.map(d => d.toLowerCase()).includes(dayName.toLowerCase())
          );

          console.log(`📊 Found ${availableCaregivers.length} potential coverage caregivers`);

          // Check which caregivers are not absent
          const caregiverIds = availableCaregivers.map(a => a.user_id || a.caregiver_id);
          const absenceMap = await checkMultipleUserAbsences(caregiverIds, dateStr);
          const coverageCaregivers = availableCaregivers.filter(a => !absenceMap[a.user_id || a.caregiver_id]);

          console.log(`✅ ${coverageCaregivers.length} caregivers available (not absent) for coverage`);
          coverageCaregivers.forEach((cg, idx) => {
            console.log(`  ${idx + 1}. ${cg.user_id || cg.caregiver_id} in ${cg.house_id} ${cg.shift}`);
          });

          if (coverageCaregivers.length > 0 && (originalElderIds.length > 0 || tempElderIds.length > 0)) {
            // Redistribute elderly to available caregivers
            const allElderIds = [...new Set([...originalElderIds, ...tempElderIds])];
            console.log(`🔄 Redistributing ${allElderIds.length} unique elderly among ${coverageCaregivers.length} caregivers`);
            
            const chunks = splitIntoChunks(allElderIds, coverageCaregivers.length);
            
            console.log(`📦 Distribution chunks:`);
            chunks.forEach((chunk, idx) => {
              console.log(`  Caregiver ${idx + 1} (${coverageCaregivers[idx]?.user_id || coverageCaregivers[idx]?.caregiver_id}): ${chunk.length} elderly`);
            });
            
            const redistributionPromises = [];
            for (let i = 0; i < coverageCaregivers.length; i++) {
              if (chunks[i] && chunks[i].length > 0) {
                const tempAssignment = {
                  from_user_id: userId,
                  to_user_id: coverageCaregivers[i].user_id || coverageCaregivers[i].caregiver_id,
                  elderly_ids: chunks[i],
                  user_type: leaveRequestData.user_type || "caregiver", // NEW: Track user type (caregiver or nurse)
                  assignment_type: "absence_coverage",
                  day: dayName,
                  shift: userAssignment.shift,
                  status: "active",
                  expires_at: null,
                  date: dateStr,
                  assign_version: userAssignment.version,
                  reason: `Leave coverage - ${leaveRequestData.leave_type}`,
                  created_at: Timestamp.now()
                };
                
                console.log(`📝 Creating temp assignment: ${chunks[i].length} elderly from ${userId} to ${tempAssignment.to_user_id} for ${dateStr}`);
                
                redistributionPromises.push(
                  addDoc(collection(db, "temporary_assignments"), tempAssignment)
                );
              }
            }

            await Promise.all(redistributionPromises);
            console.log(`✅ Successfully created ${redistributionPromises.length} temporary assignments for ${dateStr}`);
            console.log(`✅ Redistributed ${allElderIds.length} elderly to ${coverageCaregivers.length} caregivers for ${dateStr}`);
          } else if (originalElderIds.length > 0 || tempElderIds.length > 0) {
            console.warn(`⚠️ No coverage caregivers available! ${originalElderIds.length + tempElderIds.length} elderly cannot be redistributed for ${dateStr}`);
          } else {
            console.log(`ℹ️ No elderly to redistribute for ${dateStr}`);
          }
        }

        results.push({
          date: dateStr,
          day: dayName,
          status: "success",
          message: "Marked on leave and assignments redistributed"
        });

        processedDays++;

      } catch (dayError) {
        console.error(`❌ Error processing leave for ${dateStr}:`, dayError);
        results.push({
          date: dateStr,
          day: dayName,
          status: "error",
          message: dayError.message
        });
      }
    }

    console.log(`\n✅ Leave processed: ${processedDays}/${totalDays} days (${skippedDays} skipped)\n`);

    return {
      success: true,
      processedDays,
      skippedDays,
      results,
      message: `Leave processed for ${processedDays} days (${skippedDays} days skipped)`
    };

  } catch (error) {
    console.error("Error processing approved leave:", error);
    throw new Error(`Failed to process leave: ${error.message}`);
  }
};
