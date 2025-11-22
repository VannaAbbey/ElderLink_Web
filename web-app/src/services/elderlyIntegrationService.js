/**
 * Elderly Integration Service
 * Handles automatic redistribution of elderly assignments when new elderly are added
 */
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
import { db } from "../firebase";

/**
 * Check if there's an active schedule for a specific house
 * @param {string} houseId - House ID (e.g., "H001", "H002")
 * @returns {Object} { hasActiveSchedule: boolean, shifts: Array, days: Array }
 */
export const checkActiveScheduleForHouse = async (houseId) => {
  try {
    console.log(`🔍 Checking active schedule for house ${houseId}`);
    
    const assignmentsQuery = query(
      collection(db, "house_shift_assignments"),
      where("house_id", "==", houseId),
      where("is_current", "==", true),
      where("user_type", "==", "caregiver")
    );
    
    const snapshot = await getDocs(assignmentsQuery);
    
    if (snapshot.empty) {
      console.log(`❌ No active schedule found for house ${houseId}`);
      return { hasActiveSchedule: false, shifts: [], days: [], assignments: [] };
    }
    
    const assignments = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Get unique shifts and days
    const shifts = [...new Set(assignments.map(a => a.shift))];
    const allDays = assignments.flatMap(a => a.days_assigned || []);
    const days = [...new Set(allDays)];
    
    console.log(`✅ Found active schedule for house ${houseId}: ${assignments.length} assignments across ${shifts.length} shifts`);
    
    return {
      hasActiveSchedule: true,
      shifts,
      days,
      assignments,
      caregiverCount: assignments.length
    };
    
  } catch (error) {
    console.error("Error checking active schedule:", error);
    return { hasActiveSchedule: false, shifts: [], days: [], assignments: [] };
  }
};

/**
 * Add new elderly incrementally to existing assignments (minimal disruption)
 * Called when new elderly is added - preserves existing relationships
 * @param {string} houseId - House ID
 * @param {string} newElderlyId - ID of the newly added elderly
 * @param {Array} assignments - Current caregiver assignments for the house
 * @returns {Object} { success: boolean, message: string, updatedCount: number }
 */
export const addElderlyIncrementally = async (houseId, newElderlyId, assignments) => {
  try {
    console.log(`\n%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #4ECDC4; font-weight: bold');
    console.log(`%c➕ INCREMENTAL ELDERLY ADDITION STARTED`, 'color: #4ECDC4; font-weight: bold; font-size: 14px');
    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #4ECDC4; font-weight: bold');
    console.log(`%c📍 House: ${houseId}`, 'color: #FFD93D; font-weight: bold');
    console.log(`%c🆕 New Elderly ID: ${newElderlyId}`, 'color: #FFD93D; font-weight: bold');
    console.log(`%c👨‍⚕️ Total Caregivers: ${assignments.length}`, 'color: #FFD93D; font-weight: bold');
    
    if (!newElderlyId) {
      console.log(`%c⚠️ No elderly ID provided`, 'color: #FF6B6B');
      return { success: false, message: "No elderly ID provided", updatedCount: 0 };
    }
    
    if (assignments.length === 0) {
      console.log(`%c⚠️ No caregivers assigned to this house`, 'color: #FF6B6B');
      return { success: false, message: "No caregivers assigned to this house", updatedCount: 0 };
    }
    
    // Get all current elderly assignments for this house
    const elderlyAssignmentsQuery = query(
      collection(db, "elderly_assignments"),
      where("house_id", "==", houseId),
      where("status", "==", "active"),
      where("user_type", "==", "caregiver")
    );
    
    const elderlyAssignmentsSnapshot = await getDocs(elderlyAssignmentsQuery);
    const existingAssignments = elderlyAssignmentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    
    console.log(`%c📊 Found ${existingAssignments.length} existing elderly assignments`, 'color: #95E1D3');
    console.log(`%c� Strategy: INCREMENTAL ADDITION (preserves existing relationships)`, 'color: #FFD93D; font-weight: bold');
    
    // Group assignments by shift and day
    const assignmentsByShiftDay = {};
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    
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
    console.log(`%c   Strategy: Add ONLY new elderly to caregiver with least elderly`, 'color: #FFD93D');
    console.log(`%c   All existing assignments will remain unchanged`, 'color: #FFD93D');
    
    let totalAssignmentsUpdated = 0;
    const batch = writeBatch(db);
    const BATCH_SIZE = 450;
    let writeCount = 0;
    
    // For each shift/day combination, find caregiver with least elderly and assign new one
    for (const [key, caregivers] of Object.entries(assignmentsByShiftDay)) {
      const [shift, day] = key.split('_');
      
      console.log(`\n%c🔹 ${day} - ${shift}:`, 'color: #FFD93D; font-weight: bold');
      
      // Count current elderly for each caregiver in this shift/day
      const caregiversWithCounts = [];
      
      for (const caregiver of caregivers) {
        const existingAssignment = existingAssignments.find(
          ea => ea.user_id === caregiver.user_id && 
                ea.day === day && 
                ea.shift === shift
        );
        
        const elderlyCount = existingAssignment?.elderly_ids?.length || 0;
        
        caregiversWithCounts.push({
          caregiver,
          existingAssignment,
          elderlyCount
        });
        
        console.log(`   Caregiver ${caregiver.user_id}: Currently has ${elderlyCount} elderly`);
      }
      
      // Find minimum elderly count
      const minCount = Math.min(...caregiversWithCounts.map(c => c.elderlyCount));
      
      // Get all caregivers with minimum count
      const caregiversWithMinCount = caregiversWithCounts.filter(c => c.elderlyCount === minCount);
      
      // RANDOMIZATION: If multiple caregivers tied for least, pick randomly
      let selectedCaregiver;
      if (caregiversWithMinCount.length > 1) {
        const randomIndex = Math.floor(Math.random() * caregiversWithMinCount.length);
        selectedCaregiver = caregiversWithMinCount[randomIndex];
        console.log(`%c   🎲 ${caregiversWithMinCount.length} caregivers tied with ${minCount} elderly`, 'color: #FFD93D');
        console.log(`%c   🎯 Randomly selected: ${selectedCaregiver.caregiver.user_id}`, 'color: #4ECDC4; font-weight: bold');
      } else {
        selectedCaregiver = caregiversWithMinCount[0];
        console.log(`%c   ✅ Selected caregiver with least elderly (${minCount}): ${selectedCaregiver.caregiver.user_id}`, 'color: #4ECDC4; font-weight: bold');
      }
      
      // Add new elderly to selected caregiver's assignment
      if (selectedCaregiver.existingAssignment) {
        // Update existing assignment
        const updatedElderlyIds = [
          ...selectedCaregiver.existingAssignment.elderly_ids,
          newElderlyId
        ];
        
        batch.update(
          doc(db, "elderly_assignments", selectedCaregiver.existingAssignment.id),
          { 
            elderly_ids: updatedElderlyIds,
            last_updated: Timestamp.now()
          }
        );
        
        console.log(`%c   📝 Updated assignment: ${minCount} → ${updatedElderlyIds.length} elderly`, 'color: #95E1D3');
        
      } else {
        // Create new assignment if none exists (shouldn't happen but handle it)
        const newAssignment = {
          user_id: selectedCaregiver.caregiver.user_id,
          user_type: "caregiver",
          house_id: houseId,
          day: day,
          shift: shift,
          elderly_ids: [newElderlyId],
          assign_version: selectedCaregiver.caregiver.version || 1,
          status: "active",
          created_at: Timestamp.now(),
          last_updated: Timestamp.now()
        };
        
        // Handle 3rd shift overnight logic
        if (shift === "3rd") {
          const dayIndex = daysOfWeek.indexOf(day);
          const nextDay = daysOfWeek[(dayIndex + 1) % 7];
          newAssignment.start_day = day;
          newAssignment.end_day = nextDay;
        }
        
        batch.set(doc(collection(db, "elderly_assignments")), newAssignment);
        console.log(`%c   ➕ Created new assignment with 1 elderly`, 'color: #95E1D3');
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
      action: "Incremental Elderly Addition",
      house_id: houseId,
      new_elderly_id: newElderlyId,
      assignments_updated: totalAssignmentsUpdated,
      timestamp: Timestamp.now(),
      triggered_by: "new_elderly_addition"
    });
    
    console.log(`\n%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #95E1D3; font-weight: bold');
    console.log(`%c✅ INCREMENTAL ADDITION COMPLETE`, 'color: #95E1D3; font-weight: bold; font-size: 14px');
    console.log(`%c   Total assignments updated: ${totalAssignmentsUpdated}`, 'color: #95E1D3; font-weight: bold');
    console.log(`%c   All existing caregiver-elderly relationships preserved`, 'color: #95E1D3; font-weight: bold');
    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`, 'color: #95E1D3; font-weight: bold');
    
    return {
      success: true,
      message: `Successfully added new elderly to ${totalAssignmentsUpdated} shifts with minimal disruption`,
      updatedCount: totalAssignmentsUpdated
    };
    
  } catch (error) {
    console.error("%c❌ Error in incremental elderly addition:", 'color: #FF6B6B; font-weight: bold', error);
    return {
      success: false,
      message: `Failed to add elderly incrementally: ${error.message}`,
      updatedCount: 0
    };
  }
};

/**
 * Main function to integrate new elderly into active schedule
 * Called after elderly profile is saved
 * @param {string} houseId - House ID where elderly was added
 * @param {string} elderlyId - ID of the newly added elderly
 * @returns {Object} { success: boolean, message: string, redistributed: boolean }
 */
export const integrateNewElderlyIntoSchedule = async (houseId, elderlyId) => {
  try {
    console.log(`\n%c🆕 INTEGRATING NEW ELDERLY INTO SCHEDULE`, 'color: #4ECDC4; font-weight: bold; font-size: 14px');
    console.log(`%c   House: ${houseId}`, 'color: #FFD93D');
    console.log(`%c   Elderly ID: ${elderlyId}`, 'color: #FFD93D');
    
    // Check if there's an active schedule for this house
    const scheduleCheck = await checkActiveScheduleForHouse(houseId);
    
    if (!scheduleCheck.hasActiveSchedule) {
      console.log(`%cℹ️ No active schedule found. Elderly will be included in next schedule generation.`, 'color: #FFD93D');
      return {
        success: true,
        message: "Elderly saved successfully. Will be included in next schedule generation.",
        redistributed: false
      };
    }
    
    // Add elderly incrementally (preserves existing assignments)
    const result = await addElderlyIncrementally(houseId, elderlyId, scheduleCheck.assignments);
    
    return {
      success: result.success,
      message: result.success 
        ? `Elderly integrated successfully! ${result.updatedCount} assignments updated.`
        : result.message,
      integrated: result.success,
      updatedCount: result.updatedCount
    };
    
  } catch (error) {
    console.error("Error integrating new elderly:", error);
    return {
      success: false,
      message: `Failed to integrate elderly: ${error.message}`,
      redistributed: false
    };
  }
};
