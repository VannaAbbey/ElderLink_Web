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
    console.error("Error checking user absence:", error);
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

    console.log(`=== ABSENCE DEBUGGING ===`);
    console.log(`Marking absent for caregiver: ${userId}`);
    console.log(`Assignment details:`, {
      id: assign.id,
      user_id: assign.user_id,
      caregiver_id: assign.caregiver_id,
      house_id: assign.house_id,
      shift: assign.shift,
      days_assigned: assign.days_assigned,
      version: assign.version
    });
    console.log(`Target Date: ${useDateStr}, Day: ${dayName}`);

    // 1. Create absence record in centralized collection
    const absenceRecord = {
      user_id: userId,
      user_type: "caregiver",
      absence_date: useDateStr,
      created_at: Timestamp.now(),
      marked_by: "admin",
      status: "active",
      absence_type: "absent", // default to absent for regular absences
      house_id: assign.house_id,
      shift: assign.shift,
      assignment_version: assign.version
    };
    
    await addDoc(collection(db, "nurse_cg_absence"), absenceRecord);
    console.log(`✅ Created absence record for caregiver ${userId} on ${useDateStr}`);

    // 2. Get the caregiver's assigned elderly for the TARGET DAY only
    console.log(`Total elderly assignments in system: ${elderlyAssigns.length}`);
    console.log(`Looking for elderly with user_id: ${userId}, version: ${assign.version}, day: ${dayName}`);

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

    console.log(`Original elderly assignments for ${userId} on ${dayName}: ${originalAssignedEAs.length}`, originalAssignedEAs.flatMap(ea => ea.elderly_ids || []));
    console.log(`Temp assignments TO ${userId} for ${useDateStr}: ${tempAssignmentsToThisCaregiver.length}`, tempAssignmentsToThisCaregiver.flatMap(t => t.elderly_ids || []));

    // Combine both original and temporarily assigned elderly that need to be reassigned
    const originalElderIds = originalAssignedEAs.flatMap((ea) => ea.elderly_ids || []); // Handle array structure
    const tempElderIds = tempAssignmentsToThisCaregiver.flatMap((t) => t.elderly_ids || []); // Handle array structure
    
    console.log(`Original elderly from ${userId}: ${originalElderIds.length}`, originalElderIds);
    console.log(`Temp elderly TO ${userId}: ${tempElderIds.length}`, tempElderIds);

    // 3. COMPREHENSIVE CLEANUP: Remove ALL temporary assignments for this date/shift/house combination
    // This ensures we have a clean slate before redistributing everything
    // 
    // Example with 5 caregivers (Maria, Leonora, Teresa, Ana, Carlos):
    // 1. Maria absent → temp assignments: Maria→Leonora, Maria→Teresa
    // 2. Leonora absent → temp assignments: Maria→Teresa (updated), Leonora→Ana, Leonora→Carlos  
    // 3. Teresa absent → We remove ALL temp assignments and redistribute everything fresh
    //    Result: All elderly go to Ana & Carlos only
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

    console.log(`Found ${allRelevantTempAssignments.length} temp assignments to clean up for comprehensive redistribution`);
    allRelevantTempAssignments.forEach((t, idx) => {
      console.log(`  Temp assignment ${idx + 1}: FROM ${t.from_user_id} TO ${t.to_user_id}, elderly: ${t.elderly_ids?.length || 0}`);
    });
    
    // Collect ALL elderly from the temp assignments that will be removed
    const elderlyFromRemovedTempAssignments = allRelevantTempAssignments.flatMap(t => t.elderly_ids || []);
    console.log(`Elderly from temp assignments being removed: ${elderlyFromRemovedTempAssignments.length}`, elderlyFromRemovedTempAssignments);
    
    // Update allElderIds to include elderly from all temp assignments being cleaned up
    // Remove duplicates in case the same elderly appears in multiple temp assignments
    const allElderIds = [...new Set([...originalElderIds, ...elderlyFromRemovedTempAssignments])];
    console.log(`Total unique elderly IDs to redistribute: ${allElderIds.length}`, allElderIds);

    // Remove all relevant temp assignments
    if (allRelevantTempAssignments.length > 0) {
      console.log(`Removing ${allRelevantTempAssignments.length} temp assignments for comprehensive cleanup`);
      const removeAllPromises = allRelevantTempAssignments.map(t => 
        deleteDoc(doc(db, "temporary_assignments", t.id))
      );
      await Promise.all(removeAllPromises);
      console.log(`✅ Removed all relevant temp assignments for clean redistribution`);
    }

    // 4. Find other caregivers in the SAME house & shift who can cover for that DAY
    console.log(`Looking for coverage caregivers with:`);
    console.log(`- Same house: ${assign.house_id}`);
    console.log(`- Same shift: ${assign.shift}`);
    console.log(`- Working on day (${dayName})`);
    console.log(`- Not absent for the same date`);
    console.log(`- Current assignments`);

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

    console.log(`Found ${otherAssigns.length} other caregivers available to cover (out of ${potentialCaregivers.length} potential):`);
    otherAssigns.forEach(a => {
      console.log(`- Caregiver: ${a.user_id || a.caregiver_id}, Days: ${a.days_assigned?.join(', ')}, absent: NO`);
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
      
      // Skip if no elderly to assign to this caregiver
      if (chunk.length === 0) continue;
      
      const targetUserId = target.user_id || target.caregiver_id;
      console.log(`Assigning ${chunk.length} elderly to caregiver ${targetUserId}`);

      // Create single document with elderly_ids array instead of individual documents
      const reassignmentData = {
        elderly_ids: chunk, // Array of elderly IDs instead of single elderly_id
        from_user_id: userId,
        to_user_id: targetUserId,
        assignment_type: "absence_coverage",
        day: dayName,
        shift: assign.shift,
        status: "active",
        expires_at: null,
        date: useDateStr,           // use the target date
        assign_version: assign.version,
        created_at: Timestamp.now(),
      };
      console.log(`Creating temp reassignment:`, reassignmentData);

      promises.push(addDoc(collection(db, "temporary_assignments"), reassignmentData));
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
    
    console.log(`🔍 Checking if emergency coverage needed after marking absence for ${useDateStr}`);
    
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
    console.log(`🏖️ Processing approved leave for user: ${userId}`);
    console.log(`Leave request data:`, leaveRequestData);
    console.log(`Leave period: ${leaveRequestData.start_date} to ${leaveRequestData.end_date}`);

    if (!userId) {
      throw new Error("No user ID found in leave request data (checked both user_id and caregiver_id fields)");
    }

    // Handle different date formats (Firebase Timestamp or string)
    const startDate = leaveRequestData.start_date?.toDate ? leaveRequestData.start_date.toDate() : new Date(leaveRequestData.start_date);
    const endDate = leaveRequestData.end_date?.toDate ? leaveRequestData.end_date.toDate() : new Date(leaveRequestData.end_date);
    
    if (isNaN(startDate) || isNaN(endDate)) {
      throw new Error(`Invalid date format in leave request: start=${leaveRequestData.start_date}, end=${leaveRequestData.end_date}`);
    }

    console.log(`✅ Parsed dates - Start: ${startDate.toISOString().slice(0, 10)}, End: ${endDate.toISOString().slice(0, 10)}`);
    console.log(`📊 Available assignments: ${assignments.length}, elderly assignments: ${elderlyAssigns.length}, temp reassignments: ${tempReassigns.length}`);
    
    // Debug: Show user's current assignments (check both user_id and caregiver_id for compatibility)
    const userAssignments = assignments.filter(a => (a.user_id === userId || a.caregiver_id === userId) && a.is_current);
    console.log(`👤 User's current assignments (${userAssignments.length}):`, userAssignments.map(a => ({
      id: a.id,
      user_id: a.user_id,
      caregiver_id: a.caregiver_id,
      house_id: a.house_id,
      shift: a.shift,
      days_assigned: a.days_assigned
    })));
    
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    
    let processedDays = 0;
    let skippedDays = 0;
    const results = [];

    // Calculate total days in leave period for logging
    const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    console.log(`📅 Leave period spans ${totalDays} days from ${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}`);

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

    console.log(`\n🏖️ ========== LEAVE PROCESSING SUMMARY ==========`);
    console.log(`User: ${userId}`);
    console.log(`Leave Type: ${leaveRequestData.leave_type}`);
    console.log(`Period: ${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}`);
    console.log(`Total Days: ${totalDays}`);
    console.log(`✅ Successfully processed: ${processedDays} days`);
    console.log(`⏭️ Skipped: ${skippedDays} days (not scheduled to work)`);
    console.log(`❌ Errors: ${results.filter(r => r.status === 'error').length} days`);
    console.log(`===============================================\n`);

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
