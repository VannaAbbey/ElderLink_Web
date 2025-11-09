/**
 * Resignation Service
 * Handles caregiver/nurse resignation and schedule redistribution
 */

import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  writeBatch,
  doc,
  Timestamp,
  addDoc,
} from "firebase/firestore";
import { db } from "../firebase";

/**
 * Check if a caregiver is marked as resigned
 * @param {string} userId - User ID to check
 * @returns {Object} { isResigned: boolean, resignedDate: Date|null }
 */
export const checkCaregiverResignationStatus = async (userId) => {
  try {
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      return { isResigned: false, resignedDate: null };
    }
    
    const userData = userSnap.data();
    return {
      isResigned: userData.user_activation === false,
      resignedDate: userData.user_resignedDate || null
    };
  } catch (error) {
    console.error("Error checking resignation status:", error);
    return { isResigned: false, resignedDate: null };
  }
};

/**
 * Process caregiver resignation - removes from schedule and redistributes elderly
 * @param {string} userId - ID of the resigned caregiver
 * @returns {Object} Result of the resignation process
 */
export const processCaregiverResignation = async (userId) => {
  try {
    console.log(`\n%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #FF6B6B; font-weight: bold');
    console.log(`%c👋 CAREGIVER RESIGNATION PROCESS STARTED`, 'color: #FF6B6B; font-weight: bold; font-size: 14px');
    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #FF6B6B; font-weight: bold');
    console.log(`%c👤 User ID: ${userId}`, 'color: #FFD93D; font-weight: bold');

    // 1. Get all current assignments for the resigned caregiver
    const assignmentsQuery = query(
      collection(db, "house_shift_assignments"),
      where("user_id", "==", userId),
      where("is_current", "==", true)
    );
    
    const assignmentsSnap = await getDocs(assignmentsQuery);
    const resignedAssignments = assignmentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    console.log(`%c📊 Found ${resignedAssignments.length} current assignments for resigned caregiver`, 'color: #95E1D3');

    if (resignedAssignments.length === 0) {
      console.log(`%cℹ️ No active assignments found. Caregiver may not be in current schedule.`, 'color: #FFD93D');
      return {
        success: true,
        message: "Caregiver marked as resigned. No active schedule assignments to process.",
        assignmentsRemoved: 0,
        elderlyRedistributed: 0
      };
    }

    // Group assignments by house to process each house separately
    const assignmentsByHouse = {};
    resignedAssignments.forEach(assignment => {
      const houseId = assignment.house_id;
      if (!assignmentsByHouse[houseId]) {
        assignmentsByHouse[houseId] = [];
      }
      assignmentsByHouse[houseId].push(assignment);
    });

    console.log(`%c🏠 Processing resignation across ${Object.keys(assignmentsByHouse).length} houses`, 'color: #4ECDC4');

    const batch = writeBatch(db);
    let totalElderlyRedistributed = 0;
    let totalAssignmentsRemoved = 0;

    // Process each house separately
    for (const [houseId, houseAssignments] of Object.entries(assignmentsByHouse)) {
      console.log(`\n%c🏠 Processing House: ${houseId}`, 'color: #4ECDC4; font-weight: bold');
      console.log(`   Assignments to remove: ${houseAssignments.length}`);

      // Get the version from the first assignment
      const version = houseAssignments[0].version;

      // 2. Get elderly assignments for this resigned caregiver in this house
      console.log(`   🔍 Querying elderly_assignments for resigned caregiver...`);
      console.log(`      user_id: ${userId}`);
      console.log(`      house_id: ${houseId}`);
      console.log(`      version: ${version}`);
      
      // Query without house_id and version filters first, then filter in memory
      // This is because elderly_assignments may not have all these fields indexed together
      const elderlyQuery = query(
        collection(db, "elderly_assignments"),
        where("user_id", "==", userId),
        where("user_type", "==", "caregiver")
      );
      
      const elderlySnap = await getDocs(elderlyQuery);
      console.log(`      📊 Total documents found for user: ${elderlySnap.docs.length}`);
      
      // Log all documents to see what we have
      elderlySnap.docs.forEach((docSnap, index) => {
        const data = docSnap.data();
        console.log(`      📄 Doc ${index + 1}: house=${data.house_id}, version=${data.assign_version}, current=${data.is_current}, day=${data.day}, shift=${data.shift}, elderly_count=${data.elderly_ids?.length || 0}`);
      });
      
      // Filter in memory for matching house and version
      console.log(`      🔍 Filtering documents...`);
      const resignedElderlyAssignments = elderlySnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((assignment, index) => {
          // house_id is stored as an array in the database
          let matchesHouse = false;
          if (Array.isArray(assignment.house_id)) {
            // Check if houseId exists in the array
            matchesHouse = assignment.house_id.includes(houseId);
          } else {
            // Fallback: direct comparison if it's not an array
            matchesHouse = assignment.house_id === houseId;
          }
          
          const matchesVersion = assignment.assign_version === version;
          const isCurrent = assignment.is_current === true;
          
          console.log(`      🔎 Doc ${index + 1} Filter Check:`);
          console.log(`         house_id: ${JSON.stringify(assignment.house_id)} (type: ${typeof assignment.house_id}, isArray: ${Array.isArray(assignment.house_id)})`);
          console.log(`         comparing to: "${houseId}" (type: ${typeof houseId})`);
          console.log(`         Array includes check: ${matchesHouse}`);
          console.log(`         assign_version: ${assignment.assign_version} === ${version} = ${matchesVersion}`);
          console.log(`         is_current: ${assignment.is_current} === true = ${isCurrent}`);
          console.log(`         RESULT: ${matchesHouse && matchesVersion && isCurrent ? '✅ MATCH' : '❌ NO MATCH'}`);
          
          return matchesHouse && matchesVersion && isCurrent;
        });
      
      console.log(`   👵 Found ${resignedElderlyAssignments.length} elderly assignments to redistribute`);
      
      if (resignedElderlyAssignments.length > 0) {
        resignedElderlyAssignments.forEach(assignment => {
          console.log(`      📋 ${assignment.day} ${assignment.shift}: ${assignment.elderly_ids?.length || 0} elderly`);
        });
      } else {
        console.log(`      ℹ️ No elderly assignments found for this house/version combination`);
        console.log(`      💡 Tip: Check if elderly_assignments have correct house_id and assign_version fields`);
      }

      // 3. Get remaining active caregivers for this house and version
      const remainingCaregivers = await getRemainingActiveCaregivers(houseId, version, userId);
      
      console.log(`   👨‍⚕️ Found ${remainingCaregivers.length} remaining active caregivers in house`);
      if (remainingCaregivers.length > 0) {
        console.log(`   📋 Remaining caregivers:`, remainingCaregivers.map(cg => 
          `${cg.user_fname} ${cg.user_lname} (${cg.assignments.length} assignments)`
        ).join(', '));
      }

      if (remainingCaregivers.length === 0) {
        console.log(`%c⚠️ WARNING: No remaining caregivers in ${houseId}! Elderly cannot be redistributed.`, 'color: #FF6B6B; font-weight: bold');
        continue;
      }

      // 4. Redistribute elderly for each day/shift combination
      for (const elderlyAssignment of resignedElderlyAssignments) {
        const { day, shift, elderly_ids } = elderlyAssignment;
        
        if (!elderly_ids || elderly_ids.length === 0) {
          console.log(`   ⏭️ Skipping empty elderly assignment for ${day} - ${shift}`);
          // Delete the empty assignment
          batch.delete(doc(db, "elderly_assignments", elderlyAssignment.id));
          continue;
        }

        console.log(`\n   📅 Processing ${day} - ${shift}: ${elderly_ids.length} elderly to redistribute`);

        // Get caregivers working on this specific day/shift
        const workingCaregivers = remainingCaregivers.filter(cg => {
          // Check ALL assignments for this caregiver to find one matching this day/shift
          return cg.assignments.some(assignment => 
            assignment.shift === shift && 
            assignment.days_assigned && 
            assignment.days_assigned.includes(day)
          );
        });

        console.log(`      Available caregivers on this day/shift: ${workingCaregivers.length}`);
        if (workingCaregivers.length > 0) {
          console.log(`      👥 Working caregivers:`, workingCaregivers.map(cg => 
            `${cg.user_fname} ${cg.user_lname}`
          ).join(', '));
        }

        if (workingCaregivers.length === 0) {
          console.log(`%c⚠️ WARNING: No caregivers available for ${day} - ${shift}! Elderly cannot be redistributed.`, 'color: #FF6B6B; font-weight: bold');
          continue;
        }

        // Get current elderly assignments for working caregivers on this day/shift
        const currentDistribution = await getCurrentElderlyDistribution(
          workingCaregivers.map(cg => cg.user_id),
          houseId,
          day,
          shift,
          version
        );

        // Redistribute the elderly among working caregivers
        const redistributions = redistributeElderlyAmongCaregivers(
          elderly_ids,
          workingCaregivers,
          currentDistribution,
          day,
          shift
        );

        // Apply the redistributions
        for (const redistribution of redistributions) {
          if (redistribution.existingAssignmentId) {
            // Update existing assignment
            batch.update(
              doc(db, "elderly_assignments", redistribution.existingAssignmentId),
              {
                elderly_ids: redistribution.elderly_ids,
                last_updated: Timestamp.now()
              }
            );
            console.log(`      ✅ Updated assignment for ${redistribution.user_id}: +${redistribution.addedCount} elderly`);
          } else {
            // Create new assignment
            const newAssignment = {
              user_id: redistribution.user_id,
              user_type: "caregiver",
              house_id: houseId,
              day: day,
              shift: shift,
              elderly_ids: redistribution.elderly_ids,
              assign_version: version,
              is_current: true,
              status: "active",
              created_at: Timestamp.now(),
              last_updated: Timestamp.now()
            };

            // Handle 3rd shift overnight logic
            if (shift === "3rd") {
              const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
              const dayIndex = daysOfWeek.indexOf(day);
              const nextDay = daysOfWeek[(dayIndex + 1) % 7];
              newAssignment.start_day = day;
              newAssignment.end_day = nextDay;
            }

            batch.set(doc(collection(db, "elderly_assignments")), newAssignment);
            console.log(`      ➕ Created new assignment for ${redistribution.user_id}: ${redistribution.elderly_ids.length} elderly`);
          }
          totalElderlyRedistributed += redistribution.addedCount;
        }

        // Delete the resigned caregiver's elderly assignment
        batch.delete(doc(db, "elderly_assignments", elderlyAssignment.id));
      }

      // 5. Delete all house_shift_assignments for resigned caregiver in this house
      for (const assignment of houseAssignments) {
        batch.delete(doc(db, "house_shift_assignments", assignment.id));
        totalAssignmentsRemoved++;
      }
    }

    // 6. Commit all changes
    await batch.commit();

    // 7. Log the resignation activity
    await addDoc(collection(db, "activity_logs"), {
      action: "Caregiver Resignation Processed",
      user_id: userId,
      houses_affected: Object.keys(assignmentsByHouse),
      assignments_removed: totalAssignmentsRemoved,
      elderly_redistributed: totalElderlyRedistributed,
      timestamp: Timestamp.now(),
      triggered_by: "resignation_system"
    });

    console.log(`\n%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #95E1D3; font-weight: bold');
    console.log(`%c✅ RESIGNATION PROCESS COMPLETE`, 'color: #95E1D3; font-weight: bold; font-size: 14px');
    console.log(`%c   Assignments removed: ${totalAssignmentsRemoved}`, 'color: #95E1D3; font-weight: bold');
    console.log(`%c   Elderly redistributed: ${totalElderlyRedistributed}`, 'color: #95E1D3; font-weight: bold');
    console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`, 'color: #95E1D3; font-weight: bold');

    return {
      success: true,
      message: `Successfully processed resignation. Removed ${totalAssignmentsRemoved} assignments and redistributed ${totalElderlyRedistributed} elderly assignments.`,
      assignmentsRemoved: totalAssignmentsRemoved,
      elderlyRedistributed: totalElderlyRedistributed,
      housesAffected: Object.keys(assignmentsByHouse)
    };

  } catch (error) {
    console.error("%c❌ Error processing resignation:", 'color: #FF6B6B; font-weight: bold', error);
    return {
      success: false,
      message: `Failed to process resignation: ${error.message}`,
      assignmentsRemoved: 0,
      elderlyRedistributed: 0
    };
  }
};

/**
 * Get remaining active caregivers for a house (excluding resigned caregiver)
 */
const getRemainingActiveCaregivers = async (houseId, version, excludeUserId) => {
  try {
    // Get all current assignments for this house and version
    const assignmentsQuery = query(
      collection(db, "house_shift_assignments"),
      where("house_id", "==", houseId),
      where("version", "==", version),
      where("is_current", "==", true)
    );
    
    const assignmentsSnap = await getDocs(assignmentsQuery);
    const assignments = assignmentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Filter out the resigned caregiver
    const remainingAssignments = assignments.filter(a => a.user_id !== excludeUserId);
    
    // Get unique caregiver IDs
    const caregiverIds = [...new Set(remainingAssignments.map(a => a.user_id))];
    
    // Fetch caregiver details to verify they're still active
    const caregivers = [];
    console.log(`   🔍 Checking ${caregiverIds.length} unique caregiver(s) for active status...`);
    
    for (const userId of caregiverIds) {
      try {
        const userDoc = await getDoc(doc(db, "users", userId));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          console.log(`      👤 ${userData.user_fname} ${userData.user_lname} - user_activation: ${userData.user_activation}`);
          
          // Only include if user_activation is true (not resigned)
          if (userData.user_activation !== false) {
            // Get ALL assignments for this caregiver (not just the first one)
            const userAssignments = remainingAssignments.filter(a => a.user_id === userId);
            console.log(`      ✅ Adding caregiver with ${userAssignments.length} assignment(s)`);
            caregivers.push({
              user_id: userId,
              ...userData,
              assignments: userAssignments // Store ALL assignments
            });
          } else {
            console.log(`      ❌ Skipping - already resigned`);
          }
        } else {
          console.log(`      ⚠️ User document not found for ID: ${userId}`);
        }
      } catch (error) {
        console.error(`      ❌ Error fetching user ${userId}:`, error);
      }
    }
    
    console.log(`   ✅ Total active caregivers found: ${caregivers.length}`);
    return caregivers;
  } catch (error) {
    console.error("Error getting remaining caregivers:", error);
    return [];
  }
};

/**
 * Get current elderly distribution for caregivers on a specific day/shift
 */
const getCurrentElderlyDistribution = async (caregiverIds, houseId, day, shift, version) => {
  try {
    const distribution = {};
    
    for (const userId of caregiverIds) {
      // Simpler query with fewer filters to avoid index issues
      const elderlyQuery = query(
        collection(db, "elderly_assignments"),
        where("user_id", "==", userId),
        where("user_type", "==", "caregiver")
      );
      
      const elderlySnap = await getDocs(elderlyQuery);
      
      // Filter in memory for the specific day/shift/version
      const matchingAssignments = elderlySnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(assignment => {
          // house_id is stored as an array in the database
          let matchesHouse = false;
          if (Array.isArray(assignment.house_id)) {
            matchesHouse = assignment.house_id.includes(houseId);
          } else {
            matchesHouse = assignment.house_id === houseId;
          }
          
          return matchesHouse &&
            assignment.day === day &&
            assignment.shift === shift &&
            assignment.assign_version === version &&
            assignment.is_current === true;
        });
      
      if (matchingAssignments.length > 0) {
        const assignment = matchingAssignments[0];
        distribution[userId] = {
          assignmentId: assignment.id,
          elderly_ids: assignment.elderly_ids || [],
          count: (assignment.elderly_ids || []).length
        };
      } else {
        distribution[userId] = {
          assignmentId: null,
          elderly_ids: [],
          count: 0
        };
      }
    }
    
    return distribution;
  } catch (error) {
    console.error("Error getting elderly distribution:", error);
    return {};
  }
};

/**
 * Redistribute elderly among caregivers evenly
 */
const redistributeElderlyAmongCaregivers = (elderlyIds, caregivers, currentDistribution, day, shift) => {
  const redistributions = [];
  
  // Calculate how many elderly each caregiver currently has
  const caregiverLoads = caregivers.map(cg => ({
    user_id: cg.user_id,
    currentLoad: currentDistribution[cg.user_id]?.count || 0,
    currentElderlyIds: currentDistribution[cg.user_id]?.elderly_ids || [],
    existingAssignmentId: currentDistribution[cg.user_id]?.assignmentId || null
  }));
  
  // Sort by current load (ascending) to prioritize caregivers with fewer elderly
  caregiverLoads.sort((a, b) => a.currentLoad - b.currentLoad);
  
  console.log(`      📊 Current distribution:`, caregiverLoads.map(cg => 
    `${cg.user_id.substring(0, 8)}: ${cg.currentLoad} elderly`
  ).join(', '));
  
  // Distribute elderly one by one to caregivers with least load
  let elderlyIndex = 0;
  while (elderlyIndex < elderlyIds.length) {
    // Find caregiver with minimum load
    const minLoad = Math.min(...caregiverLoads.map(cg => cg.currentLoad));
    const caregiversWithMinLoad = caregiverLoads.filter(cg => cg.currentLoad === minLoad);
    
    // Randomly select one if multiple have same load
    const selectedCaregiver = caregiversWithMinLoad[Math.floor(Math.random() * caregiversWithMinLoad.length)];
    
    // Add elderly to this caregiver
    selectedCaregiver.currentElderlyIds.push(elderlyIds[elderlyIndex]);
    selectedCaregiver.currentLoad++;
    
    elderlyIndex++;
  }
  
  // Create redistribution records for caregivers who got new elderly
  caregiverLoads.forEach(cg => {
    const originalCount = currentDistribution[cg.user_id]?.count || 0;
    const newCount = cg.currentElderlyIds.length;
    
    if (newCount > originalCount) {
      redistributions.push({
        user_id: cg.user_id,
        elderly_ids: cg.currentElderlyIds,
        addedCount: newCount - originalCount,
        existingAssignmentId: cg.existingAssignmentId
      });
    }
  });
  
  return redistributions;
};
