/**
 * Schedule API Service
 * This service handles all schedule-related business logic
 * Ready to be moved to a backend API
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
  if (!arr || arr.length === 0) return Array.from({ length: n }, () => []);
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
    console.log(`🏥 BEDRIDDEN HOUSE SHIFT DISTRIBUTION: Enhanced coverage for ${houseId} with ${caregivers.length} caregivers`);
    
    const minPerShift = 2; // Minimum 2 caregivers per shift for bedridden houses
    const guaranteedTotal = minPerShift * shiftDefs.length; // 6 caregivers minimum
    
    let index = 0;
    
    // First pass: Guarantee minimum coverage per shift
    for (let s = 0; s < shiftDefs.length; s++) {
      for (let i = 0; i < minPerShift && index < shuffled.length; i++) {
        shiftCaregivers[s].push(shuffled[index]);
        index++;
      }
      console.log(`🏥 Shift ${s + 1} guaranteed: ${shiftCaregivers[s].length} caregivers`);
    }
    
    // Second pass: Distribute remaining caregivers proportionally
    const remaining = shuffled.slice(index);
    const baseAdditional = Math.floor(remaining.length / shiftDefs.length);
    const remainderExtra = remaining.length % shiftDefs.length;
    
    let remainingIndex = 0;
    for (let s = 0; s < shiftDefs.length; s++) {
      const additionalForShift = baseAdditional + (s < remainderExtra ? 1 : 0);
      
      for (let i = 0; i < additionalForShift && remainingIndex < remaining.length; i++) {
        shiftCaregivers[s].push(remaining[remainingIndex]);
        remainingIndex++;
      }
      
      console.log(`🏥 Shift ${s + 1} (${shiftDefs[s].name}) FINAL: ${shiftCaregivers[s].length} caregivers (minimum ${minPerShift} guaranteed)`);
    }
    
    // Verify minimum coverage achieved
    for (let s = 0; s < shiftDefs.length; s++) {
      if (shiftCaregivers[s].length < minPerShift) {
        console.warn(`⚠️  BEDRIDDEN HOUSE WARNING: Shift ${s + 1} has only ${shiftCaregivers[s].length} caregivers (target: ${minPerShift}+)`);
      }
    }
    
  } else {
    // Standard distribution for regular houses or bedridden houses with few caregivers
    const basePerShift = Math.floor(caregivers.length / shiftDefs.length);
    const remainder = caregivers.length % shiftDefs.length;

    let index = 0;
    for (let s = 0; s < shiftDefs.length; s++) {
      const targetSize = basePerShift + (s < remainder ? 1 : 0);
      
      for (let i = 0; i < targetSize && index < shuffled.length; i++) {
        shiftCaregivers[s].push(shuffled[index]);
        index++;
      }
      
      console.log(`Shift ${s + 1} (${shiftDefs[s].name}): ${shiftCaregivers[s].length} caregivers`);
    }
  }

  return shiftCaregivers;
};

const getEndDate = (months) => {
  const end = new Date();
  end.setMonth(end.getMonth() + months);
  return end;
};

const ensureDayCounts = (obj, key, daysOfWeek) => {
  if (!obj[key]) obj[key] = daysOfWeek.map(() => 0);
  return obj[key];
};

// Generate consecutive work day patterns (5 work days + 2 rest days)
const generateConsecutiveWorkDays = (startDayIndex, daysOfWeek) => {
  const workDays = [];
  for (let i = 0; i < 5; i++) {
    const dayIndex = (startDayIndex + i) % 7;
    workDays.push(daysOfWeek[dayIndex]);
  }
  return workDays;
};

// Get all possible 5-consecutive-day patterns
const getAllConsecutivePatterns = (daysOfWeek) => {
  const patterns = [];
  for (let startIndex = 0; startIndex < 7; startIndex++) {
    patterns.push({
      startIndex,
      days: generateConsecutiveWorkDays(startIndex, daysOfWeek),
      dayIndexes: Array.from({length: 5}, (_, i) => (startIndex + i) % 7)
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
    console.log(`🏥 BEDRIDDEN HOUSE ENHANCED STRATEGY: Ensuring multiple caregivers per day for ${houseId} with ${caregivers.length} caregivers`);
    
    // For bedridden houses: Ensure every day gets adequate coverage (minimum 6 caregivers per day)
    const targetCaregiversPerDay = Math.max(6, Math.ceil(caregivers.length * 0.85));
    
    // Define strategic patterns that ensure good coverage for all days
    const strategicPatterns = [
      // Weekend + weekday overlap patterns
      { start: 5, desc: "Sat-Wed" },   // Saturday to Wednesday
      { start: 6, desc: "Sun-Thu" },   // Sunday to Thursday  
      { start: 0, desc: "Mon-Fri" },   // Monday to Friday
      { start: 1, desc: "Tue-Sat" },   // Tuesday to Saturday
      { start: 2, desc: "Wed-Sun" },   // Wednesday to Sunday
      { start: 3, desc: "Thu-Mon" },   // Thursday to Monday (covers critical Thu/Fri)
      { start: 4, desc: "Fri-Tue" },   // Friday to Tuesday (covers critical Fri)
    ];
    
    // Assign caregivers using strategic patterns to maximize daily coverage
    for (let i = 0; i < caregivers.length; i++) {
      const pattern = strategicPatterns[i % strategicPatterns.length];
      const startDay = pattern.start;
      const workDays = generateConsecutiveWorkDays(startDay, daysOfWeek);
      const dayIndexes = Array.from({length: 5}, (_, j) => (startDay + j) % 7);
      
      assignments.push({
        caregiver: caregivers[i],
        days: workDays,
        dayIndexes: dayIndexes
      });
      
      dayIndexes.forEach(idx => dayCounts[idx]++);
      
      console.log(`🏥 BEDRIDDEN ${pattern.desc}: ${caregivers[i].user_fname} -> ${workDays.join(", ")}`);
    }
    
    // Validation: Check that every day has enough caregivers
    const criticalDays = [3, 4, 5, 6]; // Thu, Fri, Sat, Sun - most critical days
    let needsAdjustment = false;
    
    daysOfWeek.forEach((dayName, dayIdx) => {
      const coverage = dayCounts[dayIdx];
      const isCritical = criticalDays.includes(dayIdx);
      const minRequired = isCritical ? targetCaregiversPerDay : Math.ceil(targetCaregiversPerDay * 0.8);
      
      if (coverage < minRequired) {
        console.warn(`⚠️  BEDRIDDEN ${houseId} ${dayName}: Only ${coverage} caregivers, need ${minRequired}`);
        needsAdjustment = true;
      } else {
        console.log(`✅ BEDRIDDEN ${houseId} ${dayName}: ${coverage} caregivers (sufficient)`);
      }
    });
    
    // If adjustment needed, redistribute some assignments
    if (needsAdjustment) {
      console.log(`🔧 BEDRIDDEN ${houseId}: Adjusting assignments to improve critical day coverage`);
      
      // Find caregivers with patterns that could be adjusted
      criticalDays.forEach(criticalDayIdx => {
        const coverage = dayCounts[criticalDayIdx];
        const minRequired = targetCaregiversPerDay;
        
        if (coverage < minRequired) {
          const deficit = minRequired - coverage;
          console.log(`🎯 Need ${deficit} more caregivers for ${daysOfWeek[criticalDayIdx]}`);
          
          // Find assignments that don't currently work this critical day
          let adjusted = 0;
          for (let i = 0; i < assignments.length && adjusted < deficit; i++) {
            const assignment = assignments[i];
            
            if (!assignment.dayIndexes.includes(criticalDayIdx)) {
              // Try to swap one of their days for the critical day
              // Prefer swapping the least critical day (prefer swapping weekday over weekend)
              let swapIndex = -1;
              let swapPriority = -1;
              
              for (let j = 0; j < assignment.dayIndexes.length; j++) {
                const dayIdx = assignment.dayIndexes[j];
                const isWeekend = dayIdx === 5 || dayIdx === 6;
                const priority = isWeekend ? 1 : 2; // Higher priority means more likely to swap
                
                if (priority > swapPriority) {
                  swapPriority = priority;
                  swapIndex = j;
                }
              }
              
              if (swapIndex >= 0) {
                const oldDayIdx = assignment.dayIndexes[swapIndex];
                
                // Update counts
                dayCounts[oldDayIdx]--;
                dayCounts[criticalDayIdx]++;
                
                // Update assignment
                assignment.dayIndexes[swapIndex] = criticalDayIdx;
                assignment.days[swapIndex] = daysOfWeek[criticalDayIdx];
                
                console.log(`🔄 Adjusted ${caregivers[i].user_fname}: Swapped ${daysOfWeek[oldDayIdx]} for ${daysOfWeek[criticalDayIdx]}`);
                adjusted++;
              }
            }
          }
        }
      });
    }
  } else {
    // Strategy for regular houses: ensure basic coverage first
    if (caregivers.length >= 7) {
      // First 7 caregivers get one of each starting day to ensure complete coverage
      for (let i = 0; i < Math.min(7, caregivers.length); i++) {
        const startDay = i; // Each of the first 7 starts on a different day
        const pattern = generateConsecutiveWorkDays(startDay, daysOfWeek);
        const dayIndexes = Array.from({length: 5}, (_, j) => (startDay + j) % 7);
        
        assignments.push({
          caregiver: caregivers[i],
          days: pattern,
          dayIndexes: dayIndexes
        });
        
        dayIndexes.forEach(idx => dayCounts[idx]++);
      }
      
      // Remaining caregivers get balanced weekend coverage
      const weekendPriorities = [5, 6, 0, 1, 2, 3, 4]; // Saturday, Sunday, then weekdays
      for (let i = 7; i < caregivers.length; i++) {
        const priorityIdx = (i - 7) % weekendPriorities.length;
        const startDay = weekendPriorities[priorityIdx];
        const pattern = generateConsecutiveWorkDays(startDay, daysOfWeek);
        const dayIndexes = Array.from({length: 5}, (_, j) => (startDay + j) % 7);
        
        assignments.push({
          caregiver: caregivers[i],
          days: pattern,
          dayIndexes: dayIndexes
        });
        
        dayIndexes.forEach(idx => dayCounts[idx]++);
      }
    } else {
      // Strategy 2: For fewer caregivers, ensure every day is covered
      const patterns = getAllConsecutivePatterns(daysOfWeek);
      const tempCoverage = new Array(7).fill(0);
      
      // First, assign patterns to maximize coverage
      for (let i = 0; i < caregivers.length; i++) {
        let bestPattern = null;
        let bestScore = -1;
        
        // Find pattern that covers the most uncovered days
        for (const pattern of patterns) {
          let score = 0;
          for (const dayIdx of pattern.dayIndexes) {
            if (tempCoverage[dayIdx] === 0) score += 2; // Prefer uncovered days
            else score += 1; // But still count covered days
          }
          
          if (score > bestScore) {
            bestScore = score;
            bestPattern = pattern;
          }
        }
        
        if (bestPattern) {
          assignments.push({
            caregiver: caregivers[i],
            days: bestPattern.days,
            dayIndexes: bestPattern.dayIndexes
          });
          
          bestPattern.dayIndexes.forEach(idx => {
            tempCoverage[idx]++;
            dayCounts[idx]++;
          });
        }
      }
      
      // Check for uncovered days and adjust assignments
      for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        if (tempCoverage[dayIdx] === 0 && assignments.length > 0) {
          // Find assignment with most flexibility to adjust
          let bestAssignment = 0;
          let minAdjacent = Infinity;
          
          for (let i = 0; i < assignments.length; i++) {
            const adjacent = assignments[i].dayIndexes.filter(idx => 
              Math.abs(idx - dayIdx) <= 1 || Math.abs(idx - dayIdx) >= 6
            ).length;
            
            if (adjacent < minAdjacent) {
              minAdjacent = adjacent;
              bestAssignment = i;
            }
          }
          
          // Replace the least disruptive day in the best assignment
          const assignment = assignments[bestAssignment];
          const oldIdx = assignment.dayIndexes[4]; // Replace 5th day
          
          // Update counts
          dayCounts[oldIdx]--;
          dayCounts[dayIdx]++;
          
          // Update assignment
          assignment.dayIndexes[4] = dayIdx;
          assignment.days[4] = daysOfWeek[dayIdx];
          
          tempCoverage[oldIdx]--;
          tempCoverage[dayIdx]++;
          
          console.log(`Adjusted coverage: moved ${daysOfWeek[oldIdx]} to ${daysOfWeek[dayIdx]} for complete coverage`);
        }
      }
    }
  }
  
  // Verify coverage with comprehensive logging
  console.log(`🏥 Schedule Coverage Analysis for ${isBedridden ? `BEDRIDDEN HOUSE ${houseId}` : `House ${houseId || 'Unknown'}`} (${caregivers.length} total caregivers):`);
  
  const uncoveredDays = dayCounts.map((count, idx) => count === 0 ? daysOfWeek[idx] : null).filter(Boolean);
  
  daysOfWeek.forEach((day, idx) => {
    const count = dayCounts[idx];
    let status;
    if (isBedridden) {
      // Bedridden houses need higher thresholds
      status = count === 0 ? "❌ NO COVERAGE" : 
               count === 1 ? "🚨 CRITICAL - ONLY 1 CAREGIVER" :
               count === 2 ? "⚠️  MINIMAL" :
               count >= 3 ? "✅ GOOD" : "✅ EXCELLENT";
    } else {
      // Regular houses
      status = count === 0 ? "❌ NO COVERAGE" : 
               count === 1 ? "⚠️  MINIMAL" :
               count === 2 ? "✅ GOOD" : "✅ EXCELLENT";
    }
    console.log(`  ${day}: ${count} caregivers ${status}`);
  });
  
  if (uncoveredDays.length > 0) {
    console.error(`🚨 CRITICAL: Days with NO coverage: ${uncoveredDays.join(', ')}`);
    console.error(`🔧 This will cause the schedule to fail! Check caregiver assignments.`);
  } else {
    console.log(`✅ SUCCESS: Complete daily coverage achieved with ${caregivers.length} caregivers`);
  }
  
  // Log weekend-specific coverage with bedridden house analysis
  const weekendCoverage = {
    saturday: dayCounts[5],
    sunday: dayCounts[6]
  };
  
  if (isBedridden) {
    const weekendSufficient = weekendCoverage.saturday >= 3 && weekendCoverage.sunday >= 3; // Higher threshold for bedridden
    console.log(`🎯 BEDRIDDEN HOUSE Weekend Coverage: Saturday (${weekendCoverage.saturday}), Sunday (${weekendCoverage.sunday}) ${weekendSufficient ? '✅ EXCELLENT' : '⚠️  NEEDS MORE STAFF'}`);
    
    if (!weekendSufficient) {
      console.warn(`⚠️  Bedridden house ${houseId} needs more weekend staffing! Target: 3+ per weekend day`);
    }
  } else {
    console.log(`🎯 Weekend Coverage: Saturday (${weekendCoverage.saturday}), Sunday (${weekendCoverage.sunday})`);
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
      H002: 3, // Priority houses get 3x weight
      H003: 3, // Priority houses get 3x weight
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
          "bedridden_house_priority", // H002 & H003 get 3x weight
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
          H002: "bedridden_priority_3x_weight",
          H003: "bedridden_priority_3x_weight", 
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

export const markCaregiverAbsent = async (
  assignDocId,
  assignments,
  elderlyAssigns,
  tempReassigns,
  // NEW: pass the date string (YYYY-MM-DD) or null to mean "today"
  targetDateStr = null,
  // NEW: pass the day name ("Monday", "Tuesday", ...) or null to be derived from targetDateStr or today
  dayNameParam = null
) => {
  try {
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const assign = assignments.find((a) => a.id === assignDocId);
    if (!assign) throw new Error("Assignment not found");

    // Resolve target date and day:
    const useDate = targetDateStr ? new Date(targetDateStr) : new Date();
    const useDateStr = targetDateStr || useDate.toISOString().slice(0, 10);
    // Compute day name from either param or resolved date
    const dayIndexFromDate = useDate.getDay(); // 0=Sunday,1=Mon...
    const derivedDayName = daysOfWeek[dayIndexFromDate === 0 ? 6 : dayIndexFromDate - 1];
    const dayName = dayNameParam || derivedDayName;

    console.log(`=== ABSENCE DEBUGGING ===`);
    console.log(`Marking absent for caregiver: ${assign.caregiver_id}`);
    console.log(`Assignment details:`, {
      id: assign.id,
      house_id: assign.house_id,
      shift: assign.shift,
      days_assigned: assign.days_assigned,
      version: assign.version
    });
    console.log(`Target Date: ${useDateStr}, Day: ${dayName}`);

    // 1. Mark the caregiver as absent for the target date only
    await updateDoc(doc(db, "cg_house_assign_v2", assignDocId), {
      is_absent: true,
      absent_at: Timestamp.now(),
      absent_for_date: useDateStr
    });

    // Update local 'assign' object so subsequent filtering uses the updated value (avoid stale UI props)
    assign.is_absent = true;
    assign.absent_for_date = useDateStr;

    // 2. Get the caregiver's assigned elderly for the TARGET DAY only
    console.log(`Total elderly assignments in system: ${elderlyAssigns.length}`);
    console.log(`Looking for elderly with caregiver_id: ${assign.caregiver_id}, version: ${assign.version}, day: ${dayName}`);

    // First, get the original assignments from the database
    const originalAssignedEAs = elderlyAssigns.filter(
      (ea) =>
        ea.caregiver_id === assign.caregiver_id &&
        ea.assign_version === assign.version &&
        (ea.day || "").toLowerCase() === dayName.toLowerCase()
    );

    // Then, check if this caregiver has any temporary assignments TO them for this date
    // (from other absent caregivers) that also need to be reassigned
    const tempAssignmentsToThisCaregiver = tempReassigns.filter(
      (t) =>
        t.to_caregiver_id === assign.caregiver_id &&
        t.date === useDateStr &&
        t.assign_version === assign.version
    );

    console.log(`Original elderly assignments for ${assign.caregiver_id} on ${dayName}: ${originalAssignedEAs.length}`, originalAssignedEAs.map(ea => ea.elderly_id));
    console.log(`Temp assignments TO ${assign.caregiver_id} for ${useDateStr}: ${tempAssignmentsToThisCaregiver.length}`, tempAssignmentsToThisCaregiver.map(t => t.elderly_id));

    // Combine both original and temporarily assigned elderly that need to be reassigned
    const originalElderIds = originalAssignedEAs.map((ea) => ea.elderly_id);
    const tempElderIds = tempAssignmentsToThisCaregiver.map((t) => t.elderly_id);
    const allElderIds = [...originalElderIds, ...tempElderIds];
    
    console.log(`All elderly IDs to reassign from ${assign.caregiver_id}: ${allElderIds.length}`, allElderIds);

    // 3. Remove any existing temporary assignments TO this caregiver (they need to be redistributed)
    if (tempAssignmentsToThisCaregiver.length > 0) {
      console.log(`Removing ${tempAssignmentsToThisCaregiver.length} existing temp assignments TO ${assign.caregiver_id}`);
      const removePromises = tempAssignmentsToThisCaregiver.map(t => 
        deleteDoc(doc(db, "temp_reassignments", t.id))
      );
      await Promise.all(removePromises);
      console.log(`✅ Removed existing temp assignments TO ${assign.caregiver_id}`);
    }

    // 4. Find other caregivers in the SAME house & shift who can cover for that DAY
    console.log(`Looking for coverage caregivers with:`);
    console.log(`- Same house: ${assign.house_id}`);
    console.log(`- Same shift: ${assign.shift}`);
    console.log(`- Working on day (${dayName})`);
    console.log(`- Not absent for the same date`);
    console.log(`- Current assignments`);

    const otherAssigns = assignments.filter((a) =>
      a.house_id === assign.house_id &&
      a.shift === assign.shift &&
      a.id !== assignDocId &&
      a.is_current &&
      // ensure they are scheduled to work on the target day
      Array.isArray(a.days_assigned) &&
      a.days_assigned.map(d => d.toLowerCase()).includes(dayName.toLowerCase()) &&
      // exclude those marked absent for same date
      !(a.is_absent && a.absent_for_date === useDateStr)
    );

    console.log(`Found ${otherAssigns.length} other caregivers available to cover:`);
    otherAssigns.forEach(a => {
      console.log(`- Caregiver: ${a.caregiver_id}, Days: ${a.days_assigned?.join(', ')}, absent_for_date: ${a.absent_for_date}`);
    });

    if (otherAssigns.length === 0) {
      console.log("❌ No available caregivers to reassign for this date.");
      return { success: true, message: "Caregiver marked as absent, but no coverage available for that date" };
    }

    // 5. Split all elderly (original + temporarily assigned) evenly among available caregivers
    console.log(`Creating temporary reassignments for ${allElderIds.length} elderly...`);
    const chunks = splitIntoChunks(allElderIds, otherAssigns.length);
    console.log(`Elder chunks:`, chunks.map((chunk, i) => ({
      caregiver: otherAssigns[i]?.caregiver_id,
      elderCount: chunk.length,
      elders: chunk
    })));

    const promises = [];
    for (let i = 0; i < otherAssigns.length; i++) {
      const target = otherAssigns[i];
      const chunk = chunks[i] || [];
      console.log(`Assigning ${chunk.length} elderly to caregiver ${target.caregiver_id}`);

      for (const eid of chunk) {
        const reassignmentData = {
          elderly_id: eid,
          from_caregiver_id: assign.caregiver_id,
          to_caregiver_id: target.caregiver_id,
          date: useDateStr,           // use the target date
          assign_version: assign.version,
          created_at: Timestamp.now(),
        };
        console.log(`Creating temp reassignment:`, reassignmentData);

        promises.push(addDoc(collection(db, "temp_reassignments"), reassignmentData));
      }
    }

    await Promise.all(promises);
    console.log(`✅ ${promises.length} temporary reassignments created successfully`);
    console.log(`=== END ABSENCE DEBUGGING ===`);
    return { success: true, message: "Caregiver marked as absent and elderly reassigned" };

  } catch (error) {
    console.error("Error marking caregiver absent:", error);
    throw new Error("Failed to mark caregiver as absent");
  }
};


export const unmarkCaregiverAbsent = async (assignDocId, assignments) => {
  try {
    const assign = assignments.find(a => a.id === assignDocId);
    if (!assign) throw new Error("Assignment not found");

    const todayStr = new Date().toISOString().slice(0, 10);

    // 1. Clear absence for today only
    await updateDoc(doc(db, "cg_house_assign_v2", assignDocId), {
      is_absent: false,
      absent_at: null,
      absent_for_date: null,
    });

    // 2. Remove temporary reassignments for today from this caregiver
    const snap = await getDocs(query(
      collection(db, "temp_reassignments"),
      where("date", "==", todayStr)
    ));

    const delPromises = snap.docs
      .filter(d => d.data().from_caregiver_id === assign.caregiver_id)
      .map(d => deleteDoc(doc(db, "temp_reassignments", d.id)));

    await Promise.all(delPromises);
    return { success: true, message: "Caregiver absence cleared" };

  } catch (error) {
    console.error("Error unmarking caregiver absent:", error);
    throw new Error("Failed to clear caregiver absence");
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

// Reset daily absences
export const resetDailyAbsences = async () => {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const snap = await getDocs(collection(db, "cg_house_assign_v2"));

    const resetPromises = snap.docs
      .filter((d) => d.data().is_absent && d.data().absent_for_date !== todayStr)
      .map((d) =>
        updateDoc(doc(db, "cg_house_assign_v2", d.id), {
          is_absent: false,
          absent_at: null,
          absent_for_date: null,
        })
      );

    await Promise.all(resetPromises);
    return { success: true, message: "Daily absences reset" };

  } catch (error) {
    console.error("Error resetting daily absences:", error);
    throw new Error("Failed to reset daily absences");
  }
};

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
  await addDoc(collection(db, "activity_logs_v2"), {
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
  await addDoc(collection(db, "activity_logs_v2"), {
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

// Enhanced absence marking with emergency coverage check (returns emergency info, doesn't auto-execute)
export const markCaregiverAbsentWithEmergencyCheck = async (
  assignDocId,
  assignments,
  elderlyAssigns,
  tempReassigns,
  targetDateStr = null,
  dayNameParam = null
) => {
  try {
    // First, mark the caregiver absent using existing function
    await markCaregiverAbsent(assignDocId, assignments, elderlyAssigns, tempReassigns, targetDateStr, dayNameParam);
    
    // Then check if emergency coverage is needed
    const useDate = targetDateStr ? new Date(targetDateStr) : new Date();
    const useDateStr = targetDateStr || useDate.toISOString().slice(0, 10);
    
    console.log(`🔍 Checking if emergency coverage needed after marking absence for ${useDateStr}`);
    
    // Refresh assignments to get updated state
    const refreshedAssignments = await fetchAssignments(true);
    
    // Check for emergency coverage needs (but don't auto-execute)
    const emergencyCheck = await checkEmergencyNeedsAndDonors(useDateStr, refreshedAssignments, elderlyAssigns, tempReassigns);
    
    return {
      success: true,
      absenceMarked: true,
      emergencyCheck: emergencyCheck
    };
    
  } catch (error) {
    console.error("Error in absence marking with emergency check:", error);
    throw error;
  }
};

// ========== NEW CAREGIVER INTEGRATION FUNCTIONS ==========

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
    const recommendations = [];
    
    // Analyze current coverage for each house/shift combination
    for (const house of houses) {
      for (const shift of shifts) {
        const analysis = await analyzeHouseShiftCoverage(house.house_id, shift, assignments);
        
        if (analysis.needsMoreCoverage) {
          // Generate work day patterns (5 consecutive days)
          const workDayPatterns = generateWorkDayPatterns(daysOfWeek, analysis.weakDays);
          
          for (const pattern of workDayPatterns) {
            const recommendation = {
              house: house.house_id,
              houseName: house.house_name,
              shift: shift,
              workDays: pattern.days,
              score: calculateRecommendationScore(analysis, pattern, house.house_id),
              reason: generateRecommendationReason(analysis, pattern, house.house_name)
            };
            
            recommendations.push(recommendation);
          }
        }
      }
    }
    
    // Sort recommendations by score (highest first)
    recommendations.sort((a, b) => b.score - a.score);
    
    // Return top 5 recommendations
    const topRecommendations = recommendations.slice(0, 5);
    
    console.log(`✅ Generated ${topRecommendations.length} recommendations for caregiver ${caregiverId}`);
    
    return topRecommendations;
    
  } catch (error) {
    console.error("Error generating caregiver recommendations:", error);
    throw new Error("Failed to generate recommendations");
  }
};

// Analyze coverage for a specific house and shift
const analyzeHouseShiftCoverage = async (houseId, shift, assignments) => {
  const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const coverageAnalysis = {
    house: houseId,
    shift: shift,
    totalCaregivers: 0,
    dailyCoverage: {},
    weakDays: [],
    averageCoverage: 0,
    needsMoreCoverage: false
  };
  
  // Initialize daily coverage counts
  daysOfWeek.forEach(day => {
    coverageAnalysis.dailyCoverage[day] = 0;
  });
  
  // Count current assignments for this house/shift
  const relevantAssignments = assignments.filter(assignment => 
    assignment.is_current && 
    assignment.house_id === houseId && 
    assignment.shift === shift
  );
  
  coverageAnalysis.totalCaregivers = relevantAssignments.length;
  
  // Count coverage per day
  relevantAssignments.forEach(assignment => {
    if (assignment.days_assigned && Array.isArray(assignment.days_assigned)) {
      assignment.days_assigned.forEach(day => {
        if (coverageAnalysis.dailyCoverage[day] !== undefined) {
          coverageAnalysis.dailyCoverage[day]++;
        }
      });
    }
  });
  
  // Calculate average coverage and find weak days
  const coverageCounts = Object.values(coverageAnalysis.dailyCoverage);
  coverageAnalysis.averageCoverage = coverageCounts.reduce((sum, count) => sum + count, 0) / daysOfWeek.length;
  
  // Find days with below-average coverage
  daysOfWeek.forEach(day => {
    if (coverageAnalysis.dailyCoverage[day] < coverageAnalysis.averageCoverage) {
      coverageAnalysis.weakDays.push(day);
    }
  });
  
  // Determine if this house/shift needs more coverage
  const isBedridden = houseId === "H002" || houseId === "H003";
  const minDesiredCaregivers = isBedridden ? 3 : 2; // Higher threshold for bedridden houses
  
  coverageAnalysis.needsMoreCoverage = 
    coverageAnalysis.averageCoverage < minDesiredCaregivers || 
    coverageAnalysis.weakDays.length >= 3;
  
  return coverageAnalysis;
};

// Generate different work day patterns (5 consecutive days)
const generateWorkDayPatterns = (daysOfWeek, priorityDays = []) => {
  const patterns = [];
  
  // Generate all possible 5-consecutive-day patterns
  for (let startIndex = 0; startIndex < 7; startIndex++) {
    const pattern = {
      startIndex: startIndex,
      days: [],
      priorityScore: 0
    };
    
    for (let i = 0; i < 5; i++) {
      const dayIndex = (startIndex + i) % 7;
      const day = daysOfWeek[dayIndex];
      pattern.days.push(day);
      
      // Give priority score if this day is in weak days
      if (priorityDays.includes(day)) {
        pattern.priorityScore++;
      }
    }
    
    patterns.push(pattern);
  }
  
  // Sort patterns by priority score (patterns that cover more weak days first)
  patterns.sort((a, b) => b.priorityScore - a.priorityScore);
  
  return patterns.slice(0, 3); // Return top 3 patterns
};

// Calculate recommendation score based on coverage analysis
const calculateRecommendationScore = (analysis, pattern, houseId) => {
  let score = 50; // Base score
  
  // Higher score for houses that need more coverage
  if (analysis.needsMoreCoverage) {
    score += 30;
  }
  
  // Higher score for bedridden houses (priority)
  const isBedridden = houseId === "H002" || houseId === "H003";
  if (isBedridden) {
    score += 20;
  }
  
  // Score based on how many weak days this pattern covers
  const weakDaysCovered = pattern.days.filter(day => analysis.weakDays.includes(day)).length;
  score += weakDaysCovered * 10;
  
  // Penalty for houses with already high coverage
  if (analysis.averageCoverage > 4) {
    score -= 15;
  }
  
  // Weekend coverage bonus (Saturday/Sunday)
  const weekendDays = pattern.days.filter(day => day === "Saturday" || day === "Sunday").length;
  score += weekendDays * 5;
  
  return Math.min(Math.max(score, 0), 100); // Keep score between 0-100
};

// Generate human-readable reason for recommendation
const generateRecommendationReason = (analysis, pattern, houseName) => {
  const reasons = [];
  
  if (analysis.needsMoreCoverage) {
    reasons.push(`${houseName} needs additional coverage (avg: ${analysis.averageCoverage.toFixed(1)} caregivers/day)`);
  }
  
  const weekendDays = pattern.days.filter(day => day === "Saturday" || day === "Sunday");
  if (weekendDays.length > 0) {
    reasons.push(`Provides weekend coverage (${weekendDays.join(', ')})`);
  }
  
  const weakDaysCovered = pattern.days.filter(day => analysis.weakDays.includes(day));
  if (weakDaysCovered.length > 0) {
    reasons.push(`Strengthens coverage on weak days (${weakDaysCovered.join(', ')})`);
  }
  
  if (reasons.length === 0) {
    reasons.push("Maintains balanced coverage across all days");
  }
  
  return reasons.join('. ');
};

// Integrate new caregiver into existing schedule
export const integrateNewCaregiver = async (caregiverId, assignmentData, currentAssignments, elderlyAssignments) => {
  try {
    console.log(`🔗 Integrating caregiver ${caregiverId} into existing schedule`);
    
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
    
    // Auto-assign elderly to new caregiver based on house assignment
    const houseElderly = await getDocs(
      query(collection(db, "elderly"), where("house_id", "==", assignmentData.house))
    );
    
    // Find elderly in this house that have fewer caregiver assignments
    const elderlyNeedingCaregivers = [];
    
    for (const elderlyDoc of houseElderly.docs) {
      const elderlyData = { id: elderlyDoc.id, ...elderlyDoc.data() };
      
      // Count existing caregiver assignments for this elderly
      const existingAssignments = elderlyAssignments.filter(ea => ea.elderly_id === elderlyData.id);
      
      // Elderly with fewer than 3 caregivers can get more
      if (existingAssignments.length < 3) {
        elderlyNeedingCaregivers.push({
          ...elderlyData,
          currentCaregiversCount: existingAssignments.length
        });
      }
    }
    
    // Sort by those needing caregivers most (fewer current caregivers first)
    elderlyNeedingCaregivers.sort((a, b) => a.currentCaregiversCount - b.currentCaregiversCount);
    
    // Assign this caregiver to up to 3 elderly (standard distribution)
    const elderlyToAssign = elderlyNeedingCaregivers.slice(0, 3);
    
    for (const elderly of elderlyToAssign) {
      const elderlyAssignRef = doc(collection(db, "elderly_caregiver_assign_v2"));
      const elderlyAssignDoc = {
        caregiver_id: caregiverId,
        elderly_id: elderly.id,
        assigned_date: Timestamp.now(),
        integration_type: "auto_elderly_assignment"
      };
      
      batch.set(elderlyAssignRef, elderlyAssignDoc);
      writeCount++;
    }
    
    // Commit the batch
    if (writeCount > 0) {
      await batch.commit();
    }
    
    // Log the integration activity
    await addDoc(collection(db, "activity_logs_v2"), {
      action: "New Caregiver Integration",
      caregiver_id: caregiverId,
      assignment_details: assignmentData,
      elderly_assigned_count: elderlyToAssign.length,
      time: Timestamp.now(),
      created_by: "admin"
    });
    
    console.log(`✅ Successfully integrated caregiver ${caregiverId} with ${elderlyToAssign.length} elderly assignments`);
    
    return {
      success: true,
      message: `Successfully integrated caregiver into ${assignmentData.house} - ${assignmentData.shift} shift`,
      elderlyAssigned: elderlyToAssign.length,
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