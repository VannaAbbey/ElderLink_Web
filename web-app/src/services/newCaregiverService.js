/**
 * New Caregiver Service
 * Handles integration of new caregivers into existing schedules
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

// Import shared elderly distribution functions from scheduleService
import { distributeElderlyForDayShift, createElderlyAssignmentsBatch } from './scheduleService.js';

// Detect caregivers not assigned to current schedule
export const detectUnassignedCaregivers = async () => {
  try {
    // Get all caregivers
    const allCaregivers = await getDocs(
      query(collection(db, "users"), where("user_type", "==", "caregiver"))
    );
    
    // Get current assignments
    const currentAssignments = await getDocs(
      query(collection(db, "cg_house_assign_v2"), where("is_current", "==", true))
    );
    
    const assignedCaregiverIds = new Set();
    currentAssignments.docs.forEach(doc => {
      assignedCaregiverIds.add(doc.data().caregiver_id);
    });
    
    // Find unassigned caregivers
    const unassignedCaregivers = [];
    allCaregivers.docs.forEach(doc => {
      const caregiverData = { id: doc.id, ...doc.data() };
      if (!assignedCaregiverIds.has(doc.id)) {
        unassignedCaregivers.push(caregiverData);
      }
    });
    
    console.log(`🔍 Found ${unassignedCaregivers.length} unassigned caregivers out of ${allCaregivers.docs.length} total`);
    
    return unassignedCaregivers;
    
  } catch (error) {
    console.error("Error detecting unassigned caregivers:", error);
    throw new Error("Failed to detect unassigned caregivers");
  }
};

// Analyze current schedule and generate recommendations for new caregiver placement
export const generateCaregiverRecommendations = async (caregiverId, assignments, houses) => {
  try {
    console.log(`🤖 Generating placement recommendations for caregiver ${caregiverId}`);
    
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const shifts = ["1st", "2nd", "3rd"];
    
    // Step 1: Identify all weakest house/shift/day combinations
    const weakSlots = await identifyWeakestCoverageSlots(houses, shifts, daysOfWeek, assignments);
    
    if (weakSlots.length === 0) {
      console.log("🎯 No coverage gaps found - all positions are adequately staffed");
      return [];
    }
    
    console.log(`📊 Found ${weakSlots.length} coverage gaps across all houses/shifts`);
    
    // Step 2: Generate all valid 5-day work patterns for each house/shift combination
    const allRecommendations = [];
    
    for (const house of houses) {
      for (const shift of shifts) {
        const workDayPatterns = generateAllConsecutivePatterns(daysOfWeek);
        
        for (const pattern of workDayPatterns) {
          // Step 3: Calculate how many weak slots this pattern would fix
          const coverageImprovement = calculateCoverageImprovement(
            house.house_id, shift, pattern.days, weakSlots
          );
          
          if (coverageImprovement.weakSlotsCovered > 0) {
            const recommendation = {
              house: house.house_id,
              houseName: house.house_name,
              shift: shift,
              workDays: pattern.days,
              weakSlotsCovered: coverageImprovement.weakSlotsCovered,
              totalWeakSlots: weakSlots.length,
              improvementScore: coverageImprovement.score,
              startDay: pattern.startDay,
              endDay: pattern.days[pattern.days.length - 1],
              explanation: generateCoverageExplanation(coverageImprovement, house.house_name, shift, pattern.days)
            };
            
            allRecommendations.push(recommendation);
          }
        }
      }
    }
    
    // Sort by coverage improvement with house diversity
    allRecommendations.sort((a, b) => {
      // Primary: Most weak slots covered
      if (b.weakSlotsCovered !== a.weakSlotsCovered) {
        return b.weakSlotsCovered - a.weakSlotsCovered;
      }
      // Secondary: Higher improvement score (considers additional factors)
      return b.improvementScore - a.improvementScore;
    });
    
    // Ensure house diversity in top recommendations
    const diverseRecommendations = [];
    const housesUsed = new Set();
    
    // First pass: Get best recommendation from each house
    for (const rec of allRecommendations) {
      if (!housesUsed.has(rec.house) && diverseRecommendations.length < 5) {
        diverseRecommendations.push(rec);
        housesUsed.add(rec.house);
      }
    }
    
    // Second pass: Fill remaining slots with other good recommendations
    for (const rec of allRecommendations) {
      if (!diverseRecommendations.includes(rec) && diverseRecommendations.length < 5) {
        diverseRecommendations.push(rec);
      }
    }
    
    const topRecommendations = diverseRecommendations;
    
    console.log(`✅ Generated ${topRecommendations.length} coverage-focused recommendations`);
    topRecommendations.forEach((rec, index) => {
      console.log(`${index + 1}. ${rec.houseName} ${rec.shift}: Fixes ${rec.weakSlotsCovered}/${rec.totalWeakSlots} gaps`);
    });
    
    return topRecommendations;
    
  } catch (error) {
    console.error("Error generating caregiver recommendations:", error);
    throw new Error("Failed to generate recommendations");
  }
};

// Step 1: Identify weakest house/shift/day combinations below coverage threshold
const identifyWeakestCoverageSlots = async (houses, shifts, daysOfWeek, assignments) => {
  const weakSlots = [];
  const coverageThreshold = 1; // Minimum caregivers per slot
  
  for (const house of houses) {
    for (const shift of shifts) {
      // Get all assignments for this house/shift
      const relevantAssignments = assignments.filter(assignment => 
        assignment.is_current && 
        assignment.house_id === house.house_id && 
        assignment.shift === shift
      );
      
      // Count coverage per day
      const dailyCoverage = {};
      daysOfWeek.forEach(day => {
        dailyCoverage[day] = 0;
      });
      
      relevantAssignments.forEach(assignment => {
        if (assignment.days_assigned && Array.isArray(assignment.days_assigned)) {
          assignment.days_assigned.forEach(day => {
            if (dailyCoverage[day] !== undefined) {
              dailyCoverage[day]++;
            }
          });
        }
      });
      
      // Identify slots below threshold
      daysOfWeek.forEach(day => {
        const coverage = dailyCoverage[day];
        const isBedridden = house.house_id === "H002" || house.house_id === "H003";
        const adjustedThreshold = isBedridden ? coverageThreshold + 1 : coverageThreshold; // Higher threshold for bedridden
        
        if (coverage < adjustedThreshold) {
          weakSlots.push({
            house: house.house_id,
            houseName: house.house_name,
            shift: shift,
            day: day,
            currentCoverage: coverage,
            neededCoverage: adjustedThreshold - coverage,
            isBedridden: isBedridden,
            isCritical: coverage === 0, // No coverage at all
            isWeekend: day === 'Saturday' || day === 'Sunday'
          });
        }
      });
    }
  }
  
  // Sort by criticality: no coverage first, then bedridden houses, then weekends
  weakSlots.sort((a, b) => {
    if (a.isCritical !== b.isCritical) return b.isCritical - a.isCritical;
    if (a.isBedridden !== b.isBedridden) return b.isBedridden - a.isBedridden;
    if (a.isWeekend !== b.isWeekend) return b.isWeekend - a.isWeekend;
    return b.neededCoverage - a.neededCoverage;
  });
  
  return weakSlots;
};

// Step 2: Generate all valid 5-consecutive-day patterns
const generateAllConsecutivePatterns = (daysOfWeek) => {
  const patterns = [];
  
  // Generate all possible 5-consecutive-day patterns (7 possible starting points)
  for (let startIndex = 0; startIndex < 7; startIndex++) {
    const pattern = {
      startIndex: startIndex,
      days: [],
      startDay: daysOfWeek[startIndex]
    };
    
    for (let i = 0; i < 5; i++) {
      const dayIndex = (startIndex + i) % 7;
      pattern.days.push(daysOfWeek[dayIndex]);
    }
    
    patterns.push(pattern);
  }
  
  return patterns;
};

// Step 3: Calculate coverage improvement for a specific assignment
const calculateCoverageImprovement = (houseId, shift, workDays, weakSlots) => {
  // Find weak slots that this assignment would cover
  const coveredSlots = weakSlots.filter(slot => 
    slot.house === houseId && 
    slot.shift === shift && 
    workDays.includes(slot.day)
  );
  
  const weekendDaysCovered = workDays.filter(day => day === 'Saturday' || day === 'Sunday').length;
  const criticalSlotsCovered = coveredSlots.filter(slot => slot.isCritical).length;
  const bedriddenSlotsCovered = coveredSlots.filter(slot => slot.isBedridden).length;
  
  // Calculate improvement score with bonuses
  let score = coveredSlots.length * 10; // Base score per weak slot covered
  score += criticalSlotsCovered * 20; // Bonus for covering critical gaps (no coverage)
  score += bedriddenSlotsCovered * 10; // Bonus for bedridden houses
  score += weekendDaysCovered * 5; // Small bonus for weekend coverage
  
  return {
    weakSlotsCovered: coveredSlots.length,
    criticalSlotsCovered: criticalSlotsCovered,
    bedriddenSlotsCovered: bedriddenSlotsCovered,
    weekendDaysCovered: weekendDaysCovered,
    coveredSlots: coveredSlots,
    score: score
  };
};

// Step 4: Generate clear explanation for the recommendation
const generateCoverageExplanation = (improvement, houseName, shift, workDays) => {
  const explanations = [];
  
  // Primary benefit
  if (improvement.weakSlotsCovered > 0) {
    explanations.push(`Covers ${improvement.weakSlotsCovered} understaffed shift${improvement.weakSlotsCovered > 1 ? 's' : ''}`);
  }
  
  // Critical coverage
  if (improvement.criticalSlotsCovered > 0) {
    explanations.push(`Fills ${improvement.criticalSlotsCovered} critical gap${improvement.criticalSlotsCovered > 1 ? 's' : ''} (zero coverage)`);
  }
  
  // Bedridden house priority
  if (improvement.bedriddenSlotsCovered > 0) {
    explanations.push(`Supports high-priority bedridden house (${houseName})`);
  }
  
  // Weekend coverage
  if (improvement.weekendDaysCovered > 0) {
    const weekendDays = workDays.filter(day => day === 'Saturday' || day === 'Sunday');
    explanations.push(`Provides weekend coverage (${weekendDays.join(', ')})`);
  }
  
  // Work pattern summary
  const startDay = workDays[0];
  const endDay = workDays[workDays.length - 1];
  explanations.push(`Work pattern: ${startDay} to ${endDay} (${shift} shift)`);
  
  return explanations.join('. ');
};

// Integrate new caregiver into existing schedule
export const integrateNewCaregiver = async (caregiverId, assignmentData, currentAssignments, elderlyAssignments, houses) => {
  try {
    console.log(`🔗 Integrating caregiver ${caregiverId} into existing schedule`);
    console.log(`%c🚀 NEW CAREGIVER INTEGRATION STARTED`, 'color: green; font-size: 16px; font-weight: bold;');
    console.log(`%cCaregiver ID: ${caregiverId}`, 'color: blue; font-weight: bold;');
    
    // Validate that the caregiver exists in the users collection
    const allCaregivers = await getDocs(
      query(collection(db, "users"), where("user_type", "==", "caregiver"))
    );
    
    const caregiverExists = allCaregivers.docs.find(doc => doc.id === caregiverId);
    if (!caregiverExists) {
      throw new Error(`Caregiver with ID ${caregiverId} not found in users collection. Please verify the caregiver exists before integrating.`);
    }
    
    const caregiverData = { id: caregiverExists.id, ...caregiverExists.data() };
    console.log(`✅ Verified caregiver exists: ${caregiverData.user_fname} ${caregiverData.user_lname}`);
    
    // Get current schedule version and dates
    const currentAssignment = currentAssignments.find(a => a.is_current);
    if (!currentAssignment) {
      throw new Error("No current schedule found");
    }
    
    const version = currentAssignment.version;
    const startDate = currentAssignment.start_date;
    const endDate = currentAssignment.end_date;
    
    const batch = writeBatch(db);
    let writeCount = 0;
    
    // Map shift to time range (same as main schedule generator)
    const shiftDefs = [
      { name: "1st Shift (6:00 AM - 2:00 PM)", key: "1st", time_range: { start: "06:00", end: "14:00" } },
      { name: "2nd Shift (2:00 PM - 10:00 PM)", key: "2nd", time_range: { start: "14:00", end: "22:00" } },
      { name: "3rd Shift (10:00 PM - 6:00 AM)", key: "3rd", time_range: { start: "22:00", end: "06:00" } },
    ];
    
    const shiftDef = shiftDefs.find(s => s.key === assignmentData.shift);
    const time_range = shiftDef ? shiftDef.time_range : { start: "06:00", end: "14:00" }; // fallback to 1st shift
    
    // Create new assignment document
    const newAssignmentRef = doc(collection(db, "cg_house_assign_v2"));
    const assignmentDoc = {
      caregiver_id: caregiverId,
      house_id: assignmentData.house,
      shift: assignmentData.shift,
      days_assigned: assignmentData.workDays,
      is_current: true,
      version: version,
      start_date: startDate,
      end_date: endDate,
      time_range: time_range, // 🔧 Added missing time_range field
      created_at: Timestamp.now(),
      daily_absent: {}, // Initialize empty absent tracking
      integration_type: "manual_addition", // Mark as manually added
      integration_date: Timestamp.now()
    };
    
    batch.set(newAssignmentRef, assignmentDoc);
    writeCount++;
    
    // Store the assignment reference ID for elderly assignments
    const newAssignmentId = newAssignmentRef.id;
    
    // Get all elderly in the assigned house
    const houseElderly = await getDocs(
      query(collection(db, "elderly"), where("house_id", "==", assignmentData.house))
    );
    
    if (houseElderly.docs.length === 0) {
      console.log(`ℹ️ No elderly found in house ${assignmentData.house}`);
      
      // Commit the caregiver assignment even if no elderly
      if (writeCount > 0) {
        await batch.commit();
      }
      
      return {
        success: true,
        message: `Successfully integrated caregiver into ${assignmentData.house} - ${assignmentData.shift} shift (no elderly in house)`,
        elderlyAssigned: 0,
        assignment: assignmentDoc
      };
    }
    
    // Get all caregivers currently assigned to this house
    const houseCaregivers = currentAssignments.filter(assign => 
      assign.is_current && assign.house_id === assignmentData.house
    );
    
    // Add the new caregiver to the list for distribution calculation
    const allHouseCaregivers = [...houseCaregivers, { caregiver_id: caregiverId }];
    const elderlyList = houseElderly.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    console.log(`🏠 House ${assignmentData.house}: ${allHouseCaregivers.length} total caregivers, ${elderlyList.length} elderly`);
    
    // PROPER ELDERLY REDISTRIBUTION: When adding a new caregiver, we need to 
    // redistribute ALL elderly assignments for the affected day/shift/house combinations
    let elderlyAssignmentsToCreate = [];
    let assignmentsToDeactivate = [];
    
    // Prepare metadata for elderly assignment creation (identical structure to main generator)
    const assignmentMetadata = {
      version: version,
      assign_id: newAssignmentId,
      house_id: assignmentData.house,
      house_name: houses.find(h => h.house_id === assignmentData.house)?.house_name || assignmentData.house
    };
    
    // For each work day, properly redistribute existing elderly assignments
    for (const workDay of assignmentData.workDays) {
      console.log(`📅 Processing ${workDay} for complete elderly redistribution...`);
      
      // STEP 1: Find ALL existing elderly assignments for this day/shift/house
      // Must filter by current version to avoid deactivating old assignments
      const existingDayAssignments = elderlyAssignments.filter(ea => 
        ea.house_id === assignmentData.house &&
        ea.shift === assignmentData.shift &&
        ea.day === workDay &&
        ea.status === "active" &&
        ea.assign_version === version  // Only get current version assignments
      );
      
      console.log(`📋 Found ${existingDayAssignments.length} existing elderly assignments for ${workDay} ${assignmentData.shift} shift (version ${version})`);
      
      // Debug: Log which assignments we found
      if (existingDayAssignments.length > 0) {
        console.log(`🔍 Existing assignments to deactivate:`);
        existingDayAssignments.forEach((assignment, idx) => {
          console.log(`  ${idx + 1}. ID: ${assignment.id}, Caregiver: ${assignment.caregiver_id}, Elderly: ${assignment.elderly_id}`);
        });
      }
      
      // STEP 2: Collect all elderly currently assigned to this day/shift/house
      const elderlyToRedistribute = [];
      const existingElderlyIds = new Set();
      
      for (const assignment of existingDayAssignments) {
        if (!existingElderlyIds.has(assignment.elderly_id)) {
          existingElderlyIds.add(assignment.elderly_id);
          
          // Find the elderly details from our elderly list
          const elderlyDetails = elderlyList.find(e => e.id === assignment.elderly_id);
          if (elderlyDetails) {
            elderlyToRedistribute.push(elderlyDetails);
          }
        }
        
        // Mark this assignment for deactivation
        assignmentsToDeactivate.push({
          id: assignment.id,
          reason: `complete_redistribution_new_caregiver_${caregiverId}_${workDay}`
        });
      }
      
      console.log(`👥 Will redistribute ${elderlyToRedistribute.length} elderly among caregivers`);
      
      // STEP 3: Identify ALL caregivers working this day/shift (including new one)
      const workingCaregivers = [];
      
      // Add new caregiver first
      workingCaregivers.push({
        caregiver_id: caregiverId,
        caregiver_name: `${caregiverData.user_fname} ${caregiverData.user_lname}`.toLowerCase(),
        user_fname: caregiverData.user_fname,
        user_lname: caregiverData.user_lname
      });
      
      // Add existing caregivers working this day/shift
      for (const cg of houseCaregivers) {
        const existingAssignment = currentAssignments.find(assign => 
          assign.caregiver_id === cg.caregiver_id && 
          assign.house_id === assignmentData.house &&
          assign.shift === assignmentData.shift &&
          assign.is_current &&
          assign.days_assigned && 
          assign.days_assigned.includes(workDay)
        );
        
        if (existingAssignment) {
          // Get caregiver details from users collection for proper redistribution
          const existingCaregiverDoc = allCaregivers.docs.find(doc => doc.id === cg.caregiver_id);
          if (existingCaregiverDoc) {
            const cgData = existingCaregiverDoc.data();
            workingCaregivers.push({
              caregiver_id: cg.caregiver_id,
              caregiver_name: `${cgData.user_fname} ${cgData.user_lname}`.toLowerCase(),
              user_fname: cgData.user_fname,
              user_lname: cgData.user_lname
            });
          }
        }
      }
      
      console.log(`👥 ${workDay}: ${workingCaregivers.length} total caregivers will handle ${elderlyToRedistribute.length} elderly`);
      
      // STEP 4: Use shared distribution function to redistribute ALL elderly among ALL caregivers
      if (elderlyToRedistribute.length > 0 && workingCaregivers.length > 0) {
        const redistributedAssignments = distributeElderlyForDayShift(
          elderlyToRedistribute, 
          workingCaregivers, 
          workDay, 
          assignmentData.shift, 
          assignmentMetadata
        );
        
        // All redistributed assignments need to be created (not just for new caregiver)
        redistributedAssignments.forEach(assignment => {
          assignment.integration_type = "complete_redistribution_with_new_caregiver";
          assignment.redistribution_trigger = `new_caregiver_${caregiverId}_added`;
        });
        
        elderlyAssignmentsToCreate.push(...redistributedAssignments);
        
        console.log(`✅ Created ${redistributedAssignments.length} redistributed assignments for ${workDay}`);
      } else if (elderlyToRedistribute.length === 0) {
        console.log(`ℹ️ No existing elderly assignments found for ${workDay} - new caregiver will be available but unassigned`);
      }
    }
    
    console.log(`📊 Created ${elderlyAssignmentsToCreate.length} elderly assignments for complete redistribution across ${assignmentData.workDays.length} work days`);
    
    // Debug: Log assignments per caregiver to verify distribution
    const assignmentsByCaregiver = {};
    elderlyAssignmentsToCreate.forEach(assignment => {
      if (!assignmentsByCaregiver[assignment.caregiver_id]) {
        assignmentsByCaregiver[assignment.caregiver_id] = 0;
      }
      assignmentsByCaregiver[assignment.caregiver_id]++;
    });
    
    console.log(`🔍 DEBUG: Elderly assignments per caregiver:`);
    console.log(`%c📊 REDISTRIBUTION BREAKDOWN`, 'color: orange; font-size: 14px; font-weight: bold;');
    Object.entries(assignmentsByCaregiver).forEach(([cgId, count]) => {
      const isNewCaregiver = cgId === caregiverId;
      console.log(`%c  ${cgId}${isNewCaregiver ? ' (NEW)' : ' (EXISTING)'}: ${count} elderly`, isNewCaregiver ? 'color: green; font-weight: bold;' : 'color: blue;');
    });
    console.log(`%c📊 Total assignments created: ${elderlyAssignmentsToCreate.length}`, 'color: purple; font-weight: bold;');
    
    console.log(`🗑️ Will deactivate ${assignmentsToDeactivate.length} conflicting elderly assignments`);
    
    // Debug: Log each assignment being deactivated
    if (assignmentsToDeactivate.length > 0) {
      console.log(`🔍 Assignments being deactivated:`);
      assignmentsToDeactivate.forEach((deactivation, idx) => {
        console.log(`  ${idx + 1}. ID: ${deactivation.id}, Reason: ${deactivation.reason}`);
      });
    }
    
    // Deactivate conflicting assignments
    for (const deactivation of assignmentsToDeactivate) {
      console.log(`🗑️ Deactivating assignment ${deactivation.id}`);
      batch.update(doc(db, "elderly_caregiver_assign_v2", deactivation.id), {
        status: "redistributed",
        deactivated_at: Timestamp.now(),
        deactivation_reason: deactivation.reason,
        redistributed_by: "new_caregiver_integration"
      });
      writeCount++;
    }
    
    // Create elderly assignments using shared batch function (same as main generator)
    const validElderlyAssignments = elderlyAssignmentsToCreate.filter(elderlyAssign => {
      const elderlyExists = elderlyList.find(e => e.id === elderlyAssign.elderly_id);
      if (!elderlyExists) {
        console.warn(`⚠️ Skipping assignment for non-existent elderly: ${elderlyAssign.elderly_id}`);
        return false;
      }
      return true;
    });
    
    // Additional validation: Check for duplicate assignments (same elderly + caregiver + day + shift)
    const assignmentKeys = new Set();
    const deduplicatedAssignments = validElderlyAssignments.filter(assignment => {
      const key = `${assignment.elderly_id}_${assignment.caregiver_id}_${assignment.day}_${assignment.shift}`;
      if (assignmentKeys.has(key)) {
        console.warn(`⚠️ Skipping duplicate assignment: ${key}`);
        return false;
      }
      assignmentKeys.add(key);
      return true;
    });
    
    console.log(`✅ Final validation: ${deduplicatedAssignments.length}/${elderlyAssignmentsToCreate.length} assignments are valid and unique`);
    
    // Use shared batch creation function
    const batchResult = await createElderlyAssignmentsBatch(deduplicatedAssignments, batch, writeCount);
    const finalBatch = batchResult.batch;
    const finalWriteCount = batchResult.writeCount;
    
    // Commit all changes
    if (finalWriteCount > 0) {
      await finalBatch.commit();
      console.log(`💾 Successfully committed ${finalWriteCount} database operations`);
    }
    
    // Additional verification: Ensure all assignments were created
    console.log(`📋 Integration Summary:`);
    console.log(`  - Deactivated old assignments: ${assignmentsToDeactivate.length}`);
    console.log(`  - Created new assignments: ${elderlyAssignmentsToCreate.length}`);
    console.log(`  - New caregiver assignments: ${elderlyAssignmentsToCreate.filter(ea => ea.caregiver_id === caregiverId).length}`);
    console.log(`  - Existing caregiver assignments updated: ${elderlyAssignmentsToCreate.filter(ea => ea.caregiver_id !== caregiverId).length}`);
    
    // Log the integration activity with detailed distribution info
    await addDoc(collection(db, "activity_logs_v2"), {
      action: "New Caregiver Integration with Complete Elderly Redistribution",
      caregiver_id: caregiverId,
      assignment_details: assignmentData,
      redistribution_summary: {
        total_elderly_in_house: elderlyList.length,
        total_caregivers_in_house: allHouseCaregivers.length,
        assignments_deactivated: assignmentsToDeactivate.length,
        assignments_created: elderlyAssignmentsToCreate.length,
        new_caregiver_elderly_count: elderlyAssignmentsToCreate.filter(ea => ea.caregiver_id === caregiverId).length,
        existing_caregivers_updated: elderlyAssignmentsToCreate.filter(ea => ea.caregiver_id !== caregiverId).length,
        distribution_type: allHouseCaregivers.length === 1 ? "single_gets_all" : "complete_redistribution"
      },
      time: Timestamp.now(),
      created_by: "admin"
    });
    
    const newCaregiverElderlyCount = elderlyAssignmentsToCreate.filter(ea => ea.caregiver_id === caregiverId).length;
    
    console.log(`✅ Successfully integrated caregiver ${caregiverId} with ${newCaregiverElderlyCount} elderly assignments`);
    console.log(`📊 Total elderly assignments created/updated: ${elderlyAssignmentsToCreate.length}`);
    
    return {
      success: true,
      message: `Successfully integrated caregiver into ${assignmentData.house} - ${assignmentData.shift} shift`,
      elderlyAssigned: newCaregiverElderlyCount,
      totalElderlyRedistributed: elderlyAssignmentsToCreate.length,
      assignment: assignmentDoc
    };
    
  } catch (error) {
    console.error("Error integrating new caregiver:", error);
    return {
      success: false,
      message: error.message || "Failed to integrate caregiver"
    };
  }
};