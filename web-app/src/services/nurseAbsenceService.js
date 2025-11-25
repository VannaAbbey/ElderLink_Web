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

    console.log(`\n%c┌─────────────────────────────────────────────────────────────┐`, 'color: #FF6B6B; font-weight: bold');
    console.log(`%c│ 🚨 MARKING NURSE ABSENT - START                            │`, 'color: #FF6B6B; font-weight: bold');
    console.log(`%c└─────────────────────────────────────────────────────────────┘`, 'color: #FF6B6B; font-weight: bold');
    console.log(`%c📋 Nurse ID: ${assign.user_id}`, 'color: #4ECDC4; font-weight: bold');
    console.log(`%c📅 Date: ${useDateStr} | Day: ${dayName}`, 'color: #4ECDC4; font-weight: bold');
    console.log(`%c⏰ Shift: ${assign.shift}`, 'color: #4ECDC4; font-weight: bold');
    console.log(`%cAssignment Details:`, 'color: #95E1D3', assign);

    // 1. Get the nurse's assigned elderly for the TARGET DAY only
    console.log(`\n%c━━━ STEP 1: Collecting Elderly to Reassign ━━━`, 'color: #FFD93D; font-weight: bold; font-size: 14px');
    console.log(`%c📊 Total nurse-elderly assignments in system: ${nurseElderlyAssignments.length}`, 'color: #6BCB77');
    console.log(`%c🔍 Searching for elderly with:`, 'color: #6BCB77');
    console.log(`   - user_id: ${assign.user_id}`);
    console.log(`   - day: ${dayName}`);
    console.log(`   - shift: ${assign.shift}`);

    // Get the original assignments from the database
    const originalAssignedEAs = nurseElderlyAssignments.filter(
      (ea) =>
        ea.user_id === assign.user_id &&
        (ea.day || "").toLowerCase() === dayName.toLowerCase() &&
        ea.shift === assign.shift
    );

    // Check if this nurse has any temporary assignments TO them for this date
    // (from other absent nurses) that also need to be reassigned
    const tempAssignmentsToThisNurse = tempReassignments.filter(
      (t) =>
        t.to_user_id === assign.user_id &&
        t.date === useDateStr &&
        t.shift === assign.shift
    );

    console.log(`\n%c📦 Original Assignments:`, 'color: #4ECDC4; font-weight: bold');
    console.log(`   Count: ${originalAssignedEAs.length} assignments`);
    originalAssignedEAs.forEach((ea, idx) => {
      console.log(`   [${idx + 1}] ${ea.elderly_ids?.length || 0} elderly`, ea.elderly_ids);
    });
    
    console.log(`\n%c🔄 Temporary Assignments TO this nurse:`, 'color: #F38181; font-weight: bold');
    console.log(`   Count: ${tempAssignmentsToThisNurse.length} temp assignments`);
    tempAssignmentsToThisNurse.forEach((t, idx) => {
      console.log(`   [${idx + 1}] From: ${t.from_user_id} → ${t.elderly_ids?.length || 0} elderly`, t.elderly_ids);
    });

    // ✅ NEW APPROACH: Collect ALL elderly that need reassignment
    // Both original AND temporary elderly will be redistributed to available nurses
    const originalElderIds = originalAssignedEAs.flatMap(ea => ea.elderly_ids || []);
    const tempElderIds = tempAssignmentsToThisNurse.flatMap(t => t.elderly_ids || []);
    
    // Combine both for redistribution
    const allElderlyToReassign = [...originalElderIds, ...tempElderIds];
    
    console.log(`\n%c✅ ELDERLY TO REASSIGN: ${allElderlyToReassign.length} TOTAL`, 'color: #95E1D3; font-weight: bold; font-size: 15px');
    console.log(`%c   - From original assignments: ${originalElderIds.length}`, 'color: #95E1D3');
    console.log(`%c   - From temp assignments (cascade): ${tempElderIds.length}`, 'color: #FF6B6B');
    console.log(`%c   - Combined list to redistribute:`, 'color: #95E1D3', allElderlyToReassign);

    // 3. Delete any existing temporary assignments TO this nurse
    // ✅ These will be replaced with NEW temp assignments to other available nurses
    if (tempAssignmentsToThisNurse.length > 0) {
      console.log(`\n%c━━━ STEP 3: Handling Cascade Reassignments ━━━`, 'color: #FFD93D; font-weight: bold; font-size: 14px');
      console.log(`%c⚠️  Deleting ${tempAssignmentsToThisNurse.length} temp assignments TO ${assign.user_id}`, 'color: #FF6B6B; font-weight: bold');
      console.log(`%c   These ${tempElderIds.length} temp elderly will be REASSIGNED to remaining nurses (not returned)`, 'color: #FFD93D');
      const removePromises = tempAssignmentsToThisNurse.map(t => {
        console.log(`   - Deleting temp from ${t.from_user_id}: ${t.elderly_ids?.length || 0} elderly`);
        return deleteDoc(doc(db, "temporary_assignments", t.id));
      });
      await Promise.all(removePromises);
      console.log(`%c✅ Old temp assignments deleted - will create NEW ones to remaining nurses`, 'color: #95E1D3; font-weight: bold');
    }

    // 4. Find other nurses in the SAME shift who can cover for that DAY
    // ✅ FIX: Must exclude nurses who are ALREADY ABSENT on this date
    console.log(`\n%c━━━ STEP 2: Finding Available Coverage Nurses ━━━`, 'color: #FFD93D; font-weight: bold; font-size: 14px');
    console.log(`Looking for coverage nurses with:`);
    console.log(`- Same shift: ${assign.shift}`);
    console.log(`- Working on day (${dayName})`);
    console.log(`- Not absent for the same date`);
    console.log(`- Current assignments`);

    // First, get all potentially available nurses
    const potentialCoverage = assignments.filter((a) =>
      a.shift === assign.shift &&
      a.id !== assignDocId &&
      a.is_current &&
      // ensure they are scheduled to work on the target day
      Array.isArray(a.days_assigned) &&
      a.days_assigned.map(d => d.toLowerCase()).includes(dayName.toLowerCase())
    );

    console.log(`\n%c🔍 Found ${potentialCoverage.length} potential nurses, checking for existing absences...`, 'color: #FFD93D; font-weight: bold');

    // ✅ FIX: Filter out nurses who are already absent on this date
    const otherAssigns = [];
    for (const nurse of potentialCoverage) {
      const absenceCheck = await hasAbsenceForDate(nurse.user_id, useDateStr, assign.shift);
      if (absenceCheck.hasAbsence) {
        console.log(`   ❌ ${nurse.user_id} is ALREADY ABSENT on ${useDateStr} - excluding from coverage`);
      } else {
        console.log(`   ✅ ${nurse.user_id} is available for coverage`);
        otherAssigns.push(nurse);
      }
    }

    console.log(`\n%c✅ Final count: ${otherAssigns.length} available nurses to cover:`, 'color: #4ECDC4; font-weight: bold');
    otherAssigns.forEach((a, idx) => {
      console.log(`   [${idx + 1}] ${a.user_id} | Days: ${a.days_assigned?.join(', ')}`);
    });

    // ⚠️ CRITICAL CHECK: If NO nurses available, this is an EMERGENCY situation
    if (otherAssigns.length === 0) {
      console.log(`\n%c🆘 EMERGENCY: NO NURSES AVAILABLE FOR COVERAGE!`, 'color: #FF0000; font-weight: bold; font-size: 16px');
      console.log(`%c   This shift (${assign.shift}) now has ZERO coverage for ${dayName}`, 'color: #FF6B6B; font-weight: bold');
      console.log(`%c   Creating absence record WITHOUT redistribution...`, 'color: #FFD93D; font-weight: bold');
      console.log(`%c   🚨 EMERGENCY COVERAGE WILL BE REQUIRED!`, 'color: #FF0000; font-weight: bold');
      
      // Create absence record even without redistribution
      const absenceRecord = {
        user_id: assign.user_id,
        user_type: "nurse",
        absence_date: useDateStr,
        absence_type: "absent",
        shift: assign.shift,
        house_id: assign.house_id || null,
        assignment_version: assign.version || 1,
        status: "active",
        marked_by: markedBy,
        created_at: Timestamp.now()
      };
      
      const absenceDocRef = await addDoc(collection(db, "nurse_cg_absence"), absenceRecord);
      console.log(`%c✅ Absence record created (ID: ${absenceDocRef.id})`, 'color: #95E1D3; font-weight: bold');
      console.log(`%c⚠️  WARNING: ${allElderlyToReassign.length} elderly have NO coverage!`, 'color: #FF6B6B; font-weight: bold');
      
      return {
        success: true,
        requiresEmergency: true,
        message: `EMERGENCY: No nurses available! This shift now has ZERO coverage. Emergency coverage required.`,
        absenceId: absenceDocRef.id,
        elderlyWithoutCoverage: allElderlyToReassign.length
      };
    }

    // 5. Split ALL elderly (original + cascade temp) evenly among available nurses
    // ✅ NEW APPROACH: Redistribute both original and temp elderly to remaining nurses
    console.log(`\n%c━━━ STEP 4: Creating Temporary Reassignments ━━━`, 'color: #FFD93D; font-weight: bold; font-size: 14px');
    console.log(`%c📦 Splitting ${allElderlyToReassign.length} elderly among ${otherAssigns.length} nurses...`, 'color: #6BCB77; font-weight: bold');
    console.log(`%c   (${originalElderIds.length} original + ${tempElderIds.length} cascade)`, 'color: #6BCB77');
    const chunks = splitIntoChunks(allElderlyToReassign, otherAssigns.length);
    console.log(`\n%c🔄 Redistribution Plan:`, 'color: #4ECDC4; font-weight: bold');
    chunks.forEach((chunk, i) => {
      console.log(`   [${i + 1}] ${otherAssigns[i]?.user_id} → ${chunk.length} elderly`, chunk);
    });

    const promises = [];
    for (let i = 0; i < otherAssigns.length; i++) {
      const target = otherAssigns[i];
      const chunk = chunks[i] || [];
      console.log(`Assigning ${chunk.length} elderly to nurse ${target.user_id}`);

      if (chunk.length > 0) {
        const reassignmentData = {
          assignment_type: "temporary_absence_coverage",
          created_at: Timestamp.now(),
          date: useDateStr,
          day: dayName,
          shift: assign.shift,
          elderly_ids: chunk,
          from_user_id: assign.user_id,
          to_user_id: target.user_id,
          user_type: "nurse", // NEW: Track user type for consistency with unified schema
          status: "active",
          expires_at: null, // null means it expires at end of shift/day
          assign_version: 1
        };
        console.log(`Creating temp reassignment:`, reassignmentData);

        promises.push(addDoc(collection(db, "temporary_assignments"), reassignmentData));
      }
    }

    await Promise.all(promises);
    console.log(`\n%c✅ ${promises.length} temporary reassignments created successfully`, 'color: #95E1D3; font-weight: bold');

    // 6. Create absence record in nurse_cg_absence collection (using SAME schema as caregivers)
    console.log(`\n%c━━━ STEP 5: Creating Absence Record ━━━`, 'color: #FFD93D; font-weight: bold; font-size: 14px');
    const absenceRecord = {
      user_id: assign.user_id,
      user_type: "nurse",
      absence_date: useDateStr,
      absence_type: "absent",
      shift: assign.shift,
      house_id: assign.house_id || null, // May not always have house_id for nurses
      assignment_version: assign.version || 1,
      status: "active",
      marked_by: markedBy,
      created_at: Timestamp.now()
    };

    console.log(`%c📝 Absence Record:`, 'color: #4ECDC4; font-weight: bold', absenceRecord);
    const absenceDocRef = await addDoc(collection(db, "nurse_cg_absence"), absenceRecord);
    console.log(`%c✅ Absence record created with ID: ${absenceDocRef.id}`, 'color: #95E1D3; font-weight: bold');

    console.log(`\n%c┌─────────────────────────────────────────────────────────────┐`, 'color: #95E1D3; font-weight: bold');
    console.log(`%c│ ✅ NURSE MARKED ABSENT - COMPLETE                          │`, 'color: #95E1D3; font-weight: bold');
    console.log(`%c└─────────────────────────────────────────────────────────────┘\n`, 'color: #95E1D3; font-weight: bold');
    return { 
      success: true, 
      message: "Nurse marked as absent and elderly reassigned",
      absenceId: absenceDocRef.id
    };

  } catch (error) {
    console.error("%c❌ ERROR marking nurse absent:", 'color: #FF6B6B; font-weight: bold', error);
    throw new Error("Failed to mark nurse as absent");
  }
};

// NOTE: unmarkNurseAbsent function has been REMOVED
// Marking a nurse as absent is now a PERMANENT action that cannot be undone
// This ensures absence records maintain their integrity for audit and historical purposes

// Reset daily absences (LEGACY function - only for cleanup of old house_shift_assignments data)
// New absences are tracked in nurse_cg_absence_v2 and don't need daily resets
export const resetDailyNurseAbsences = async () => {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const snap = await getDocs(query(
      collection(db, "house_shift_assignments"),
      where("user_type", "==", "nurse")
    ));

    // Legacy reset code - no longer needed since we use centralized nurse_cg_absence_v2 collection
    // Absence status is now tracked separately, not in assignment documents
    const resetPromises = [];

    await Promise.all(resetPromises);
    return { success: true, message: "Daily nurse absences reset" };

  } catch (error) {
    console.error("Error resetting daily nurse absences:", error);
    throw new Error("Failed to reset daily nurse absences");
  }
};

// Unmark nurse as absent (UNDO absence)
export const unmarkNurseAbsent = async (
  userId,
  targetDateStr,
  shift,
  houseId,
  userType = "nurse"
) => {
  try {
    console.log(`\n%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #4ECDC4; font-weight: bold');
    console.log(`%c🔄 UNMARKING NURSE AS ABSENT (UNDO)`, 'color: #4ECDC4; font-weight: bold; font-size: 14px');
    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #4ECDC4; font-weight: bold');
    console.log(`%c📍 User ID: ${userId}`, 'color: #FFD93D');
    console.log(`%c📅 Date: ${targetDateStr}`, 'color: #FFD93D');
    console.log(`%c⏰ Shift: ${shift}`, 'color: #FFD93D');
    console.log(`%c🏠 House: ${houseId}`, 'color: #FFD93D');

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
      console.warn(`⚠️ No active absence record found for nurse ${userId} on ${targetDateStr}`);
      return { success: false, message: "No active absence record found" };
    }

    // Update absence status to "unmarked"
    const absenceDoc = absenceSnap.docs[0];
    
    await updateDoc(doc(db, "nurse_cg_absence", absenceDoc.id), {
      status: "unmarked",
      unmarked_at: Timestamp.now(),
      unmarked_by: "admin"
    });

    console.log(`✅ Updated absence record to "unmarked" status`);

    console.log(`\n%c━━━ STEP 2: Check for Other Absent Nurses ━━━`, 'color: #FFD93D; font-weight: bold; font-size: 14px');

    // 2. Get all OTHER nurses who are STILL ABSENT in the same shift/date
    const allAbsencesQuery = query(
      collection(db, "nurse_cg_absence"),
      where("absence_date", "==", targetDateStr),
      where("shift", "==", shift),
      where("status", "==", "active"),
      where("user_type", "==", "nurse")
    );

    const allAbsencesSnap = await getDocs(allAbsencesQuery);
    const stillAbsentNurseIds = allAbsencesSnap.docs.map(d => d.data().user_id);
    
    console.log(`👥 Other nurses still absent: ${stillAbsentNurseIds.length}`);
    if (stillAbsentNurseIds.length > 0) {
      console.log(`   Still absent:`, stillAbsentNurseIds);
    }

    console.log(`\n%c━━━ STEP 3: Delete Temporary Assignments ━━━`, 'color: #FFD93D; font-weight: bold; font-size: 14px');

    // 3. Delete ALL temporary assignments for this shift/date
    const tempReassignQuery = query(
      collection(db, "temporary_assignments"),
      where("date", "==", targetDateStr),
      where("shift", "==", shift)
    );

    const tempSnap = await getDocs(tempReassignQuery);
    const batch = writeBatch(db);
    let deletedCount = 0;

    console.log(`   Found ${tempSnap.docs.length} total temp assignments for ${targetDateStr} ${shift} shift`);

    tempSnap.docs.forEach((docSnap) => {
      const data = docSnap.data();
      
      console.log(`🗑️ Deleting temp assignment:`, {
        id: docSnap.id,
        from: data.from_user_id,
        to: data.to_user_id,
        elderly_count: (data.elderly_ids || []).length
      });
      
      batch.delete(doc(db, "temporary_assignments", docSnap.id));
      deletedCount++;
    });

    if (deletedCount > 0) {
      await batch.commit();
      console.log(`✅ Deleted ${deletedCount} temporary assignment(s)`);
    } else {
      console.log(`ℹ️ No temporary assignments found to delete`);
    }

    console.log(`\n%c━━━ STEP 4: Redistribute Elderly (if needed) ━━━`, 'color: #FFD93D; font-weight: bold; font-size: 14px');

    // 4. REDISTRIBUTE elderly if there are still absent nurses
    if (stillAbsentNurseIds.length > 0) {
      console.log(`🔄 Redistribution needed - ${stillAbsentNurseIds.length} nurse(s) still absent`);
      
      // Convert date to day name
      const targetDate = new Date(targetDateStr + "T00:00:00");
      const indexToDayName = {
        0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 
        4: "Thursday", 5: "Friday", 6: "Saturday"
      };
      const dayName = indexToDayName[targetDate.getDay()];
      
      console.log(`   Day: ${dayName}, Shift: ${shift}`);

      // Get ALL nurse elderly assignments for this shift/day
      const nurseElderlyQuery = query(
        collection(db, "elderly_assignments"),
        where("shift", "==", shift),
        where("day", "==", dayName),
        where("user_type", "==", "nurse")
      );
      
      const nurseElderlySnap = await getDocs(nurseElderlyQuery);
      console.log(`📊 Found ${nurseElderlySnap.docs.length} nurse elderly assignment documents`);
      
      // 🔧 FIX: Collect elderly ONLY from ABSENT nurses (not from present ones)
      const elderlyFromAbsentNurses = new Set();
      
      nurseElderlySnap.docs.forEach(docSnap => {
        const data = docSnap.data();
        const nurseUserId = data.user_id;
        const elderlyIds = data.elderly_ids || [];
        
        // ✅ Only add if this nurse is STILL ABSENT
        if (stillAbsentNurseIds.includes(nurseUserId)) {
          elderlyIds.forEach(id => elderlyFromAbsentNurses.add(id));
          console.log(`   📦 Collecting ${elderlyIds.length} elderly from ABSENT nurse: ${nurseUserId}`);
        } else {
          console.log(`   ⏭️  Skipping ${elderlyIds.length} elderly from PRESENT nurse: ${nurseUserId}`);
        }
      });
      
      const elderlyToRedistribute = Array.from(elderlyFromAbsentNurses);
      console.log(`Total elderly to redistribute (from absent nurses only): ${elderlyToRedistribute.length}`);
      
      if (elderlyToRedistribute.length > 0) {
        // Find ALL AVAILABLE nurses (not absent, including the one we just unmarked)
        const nurseAssignmentsQuery = query(
          collection(db, "house_shift_assignments"),
          where("shift", "==", shift),
          where("is_current", "==", true),
          where("user_type", "==", "nurse")
        );
        
        const nurseAssignmentsSnap = await getDocs(nurseAssignmentsQuery);
        const availableNurses = nurseAssignmentsSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(n => {
            const isAbsent = stillAbsentNurseIds.includes(n.user_id);
            const worksOnDay = (n.days_assigned || []).map(d => d.toLowerCase()).includes(dayName.toLowerCase());
            return !isAbsent && worksOnDay;
          });
        
        console.log(`👥 Available nurses: ${availableNurses.length} (including ${userId})`);
        
        if (availableNurses.length > 0) {
          // Split elderly evenly among available nurses
          const chunks = splitIntoChunks(elderlyToRedistribute, availableNurses.length);
          const redistributeBatch = writeBatch(db);
          
          console.log(`\n%c🔄 Redistribution Plan:`, 'color: #4ECDC4; font-weight: bold');
          for (let i = 0; i < availableNurses.length; i++) {
            const nurse = availableNurses[i];
            const elderlyChunk = chunks[i];
            
            if (elderlyChunk && elderlyChunk.length > 0) {
              console.log(`   ${i + 1}. Nurse ${nurse.user_id}: +${elderlyChunk.length} temp elderly`);
              
              const tempAssignRef = doc(collection(db, "temporary_assignments"));
              redistributeBatch.set(tempAssignRef, {
                from_user_id: stillAbsentNurseIds[0], // Placeholder
                to_user_id: nurse.user_id,
                elderly_ids: elderlyChunk,
                date: targetDateStr,
                day: dayName,
                shift: shift,
                user_type: "nurse",
                reason: `Redistribution after unmarking ${userId}`,
                assignment_type: "redistribution",
                created_at: Timestamp.now(),
                assign_version: nurse.version || 1
              });
            }
          }
          
          await redistributeBatch.commit();
          console.log(`✅ Redistributed ${elderlyToRedistribute.length} elderly among ${availableNurses.length} nurses`);
        } else {
          console.log(`⚠️ No available nurses for redistribution`);
        }
      } else {
        console.log(`ℹ️ No elderly to redistribute`);
      }
    } else {
      console.log(`✅ No redistribution needed - all nurses present`);
    }

    console.log(`\n%c━━━ STEP 5: Update Attendance Record (if exists) ━━━`, 'color: #FFD93D; font-weight: bold; font-size: 14px');

    // 5. Update attendance collection - set is_present back to true
    // This is important for cases where the absence was auto-marked from the mobile app
    try {
      const attendanceQuery = query(
        collection(db, "attendance"),
        where("user_id", "==", userId),
        where("date", "==", targetDateStr),
        where("shift", "==", shift),
        where("user_type", "==", "nurse")
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
        // CRITICAL FIX: Create attendance record to prevent auto-absence from re-marking
        console.log(`⚠️ No attendance record found - creating one to mark nurse as present`);
        await addDoc(collection(db, "attendance"), {
          user_id: userId,
          user_type: "nurse",
          date: targetDateStr,
          shift: shift,
          is_present: true,
          reason: "Absence unmarked by admin",
          created_at: Timestamp.now(),
          created_by: "admin",
          update_reason: "Absence unmarked - preventing auto-absence re-marking"
        });
        console.log(`✅ Created attendance record with is_present = true`);
      }
    } catch (attendanceError) {
      console.warn(`⚠️ Could not update attendance record:`, attendanceError.message);
      // Don't fail the entire operation if attendance update fails
    }

    // 6. Log the unmark action
    await addDoc(collection(db, "activity_logs"), {
      action: "Nurse Absence Unmarked (UNDO)",
      user_id: userId,
      date: targetDateStr,
      shift: shift,
      house_id: houseId,
      user_type: "nurse",
      unmarked_by: "admin",
      temporary_assignments_deleted: deletedCount,
      timestamp: Timestamp.now()
    });

    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #95E1D3; font-weight: bold');
    console.log(`%c✅ UNMARK NURSE ABSENCE COMPLETE`, 'color: #95E1D3; font-weight: bold; font-size: 14px');
    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`, 'color: #95E1D3; font-weight: bold');

    return {
      success: true,
      message: `Successfully unmarked nurse as absent`,
      deletedTempAssignments: deletedCount,
      userId,
      date: targetDateStr,
      shift,
      houseId
    };

  } catch (error) {
    console.error("❌ Error unmarking nurse absence:", error);
    throw new Error(`Failed to unmark nurse absence: ${error.message}`);
  }
};

// Get temporary reassignments for a specific date and shift
// For 3rd shift, also includes reassignments from the previous day
// because 3rd shift runs from 10 PM to 6 AM (crosses midnight)
export const getTempReassignments = async (dateStr = null, shift = null) => {
  try {
    const targetDate = dateStr || new Date().toISOString().slice(0, 10);
    
    // For 3rd shift, we need to check both current date and previous date
    // because temp reassignments created at 10 PM yesterday are still valid until 6 AM today
    const datesToCheck = [targetDate];
    
    if (shift === "3rd") {
      const prevDate = new Date(targetDate);
      prevDate.setDate(prevDate.getDate() - 1);
      datesToCheck.push(prevDate.toISOString().slice(0, 10));
      console.log(`🌙 3rd shift: Checking temp reassignments for both ${targetDate} and ${datesToCheck[1]}`);
    }
    
    // Query all relevant dates
    const allReassignments = [];
    
    for (const date of datesToCheck) {
      let q = query(
        collection(db, "temporary_assignments"),
        where("date", "==", date)
      );

      if (shift) {
        q = query(q, where("shift", "==", shift));
      }

      const snap = await getDocs(q);
      const reassignments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      allReassignments.push(...reassignments);
    }
    
    // Remove duplicates based on document ID
    const uniqueReassignments = allReassignments.filter((item, index, self) =>
      index === self.findIndex(t => t.id === item.id)
    );
    
    console.log(`📋 Found ${uniqueReassignments.length} temp reassignments for ${targetDate} ${shift || 'all shifts'}`);
    return uniqueReassignments;

  } catch (error) {
    console.error("Error getting temp reassignments:", error);
    return [];
  }
};

// NOTE: isNurseAbsent function removed - use hasAbsenceForDate() instead
// The old function relied on assignment fields which could be unreliable for multi-day absences
// Use hasAbsenceForDate(nurseId, dateStr, shift) for comprehensive absence checking

// Check if a nurse has ANY absence for a specific date (using unified schema)
export const hasAbsenceForDate = async (nurseId, dateStr, shift = null) => {
  try {
    console.log(`🔍 Checking absence for nurse ${nurseId} on ${dateStr} shift ${shift}`);
    
    // Query nurse_cg_absence collection using unified schema
    let absenceQuery = query(
      collection(db, "nurse_cg_absence"),
      where("user_id", "==", nurseId),
      where("user_type", "==", "nurse"),
      where("absence_date", "==", dateStr),
      where("status", "==", "active")
    );
    
    if (shift) {
      absenceQuery = query(absenceQuery, where("shift", "==", shift));
    }
    
    const absenceSnapshot = await getDocs(absenceQuery);
    if (absenceSnapshot.size > 0) {
      console.log(`✅ Found absence for nurse ${nurseId}`);
      return { hasAbsence: true, source: "nurse_cg_absence" };
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
      ea => ea.user_id === nurseId && 
           ea.day.toLowerCase() === dayName.toLowerCase() && 
           ea.shift === shift
    );

    // Get temporary assignments TO this nurse
    const tempAssignments = await getTempReassignments(dateStr, shift);
    const tempToThisNurse = tempAssignments.filter(t => t.to_user_id === nurseId);

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
    // Note: sync_status field removed from new schema - returning success for backward compatibility
    return { success: true };
  } catch (error) {
    console.error("Error updating temp reassignment sync status:", error);
    return { success: false, error: error.message };
  }
};

// Get temporary reassignments pending sync for mobile app
export const getTempReassignmentsPendingSync = async () => {
  try {
    // Note: sync_status field removed from new schema - returning all active assignments for backward compatibility
    const q = query(
      collection(db, "temporary_assignments"),
      where("status", "==", "active")
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
    from_nurse_id: reassignment.from_user_id, // Map new field to old for backward compatibility
    to_nurse_id: reassignment.to_user_id, // Map new field to old for backward compatibility
    date: reassignment.date,
    day: reassignment.day,
    shift: reassignment.shift,
    assignment_type: reassignment.assignment_type || "temporary_absence_coverage",
    status: reassignment.status || "active",
    created_at: reassignment.created_at,
    expires_at: reassignment.expires_at,
    assign_version: reassignment.assign_version || 1
  };
};

// Batch update sync status for multiple temp reassignments
export const batchUpdateTempReassignmentSyncStatus = async (updates) => {
  try {
    const batch = writeBatch(db);
    
    // Note: sync_status field removed from new schema - batch update is a no-op for backward compatibility
    updates.forEach(update => {
      // Skip actual update since sync_status no longer exists in schema
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

// Get complete absence history for a staff member (using unified schema)
export const getStaffAbsenceHistory = async (staffId, staffType = "nurse", options = {}) => {
  try {
    const {
      limitCount = null,
      startDate = null,
      endDate = null,
      status = null, // "active" or null for all
      orderByField = "created_at",
      orderDirection = "desc"
    } = options;

    let q = query(
      collection(db, "nurse_cg_absence"),
      where("user_id", "==", staffId),
      where("user_type", "==", staffType)
    );

    // Add date range filters if provided
    if (startDate) {
      q = query(q, where("absence_date", ">=", startDate));
    }
    if (endDate) {
      q = query(q, where("absence_date", "<=", endDate));
    }

    // Add status filter if provided
    if (status) {
      q = query(q, where("status", "==", status));
    }

    // Add ordering and limit
    q = query(q, orderBy(orderByField, orderDirection));
    if (limitCount) {
      q = query(q, limit(limitCount));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  } catch (error) {
    console.error("Error getting staff absence history:", error);
    return [];
  }
};

// Get current active absences for a staff member (using unified schema)
export const getCurrentAbsences = async (staffId, staffType = "nurse") => {
  try {
    const q = query(
      collection(db, "nurse_cg_absence"),
      where("user_id", "==", staffId),
      where("user_type", "==", staffType),
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
      where("user_type", "==", staffType),
      where("absence_date", ">=", startDate),
      where("absence_date", "<=", endDate)
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
      absencesByType: {},
      absencesByShift: { "1st": 0, "2nd": 0, "3rd": 0 },
      absencesByMonth: {},
      // Note: Duration calculation removed as unified schema doesn't track marked_absent_at/marked_present_at
    };

    // Calculate statistics
    history.forEach(absence => {
      // Count by absence type
      const absenceType = absence.absence_type || "absent";
      stats.absencesByType[absenceType] = (stats.absencesByType[absenceType] || 0) + 1;

      // Count by shift
      if (absence.shift) {
        stats.absencesByShift[absence.shift]++;
      }

      // Count by month (using absence_date from unified schema)
      if (absence.absence_date) {
        const month = absence.absence_date.substring(0, 7); // YYYY-MM
        stats.absencesByMonth[month] = (stats.absencesByMonth[month] || 0) + 1;
      }
    });

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
      where("user_id", "==", staffId),
      where("user_type", "==", staffType),
      where("absence_date", "==", targetDate),
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

// Note: Mobile app sync functions removed as unified schema doesn't use sync_status/last_sync_date fields
// If mobile sync is needed, implement separate sync tracking collection

// Get mobile app compatible format for absence history (using unified schema)
export const getAbsenceHistoryMobileFormat = (absenceRecord) => {
  return {
    id: absenceRecord.id,
    user_id: absenceRecord.user_id,
    user_type: absenceRecord.user_type,
    absence_date: absenceRecord.absence_date,
    absence_type: absenceRecord.absence_type,
    shift: absenceRecord.shift,
    house_id: absenceRecord.house_id,
    assignment_version: absenceRecord.assignment_version,
    status: absenceRecord.status,
    marked_by: absenceRecord.marked_by,
    created_at: absenceRecord.created_at
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
      where("user_id", "==", nurseId),
      where("user_type", "==", "nurse")
    );

    // Add filters (using unified schema field names)
    if (startDate) {
      q = query(q, where("absence_date", ">=", startDate));
    }
    if (endDate) {
      q = query(q, where("absence_date", "<=", endDate));
    }
    if (shift) {
      q = query(q, where("shift", "==", shift));
    }
    if (status) {
      q = query(q, where("status", "==", status));
    }

    const snapshot = await getDocs(q);
    const absences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Group by date for easy lookup (using absence_date from unified schema)
    const absencesByDate = {};
    absences.forEach(absence => {
      const date = absence.absence_date;
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
    
    // Query nurse_cg_absence_v2 with unified schema (only need to check one collection now)
    let absenceQuery = query(
      collection(db, "nurse_cg_absence"),
      where("user_id", "in", nurseIds),
      where("user_type", "==", "nurse"),
      where("absence_date", "==", dateStr),
      where("status", "==", "active")
    );
    
    if (shift) {
      absenceQuery = query(absenceQuery, where("shift", "==", shift));
    }
    
    const absenceSnapshot = await getDocs(absenceQuery);
    absenceSnapshot.forEach(doc => {
      const data = doc.data();
      const key = `${data.user_id}-${dateStr}-${shift || 'all'}`;
      results[key] = true;
    });
    
    console.log(`✅ Batch check completed for ${Object.keys(results).length} nurse-date combinations`);
    return results;
    
  } catch (error) {
    console.error("Error batch checking absences:", error);
    return {};
  }
};

