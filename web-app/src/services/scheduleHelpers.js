// Helper function to format date string in local timezone
export const formatDateString = (date) => {
  // Format date in local timezone to avoid UTC conversion issues
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper function to check if a caregiver is absent on a specific date
export const isCaregiverAbsent = (caregiverId, dateStr, absences) => {
  return absences.some(absence => 
    absence.user_id === caregiverId && 
    absence.absence_date === dateStr && 
    absence.status === "active"
  );
};

// Helper function to get caregiver absence details (type and status)
export const getCaregiverAbsenceDetails = (caregiverId, dateStr, absences) => {
  // Debug: Log what we're searching for
  console.log(`🔍 Checking absence for caregiver ${caregiverId} on ${dateStr}`);
  console.log(`📊 Total absences loaded: ${absences.length}`);
  
  // Show all absences for debugging (limit to first 5)
  if (absences.length > 0) {
    console.log(`Sample absences (first 5):`, absences.slice(0, 5).map(a => ({
      user_id: a.user_id,
      absence_date: a.absence_date,
      status: a.status,
      absence_type: a.absence_type
    })));
  }
  
  const absence = absences.find(absence => 
    absence.user_id === caregiverId && 
    absence.absence_date === dateStr && 
    absence.status === "active"
  );
  
  if (absence) {
    console.log(`✅ Found absence for ${caregiverId}:`, {
      type: absence.absence_type,
      date: absence.absence_date,
      reason: absence.leave_reason
    });
  } else {
    console.log(`❌ No absence found for ${caregiverId} on ${dateStr}`);
    // Check if there are any absences for this caregiver on other dates
    const caregiverAbsences = absences.filter(a => a.user_id === caregiverId);
    if (caregiverAbsences.length > 0) {
      console.log(`ℹ️ Caregiver ${caregiverId} has ${caregiverAbsences.length} absence(s) on other dates:`, 
        caregiverAbsences.map(a => a.absence_date));
    }
  }
  
  return absence ? {
    type: absence.absence_type || "absent",
    reason: absence.leave_reason || null,
    isAbsent: true
  } : {
    type: null,
    reason: null,
    isAbsent: false
  };
};

// Validation function to check if rest days are consecutive
export const areWorkDaysConsecutive = (workDays, daysOfWeek) => {
  if (workDays.length !== 5) return false;
  
  // Get rest days (days not in workDays)
  const restDays = daysOfWeek.filter(day => !workDays.includes(day));
  
  if (restDays.length !== 2) return false; // Should have exactly 2 rest days
  
  // Convert rest day names to indices
  const restDayIndices = restDays.map(day => daysOfWeek.indexOf(day)).sort((a, b) => a - b);
  
  // Check if the 2 rest days are consecutive
  const [firstRest, secondRest] = restDayIndices;
  
  // Two cases for consecutive rest days:
  // 1. Normal consecutive (e.g., Saturday=5, Sunday=6)
  // 2. Wrap-around consecutive (e.g., Sunday=6, Monday=0)
  const isNormalConsecutive = (secondRest - firstRest === 1);
  const isWrapAroundConsecutive = (firstRest === 0 && secondRest === 6); // Sunday and Saturday
  
  return isNormalConsecutive || isWrapAroundConsecutive;
};

// Check if caregiver is providing emergency coverage
export const isProvidingEmergencyCoverage = (caregiverId, selectedDateStr, tempReassigns) => {
  return tempReassigns.some(tr => 
    tr.to_user_id === caregiverId && 
    tr.date === selectedDateStr && 
    tr.from_user_id === "EMERGENCY_ABSENT"
  );
};

// Get emergency coverage details for a caregiver
export const getEmergencyCoverageDetails = (caregiverId, selectedDateStr, tempReassigns) => {
  const emergencyAssignments = tempReassigns.filter(tr => 
    tr.to_user_id === caregiverId && 
    tr.date === selectedDateStr && 
    tr.from_user_id === "EMERGENCY_ABSENT"
  );
  
  if (emergencyAssignments.length > 0) {
    const firstAssignment = emergencyAssignments[0];
    return {
      count: emergencyAssignments.length,
      reason: firstAssignment?.reason || "Emergency coverage",
      originalHouse: firstAssignment?.original_house,
      emergencyHouse: firstAssignment?.emergency_house,
      emergencyShift: firstAssignment?.emergency_shift
    };
  }
  
  return null;
};

// Get caregiver name by ID
export const caregiverName = (id, caregivers) => {
  const c = caregivers.find((cg) => cg.id === id);
  if (c) {
    return `${c.user_fname} ${c.user_lname}`;
  } else {
    // Enhanced debugging for missing caregivers
    console.warn(`⚠️ Caregiver not found: ${id}`);
    console.log(`Available caregivers (${caregivers.length}):`, 
      caregivers.slice(0, 3).map(cg => ({ id: cg.id, name: `${cg.user_fname} ${cg.user_lname}` }))
    );
    return `Unknown (${id.substring(0, 8)}...)`;
  }
};
