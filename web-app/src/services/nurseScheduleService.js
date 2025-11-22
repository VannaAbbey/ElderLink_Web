import { 
  collection, 
  getDocs, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  writeBatch,
  updateDoc 
} from "firebase/firestore";
import { checkUserAbsence } from './absenceService.js';

/**
 * Nurse Schedule Service
 * Contains all business logic for nurse scheduling operations
 */
export class NurseScheduleService {
  constructor(db) {
    this.db = db;
  }

  // Shift definitions
  static SHIFT_DEFS = [
    { name: "6:00 AM - 2:00 PM", key: "1st", startTime: "06:00", endTime: "14:00" },
    { name: "2:00 PM - 10:00 PM", key: "2nd", startTime: "14:00", endTime: "22:00" },
    { name: "10:00 PM - 6:00 AM", key: "3rd", startTime: "22:00", endTime: "06:00" },
    { name: "Rest Day", key: "rest", startTime: "", endTime: "" }
  ];

  static DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Data loading methods
  // ✅ PERFORMANCE: These queries should have composite indexes in Firestore for optimal performance
  // Recommended indexes:
  // 1. users: (user_type, user_activation, scheduleStatus)
  // 2. elderly: (elderly_status) for filtering deceased
  
  async loadNurses() {
    // ✅ PERFORMANCE FIX: Filter at query level to reduce data transfer
    const nurseSnap = await getDocs(query(
      collection(this.db, "users"), 
      where("user_type", "==", "nurse")
      // Note: user_activation filtering done in-memory to avoid index issues
    ));
    return nurseSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(nurse => nurse.scheduleStatus !== "inactive" && nurse.user_activation !== false); // Exclude inactive and deactivated nurses
  }

  async loadHouses() {
    const houseSnap = await getDocs(collection(this.db, "house"));
    return houseSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async loadElderly() {
    // ✅ PERFORMANCE FIX: Could filter deceased elderly at query level if elderly_status field exists
    const elderlySnap = await getDocs(collection(this.db, "elderly"));
    return elderlySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async loadAllData() {
    // ✅ Parallel loading for better performance
    const [nurses, houses, elderly] = await Promise.all([
      this.loadNurses(),
      this.loadHouses(),
      this.loadElderly()
    ]);
    return { nurses, houses, elderly };
  }

  // Real-time listeners
  // Note: Removed caregiver dependency - nurses should be assigned independently

  subscribeToNurseShiftAssignments(callback) {
    const q = query(
      collection(this.db, "house_shift_assignments"),
      where("is_current", "==", true),
      where("user_type", "==", "nurse")
    );
    return onSnapshot(q, (snap) => {
      const assignments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(assignments);
    });
  }

  subscribeToNurseElderlyAssignments(callback) {
    // ✅ PERFORMANCE FIX: Filter to only fetch nurse assignments (not caregiver assignments)
    const q = query(
      collection(this.db, "elderly_assignments"),
      where("user_type", "==", "nurse")
    );
    return onSnapshot(q, (snap) => {
      const assignments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(assignments);
    });
  }

  // Helper methods for data lookup
  getNurseName(nurseId, nurses) {
    const nurse = nurses.find((n) => n.id === nurseId);
    return nurse ? `${nurse.user_fname} ${nurse.user_lname}` : "Unknown Nurse";
  }

  getHouseName(houseId, houses) {
    const house = houses.find((h) => h.house_id === houseId || h.id === houseId);
    return house ? house.house_name : "Unknown House";
  }

  getElderlyName(elderlyId, elderlyList) {
    const elderly = elderlyList.find((e) => e.id === elderlyId);
    return elderly ? `${elderly.elderly_fname} ${elderly.elderly_lname}` : "Unknown";
  }

  // Get elderly assigned to nurse for a specific day
  getElderlyForNurseDay(nurseId, day, nurseElderlyAssignments) {
    const assignment = nurseElderlyAssignments.find(
      (a) => a.user_id === nurseId && a.day === day
    );
    return assignment?.elderly_ids || [];
  }

  // Get house for elderly (group elderly by house)
  getHouseForElderly(elderlyId, elderlyList) {
    const elderly = elderlyList.find((e) => e.id === elderlyId);
    return elderly?.house_id || null;
  }

  // Schedule generation business logic
  getNextShift(currentShift) {
    const shiftOrder = ["1st", "2nd", "3rd"];
    const currentIndex = shiftOrder.indexOf(currentShift);
    return shiftOrder[(currentIndex + 1) % shiftOrder.length];
  }

  getLastShiftForNurse(nurseId, assignments, lastShiftRotation) {
    // Check current assignments first
    const currentAssignments = assignments.filter(a => a.user_id === nurseId);
    if (currentAssignments.length > 0) {
      // Return the most recent shift (could be from any of their current assignments)
      return currentAssignments[0].shift;
    }
    
    // Check stored rotation data
    return lastShiftRotation[nurseId] || "3rd"; // Start with 3rd so first assignment is 1st
  }

  // Generate work-rest pattern: 5 work days + 2 rest days with better distribution
  generateWorkRestPattern(startDayIndex, shift) {
    const pattern = {};
    
    // Generate 5 work days
    for (let i = 0; i < 5; i++) {
      const dayIndex = (startDayIndex + i) % 7;
      pattern[NurseScheduleService.DAYS_OF_WEEK[dayIndex]] = shift;
    }
    
    // Add 2 rest days
    for (let i = 5; i < 7; i++) {
      const dayIndex = (startDayIndex + i) % 7;
      pattern[NurseScheduleService.DAYS_OF_WEEK[dayIndex]] = "rest";
    }
    
    return pattern;
  }

  // Distribute nurses evenly across all days with staggered rest days for continuous coverage
  distributeNursesAcrossDays(balancedNurseAssignments) {
    const monthlyAssignments = {};
    
    // Create a pool of all nurse-shift combinations
    const nurseShiftPairs = [];
    Object.entries(balancedNurseAssignments).forEach(([shift, nursesInShift]) => {
      nursesInShift.forEach((nurse) => {
        nurseShiftPairs.push({ nurse, shift });
      });
    });
    
    // Track daily nurse counts to ensure even distribution
    const dailyNurseCounts = {};
    NurseScheduleService.DAYS_OF_WEEK.forEach(day => dailyNurseCounts[day] = 0);
    
    // Track rest day distribution to ensure coverage
    const restDayDistribution = {};
    NurseScheduleService.DAYS_OF_WEEK.forEach(day => restDayDistribution[day] = 0);
    
    // Assign work patterns with staggered rest days for continuous coverage
    nurseShiftPairs.forEach((nurseShift, index) => {
      let bestStartDay = 0;
      let bestScore = Infinity;
      const bestStartDays = []; // Track all days with equally good scores
      
      // Try each possible start day and find the one with best overall distribution
      for (let startDay = 0; startDay < 7; startDay++) {
        // Calculate what the daily work counts and rest counts would be
        const tempWorkCounts = { ...dailyNurseCounts };
        const tempRestCounts = { ...restDayDistribution };
        
        // Calculate work days
        for (let i = 0; i < 5; i++) { // 5 work days
          const dayIndex = (startDay + i) % 7;
          tempWorkCounts[NurseScheduleService.DAYS_OF_WEEK[dayIndex]]++;
        }
        
        // Calculate rest days (2 consecutive rest days)
        for (let i = 5; i < 7; i++) { // 2 rest days
          const dayIndex = (startDay + i) % 7;
          tempRestCounts[NurseScheduleService.DAYS_OF_WEEK[dayIndex]]++;
        }
        
        // Score based on distribution metrics
        const workValues = Object.values(tempWorkCounts);
        const restValues = Object.values(tempRestCounts);
        
        const maxWorkCount = Math.max(...workValues);
        const minWorkCount = Math.min(...workValues);
        const maxRestCount = Math.max(...restValues);
        
        // Penalize if any day would have too few workers or too many resting
        const totalNurses = nurseShiftPairs.length;
        const workSpread = maxWorkCount - minWorkCount;
        const restPenalty = maxRestCount > Math.floor(totalNurses * 0.6) ? 1000 : 0;
        
        // Strong penalty for zero coverage days to ensure continuous coverage
        let coveragePenalty = 0;
        const worstCoverage = Math.min(...workValues);
        if (worstCoverage === 0) {
          coveragePenalty = 500; // Strong penalty to avoid zero coverage days
        } else if (worstCoverage < Math.ceil(totalNurses * 0.1)) {
          coveragePenalty = 100; // Medium penalty for very low coverage days
        }
        
        // Additional penalty for 3rd shift coverage gaps specifically
        let thirdShiftPenalty = 0;
        if (nurseShift.shift === "3rd") {
          const thirdShiftCount = nurseShiftPairs.filter(ns => ns.shift === "3rd").length;
          if (thirdShiftCount > 0) {
            const avgThirdShiftCoverage = (thirdShiftCount * 5) / 7;
            if (avgThirdShiftCoverage < 1) {
              thirdShiftPenalty = 200; // Penalty for insufficient 3rd shift coverage
            }
          }
        }
        
        const score = workSpread + restPenalty + coveragePenalty + thirdShiftPenalty;
        
        if (score < bestScore) {
          bestScore = score;
          bestStartDay = startDay;
          bestStartDays.length = 0; // Clear previous best days
          bestStartDays.push(startDay);
        } else if (score === bestScore) {
          // Track all days with the same best score for randomization
          bestStartDays.push(startDay);
        }
      }
      
      // 🎲 RANDOMIZATION: If multiple days have the same score, randomly pick one
      if (bestStartDays.length > 1) {
        bestStartDay = bestStartDays[Math.floor(Math.random() * bestStartDays.length)];
      }
      
      // Apply the best start day and update actual counts
      const nursePattern = this.generateWorkRestPattern(bestStartDay, nurseShift.shift);
      monthlyAssignments[nurseShift.nurse.id] = nursePattern;
      
      // Update daily work counts
      for (let i = 0; i < 5; i++) {
        const dayIndex = (bestStartDay + i) % 7;
        dailyNurseCounts[NurseScheduleService.DAYS_OF_WEEK[dayIndex]]++;
      }
      
      // Update rest day counts
      for (let i = 5; i < 7; i++) {
        const dayIndex = (bestStartDay + i) % 7;
        restDayDistribution[NurseScheduleService.DAYS_OF_WEEK[dayIndex]]++;
      }
    });
    
    return monthlyAssignments;
  }

  // Validate and fix coverage gaps to ensure every day has at least one nurse working
  validateAndFixCoverage(assignments) {
    const fixedAssignments = { ...assignments };
    
    // Calculate daily coverage for each day
    const dailyCoverage = {};
    NurseScheduleService.DAYS_OF_WEEK.forEach(day => dailyCoverage[day] = 0);
    
    // Count nurses working each day
    Object.values(assignments).forEach(nurseSchedule => {
      Object.entries(nurseSchedule).forEach(([day, shift]) => {
        if (shift !== "rest") {
          dailyCoverage[day]++;
        }
      });
    });
    
    // Find days with zero coverage
    const zeroCoverageDays = NurseScheduleService.DAYS_OF_WEEK.filter(day => dailyCoverage[day] === 0);
    
    if (zeroCoverageDays.length > 0) {
      console.log(`Fixing coverage gaps for days: ${zeroCoverageDays.join(", ")}`);
      
      // Find nurses with the most rest days to reassign
      const nurseRestCounts = {};
      Object.entries(assignments).forEach(([nurseId, schedule]) => {
        nurseRestCounts[nurseId] = Object.values(schedule).filter(shift => shift === "rest").length;
      });
      
      // Sort nurses by rest day count (descending)
      const nursesByRestDays = Object.keys(nurseRestCounts)
        .sort((a, b) => nurseRestCounts[b] - nurseRestCounts[a]);
      
      // For each zero coverage day, reassign a nurse from rest to work
      zeroCoverageDays.forEach(day => {
        for (const nurseId of nursesByRestDays) {
          if (fixedAssignments[nurseId][day] === "rest") {
            // Assign this nurse to 3rd shift on this day (overnight coverage)
            fixedAssignments[nurseId][day] = "3rd";
            console.log(`Assigned nurse ${nurseId} to 3rd shift on ${day} to fix coverage gap`);
            break;
          }
        }
      });
    }
    
    return fixedAssignments;
  }

  // Calculate optimal shift distribution based on total nurses
  calculateOptimalShiftDistribution(totalNurses) {
    if (totalNurses <= 3) {
      // For very small teams, ensure at least 1 nurse per shift
      return { "1st": 1, "2nd": 1, "3rd": 1 };
    } else if (totalNurses <= 6) {
      // For medium teams, ensure at least 2 nurses on 3rd shift for better coverage
      const thirdShift = Math.max(2, Math.floor(totalNurses * 0.25)); // 25% minimum, at least 2 nurses
      const remaining = totalNurses - thirdShift;
      const firstShift = Math.ceil(remaining / 2); // Slightly favor 1st shift
      const secondShift = remaining - firstShift;
      return { "1st": firstShift, "2nd": secondShift, "3rd": thirdShift };
    } else {
      // For larger teams, ensure adequate 3rd shift coverage
      const thirdShift = Math.max(2, Math.floor(totalNurses * 0.2)); // 20% minimum, at least 2 nurses
      const remaining = totalNurses - thirdShift;
      const firstShift = Math.ceil(remaining / 2); // Slightly favor 1st shift
      const secondShift = remaining - firstShift;
      return { "1st": firstShift, "2nd": secondShift, "3rd": thirdShift };
    }
  }

  // Balance nurse assignments to match optimal distribution
  balanceShiftDistribution(nursesByNextShift, targetDistribution) {
    const balanced = { "1st": [], "2nd": [], "3rd": [] };
    const shifts = ["1st", "2nd", "3rd"];
    
    // Start with the natural rotation assignments
    shifts.forEach(shift => {
      const availableNurses = [...nursesByNextShift[shift]];
      const targetCount = targetDistribution[shift];
      
      // Take nurses up to the target count
      balanced[shift] = availableNurses.splice(0, targetCount);
    });
    
    // Collect remaining unassigned nurses
    const unassigned = [];
    shifts.forEach(shift => {
      unassigned.push(...nursesByNextShift[shift].filter(nurse => 
        !balanced["1st"].includes(nurse) && 
        !balanced["2nd"].includes(nurse) && 
        !balanced["3rd"].includes(nurse)
      ));
    });
    
    // Distribute remaining nurses to meet target distribution
    shifts.forEach(shift => {
      const currentCount = balanced[shift].length;
      const targetCount = targetDistribution[shift];
      const needed = targetCount - currentCount;
      
      if (needed > 0 && unassigned.length > 0) {
        const nursesToAdd = unassigned.splice(0, Math.min(needed, unassigned.length));
        balanced[shift].push(...nursesToAdd);
      }
    });
    
    // If there are still unassigned nurses, distribute them to 1st and 2nd shifts
    let shiftIndex = 0;
    while (unassigned.length > 0) {
      const targetShift = shiftIndex % 2 === 0 ? "1st" : "2nd"; // Alternate between 1st and 2nd
      balanced[targetShift].push(unassigned.shift());
      shiftIndex++;
    }
    
    return balanced;
  }

  // Generate complete monthly schedule with rotation and balanced shift distribution
  generateMonthlySchedule(nurses, assignments, lastShiftRotation) {
    const updatedShiftRotation = { ...lastShiftRotation };
    
    // Calculate optimal shift distribution
    const totalNurses = nurses.length;
    const shiftDistribution = this.calculateOptimalShiftDistribution(totalNurses);
    
    // Check if this is a fresh generation (no existing assignments)
    const isFreshGeneration = assignments.length === 0 && Object.keys(lastShiftRotation).length === 0;
    
    // Group nurses by their next shift (after rotation)
    const nursesByNextShift = { "1st": [], "2nd": [], "3rd": [] };
    
    if (isFreshGeneration) {
      // 🎲 RANDOMIZATION: For fresh generation, randomly assign nurses to shifts
      console.log("🎲 Fresh generation detected - randomizing shift assignments!");
      
      // Shuffle nurses array for random distribution
      const shuffledNurses = [...nurses].sort(() => Math.random() - 0.5);
      const shifts = ["1st", "2nd", "3rd"];
      
      shuffledNurses.forEach((nurse, index) => {
        // Randomly select a shift, with bias towards maintaining balanced distribution
        const randomShift = shifts[index % shifts.length];
        nursesByNextShift[randomShift].push(nurse);
        updatedShiftRotation[nurse.id] = randomShift;
        console.log(`   ${nurse.user_fname} ${nurse.user_lname} → ${randomShift} shift (random)`);
      });
    } else {
      // Standard rotation for existing schedules
      nurses.forEach((nurse) => {
        const lastShift = this.getLastShiftForNurse(nurse.id, assignments, lastShiftRotation);
        const nextShift = this.getNextShift(lastShift);
        nursesByNextShift[nextShift].push(nurse);
        updatedShiftRotation[nurse.id] = nextShift;
      });
    }
    
    // Balance shifts according to optimal distribution
    const balancedNurseAssignments = this.balanceShiftDistribution(nursesByNextShift, shiftDistribution);
    
    // Distribute nurses across days to minimize daily overlap
    const monthlyAssignments = this.distributeNursesAcrossDays(balancedNurseAssignments);
    
    // Validate and fix coverage gaps
    const validatedAssignments = this.validateAndFixCoverage(monthlyAssignments);
    
    return {
      assignments: validatedAssignments,
      updatedShiftRotation
    };
  }

  // Helper function to split array into chunks
  splitIntoChunks(arr, n) {
    if (!arr || arr.length === 0) return Array.from({ length: n }, () => []);
    const res = Array.from({ length: n }, () => []);
    for (let i = 0; i < arr.length; i++) {
      res[i % n].push(arr[i]);
    }
    return res;
  }

  // Get effective nurse assignments for a day/shift, accounting for absences and temp reassignments
  async getEffectiveNurseAssignments(nursesOnShift, day, shift, tempReassignments, currentAssignments) {
    const effectiveNurses = [];
    const absentNurses = [];
    const today = new Date().toISOString().slice(0, 10);
    
    console.log(`\n%c🔍 Checking nurse absences for ${day} ${shift} (${today}):`, 'color: #FFD93D; font-weight: bold');
    
    for (const nurseId of nursesOnShift) {
      // Check if this nurse is absent using centralized nurse_cg_absence collection
      // FIX: Correct parameter order (userId, absenceDate, userType)
      const isAbsentToday = await checkUserAbsence(nurseId, today, "nurse");
      
      if (!isAbsentToday) {
        effectiveNurses.push(nurseId);
        console.log(`   ✅ ${nurseId} - Working`);
      } else {
        absentNurses.push(nurseId);
        console.log(`   ❌ ${nurseId} - ABSENT`);
      }
    }
    
    console.log(`\n%c📊 Summary:`, 'color: #4ECDC4; font-weight: bold');
    console.log(`   Total nurses on shift: ${nursesOnShift.length}`);
    console.log(`   Effective (working): ${effectiveNurses.length}`);
    console.log(`   Absent: ${absentNurses.length}`);
    
    return effectiveNurses;
  }

  // Get current effective elderly assignments accounting for temporary reassignments
  async getCurrentElderlyDistribution(day, shift, tempReassignments, existingElderlyAssignments, elderlyList = []) {
    const today = new Date().toISOString().slice(0, 10);
    const elderlyByNurse = {};
    
    // Start with base assignments
    existingElderlyAssignments
      .filter(ea => ea.day === day && ea.shift === shift)
      .forEach(ea => {
        if (!elderlyByNurse[ea.user_id]) {
          elderlyByNurse[ea.user_id] = new Set();
        }
        if (ea.elderly_ids) {
          // Filter out deceased elderly from existing assignments
          ea.elderly_ids
            .filter(elderlyId => {
              const elderly = elderlyList.find(e => e.id === elderlyId);
              return elderly && elderly.elderly_status !== "Deceased";
            })
            .forEach(elderlyId => elderlyByNurse[ea.user_id].add(elderlyId));
        }
      });
    
    // Apply temporary reassignments for today
    tempReassignments
      .filter(tr => tr.date === today && tr.day === day && tr.shift === shift)
      .forEach(tr => {
        // Remove from original nurse
        if (elderlyByNurse[tr.from_user_id]) {
          tr.elderly_ids.forEach(elderlyId => elderlyByNurse[tr.from_user_id].delete(elderlyId));
        }
        
        // Add to receiving nurse  
        if (!elderlyByNurse[tr.to_user_id]) {
          elderlyByNurse[tr.to_user_id] = new Set();
        }
        tr.elderly_ids.forEach(elderlyId => elderlyByNurse[tr.to_user_id].add(elderlyId));
      });
    
    // Convert Sets back to arrays
    const result = {};
    Object.keys(elderlyByNurse).forEach(nurseId => {
      result[nurseId] = Array.from(elderlyByNurse[nurseId]);
    });
    
    return result;
  }

  // Generate automatic elderly assignments - divide elderly in each house equally among nurses on the same shift
  // Now accounts for temporary reassignments due to nurse absences
  async generateElderlyAssignments(pendingAssignments, houses, elderlyList, nurses, tempReassignments = [], currentAssignments = [], existingElderlyAssignments = []) {
    const assignments = {};

    // Sort houses consistently (H001, H002, H003, H004, H005)
    const sortedHouses = houses.sort((a, b) => {
      const numA = parseInt(a.house_id.replace(/\D/g, ""), 10);
      const numB = parseInt(b.house_id.replace(/\D/g, ""), 10);
      return numA - numB;
    });

    for (const day of NurseScheduleService.DAYS_OF_WEEK) {
      // Group nurses by shift for this day
      const nursesByShift = {
        "1st": [],
        "2nd": [],
        "3rd": []
      };
      
      Object.entries(pendingAssignments).forEach(([nurseId, dayToShift]) => {
        const shift = dayToShift[day];
        if (shift && shift !== "rest") {
          nursesByShift[shift].push(nurseId);
        }
      });

      // Process each shift separately (including 3rd shift)
      for (const shift of ["1st", "2nd", "3rd"]) {
        const nursesOnShift = nursesByShift[shift];
        
        if (nursesOnShift.length === 0) continue;

        // Get effective nurses (excluding absent ones)
        const effectiveNurses = await this.getEffectiveNurseAssignments(
          nursesOnShift, day, shift, tempReassignments, currentAssignments
        );

        console.log(`📅 ${day} ${shift} shift: ${nursesOnShift.length} total nurses, ${effectiveNurses.length} effective (non-absent)`);

        if (effectiveNurses.length === 0) {
          // All nurses are absent - skip this day/shift
          console.log(`%c⚠️  All nurses absent for ${day} ${shift} - skipping`, 'color: #FF6B6B');
          nursesOnShift.forEach(nurseId => {
            if (!assignments[nurseId]) assignments[nurseId] = {};
            assignments[nurseId][day] = [];
          });
          continue;
        }

        // Sort effective nurses alphabetically for consistent assignment  
        effectiveNurses.sort((a, b) => {
          const nameA = this.getNurseName(a, nurses).toLowerCase();
          const nameB = this.getNurseName(b, nurses).toLowerCase();
          return nameA.localeCompare(nameB);
        });

        // Initialize assignments for all nurses on this shift
        nursesOnShift.forEach(nurseId => {
          if (!assignments[nurseId]) assignments[nurseId] = {};
          assignments[nurseId][day] = [];
        });

        // Check if we're adding new nurses to existing assignments OR if there are absences to handle
        const hasExistingAssignments = existingElderlyAssignments.some(
          ea => ea.day === day && ea.shift === shift
        );

        if (hasExistingAssignments) {
          console.log(`\n%c┌────────────────────────────────────────────────────────┐`, 'color: #4ECDC4; font-weight: bold');
          console.log(`%c│ 🔄 REDISTRIBUTION MODE: ${day} ${shift}                │`, 'color: #4ECDC4; font-weight: bold');
          console.log(`%c└────────────────────────────────────────────────────────┘`, 'color: #4ECDC4; font-weight: bold');
          
          // Get current effective distribution (accounting for temp reassignments if any)
          const currentDistribution = await this.getCurrentElderlyDistribution(
            day, shift, tempReassignments, existingElderlyAssignments, elderlyList
          );
          
          console.log(`\n%c📊 Current Distribution (before redistribution):`, 'color: #FFD93D; font-weight: bold');
          Object.keys(currentDistribution).forEach(nurseId => {
            const count = currentDistribution[nurseId]?.length || 0;
            console.log(`   ${this.getNurseName(nurseId, nurses)}: ${count} elderly`, currentDistribution[nurseId]);
          });
          
          // Collect all elderly currently being handled
          const allElderlyBeingHandled = new Set();
          Object.values(currentDistribution).forEach(elderlyIds => {
            elderlyIds.forEach(elderlyId => allElderlyBeingHandled.add(elderlyId));
          });
          
          console.log(`\n%c🏠 Collecting ALL elderly from houses (to catch any missed):`, 'color: #6BCB77; font-weight: bold');
          sortedHouses.forEach(house => {
            const elderlyInHouse = elderlyList
              .filter(elderly => elderly.house_id === house.house_id && elderly.elderly_status !== "Deceased")
              .map(elderly => elderly.id);
            console.log(`   ${house.house_name}: ${elderlyInHouse.length} elderly`);
            elderlyInHouse.forEach(elderlyId => allElderlyBeingHandled.add(elderlyId));
          });
          
          // Redistribute among ALL effective nurses (including new ones)
          const allElderlyArray = Array.from(allElderlyBeingHandled);
          
          console.log(`\n%c👥 TOTAL ELDERLY TO REDISTRIBUTE: ${allElderlyArray.length}`, 'color: #F38181; font-weight: bold; font-size: 15px');
          console.log(`%c👨‍⚕️ EFFECTIVE NURSES (non-absent): ${effectiveNurses.length}`, 'color: #F38181; font-weight: bold; font-size: 15px');
          effectiveNurses.forEach((nurseId, idx) => {
            console.log(`   [${idx + 1}] ${this.getNurseName(nurseId, nurses)}`);
          });
          
          // Sort alphabetically for consistent assignment
          const sortedElderly = allElderlyArray.sort((a, b) => {
            const elderlyA = elderlyList.find(e => e.id === a);
            const elderlyB = elderlyList.find(e => e.id === b);
            const nameA = elderlyA ? `${elderlyA.elderly_fname} ${elderlyA.elderly_lname}`.toLowerCase() : '';
            const nameB = elderlyB ? `${elderlyB.elderly_fname} ${elderlyB.elderly_lname}`.toLowerCase() : '';
            return nameA.localeCompare(nameB);
          });
          
          if (sortedElderly.length > 0) {
            const elderlyChunks = this.splitIntoChunks(sortedElderly, effectiveNurses.length);
            
            console.log(`\n%c✅ NEW DISTRIBUTION:`, 'color: #95E1D3; font-weight: bold; font-size: 14px');
            effectiveNurses.forEach((nurseId, index) => {
              const elderlyChunk = elderlyChunks[index] || [];
              assignments[nurseId][day] = elderlyChunk;
              console.log(`   [${index + 1}] ${this.getNurseName(nurseId, nurses)}: ${elderlyChunk.length} elderly`, elderlyChunk);
            });
            
            // Verify total
            const totalAssigned = elderlyChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            console.log(`\n%c🔍 VERIFICATION:`, 'color: #FFD93D; font-weight: bold');
            console.log(`   Total elderly to distribute: ${sortedElderly.length}`);
            console.log(`   Total elderly assigned: ${totalAssigned}`);
            console.log(`   ${totalAssigned === sortedElderly.length ? '✅ MATCH!' : '❌ MISMATCH!'}`);
            
            console.log(`\n%c✅ Redistributed ${sortedElderly.length} elderly among ${effectiveNurses.length} effective nurses`, 'color: #95E1D3; font-weight: bold');
          }
        } else {
          // Standard assignment - collect ALL elderly from ALL houses
          console.log(`\n%c┌────────────────────────────────────────────────────────┐`, 'color: #6BCB77; font-weight: bold');
          console.log(`%c│ 📝 STANDARD ASSIGNMENT: ${day} ${shift}                 │`, 'color: #6BCB77; font-weight: bold');
          console.log(`%c└────────────────────────────────────────────────────────┘`, 'color: #6BCB77; font-weight: bold');
          
          const allElderlyForShift = [];
          
          console.log(`\n%c🏠 Collecting elderly from all houses:`, 'color: #FFD93D; font-weight: bold');
          sortedHouses.forEach(house => {
            const elderlyInHouse = elderlyList
              .filter(elderly => elderly.house_id === house.house_id && elderly.elderly_status !== "Deceased")
              .map(elderly => elderly.id);
            console.log(`   ${house.house_name}: ${elderlyInHouse.length} elderly`);
            allElderlyForShift.push(...elderlyInHouse);
          });

          console.log(`\n%c👥 Total elderly for ${shift} shift: ${allElderlyForShift.length}`, 'color: #4ECDC4; font-weight: bold');

          // Sort all elderly alphabetically for consistent assignment
          const sortedAllElderly = allElderlyForShift.sort((a, b) => {
            const elderlyA = elderlyList.find(e => e.id === a);
            const elderlyB = elderlyList.find(e => e.id === b);
            const nameA = elderlyA ? `${elderlyA.elderly_fname} ${elderlyA.elderly_lname}`.toLowerCase() : '';
            const nameB = elderlyB ? `${elderlyB.elderly_fname} ${elderlyB.elderly_lname}`.toLowerCase() : '';
            return nameA.localeCompare(nameB);
          });

          if (sortedAllElderly.length > 0) {
            const elderlyChunks = this.splitIntoChunks(sortedAllElderly, effectiveNurses.length);
            
            console.log(`\n%c✅ DISTRIBUTION:`, 'color: #95E1D3; font-weight: bold');
            effectiveNurses.forEach((nurseId, index) => {
              const elderlyChunk = elderlyChunks[index] || [];
              assignments[nurseId][day] = elderlyChunk;
              console.log(`   [${index + 1}] ${this.getNurseName(nurseId, nurses)}: ${elderlyChunk.length} elderly`);
            });
          }
        }
      }
    }

    return assignments;
  }

  // Group elderly by house for better display
  groupElderlyByHouse(elderlyIds, elderlyList) {
    const grouped = {};
    elderlyIds.forEach(elderlyId => {
      const elderly = elderlyList.find(e => e.id === elderlyId);
      if (elderly) {
        const houseId = elderly.house_id;
        if (!grouped[houseId]) grouped[houseId] = [];
        grouped[houseId].push(elderly);
      }
    });
    
    // Sort houses and elderly within each house
    const sortedGrouped = {};
    Object.keys(grouped).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ""), 10);
      const numB = parseInt(b.replace(/\D/g, ""), 10);
      return numA - numB;
    }).forEach(houseId => {
      sortedGrouped[houseId] = grouped[houseId].sort((a, b) => {
        const nameA = `${a.elderly_fname} ${a.elderly_lname}`.toLowerCase();
        const nameB = `${b.elderly_fname} ${b.elderly_lname}`.toLowerCase();
        return nameA.localeCompare(nameB);
      });
    });
    
    return sortedGrouped;
  }

  // Initialize pending assignments when entering edit mode
  initializePendingAssignments(nurses, assignments) {
    const initShifts = {};
    nurses.forEach((n) => {
      const current = assignments.filter((a) => a.user_id === n.id);
      const dayToShift = {};
      current.forEach((a) => {
        a.days_assigned.forEach((day) => {
          dayToShift[day] = a.shift;
        });
      });
      initShifts[n.id] = dayToShift;
    });
    return initShifts;
  }

  // Check for schedule expiration
  checkScheduleExpiration(assignments) {
    if (assignments.length === 0) return false;
    
    // Check if any assignment has schedule_period information
    const latestAssignment = assignments.find(a => a.schedule_period && a.schedule_period.end_date);
    if (!latestAssignment) return false;
    
    const endDate = new Date(latestAssignment.schedule_period.end_date.seconds * 1000);
    const now = new Date();
    
    // If schedule has expired, return true
    return now >= endDate;
  }

  // Detect new nurses not yet in the scheduling system
  detectNewNurses(nurses, assignments) {
    // Use scheduleStatus for more reliable detection
    const newNurses = nurses.filter(nurse => 
      nurse.scheduleStatus === "pending_integration" &&
      nurse.user_activation !== false // Exclude resigned nurses
    );
    
    return newNurses;
  }

  // Update nurse schedule status
  async updateNurseScheduleStatus(nurseId, status, integrationDate = null) {
    try {
      const updateData = { scheduleStatus: status };
      if (integrationDate) {
        updateData.integrationDate = integrationDate;
      }
      
      await updateDoc(doc(this.db, "users", nurseId), updateData);
      return { success: true };
    } catch (error) {
      console.error("Error updating nurse schedule status:", error);
      throw new Error("Failed to update nurse schedule status");
    }
  }

  // Copy schedule from an existing nurse to a new nurse
  copyScheduleFromNurse(fromNurseId, toNurseId, assignments) {
    const sourceAssignment = assignments.find(a => a.user_id === fromNurseId);
    if (!sourceAssignment || !sourceAssignment.days_assigned) {
      return {};
    }

    const copiedSchedule = {};
    NurseScheduleService.DAYS_OF_WEEK.forEach(day => {
      if (sourceAssignment.days_assigned.includes(day)) {
        copiedSchedule[day] = sourceAssignment.shift;
      } else {
        copiedSchedule[day] = "rest";
      }
    });

    return copiedSchedule;
  }

  // Assign specific shift to all working days for a new nurse
  assignShiftToAllDays(shift) {
    const schedule = {};
    NurseScheduleService.DAYS_OF_WEEK.forEach(day => {
      schedule[day] = shift;
    });
    return schedule;
  }

  // Create a balanced 5-day work schedule for a new nurse
  createBalancedSchedule(shift, startDay = 0) {
    const schedule = {};
    NurseScheduleService.DAYS_OF_WEEK.forEach((day, index) => {
      const dayIndex = (index + startDay) % 7;
      // Work 5 days, rest 2 days
      schedule[NurseScheduleService.DAYS_OF_WEEK[dayIndex]] = index < 5 ? shift : "rest";
    });
    return schedule;
  }

  // Clear all nurse schedules from Firestore (preserves caregiver schedules)
  async clearAllSchedules(assignments, nurseElderlyAssignments, nurses) {
    console.log("🚀 Starting clearAllSchedules operation (NURSE ONLY - caregiver data will be preserved)...");
    
    try {
      const batch = writeBatch(this.db);
      const nurseIds = nurses.map(n => n.id);
      
      console.log(`📋 Target nurses for clearing: ${nurseIds.length} nurses (caregivers will NOT be affected)`, nurseIds);
      
      // Query and delete ONLY nurse shift assignments from house_shift_assignments (unified collection)
      console.log("🔍 Querying house_shift_assignments collection for nurses...");
      const shiftQuery = query(
        collection(this.db, "house_shift_assignments"),
        where("user_type", "==", "nurse")
      );
      const shiftSnapshot = await getDocs(shiftQuery);
      
      console.log(`📊 Found ${shiftSnapshot.docs.length} nurse documents in house_shift_assignments`);
      
      let shiftDeleteCount = 0;
      shiftSnapshot.docs.forEach(docRef => {
        batch.delete(docRef.ref);
        shiftDeleteCount++;
        console.log(`�️  Deleting nurse shift assignment: ${docRef.id}`);
      });

      // Query and delete ONLY nurse elderly assignments from elderly_assignments
      console.log("🔍 Querying elderly_assignments collection for nurses...");
      const elderlyQuery = query(
        collection(this.db, "elderly_assignments"),
        where("user_type", "==", "nurse")
      );
      const elderlySnapshot = await getDocs(elderlyQuery);
      
      console.log(`📊 Found ${elderlySnapshot.docs.length} nurse documents in elderly_assignments`);
      
      let elderlyDeleteCount = 0;
      elderlySnapshot.docs.forEach(docRef => {
        batch.delete(docRef.ref);
        elderlyDeleteCount++;
        console.log(`�️  Deleting nurse elderly assignment: ${docRef.id}`);
      });

      // Query and delete ALL temporary reassignments from temporary_assignments
      console.log("🔍 Querying temporary_assignments collection...");
      const tempReassignQuery = query(collection(this.db, "temporary_assignments"));
      const tempReassignSnapshot = await getDocs(tempReassignQuery);

      console.log(`� Found ${tempReassignSnapshot.docs.length} total documents in temporary_assignments`);

      let tempReassignDeleteCount = 0;
      const nurseIdsSet = new Set(nurses.map(n => n.id));
      tempReassignSnapshot.docs.forEach(docRef => {
        const data = docRef.data();
        // Delete temp reassignments involving any of our nurses (either from or to)
        if (nurseIdsSet.has(data.from_user_id) || nurseIdsSet.has(data.to_user_id)) {
          batch.delete(docRef.ref);
          tempReassignDeleteCount++;
          console.log(`�️  Deleting nurse temp reassignment: ${docRef.id} (from: ${data.from_user_id}, to: ${data.to_user_id})`);
        }
      });

      // Query and delete ONLY nurse absence records from nurse_cg_absence
      console.log("🔍 Querying nurse_cg_absence collection for nurses...");
      const absenceQuery = query(
        collection(this.db, "nurse_cg_absence"),
        where("user_type", "==", "nurse")
      );
      const absenceSnapshot = await getDocs(absenceQuery);
      
      console.log(`📊 Found ${absenceSnapshot.docs.length} nurse documents in nurse_cg_absence`);
      
      let absenceDeleteCount = 0;
      absenceSnapshot.docs.forEach(docRef => {
        batch.delete(docRef.ref);
        absenceDeleteCount++;
        console.log(`�️  Deleting nurse absence: ${docRef.id}`);
      });

      console.log(`🗑️ About to delete ${shiftDeleteCount} NURSE shift assignments, ${elderlyDeleteCount} NURSE elderly assignments, ${tempReassignDeleteCount} NURSE temporary reassignments, and ${absenceDeleteCount} NURSE absence records (caregiver data preserved)`);
      
      await batch.commit();
      
      console.log(`✅ Successfully cleared ${shiftDeleteCount} shift assignments, ${elderlyDeleteCount} elderly assignments, ${tempReassignDeleteCount} temporary reassignments, and ${absenceDeleteCount} absence records for ${nurseIds.length} nurses (CAREGIVER DATA PRESERVED)`);
      
      return {
        success: true,
        shiftDeleteCount,
        elderlyDeleteCount,
        tempReassignDeleteCount,
        absenceDeleteCount,
        nurseCount: nurseIds.length
      };
      
    } catch (error) {
      console.error("❌ Error in clearAllSchedules:", error);
      console.error("Error details:", {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      throw error;
    }
  }

  // Save all nurse schedules and elderly assignments
  async saveAllSchedules(
    pendingAssignments, 
    nurses, 
    elderlyList, 
    houses,
    periodDuration = 30
  ) {
    const batch = writeBatch(this.db);

    // Get current temporary reassignments and existing assignments for proper redistribution
    const today = new Date().toISOString().slice(0, 10);
    const tempReassignments = await this.getCurrentTempReassignments(today);
    const currentAssignments = await this.getCurrentNurseAssignments();
    const existingElderlyAssignments = await this.getCurrentElderlyAssignments();
    
    // 🔄 Clear existing temporary reassignments when integrating new nurses
    // This prevents old temp assignments from persisting after redistribution
    console.log("🧹 Clearing existing temporary reassignments for redistribution...");
    const tempReassignQuery = query(
      collection(this.db, "temporary_assignments"),
      where("date", "==", today),
      where("user_type", "==", "nurse")
    );
    const tempReassignSnapshot = await getDocs(tempReassignQuery);
    
    tempReassignSnapshot.forEach(doc => {
      batch.delete(doc.ref);
      console.log(`🗑️ Removed temporary reassignment: ${doc.id}`);
    });
    
    // Generate automated elderly assignments with NO temporary reassignments
    // (we just cleared them, so redistribution starts fresh)
    const elderlyAssignments = await this.generateElderlyAssignments(
      pendingAssignments, 
      houses, 
      elderlyList, 
      nurses,
      [], // Empty array - no temp reassignments after clearing
      currentAssignments,
      existingElderlyAssignments
    );

    // Update nurse status to "active" for nurses being integrated
    const nursesToUpdate = Object.keys(pendingAssignments);
    const statusUpdatePromises = nursesToUpdate.map(async (nurseId) => {
      const nurse = nurses.find(n => n.id === nurseId);
      if (nurse && nurse.scheduleStatus === "pending_integration") {
        await this.updateNurseScheduleStatus(nurseId, "active", new Date());
      }
    });

    // Save shift assignments
    for (const nurseId of Object.keys(pendingAssignments)) {
      const dayToShift = pendingAssignments[nurseId];

      // Group by shift
      const byShift = {};
      Object.entries(dayToShift).forEach(([day, shift]) => {
        if (shift !== "rest") {
          if (!byShift[shift]) byShift[shift] = [];
          byShift[shift].push(day);
        }
      });

      // Create/update docs
      for (const [shift, days] of Object.entries(byShift)) {
        const docId = `${nurseId}_${shift}`;
        const ref = doc(this.db, "house_shift_assignments", docId);
        const shiftDef = NurseScheduleService.SHIFT_DEFS.find((s) => s.key === shift);
        const payload = {
          user_id: nurseId,
          user_type: "nurse",
          assignment_type: "manual_schedule",
          created_at: new Date(),
          days_assigned: days,
          schedule_period: {
            auto_generated: false,
            duration_days: periodDuration,
            start_date: new Date(),
            end_date: new Date(Date.now() + (periodDuration * 24 * 60 * 60 * 1000))
          },
          shift,
          shift_name: shiftDef?.name || "",
          start_time: shiftDef?.startTime || "",
          end_time: shiftDef?.endTime || "",
          is_current: true,
          status: "active",
          version: await this.getNextVersion()
        };
        batch.set(ref, payload, { merge: true });
      }
    }

    // Save automated elderly assignments (for all shifts including 3rd shift)
    for (const nurseId of Object.keys(elderlyAssignments)) {
      const dayToElderly = elderlyAssignments[nurseId] || {};
      
      for (const [day, elderlyIds] of Object.entries(dayToElderly)) {
        if (elderlyIds && elderlyIds.length > 0) {
          // Check if nurse is working any shift on this day (1st, 2nd, or 3rd)
          const nurseShift = pendingAssignments[nurseId]?.[day];
          if (nurseShift === "1st" || nurseShift === "2nd" || nurseShift === "3rd") {
            const docId = `${nurseId}_${day}`;
            const ref = doc(this.db, "elderly_assignments", docId);
            
            // Get nurse details for the new schema
            const nurse = nurses.find(n => n.id === nurseId);
            const housesForElderly = [...new Set(elderlyIds.map(elderlyId => this.getHouseForElderly(elderlyId, elderlyList)).filter(Boolean))];
            
            const payload = {
              assignment_type: "automated_house_based_assignment",
              user_id: nurseId,
              user_type: "nurse",
              user_fname: nurse?.user_fname || "",
              user_lname: nurse?.user_lname || "", 
              assign_version: 1,
              assigned_at: new Date(),
              day,
              elderly_ids: elderlyIds,
              house_id: housesForElderly,
              shift: nurseShift,
              is_current: true,
              status: "active"
            };
            batch.set(ref, payload, { merge: true });
          }
        }
      }
    }

    await batch.commit();
    
    // Update nurse statuses after successful save
    await Promise.all(statusUpdatePromises);
  }

  // Generate and save complete schedule with auto-generated assignments
  async generateAndSaveSchedule(
    nurses, 
    assignments, 
    nurseElderlyAssignments, 
    lastShiftRotation, 
    elderlyList, 
    houses,
    periodDuration = 30
  ) {
    const batch = writeBatch(this.db);
    
    // Clear existing assignments first
    assignments.forEach((a) => {
      if (nurses.some((n) => n.id === a.user_id)) {
        batch.delete(doc(this.db, "house_shift_assignments", a.id));
      }
    });
    
    nurseElderlyAssignments.forEach((a) => {
      if (nurses.some((n) => n.id === a.user_id)) {
        batch.delete(doc(this.db, "elderly_assignments", a.id));
      }
    });
    
    // Generate new monthly schedule
    const { assignments: monthlyAssignments, updatedShiftRotation } = this.generateMonthlySchedule(
      nurses, 
      assignments, 
      lastShiftRotation
    );
    
    // Save new shift assignments
    for (const nurseId of Object.keys(monthlyAssignments)) {
      const dayToShift = monthlyAssignments[nurseId];
      
      // Group by shift
      const byShift = {};
      Object.entries(dayToShift).forEach(([day, shift]) => {
        if (shift !== "rest") {
          if (!byShift[shift]) byShift[shift] = [];
          byShift[shift].push(day);
        }
      });
      
      // Create shift assignment documents
      for (const [shift, days] of Object.entries(byShift)) {
        const docId = `${nurseId}_${shift}`;
        const ref = doc(this.db, "house_shift_assignments", docId);
        const shiftDef = NurseScheduleService.SHIFT_DEFS.find((s) => s.key === shift);
        const payload = {
          user_id: nurseId,
          user_type: "nurse",
          assignment_type: "auto_generated_schedule",
          created_at: new Date(),
          days_assigned: days,
          schedule_period: {
            auto_generated: true,
            duration_days: periodDuration,
            start_date: new Date(),
            end_date: new Date(Date.now() + (periodDuration * 24 * 60 * 60 * 1000))
          },
          shift,
          shift_name: shiftDef?.name || "",
          start_time: shiftDef?.startTime || "",
          end_time: shiftDef?.endTime || "",
          is_current: true,
          status: "active",
          version: await this.getNextVersion()
        };
        batch.set(ref, payload, { merge: true });
      }
    }
    
    // Commit shift assignments first
    await batch.commit();
    
    // Generate and save elderly assignments after shift assignments are saved
    const elderlyBatch = writeBatch(this.db);
    // For auto-generation, no existing temp reassignments or assignments to consider
    const elderlyAssignments = await this.generateElderlyAssignments(
      monthlyAssignments, 
      houses, 
      elderlyList, 
      nurses,
      [], // no temp reassignments for new schedule
      [], // no current assignments for new schedule  
      []  // no existing elderly assignments for new schedule
    );
    
    for (const nurseId of Object.keys(elderlyAssignments)) {
      const dayToElderly = elderlyAssignments[nurseId] || {};
      
      for (const [day, elderlyIds] of Object.entries(dayToElderly)) {
        if (elderlyIds && elderlyIds.length > 0) {
          const nurseShift = monthlyAssignments[nurseId]?.[day];
          if (nurseShift === "1st" || nurseShift === "2nd" || nurseShift === "3rd") {
            const docId = `${nurseId}_${day}`;
            const ref = doc(this.db, "elderly_assignments", docId);
            
            // Get nurse details for the new schema
            const nurse = nurses.find(n => n.id === nurseId);
            const housesForElderly = [...new Set(elderlyIds.map(elderlyId => this.getHouseForElderly(elderlyId, elderlyList)).filter(Boolean))];
            
            const payload = {
              assignment_type: "automated_house_based_assignment",
              user_id: nurseId,
              user_type: "nurse",
              user_fname: nurse?.user_fname || "",
              user_lname: nurse?.user_lname || "",
              assign_version: 1,
              assigned_at: new Date(),
              day,
              elderly_ids: elderlyIds,
              house_id: housesForElderly,
              shift: nurseShift,
              is_current: true,
              status: "active"
            };
            elderlyBatch.set(ref, payload, { merge: true });
          }
        }
      }
    }
    
    await elderlyBatch.commit();
    
    // Update nurse statuses to "active" for all nurses in the generated schedule
    const statusUpdatePromises = nurses.map(async (nurse) => {
      if (nurse.scheduleStatus === "pending_integration") {
        await this.updateNurseScheduleStatus(nurse.id, "active", new Date());
      }
    });
    await Promise.all(statusUpdatePromises);
    
    // Calculate statistics for feedback
    const statistics = this.calculateScheduleStatistics(monthlyAssignments);
    
    return {
      monthlyAssignments,
      updatedShiftRotation,
      statistics
    };
  }

  // Calculate schedule statistics for user feedback
  calculateScheduleStatistics(monthlyAssignments) {
    const shiftCounts = { "1st": 0, "2nd": 0, "3rd": 0 };
    const dailyCounts = { "Sunday": 0, "Monday": 0, "Tuesday": 0, "Wednesday": 0, "Thursday": 0, "Friday": 0, "Saturday": 0 };
    const restCounts = { "Sunday": 0, "Monday": 0, "Tuesday": 0, "Wednesday": 0, "Thursday": 0, "Friday": 0, "Saturday": 0 };
    
    Object.values(monthlyAssignments).forEach(nurseSchedule => {
      Object.entries(nurseSchedule).forEach(([day, shift]) => {
        if (shift !== "rest") {
          shiftCounts[shift] = (shiftCounts[shift] || 0) + 1;
          dailyCounts[day] = (dailyCounts[day] || 0) + 1;
        } else {
          restCounts[day] = (restCounts[day] || 0) + 1;
        }
      });
    });
    
    // Since each nurse works 5 days, divide by 5 to get actual nurse count per shift
    Object.keys(shiftCounts).forEach(shift => {
      shiftCounts[shift] = shiftCounts[shift] / 5;
    });
    
    // Calculate distribution ranges
    const dailyValues = Object.values(dailyCounts);
    const restValues = Object.values(restCounts);
    const minDaily = Math.min(...dailyValues);
    const maxDaily = Math.max(...dailyValues);
    const minRest = Math.min(...restValues);
    const maxRest = Math.max(...restValues);
    
    return {
      shiftCounts,
      dailyCounts,
      restCounts,
      minDaily,
      maxDaily,
      minRest,
      maxRest
    };
  }

  // Mobile app integration helper methods
  
  // Update sync status for mobile app integration 
  async updateSyncStatus(collectionName, docId, status, lastSyncDate = null) {
    try {
      const updateData = {
        sync_status: status, // "pending_sync", "synced", "sync_failed"
        last_modified_at: new Date()
      };
      
      if (lastSyncDate) {
        updateData.last_sync_date = lastSyncDate;
      }
      
      await updateDoc(doc(this.db, collectionName, docId), updateData);
      return { success: true };
    } catch (error) {
      console.error("Error updating sync status:", error);
      return { success: false, error: error.message };
    }
  }

  // Get assignments pending sync for mobile app
  async getAssignmentsPendingSync(collectionName = "house_shift_assignments") {
    try {
      const q = query(
        collection(this.db, collectionName),
        where("user_type", "==", "nurse"),
        where("sync_status", "==", "pending_sync")
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error("Error getting assignments pending sync:", error);
      return [];
    }
  }

  // Batch update sync status for multiple documents
  async batchUpdateSyncStatus(updates) {
    try {
      const batch = writeBatch(this.db);
      
      updates.forEach(update => {
        const { collectionName, docId, status, lastSyncDate } = update;
        const docRef = doc(this.db, collectionName, docId);
        const updateData = {
          sync_status: status,
          last_modified_at: new Date()
        };
        
        if (lastSyncDate) {
          updateData.last_sync_date = lastSyncDate;
        }
        
        batch.update(docRef, updateData);
      });
      
      await batch.commit();
      return { success: true, updatedCount: updates.length };
    } catch (error) {
      console.error("Error batch updating sync status:", error);
      return { success: false, error: error.message };
    }
  }

  // Get mobile app compatible data format
  getMobileAppFormat(assignment) {
    return {
      id: assignment.id,
      user_id: assignment.user_id,
      user_type: assignment.user_type,
      nurse_id: assignment.user_id, // Keep backward compatibility
      shift: assignment.shift,
      shift_name: assignment.shift_name,
      start_time: assignment.start_time,
      end_time: assignment.end_time,
      days_assigned: assignment.days_assigned,
      assignment_type: assignment.assignment_type || "regular_schedule",
      status: assignment.status || "active",
      created_at: assignment.created_at,
      schedule_period: assignment.schedule_period,
      version: assignment.version,
      is_current: assignment.is_current
    };
  }

  // Helper method to get next version number
  async getNextVersion() {
    try {
      const snapshot = await getDocs(query(
        collection(this.db, "house_shift_assignments"),
        where("user_type", "==", "nurse")
      ));
      
      if (snapshot.empty) return 1;
      
      const versions = snapshot.docs
        .map(doc => doc.data().version || 0)
        .filter(version => typeof version === 'number');
      
      return Math.max(...versions, 0) + 1;
    } catch (error) {
      console.error("Error getting next version:", error);
      return 1;
    }
  }

  // Helper methods for getting current assignments and temporary reassignments
  async getCurrentTempReassignments(dateStr) {
    try {
      const q = query(
        collection(this.db, "temporary_assignments"),
        where("date", "==", dateStr)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error("Error getting current temp reassignments:", error);
      return [];
    }
  }

  async getCurrentNurseAssignments() {
    try {
      const q = query(
        collection(this.db, "house_shift_assignments"),
        where("is_current", "==", true),
        where("user_type", "==", "nurse")
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error("Error getting current nurse assignments:", error);
      return [];
    }
  }

  async getCurrentElderlyAssignments() {
    try {
      const snapshot = await getDocs(collection(this.db, "elderly_assignments"));
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error("Error getting current elderly assignments:", error);
      return [];
    }
  }
}