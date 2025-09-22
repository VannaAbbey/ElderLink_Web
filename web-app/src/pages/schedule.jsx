import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
  writeBatch,
  doc
} from "firebase/firestore";
import "./schedule.css";
import Navbar from "./navbar";
import * as ScheduleAPI from "../services/scheduleApi";
import { 
  detectUnassignedCaregivers,
  generateCaregiverRecommendations,
  integrateNewCaregiver
} from "../services/scheduleApi";
// import { 
//   markCaregiverAbsentWithEmergencyCheck, 
//   activateEmergencyCoverage,
//   checkEmergencyNeedsAndDonors 
// } from "../services/scheduleApi";


export default function Schedule() {
  const [caregivers, setCaregivers] = useState([]);
  const [houses, setHouses] = useState([]);
  const [elderlyList, setElderlyList] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [elderlyAssigns, setElderlyAssigns] = useState([]);
  const [tempReassigns, setTempReassigns] = useState([]);

  const [duration, setDuration] = useState(6);
  const [customDuration, setCustomDuration] = useState("");
  const [showOverlay, setShowOverlay] = useState(false);
  const [pendingDuration, setPendingDuration] = useState(6);
  const [showSuccess, setShowSuccess] = useState(false);

  const [viewMode, setViewMode] = useState("current");
  const [activeHouseId, setActiveHouseId] = useState(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  
  // Emergency coverage modal states
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [emergencyOptions, setEmergencyOptions] = useState([]);
  const [selectedDonorChoices, setSelectedDonorChoices] = useState({});
  
  // New caregiver integration modal states
  const [showNewCaregiverModal, setShowNewCaregiverModal] = useState(false);
  const [unassignedCaregivers, setUnassignedCaregivers] = useState([]);
  const [selectedNewCaregiver, setSelectedNewCaregiver] = useState(null);
  const [integrationMode, setIntegrationMode] = useState('auto'); // 'auto' or 'manual'
  const [manualAssignment, setManualAssignment] = useState({
    house: '',
    shift: '',
    workDays: []
  });
  const [systemRecommendations, setSystemRecommendations] = useState([]);
  
  // ========== DAYS OF WEEK TABS - COMMENT OUT BELOW LINES TO REMOVE ==========
  const [activeDay, setActiveDay] = useState("Monday");
  // ========== END DAYS OF WEEK TABS SECTION ==========

  const [scheduleInfo, setScheduleInfo] = useState(null);
  const [daysLeft, setDaysLeft] = useState(null);
  const [showAbsentConfirm, setShowAbsentConfirm] = useState(false);
  const [pendingAbsentAssignment, setPendingAbsentAssignment] = useState(null);

  // Custom alert modal states
  const [showCustomAlert, setShowCustomAlert] = useState(false);
  const [customAlertMessage, setCustomAlertMessage] = useState("");
  const [customAlertTitle, setCustomAlertTitle] = useState("Notification");


  // 3-shift schedule definitions
  const shiftDefs = [
    { name: "1st Shift (6:00 AM - 2:00 PM)", key: "1st", time_range: { start: "06:00", end: "14:00" } },
    { name: "2nd Shift (2:00 PM - 10:00 PM)", key: "2nd", time_range: { start: "14:00", end: "22:00" } },
    { name: "3rd Shift (10:00 PM - 6:00 AM)", key: "3rd", time_range: { start: "22:00", end: "06:00" } },
  ];
  const [activeShift, setActiveShift] = useState(shiftDefs[0].key);

  const [currentVersion, setCurrentVersion] = useState(0);

  const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  // Custom alert function to replace native alert()
  const showAlert = (message, title = "Notification") => {
    setCustomAlertMessage(message);
    setCustomAlertTitle(title);
    setShowCustomAlert(true);
  };

  const closeCustomAlert = () => {
    setShowCustomAlert(false);
    setCustomAlertMessage("");
    setCustomAlertTitle("Notification");
  };

  const formatDateString = (date) => {
    // Format date in local timezone to avoid UTC conversion issues
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };


  useEffect(() => {
    (async () => {
      await loadStaticData();
      await loadAllAssignments();
      await loadAllElderlyAssigns();
      await loadTempReassigns();
    })();
  }, []);

  useEffect(() => {
    const savedDuration = localStorage.getItem("schedule_duration");
    const savedCustom = localStorage.getItem("schedule_custom");
    if (savedDuration) setDuration(parseInt(savedDuration));
    if (savedCustom) setCustomDuration(savedCustom);
  }, []);


  useEffect(() => {
    loadAllAssignments();
  }, [viewMode]);

  useEffect(() => {
    const checkAutoReshuffle = async () => {
      if (assignments.length === 0) return;

      // Find the latest current assignment
      const currentAssigns = assignments.filter(a => a.is_current);
      if (!currentAssigns.length) return;

      // Get the latest end_date among all current assignments
      const latestEnd = currentAssigns
        .map(a => a.end_date?.toDate())
        .sort((a, b) => b - a)[0];

      const now = new Date();

      if (latestEnd && now > latestEnd) {
        console.log("Auto reshuffle triggered!");
        const months = customDuration ? parseInt(customDuration) : duration;
        await handleScheduleGeneration(months);
      }
    };

    checkAutoReshuffle();
  }, [assignments]); // runs whenever assignments are loaded/updated

    // inside your Schedule component
  useEffect(() => {
    // build the query to only get current schedules
    const q = query(
      collection(db, "cg_house_assign_v2"),
      where("is_current", "==", true)
    );

    // attach real-time listener
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      setAssignments(data); // 🔹 update state immediately
    });

    // cleanup listener on unmount
    return () => unsubscribe();
  }, []); // 👈 runs only once when component mounts

  useEffect(() => {
  if (viewMode === "history") {
    const q = query(
      collection(db, "cg_house_assign_v2"),
      where("is_current", "==", false)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      setAssignments(data);
    });

    return () => unsubscribe();
  }
}, [viewMode]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "elderly_caregiver_assign_v2"),
      (snapshot) => {
        setElderlyAssigns(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "temp_reassignments"),
      (snapshot) => {
        setTempReassigns(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
  if (!assignments || assignments.length === 0) {
    setScheduleInfo(null);
    setDaysLeft(null);
    return;
  }

  // Get the first current assignment (they share same start/end dates)
  const currentAssign = assignments.find(a => a.is_current);
  if (!currentAssign) return;

  const start = currentAssign.start_date?.toDate();
  const end = currentAssign.end_date?.toDate();

  setScheduleInfo({ start, end });

  // Compute countdown days
  if (end) {
    const today = new Date();
    const diffMs = end.getTime() - today.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    setDaysLeft(diffDays > 0 ? diffDays : 0);
  }
}, [assignments]);

  // Separate effect to handle date validation when schedule info changes
  useEffect(() => {
    if (scheduleInfo?.start && scheduleInfo?.end) {
      const { start, end } = scheduleInfo;
      const currentSelected = selectedDate;
      
      // If the currently selected date is outside the schedule range, reset it
      if (currentSelected < start || currentSelected > end) {
        // Choose today if it's within range, otherwise use start date
        const today = new Date();
        const newSelectedDate = (today >= start && today <= end) ? today : start;
        setSelectedDate(newSelectedDate);
        
        // Update the day tab to match
        const dayName = daysOfWeek[newSelectedDate.getDay() === 0 ? 6 : newSelectedDate.getDay() - 1];
        setActiveDay(dayName);
      }
    }
  }, [scheduleInfo]);

  // --- Loaders ---
  const loadStaticData = async () => {
    try {
      const data = await ScheduleAPI.fetchStaticData();
      setCaregivers(data.caregivers);
      setHouses(data.houses);
      setElderlyList(data.elderly);

      // Set H001 (St. Sebastian) as default house if present
      if (!activeHouseId && data.houses.length) {
        const defaultHouse = data.houses.find(h => h.house_id === "H001") || data.houses[0];
        setActiveHouseId(defaultHouse.house_id);
      }

      const v = await ScheduleAPI.getMaxVersion();
      setCurrentVersion(v);
    } catch (error) {
      console.error("Error loading static data:", error);
      showAlert("Failed to load data. Please refresh the page.", "Error");
    }
  };

  const loadAllAssignments = async () => {
    try {
      const isCurrent = viewMode === "current";
      const data = await ScheduleAPI.fetchAssignments(isCurrent);
      setAssignments(data);
    } catch (error) {
      console.error("Error loading assignments:", error);
    }
  };

  const loadAllElderlyAssigns = async () => {
    try {
      const data = await ScheduleAPI.fetchElderlyAssignments();
      setElderlyAssigns(data);
    } catch (error) {
      console.error("Error loading elderly assignments:", error);
    }
  };

  const loadTempReassigns = async () => {
    try {
      const data = await ScheduleAPI.fetchTempReassignments();
      setTempReassigns(data);
    } catch (error) {
      console.error("Error loading temp reassignments:", error);
    }
  };

  // Schedule generation function - now uses API service
  const handleScheduleGeneration = async (months) => {
    try {
      const result = await ScheduleAPI.generateSchedule(months, {
        caregivers,
        houses,
        elderly: elderlyList
      });
      
      if (result.success) {
        console.log("Schedule generated successfully:", result.message);
        setCurrentVersion(result.version);
        // Refresh data after generation
        await loadAllAssignments();
        await loadAllElderlyAssigns();
      }
    } catch (error) {
      console.error("Error generating schedule:", error);
      throw error; // Re-throw so calling function can handle it
    }
  };

  const confirmGenerate = async () => {
    setIsGenerating(true);
    setShowOverlay(false);
    try {
      await handleScheduleGeneration(pendingDuration);
      setShowSuccess(true);
    } catch (err) {
      console.error("Error generating schedule:", err);
      showAlert("Something went wrong. Please try again.", "Error");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateClick = () => {
    const months = customDuration ? parseInt(customDuration) : duration;
    setPendingDuration(months);
    setShowOverlay(true);
  };

  // Manual emergency coverage activation - now with modal
  const handleEmergencyCoverage = async () => {
    console.log("🚨 Emergency Coverage button clicked");
    
    try {
      const selectedDateStr = formatDateString(selectedDate);
      console.log(`📅 Checking emergency needs for date: ${selectedDateStr}`);
      console.log(`📊 Current assignments count: ${assignments.length}`);
      console.log(`👵 Current elderly assignments count: ${elderlyAssigns.length}`);
      console.log(`🔄 Current temp reassignments count: ${tempReassigns.length}`);
      
      const emergencyCheck = await checkEmergencyNeedsAndDonors(selectedDateStr, assignments, elderlyAssigns, tempReassigns);
      console.log("🔍 Emergency check result:", emergencyCheck);
      
      if (!emergencyCheck.hasEmergency) {
        console.log("✅ No emergency coverage needed");
        showAlert("✅ No emergency coverage needed for this date.", "Success");
        return;
      }
      
      console.log(`🆘 Found ${emergencyCheck.emergencyCount} emergencies`);
      console.log("🎯 Emergency options:", emergencyCheck.emergencyOptions);
      
      // Initialize selected donor choices with suggested donors
      const initialChoices = {};
      emergencyCheck.emergencyOptions.forEach(option => {
        if (option.suggestedDonor) {
          initialChoices[`${option.emergencyHouse}_${option.emergencyShift}`] = {
            donorHouse: option.suggestedDonor.house,
            caregiverId: option.suggestedDonor.presentCaregivers[0]?.caregiverId
          };
        }
      });
      
      console.log("💡 Initial donor choices:", initialChoices);
      
      setEmergencyOptions(emergencyCheck.emergencyOptions);
      setSelectedDonorChoices(initialChoices);
      setShowEmergencyModal(true);
      
      console.log("✅ Modal should be showing now");
      
    } catch (error) {
      console.error("❌ Error checking emergency coverage:", error);
      showAlert(`Failed to check emergency coverage needs: ${error.message}`, "Error");
    }
  };

  // Execute emergency coverage with selected donors
  const executeEmergencyCoverage = async () => {
    try {
      const selectedDateStr = formatDateString(selectedDate);
      
      // Create donor choices array for the API
      const donorChoices = Object.entries(selectedDonorChoices).map(([key, choice]) => {
        const [house, shift] = key.split('_');
        return {
          emergencyHouse: house,
          emergencyShift: shift,
          donorHouse: choice.donorHouse,
          caregiverId: choice.caregiverId
        };
      });
      
      const result = await activateEmergencyCoverage(selectedDateStr, assignments, elderlyAssigns, tempReassigns, donorChoices);
      
      if (result.success) {
        if (result.emergencyReassignments?.length > 0) {
          const emergencyCount = result.emergencyReassignments.length;
          showAlert(`🚨 Emergency coverage activated!\n\n${emergencyCount} emergency reassignment(s) made:\n${result.emergencyReassignments.map(er => `• ${er.emergencyHouse} ${er.emergencyShift} covered by caregiver from ${er.donorHouse}`).join('\n')}`, "Emergency Coverage Activated");
          
          // Refresh data to show changes
          await loadAllAssignments();
          await loadAllElderlyAssigns();
          await loadTempReassigns();
        } else {
          showAlert("✅ No emergency coverage activated.", "Information");
        }
      }
      
      setShowEmergencyModal(false);
      
    } catch (error) {
      console.error("Error executing emergency coverage:", error);
      showAlert("Failed to execute emergency coverage. Please try again.", "Error");
    }
  };

  const cancelEmergencyCoverage = () => {
    setShowEmergencyModal(false);
    setEmergencyOptions([]);
    setSelectedDonorChoices({});
  };

  // New Caregiver Integration functions
  const handleNewCaregiverIntegration = async () => {
    try {
      // First detect unassigned caregivers
      const unassigned = await detectUnassignedCaregivers();
      
      if (unassigned.length === 0) {
        showAlert("All caregivers are already assigned to the current schedule.", "No Unassigned Caregivers");
        return;
      }
      
      setUnassignedCaregivers(unassigned);
      setShowNewCaregiverModal(true);
      
    } catch (error) {
      console.error("Error detecting unassigned caregivers:", error);
      showAlert("Failed to check for unassigned caregivers. Please try again.", "Error");
    }
  };

  const handleCaregiverSelection = async (caregiverId) => {
    setSelectedNewCaregiver(caregiverId);
    
    if (integrationMode === 'auto') {
      // Generate system recommendations
      try {
        const recommendations = await generateCaregiverRecommendations(caregiverId, assignments, houses);
        setSystemRecommendations(recommendations);
      } catch (error) {
        console.error("Error generating recommendations:", error);
        showAlert("Failed to generate recommendations. Please try manual assignment.", "Error");
      }
    }
  };

  const executeNewCaregiverIntegration = async () => {
    if (!selectedNewCaregiver) {
      showAlert("Please select a caregiver first.", "No Caregiver Selected");
      return;
    }

    try {
      let assignmentData;
      
      if (integrationMode === 'auto' && systemRecommendations.length > 0) {
        // Use the first (best) recommendation
        assignmentData = systemRecommendations[0];
      } else if (integrationMode === 'manual') {
        // Validate manual assignment
        if (!manualAssignment.house || !manualAssignment.shift || manualAssignment.workDays.length === 0) {
          showAlert("Please complete all manual assignment fields.", "Incomplete Assignment");
          return;
        }
        assignmentData = manualAssignment;
      } else {
        showAlert("Please select assignment options.", "No Assignment Data");
        return;
      }

      // Execute the integration
      const result = await integrateNewCaregiver(selectedNewCaregiver, assignmentData, assignments, elderlyAssigns);
      
      if (result.success) {
        showAlert(`Successfully integrated caregiver into the schedule!\n\nAssigned to: ${assignmentData.house}\nShift: ${assignmentData.shift}\nWork Days: ${assignmentData.workDays.join(', ')}`, "Integration Successful");
        
        // Refresh data
        await loadAllAssignments();
        await loadAllElderlyAssigns();
        
        // Reset modal state
        setShowNewCaregiverModal(false);
        setSelectedNewCaregiver(null);
        setIntegrationMode('auto');
        setManualAssignment({ house: '', shift: '', workDays: [] });
        setSystemRecommendations([]);
        
      } else {
        showAlert(result.message || "Failed to integrate caregiver.", "Integration Failed");
      }
      
    } catch (error) {
      console.error("Error integrating new caregiver:", error);
      showAlert("Failed to integrate caregiver. Please try again.", "Error");
    }
  };

  const cancelNewCaregiverIntegration = () => {
    setShowNewCaregiverModal(false);
    setSelectedNewCaregiver(null);
    setIntegrationMode('auto');
    setManualAssignment({ house: '', shift: '', workDays: [] });
    setSystemRecommendations([]);
    setUnassignedCaregivers([]);
  };

  const closeSuccess = () => setShowSuccess(false);
  const cancelGenerate = () => setShowOverlay(false);

  // --- Absent handling - now uses API service ---
  const markAbsent = async (assignDocId) => {
    // Store the assignment and show confirmation popup
    const assignment = assignments.find(a => a.id === assignDocId);
    if (assignment) {
      setPendingAbsentAssignment({ assignDocId, assignment });
      setShowAbsentConfirm(true);
    }
  };

  const confirmMarkAbsent = async () => {
    if (!pendingAbsentAssignment) return;
    
    try {
      const selectedDateStr = formatDateString(selectedDate);
      const dayName = daysOfWeek[selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1];
      
      console.log(`Marking absent for exact date: ${selectedDateStr} (${dayName})`);
      
      // Use new emergency coverage function
      const result = await markCaregiverAbsentWithEmergencyCheck(
        pendingAbsentAssignment.assignDocId, 
        assignments, 
        elderlyAssigns, 
        tempReassigns,
        selectedDateStr,
        dayName
      );
      
      if (result.success) {
        // Refresh data after marking absent
        await loadAllAssignments();
        await loadAllElderlyAssigns();
        await loadTempReassigns();
        
        // Check if emergency coverage is needed and show modal
        if (result.emergencyCheck && result.emergencyCheck.hasEmergency) {
          console.log(`🚨 Emergency coverage needed after marking absence! Showing modal...`);
          
          // Initialize selected donor choices with suggested donors
          const initialChoices = {};
          result.emergencyCheck.emergencyOptions.forEach(option => {
            if (option.suggestedDonor) {
              initialChoices[`${option.emergencyHouse}_${option.emergencyShift}`] = {
                donorHouse: option.suggestedDonor.house,
                caregiverId: option.suggestedDonor.presentCaregivers[0]?.caregiverId
              };
            }
          });
          
          setEmergencyOptions(result.emergencyCheck.emergencyOptions);
          setSelectedDonorChoices(initialChoices);
          setShowEmergencyModal(true);
          
          // Show an alert about the emergency
          showAlert(`🚨 Emergency coverage required!\n\nMarking this caregiver as absent has left ${result.emergencyCheck.emergencyCount} house/shift(s) with no coverage. Please select emergency coverage options.`, "Emergency Coverage Required");
        } else {
          // No emergency coverage needed
          showAlert("✅ Caregiver marked as absent successfully. No emergency coverage needed.", "Success");
        }
      }
    } catch (error) {
      console.error("Error marking caregiver absent:", error);
      showAlert("Failed to mark caregiver as absent. Please try again.", "Error");
    } finally {
      setShowAbsentConfirm(false);
      setPendingAbsentAssignment(null);
    }
  };

  const cancelMarkAbsent = () => {
    setShowAbsentConfirm(false);
    setPendingAbsentAssignment(null);
  };

  // --- Optional: reset absences automatically on component mount ---
  useEffect(() => {
    const resetDailyAbsences = async () => {
      try {
        await ScheduleAPI.resetDailyAbsences();
        await loadAllAssignments();
      } catch (error) {
        console.error("Error resetting daily absences:", error);
      }
    };

    resetDailyAbsences();
  }, []);

  // Check if caregiver is providing emergency coverage
  const isProvidingEmergencyCoverage = (caregiverId, selectedDateStr) => {
    return tempReassigns.some(tr => 
      tr.to_caregiver_id === caregiverId && 
      tr.date === selectedDateStr && 
      tr.from_caregiver_id === "EMERGENCY_ABSENT"
    );
  };

  // Get emergency coverage details for a caregiver
  const getEmergencyCoverageDetails = (caregiverId, selectedDateStr) => {
    const emergencyAssignments = tempReassigns.filter(tr => 
      tr.to_caregiver_id === caregiverId && 
      tr.date === selectedDateStr && 
      tr.from_caregiver_id === "EMERGENCY_ABSENT"
    );
    
    if (emergencyAssignments.length > 0) {
      const firstAssignment = emergencyAssignments[0];
      return {
        count: emergencyAssignments.length,
        reason: firstAssignment?.reason || "Emergency coverage",
        originalHouse: firstAssignment?.original_house,
        emergencyHouse: firstAssignment?.emergency_house,
        emergencyShift: firstAssignment?.emergency_shift
      };
    }
    
    return null;
  };

  const getDisplayedEldersFor = (caregiverId) => {
  const selectedDateStr = formatDateString(selectedDate);
  
  // Use the selected date from date picker to determine the day
  const dayName = daysOfWeek[selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1];
  
  console.log(`=== DISPLAYING ELDERLY FOR CAREGIVER ${caregiverId} ===`);
  console.log(`Selected date: ${selectedDateStr} (${dayName}), Current version: ${currentVersion}`);
  
  // First, check if this caregiver is marked as absent for this specific date
  const caregiverAssignment = assignments.find(a => a.caregiver_id === caregiverId && a.is_current);
  const isAbsentForThisDate = caregiverAssignment && caregiverAssignment.is_absent && caregiverAssignment.absent_for_date === selectedDateStr;
  
  if (isAbsentForThisDate) {
    console.log(`Caregiver ${caregiverId} is marked ABSENT for ${selectedDateStr} - showing no elderly assignments`);
    return []; // Return empty array - all elderly should be reassigned to others
  }
  
  const base = elderlyAssigns
    .filter(
      (ea) =>
        ea.caregiver_id === caregiverId &&
        ea.assign_version === currentVersion &&
        ea.day?.toLowerCase() === dayName.toLowerCase()
    )
    .map((ea) => ea.elderly_id);
  
  console.log(`Base assignments for ${caregiverId} on ${dayName}: ${base.length}`, base);

  const toTemp = tempReassigns
    .filter(
      (t) =>
        t.to_caregiver_id === caregiverId &&
        t.date === selectedDateStr &&
        t.assign_version === currentVersion
    )
    .map((t) => t.elderly_id);
    
  console.log(`Temp assignments TO ${caregiverId} for ${selectedDateStr}: ${toTemp.length}`, toTemp);

  const fromTemp = tempReassigns
    .filter(
      (t) =>
        t.from_caregiver_id === caregiverId &&
        t.date === selectedDateStr &&
        t.assign_version === currentVersion
    )
    .map((t) => t.elderly_id);
    
  console.log(`Temp assignments FROM ${caregiverId} for ${selectedDateStr}: ${fromTemp.length}`, fromTemp);

  const finalIds = [...new Set(base.filter((id) => !fromTemp.includes(id)).concat(toTemp))]; // Remove duplicates
  console.log(`Final elderly IDs for ${caregiverId}: ${finalIds.length}`, finalIds);
  
  const elders = finalIds
    .map((id) => elderlyList.find((e) => e.id === id))
    .filter(Boolean);

  console.log(`Final elderly objects for ${caregiverId}:`, elders.map(e => `${e.elderly_fname} ${e.elderly_lname}`));
  console.log(`=== END DISPLAY DEBUG ===`);
  
  return elders;
};


  const caregiverName = (id) => {
    const c = caregivers.find((cg) => cg.id === id);
    return c ? `${c.user_fname} ${c.user_lname}` : "Unknown";
  };

  // Get emergency coverage assignments for display
  const getEmergencyCoverageAssignments = () => {
    const selectedDateStr = formatDateString(selectedDate);
    const dayName = daysOfWeek[selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1];
    
    // Find emergency coverage temp assignments
    const emergencyTempAssigns = tempReassigns.filter(tr => 
      tr.date === selectedDateStr && 
      tr.from_caregiver_id === "EMERGENCY_ABSENT"
    );
    
    // Group by caregiver to create virtual assignments
    const emergencyAssignments = [];
    const emergencyCaregivers = new Set();
    
    emergencyTempAssigns.forEach(ta => {
      emergencyCaregivers.add(ta.to_caregiver_id);
    });
    
    // For each emergency caregiver, find which house/shift they're covering
    emergencyCaregivers.forEach(caregiverId => {
      // Get the first emergency temp assignment to parse the reason
      const firstEmergencyAssign = emergencyTempAssigns.find(ta => ta.to_caregiver_id === caregiverId);
      
      if (firstEmergencyAssign) {
        let emergencyHouseId, emergencyShift;
        
        // Try to get from dedicated fields first
        if (firstEmergencyAssign.emergency_house) {
          emergencyHouseId = firstEmergencyAssign.emergency_house;
        }
        
        if (firstEmergencyAssign.emergency_shift) {
          emergencyShift = firstEmergencyAssign.emergency_shift;
        }
        
        // If not available, parse from reason (for backward compatibility)
        if (!emergencyHouseId || !emergencyShift) {
          const reasonMatch = firstEmergencyAssign.reason?.match(/Emergency coverage for (\w+) (\w+) shift/i);
          if (reasonMatch) {
            emergencyHouseId = emergencyHouseId || reasonMatch[1];
            emergencyShift = emergencyShift || reasonMatch[2];
          }
        }
        
        // Last resort: find absent caregiver in emergency house for this date to get shift
        if (!emergencyShift && emergencyHouseId) {
          const selectedDateStr = formatDateString(selectedDate);
          const absentInEmergencyHouse = assignments.find(a => 
            a.house_id === emergencyHouseId && 
            a.is_current &&
            a.is_absent && 
            a.absent_for_date === selectedDateStr &&
            (a.days_assigned || []).map(d => d.toLowerCase()).includes(dayName.toLowerCase())
          );
          emergencyShift = absentInEmergencyHouse?.shift || "1st"; // Default fallback
        }
        
        if (emergencyHouseId && emergencyShift) {
          
          console.log(`🚨 Emergency caregiver ${caregiverId} should appear in ${emergencyHouseId} ${emergencyShift} shift`);
          
          // Find the time range for this shift by looking at any assignment with this shift
          const shiftTimeRange = assignments.find(a => a.shift === emergencyShift && a.is_current)?.time_range;
          
          // Create a virtual assignment for the emergency caregiver in the emergency house/shift
          emergencyAssignments.push({
            id: `emergency_${caregiverId}_${emergencyHouseId}_${emergencyShift}`,
            caregiver_id: caregiverId,
            house_id: emergencyHouseId,
            shift: emergencyShift,
            days_assigned: [dayName],
            is_current: true,
            is_emergency_coverage: true,
            time_range: shiftTimeRange || { start: "06:00", end: "14:00" },
            version: currentVersion
          });
        } else {
          console.error(`Could not parse emergency coverage reason: ${firstEmergencyAssign.reason}`);
        }
      }
    });
    
    console.log(`📋 Created ${emergencyAssignments.length} emergency coverage virtual assignments`);
    return emergencyAssignments;
  };

  const filteredAssignments = (() => {
    const selectedDateStr = formatDateString(selectedDate);
    const dayName = daysOfWeek[selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1];
    
    // Get emergency coverage caregivers for this date
    const emergencyCaregivers = tempReassigns
      .filter(tr => tr.date === selectedDateStr && tr.from_caregiver_id === "EMERGENCY_ABSENT")
      .map(tr => tr.to_caregiver_id);
    
    console.log(`🚨 Emergency caregivers for ${selectedDateStr}:`, emergencyCaregivers);
    
    // Filter regular assignments
    const regularAssignments = assignments.filter((a) => {
      if (viewMode === "current" && !a.is_current) return false;
      if (viewMode === "previous" && a.is_current) return false;
      if (activeHouseId && a.house_id !== activeHouseId) return false;
      if (activeShift && a.shift !== activeShift) return false;
      
      if (!(a.days_assigned || []).map(d => d.toLowerCase()).includes(dayName.toLowerCase())) return false;
      
      // EXCLUDE caregivers who are providing emergency coverage (they'll appear in the emergency house)
      if (emergencyCaregivers.includes(a.caregiver_id)) {
        console.log(`❌ EXCLUDING emergency caregiver ${a.caregiver_id} from their original house ${a.house_id} ${a.shift}`);
        return false;
      }
      
      return true;
    });
    
    // Add emergency coverage assignments
    const emergencyAssignments = getEmergencyCoverageAssignments().filter(ea => {
      if (activeHouseId && ea.house_id !== activeHouseId) return false;
      if (activeShift && ea.shift !== activeShift) return false;
      return true;
    });
    
    console.log(`📊 Final assignments: ${regularAssignments.length} regular + ${emergencyAssignments.length} emergency`);
    console.log("🚨 Emergency assignments:", emergencyAssignments);
    
    return [...regularAssignments, ...emergencyAssignments];
  })();

  const deleteCollection = async (collectionName) => {
    const snap = await getDocs(collection(db, collectionName));
    const batch = writeBatch(db);

    snap.docs.forEach((docSnap) => {
      batch.delete(doc(db, collectionName, docSnap.id));
    });

    await batch.commit();
    console.log(`${collectionName} cleared`);
  };

  const handleClearSchedule = async () => {
    if (!window.confirm("Are you sure you want to clear the generated schedule? This will delete all assignments in the database...")) return;

    try {
      const result = await ScheduleAPI.clearSchedule();
      if (result.success) {
        showAlert("Schedule cleared successfully!", "Success");
        // reload state so UI updates
        await loadAllAssignments();
        await loadAllElderlyAssigns();
        await loadTempReassigns();
      } else {
        showAlert(`Failed to clear schedule: ${result.message}`, "Error");
      }
    } catch (error) {
      console.error("Error clearing schedule:", error);
      showAlert(`Failed to clear schedule: ${error.message || "Unknown error occurred"}`, "Error");
    }
  };

  // Sort houses by house_id (H001 to H005)
  const sortedHouses = [...houses].sort((a, b) => {
    // Extract numeric part for comparison
    const numA = parseInt(a.house_id.replace(/\D/g, ""), 10);
    const numB = parseInt(b.house_id.replace(/\D/g, ""), 10);
    return numA - numB;
  });

  return (
    <div className="schedule-page">

      <Navbar /> {/* Always on top */}
    <main className="schedule-container">

      <h2 className="page-title">Caregiver Scheduling</h2>

      <div className="toggle-header">
        <div className="toggle-buttons">
          <button
            className={`toggle-btn ${viewMode === "current" ? "active" : ""}`}
          >
            Current Schedule
          </button>
          <button
            onClick={() => { setViewMode("previous"); }}
            className={`toggle-btn ${viewMode === "previous" ? "active" : ""}`}
            style={{ marginLeft: 8 }}
          >
            Caregiver Schedule History
          </button>
        </div>

        {scheduleInfo && (
          <div className="schedule-inline">
            <span>
              <strong>Schedule:</strong>{" "}
              {scheduleInfo.start?.toLocaleDateString()} → {scheduleInfo.end?.toLocaleDateString()}
            </span>
            <span style={{ marginLeft: 12 }}>
              <strong>Days Left:</strong> {daysLeft} {daysLeft === 1 ? "day" : "days"}
            </span>
          </div>
        )}
      </div>

      <div className="control-panel">
        <label>Duration (Months):</label>
        <select value={duration} onChange={(e) => {
          const val = parseInt(e.target.value);
          setDuration(val);
          localStorage.setItem("schedule_duration", val); // save selection
        }}>
          <option value={3}>3 Months</option>
          <option value={6}>6 Months</option>
          <option value={12}>12 Months</option>
        </select>
        <input
          type="number"
          placeholder="Custom Months"
          value={customDuration}
          onChange={(e) => {
            const val = e.target.value;
            setCustomDuration(val);
            localStorage.setItem("schedule_custom", val); // save custom input
          }}
        />
        <button onClick={handleGenerateClick}>Generate Schedule</button>
        <button onClick={handleClearSchedule} style={{ marginLeft: 8, background: '#e74c3c', color: 'white' }}>Clear Schedule</button>
        <button onClick={handleEmergencyCoverage} style={{ marginLeft: 8, background: '#f39c12', color: 'white' }}>🚨 Emergency Coverage</button>
        <button onClick={handleNewCaregiverIntegration} style={{ marginLeft: 8, background: '#28a745', color: 'white' }}>👥 Add New Caregiver</button>
      </div>

      {showOverlay && (
        <div className="overlay">
          <div className="overlay-content">
            <p>Are you sure you want to generate schedule for {pendingDuration} month(s)?</p>
            <button onClick={confirmGenerate}>Yes, Generate</button>
            <button onClick={cancelGenerate}>Cancel</button>
          </div>
        </div>
      )}

      {isGenerating && (
        <div className="popup-overlay">
          <div className="popup-card">
            <div className="loading-spinner"></div>
            <p>Generating Schedule... Please wait</p>
          </div>
        </div>
      )}

      {showSuccess && (
        <div className="overlay">
          <div className="overlay-content">
            <p>Generation of Schedule is <b>Successful!</b></p>
            <button onClick={closeSuccess}>OK</button>
          </div>
        </div>
      )}

      <div className="house-tabs">
        {sortedHouses.map((h) => (
          <button key={h.house_id} className={`house-tab ${activeHouseId === h.house_id ? "active" : ""}`} onClick={() => setActiveHouseId(h.house_id)}>
            {h.house_name}
          </button>
        ))}
      </div>

      <div className="table-container">
        <div className="table-header">
          <div className="shift-tabs">
            {shiftDefs.map((s) => (
              <button key={s.key} className={`shift-tab ${activeShift === s.key ? "active-shift" : ""}`} onClick={() => setActiveShift(s.key)}>{s.name}</button>
            ))}
          </div>
          
          {/* ========== DAYS OF WEEK TABS - COMMENT OUT THIS SECTION TO REMOVE ========== */}
          <div className="day-tabs">
            {daysOfWeek.map((day) => (
              <button
                key={day}
                className={`day-tab ${activeDay === day ? "active-day" : ""}`}
                onClick={() => {
                  setActiveDay(day);
                  // Update the date picker to show a date that matches this day
                  const currentDate = new Date(selectedDate);
                  const currentDayIndex = currentDate.getDay() === 0 ? 6 : currentDate.getDay() - 1;
                  const targetDayIndex = daysOfWeek.indexOf(day);
                  const dayDiff = targetDayIndex - currentDayIndex;
                  
                  const newDate = new Date(currentDate);
                  newDate.setDate(currentDate.getDate() + dayDiff);
                  setSelectedDate(newDate);
                }}
              >
                {day.slice(0, 3)}
              </button>
            ))}
          </div>
          {/* ========== END DAYS OF WEEK TABS SECTION ========== */}
          
          <div className="date-picker-top-right">
            <label htmlFor="date-picker" className="date-picker-label">
              Select Date:
            </label>
            <input
              id="date-picker"
              type="date"
              className="date-picker-input"
              value={formatDateString(selectedDate)}
              min={scheduleInfo?.start ? formatDateString(scheduleInfo.start) : undefined}
              max={scheduleInfo?.end ? formatDateString(scheduleInfo.end) : undefined}
              onChange={(e) => {
                // Create date in local timezone to avoid timezone issues
                const dateParts = e.target.value.split('-');
                const year = parseInt(dateParts[0]);
                const month = parseInt(dateParts[1]) - 1; // Month is 0-indexed
                const day = parseInt(dateParts[2]);
                const newDate = new Date(year, month, day);
                setSelectedDate(newDate);
                
                // Sync the day tabs with the selected date
                const dayName = daysOfWeek[newDate.getDay() === 0 ? 6 : newDate.getDay() - 1];
                setActiveDay(dayName);
              }}
            />
          </div>
        </div>

        <table className="schedule-table">
          <thead>
            <tr>
              <th>Caregiver Name</th>
              <th>Work Days</th>
              <th>Time</th>
              <th>Elderly Assigned</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredAssignments.map((a) => {
              const selectedDateStr = formatDateString(selectedDate);
              
              // Use the selected date from date picker to determine the day
              const dayName = daysOfWeek[selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1];
              
              // Enhanced absent check with debugging
              const isAbsent = !!a.is_absent && a.absent_for_date === selectedDateStr;
              
              // Check if providing emergency coverage
              const isEmergency = isProvidingEmergencyCoverage(a.caregiver_id, selectedDateStr);
              const emergencyDetails = isEmergency ? getEmergencyCoverageDetails(a.caregiver_id, selectedDateStr) : null;
              
              // Debug logging for absent status
              if (a.is_absent) {
                console.log(`ABSENT CHECK - ${caregiverName(a.caregiver_id)}:`, {
                  is_absent: a.is_absent,
                  absent_for_date: a.absent_for_date,
                  selectedDateStr: selectedDateStr,
                  datesMatch: a.absent_for_date === selectedDateStr,
                  isAbsent: isAbsent,
                  assignmentId: a.id,
                  className: isAbsent ? "absent-row" : "normal-row"
                });
              }
              
              let elders = getDisplayedEldersFor(a.caregiver_id);
              elders = elders.slice().sort((e1, e2) => {
                const n1 = `${e1.elderly_fname} ${e1.elderly_lname}`.toLowerCase();
                const n2 = `${e2.elderly_fname} ${e2.elderly_lname}`.toLowerCase();
                return n1.localeCompare(n2);
              });
              
              // Determine row styling - priority: absent > emergency > normal
              let rowClassName = "";
              if (isAbsent) {
                rowClassName = "absent-row";
              } else if (isEmergency) {
                rowClassName = "emergency-row";
              }
              
              console.log(`ROW RENDER - ${caregiverName(a.caregiver_id)} (${a.id}): className="${rowClassName}", isAbsent=${isAbsent}, isEmergency=${isEmergency}`);
              
              return (
                <tr key={a.id} className={rowClassName}>
                  <td>
                    {isEmergency && <span className="emergency-badge">🚨 EMERGENCY</span>}
                    {caregiverName(a.caregiver_id)}
                  </td>
                  <td>{(a.days_assigned || []).slice().sort((d1, d2) => daysOfWeek.indexOf(d1) - daysOfWeek.indexOf(d2)).join(", ")}</td>
                  <td>{a.time_range?.start} - {a.time_range?.end}</td>
                  <td>{elders.map((e) => `${e.elderly_fname} ${e.elderly_lname}`).join(", ")}</td>
                  <td>
                    {isAbsent ? (
                      <span className="absent-text">
                        Absent on {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    ) : isEmergency ? (
                      <span style={{ color: '#f39c12', fontWeight: 'bold', fontSize: '12px' }}>
                        🚨 Emergency Coverage<br/>
                        <small>
                          {emergencyDetails.originalHouse && emergencyDetails.emergencyHouse 
                            ? `Moved from ${emergencyDetails.originalHouse} to cover ${emergencyDetails.emergencyHouse}`
                            : emergencyDetails.reason}
                        </small>
                      </span>
                    ) : (
                      <button onClick={() => markAbsent(a.id)} className="absent-btn">
                        Mark Absent for {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </main>

      {/* Confirmation Popup */}
      {showAbsentConfirm && pendingAbsentAssignment && (
        <div className="popup-overlay">
          <div className="popup-content">
            <div className="popup-title">
              Are you really sure you want to mark <span className="caregiver-name">{caregiverName(pendingAbsentAssignment.assignment.caregiver_id)}</span> as absent? You can't undo this action.
            </div>
            <div className="popup-buttons">
              <button className="popup-btn yes" onClick={confirmMarkAbsent}>
                Yes
              </button>
              <button className="popup-btn no" onClick={cancelMarkAbsent}>
                No
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Emergency Coverage Modal */}
      {showEmergencyModal && (
        <div className="popup-overlay">
          <div className="emergency-modal">
            <div className="modal-header">
              <h3>🚨 Emergency Coverage Required</h3>
              <p>The following houses have no caregivers present on {emergencyOptions[0]?.dayName} ({emergencyOptions[0]?.targetDateStr})</p>
            </div>
            
            <div className="modal-body">
              {emergencyOptions.map((option, index) => (
                <div key={`${option.emergencyHouse}_${option.emergencyShift}`} className="emergency-option">
                  <div className="emergency-info">
                    <strong>{option.emergencyHouse} - {option.emergencyShift} Shift</strong>
                    <span className="absent-count">({option.totalAbsent} caregiver{option.totalAbsent > 1 ? 's' : ''} absent)</span>
                  </div>
                  
                  {option.availableDonorHouses.length > 0 ? (
                    <div className="donor-selection">
                      <label>Select donor house and caregiver:</label>
                      <select 
                        value={`${selectedDonorChoices[`${option.emergencyHouse}_${option.emergencyShift}`]?.donorHouse}_${selectedDonorChoices[`${option.emergencyHouse}_${option.emergencyShift}`]?.caregiverId}` || ''}
                        onChange={(e) => {
                          const [donorHouse, caregiverId] = e.target.value.split('_');
                          if (donorHouse && caregiverId) {
                            setSelectedDonorChoices(prev => ({
                              ...prev,
                              [`${option.emergencyHouse}_${option.emergencyShift}`]: {
                                donorHouse,
                                caregiverId
                              }
                            }));
                          }
                        }}
                        className="donor-select"
                      >
                        <option value="">Select caregiver...</option>
                        {option.availableDonorHouses.map(donor => 
                          donor.presentCaregivers.map(caregiver => (
                            <option 
                              key={`${donor.house}_${caregiver.caregiverId}`}
                              value={`${donor.house}_${caregiver.caregiverId}`}
                            >
                              {donor.house} - {caregiverName(caregiver.caregiverId)} ({donor.availableCount} available)
                            </option>
                          ))
                        )}
                      </select>
                      
                      {selectedDonorChoices[`${option.emergencyHouse}_${option.emergencyShift}`] && (
                        <div className="selected-choice">
                          ✓ Will move <strong>{caregiverName(selectedDonorChoices[`${option.emergencyHouse}_${option.emergencyShift}`].caregiverId)}</strong> from <strong>{selectedDonorChoices[`${option.emergencyHouse}_${option.emergencyShift}`].donorHouse}</strong> to cover <strong>{option.emergencyHouse}</strong>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="no-donors">
                      ❌ No available donors found for this shift
                    </div>
                  )}
                </div>
              ))}
            </div>
            
            <div className="modal-footer">
              <button 
                className="execute-emergency-btn" 
                onClick={executeEmergencyCoverage}
                disabled={Object.keys(selectedDonorChoices).length === 0}
              >
                Execute Emergency Coverage
              </button>
              <button className="cancel-emergency-btn" onClick={cancelEmergencyCoverage}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Caregiver Integration Modal */}
      {showNewCaregiverModal && (
        <div className="popup-overlay">
          <div className="integration-modal">
            <div className="modal-header">
              <h3>👥 New Caregiver Integration</h3>
              <p>Integrate new caregivers into the existing schedule</p>
            </div>
            
            <div className="modal-body">
              {/* Caregiver Selection */}
              <div className="caregiver-selection">
                <h4>Select New Caregiver:</h4>
                <div className="caregiver-list">
                  {unassignedCaregivers.map(caregiver => (
                    <div 
                      key={caregiver.id} 
                      className={`caregiver-item ${selectedNewCaregiver === caregiver.id ? 'selected' : ''}`}
                      onClick={() => handleCaregiverSelection(caregiver.id)}
                    >
                      <span className="caregiver-name">{caregiver.first_name} {caregiver.last_name}</span>
                      <span className="caregiver-info">ID: {caregiver.id}</span>
                    </div>
                  ))}
                </div>
              </div>

              {selectedNewCaregiver && (
                <>
                  {/* Integration Mode Selection */}
                  <div className="integration-mode">
                    <h4>Assignment Method:</h4>
                    <div className="mode-options">
                      <label className="mode-option">
                        <input 
                          type="radio" 
                          value="auto" 
                          checked={integrationMode === 'auto'}
                          onChange={(e) => setIntegrationMode(e.target.value)}
                        />
                        <span>🤖 Automatic (System Recommendation)</span>
                        <small>System analyzes current schedule and recommends optimal placement</small>
                      </label>
                      <label className="mode-option">
                        <input 
                          type="radio" 
                          value="manual" 
                          checked={integrationMode === 'manual'}
                          onChange={(e) => setIntegrationMode(e.target.value)}
                        />
                        <span>✋ Manual Assignment</span>
                        <small>Manually choose house, shift, and work days</small>
                      </label>
                    </div>
                  </div>

                  {/* Automatic Recommendations */}
                  {integrationMode === 'auto' && systemRecommendations.length > 0 && (
                    <div className="recommendations">
                      <h4>System Recommendations:</h4>
                      {systemRecommendations.slice(0, 3).map((rec, index) => (
                        <div key={index} className="recommendation-item">
                          <div className="rec-header">
                            <span className="rec-rank">#{index + 1} {index === 0 ? '(Best)' : ''}</span>
                            <span className="rec-score">Score: {rec.score}%</span>
                          </div>
                          <div className="rec-details">
                            <strong>{rec.house}</strong> - {rec.shift} Shift
                            <div className="rec-days">Work Days: {rec.workDays.join(', ')}</div>
                            <div className="rec-reason">
                              <small>{rec.reason}</small>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Manual Assignment */}
                  {integrationMode === 'manual' && (
                    <div className="manual-assignment">
                      <h4>Manual Assignment:</h4>
                      
                      <div className="assignment-fields">
                        <div className="field-group">
                          <label>House:</label>
                          <select 
                            value={manualAssignment.house} 
                            onChange={(e) => setManualAssignment(prev => ({...prev, house: e.target.value}))}
                          >
                            <option value="">Select House...</option>
                            {houses.map(house => (
                              <option key={house.house_id} value={house.house_id}>
                                {house.house_name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="field-group">
                          <label>Shift:</label>
                          <select 
                            value={manualAssignment.shift} 
                            onChange={(e) => setManualAssignment(prev => ({...prev, shift: e.target.value}))}
                          >
                            <option value="">Select Shift...</option>
                            {shiftDefs.map(shift => (
                              <option key={shift.key} value={shift.key}>
                                {shift.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="field-group">
                          <label>Work Days (Select 5 consecutive days):</label>
                          <div className="days-checkboxes">
                            {daysOfWeek.map(day => (
                              <label key={day} className="day-checkbox">
                                <input 
                                  type="checkbox"
                                  checked={manualAssignment.workDays.includes(day)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      if (manualAssignment.workDays.length < 5) {
                                        setManualAssignment(prev => ({
                                          ...prev, 
                                          workDays: [...prev.workDays, day]
                                        }));
                                      }
                                    } else {
                                      setManualAssignment(prev => ({
                                        ...prev,
                                        workDays: prev.workDays.filter(d => d !== day)
                                      }));
                                    }
                                  }}
                                />
                                {day.slice(0, 3)}
                              </label>
                            ))}
                          </div>
                          <small>Selected: {manualAssignment.workDays.length}/5 days</small>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            
            <div className="modal-footer">
              <button 
                className="execute-integration-btn" 
                onClick={executeNewCaregiverIntegration}
                disabled={!selectedNewCaregiver || (integrationMode === 'manual' && (!manualAssignment.house || !manualAssignment.shift || manualAssignment.workDays.length !== 5))}
              >
                Integrate Caregiver
              </button>
              <button className="cancel-integration-btn" onClick={cancelNewCaregiverIntegration}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Alert Modal */}
      {showCustomAlert && (
        <div className="popup-overlay">
          <div className="popup-content custom-alert">
            <div className="popup-title">
              {customAlertTitle}
            </div>
            <div className="alert-message">
              {customAlertMessage}
            </div>
            <div className="popup-buttons">
              <button className="popup-btn ok-btn" onClick={closeCustomAlert}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
