/**
 * Emergency Coverage Service
 * Handles emergency coverage scenarios when entire house/shift teams are absent
 */

import { db } from "../firebase";
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  writeBatch, 
  doc, 
  addDoc, 
  Timestamp 
} from "firebase/firestore";

// Check emergency coverage needs and get available donors
export const checkEmergencyNeedsAndDonors = async (targetDateStr, assignments, elderlyAssigns, tempReassigns) => {
  try {
    console.log(`🚨 CHECKING EMERGENCY COVERAGE needs for date: ${targetDateStr}`);
    
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const shiftDefs = ["1st", "2nd", "3rd"];
    
    // Convert date to day name
    const targetDate = new Date(targetDateStr);
    const dayIndex = targetDate.getDay(); // 0=Sunday,1=Mon...
    const dayName = daysOfWeek[dayIndex === 0 ? 6 : dayIndex - 1];
    
    console.log(`🚨 EMERGENCY CHECK for ${dayName} (${targetDateStr})`);
    
    // Group assignments by house/shift/day to find gaps
    const coverageMap = {};
    const houses = ["H001", "H002", "H003", "H004", "H005"];
    
    // Initialize coverage map
    for (const house of houses) {
      coverageMap[house] = {};
      for (const shift of shiftDefs) {
        coverageMap[house][shift] = {
          total: 0,
          present: 0,
          absent: 0,
          caregivers: []
        };
      }
    }
    
    // Analyze current assignments for the target day
    const currentAssignments = assignments.filter(a => 
      a.is_current && 
      (a.days_assigned || []).map(d => d.toLowerCase()).includes(dayName.toLowerCase())
    );
    
    // Fill coverage map
    for (const assignment of currentAssignments) {
      const { house_id, shift, caregiver_id, is_absent, absent_for_date } = assignment;
      if (!coverageMap[house_id] || !coverageMap[house_id][shift]) continue;
      
      const isAbsentToday = is_absent && absent_for_date === targetDateStr;
      
      // Skip caregivers who are providing emergency coverage elsewhere
      const isEmergencyCoverage = tempReassigns.some(tr =>
        tr.to_caregiver_id === caregiver_id &&
        tr.date === targetDateStr &&
        tr.from_caregiver_id === "EMERGENCY_ABSENT"
      );
      
      if (isEmergencyCoverage) {
        console.log(`⚡ Caregiver ${caregiver_id} is providing emergency coverage elsewhere, not counting in ${house_id} ${shift}`);
        continue; // Skip this assignment as the caregiver is covering another house
      }
      
      coverageMap[house_id][shift].total++;
      coverageMap[house_id][shift].caregivers.push({
        caregiverId: caregiver_id,
        assignmentId: assignment.id,
        isAbsent: isAbsentToday
      });
      
      if (isAbsentToday) {
        coverageMap[house_id][shift].absent++;
      } else {
        coverageMap[house_id][shift].present++;
      }
    }
    
    // Account for emergency coverage caregivers in the houses they're covering
    const emergencyCoverageByHouseShift = {};
    tempReassigns
      .filter(tr => tr.date === targetDateStr && tr.from_caregiver_id === "EMERGENCY_ABSENT")
      .forEach(tr => {
        // Parse the reason to find which house/shift this covers
        const reasonMatch = tr.reason?.match(/Emergency coverage for (\w+) (\w+) shift/i);
        if (reasonMatch) {
          const emergencyHouse = reasonMatch[1];
          const emergencyShift = reasonMatch[2];
          const key = `${emergencyHouse}_${emergencyShift}`;
          
          if (!emergencyCoverageByHouseShift[key]) {
            emergencyCoverageByHouseShift[key] = [];
          }
          emergencyCoverageByHouseShift[key].push(tr.to_caregiver_id);
        }
      });
    
    // Add emergency coverage to the coverage map
    Object.entries(emergencyCoverageByHouseShift).forEach(([key, caregiverIds]) => {
      const [house, shift] = key.split('_');
      if (coverageMap[house] && coverageMap[house][shift]) {
        const uniqueCaregivers = [...new Set(caregiverIds)]; // Deduplicate
        uniqueCaregivers.forEach(caregiverId => {
          coverageMap[house][shift].total++;
          coverageMap[house][shift].present++;
          coverageMap[house][shift].caregivers.push({
            caregiverId,
            assignmentId: `emergency_${caregiverId}`,
            isAbsent: false,
            isEmergencyCoverage: true
          });
        });
        console.log(`⚡ Added ${uniqueCaregivers.length} emergency coverage caregiver(s) to ${house} ${shift}`);
      }
    });
    
    // Find houses/shifts with ZERO coverage (all absent) and available donors
    const emergencyNeeds = [];
    const availableDonors = [];
    
    for (const house of houses) {
      for (const shift of shiftDefs) {
        const coverage = coverageMap[house][shift];
        
        if (coverage.total > 0 && coverage.present === 0) {
          // EMERGENCY: No one present in this house/shift
          emergencyNeeds.push({
            house,
            shift,
            totalAbsent: coverage.absent,
            absentCaregivers: coverage.caregivers.filter(c => c.isAbsent)
          });
          console.log(`🚨 EMERGENCY DETECTED: ${house} ${shift} Shift - ALL ${coverage.absent} caregivers absent!`);
        } else if (coverage.present > 1) {
          // POTENTIAL DONOR: Has more than 1 present caregiver
          const presentCaregivers = coverage.caregivers.filter(c => !c.isAbsent);
          availableDonors.push({
            house,
            shift,
            availableCount: coverage.present,
            presentCaregivers
          });
        }
      }
    }
    
    // Match emergency needs with potential donors in same shift
    const emergencyOptions = [];
    
    for (const need of emergencyNeeds) {
      const suitableDonors = availableDonors.filter(donor => 
        donor.shift === need.shift && // Same shift
        donor.availableCount > 1 // Has spare caregiver
      );
      
      if (suitableDonors.length > 0) {
        // Sort by availability (most available first)
        suitableDonors.sort((a, b) => b.availableCount - a.availableCount);
        
        emergencyOptions.push({
          emergencyHouse: need.house,
          emergencyShift: need.shift,
          totalAbsent: need.totalAbsent,
          availableDonorHouses: suitableDonors,
          suggestedDonor: suitableDonors[0], // Best option
          dayName,
          targetDateStr
        });
      } else {
        console.error(`❌ NO DONOR FOUND for ${need.house} ${need.shift} shift emergency!`);
        emergencyOptions.push({
          emergencyHouse: need.house,
          emergencyShift: need.shift,
          totalAbsent: need.totalAbsent,
          availableDonorHouses: [],
          suggestedDonor: null,
          dayName,
          targetDateStr,
          error: "No available donors found"
        });
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
    console.error("Error checking emergency needs:", error);
    throw new Error(`Failed to check emergency coverage needs: ${error.message}`);
  }
};

// Cross-House Emergency Coverage System (Execute specific donor choice)
export const activateEmergencyCoverage = async (targetDateStr, assignments, elderlyAssigns, tempReassigns, donorChoices = null) => {
  try {
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const shiftDefs = ["1st", "2nd", "3rd"];
    
    // Convert date to day name
    const targetDate = new Date(targetDateStr);
    const dayIndex = targetDate.getDay(); // 0=Sunday,1=Mon...
    const dayName = daysOfWeek[dayIndex === 0 ? 6 : dayIndex - 1];
    
    console.log(`🚨 EMERGENCY COVERAGE ACTIVATION for ${dayName} (${targetDateStr})`);
    
    if (donorChoices && donorChoices.length > 0) {
      console.log(`🎯 Using specific donor choices:`, donorChoices);
      return await executeSpecificDonorChoices(targetDateStr, dayName, assignments, elderlyAssigns, tempReassigns, donorChoices);
    }
    
    // Fallback to automatic selection (original logic)
    return await executeAutomaticEmergencyCoverage(targetDateStr, dayName, assignments, elderlyAssigns, tempReassigns);
    
  } catch (error) {
    console.error("Error executing emergency coverage:", error);
    throw new Error(`Failed to execute emergency coverage: ${error.message}`);
  }
};

// Execute emergency coverage with specific donor choices from modal
const executeSpecificDonorChoices = async (targetDateStr, dayName, assignments, elderlyAssigns, tempReassigns, donorChoices) => {
  const emergencyReassignments = [];
  const batch = writeBatch(db);
  let writeCount = 0;
  
  console.log(`🎯 EXECUTING SPECIFIC DONOR CHOICES for ${donorChoices.length} emergencies`);
  
  for (const choice of donorChoices) {
    const { emergencyHouse, emergencyShift, donorHouse, caregiverId } = choice;
    
    console.log(`🎯 EMERGENCY SOLUTION: Moving caregiver ${caregiverId} from ${donorHouse} to ${emergencyHouse} (${emergencyShift} shift)`);
    
    // Find all absent caregivers in the emergency house/shift
    const absentCaregivers = assignments.filter(a => 
      a.house_id === emergencyHouse &&
      a.shift === emergencyShift &&
      a.is_current &&
      a.is_absent &&
      a.absent_for_date === targetDateStr &&
      (a.days_assigned || []).map(d => d.toLowerCase()).includes(dayName.toLowerCase())
    );
    
    // Get elderly assignments for the emergency house/shift/day
    const emergencyElderlyIds = [];
    for (const absentCaregiver of absentCaregivers) {
      // Get base elderly assignments
      const baseElderly = elderlyAssigns.filter(ea =>
        ea.caregiver_id === absentCaregiver.caregiver_id &&
        ea.day?.toLowerCase() === dayName.toLowerCase()
      ).map(ea => ea.elderly_id);
      
      // Get temp assignments TO this absent caregiver
      const tempElderlyTo = tempReassigns.filter(tr =>
        tr.to_caregiver_id === absentCaregiver.caregiver_id &&
        tr.date === targetDateStr
      ).map(tr => tr.elderly_id);
      
      emergencyElderlyIds.push(...baseElderly, ...tempElderlyTo);
    }
    
    console.log(`👵 Emergency elderly to reassign: ${emergencyElderlyIds.length} elderly`);
    
    // Get donor caregiver's current elderly assignments
    const donorBaseElderly = elderlyAssigns.filter(ea =>
      ea.caregiver_id === caregiverId &&
      ea.day?.toLowerCase() === dayName.toLowerCase()
    ).map(ea => ea.elderly_id);
    
    const donorTempElderlyTo = tempReassigns.filter(tr =>
      tr.to_caregiver_id === caregiverId &&
      tr.date === targetDateStr
    ).map(tr => tr.elderly_id);
    
    const donorCurrentElderly = [...new Set([...donorBaseElderly, ...donorTempElderlyTo])]; // Remove duplicates
    
    console.log(`👥 Donor caregiver's current elderly: ${donorCurrentElderly.length} elderly`);
    
    // 1. Assign ALL emergency elderly to the donor caregiver
    const uniqueEmergencyElderlyIds = [...new Set(emergencyElderlyIds)]; // Remove duplicates
    for (const elderlyId of uniqueEmergencyElderlyIds) {
      const emergencyTempRef = doc(collection(db, "temp_reassignments"));
      batch.set(emergencyTempRef, {
        from_caregiver_id: "EMERGENCY_ABSENT", // Special marker
        to_caregiver_id: caregiverId,
        elderly_id: elderlyId,
        date: targetDateStr,
        assign_version: assignments.find(a => a.is_current)?.version || 1,
        reason: `Emergency coverage for ${emergencyHouse} ${emergencyShift} shift from ${donorHouse}`,
        original_house: donorHouse, // Add original house info
        emergency_house: emergencyHouse, // Add emergency house info
        emergency_shift: emergencyShift, // Add emergency shift info
        created_at: Timestamp.now()
      });
      writeCount++;
    }
    
    // 2. Find remaining caregivers in donor house for redistribution
    const remainingDonorCaregivers = assignments.filter(a =>
      a.house_id === donorHouse &&
      a.shift === emergencyShift &&
      a.is_current &&
      a.caregiver_id !== caregiverId &&
      (!a.is_absent || a.absent_for_date !== targetDateStr) &&
      (a.days_assigned || []).map(d => d.toLowerCase()).includes(dayName.toLowerCase())
    );
    
    if (remainingDonorCaregivers.length > 0 && donorCurrentElderly.length > 0) {
      // Distribute donor's elderly among remaining caregivers
      const elderlyPerCaregiver = Math.ceil(donorCurrentElderly.length / remainingDonorCaregivers.length);
      
      for (let i = 0; i < donorCurrentElderly.length; i++) {
        const recipientIndex = Math.floor(i / elderlyPerCaregiver);
        if (recipientIndex < remainingDonorCaregivers.length) {
          const recipientCaregiver = remainingDonorCaregivers[recipientIndex];
          
          const redistributionRef = doc(collection(db, "temp_reassignments"));
          batch.set(redistributionRef, {
            from_caregiver_id: caregiverId,
            to_caregiver_id: recipientCaregiver.caregiver_id,
            elderly_id: donorCurrentElderly[i],
            date: targetDateStr,
            assign_version: assignments.find(a => a.is_current)?.version || 1,
            reason: `Redistribution due to emergency coverage transfer`,
            created_at: Timestamp.now()
          });
          writeCount++;
        }
      }
      
      console.log(`♻️  Redistributed ${donorCurrentElderly.length} elderly among ${remainingDonorCaregivers.length} remaining caregivers`);
    }
    
    emergencyReassignments.push({
      emergencyHouse,
      emergencyShift,
      donorHouse,
      donorCaregiver: caregiverId,
      elderlyReassigned: uniqueEmergencyElderlyIds.length,
      elderlyRedistributed: donorCurrentElderly.length
    });
  }
  
  // Commit emergency reassignments
  if (writeCount > 0) {
    await batch.commit();
    console.log(`💾 Emergency reassignments committed: ${writeCount} records`);
  }
  
  // Log activity
  await addDoc(collection(db, "activity_logs"), {
    action: "Manual Emergency Cross-House Coverage Activated",
    date: targetDateStr,
    day: dayName,
    emergencies_resolved: emergencyReassignments.length,
    details: emergencyReassignments,
    time: Timestamp.now(),
    created_by: "admin"
  });
  
  return {
    success: true,
    message: `Emergency coverage activated for ${emergencyReassignments.length} critical situations`,
    emergencyReassignments
  };
};

// Original automatic emergency coverage logic
const executeAutomaticEmergencyCoverage = async (targetDateStr, dayName, assignments, elderlyAssigns, tempReassigns) => {
  console.log(`🚨 AUTOMATIC EMERGENCY COVERAGE ACTIVATION for ${dayName} (${targetDateStr})`);
  
  // Group assignments by house/shift/day to find gaps
  const coverageMap = {};
  const houses = ["H001", "H002", "H003", "H004", "H005"];
  const shiftDefs = ["1st", "2nd", "3rd"];
    
  // Initialize coverage map
  for (const house of houses) {
    coverageMap[house] = {};
    for (const shift of shiftDefs) {
      coverageMap[house][shift] = {
        total: 0,
        present: 0,
        absent: 0,
        caregivers: []
      };
    }
  }
  
  // Analyze current assignments for the target day
  const currentAssignments = assignments.filter(a => 
    a.is_current && 
    (a.days_assigned || []).map(d => d.toLowerCase()).includes(dayName.toLowerCase())
  );
  
  // Fill coverage map
  for (const assignment of currentAssignments) {
    const { house_id, shift, caregiver_id, is_absent, absent_for_date } = assignment;
    if (!coverageMap[house_id] || !coverageMap[house_id][shift]) continue;
    
    const isAbsentToday = is_absent && absent_for_date === targetDateStr;
    
    coverageMap[house_id][shift].total++;
    coverageMap[house_id][shift].caregivers.push({
      caregiverId: caregiver_id,
      assignmentId: assignment.id,
      isAbsent: isAbsentToday
    });
    
    if (isAbsentToday) {
      coverageMap[house_id][shift].absent++;
    } else {
      coverageMap[house_id][shift].present++;
    }
  }
  
  // Find houses/shifts with ZERO coverage (all absent)
  const emergencyNeeds = [];
  const availableDonors = [];
  
  for (const house of houses) {
    for (const shift of shiftDefs) {
      const coverage = coverageMap[house][shift];
      
      if (coverage.total > 0 && coverage.present === 0) {
        // EMERGENCY: No one present in this house/shift
        emergencyNeeds.push({
          house,
          shift,
          totalAbsent: coverage.absent,
          absentCaregivers: coverage.caregivers.filter(c => c.isAbsent)
        });
        console.log(`🚨 EMERGENCY DETECTED: ${house} ${shift} Shift - ALL ${coverage.absent} caregivers absent!`);
      } else if (coverage.present > 1) {
        // POTENTIAL DONOR: Has more than 1 present caregiver
        availableDonors.push({
          house,
          shift,
          availableCount: coverage.present,
          presentCaregivers: coverage.caregivers.filter(c => !c.isAbsent)
        });
      }
    }
  }
  
  if (emergencyNeeds.length === 0) {
    console.log(`✅ No emergency coverage needed for ${dayName}`);
    return { success: true, message: "No emergency coverage needed" };
  }
  
  console.log(`🆘 Found ${emergencyNeeds.length} emergency coverage needs`);
  console.log(`👥 Found ${availableDonors.length} potential donor houses/shifts`);
  
  // Sort donors by availability (most available first)
  availableDonors.sort((a, b) => b.availableCount - a.availableCount);
  
  const emergencyReassignments = [];
  
  // For each emergency need, find a donor
  for (const need of emergencyNeeds) {
    const suitableDonor = availableDonors.find(donor => 
      donor.shift === need.shift && // Same shift
      donor.availableCount > 1 // Has spare caregiver
    );
    
    if (!suitableDonor) {
      console.error(`❌ NO DONOR FOUND for ${need.house} ${need.shift} shift emergency!`);
      continue;
    }
    
    // Select the donor caregiver (first available)
    const donorCaregiver = suitableDonor.presentCaregivers[0];
    
    console.log(`🎯 EMERGENCY SOLUTION: Moving caregiver ${donorCaregiver.caregiverId} from ${suitableDonor.house} to ${need.house} (${need.shift} shift)`);
    
    // Get elderly assignments for the emergency house/shift/day
    const emergencyElderlyIds = [];
    for (const absentCaregiver of need.absentCaregivers) {
      // Get base elderly assignments
      const baseElderly = elderlyAssigns.filter(ea =>
        ea.caregiver_id === absentCaregiver.caregiverId &&
        ea.day?.toLowerCase() === dayName.toLowerCase()
      ).map(ea => ea.elderly_id);
      
      // Get temp assignments TO this absent caregiver
      const tempElderlyTo = tempReassigns.filter(tr =>
        tr.to_caregiver_id === absentCaregiver.caregiverId &&
        tr.date === targetDateStr
      ).map(tr => tr.elderly_id);
      
      emergencyElderlyIds.push(...baseElderly, ...tempElderlyTo);
    }
    
    console.log(`👵 Emergency elderly to reassign: ${emergencyElderlyIds.length} elderly`);
    
    // Get donor caregiver's current elderly assignments
    const donorBaseElderly = elderlyAssigns.filter(ea =>
      ea.caregiver_id === donorCaregiver.caregiverId &&
      ea.day?.toLowerCase() === dayName.toLowerCase()
    ).map(ea => ea.elderly_id);
    
    const donorTempElderlyTo = tempReassigns.filter(tr =>
      tr.to_caregiver_id === donorCaregiver.caregiverId &&
      tr.date === targetDateStr
    ).map(tr => tr.elderly_id);
    
    const donorCurrentElderly = [...new Set([...donorBaseElderly, ...donorTempElderlyTo])]; // Remove duplicates
    
    console.log(`👥 Donor caregiver's current elderly: ${donorCurrentElderly.length} elderly`);
    
    // Create emergency temp reassignments
    const batch = writeBatch(db);
    let writeCount = 0;
    
    // 1. Assign ALL emergency elderly to the donor caregiver  
    const uniqueEmergencyElderlyIds = [...new Set(emergencyElderlyIds)]; // Remove duplicates
    for (const elderlyId of uniqueEmergencyElderlyIds) {
      const emergencyTempRef = doc(collection(db, "temp_reassignments"));
      batch.set(emergencyTempRef, {
        from_caregiver_id: "EMERGENCY_ABSENT", // Special marker
        to_caregiver_id: donorCaregiver.caregiverId,
        elderly_id: elderlyId,
        date: targetDateStr,
        assign_version: currentAssignments[0]?.version || 1,
        reason: `Emergency coverage for ${need.house} ${need.shift} shift from ${suitableDonor.house}`,
        original_house: suitableDonor.house, // Add original house info
        emergency_house: need.house, // Add emergency house info
        emergency_shift: need.shift, // Add emergency shift info
        created_at: Timestamp.now()
      });
      writeCount++;
    }
    
    // 2. Redistribute donor's original elderly to remaining caregivers in donor house
    const remainingDonorCaregivers = suitableDonor.presentCaregivers.filter(cg => 
      cg.caregiverId !== donorCaregiver.caregiverId
    );
    
    if (remainingDonorCaregivers.length > 0 && donorCurrentElderly.length > 0) {
      // Distribute donor's elderly among remaining caregivers
      const elderlyPerCaregiver = Math.ceil(donorCurrentElderly.length / remainingDonorCaregivers.length);
      
      for (let i = 0; i < donorCurrentElderly.length; i++) {
        const recipientIndex = Math.floor(i / elderlyPerCaregiver);
        if (recipientIndex < remainingDonorCaregivers.length) {
          const recipientCaregiver = remainingDonorCaregivers[recipientIndex];
          
          const redistributionRef = doc(collection(db, "temp_reassignments"));
          batch.set(redistributionRef, {
            from_caregiver_id: donorCaregiver.caregiverId,
            to_caregiver_id: recipientCaregiver.caregiverId,
            elderly_id: donorCurrentElderly[i],
            date: targetDateStr,
            assign_version: currentAssignments[0]?.version || 1,
            reason: `Redistribution due to emergency coverage transfer`,
            created_at: Timestamp.now()
          });
          writeCount++;
        }
      }
      
      console.log(`♻️  Redistributed ${donorCurrentElderly.length} elderly among ${remainingDonorCaregivers.length} remaining caregivers`);
    }
    
    // Commit emergency reassignments
    if (writeCount > 0) {
      await batch.commit();
      console.log(`💾 Emergency reassignments committed: ${writeCount} records`);
    }
    
    emergencyReassignments.push({
      emergencyHouse: need.house,
      emergencyShift: need.shift,
      donorHouse: suitableDonor.house,
      donorCaregiver: donorCaregiver.caregiverId,
      elderlyReassigned: uniqueEmergencyElderlyIds.length,
      elderlyRedistributed: donorCurrentElderly.length
    });
    
    // Update donor availability (reduce by 1)
    suitableDonor.availableCount--;
    suitableDonor.presentCaregivers = suitableDonor.presentCaregivers.filter(cg => 
      cg.caregiverId !== donorCaregiver.caregiverId
    );
  }
  
  // Log activity
  await addDoc(collection(db, "activity_logs"), {
    action: "Emergency Cross-House Coverage Activated",
    date: targetDateStr,
    day: dayName,
    emergencies_resolved: emergencyReassignments.length,
    details: emergencyReassignments,
    time: Timestamp.now(),
    created_by: "system"
  });
  
  return {
    success: true,
    message: `Emergency coverage activated for ${emergencyReassignments.length} critical situations`,
    emergencyReassignments
  };
};
