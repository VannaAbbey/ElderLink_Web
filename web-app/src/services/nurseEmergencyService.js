/**
 * Nurse Emergency Coverage Service
 * Handles emergency coverage scenarios when nurses are absent
 * Finds available donors from future shifts while ensuring no shift/day is left uncovered
 */

import { 
  collection, 
  writeBatch, 
  doc, 
  addDoc, 
  Timestamp,
  query,
  where,
  getDocs
} from "firebase/firestore";
import { db } from "../firebase";
import { checkUserAbsence } from './absenceService.js';

// Helper function to get current shift based on time
const getCurrentShift = () => {
  const now = new Date();
  const hours = now.getHours();
  
  // 1st Shift: 6:00 AM - 2:00 PM (06:00 - 14:00)
  // 2nd Shift: 2:00 PM - 10:00 PM (14:00 - 22:00)
  // 3rd Shift: 10:00 PM - 6:00 AM (22:00 - 06:00)
  
  if (hours >= 6 && hours < 14) {
    return "1st";
  } else if (hours >= 14 && hours < 22) {
    return "2nd";
  } else {
    return "3rd";
  }
};

// Helper function to check if a shift is in the past (for today's date)
const isShiftInPast = (targetDateStr, shift) => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  
  // If it's not today, don't filter by shift time
  if (targetDateStr !== today) {
    return false;
  }
  
  // For today, check if the shift has already passed
  const currentShift = getCurrentShift();
  const shiftOrder = { "1st": 1, "2nd": 2, "3rd": 3 };
  
  // If current shift is later than the target shift, it's in the past
  return shiftOrder[currentShift] > shiftOrder[shift];
};

// Get all absences for a specific date
const getAbsencesForDate = async (targetDateStr) => {
  try {
    const q = query(
      collection(db, "nurse_cg_absence"),
      where("absence_date", "==", targetDateStr),
      where("status", "==", "active"),
      where("user_type", "==", "nurse")
    );
    
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error("Error fetching nurse absences for date:", error);
    return [];
  }
};

// Check ALL emergency coverage needs across entire schedule period
export const checkAllEmergenciesInSchedule = async (
  scheduleStartDate,
  scheduleEndDate,
  assignments,
  nurseElderlyAssignments,
  tempReassignments
) => {
  try {
    console.log(`🚨 CHECKING ALL NURSE EMERGENCIES from ${scheduleStartDate} to ${scheduleEndDate}`);
    
    const allEmergencies = [];
    let totalEmergencyCount = 0;
    
    // Iterate through each date in the schedule period
    const currentDate = new Date(scheduleStartDate);
    const endDate = new Date(scheduleEndDate);
    
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().slice(0, 10);
      
      // Check emergencies for this specific date
      const dayEmergencies = await checkNurseEmergencyNeedsAndDonors(
        dateStr,
        assignments,
        nurseElderlyAssignments,
        tempReassignments
      );
      
      if (dayEmergencies.hasEmergency) {
        allEmergencies.push({
          date: dateStr,
          dayName: dayEmergencies.dayName,
          emergencies: dayEmergencies.emergencyOptions,
          count: dayEmergencies.emergencyCount
        });
        totalEmergencyCount += dayEmergencies.emergencyCount;
      }
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    console.log(`📊 TOTAL EMERGENCIES FOUND: ${totalEmergencyCount} across ${allEmergencies.length} date(s)`);
    
    return {
      hasEmergency: allEmergencies.length > 0,
      totalEmergencyCount,
      emergenciesByDate: allEmergencies
    };
    
  } catch (error) {
    console.error("Error checking all nurse emergencies:", error);
    throw new Error(`Failed to check all emergency coverage needs: ${error.message}`);
  }
};

// Check emergency coverage needs and get available donors
export const checkNurseEmergencyNeedsAndDonors = async (
  targetDateStr, 
  assignments, 
  nurseElderlyAssignments, 
  tempReassignments
) => {
  try {
    console.log(`🚨 CHECKING NURSE EMERGENCY COVERAGE needs for date: ${targetDateStr}`);
    
    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const shiftDefs = ["1st", "2nd", "3rd"];
    
    // Convert date to day name
    const targetDate = new Date(targetDateStr);
    const dayIndex = targetDate.getDay(); // 0=Sunday,1=Mon...
    const dayName = daysOfWeek[dayIndex];
    
    // Get current shift for filtering
    const currentShift = getCurrentShift();
    const today = new Date().toISOString().slice(0, 10);
    const isToday = targetDateStr === today;
    
    console.log(`🚨 NURSE EMERGENCY CHECK for ${dayName} (${targetDateStr})`);
    if (isToday) {
      console.log(`⏰ Current shift: ${currentShift} - will only show current and future shifts`);
    }
    
    // Get all absences for the target date
    const absencesForDate = await getAbsencesForDate(targetDateStr);
    
    // Create a map of absences by shift: { shift: Set(nurseIds) }
    const absentNursesByShift = {};
    shiftDefs.forEach(shift => {
      absentNursesByShift[shift] = new Set();
    });
    
    absencesForDate.forEach(absence => {
      if (absence.shift && shiftDefs.includes(absence.shift)) {
        absentNursesByShift[absence.shift].add(absence.user_id);
      }
    });
    
    console.log(`📊 Found ${absencesForDate.length} nurse absences for ${targetDateStr}:`);
    shiftDefs.forEach(shift => {
      const count = absentNursesByShift[shift].size;
      if (count > 0) {
        console.log(`   ${shift} shift: ${count} absent nurse(s) - ${Array.from(absentNursesByShift[shift]).join(', ')}`);
      }
    });

    // Build coverage map per shift for the target day
    const coverageMap = {};
    
    // Initialize coverage map for each shift
    shiftDefs.forEach(shift => {
      coverageMap[shift] = {
        total: 0,
        present: 0,
        absent: 0,
        presentNurses: [],
        absentNurses: []
      };
    });

    // Analyze current assignments for the target day
    const currentAssignments = assignments.filter(a => 
      a.is_current && 
      (a.days_assigned || []).map(d => d.toLowerCase()).includes(dayName.toLowerCase())
    );
    
    console.log(`📋 Found ${currentAssignments.length} nurse assignments for ${dayName}`);

    // Fill coverage map
    for (const assignment of currentAssignments) {
      const shift = assignment.shift;
      const nurseId = assignment.user_id;
      
      coverageMap[shift].total++;
      
      // ✅ FIX: Check if this nurse is absent FOR THIS SPECIFIC SHIFT
      const isAbsent = absentNursesByShift[shift]?.has(nurseId) || false;
      
      if (isAbsent) {
        coverageMap[shift].absent++;
        coverageMap[shift].absentNurses.push(nurseId);
      } else {
        coverageMap[shift].present++;
        coverageMap[shift].presentNurses.push(nurseId);
      }
    }

    // Account for existing emergency coverage assignments
    const emergencyCoverageByShift = {};
    tempReassignments
      .filter(tr => 
        tr.date === targetDateStr && 
        tr.day === dayName &&
        tr.from_user_id === "EMERGENCY_ABSENT" &&
        tr.user_type === "nurse"
      )
      .forEach(tr => {
        const shift = tr.shift;
        if (!emergencyCoverageByShift[shift]) {
          emergencyCoverageByShift[shift] = [];
        }
        emergencyCoverageByShift[shift].push(tr.to_user_id);
      });
    
    // Add emergency coverage to the coverage map
    Object.entries(emergencyCoverageByShift).forEach(([shift, nurseIds]) => {
      console.log(`🚑 Found ${nurseIds.length} emergency coverage nurses for ${shift} shift`);
      nurseIds.forEach(nurseId => {
        if (!coverageMap[shift].presentNurses.includes(nurseId)) {
          coverageMap[shift].present++;
          coverageMap[shift].presentNurses.push(nurseId);
        }
      });
    });

    // Find shifts with ZERO coverage (all absent or no nurses assigned)
    const emergencyNeeds = [];
    
    for (const shift of shiftDefs) {
      // Skip past shifts if checking today
      if (isToday && isShiftInPast(targetDateStr, shift)) {
        console.log(`⏭️ Skipping ${shift} shift (already passed)`);
        continue;
      }
      
      const coverage = coverageMap[shift];
      
      if (coverage.present === 0 && coverage.total > 0) {
        console.log(`🆘 EMERGENCY: ${shift} shift has ZERO coverage (${coverage.absent} absent)`);
        emergencyNeeds.push({
          shift,
          totalAbsent: coverage.absent,
          absentNurses: coverage.absentNurses
        });
      }
    }

    // Find available donor nurses from future shifts
    const availableDonors = [];
    const shiftOrder = { "1st": 1, "2nd": 2, "3rd": 3 };
    
    for (const shift of shiftDefs) {
      // Skip past shifts if checking today
      if (isToday && isShiftInPast(targetDateStr, shift)) {
        continue;
      }
      
      const coverage = coverageMap[shift];
      
      // A shift can be a donor if it has MORE than 1 nurse present
      // (keeping at least 1 nurse ensures no shift is left without coverage)
      if (coverage.present > 1) {
        console.log(`👥 ${shift} shift can donate (has ${coverage.present} nurses, can spare ${coverage.present - 1})`);
        
        availableDonors.push({
          shift,
          availableCount: coverage.present - 1, // Reserve 1 nurse minimum
          presentNurses: coverage.presentNurses.map(nurseId => ({ nurseId }))
        });
      }
    }

    // Log summary
    if (isToday) {
      console.log(`\n📊 NURSE EMERGENCY SUMMARY (Current/Future Shifts Only):`);
    } else {
      console.log(`\n📊 NURSE EMERGENCY SUMMARY:`);
    }
    console.log(`   Emergency Needs: ${emergencyNeeds.length} shift(s) with zero coverage`);
    console.log(`   Available Donors: ${availableDonors.length} shift(s) can provide nurses`);

    // Match emergency needs with potential donors from same or future shifts
    const emergencyOptions = [];
    
    for (const need of emergencyNeeds) {
      // Find donors from current shift or future shifts
      const suitableDonors = availableDonors.filter(donor => {
        // Donors can be from the same shift or future shifts
        return shiftOrder[donor.shift] >= shiftOrder[need.shift];
      });

      // Always include the emergency need in the options so the UI can
      // display the emergency shift even when no donors are available.
      emergencyOptions.push({
        emergencyShift: need.shift,
        totalAbsent: need.totalAbsent,
        absentNurses: need.absentNurses,
        availableDonorShifts: suitableDonors,
        hasDonors: suitableDonors.length > 0,
        dayName,
        targetDateStr
      });

      if (suitableDonors.length > 0) {
        console.log(`✅ Emergency option created for ${need.shift} shift with ${suitableDonors.length} potential donor shifts`);
      } else {
        console.log(`❌ No suitable donors found for ${need.shift} shift emergency — option still provided for UI display`);
      }
    }
    
    return {
      hasEmergency: emergencyNeeds.length > 0,
      emergencyCount: emergencyNeeds.length,
      emergencyOptions,
      dayName,
      targetDateStr
    };
    
  } catch (error) {
    console.error("Error checking nurse emergency needs:", error);
    throw new Error(`Failed to check nurse emergency coverage needs: ${error.message}`);
  }
};

// Activate emergency coverage with specific donor choices
export const activateNurseEmergencyCoverage = async (
  targetDateStr, 
  assignments, 
  nurseElderlyAssignments, 
  tempReassignments, 
  donorChoices = null
) => {
  try {
    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    
    // Convert date to day name
    const targetDate = new Date(targetDateStr);
    const dayIndex = targetDate.getDay();
    const dayName = daysOfWeek[dayIndex];
    
    if (donorChoices && Array.isArray(donorChoices) && donorChoices.length > 0) {
      // Execute with specific donor choices (from modal)
      return await executeSpecificNurseDonorChoices(
        targetDateStr,
        dayName,
        assignments,
        nurseElderlyAssignments,
        tempReassignments,
        donorChoices
      );
    } else {
      // Automatic mode (not recommended for nurses - should use modal)
      throw new Error("Nurse emergency coverage requires manual donor selection");
    }
    
  } catch (error) {
    console.error("Error activating nurse emergency coverage:", error);
    throw new Error(`Failed to activate nurse emergency coverage: ${error.message}`);
  }
};

// Execute emergency coverage with specific donor choices from modal
const executeSpecificNurseDonorChoices = async (
  targetDateStr, 
  dayName, 
  assignments, 
  nurseElderlyAssignments, 
  tempReassignments, 
  donorChoices
) => {
  const emergencyReassignments = [];
  const batch = writeBatch(db);
  let writeCount = 0;
  
  // Get all absences for the target date
  const absencesForDate = await getAbsencesForDate(targetDateStr);
  
  // ✅ FIX: Create shift-specific absence map
  const absentNursesByShift = {};
  absencesForDate.forEach(absence => {
    if (!absentNursesByShift[absence.shift]) {
      absentNursesByShift[absence.shift] = new Set();
    }
    absentNursesByShift[absence.shift].add(absence.user_id);
  });
  
  console.log(`🎯 EXECUTING SPECIFIC NURSE DONOR CHOICES for ${donorChoices.length} emergencies`);
  
  for (const choice of donorChoices) {
    const { emergencyShift, donorShift, nurseId } = choice;
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🚑 Processing Emergency: ${emergencyShift} shift`);
    console.log(`   Donor Nurse: ${nurseId} from ${donorShift} shift`);
    
    // Get the donor nurse's original elderly assignments for this day
    const donorNurseAssignment = nurseElderlyAssignments.find(
      ea => ea.user_id === nurseId && 
            ea.day === dayName && 
            ea.shift === donorShift
    );
    
    const elderlyToCover = donorNurseAssignment?.elderly_ids || [];
    
    console.log(`📋 Donor nurse's original elderly: ${elderlyToCover.length} elderly`);
    
    // ✅ FIX: Get all absent nurses' elderly assignments for the EMERGENCY SHIFT ONLY
    const emergencyElderlyIds = [];
    const absentInEmergencyShift = absentNursesByShift[emergencyShift] || new Set();
    
    for (const absentNurseId of absentInEmergencyShift) {
      const absentNurseAssignment = nurseElderlyAssignments.find(
        ea => ea.user_id === absentNurseId && 
              ea.day === dayName && 
              ea.shift === emergencyShift
      );
      
      if (absentNurseAssignment?.elderly_ids) {
        emergencyElderlyIds.push(...absentNurseAssignment.elderly_ids);
      }
    }
    
    console.log(`🆘 Emergency shift elderly to cover: ${emergencyElderlyIds.length} elderly`);
    
    // Create temporary reassignment for the donor nurse to cover emergency shift
    const tempAssignmentId = `emergency_nurse_${nurseId}_${emergencyShift}_${targetDateStr}`;
    const tempRef = doc(db, "temporary_assignments", tempAssignmentId);
    
    const tempPayload = {
      from_user_id: "EMERGENCY_ABSENT", // Special marker for emergency coverage
      to_user_id: nurseId,
      user_type: "nurse",
      date: targetDateStr,
      day: dayName,
      shift: emergencyShift,
      elderly_ids: emergencyElderlyIds,
      assignment_type: "emergency_coverage",
      created_at: Timestamp.now(),
      expires_at: Timestamp.fromDate(new Date(new Date(targetDateStr).getTime() + 24 * 60 * 60 * 1000)),
      status: "active",
      reason: `Emergency coverage for ${emergencyShift} shift - all nurses absent`,
      donor_original_shift: donorShift
    };
    
    batch.set(tempRef, tempPayload);
    writeCount++;
    
    // ✅ NEW: Redistribute donor's original elderly to other nurses in their original shift
    console.log(`\n📋 Redistributing donor's original ${elderlyToCover.length} elderly to other nurses in ${donorShift} shift...`);
    
    if (elderlyToCover.length > 0) {
      // Find other available nurses in the donor's ORIGINAL shift (not absent, not the donor)
      const otherNursesInDonorShift = assignments.filter(a =>
        a.shift === donorShift &&
        a.is_current &&
        a.user_id !== nurseId &&
        (a.days_assigned || []).map(d => d.toLowerCase()).includes(dayName.toLowerCase())
      );
      
      // Filter out nurses who are absent on this date
      const availableNurses = [];
      for (const nurse of otherNursesInDonorShift) {
        const isAbsent = absentNursesByShift[donorShift]?.has(nurse.user_id);
        if (!isAbsent) {
          availableNurses.push(nurse);
        }
      }
      
      console.log(`   Found ${availableNurses.length} available nurses in ${donorShift} shift to take donor's elderly`);
      
      if (availableNurses.length > 0) {
        // Split donor's elderly evenly among available nurses
        const elderlyPerNurse = Math.ceil(elderlyToCover.length / availableNurses.length);
        let elderlyIndex = 0;
        
        for (let i = 0; i < availableNurses.length; i++) {
          const targetNurse = availableNurses[i];
          const elderlyForThisNurse = elderlyToCover.slice(
            elderlyIndex,
            elderlyIndex + elderlyPerNurse
          );
          
          if (elderlyForThisNurse.length > 0) {
            const redistribTempId = `donor_redistrib_${nurseId}_to_${targetNurse.user_id}_${targetDateStr}`;
            const redistribRef = doc(db, "temporary_assignments", redistribTempId);
            
            const redistribPayload = {
              from_user_id: nurseId, // The donor nurse who's now covering emergency
              to_user_id: targetNurse.user_id,
              user_type: "nurse",
              date: targetDateStr,
              day: dayName,
              shift: donorShift,
              elderly_ids: elderlyForThisNurse,
              assignment_type: "donor_redistribution",
              created_at: Timestamp.now(),
              expires_at: Timestamp.fromDate(new Date(new Date(targetDateStr).getTime() + 24 * 60 * 60 * 1000)),
              status: "active",
              reason: `Temporary coverage - ${nurseId} providing emergency coverage to ${emergencyShift} shift`
            };
            
            batch.set(redistribRef, redistribPayload);
            writeCount++;
            
            console.log(`   ✓ Assigned ${elderlyForThisNurse.length} elderly to ${targetNurse.user_id}`);
            elderlyIndex += elderlyPerNurse;
          }
        }
      } else {
        console.log(`   ⚠️ WARNING: No available nurses in ${donorShift} shift to redistribute donor's elderly!`);
      }
    }
    
    emergencyReassignments.push({
      emergencyShift,
      donorNurse: nurseId,
      donorShift,
      elderlyCount: emergencyElderlyIds.length,
      timestamp: new Date().toISOString()
    });
    
    console.log(`✅ Created emergency temporary assignment for nurse ${nurseId}`);
    console.log(`   Will cover ${emergencyElderlyIds.length} elderly in ${emergencyShift} shift`);
  }
  
  // Commit emergency reassignments
  if (writeCount > 0) {
    await batch.commit();
    console.log(`✅ Committed ${writeCount} emergency nurse reassignments`);
  }
  
  // Log activity
  await addDoc(collection(db, "activity_logs"), {
    action: "Manual Nurse Emergency Coverage Activated",
    date: targetDateStr,
    day: dayName,
    emergencies_resolved: emergencyReassignments.length,
    details: emergencyReassignments,
    time: Timestamp.now(),
    created_by: "admin"
  });
  
  return {
    success: true,
    message: `Nurse emergency coverage activated for ${emergencyReassignments.length} critical situation(s)`,
    emergencyReassignments
  };
};
