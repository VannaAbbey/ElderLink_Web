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
              // Step 4: Generate clear explanation
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
    
    // Apply the same distribution logic as the main schedule generator - PER DAY AND SHIFT
    let elderlyAssignmentsToCreate = [];
    
    // For each work day, create daily assignments using the same logic as main scheduler
    for (const workDay of assignmentData.workDays) {
      console.log(`📅 Processing ${workDay} for caregiver integration...`);
      
      // Find existing elderly assignments for this day/shift/house
      const existingDayAssignments = elderlyAssignments.filter(ea => 
        ea.house_id === assignmentData.house &&
        ea.shift === assignmentData.shift &&
        ea.day === workDay
      );
      
      // Find caregivers working this day/shift (including the new one)
      const workingCaregivers = allHouseCaregivers.filter(cg => {
        if (cg.caregiver_id === caregiverId) return true; // New caregiver is always working
        
        // Check if existing caregiver works this day/shift
        const existingAssignment = currentAssignments.find(assign => 
          assign.caregiver_id === cg.caregiver_id && 
          assign.house_id === assignmentData.house &&
          assign.shift === assignmentData.shift &&
          assign.is_current &&
          assign.days_assigned && 
          assign.days_assigned.includes(workDay)
        );
        
        return !!existingAssignment;
      });
      
      console.log(`� ${workDay}: ${workingCaregivers.length} caregivers working, ${elderlyList.length} elderly, ${existingDayAssignments.length} existing assignments`);
      
      if (workingCaregivers.length === 1) {
        // Single caregiver gets ALL elderly in the house for this day
        console.log(`👤 Single caregiver scenario: ${caregiverId} gets all ${elderlyList.length} elderly on ${workDay}`);
        
        for (const elderly of elderlyList) {
          elderlyAssignmentsToCreate.push({
            caregiver_id: caregiverId,
            elderly_id: elderly.id,
            assigned_at: Timestamp.now(),
            assign_version: version,
            assign_id: newAssignmentId,
            status: "active",
            day: workDay,
            shift: assignmentData.shift,
            house_id: assignmentData.house,
            house_name: houses.find(h => h.house_id === assignmentData.house)?.house_name || assignmentData.house,
            assignment_type: "integration_single_caregiver_gets_all_house_elderly_per_day",
            caregiver_name: `${caregiverData.user_fname} ${caregiverData.user_lname}`.toLowerCase(),
            elderly_name: `${elderly.elderly_fname} ${elderly.elderly_lname}`.toLowerCase(),
            debug_info: `${workDay}_${assignmentData.shift}_integration_single_cg_all_elderly`,
            integration_type: "single_caregiver_gets_all"
          });
        }
        
      } else if (workingCaregivers.length > 1) {
        // Multiple caregivers: Distribute elderly among all working caregivers for this day
        console.log(`👥 Multiple caregivers on ${workDay}: ${workingCaregivers.length} caregivers, distributing ${elderlyList.length} elderly`);
        
        // Create balanced chunks for each working caregiver
        const elderlyChunks = Array.from({ length: workingCaregivers.length }, () => []);
        
        // Distribute elderly round-robin to ensure balanced assignment
        for (let i = 0; i < elderlyList.length; i++) {
          const chunkIndex = i % workingCaregivers.length;
          elderlyChunks[chunkIndex].push(elderlyList[i]);
        }
        
        // Find the new caregiver's index and assign their chunk
        const newCaregiverIndex = workingCaregivers.findIndex(cg => cg.caregiver_id === caregiverId);
        
        if (newCaregiverIndex >= 0) {
          const elderlyChunk = elderlyChunks[newCaregiverIndex];
          
          console.log(`👤 New caregiver gets ${elderlyChunk.length} elderly on ${workDay}: ${elderlyChunk.map(e => `${e.elderly_fname} ${e.elderly_lname}`).join(', ')}`);
          
          for (const elderly of elderlyChunk) {
            elderlyAssignmentsToCreate.push({
              caregiver_id: caregiverId,
              elderly_id: elderly.id,
              assigned_at: Timestamp.now(),
              assign_version: version,
              assign_id: newAssignmentId,
              status: "active",
              day: workDay,
              shift: assignmentData.shift,
              house_id: assignmentData.house,
              house_name: houses.find(h => h.house_id === assignmentData.house)?.house_name || assignmentData.house,
              assignment_type: "integration_multiple_caregivers_split_house_elderly_per_day",
              caregiver_name: `${caregiverData.user_fname} ${caregiverData.user_lname}`.toLowerCase(),
              elderly_name: `${elderly.elderly_fname} ${elderly.elderly_lname}`.toLowerCase(),
              debug_info: `${workDay}_${assignmentData.shift}_integration_multi_cg_split_elderly`,
              integration_type: "multiple_caregiver_daily_split"
            });
          }
        }
      }
    }
    
    console.log(`📊 Created ${elderlyAssignmentsToCreate.length} elderly assignments across ${assignmentData.workDays.length} work days`);
    
    // Handle conflicts: For multiple caregiver scenarios, we need to clean up existing
    // elderly assignments that might now be redistributed due to the new caregiver
    let assignmentsToDeactivate = [];
    
    if (elderlyAssignmentsToCreate.length > 0) {
      console.log(`🔄 Need to redistribute elderly assignments due to new caregiver integration`);
      
      // For each work day, find assignments that need to be updated due to redistribution
      for (const workDay of assignmentData.workDays) {
        // Find existing active assignments for this day/shift/house
        const dayAssignments = elderlyAssignments.filter(ea => 
          ea.house_id === assignmentData.house &&
          ea.shift === assignmentData.shift &&
          ea.day === workDay &&
          ea.status === "active"
        );
        
        // Find caregivers working this day/shift (including new one)
        const workingCaregivers = allHouseCaregivers.filter(cg => {
          if (cg.caregiver_id === caregiverId) return true;
          
          const existingAssignment = currentAssignments.find(assign => 
            assign.caregiver_id === cg.caregiver_id && 
            assign.house_id === assignmentData.house &&
            assign.shift === assignmentData.shift &&
            assign.is_current &&
            assign.days_assigned && 
            assign.days_assigned.includes(workDay)
          );
          
          return !!existingAssignment;
        });
        
        // If there are multiple caregivers now, we need to redistribute
        if (workingCaregivers.length > 1 && dayAssignments.length > 0) {
          console.log(`🧹 ${workDay}: Found ${dayAssignments.length} existing assignments to redistribute among ${workingCaregivers.length} caregivers`);
          
          // Mark existing assignments as needing update (deactivate them)
          for (const assignment of dayAssignments) {
            assignmentsToDeactivate.push({
              id: assignment.id,
              reason: `redistribution_due_to_new_caregiver_${caregiverId}_${workDay}`
            });
          }
        }
      }
    }
    
    console.log(`🗑️ Will deactivate ${assignmentsToDeactivate.length} conflicting elderly assignments`);
    
    // Deactivate conflicting assignments
    for (const deactivation of assignmentsToDeactivate) {
      batch.update(doc(db, "elderly_caregiver_assign_v2", deactivation.id), {
        status: "redistributed",
        deactivated_at: Timestamp.now(),
        deactivation_reason: deactivation.reason,
        redistributed_by: "new_caregiver_integration"
      });
      writeCount++;
    }
    
    // Create all elderly assignments with validation
    for (const elderlyAssign of elderlyAssignmentsToCreate) {
      // Validate elderly exists
      const elderlyExists = elderlyList.find(e => e.id === elderlyAssign.elderly_id);
      if (!elderlyExists) {
        console.warn(`⚠️ Skipping assignment for non-existent elderly: ${elderlyAssign.elderly_id}`);
        continue;
      }
      
      const elderlyAssignRef = doc(collection(db, "elderly_caregiver_assign_v2"));
      batch.set(elderlyAssignRef, elderlyAssign);
      writeCount++;
    }
    
    // Commit all changes
    if (writeCount > 0) {
      await batch.commit();
    }
    
    // Log the integration activity with detailed distribution info
    await addDoc(collection(db, "activity_logs_v2"), {
      action: "New Caregiver Integration with Elderly Redistribution",
      caregiver_id: caregiverId,
      assignment_details: assignmentData,
      elderly_distribution: {
        total_elderly_in_house: elderlyList.length,
        total_caregivers_in_house: allHouseCaregivers.length,
        new_caregiver_elderly_count: elderlyAssignmentsToCreate.filter(ea => ea.caregiver_id === caregiverId).length,
        distribution_type: allHouseCaregivers.length === 1 ? "single_gets_all" : "equal_redistribution"
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
