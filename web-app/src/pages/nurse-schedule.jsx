import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
  doc,
  writeBatch,
} from "firebase/firestore";
import "./schedule.css";
import Navbar from "./navbar";

export default function NurseSchedule() {
  const [nurses, setNurses] = useState([]);
  const [houses, setHouses] = useState([]);
  const [elderlyList, setElderlyList] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [nurseElderlyAssignments, setNurseElderlyAssignments] = useState([]);
  const [caregiverAssignments, setCaregiverAssignments] = useState([]);
  const [elderlySchedule, setElderlySchedule] = useState([]);
  const [pendingAssignments, setPendingAssignments] = useState({});
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [viewMode, setViewMode] = useState("summary");
  const [activeShift, setActiveShift] = useState("1st");
  const [activeDay, setActiveDay] = useState("Monday");
  const [notification, setNotification] = useState("");
  const [scheduleGeneration, setScheduleGeneration] = useState({
    isGenerating: false,
    currentPeriod: null,
    periodDuration: 30, // days
    lastShiftRotation: {} // nurseId -> lastShift
  });
  const SHOW_ALL_DAYS = "__ALL_DAYS__";

  const shiftDefs = [
    { name: "6:00 AM - 2:00 PM", key: "1st", startTime: "06:00", endTime: "14:00" },
    { name: "2:00 PM - 10:00 PM", key: "2nd", startTime: "14:00", endTime: "22:00" },
    { name: "10:00 PM - 6:00 AM", key: "3rd", startTime: "22:00", endTime: "06:00" },
    { name: "Rest Day", key: "rest", startTime: "", endTime: "" }
  ];

  const daysOfWeek = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

  // Load nurses, houses, and elderly
  useEffect(() => {
    (async () => {
      const [nurseSnap, houseSnap, elderlySnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("user_type", "==", "nurse"))),
        getDocs(collection(db, "house")),
        getDocs(collection(db, "elderly"))
      ]);
      
      setNurses(nurseSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setHouses(houseSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setElderlyList(elderlySnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    })();
  }, []);

  // Listen for caregiver assignments and elderly schedule
  useEffect(() => {
    const caregiverUnSub = onSnapshot(
      query(collection(db, "cg_house_assign_v2"), where("is_current", "==", true)),
      (snap) => {
        setCaregiverAssignments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    );

    const elderlyUnSub = onSnapshot(
      collection(db, "elderly_caregiver_assign_v2"),
      (snap) => {
        setElderlySchedule(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    );

    return () => {
      caregiverUnSub();
      elderlyUnSub();
    };
  }, []);

  // Listen for assignments
  useEffect(() => {
    const q = query(
      collection(db, "nurse_shift_assign"),
      where("is_current", "==", true)
    );
    const unsub = onSnapshot(q, (snap) => {
      setAssignments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // Listen for nurse-elderly assignments
  useEffect(() => {
    const q = query(collection(db, "nurse_elderly_assign"));
    const unsub = onSnapshot(q, (snap) => {
      setNurseElderlyAssignments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // Initialize pending assignments when entering edit mode
  useEffect(() => {
    if (viewMode === "edit") {
      // Initialize shift assignments
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
      setPendingAssignments(initShifts);
    }
  }, [viewMode, assignments, nurses]);

  // Check for schedule expiration and auto-regenerate if needed
  useEffect(() => {
    const checkScheduleExpiration = () => {
      if (assignments.length === 0) return;
      
      // Check if any assignment has schedule_period information
      const latestAssignment = assignments.find(a => a.schedule_period && a.schedule_period.end_date);
      if (!latestAssignment) return;
      
      const endDate = new Date(latestAssignment.schedule_period.end_date.seconds * 1000);
      const now = new Date();
      
      // If schedule has expired, auto-generate new one
      if (now >= endDate) {
        console.log('Schedule expired, auto-generating new schedule...');
        handleGenerateSchedule();
      }
    };
    
    // Check every hour for expiration
    const interval = setInterval(checkScheduleExpiration, 60 * 60 * 1000);
    
    // Also check immediately on component mount
    checkScheduleExpiration();
    
    return () => clearInterval(interval);
  }, [assignments.length]);

  const nurseName = (nurseId) => {
    const nurse = nurses.find((n) => n.id === nurseId);
    return nurse ? `${nurse.user_fname} ${nurse.user_lname}` : "Unknown Nurse";
  };

  const houseName = (houseId) => {
    const house = houses.find((h) => h.house_id === houseId || h.id === houseId);
    return house ? house.house_name : "Unknown House";
  };

  const elderlyName = (elderlyId) => {
    const elderly = elderlyList.find((e) => e.id === elderlyId);
    return elderly ? `${elderly.elderly_fname} ${elderly.elderly_lname}` : "Unknown";
  };

  // Get elderly assigned to nurse for a specific day
  const getElderlyForNurseDay = (nurseId, day) => {
    const assignment = nurseElderlyAssignments.find(
      (a) => a.nurse_id === nurseId && a.day === day
    );
    return assignment?.elderly_ids || [];
  };

  // Get house for elderly (group elderly by house)
  const getHouseForElderly = (elderlyId) => {
    const elderly = elderlyList.find((e) => e.id === elderlyId);
    return elderly?.house_id || null;
  };

  // Helper function to get next shift in rotation
  const getNextShift = (currentShift) => {
    const shiftOrder = ["1st", "2nd", "3rd"];
    const currentIndex = shiftOrder.indexOf(currentShift);
    return shiftOrder[(currentIndex + 1) % shiftOrder.length];
  };

  // Get the last shift assigned to a nurse
  const getLastShiftForNurse = (nurseId) => {
    // Check current assignments first
    const currentAssignments = assignments.filter(a => a.nurse_id === nurseId);
    if (currentAssignments.length > 0) {
      // Return the most recent shift (could be from any of their current assignments)
      return currentAssignments[0].shift;
    }
    
    // Check stored rotation data
    return scheduleGeneration.lastShiftRotation[nurseId] || "3rd"; // Start with 3rd so first assignment is 1st
  };

  // Generate work-rest pattern: 5 work days + 2 rest days with better distribution
  const generateWorkRestPattern = (startDayIndex, shift) => {
    const pattern = {};
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    
    // Generate 5 work days
    for (let i = 0; i < 5; i++) {
      const dayIndex = (startDayIndex + i) % 7;
      pattern[daysOfWeek[dayIndex]] = shift;
    }
    
    // Add 2 rest days
    for (let i = 5; i < 7; i++) {
      const dayIndex = (startDayIndex + i) % 7;
      pattern[daysOfWeek[dayIndex]] = "rest";
    }
    
    return pattern;
  };

  // Distribute nurses evenly across all days with staggered rest days for continuous coverage
  const distributeNursesAcrossDays = (balancedNurseAssignments) => {
    const monthlyAssignments = {};
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    
    // Create a pool of all nurse-shift combinations
    const nurseShiftPairs = [];
    Object.entries(balancedNurseAssignments).forEach(([shift, nursesInShift]) => {
      nursesInShift.forEach((nurse) => {
        nurseShiftPairs.push({ nurse, shift });
      });
    });
    
    // Track daily nurse counts to ensure even distribution
    const dailyNurseCounts = {};
    daysOfWeek.forEach(day => dailyNurseCounts[day] = 0);
    
    // Track rest day distribution to ensure coverage
    const restDayDistribution = {};
    daysOfWeek.forEach(day => restDayDistribution[day] = 0);
    
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
          tempWorkCounts[daysOfWeek[dayIndex]]++;
        }
        
        // Calculate rest days (2 consecutive rest days)
        for (let i = 5; i < 7; i++) { // 2 rest days
          const dayIndex = (startDay + i) % 7;
          tempRestCounts[daysOfWeek[dayIndex]]++;
        }
        
        // Score based on:
        // 1. Work day distribution evenness (lower variance = better)
        // 2. Rest day distribution evenness (we want rest days spread out)
        // 3. Ensure no day has all nurses resting
        // 4. Strong penalty to prevent days with zero coverage
        
        const workValues = Object.values(tempWorkCounts);
        const restValues = Object.values(tempRestCounts);
        
        const maxWorkCount = Math.max(...workValues);
        const minWorkCount = Math.min(...workValues);
        const maxRestCount = Math.max(...restValues);
        
        // Penalize if any day would have too few workers or too many resting
        const totalNurses = nurseShiftPairs.length;
        const workSpread = maxWorkCount - minWorkCount;
        const restPenalty = maxRestCount > Math.floor(totalNurses * 0.6) ? 1000 : 0; // Penalty if >60% rest on same day
        
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
          // Count how many 3rd shift nurses would be working each day
          const thirdShiftCount = nurseShiftPairs.filter(ns => ns.shift === "3rd").length;
          if (thirdShiftCount > 0) {
            // Apply penalty if 3rd shift coverage would be insufficient
            const avgThirdShiftCoverage = (thirdShiftCount * 5) / 7; // 5 work days out of 7
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
      const nursePattern = generateWorkRestPattern(bestStartDay, nurseShift.shift);
      monthlyAssignments[nurseShift.nurse.id] = nursePattern;
      
      // Update daily work counts
      for (let i = 0; i < 5; i++) {
        const dayIndex = (bestStartDay + i) % 7;
        dailyNurseCounts[daysOfWeek[dayIndex]]++;
      }
      
      // Update rest day counts
      for (let i = 5; i < 7; i++) {
        const dayIndex = (bestStartDay + i) % 7;
        restDayDistribution[daysOfWeek[dayIndex]]++;
      }
    });
    
    return monthlyAssignments;
  };

  // Validate and fix coverage gaps to ensure every day has at least one nurse working
  const validateAndFixCoverage = (assignments) => {
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const fixedAssignments = { ...assignments };
    
    // Calculate daily coverage for each day
    const dailyCoverage = {};
    daysOfWeek.forEach(day => dailyCoverage[day] = 0);
    
    // Count nurses working each day
    Object.values(assignments).forEach(nurseSchedule => {
      Object.entries(nurseSchedule).forEach(([day, shift]) => {
        if (shift !== "rest") {
          dailyCoverage[day]++;
        }
      });
    });
    
    // Find days with zero coverage
    const zeroCoverageDays = daysOfWeek.filter(day => dailyCoverage[day] === 0);
    
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
  };

  // Generate complete monthly schedule with rotation and balanced shift distribution
  const generateMonthlySchedule = () => {
    const updatedShiftRotation = { ...scheduleGeneration.lastShiftRotation };
    
    // Calculate optimal shift distribution
    const totalNurses = nurses.length;
    const shiftDistribution = calculateOptimalShiftDistribution(totalNurses);
    
    // Group nurses by their next shift (after rotation)
    const nursesByNextShift = { "1st": [], "2nd": [], "3rd": [] };
    
    nurses.forEach((nurse) => {
      const lastShift = getLastShiftForNurse(nurse.id);
      const nextShift = getNextShift(lastShift);
      nursesByNextShift[nextShift].push(nurse);
      updatedShiftRotation[nurse.id] = nextShift;
    });
    
    // Balance shifts according to optimal distribution
    const balancedNurseAssignments = balanceShiftDistribution(nursesByNextShift, shiftDistribution);
    
    // Distribute nurses across days to minimize daily overlap
    const monthlyAssignments = distributeNursesAcrossDays(balancedNurseAssignments);
    
    // Validate and fix coverage gaps
    const validatedAssignments = validateAndFixCoverage(monthlyAssignments);
    
    // Update the shift rotation tracking
    setScheduleGeneration(prev => ({
      ...prev,
      lastShiftRotation: updatedShiftRotation
    }));
    
    return validatedAssignments;
  };

  // Calculate optimal shift distribution based on total nurses
  const calculateOptimalShiftDistribution = (totalNurses) => {
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
  };

  // Balance nurse assignments to match optimal distribution
  const balanceShiftDistribution = (nursesByNextShift, targetDistribution) => {
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
  };

  // Helper function to split array into chunks
  const splitIntoChunks = (arr, n) => {
    if (!arr || arr.length === 0) return Array.from({ length: n }, () => []);
    const res = Array.from({ length: n }, () => []);
    for (let i = 0; i < arr.length; i++) {
      res[i % n].push(arr[i]);
    }
    return res;
  };

  // Generate automatic elderly assignments - divide elderly in each house equally among nurses on the same shift
  const generateElderlyAssignments = () => {
    const assignments = {};
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    // Sort houses consistently (H001, H002, H003, H004, H005)
    const sortedHouses = houses.sort((a, b) => {
      const numA = parseInt(a.house_id.replace(/\D/g, ""), 10);
      const numB = parseInt(b.house_id.replace(/\D/g, ""), 10);
      return numA - numB;
    });

    for (const day of daysOfWeek) {
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
          const nameA = nurseName(a).toLowerCase();
          const nameB = nurseName(b).toLowerCase();
          return nameA.localeCompare(nameB);
        });

        // Initialize assignments for all nurses on this shift
        nursesOnShift.forEach(nurseId => {
          if (!assignments[nurseId]) assignments[nurseId] = {};
          assignments[nurseId][day] = [];
        });

        // Process each house and divide its elderly equally among nurses on this shift
        sortedHouses.forEach(house => {
          // Get all elderly in this house that are assigned to caregivers for this day and shift
          const elderlyInHouse = elderlySchedule
            .filter(ea => {
              const elderly = elderlyList.find(e => e.id === ea.elderly_id);
              const caregiver = caregiverAssignments.find(ca => ca.caregiver_id === ea.caregiver_id);
              
              return elderly && 
                     caregiver && 
                     elderly.house_id === house.house_id &&
                     ea.day === day &&
                     caregiver.shift === shift &&
                     caregiver.days_assigned.includes(day);
            })
            .map(ea => ea.elderly_id);

          // Remove duplicates and sort alphabetically
          const uniqueElderlyInHouse = [...new Set(elderlyInHouse)];
          const sortedElderly = uniqueElderlyInHouse.sort((a, b) => {
            const elderlyA = elderlyList.find(e => e.id === a);
            const elderlyB = elderlyList.find(e => e.id === b);
            const nameA = elderlyA ? `${elderlyA.elderly_fname} ${elderlyA.elderly_lname}`.toLowerCase() : '';
            const nameB = elderlyB ? `${elderlyB.elderly_fname} ${elderlyB.elderly_lname}`.toLowerCase() : '';
            return nameA.localeCompare(nameB);
          });

          // Divide elderly in this house equally among nurses on this shift
          if (sortedElderly.length > 0) {
            const elderlyChunks = splitIntoChunks(sortedElderly, nursesOnShift.length);
            
            nursesOnShift.forEach((nurseId, index) => {
              const elderlyChunk = elderlyChunks[index] || [];
              assignments[nurseId][day].push(...elderlyChunk);
            });
          }
        });
      });

      // For 3rd shift, no elderly assignments (no vital signs)
      nursesByShift["3rd"].forEach(nurseId => {
        if (!assignments[nurseId]) assignments[nurseId] = {};
        assignments[nurseId][day] = [];
      });
    }

    return assignments;
  };

  // Get house assignments for display purposes
  const getNurseHouseAssignments = (nurseId, day, shift) => {
    const assignment = nurseElderlyAssignments.find(
      (a) => a.nurse_id === nurseId && a.day === day && a.shift === shift
    );
    return assignment?.house_ids || [];
  };

  // Group elderly by house for better display
  const groupElderlyByHouse = (elderlyIds) => {
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
  };

  // Clear all nurse schedules from Firestore
  const handleClearAll = async () => {
    if (!window.confirm("Are you sure you want to clear all nurse schedules and elderly assignments? This cannot be undone.")) return;
    setSaving(true);
    const batch = writeBatch(db);
    
    // Clear shift assignments
    assignments.forEach((a) => {
      if (nurses.some((n) => n.id === a.nurse_id)) {
        batch.delete(doc(db, "nurse_shift_assign", a.id));
      }
    });

    // Clear elderly assignments
    nurseElderlyAssignments.forEach((a) => {
      if (nurses.some((n) => n.id === a.nurse_id)) {
        batch.delete(doc(db, "nurse_elderly_assign", a.id));
      }
    });

    try {
      await batch.commit();
      setPendingAssignments({});
      setEditing(false);
    } catch (e) {
      alert("Failed to clear schedules: " + e.message);
    }
    setSaving(false);
  };

  // Handle automatic schedule generation
  const handleGenerateSchedule = async () => {
    if (!window.confirm("This will generate a new 1-month schedule with rotating shifts and work-rest patterns. Continue?")) return;
    
    setScheduleGeneration(prev => ({ ...prev, isGenerating: true }));
    setSaving(true);
    
    try {
      const batch = writeBatch(db);
      
      // Clear existing assignments first
      assignments.forEach((a) => {
        if (nurses.some((n) => n.id === a.nurse_id)) {
          batch.delete(doc(db, "nurse_shift_assign", a.id));
        }
      });
      
      nurseElderlyAssignments.forEach((a) => {
        if (nurses.some((n) => n.id === a.nurse_id)) {
          batch.delete(doc(db, "nurse_elderly_assign", a.id));
        }
      });
      
      // Generate new monthly schedule
      const monthlyAssignments = generateMonthlySchedule();
      
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
          const ref = doc(db, "nurse_shift_assign", docId);
          const shiftDef = shiftDefs.find((s) => s.key === shift);
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
              end_date: new Date(Date.now() + (scheduleGeneration.periodDuration * 24 * 60 * 60 * 1000)),
              duration_days: scheduleGeneration.periodDuration,
              auto_generated: true
            }
          };
          batch.set(ref, payload, { merge: true });
        }
      }
      
      // Generate and save elderly assignments using the new schedule
      setPendingAssignments(monthlyAssignments);
      
      // Commit all changes
      await batch.commit();
      
      // Generate elderly assignments after shift assignments are saved
      setTimeout(async () => {
        const elderlyBatch = writeBatch(db);
        const elderlyAssignments = generateElderlyAssignments();
        
        for (const nurseId of Object.keys(elderlyAssignments)) {
          const dayToElderly = elderlyAssignments[nurseId] || {};
          
          for (const [day, elderlyIds] of Object.entries(dayToElderly)) {
            if (elderlyIds && elderlyIds.length > 0) {
              const nurseShift = monthlyAssignments[nurseId]?.[day];
              if (nurseShift === "1st" || nurseShift === "2nd") {
                const docId = `${nurseId}_${day}`;
                const ref = doc(db, "nurse_elderly_assign", docId);
                const payload = {
                  nurse_id: nurseId,
                  day,
                  shift: nurseShift,
                  elderly_ids: elderlyIds,
                  house_ids: [...new Set(elderlyIds.map(getHouseForElderly).filter(Boolean))],
                  created_at: new Date(),
                  is_current: true,
                  assignment_type: "automated_house_based_assignment",
                  schedule_period: {
                    start_date: new Date(),
                    end_date: new Date(Date.now() + (scheduleGeneration.periodDuration * 24 * 60 * 60 * 1000)),
                    auto_generated: true
                  }
                };
                elderlyBatch.set(ref, payload, { merge: true });
              }
            }
          }
        }
        
        await elderlyBatch.commit();
        
        // Calculate and display shift distribution for user feedback
        const shiftCounts = { "1st": 0, "2nd": 0, "3rd": 0 };
        const dailyCounts = { "Monday": 0, "Tuesday": 0, "Wednesday": 0, "Thursday": 0, "Friday": 0, "Saturday": 0, "Sunday": 0 };
        const restCounts = { "Monday": 0, "Tuesday": 0, "Wednesday": 0, "Thursday": 0, "Friday": 0, "Saturday": 0, "Sunday": 0 };
        
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
        
        setNotification(`✅ Schedule generated! Shifts: 1st (${shiftCounts["1st"]}), 2nd (${shiftCounts["2nd"]}), 3rd (${shiftCounts["3rd"]}) nurses. Working: ${minDaily}-${maxDaily}/day, Resting: ${minRest}-${maxRest}/day. Continuous coverage ensured!`);
        setTimeout(() => setNotification(""), 7000);
      }, 1000);
      
    } catch (e) {
      alert("Failed to generate schedule: " + e.message);
    } finally {
      setSaving(false);
      setScheduleGeneration(prev => ({ ...prev, isGenerating: false }));
    }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    const batch = writeBatch(db);

    // Generate automated elderly assignments
    const elderlyAssignments = generateElderlyAssignments();

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
        const ref = doc(db, "nurse_shift_assign", docId);
        const shiftDef = shiftDefs.find((s) => s.key === shift);
        const payload = {
          nurse_id: nurseId,
          shift,
          shift_name: shiftDef?.name || "",
          start_time: shiftDef?.startTime || "",
          end_time: shiftDef?.endTime || "",
          days_assigned: days,
          is_current: true,
          created_at: new Date(),
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
            const ref = doc(db, "nurse_elderly_assign", docId);
            const payload = {
              nurse_id: nurseId,
              day,
              shift: nurseShift,
              elderly_ids: elderlyIds,
              house_ids: [...new Set(elderlyIds.map(getHouseForElderly).filter(Boolean))],
              created_at: new Date(),
              is_current: true,
              assignment_type: "automated_house_based_assignment"
            };
            batch.set(ref, payload, { merge: true });
          }
        }
      }
    }

    try {
      await batch.commit();
      setNotification("Nurse schedules saved. Each nurse assigned to 1 primary house + share of any leftover houses.");
    } catch (e) {
      alert("Failed to save all: " + e.message);
    }
    setSaving(false);
    // Hide notification after 3 seconds
    setTimeout(() => setNotification(""), 3000);
  };

  return (
    <div className="schedule-page">
      <Navbar />
      <main className="schedule-container">
        <h2 className="page-title" style={{ marginBottom: 8 }}>Nurse Scheduling</h2>

        {/* Toggle buttons */}
        <div className="button-toggle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => { setViewMode("summary"); setEditing(false); }}
              disabled={viewMode === "summary"}
              className="toggle-btn left"
            >
              View by Shift
            </button>
            <button
              onClick={() => { setViewMode("edit"); setEditing(true); }}
              disabled={viewMode === "edit"}
              className="toggle-btn right"
            >
              Edit
            </button>
          </div>
          
          {viewMode === "edit" && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                Period:
                <select
                  value={scheduleGeneration.periodDuration}
                  onChange={(e) => setScheduleGeneration(prev => ({
                    ...prev,
                    periodDuration: parseInt(e.target.value)
                  }))}
                  style={{ marginLeft: '4px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }}
                >
                  <option value={7}>1 Week</option>
                  <option value={14}>2 Weeks</option>
                  <option value={30}>1 Month</option>
                  <option value={60}>2 Months</option>
                </select>
              </label>
              
              <button
                onClick={handleGenerateSchedule}
                disabled={saving || scheduleGeneration.isGenerating}
                className="generate-btn"
                style={{ 
                  backgroundColor: '#28a745', 
                  color: 'white',
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: saving || scheduleGeneration.isGenerating ? 'not-allowed' : 'pointer'
                }}
              >
                {scheduleGeneration.isGenerating ? 'Generating...' : '🔄 Generate Schedule'}
              </button>
            </div>
          )}
        </div>

        {/* EDIT MODE */}
        {viewMode === "edit" && (
          <>
            {notification && (
              <div style={{ color: 'green', marginBottom: 8, textAlign: 'center', fontWeight: 'bold' }}>
                {notification}
              </div>
            )}
            <div className="table-container">
              <table className="schedule-table weekly-visual">
                <thead>
                  <tr>
                    <th>Nurse</th>
                    {daysOfWeek.map((day) => (
                      <th key={day}>{day}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {nurses.map((nurse) => {
                    const dayToShift = pendingAssignments[nurse.id] || {};
                    return (
                      <tr key={nurse.id}>
                        <td style={{ fontWeight: 'bold' }}>{nurseName(nurse.id)}</td>
                        {daysOfWeek.map((day) => (
                          <td key={nurse.id + day} style={{ textAlign: "center" }}>
                            <select
                              value={dayToShift[day] || "rest"}
                              onChange={(e) => {
                                const val = e.target.value;
                                setPendingAssignments((prev) => ({
                                  ...prev,
                                  [nurse.id]: {
                                    ...prev[nurse.id],
                                    [day]: val,
                                  },
                                }));
                              }}
                            >
                              {shiftDefs.map((shift) => (
                                <option key={shift.key} value={shift.key}>{shift.name}</option>
                              ))}
                            </select>
                            {(dayToShift[day] === "1st" || dayToShift[day] === "2nd") && (
                              <div style={{ fontSize: '0.7em', color: '#0066cc', marginTop: '2px' }}>
                                House + elderly assigned
                              </div>
                            )}
                            {dayToShift[day] === "3rd" && (
                              <div style={{ fontSize: '0.7em', color: '#999', marginTop: '2px' }}>
                                No vital signs
                              </div>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="save-container">
              <button
                onClick={handleSaveAll}
                disabled={saving || Object.keys(pendingAssignments).length === 0}
                className="save-btn"
              >
                Save All
              </button>
              <button
                onClick={handleClearAll}
                disabled={saving}
                className="clear-btn"
                style={{ marginLeft: 12 }}
              >
                Clear All
              </button>
            </div>
          </>
        )}

        {/* SUMMARY MODE */}
        {viewMode === "summary" && (
          <div className="table-container">
            <div className="shift-tabs">
              {shiftDefs.filter(s => s.key !== "rest").map((s) => (
                <button
                  key={s.key}
                  className={`shift-tab ${activeShift === s.key ? "active-shift" : ""}`}
                  onClick={() => setActiveShift(s.key)}
                >
                  {s.name}
                </button>
              ))}
            </div>

            <div className="shift-tabs">
              <button
                key={SHOW_ALL_DAYS}
                className={`shift-tab ${activeDay === SHOW_ALL_DAYS ? "active-shift" : ""}`}
                onClick={() => setActiveDay(SHOW_ALL_DAYS)}
              >
                Show All Days
              </button>
              {daysOfWeek.map((day) => (
                <button
                  key={day}
                  className={`shift-tab ${activeDay === day ? "active-shift" : ""}`}
                  onClick={() => setActiveDay(day)}
                >
                  {day}
                </button>
              ))}
            </div>

            <table className="schedule-table shift-summary">
              <thead>
                <tr>
                  <th>Nurse</th>
                  <th>Elderly Assigned</th>
                </tr>
              </thead>
              <tbody>
                {(activeDay === SHOW_ALL_DAYS
                  ? assignments.filter((a) => a.shift === activeShift)
                  : assignments.filter((a) => a.shift === activeShift && a.days_assigned.includes(activeDay))
                ).length > 0 ? (
                  (activeDay === SHOW_ALL_DAYS
                    ? assignments.filter((a) => a.shift === activeShift)
                    : assignments.filter((a) => a.shift === activeShift && a.days_assigned.includes(activeDay))
                  ).map((a) => {
                    // Get elderly assignments for this nurse
                    let elderlyAssignments = [];
                    
                    if (activeDay === SHOW_ALL_DAYS) {
                      // Show all days' assignments
                      const allDaysAssignments = nurseElderlyAssignments
                        .filter(ea => ea.nurse_id === a.nurse_id && ea.shift === activeShift);
                      elderlyAssignments = allDaysAssignments;
                    } else {
                      // Show specific day assignments
                      const dayAssignment = nurseElderlyAssignments
                        .find(ea => ea.nurse_id === a.nurse_id && ea.day === activeDay && ea.shift === activeShift);
                      if (dayAssignment) {
                        elderlyAssignments = [dayAssignment];
                      }
                    }

                    return (
                      <tr key={a.id}>
                        <td>{nurseName(a.nurse_id)}</td>
                        <td>
                          {activeShift === "3rd" ? (
                            <em style={{ color: "#888" }}>No elderly assigned for 3rd shift</em>
                          ) : elderlyAssignments.length > 0 ? (
                            <div>
                              {activeDay === SHOW_ALL_DAYS ? (
                                // Group by day and house for all days view
                                elderlyAssignments.map(ea => {
                                  const groupedByHouse = groupElderlyByHouse(ea.elderly_ids || []);
                                  return (
                                    <div key={ea.id} style={{ marginBottom: '8px' }}>
                                      <strong>{ea.day}:</strong>
                                      {Object.keys(groupedByHouse).length > 0 ? (
                                        Object.entries(groupedByHouse).map(([houseId, elderly]) => (
                                          <div key={houseId} style={{ marginLeft: '8px', marginBottom: '4px' }}>
                                            <strong style={{ color: '#0066cc' }}>{houseName(houseId)}:</strong>{' '}
                                            {elderly.map(e => `${e.elderly_fname} ${e.elderly_lname}`).join(", ")}
                                          </div>
                                        ))
                                      ) : (
                                        <span style={{ marginLeft: '8px', fontStyle: 'italic', color: '#888' }}>No assignments</span>
                                      )}
                                    </div>
                                  );
                                })
                              ) : (
                                // Show elderly grouped by house for specific day
                                (() => {
                                  const allElderlyForDay = elderlyAssignments.flatMap(ea => ea.elderly_ids || []);
                                  const groupedByHouse = groupElderlyByHouse(allElderlyForDay);
                                  
                                  return Object.keys(groupedByHouse).length > 0 ? (
                                    Object.entries(groupedByHouse).map(([houseId, elderly]) => (
                                      <div key={houseId} style={{ marginBottom: '4px' }}>
                                        <strong style={{ color: '#0066cc' }}>{houseName(houseId)}:</strong>{' '}
                                        {elderly.map(e => `${e.elderly_fname} ${e.elderly_lname}`).join(", ")}
                                      </div>
                                    ))
                                  ) : (
                                    <em style={{ color: "#888" }}>No assignments</em>
                                  );
                                })()
                              )}
                            </div>
                          ) : (
                            <em style={{ color: "#888" }}>No elderly assigned</em>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={2} style={{ textAlign: "center", color: "#888" }}>
                      <em>{activeDay === SHOW_ALL_DAYS ? "No Nurse Assigned for this shift." : "No Nurse Assigned for this day."}</em>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
