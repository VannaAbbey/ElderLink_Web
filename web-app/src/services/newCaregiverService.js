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
      query(
        collection(db, "house_shift_assignments"), 
        where("is_current", "==", true),
        where("user_type", "==", "caregiver")
      )
    );
    
    const assignedCaregiverIds = new Set();
    currentAssignments.docs.forEach(doc => {
      assignedCaregiverIds.add(doc.data().user_id);
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
    
    // Dates are nested inside schedule_period object
    const startDate = currentAssignment.schedule_period?.start_date || currentAssignment.start_date;
    const endDate = currentAssignment.schedule_period?.end_date || currentAssignment.end_date;
    
    if (!startDate || !endDate) {
      console.error("Current assignment structure:", currentAssignment);
      throw new Error("Could not find start_date or end_date in current assignment. Please check the assignment structure.");
    }
    
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
    
    // Calculate duration in days from start_date to end_date
    // Handle both Firebase Timestamp and regular Date objects
    const startDateMs = startDate.toDate ? startDate.toDate().getTime() : (startDate.getTime ? startDate.getTime() : new Date(startDate).getTime());
    const endDateMs = endDate.toDate ? endDate.toDate().getTime() : (endDate.getTime ? endDate.getTime() : new Date(endDate).getTime());
    const durationDays = Math.ceil((endDateMs - startDateMs) / (1000 * 60 * 60 * 24));
    
    // Create new assignment document with unified schema
    const newAssignmentRef = doc(collection(db, "house_shift_assignments"));
    const assignmentDoc = {
      user_id: caregiverId,
      user_type: "caregiver",
      assignment_type: "manual_integration",
      house_id: assignmentData.house,
      shift: assignmentData.shift,
      shift_name: shiftDef.name,
      start_time: time_range.start,
      end_time: time_range.end,
      days_assigned: assignmentData.workDays,
      schedule_period: {
        auto_generated: false,
        duration_days: durationDays,
        start_date: startDate,
        end_date: endDate
      },
      is_current: true,
      status: "active",
      version: version,
      created_at: Timestamp.now(),
      integration_metadata: {
        integration_type: "manual_addition",
        integration_date: Timestamp.now(),
        integrated_by: "admin"
      }
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
    
    // Prepare base metadata for elderly assignment creation (will be customized per caregiver)
    const baseAssignmentMetadata = {
      version: version,
      house_id: assignmentData.house,
      house_name: houses.find(h => h.house_id === assignmentData.house)?.house_name || assignmentData.house
    };
    
    // For each work day, properly redistribute existing elderly assignments
    for (const workDay of assignmentData.workDays) {
      console.log(`📅 Processing ${workDay} for complete elderly redistribution...`);
      
      // STEP 1: Query database DIRECTLY to find ALL existing elderly assignments for this day/shift/house
      // This ensures we find ALL assignments including orphaned ones (deleted caregivers)
      // DO NOT filter by version - we want to deactivate ALL active assignments regardless of version
      // NOTE: house_id in elderly_assignments is stored as an ARRAY, so we can't use where() directly
      const elderlyAssignmentsQuery = query(
        collection(db, "elderly_assignments"),
        where("shift", "==", assignmentData.shift),
        where("day", "==", workDay),
        where("status", "==", "active"),
        where("is_current", "==", true)
      );
      
      const elderlyAssignmentsSnapshot = await getDocs(elderlyAssignmentsQuery);
      
      // Filter by house_id (since it's an array, we need to filter in memory)
      const existingDayAssignments = elderlyAssignmentsSnapshot.docs
        .map(doc => ({ id: doc.id, ref: doc.ref, ...doc.data() }))
        .filter(ea => {
          const houseIdMatch = Array.isArray(ea.house_id) 
            ? ea.house_id.includes(assignmentData.house)
            : ea.house_id === assignmentData.house;
          return houseIdMatch;
        });
      
      console.log(`📋 Found ${existingDayAssignments.length} existing elderly assignments for ${workDay} ${assignmentData.shift} shift in ${assignmentData.house}`);
      
      // Debug: Log which assignments we found
      if (existingDayAssignments.length > 0) {
        console.log(`🔍 Existing assignments to deactivate:`);
        existingDayAssignments.forEach((assignment, idx) => {
          // Check if caregiver still exists in users collection
          const caregiverStillExists = allCaregivers.docs.find(doc => doc.id === assignment.user_id);
          const isOrphaned = !caregiverStillExists;
          
          console.log(`  ${idx + 1}. ID: ${assignment.id}, Caregiver: ${assignment.user_id || assignment.caregiver_id} (${assignment.user_fname || 'Unknown'} ${assignment.user_lname || 'User'})${isOrphaned ? ' ⚠️ ORPHANED - Caregiver deleted' : ''}, Elderly: ${assignment.elderly_ids ? assignment.elderly_ids.length : 0} elderly`);
        });
      }
      
      // STEP 2: Collect all elderly currently assigned to this day/shift/house (handle array structure)
      const elderlyToRedistribute = [];
      const existingElderlyIds = new Set();
      
      for (const assignment of existingDayAssignments) {
        // Handle array structure - each assignment now contains multiple elderly
        const elderlyIds = assignment.elderly_ids || [];
        
        for (const elderlyId of elderlyIds) {
          if (!existingElderlyIds.has(elderlyId)) {
            existingElderlyIds.add(elderlyId);
            
            // Find the elderly details from our elderly list
            const elderlyDetails = elderlyList.find(e => e.id === elderlyId);
            if (elderlyDetails) {
              elderlyToRedistribute.push(elderlyDetails);
            } else {
              console.warn(`⚠️ Could not find elderly details for ID: ${elderlyId}`);
            }
          }
        }
        
        // Mark this assignment for deactivation
        assignmentsToDeactivate.push({
          id: assignment.id,
          reason: `complete_redistribution_new_caregiver_${caregiverId}_${workDay}`
        });
      }
      
      // CRITICAL FIX: If no existing assignments found, we still need to assign ALL house elderly
      // But we need to deduplicate - don't add elderly that are already in the redistribution list
      if (existingDayAssignments.length === 0 && elderlyList.length > 0) {
        console.log(`📝 No existing assignments for ${workDay} - will distribute all ${elderlyList.length} house elderly`);
        // Only add elderly that aren't already in the redistribution list
        for (const elderly of elderlyList) {
          if (!existingElderlyIds.has(elderly.id)) {
            elderlyToRedistribute.push(elderly);
            existingElderlyIds.add(elderly.id);
          }
        }
      }
      
      console.log(`👥 Will redistribute ${elderlyToRedistribute.length} unique elderly among caregivers`);
      
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
        // Check if this caregiver is assigned to work on this specific day and shift
        if (cg.house_id === assignmentData.house &&
            cg.shift === assignmentData.shift &&
            cg.is_current &&
            cg.days_assigned && 
            cg.days_assigned.includes(workDay)) {
          
          // Get caregiver details from users collection for proper redistribution
          const existingCaregiverDoc = allCaregivers.docs.find(doc => doc.id === cg.user_id);
          if (existingCaregiverDoc) {
            const cgData = existingCaregiverDoc.data();
            workingCaregivers.push({
              caregiver_id: cg.user_id, // Keep as caregiver_id for elderly assignment compatibility
              caregiver_name: `${cgData.user_fname} ${cgData.user_lname}`.toLowerCase(),
              user_fname: cgData.user_fname,
              user_lname: cgData.user_lname
            });
            console.log(`👤 Found existing caregiver: ${cgData.user_fname} ${cgData.user_lname} working ${workDay} ${assignmentData.shift} shift`);
          }
        }
      }
      
      console.log(`👥 ${workDay}: ${workingCaregivers.length} total caregivers will handle ${elderlyToRedistribute.length} elderly`);
      console.log(`🔍 Working caregivers: ${workingCaregivers.map(wc => `${wc.user_fname} ${wc.user_lname} (${wc.caregiver_id})`).join(', ')}`);
      console.log(`🔍 Elderly to redistribute: ${elderlyToRedistribute.map(e => `${e.elderly_fname} ${e.elderly_lname} (${e.id})`).join(', ')}`);
      
      // Safety check: Ensure no duplicate elderly in redistribution list
      const uniqueElderlyIds = new Set(elderlyToRedistribute.map(e => e.id));
      if (uniqueElderlyIds.size !== elderlyToRedistribute.length) {
        console.warn(`⚠️ Found ${elderlyToRedistribute.length - uniqueElderlyIds.size} duplicate elderly in redistribution list - deduplicating...`);
        const uniqueElderly = [];
        const seenIds = new Set();
        for (const elderly of elderlyToRedistribute) {
          if (!seenIds.has(elderly.id)) {
            uniqueElderly.push(elderly);
            seenIds.add(elderly.id);
          }
        }
        elderlyToRedistribute.length = 0;
        elderlyToRedistribute.push(...uniqueElderly);
        console.log(`✅ Deduplicated to ${elderlyToRedistribute.length} unique elderly`);
      }
      
      // STEP 4: Use shared distribution function to redistribute ALL elderly among ALL caregivers
      if (elderlyToRedistribute.length > 0 && workingCaregivers.length > 0) {
        console.log(`📋 Calling distributeElderlyForDayShift with ${elderlyToRedistribute.length} elderly and ${workingCaregivers.length} caregivers`);
        
        // Create customized metadata - for now use new caregiver's assignment ID, but this will be updated per assignment
        const assignmentMetadata = {
          ...baseAssignmentMetadata,
          assign_id: newAssignmentId // This gets overridden per caregiver in the distribution function
        };
        
        const redistributedAssignments = distributeElderlyForDayShift(
          elderlyToRedistribute, 
          workingCaregivers, 
          workDay, 
          assignmentData.shift, 
          assignmentMetadata
        );
        
        console.log(`📋 distributeElderlyForDayShift returned ${redistributedAssignments.length} assignments`);
        
        // Update assignment IDs to match each caregiver's actual assignment ID
        redistributedAssignments.forEach(assignment => {
          // Find the correct assignment ID for this caregiver
          if (assignment.caregiver_id === caregiverId) {
            // New caregiver gets the new assignment ID
            assignment.assign_id = newAssignmentId;
          } else {
            // Existing caregivers use their existing assignment IDs
            const existingAssignment = currentAssignments.find(assign => 
              assign.user_id === assignment.caregiver_id &&
              assign.house_id === assignmentData.house &&
              assign.shift === assignmentData.shift &&
              assign.is_current
            );
            if (existingAssignment) {
              assignment.assign_id = existingAssignment.id;
            }
          }
          
          assignment.integration_type = "complete_redistribution_with_new_caregiver";
          assignment.redistribution_trigger = `new_caregiver_${caregiverId}_added`;
        });
        
        elderlyAssignmentsToCreate.push(...redistributedAssignments);
        
        console.log(`✅ Created ${redistributedAssignments.length} redistributed assignments for ${workDay}`);
        
        // Debug: Log assignment details
        redistributedAssignments.forEach((assignment, idx) => {
          console.log(`  ${idx + 1}. Caregiver ${assignment.user_fname} ${assignment.user_lname} (${assignment.user_id}): elderly_count=${assignment.elderly_ids?.length || 0}`);
        });
        
      } else if (elderlyToRedistribute.length === 0) {
        console.log(`ℹ️ No elderly to redistribute for ${workDay} - checking if house has elderly...`);
        console.log(`ℹ️ House has ${elderlyList.length} total elderly, ${existingDayAssignments.length} existing assignments`);
      } else if (workingCaregivers.length === 0) {
        console.log(`⚠️ No working caregivers found for ${workDay} - this shouldn't happen!`);
      }
    }
    
    console.log(`📊 Created ${elderlyAssignmentsToCreate.length} elderly assignments for complete redistribution across ${assignmentData.workDays.length} work days`);
    
    // DEBUG: Log detailed information about assignments created
    if (elderlyAssignmentsToCreate.length > 0) {
      console.log(`🔍 DETAILED ASSIGNMENT BREAKDOWN:`);
      elderlyAssignmentsToCreate.forEach((assignment, idx) => {
        console.log(`  ${idx + 1}. Day: ${assignment.day}, Shift: ${assignment.shift}, Caregiver: ${assignment.caregiver_id}, Elderly Count: ${assignment.elderly_ids?.length || 0}`);
      });
    } else {
      console.log(`⚠️ NO ASSIGNMENTS CREATED - investigating why...`);
      console.log(`🔍 Debug info:`);
      console.log(`  - Work days: ${assignmentData.workDays}`);
      console.log(`  - House elderly count: ${elderlyList.length}`);
      console.log(`  - House caregivers (existing): ${houseCaregivers.length}`);
      console.log(`  - Total house caregivers (with new): ${allHouseCaregivers.length}`);
    }
    
    // Debug: Log assignments per caregiver to verify distribution
    const assignmentsByCaregiver = {};
    elderlyAssignmentsToCreate.forEach(assignment => {
      const userId = assignment.user_id || assignment.caregiver_id;
      if (!assignmentsByCaregiver[userId]) {
        assignmentsByCaregiver[userId] = 0;
      }
      assignmentsByCaregiver[userId]++;
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
      batch.update(doc(db, "elderly_assignments", deactivation.id), {
        status: "redistributed",
        is_current: false,
        deactivated_at: Timestamp.now(),
        deactivation_reason: deactivation.reason,
        redistributed_by: "new_caregiver_integration"
      });
      writeCount++;
    }
    
    // Create elderly assignments using shared batch function (same as main generator)
    const validElderlyAssignments = elderlyAssignmentsToCreate.filter(elderlyAssign => {
      // Validate assignment structure - check both user_id and caregiver_id for compatibility
      const userId = elderlyAssign.user_id || elderlyAssign.caregiver_id;
      if (!userId) {
        console.warn(`⚠️ Skipping assignment with missing user_id/caregiver_id:`, elderlyAssign);
        return false;
      }
      
      if (!elderlyAssign.elderly_ids || !Array.isArray(elderlyAssign.elderly_ids) || elderlyAssign.elderly_ids.length === 0) {
        console.warn(`⚠️ Skipping assignment with invalid elderly_ids for caregiver ${userId}:`, elderlyAssign.elderly_ids);
        return false;
      }
      
      // Validate each elderly ID exists
      for (const elderlyId of elderlyAssign.elderly_ids) {
        const elderlyExists = elderlyList.find(e => e.id === elderlyId);
        if (!elderlyExists) {
          console.warn(`⚠️ Skipping assignment for non-existent elderly: ${elderlyId}`);
          return false;
        }
      }
      
      return true;
    });
    
    // Additional validation: Check for duplicate assignments (same caregiver + day + shift)
    // Note: elderly_ids is now an array, so we check for duplicate caregiver assignments, not individual elderly
    const assignmentKeys = new Set();
    const deduplicatedAssignments = validElderlyAssignments.filter(assignment => {
      const userId = assignment.user_id || assignment.caregiver_id;
      const key = `${userId}_${assignment.day}_${assignment.shift}`;
      if (assignmentKeys.has(key)) {
        console.warn(`⚠️ Skipping duplicate assignment: ${key}`);
        return false;
      }
      assignmentKeys.add(key);
      return true;
    });
    
    console.log(`✅ Final validation: ${deduplicatedAssignments.length}/${elderlyAssignmentsToCreate.length} assignments are valid and unique`);
    
    if (deduplicatedAssignments.length === 0) {
      console.error(`❌ CRITICAL ERROR: No valid assignments to create after validation!`);
      console.error(`📊 Original assignments: ${elderlyAssignmentsToCreate.length}`);
      console.error(`📊 Valid assignments: ${validElderlyAssignments.length}`);
      console.error(`📊 Deduplicated assignments: ${deduplicatedAssignments.length}`);
      
      if (elderlyAssignmentsToCreate.length > 0) {
        console.error(`🔍 Sample assignment structure:`, elderlyAssignmentsToCreate[0]);
      }
    }
    
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
    console.log(`  - New caregiver assignments: ${elderlyAssignmentsToCreate.filter(ea => (ea.user_id || ea.caregiver_id) === caregiverId).length}`);
    console.log(`  - Existing caregiver assignments updated: ${elderlyAssignmentsToCreate.filter(ea => (ea.user_id || ea.caregiver_id) !== caregiverId).length}`);
    
    // Log the integration activity with detailed distribution info
    await addDoc(collection(db, "activity_logs"), {
      action: "New Caregiver Integration with Complete Elderly Redistribution",
      caregiver_id: caregiverId,
      assignment_details: assignmentData,
      redistribution_summary: {
        total_elderly_in_house: elderlyList.length,
        total_caregivers_in_house: allHouseCaregivers.length,
        assignments_deactivated: assignmentsToDeactivate.length,
        assignments_created: elderlyAssignmentsToCreate.length,
        new_caregiver_elderly_count: elderlyAssignmentsToCreate.filter(ea => (ea.user_id || ea.caregiver_id) === caregiverId).length,
        existing_caregivers_updated: elderlyAssignmentsToCreate.filter(ea => (ea.user_id || ea.caregiver_id) !== caregiverId).length,
        distribution_type: allHouseCaregivers.length === 1 ? "single_gets_all" : "complete_redistribution"
      },
      time: Timestamp.now(),
      created_by: "admin"
    });
    
    const newCaregiverElderlyCount = elderlyAssignmentsToCreate.filter(ea => (ea.user_id || ea.caregiver_id) === caregiverId).length;
    
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