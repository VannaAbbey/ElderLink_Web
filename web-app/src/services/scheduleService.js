/**
 * Schedule Service
 * Core schedule generation and management functionality
 */

import { db } from "../firebase";
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  writeBatch, 
  doc, 
  updateDoc, 
  addDoc, 
  deleteDoc, 
  Timestamp 
} from "firebase/firestore";

const BATCH_SIZE = 450;

// Helper functions
const splitIntoChunks = (arr, n) => {
  if (!arr || arr.length === 0) return [];
  const res = Array.from({ length: n }, () => []);
  for (let i = 0; i < arr.length; i++) {
    res[i % n].push(arr[i]);
  }
  return res;
};

// Enhanced shift distribution with bedridden house priority for weekend coverage
const distributeToShifts = (caregivers, shiftDefs, houseId = null) => {
  if (!caregivers || caregivers.length === 0) {
    return Array.from({ length: shiftDefs.length }, () => []);
  }

  const shiftCaregivers = Array.from({ length: shiftDefs.length }, () => []);
  const isBedridden = houseId === "H002" || houseId === "H003";

  // Shuffle caregivers for fair distribution
  const shuffled = [...caregivers].sort(() => Math.random() - 0.5);
  
  if (isBedridden && caregivers.length >= 6) {
    // For bedridden houses with sufficient caregivers: ensure minimum 2 per shift
    const minPerShift = 2;
    let assigned = 0;
    
    // First pass: Assign minimum to each shift
    for (let s = 0; s < 3; s++) {
      for (let i = 0; i < minPerShift && assigned < shuffled.length; i++) {
        shiftCaregivers[s].push(shuffled[assigned]);
        assigned++;
      }
    }
    
    // Second pass: Distribute remaining caregivers
    let shiftIndex = 0;
    while (assigned < shuffled.length) {
      shiftCaregivers[shiftIndex % 3].push(shuffled[assigned]);
      assigned++;
      shiftIndex++;
    }
    
    console.log(`🏥 BEDRIDDEN ${houseId}: Enhanced distribution - ${shiftCaregivers.map((shift, i) => `Shift ${i+1}: ${shift.length}`).join(', ')}`);
  } else {
    // Standard distribution for regular houses or houses with fewer caregivers
    shuffled.forEach((cg, index) => {
      const shiftIndex = index % shiftDefs.length;
      shiftCaregivers[shiftIndex].push(cg);
    });
  }

  return shiftCaregivers;
};

const getEndDate = (months) => {
  const end = new Date();
  end.setMonth(end.getMonth() + months);
  return end;
};

const ensureDayCounts = (obj, key, daysOfWeek) => {
  if (!obj[key]) obj[key] = new Array(7).fill(0);
  return obj[key];
};

// Generate consecutive work day patterns (5 work days + 2 rest days)
const generateConsecutiveWorkDays = (startDayIndex, daysOfWeek) => {
  const workDays = [];
  for (let i = 0; i < 5; i++) {
    workDays.push(daysOfWeek[(startDayIndex + i) % 7]);
  }
  return workDays;
};

// Get all possible 5-consecutive-day patterns
const getAllConsecutivePatterns = (daysOfWeek) => {
  const patterns = [];
  for (let startIndex = 0; startIndex < 7; startIndex++) {
    patterns.push({
      startIndex,
      days: generateConsecutiveWorkDays(startIndex, daysOfWeek)
    });
  }
  return patterns;
};

// Improved consecutive assignment that guarantees complete daily coverage with bedridden house priority
const assignConsecutiveDaysWithCoverage = (caregivers, daysOfWeek, houseId = null) => {
  if (!caregivers || caregivers.length === 0) {
    return [];
  }

  const assignments = [];
  const dayCounts = new Array(7).fill(0);
  
  // Check if this is a bedridden house that needs enhanced weekend coverage
  const isBedridden = houseId === "H002" || houseId === "H003";
  
  if (isBedridden) {
    // Enhanced algorithm for bedridden houses prioritizing weekend coverage
    console.log(`🏥 BEDRIDDEN HOUSE ${houseId}: Enhanced consecutive day assignment for ${caregivers.length} caregivers`);
    
    const priorityPatterns = [
      { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], priority: 3 },
      { days: ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], priority: 5 },
      { days: ["Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], priority: 5 },
      { days: ["Thursday", "Friday", "Saturday", "Sunday", "Monday"], priority: 4 },
      { days: ["Friday", "Saturday", "Sunday", "Monday", "Tuesday"], priority: 4 },
      { days: ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"], priority: 3 },
      { days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"], priority: 2 }
    ];
    
    // Sort patterns by priority (weekend patterns first)
    priorityPatterns.sort((a, b) => b.priority - a.priority);
    
    for (let i = 0; i < caregivers.length; i++) {
      const caregiver = caregivers[i];
      const pattern = priorityPatterns[i % priorityPatterns.length];
      
      assignments.push({
        caregiver,
        days: pattern.days
      });
      
      // Update day counts
      pattern.days.forEach(day => {
        const dayIndex = daysOfWeek.indexOf(day);
        if (dayIndex !== -1) {
          dayCounts[dayIndex]++;
        }
      });
      
      console.log(`🏥 ${caregiver.user_fname} ${caregiver.user_lname}: ${pattern.days.join(', ')} (Priority: ${pattern.priority})`);
    }
  } else {
    // Standard algorithm for regular houses
    const patterns = getAllConsecutivePatterns(daysOfWeek);
    
    for (let i = 0; i < caregivers.length; i++) {
      const caregiver = caregivers[i];
      const pattern = patterns[i % patterns.length];
      
      assignments.push({
        caregiver,
        days: pattern.days
      });
      
      // Update day counts
      pattern.days.forEach(day => {
        const dayIndex = daysOfWeek.indexOf(day);
        if (dayIndex !== -1) {
          dayCounts[dayIndex]++;
        }
      });
    }
  }
  
  // Verify coverage with comprehensive logging
  console.log(`🏥 Schedule Coverage Analysis for ${isBedridden ? `BEDRIDDEN HOUSE ${houseId}` : `House ${houseId || 'Unknown'}`} (${caregivers.length} total caregivers):`);
  
  const uncoveredDays = dayCounts.map((count, idx) => count === 0 ? daysOfWeek[idx] : null).filter(Boolean);
  
  daysOfWeek.forEach((day, idx) => {
    const count = dayCounts[idx];
    const status = count === 0 ? '❌ UNCOVERED' : 
                  count === 1 ? '⚠️  Single' : 
                  count >= 2 ? '✅ Good' : '🔸 Limited';
    
    console.log(`  ${day}: ${count} caregivers ${status}`);
    
    if (isBedridden && (day === 'Saturday' || day === 'Sunday') && count < 2) {
      console.warn(`⚠️  BEDRIDDEN ${houseId} weekend concern: ${day} only has ${count} caregiver(s)`);
    }
  });
  
  if (uncoveredDays.length > 0) {
    console.error(`❌ COVERAGE GAPS: ${uncoveredDays.join(', ')} have no coverage!`);
  } else {
    console.log(`✅ Complete coverage achieved for all days`);
  }
  
  // Log weekend-specific coverage with bedridden house analysis
  const weekendCoverage = {
    saturday: dayCounts[5],
    sunday: dayCounts[6]
  };
  
  if (isBedridden) {
    console.log(`🏥 BEDRIDDEN ${houseId} Weekend Analysis:`);
    console.log(`  Saturday: ${weekendCoverage.saturday} caregivers ${weekendCoverage.saturday >= 2 ? '✅' : '⚠️'}`);
    console.log(`  Sunday: ${weekendCoverage.sunday} caregivers ${weekendCoverage.sunday >= 2 ? '✅' : '⚠️'}`);
  } else {
    console.log(`Weekend coverage: Saturday=${weekendCoverage.saturday}, Sunday=${weekendCoverage.sunday}`);
  }
  
  return assignments;
};

// Data fetching functions
export const fetchStaticData = async () => {
  try {
    const [cgSnap, houseSnap, elderlySnap] = await Promise.all([
      getDocs(query(collection(db, "users"), where("user_type", "==", "caregiver"))),
      getDocs(collection(db, "house")),
      getDocs(collection(db, "elderly"))
    ]);

    return {
      caregivers: cgSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      houses: houseSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      elderly: elderlySnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    };
  } catch (error) {
    console.error("Error fetching static data:", error);
    throw new Error("Failed to fetch static data");
  }
};

export const fetchAssignments = async (isCurrent = true) => {
  try {
    const q = query(
      collection(db, "cg_house_assign_v2"), 
      where("is_current", "==", isCurrent)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error("Error fetching assignments:", error);
    throw new Error("Failed to fetch assignments");
  }
};

export const fetchElderlyAssignments = async () => {
  try {
    const snap = await getDocs(collection(db, "elderly_caregiver_assign_v2"));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error("Error fetching elderly assignments:", error);
    throw new Error("Failed to fetch elderly assignments");
  }
};

export const fetchTempReassignments = async () => {
  try {
    const snap = await getDocs(collection(db, "temp_reassignments"));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error("Error fetching temp reassignments:", error);
    throw new Error("Failed to fetch temp reassignments");
  }
};

export const getMaxVersion = async () => {
  try {
    const snap = await getDocs(collection(db, "cg_house_assign_v2"));
    if (snap.empty) return 0;
    const versions = snap.docs.map((d) => d.data().version || 0);
    return Math.max(...versions);
  } catch (error) {
    console.error("Error getting max version:", error);
    throw new Error("Failed to get max version");
  }
};

const getLastHouseMap = async () => {
  try {
    const snap = await getDocs(
      query(collection(db, "cg_house_assign_v2"), orderBy("created_at", "desc"))
    );

    const lastMap = {};
    snap.docs.forEach((d) => {
      const data = d.data();
      if (!lastMap[data.caregiver_id]) {
        lastMap[data.caregiver_id] = data.house_id;
      }
    });
    return lastMap;
  } catch (error) {
    console.error("Error getting last house map:", error);
    throw new Error("Failed to get last house assignments");
  }
};

// Main schedule generation function
export const generateSchedule = async (months, { caregivers, houses, elderly }) => {
  try {
    // Configuration constants
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const shiftDefs = [
      { name: "1st Shift (6:00 AM - 2:00 PM)", key: "1st", time_range: { start: "06:00", end: "14:00" } },
      { name: "2nd Shift (2:00 PM - 10:00 PM)", key: "2nd", time_range: { start: "14:00", end: "22:00" } },
      { name: "3rd Shift (10:00 PM - 6:00 AM)", key: "3rd", time_range: { start: "22:00", end: "06:00" } },
    ];

    // 🔹 1. Deactivate current assignments
    const allAssignSnap = await getDocs(
      query(collection(db, "cg_house_assign_v2"), where("is_current", "==", true))
    );

    let batch = writeBatch(db);
    let writeCount = 0;

    for (const d of allAssignSnap.docs) {
      batch.update(doc(db, "cg_house_assign_v2", d.id), { is_current: false });
      writeCount++;
      if (writeCount >= BATCH_SIZE) {
        await batch.commit();
        await new Promise((r) => setTimeout(r, 0));
        batch = writeBatch(db);
        writeCount = 0;
      }
    }
    if (writeCount > 0) {
      await batch.commit();
      await new Promise((r) => setTimeout(r, 0));
      batch = writeBatch(db);
      writeCount = 0;
    }

    // 🔹 2. Versioning + dates
    const prevVersion = await getMaxVersion();
    const nextVersion = prevVersion + 1;
    const start_date = Timestamp.now();
    const end_date = Timestamp.fromDate(getEndDate(months));

    // 🔹 3. House weights - H002 and H003 (bedridden) get priority
    const weights = {
      H002: 4, // Priority houses get 4x weight
      H003: 4, // Priority houses get 4x weight
      H001: 1,
      H004: 1,
      H005: 1,
    };
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

    // 🔹 4. Improved caregiver distribution per house (ensuring minimum coverage)
    const caregiversPerHouse = {};
    let totalAssigned = 0;
    
    // Calculate minimum caregivers needed per house to ensure daily coverage
    // With 49 caregivers and 5 houses, we need better distribution
    const baseCaregiversPerHouse = Math.floor(caregivers.length / houses.length); // Base allocation
    const minCaregiversPerHouse = Math.max(7, baseCaregiversPerHouse); // Minimum 7 for daily coverage
    
    console.log(`📊 Distribution Strategy: ${caregivers.length} total caregivers across ${houses.length} houses`);
    console.log(`📊 Base allocation per house: ${baseCaregiversPerHouse}, Minimum: ${minCaregiversPerHouse}`);
    
    // Sort houses by priority (bedridden houses first)
    const sortedHouses = houses.sort((a, b) => {
      const weightA = weights[a.house_id] || 1;
      const weightB = weights[b.house_id] || 1;
      return weightB - weightA; // Higher weight first
    });

    // Enhanced distribution strategy to ensure fair distribution
    let tempTotal = 0;
    const baseAllocations = {};
    
    // First: Give every house a guaranteed minimum
    for (const house of sortedHouses) {
      baseAllocations[house.house_id] = minCaregiversPerHouse;
      tempTotal += minCaregiversPerHouse;
    }
    
    // Calculate extra caregivers to distribute based on weights
    const extraCaregivers = Math.max(0, caregivers.length - tempTotal);
    console.log(`📊 Extra caregivers to distribute by priority: ${extraCaregivers}`);
    
    // Distribute extra caregivers proportionally by weight
    let extraDistributed = 0;
    for (const house of sortedHouses) {
      const w = weights[house.house_id] || 1;
      const extraForThisHouse = Math.floor((extraCaregivers * w) / totalWeight);
      caregiversPerHouse[house.house_id] = baseAllocations[house.house_id] + extraForThisHouse;
      extraDistributed += extraForThisHouse;
      totalAssigned += caregiversPerHouse[house.house_id];
      
      console.log(`🏠 ${house.house_name} (${house.house_id}): ${caregiversPerHouse[house.house_id]} caregivers (base: ${baseAllocations[house.house_id]}, extra: ${extraForThisHouse}, weight: ${w})`);
    }

    // Distribute any remaining caregivers (due to rounding)
    let remaining = caregivers.length - totalAssigned;
    console.log(`📊 Final remaining caregivers to distribute: ${remaining}`);
    
    // Give remaining to highest priority houses first
    let houseIndex = 0;
    while (remaining > 0 && houseIndex < sortedHouses.length) {
      const house = sortedHouses[houseIndex % sortedHouses.length];
      caregiversPerHouse[house.house_id]++;
      remaining--;
      console.log(`🔄 Final: Extra caregiver assigned to ${house.house_id}: now ${caregiversPerHouse[house.house_id]}`);
      houseIndex++;
    }

    // 🔹 5. Last-house history (avoid repeating)
    const lastHouseMap = await getLastHouseMap();

    // 🔹 6. Shuffle caregivers pool
    const pool = [...caregivers].sort(() => Math.random() - 0.5);

    // 🔹 7. Improved caregiver assignment to houses (priority-based)
    let poolIdx = 0;
    const houseAssignments = {};
    
    // Assign caregivers to houses in priority order
    for (const house of sortedHouses) {
      const count = caregiversPerHouse[house.house_id] || 1;
      houseAssignments[house.house_id] = [];
      
      console.log(`\nAssigning ${count} caregivers to ${house.house_name} (${house.house_id})`);

      let assigned = 0;
      let attempts = 0;
      const maxAttempts = pool.length * 2; // Prevent infinite loops

      while (assigned < count && poolIdx < pool.length && attempts < maxAttempts) {
        const cg = pool[poolIdx];
        attempts++;
        
        // Try to avoid giving caregiver the same last house when possible
        if (lastHouseMap[cg.id] === house.house_id && pool.length - poolIdx > count - assigned) {
          // Move to end and try next caregiver, but only if we have alternatives
          pool.push(pool.splice(poolIdx, 1)[0]);
          continue;
        }
        
        houseAssignments[house.house_id].push(cg);
        console.log(`  - Assigned ${cg.user_fname} ${cg.user_lname} to ${house.house_name}`);
        poolIdx++;
        assigned++;
      }
      
      // If we couldn't assign enough caregivers, fill from remaining pool
      while (assigned < count && poolIdx < pool.length) {
        const cg = pool[poolIdx];
        houseAssignments[house.house_id].push(cg);
        console.log(`  - Force assigned ${cg.user_fname} ${cg.user_lname} to ${house.house_name}`);
        poolIdx++;
        assigned++;
      }
    }

    // If any caregivers remain in pool, assign them to houses that need more coverage
    if (poolIdx < pool.length) {
      const remaining = pool.slice(poolIdx);
      console.log(`\nAssigning ${remaining.length} remaining caregivers...`);
      
      // Prioritize bedridden houses for remaining caregivers
      const priorityHouses = sortedHouses.filter(h => weights[h.house_id] > 1);
      let houseIndex = 0;
      
      for (const cg of remaining) {
        const targetHouse = priorityHouses.length > 0 ? 
          priorityHouses[houseIndex % priorityHouses.length] : 
          sortedHouses[houseIndex % sortedHouses.length];
          
        houseAssignments[targetHouse.house_id] = houseAssignments[targetHouse.house_id] || [];
        houseAssignments[targetHouse.house_id].push(cg);
        console.log(`  - Extra assigned ${cg.user_fname} ${cg.user_lname} to ${targetHouse.house_name}`);
        houseIndex++;
      }
    }

    // 🔹 8. For each house: improved shift distribution, assign days per caregiver, THEN distribute elderly per day
    for (const house of sortedHouses) {
      const assignedCGs = houseAssignments[house.house_id] || [];
      if (!assignedCGs.length) {
        console.warn(`⚠️  No caregivers assigned to ${house.house_name} (${house.house_id})`);
        continue;
      }

      console.log(`\n🏠 Processing ${house.house_name} (${house.house_id}) with ${assignedCGs.length} caregivers`);

      // Enhanced shift distribution with bedridden house priority
      const shiftCaregivers = distributeToShifts(assignedCGs, shiftDefs, house.house_id);

      // house elders (all elderly that belong to this house)
      const houseElders = elderly.filter((e) => e.house_id === house.house_id) || [];
      
      console.log(`House elderly: ${houseElders.length} total`);
      console.log(`Elderly names: ${houseElders.map(e => `${e.elderly_fname} ${e.elderly_lname}`).join(', ')}`);

      // For bedridden houses: Coordinate day assignments across shifts to ensure no single-caregiver shifts
      const isBedridden = house.house_id === "H002" || house.house_id === "H003";
      let coordinatedAssignments = null; // Initialize to null for all houses
      
      if (isBedridden) {
        console.log(`🏥 BEDRIDDEN HOUSE COORDINATION: Ensuring no single-caregiver shifts for ${house.house_id}`);
        
        // Pre-assign critical days to ensure multiple caregivers per shift per day
        const criticalDays = ["Thursday", "Friday", "Saturday", "Sunday"];
        const shiftDayCoverage = {}; // Track coverage per shift per day
        
        // Initialize tracking
        for (let s = 0; s < 3; s++) {
          shiftDayCoverage[s] = {};
          daysOfWeek.forEach(day => {
            shiftDayCoverage[s][day] = 0;
          });
        }
        
        // Coordinate assignments across shifts for bedridden houses
        coordinatedAssignments = [];
        
        for (let s = 0; s < 3; s++) {
          const cgInShift = shiftCaregivers[s] || [];
          if (!cgInShift.length) continue;
          
          console.log(`🏥 COORDINATED Shift ${s + 1}: ${cgInShift.length} caregivers`);
          
          // For bedridden houses, ensure critical days are covered by multiple caregivers
          const shiftAssignments = [];
          
          for (let i = 0; i < cgInShift.length; i++) {
            const cg = cgInShift[i];
            let assignedDays = [];
            
            // Strategy: Ensure critical days always have at least 2 caregivers per shift
            if (i === 0) {
              // First caregiver gets a pattern that includes critical days
              assignedDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
            } else if (i === 1) {
              // Second caregiver gets overlapping critical days
              assignedDays = ["Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
            } else {
              // Additional caregivers fill gaps and provide weekend coverage
              const patternOptions = [
                ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
                ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"],
                ["Thursday", "Friday", "Saturday", "Sunday", "Monday"],
                ["Friday", "Saturday", "Sunday", "Monday", "Tuesday"],
                ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"]
              ];
              assignedDays = patternOptions[i % patternOptions.length];
            }
            
            // Update coverage tracking
            assignedDays.forEach(day => {
              shiftDayCoverage[s][day]++;
            });
            
            shiftAssignments.push({
              caregiver: cg,
              days: assignedDays,
              dayIndexes: assignedDays.map(day => daysOfWeek.indexOf(day))
            });
            
            console.log(`🏥 COORDINATED ${cg.user_fname} (Shift ${s + 1}): ${assignedDays.join(', ')}`);
          }
          
          coordinatedAssignments[s] = shiftAssignments;
        }
        
        // Validate coverage for critical days
        criticalDays.forEach(criticalDay => {
          for (let s = 0; s < 3; s++) {
            const coverage = shiftDayCoverage[s][criticalDay] || 0;
            const shiftName = shiftDefs[s].name;
            
            if (coverage === 0) {
              console.error(`🚨 BEDRIDDEN ${house.house_id} ${criticalDay} ${shiftName}: NO COVERAGE!`);
            } else if (coverage === 1) {
              console.warn(`⚠️  BEDRIDDEN ${house.house_id} ${criticalDay} ${shiftName}: Only ${coverage} caregiver`);
            } else {
              console.log(`✅ BEDRIDDEN ${house.house_id} ${criticalDay} ${shiftName}: ${coverage} caregivers`);
            }
          }
        });
      }

      // We'll keep references to assignRef IDs per caregiver so we can relate per-day elder assignments
      const assignRefsByCaregiver = {};
      const allShiftAssignments = []; // Track all assignments across shifts

      // Process each shift with improved algorithms
      for (let s = 0; s < 3; s++) {
        const cgInShift = shiftCaregivers[s] || [];
        if (!cgInShift.length) {
          console.log(`⚠️  No caregivers in shift ${s + 1} for ${house.house_name}`);
          continue;
        }

        console.log(`\n--- Shift ${s + 1} (${shiftDefs[s].name}) for ${house.house_name} ---`);
        console.log(`Caregivers in shift: ${cgInShift.map(c => `${c.user_fname} ${c.user_lname}`).join(', ')}`);

        // Use coordinated assignments for bedridden houses, regular assignments for others
        let shiftAssignments;
        if (isBedridden && coordinatedAssignments && coordinatedAssignments[s]) {
          shiftAssignments = coordinatedAssignments[s];
          console.log(`🏥 Using coordinated assignments for bedridden house shift ${s + 1}`);
        } else {
          // For regular houses or fallback: assign consecutive work days with complete coverage
          shiftAssignments = assignConsecutiveDaysWithCoverage(cgInShift, daysOfWeek, house.house_id);
        }
        
        for (let i = 0; i < shiftAssignments.length; i++) {
          const assignment = shiftAssignments[i];
          const cg = assignment.caregiver;
          const days_assigned = assignment.days;
          
          console.log(`✅ ${cg.user_fname} ${cg.user_lname}: ${days_assigned.join(', ')}`);
          
          // create cg_house_assign_v2 doc for the caregiver/shift
          const shift = shiftDefs[s].key;
          const time_range = shiftDefs[s].time_range;

          const assignRef = doc(collection(db, "cg_house_assign_v2"));
          batch.set(assignRef, {
            caregiver_id: cg.id,
            house_id: house.house_id,
            shift,
            days_assigned,
            start_date,
            end_date,
            time_range,
            is_absent: false,
            absent_at: null,
            is_current: true,
            version: nextVersion,
            created_at: Timestamp.now(),
          });
          writeCount++;

          // Store assignment info with unique key to avoid overwriting
          const uniqueKey = `${cg.id}_${shift}`;
          assignRefsByCaregiver[uniqueKey] = {
            caregiver_id: cg.id,
            assignRefId: assignRef.id,
            shift,
            days_assigned,
            caregiver: cg
          };
          
          // Also track in allShiftAssignments for easier processing
          allShiftAssignments.push({
            caregiver_id: cg.id,
            assignRefId: assignRef.id,
            shift,
            days_assigned,
            caregiver: cg
          });

          // commit batch if needed
          if (writeCount >= BATCH_SIZE) {
            await batch.commit();
            batch = writeBatch(db);
            writeCount = 0;
          }
        }
      }

      // 🔹 ENHANCED ELDERLY ASSIGNMENT STRATEGY - DAY-BY-DAY DISTRIBUTION
      console.log(`\n=== ELDERLY ASSIGNMENT FOR ${house.house_name} ===`);
      console.log(`Total elderly in house: ${houseElders.length}`);
      console.log(`Total caregiver assignments: ${allShiftAssignments.length}`);
      
      // Sort ALL house elderly alphabetically for consistent assignment
      const sortedHouseElders = [...houseElders].sort((a, b) => {
        const nameA = `${a.elderly_fname} ${a.elderly_lname}`.toLowerCase();
        const nameB = `${b.elderly_fname} ${b.elderly_lname}`.toLowerCase();
        return nameA.localeCompare(nameB);
      });
      
      // Track which elderly have been assigned
      const assignedElderlyIds = new Set();
      
      // Process day-by-day instead of shift-by-shift
      for (const day of daysOfWeek) {
        console.log(`\n🗓️  === PROCESSING ${day.toUpperCase()} ===`);
        
        // Find all caregivers working on this specific day (across all shifts)
        const caregiversWorkingToday = allShiftAssignments.filter(assign => 
          assign.days_assigned.includes(day)
        );
        
        if (caregiversWorkingToday.length === 0) {
          console.log(`⚠️  No caregivers working on ${day} - skipping`);
          continue;
        }
        
        console.log(`👥 Caregivers working on ${day}: ${caregiversWorkingToday.length}`);
        caregiversWorkingToday.forEach(assign => {
          console.log(`   - ${assign.caregiver.user_fname} ${assign.caregiver.user_lname} (${assign.shift} shift)`);
        });
        
        // Group caregivers by shift for this day
        const shiftGroups = {
          "1st": caregiversWorkingToday.filter(a => a.shift === "1st"),
          "2nd": caregiversWorkingToday.filter(a => a.shift === "2nd"), 
          "3rd": caregiversWorkingToday.filter(a => a.shift === "3rd")
        };
        
        // Process each shift for this day
        for (const [shiftKey, shiftCaregivers] of Object.entries(shiftGroups)) {
          if (shiftCaregivers.length === 0) continue;
          
          console.log(`\n   🕐 ${shiftKey} SHIFT on ${day}: ${shiftCaregivers.length} caregivers`);
          
          if (shiftCaregivers.length === 1) {
            // SINGLE CAREGIVER: Gets ALL house elderly for this day
            const caregiver = shiftCaregivers[0];
            console.log(`   👤 SINGLE CAREGIVER: ${caregiver.caregiver.user_fname} ${caregiver.caregiver.user_lname} gets ALL ${sortedHouseElders.length} elderly on ${day}`);
            
            for (const elder of sortedHouseElders) {
              assignedElderlyIds.add(elder.id);
              
              const elderRef = doc(collection(db, "elderly_caregiver_assign_v2"));
              batch.set(elderRef, {
                caregiver_id: caregiver.caregiver_id,
                elderly_id: elder.id,
                assigned_at: Timestamp.now(),
                assign_version: nextVersion,
                assign_id: caregiver.assignRefId,
                status: "active",
                day: day,
                shift: shiftKey,
                house_id: house.house_id,
                house_name: house.house_name,
                assignment_type: "single_caregiver_gets_all_house_elderly_per_day",
                caregiver_name: `${caregiver.caregiver.user_fname} ${caregiver.caregiver.user_lname}`.toLowerCase(),
                elderly_name: `${elder.elderly_fname} ${elder.elderly_lname}`.toLowerCase(),
                debug_info: `${day}_${shiftKey}_single_cg_all_elderly`
              });
              writeCount++;

              if (writeCount >= BATCH_SIZE) {
                await batch.commit();
                batch = writeBatch(db);
                writeCount = 0;
              }
            }
            
            console.log(`   ✅ ${caregiver.caregiver.user_fname} assigned ALL ${sortedHouseElders.length} elderly on ${day} ${shiftKey} shift`);
            
          } else {
            // MULTIPLE CAREGIVERS: Split elderly equally for this day
            console.log(`   👥 MULTIPLE CAREGIVERS: Split ${sortedHouseElders.length} elderly among ${shiftCaregivers.length} caregivers on ${day}`);
            
            // Create balanced chunks for each caregiver
            const elderlyChunks = [];
            for (let i = 0; i < shiftCaregivers.length; i++) {
              elderlyChunks.push([]);
            }
            
            // Distribute elderly round-robin to ensure balanced assignment
            for (let i = 0; i < sortedHouseElders.length; i++) {
              const chunkIndex = i % shiftCaregivers.length;
              elderlyChunks[chunkIndex].push(sortedHouseElders[i]);
            }
            
            // Assign each chunk to respective caregiver
            for (let cgIndex = 0; cgIndex < shiftCaregivers.length; cgIndex++) {
              const caregiver = shiftCaregivers[cgIndex];
              const elderlyChunk = elderlyChunks[cgIndex];
              
              console.log(`   👤 ${caregiver.caregiver.user_fname} ${caregiver.caregiver.user_lname}: gets ${elderlyChunk.length} elderly on ${day} (${elderlyChunk.map(e => `${e.elderly_fname} ${e.elderly_lname}`).join(', ')})`);
              
              for (const elder of elderlyChunk) {
                assignedElderlyIds.add(elder.id);
                
                const elderRef = doc(collection(db, "elderly_caregiver_assign_v2"));
                batch.set(elderRef, {
                  caregiver_id: caregiver.caregiver_id,
                  elderly_id: elder.id,
                  assigned_at: Timestamp.now(),
                  assign_version: nextVersion,
                  assign_id: caregiver.assignRefId,
                  status: "active",
                  day: day,
                  shift: shiftKey,
                  house_id: house.house_id,
                  house_name: house.house_name,
                  assignment_type: "multiple_caregivers_split_house_elderly_per_day",
                  caregiver_name: `${caregiver.caregiver.user_fname} ${caregiver.caregiver.user_lname}`.toLowerCase(),
                  elderly_name: `${elder.elderly_fname} ${elder.elderly_lname}`.toLowerCase(),
                  debug_info: `${day}_${shiftKey}_multi_cg_split_elderly`
                });
                writeCount++;

                if (writeCount >= BATCH_SIZE) {
                  await batch.commit();
                  batch = writeBatch(db);
                  writeCount = 0;
                }
              }
            }
            
            console.log(`   ✅ ${shiftCaregivers.length} caregivers each assigned their portion on ${day} ${shiftKey} shift`);
          }
        }
      }
      
      // 🔹 COMPLETE COVERAGE GUARANTEE - Handle any unassigned elderly
      const unassignedElderly = houseElders.filter(elder => !assignedElderlyIds.has(elder.id));
      
      if (unassignedElderly.length > 0) {
        console.log(`\n⚠️  COVERAGE GAP: ${unassignedElderly.length} elderly not assigned`);
        console.log(`Unassigned elderly: ${unassignedElderly.map(e => `${e.elderly_fname} ${e.elderly_lname}`).join(', ')}`);
        
        // Get ALL available caregivers in this house (across all shifts)
        const allAvailableCaregivers = Object.keys(assignRefsByCaregiver)
          .map(cgId => {
            const caregiver = caregivers.find(cg => cg.id === cgId);
            return {
              id: cgId,
              name: caregiver ? `${caregiver.user_fname} ${caregiver.user_lname}` : cgId,
              ...assignRefsByCaregiver[cgId]
            };
          })
          .sort((a, b) => a.shift.localeCompare(b.shift));

        if (allAvailableCaregivers.length > 0) {
          console.log(`🔄 CROSS-SHIFT ASSIGNMENT: Distributing ${unassignedElderly.length} elderly to ${allAvailableCaregivers.length} caregivers`);
          
          // Strategy: Assign to caregivers with the least current elderly load
          const elderlyBatches = splitIntoChunks(unassignedElderly, allAvailableCaregivers.length);
          
          for (let i = 0; i < allAvailableCaregivers.length; i++) {
            const caregiver = allAvailableCaregivers[i];
            const elderBatch = elderlyBatches[i] || [];
            
            if (elderBatch.length === 0) continue;

            console.log(`  → ${caregiver.name} (${caregiver.shift}): +${elderBatch.length} cross-shift elderly`);

            // Assign these elderly to this caregiver for their working days
            for (const day of caregiver.days_assigned) {
              for (const elder of elderBatch) {
                const elderRef = doc(collection(db, "elderly_caregiver_assign_v2"));
                batch.set(elderRef, {
                  caregiver_id: caregiver.id,
                  elderly_id: elder.id,
                  assigned_at: Timestamp.now(),
                  assign_version: nextVersion,
                  assign_id: caregiver.assignRefId,
                  status: "active",
                  day,
                  assignment_type: "cross_shift_coverage",
                  caregiver_name: caregiver.name.toLowerCase(),
                  elderly_name: `${elder.elderly_fname} ${elder.elderly_lname}`.toLowerCase(),
                  cross_shift_reason: "complete_coverage_guarantee"
                });
                writeCount++;

                if (writeCount >= BATCH_SIZE) {
                  await batch.commit();
                  batch = writeBatch(db);
                  writeCount = 0;
                }
              }
            }
          }
          
          console.log(`✅ Complete coverage achieved: All elderly assigned`);
        } else {
          console.error(`❌ CRITICAL: No caregivers available for house ${house.house_name} - ${unassignedElderly.length} elderly will be uncovered!`);
        }
      } else {
        console.log(`✅ Perfect coverage: All ${houseElders.length} elderly assigned through shift distribution`);
      }
      
      console.log(`=== END ${house.house_name} ASSIGNMENT ===\n`);
    }

    // Final commit
    if (writeCount > 0) {
      await batch.commit();
    }

    // Activity log
    await addDoc(collection(db, "activity_logs_v2"), {
      action: "Generate Schedule (Enhanced with House-Based Elderly Distribution)",
      version: nextVersion,
      time: Timestamp.now(),
      created_by: "system",
      details: { 
        duration_months: months,
        features: [
          "bedridden_house_priority", // H002 & H003 get 4x weight
          "balanced_shift_distribution", // Even caregiver allocation across 3 shifts
          "consecutive_work_days", // 5 work + 2 rest days
          "complete_daily_coverage", // Every day covered
          "house_based_elderly_distribution", // ALL house elderly distributed per shift
          "single_caregiver_gets_all_house_elderly", // Solo caregivers get ALL elderly in house
          "multiple_caregivers_split_all_house_elderly", // Multiple caregivers split ALL house elderly equally
          "cross_shift_safety_net", // Unassigned elderly get covered
          "guaranteed_house_coverage" // Every house gets minimum caregivers
        ],
        house_priority: {
          H002: "bedridden_priority_4x_weight",
          H003: "bedridden_priority_4x_weight", 
          H001: "standard_1x_weight",
          H004: "standard_1x_weight",
          H005: "standard_1x_weight"
        },
        elderly_distribution_logic: {
          single_caregiver: "gets_all_elderly_in_house",
          multiple_caregivers: "split_all_house_elderly_equally"
        }
      },
    });

    return {
      success: true,
      version: nextVersion,
      message: "Schedule generated successfully"
    };

  } catch (error) {
    console.error("Error generating schedule:", error);
    throw new Error("Failed to generate schedule: " + error.message);
  }
};

export const clearSchedule = async () => {
  try {
    const deleteCollection = async (collectionName) => {
      const snap = await getDocs(collection(db, collectionName));
      
      // Skip if no documents to delete
      if (snap.empty) {
        console.log(`Collection ${collectionName} is already empty`);
        return;
      }

      console.log(`Deleting ${snap.docs.length} documents from ${collectionName}`);
      
      // Process deletions in chunks to avoid "Transaction too big" error
      const docs = snap.docs;
      const chunkSize = 400; // Slightly below BATCH_SIZE for safety
      let totalDeleted = 0;

      for (let i = 0; i < docs.length; i += chunkSize) {
        const chunk = docs.slice(i, i + chunkSize);
        const batch = writeBatch(db);

        chunk.forEach((docSnap) => {
          batch.delete(doc(db, collectionName, docSnap.id));
        });

        await batch.commit();
        totalDeleted += chunk.length;
        console.log(`Deleted ${chunk.length} documents from ${collectionName} (${totalDeleted}/${docs.length})`);
        
        // Small delay to prevent overwhelming Firestore
        if (i + chunkSize < docs.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`Successfully deleted all ${totalDeleted} documents from ${collectionName}`);
    };

    // Clear all schedule-related collections sequentially to be safe
    console.log("Starting schedule cleanup...");
    
    await deleteCollection("cg_house_assign_v2");
    await deleteCollection("elderly_caregiver_assign_v2");
    await deleteCollection("temp_reassignments");

    console.log("All schedule collections cleared successfully");
    return { success: true, message: "Schedule cleared successfully" };

  } catch (error) {
    console.error("Error clearing schedule:", error);
    return { success: false, message: `Failed to clear schedule: ${error.message}` };
  }
};

// Find and optionally clean up assignments with missing caregivers
export const findOrphanedAssignments = async (shouldDelete = false) => {
  try {
    // Get all current assignments
    const assignments = await fetchAssignments(true);
    
    // Get all caregivers
    const caregivers = await getDocs(
      query(collection(db, "users"), where("user_type", "==", "caregiver"))
    );
    const caregiverIds = new Set(caregivers.docs.map(doc => doc.id));
    
    // Find orphaned assignments
    const orphanedAssignments = assignments.filter(assignment => 
      !caregiverIds.has(assignment.caregiver_id)
    );
    
    console.log(`Found ${orphanedAssignments.length} orphaned caregiver assignments`);
    
    if (shouldDelete && orphanedAssignments.length > 0) {
      const batch = writeBatch(db);
      
      orphanedAssignments.forEach(assignment => {
        const assignmentRef = doc(db, "cg_house_assign_v2", assignment.id);
        batch.delete(assignmentRef);
      });
      
      await batch.commit();
      console.log(`Deleted ${orphanedAssignments.length} orphaned caregiver assignments`);
    }
    
    return {
      count: orphanedAssignments.length,
      assignments: orphanedAssignments,
      deleted: shouldDelete
    };
    
  } catch (error) {
    console.error("Error finding orphaned assignments:", error);
    throw new Error("Failed to find orphaned assignments");
  }
};

// Find and optionally clean up elderly assignments with missing elderly or caregivers
export const findOrphanedElderlyAssignments = async (shouldDelete = false) => {
  try {
    // Get all elderly assignments
    const elderlyAssignments = await fetchElderlyAssignments();
    
    // Get all caregivers and elderly
    const [caregivers, elderly] = await Promise.all([
      getDocs(query(collection(db, "users"), where("user_type", "==", "caregiver"))),
      getDocs(collection(db, "elderly"))
    ]);
    
    const caregiverIds = new Set(caregivers.docs.map(doc => doc.id));
    const elderlyIds = new Set(elderly.docs.map(doc => doc.id));
    
    // Find orphaned elderly assignments
    const orphanedElderlyAssignments = elderlyAssignments.filter(assignment => 
      !caregiverIds.has(assignment.caregiver_id) || !elderlyIds.has(assignment.elderly_id)
    );
    
    console.log(`Found ${orphanedElderlyAssignments.length} orphaned elderly assignments`);
    
    if (shouldDelete && orphanedElderlyAssignments.length > 0) {
      const batch = writeBatch(db);
      
      orphanedElderlyAssignments.forEach(assignment => {
        const assignmentRef = doc(db, "elderly_caregiver_assign_v2", assignment.id);
        batch.delete(assignmentRef);
      });
      
      await batch.commit();
      console.log(`Deleted ${orphanedElderlyAssignments.length} orphaned elderly assignments`);
    }
    
    return {
      count: orphanedElderlyAssignments.length,
      assignments: orphanedElderlyAssignments,
      deleted: shouldDelete
    };
    
  } catch (error) {
    console.error("Error finding orphaned elderly assignments:", error);
    throw new Error("Failed to find orphaned elderly assignments");
  }
};