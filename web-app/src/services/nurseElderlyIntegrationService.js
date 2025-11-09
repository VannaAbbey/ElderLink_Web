/**
 * Nurse Elderly Integration Service
 * Handles automatic redistribution of elderly assignments when new elderly are added to nurse schedules
 * Similar to caregiver integration but for nurses
 */

import { db } from "../firebase";
import {
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  addDoc,
  doc,
  Timestamp
} from "firebase/firestore";

/**
 * Check if there's an active nurse schedule (NOT house-specific - nurses work across ALL houses)
 * @param {string} houseId - House ID (optional, kept for API compatibility but not used in query)
 * @returns {Object} { hasActiveSchedule: boolean, shifts: Array, days: Array, nurseCount: number }
 */
export const checkActiveNurseScheduleForHouse = async (houseId) => {
  try {
    console.log(`🔍 [NURSE] Checking active schedule (GLOBAL - nurses work across ALL houses)`);
    
    // ⚠️ IMPORTANT: Nurses are NOT assigned to specific houses (unlike caregivers)
    // They work across ALL houses, so we query ALL active nurse assignments
    const assignmentsQuery = query(
      collection(db, "house_shift_assignments"),
      where("is_current", "==", true),
      where("user_type", "==", "nurse")
    );
    
    const snapshot = await getDocs(assignmentsQuery);
    console.log(`📊 [NURSE] Found ${snapshot.size} total nurse assignments`);
    
    if (snapshot.size === 0) {
      console.log(`❌ [NURSE] No active nurse schedule found`);
      return { hasActiveSchedule: false, shifts: [], days: [], assignments: [], nurseCount: 0 };
    }
    
    // Get ALL nurse assignments (no house filtering)
    const assignments = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Get unique nurses (count distinct nurse IDs)
    const uniqueNurseIds = [...new Set(assignments.map(a => a.user_id))];
    const nurseCount = uniqueNurseIds.length;
    
    // Get unique shifts and days
    const shifts = [...new Set(assignments.map(a => a.shift))];
    const allDays = assignments.flatMap(a => a.days_assigned || []);
    const days = [...new Set(allDays)];
    
    console.log(`✅ [NURSE] Found active schedule: ${nurseCount} nurses, ${assignments.length} assignments across ${shifts.length} shifts`);
    
    return {
      hasActiveSchedule: true,
      shifts,
      days,
      assignments,
      nurseCount // Total unique nurses in schedule
    };
    
  } catch (error) {
    console.error("[NURSE] Error checking active schedule:", error);
    return { hasActiveSchedule: false, shifts: [], days: [], assignments: [], nurseCount: 0 };
  }
};

/**
 * Add new elderly incrementally to existing nurse assignments (minimal disruption)
 * ⚠️ IMPORTANT: Nurses work across ALL houses (unlike caregivers), so we add elderly to ALL nurse shifts
 * @param {string} houseId - House ID where elderly was added (for reference only)
 * @param {string} newElderlyId - ID of the newly added elderly
 * @param {Array} assignments - ALL current nurse assignments (global)
 * @returns {Object} { success: boolean, message: string, updatedCount: number }
 */
export const addElderlyToNurseScheduleIncrementally = async (houseId, newElderlyId, assignments) => {
  try {
    console.log(`\n%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #4ECDC4; font-weight: bold');
    console.log(`%c➕ [NURSE] INCREMENTAL ELDERLY ADDITION STARTED`, 'color: #4ECDC4; font-weight: bold; font-size: 14px');
    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #4ECDC4; font-weight: bold');
    console.log(`%c📍 Elderly from House: ${houseId}`, 'color: #FFD93D; font-weight: bold');
    console.log(`%c🆕 New Elderly ID: ${newElderlyId}`, 'color: #FFD93D; font-weight: bold');
    console.log(`%c👨‍⚕️ Total Nurse Assignments: ${assignments.length}`, 'color: #FFD93D; font-weight: bold');
    console.log(`%c⚠️ NOTE: Nurses work across ALL houses (not house-specific)`, 'color: #FFD93D; font-weight: bold');
    
    if (!newElderlyId) {
      console.log(`%c⚠️ No elderly ID provided`, 'color: #FF6B6B');
      return { success: false, message: "No elderly ID provided", updatedCount: 0 };
    }
    
    if (assignments.length === 0) {
      console.log(`%c⚠️ No nurse assignments found`, 'color: #FF6B6B');
      return { success: false, message: "No nurse assignments found", updatedCount: 0 };
    }
    
    // Get ALL current elderly assignments for nurses (no house filtering)
    const elderlyAssignmentsQuery = query(
      collection(db, "elderly_assignments"),
      where("user_type", "==", "nurse")
    );
    
    const elderlyAssignmentsSnapshot = await getDocs(elderlyAssignmentsQuery);
    const existingAssignments = elderlyAssignmentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    
    console.log(`%c📊 Found ${existingAssignments.length} existing nurse-elderly assignments (ALL houses)`, 'color: #95E1D3');
    console.log(`%c🎯 Strategy: INCREMENTAL ADDITION (preserves existing relationships)`, 'color: #FFD93D; font-weight: bold');
    
    // Group assignments by shift and day
    const assignmentsByShiftDay = {};
    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    
    assignments.forEach(assignment => {
      const shift = assignment.shift;
      const days = assignment.days_assigned || [];
      
      days.forEach(day => {
        const key = `${shift}_${day}`;
        if (!assignmentsByShiftDay[key]) {
          assignmentsByShiftDay[key] = [];
        }
        assignmentsByShiftDay[key].push(assignment);
      });
    });
    
    console.log(`\n%c📋 INCREMENTAL ADDITION PLAN:`, 'color: #4ECDC4; font-weight: bold; font-size: 14px');
    console.log(`%c   Strategy: Add ONLY new elderly to nurse with least elderly`, 'color: #FFD93D');
    console.log(`%c   All existing assignments will remain unchanged`, 'color: #FFD93D');
    
    let totalAssignmentsUpdated = 0;
    const batch = writeBatch(db);
    const BATCH_SIZE = 450;
    let writeCount = 0;
    
    // For each shift/day combination, find nurse with least elderly and assign new one
    for (const [key, nurses] of Object.entries(assignmentsByShiftDay)) {
      const [shift, day] = key.split('_');
      
      console.log(`\n%c🔹 ${day} - ${shift}:`, 'color: #FFD93D; font-weight: bold');
      
      // Count current elderly for each nurse in this shift/day
      const nursesWithCounts = [];
      
      for (const nurse of nurses) {
        const existingAssignment = existingAssignments.find(
          ea => ea.user_id === nurse.user_id && 
                ea.day === day && 
                ea.shift === shift
        );
        
        const elderlyCount = existingAssignment?.elderly_ids?.length || 0;
        
        nursesWithCounts.push({
          nurse,
          existingAssignment,
          elderlyCount
        });
        
        console.log(`   Nurse ${nurse.user_id}: Currently has ${elderlyCount} elderly`);
      }
      
      // Find minimum elderly count
      const minCount = Math.min(...nursesWithCounts.map(n => n.elderlyCount));
      
      // Get all nurses with minimum count
      const nursesWithMinCount = nursesWithCounts.filter(n => n.elderlyCount === minCount);
      
      // RANDOMIZATION: If multiple nurses tied for least, pick randomly
      let selectedNurse;
      if (nursesWithMinCount.length > 1) {
        const randomIndex = Math.floor(Math.random() * nursesWithMinCount.length);
        selectedNurse = nursesWithMinCount[randomIndex];
        console.log(`%c   🎲 ${nursesWithMinCount.length} nurses tied with ${minCount} elderly`, 'color: #FFD93D');
        console.log(`%c   🎯 Randomly selected: ${selectedNurse.nurse.user_id}`, 'color: #4ECDC4; font-weight: bold');
      } else {
        selectedNurse = nursesWithMinCount[0];
        console.log(`%c   ✅ Selected nurse with least elderly (${minCount}): ${selectedNurse.nurse.user_id}`, 'color: #4ECDC4; font-weight: bold');
      }
      
      // Add new elderly to selected nurse's assignment
      if (selectedNurse.existingAssignment) {
        // Update existing assignment - add new elderly ID
        const currentElderlyIds = selectedNurse.existingAssignment.elderly_ids || [];
        
        // Check if elderly is already assigned (avoid duplicates)
        if (currentElderlyIds.includes(newElderlyId)) {
          console.log(`%c   ⚠️ Elderly ${newElderlyId} already assigned to nurse ${selectedNurse.nurse.user_id} on ${day} ${shift}`, 'color: #FFD93D');
          continue; // Skip this shift/day combination
        }
        
        const updatedElderlyIds = [...currentElderlyIds, newElderlyId];
        
        // Get the document reference from Firestore
        const docRef = doc(db, "elderly_assignments", selectedNurse.existingAssignment.id);
        
        batch.update(docRef, {
          elderly_ids: updatedElderlyIds,
          updated_at: Timestamp.now()
        });
        
        console.log(`%c   📝 Updating assignment ${selectedNurse.existingAssignment.id}: ${currentElderlyIds.length} → ${updatedElderlyIds.length} elderly`, 'color: #95E1D3');
        
      } else {
        // Create new assignment (shouldn't happen if schedule is properly generated, but handle it)
        const newAssignmentRef = doc(collection(db, "elderly_assignments"));
        
        // ⚠️ For nurses: house_id should be array of ALL houses (nurses work across all houses)
        // We'll use the specific house where elderly was added, but this could be expanded
        const houseIdToSave = Array.isArray(houseId) ? houseId : [houseId];
        
        batch.set(newAssignmentRef, {
          user_id: selectedNurse.nurse.user_id,
          user_type: "nurse",
          house_id: houseIdToSave, // Save as array
          day: day,
          shift: shift,
          elderly_ids: [newElderlyId],
          created_at: Timestamp.now(),
          updated_at: Timestamp.now()
        });
        
        console.log(`%c   ✨ Creating new assignment for nurse ${selectedNurse.nurse.user_id}: 1 elderly`, 'color: #95E1D3');
      }
      
      writeCount++;
      totalAssignmentsUpdated++;
      
      // Commit batch if limit reached
      if (writeCount >= BATCH_SIZE) {
        await batch.commit();
        console.log(`%c✅ Committed batch of ${writeCount} updates`, 'color: #95E1D3');
        writeCount = 0;
      }
    }
    
    // Commit remaining updates
    if (writeCount > 0) {
      await batch.commit();
      console.log(`%c✅ Committed final batch of ${writeCount} updates`, 'color: #95E1D3');
    }
    
    // Log the incremental addition activity
    await addDoc(collection(db, "activity_logs"), {
      action: "Incremental Nurse-Elderly Addition",
      house_id: houseId,
      new_elderly_id: newElderlyId,
      assignments_updated: totalAssignmentsUpdated,
      timestamp: Timestamp.now(),
      triggered_by: "new_elderly_addition",
      user_type: "nurse"
    });
    
    console.log(`\n%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #95E1D3; font-weight: bold');
    console.log(`%c✅ [NURSE] INCREMENTAL ADDITION COMPLETE`, 'color: #95E1D3; font-weight: bold; font-size: 14px');
    console.log(`%c   Total assignments updated: ${totalAssignmentsUpdated}`, 'color: #95E1D3; font-weight: bold');
    console.log(`%c   All existing nurse-elderly relationships preserved`, 'color: #95E1D3; font-weight: bold');
    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`, 'color: #95E1D3; font-weight: bold');
    
    return {
      success: true,
      message: `Successfully added new elderly to ${totalAssignmentsUpdated} nurse shifts with minimal disruption`,
      updatedCount: totalAssignmentsUpdated
    };
    
  } catch (error) {
    console.error("%c❌ [NURSE] Error in incremental elderly addition:", 'color: #FF6B6B; font-weight: bold', error);
    return {
      success: false,
      message: `Failed to add elderly incrementally: ${error.message}`,
      updatedCount: 0
    };
  }
};

/**
 * Main function to integrate new elderly into active nurse schedule
 * Called after elderly profile is saved
 * @param {string} houseId - House ID where elderly was added
 * @param {string} elderlyId - ID of the newly added elderly
 * @returns {Object} { success: boolean, message: string, integrated: boolean }
 */
export const integrateNewElderlyIntoNurseSchedule = async (houseId, elderlyId) => {
  try {
    console.log(`\n%c🆕 [NURSE] INTEGRATING NEW ELDERLY INTO SCHEDULE`, 'color: #4ECDC4; font-weight: bold; font-size: 14px');
    console.log(`%c   House: ${houseId}`, 'color: #FFD93D');
    console.log(`%c   Elderly ID: ${elderlyId}`, 'color: #FFD93D');
    
    // Check if there's an active nurse schedule for this house
    const scheduleCheck = await checkActiveNurseScheduleForHouse(houseId);
    
    if (!scheduleCheck.hasActiveSchedule) {
      console.log(`%cℹ️ [NURSE] No active schedule found. Elderly will be included in next schedule generation.`, 'color: #FFD93D');
      return {
        success: true,
        message: "Elderly saved successfully. Will be included in next nurse schedule generation.",
        integrated: false
      };
    }
    
    // Add elderly incrementally (preserves existing assignments)
    const result = await addElderlyToNurseScheduleIncrementally(houseId, elderlyId, scheduleCheck.assignments);
    
    return {
      success: result.success,
      message: result.success 
        ? `Elderly integrated into nurse schedule! ${result.updatedCount} assignments updated.`
        : result.message,
      integrated: result.success,
      updatedCount: result.updatedCount
    };
    
  } catch (error) {
    console.error("[NURSE] Error integrating new elderly:", error);
    return {
      success: false,
      message: `Failed to integrate elderly into nurse schedule: ${error.message}`,
      integrated: false
    };
  }
};
