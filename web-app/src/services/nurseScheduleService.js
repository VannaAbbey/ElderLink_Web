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
  async loadNurses() {
    const nurseSnap = await getDocs(query(
      collection(this.db, "users"), 
      where("user_type", "==", "nurse")
    ));
    return nurseSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(nurse => nurse.scheduleStatus !== "inactive"); // Exclude inactive nurses
  }

  async loadHouses() {
    const houseSnap = await getDocs(collection(this.db, "house"));
    return houseSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async loadElderly() {
    const elderlySnap = await getDocs(collection(this.db, "elderly"));
    return elderlySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async loadAllData() {
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
      collection(this.db, "nurse_shift_assign"),
      where("is_current", "==", true)
    );
    return onSnapshot(q, (snap) => {
      const assignments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(assignments);
    });
  }

  subscribeToNurseElderlyAssignments(callback) {
    const q = query(collection(this.db, "nurse_elderly_assign"));
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
      (a) => a.nurse_id === nurseId && a.day === day
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
    const currentAssignments = assignments.filter(a => a.nurse_id === nurseId);
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
        }
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
    
    // Group nurses by their next shift (after rotation)
    const nursesByNextShift = { "1st": [], "2nd": [], "3rd": [] };
    
    nurses.forEach((nurse) => {
      const lastShift = this.getLastShiftForNurse(nurse.id, assignments, lastShiftRotation);
      const nextShift = this.getNextShift(lastShift);
      nursesByNextShift[nextShift].push(nurse);
      updatedShiftRotation[nurse.id] = nextShift;
    });
    
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

  // Generate automatic elderly assignments - divide elderly in each house equally among nurses on the same shift
  generateElderlyAssignments(pendingAssignments, houses, elderlyList, nurses) {
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

      // Process each shift separately
      ["1st", "2nd"].forEach(shift => {
        const nursesOnShift = nursesByShift[shift];
        
        if (nursesOnShift.length === 0) return;

        // Sort nurses alphabetically for consistent assignment
        nursesOnShift.sort((a, b) => {
          const nameA = this.getNurseName(a, nurses).toLowerCase();
          const nameB = this.getNurseName(b, nurses).toLowerCase();
          return nameA.localeCompare(nameB);
        });

        // Initialize assignments for all nurses on this shift
        nursesOnShift.forEach(nurseId => {
          if (!assignments[nurseId]) assignments[nurseId] = {};
          assignments[nurseId][day] = [];
        });

        // Collect ALL elderly from ALL houses first, then divide among nurses
        const allElderlyForShift = [];
        
        sortedHouses.forEach(house => {
          // Get all elderly in this house - nurses check vital signs for ALL elderly regardless of caregiver assignments
          const elderlyInHouse = elderlyList
            .filter(elderly => elderly.house_id === house.house_id)
            .map(elderly => elderly.id);

          // Add to the master list
          allElderlyForShift.push(...elderlyInHouse);
        });

        // Sort all elderly alphabetically for consistent assignment
        const sortedAllElderly = allElderlyForShift.sort((a, b) => {
          const elderlyA = elderlyList.find(e => e.id === a);
          const elderlyB = elderlyList.find(e => e.id === b);
          const nameA = elderlyA ? `${elderlyA.elderly_fname} ${elderlyA.elderly_lname}`.toLowerCase() : '';
          const nameB = elderlyB ? `${elderlyB.elderly_fname} ${elderlyB.elderly_lname}`.toLowerCase() : '';
          return nameA.localeCompare(nameB);
        });

        // Divide ALL elderly equally among nurses on this shift (once per day, not per house)
        if (sortedAllElderly.length > 0) {
          const elderlyChunks = this.splitIntoChunks(sortedAllElderly, nursesOnShift.length);
          
          nursesOnShift.forEach((nurseId, index) => {
            const elderlyChunk = elderlyChunks[index] || [];
            assignments[nurseId][day] = elderlyChunk; // Assign directly, don't push
          });
        }
      });

      // For 3rd shift, no elderly assignments (no vital signs during overnight)
      nursesByShift["3rd"].forEach(nurseId => {
        if (!assignments[nurseId]) assignments[nurseId] = {};
        assignments[nurseId][day] = [];
      });
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
      const current = assignments.filter((a) => a.nurse_id === n.id);
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
    const sourceAssignment = assignments.find(a => a.nurse_id === fromNurseId);
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

  // Clear all nurse schedules from Firestore
  async clearAllSchedules(assignments, nurseElderlyAssignments, nurses) {
    console.log("🚀 Starting clearAllSchedules operation...");
    
    try {
      const batch = writeBatch(this.db);
      const nurseIds = nurses.map(n => n.id);
      
      console.log(`📋 Target nurses for clearing: ${nurseIds.length} nurses`, nurseIds);
      
      // Query and delete ALL shift assignments from nurse_shift_assign (including duplicates)
      console.log("🔍 Querying nurse_shift_assign collection...");
      const shiftQuery = query(collection(this.db, "nurse_shift_assign"));
      const shiftSnapshot = await getDocs(shiftQuery);
      
      console.log(`📊 Found ${shiftSnapshot.docs.length} total documents in nurse_shift_assign`);
      
      let shiftDeleteCount = 0;
      shiftSnapshot.docs.forEach(docRef => {
        const data = docRef.data();
        if (nurseIds.includes(data.nurse_id)) {
          batch.delete(docRef.ref);
          shiftDeleteCount++;
          console.log(`📝 Marking for deletion: ${docRef.id} (nurse: ${data.nurse_id})`);
        }
      });

      // Query and delete ALL elderly assignments from nurse_elderly_assign
      console.log("🔍 Querying nurse_elderly_assign collection...");
      const elderlyQuery = query(collection(this.db, "nurse_elderly_assign"));
      const elderlySnapshot = await getDocs(elderlyQuery);
      
      console.log(`📊 Found ${elderlySnapshot.docs.length} total documents in nurse_elderly_assign`);
      
      let elderlyDeleteCount = 0;
      elderlySnapshot.docs.forEach(docRef => {
        const data = docRef.data();
        if (nurseIds.includes(data.nurse_id)) {
          batch.delete(docRef.ref);
          elderlyDeleteCount++;
          console.log(`📝 Marking for deletion: ${docRef.id} (nurse: ${data.nurse_id})`);
        }
      });

      console.log(`🗑️ About to delete ${shiftDeleteCount} shift assignments and ${elderlyDeleteCount} elderly assignments`);
      
      await batch.commit();
      
      console.log(`✅ Successfully cleared ${shiftDeleteCount} shift assignments and ${elderlyDeleteCount} elderly assignments for ${nurseIds.length} nurses`);
      
      return {
        success: true,
        shiftDeleteCount,
        elderlyDeleteCount,
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

    // Generate automated elderly assignments
    const elderlyAssignments = this.generateElderlyAssignments(
      pendingAssignments, 
      houses, 
      elderlyList, 
      nurses
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
        const ref = doc(this.db, "nurse_shift_assign", docId);
        const shiftDef = NurseScheduleService.SHIFT_DEFS.find((s) => s.key === shift);
        const payload = {
          nurse_id: nurseId,
          shift,
          shift_name: shiftDef?.name || "",
          start_time: shiftDef?.startTime || "",
          end_time: shiftDef?.endTime || "",
          days_assigned: days,
          is_current: true,
          created_at: new Date(),
          // Enhanced fields for mobile app integration
          assignment_type: "manual_schedule",
          status: "active",
          source: "web_admin",
          priority: "normal",
          last_modified_at: new Date(),
          last_modified_by: "admin",
          sync_status: "pending_sync"
        };
        batch.set(ref, payload, { merge: true });
      }
    }

    // Save automated elderly assignments (only for 1st and 2nd shifts)
    for (const nurseId of Object.keys(elderlyAssignments)) {
      const dayToElderly = elderlyAssignments[nurseId] || {};
      
      for (const [day, elderlyIds] of Object.entries(dayToElderly)) {
        if (elderlyIds && elderlyIds.length > 0) {
          // Check if nurse is working 1st or 2nd shift on this day
          const nurseShift = pendingAssignments[nurseId]?.[day];
          if (nurseShift === "1st" || nurseShift === "2nd") {
            const docId = `${nurseId}_${day}`;
            const ref = doc(this.db, "nurse_elderly_assign", docId);
            const payload = {
              nurse_id: nurseId,
              day,
              shift: nurseShift,
              elderly_ids: elderlyIds,
              house_ids: [...new Set(elderlyIds.map(elderlyId => this.getHouseForElderly(elderlyId, elderlyList)).filter(Boolean))],
              created_at: new Date(),
              is_current: true,
              assignment_type: "automated_house_based_assignment"
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
      if (nurses.some((n) => n.id === a.nurse_id)) {
        batch.delete(doc(this.db, "nurse_shift_assign", a.id));
      }
    });
    
    nurseElderlyAssignments.forEach((a) => {
      if (nurses.some((n) => n.id === a.nurse_id)) {
        batch.delete(doc(this.db, "nurse_elderly_assign", a.id));
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
        const ref = doc(this.db, "nurse_shift_assign", docId);
        const shiftDef = NurseScheduleService.SHIFT_DEFS.find((s) => s.key === shift);
        const payload = {
          nurse_id: nurseId,
          shift,
          shift_name: shiftDef?.name || "",
          start_time: shiftDef?.startTime || "",
          end_time: shiftDef?.endTime || "",
          days_assigned: days,
          is_current: true,
          created_at: new Date(),
          schedule_period: {
            start_date: new Date(),
            end_date: new Date(Date.now() + (periodDuration * 24 * 60 * 60 * 1000)),
            duration_days: periodDuration,
            auto_generated: true
          },
          // Enhanced fields for mobile app integration
          assignment_type: "auto_generated_schedule",
          status: "active",
          source: "web_admin_auto",
          priority: "normal",
          last_modified_at: new Date(),
          last_modified_by: "system_auto_generator",
          sync_status: "pending_sync"
        };
        batch.set(ref, payload, { merge: true });
      }
    }
    
    // Commit shift assignments first
    await batch.commit();
    
    // Generate and save elderly assignments after shift assignments are saved
    const elderlyBatch = writeBatch(this.db);
    const elderlyAssignments = this.generateElderlyAssignments(
      monthlyAssignments, 
      houses, 
      elderlyList, 
      nurses
    );
    
    for (const nurseId of Object.keys(elderlyAssignments)) {
      const dayToElderly = elderlyAssignments[nurseId] || {};
      
      for (const [day, elderlyIds] of Object.entries(dayToElderly)) {
        if (elderlyIds && elderlyIds.length > 0) {
          const nurseShift = monthlyAssignments[nurseId]?.[day];
          if (nurseShift === "1st" || nurseShift === "2nd") {
            const docId = `${nurseId}_${day}`;
            const ref = doc(this.db, "nurse_elderly_assign", docId);
            const payload = {
              nurse_id: nurseId,
              day,
              shift: nurseShift,
              elderly_ids: elderlyIds,
              house_ids: [...new Set(elderlyIds.map(elderlyId => this.getHouseForElderly(elderlyId, elderlyList)).filter(Boolean))],
              created_at: new Date(),
              is_current: true,
              assignment_type: "automated_house_based_assignment",
              schedule_period: {
                start_date: new Date(),
                end_date: new Date(Date.now() + (periodDuration * 24 * 60 * 60 * 1000)),
                auto_generated: true
              }
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
  async getAssignmentsPendingSync(collectionName = "nurse_shift_assign") {
    try {
      const q = query(
        collection(this.db, collectionName),
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
      nurse_id: assignment.nurse_id,
      shift: assignment.shift,
      shift_name: assignment.shift_name,
      start_time: assignment.start_time,
      end_time: assignment.end_time,
      days_assigned: assignment.days_assigned,
      assignment_type: assignment.assignment_type || "regular_schedule",
      status: assignment.status || "active",
      priority: assignment.priority || "normal",
      source: assignment.source || "web_admin",
      created_at: assignment.created_at,
      last_modified_at: assignment.last_modified_at,
      sync_status: assignment.sync_status || "pending_sync"
    };
  }
}