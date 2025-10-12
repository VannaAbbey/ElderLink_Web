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
import "../css/schedule.css";
import Navbar from "./navbar";
import * as ScheduleService from "../services/scheduleService";
import * as NewCaregiverService from "../services/newCaregiverService";
import * as EmergencyService from "../services/emergencyService";
import * as AbsenceService from "../services/absenceService";
import {
  formatDateString,
  isCaregiverAbsent,
  getCaregiverAbsenceDetails,
  areWorkDaysConsecutive,
  isProvidingEmergencyCoverage,
  getEmergencyCoverageDetails,
  caregiverName
} from "../services/scheduleHelpers";
import CustomAlertModal from "./customAlertModal";
import ConfirmationModal from "./confirmationModal";
import EmergencyCoverageModal from "./emergencyCoverageModal";
import NewCaregiverModal from "./newCaregiverModal";
import SearchResultsDropdown from "./searchResultsDropdown";


export default function Schedule() {
  const [caregivers, setCaregivers] = useState([]);
  const [houses, setHouses] = useState([]);
  const [elderlyList, setElderlyList] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [elderlyAssigns, setElderlyAssigns] = useState([]);
  const [tempReassigns, setTempReassigns] = useState([]);
  const [absences, setAbsences] = useState([]);

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
  const [selectedRecommendation, setSelectedRecommendation] = useState(null);
  
  // ========== DAYS OF WEEK TABS - COMMENT OUT BELOW LINES TO REMOVE ==========
  const [activeDay, setActiveDay] = useState("Monday");
  // ========== END DAYS OF WEEK TABS SECTION ==========

  // Search functionality states
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchResults, setSearchResults] = useState([]);

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

  // Search functionality
  const handleSearch = (query) => {
    setSearchQuery(query);
    
    if (!query.trim()) {
      setShowSearchResults(false);
      setSearchResults([]);
      return;
    }

    const results = [];
    const selectedDateStr = formatDateString(selectedDate);
    const queryLower = query.toLowerCase();

    // Search through all assignments
    assignments.forEach(assignment => {
      if (!assignment.is_current) return;

      const caregiver = caregivers.find(cg => cg.id === assignment.user_id);
      if (!caregiver) return;

      const caregiverName = `${caregiver.user_fname} ${caregiver.user_lname}`.toLowerCase();
      
      // Check if caregiver name matches search query
      if (caregiverName.includes(queryLower)) {
        const house = houses.find(h => h.house_id === assignment.house_id);
        const houseName = house?.house_name || assignment.house_id;
        
        // Get absence status
        const absenceDetails = getCaregiverAbsenceDetails(assignment.user_id, selectedDateStr, absences);
        
        // Get assigned elderly for this caregiver
        const assignedElderly = getDisplayedEldersFor(assignment.user_id);
        
        // Check if providing emergency coverage
        const isEmergency = isProvidingEmergencyCoverage(assignment.user_id, selectedDateStr, tempReassigns);
        
        results.push({
          caregiver: caregiver,
          assignment: assignment,
          houseName: houseName,
          absenceDetails: absenceDetails,
          assignedElderly: assignedElderly,
          isEmergency: isEmergency
        });
      }
    });

    setSearchResults(results);
    setShowSearchResults(true);
  };

  const clearSearch = () => {
    setSearchQuery("");
    setShowSearchResults(false);
    setSearchResults([]);
  };

  const navigateToCaregiver = (houseId, shift) => {
    setActiveHouseId(houseId);
    setActiveShift(shift);
    setShowSearchResults(false);
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
      collection(db, "house_shift_assignments"),
      where("is_current", "==", true),
      where("user_type", "==", "caregiver")
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
      collection(db, "house_shift_assignments"),
      where("is_current", "==", false),
      where("user_type", "==", "caregiver")
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
    const q = query(
      collection(db, "elderly_assignments"),
      where("user_type", "==", "caregiver")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setElderlyAssigns(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "temporary_assignments"),
      (snapshot) => {
        setTempReassigns(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    console.log(`🔄 Setting up real-time listener for nurse_cg_absence collection...`);
    
    // Debug: Query ALL absences to see what's in the database
    const debugQuery = async () => {
      const allAbsencesSnapshot = await getDocs(collection(db, "nurse_cg_absence"));
      console.log(`🔍 DEBUG: Total records in nurse_cg_absence collection: ${allAbsencesSnapshot.docs.length}`);
      if (allAbsencesSnapshot.docs.length > 0) {
        console.log(`🔍 DEBUG: All absence records:`, allAbsencesSnapshot.docs.map(d => ({
          id: d.id,
          user_id: d.data().user_id,
          absence_date: d.data().absence_date,
          absence_type: d.data().absence_type,
          status: d.data().status,
          is_leave: d.data().is_leave,
          do_not_clear: d.data().do_not_clear,
          created_at: d.data().created_at?.toDate?.()
        })));
      }
    };
    debugQuery();
    
    // SUPER DEBUG: Listen to ALL documents in the collection to catch status changes
    const debugUnsubscribe = onSnapshot(
      collection(db, "nurse_cg_absence"),
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const data = change.doc.data();
          if (change.type === "added") {
            console.log(`🆕 NEW absence record created:`, {
              id: change.doc.id,
              user_id: data.user_id,
              absence_date: data.absence_date,
              status: data.status,
              absence_type: data.absence_type
            });
          }
          if (change.type === "modified") {
            console.log(`✏️ MODIFIED absence record:`, {
              id: change.doc.id,
              user_id: data.user_id,
              absence_date: data.absence_date,
              OLD_status: '???', // We can't see old value, but if you see this log, something is modifying records
              NEW_status: data.status,
              absence_type: data.absence_type
            });
            console.warn(`🚨 ALERT: Something just modified an absence record! Check what triggered this.`);
          }
          if (change.type === "removed") {
            console.log(`🗑️ DELETED absence record:`, {
              id: change.doc.id,
              user_id: data.user_id,
              absence_date: data.absence_date
            });
          }
        });
      }
    );
    
    const unsubscribe = onSnapshot(
      query(
        collection(db, "nurse_cg_absence"),
        where("status", "==", "active")
      ),
      (snapshot) => {
        const absencesData = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        console.log(`✅ Loaded ${absencesData.length} active absences from database`);
        if (absencesData.length > 0) {
          console.log(`Sample absences:`, absencesData.slice(0, 3).map(a => ({
            user_id: a.user_id,
            absence_date: a.absence_date,
            absence_type: a.absence_type,
            status: a.status
          })));
        } else {
          console.warn(`⚠️ No active absences found. This might mean:`);
          console.warn(`  1. No absence records exist at all`);
          console.warn(`  2. All records have status != "active"`);
          console.warn(`  3. There's a database query issue`);
        }
        setAbsences(absencesData);
      },
      (error) => {
        console.error(`❌ Error loading absences:`, error);
      }
    );
    return () => {
      unsubscribe();
      debugUnsubscribe();
    };
  }, []);

  // Fetch and display schedule info from current assignments (regardless of view mode)
  useEffect(() => {
    const fetchScheduleInfo = async () => {
      try {
        // Always fetch current assignments to show schedule info
        const currentAssignments = await ScheduleService.fetchAssignments(true);
        
        if (!currentAssignments || currentAssignments.length === 0) {
          console.log("📅 No current assignments found - schedule info will be blank");
          setScheduleInfo(null);
          setDaysLeft(null);
          return;
        }

        // Get the first current assignment (they all share same start/end dates)
        const firstAssignment = currentAssignments[0];
        
        // Handle both old format (start_date/end_date at root) and new format (inside schedule_period)
        let start, end;
        
        if (firstAssignment.schedule_period) {
          // New format - dates are inside schedule_period object
          console.log("📅 Reading schedule info from schedule_period:", firstAssignment.schedule_period);
          start = firstAssignment.schedule_period.start_date?.toDate ? 
                  firstAssignment.schedule_period.start_date.toDate() : 
                  new Date(firstAssignment.schedule_period.start_date);
          end = firstAssignment.schedule_period.end_date?.toDate ? 
                firstAssignment.schedule_period.end_date.toDate() : 
                new Date(firstAssignment.schedule_period.end_date);
        } else {
          // Old format - dates at root level (fallback for older schedules)
          console.log("📅 Reading schedule info from root level (old format)");
          start = firstAssignment.start_date?.toDate ? 
                  firstAssignment.start_date.toDate() : 
                  (firstAssignment.start_date ? new Date(firstAssignment.start_date) : null);
          end = firstAssignment.end_date?.toDate ? 
                firstAssignment.end_date.toDate() : 
                (firstAssignment.end_date ? new Date(firstAssignment.end_date) : null);
        }

        if (start && end) {
          console.log(`📅 Schedule info loaded: ${start.toLocaleDateString()} → ${end.toLocaleDateString()}`);
          setScheduleInfo({ start, end });

          // Compute countdown days
          const today = new Date();
          const diffMs = end.getTime() - today.getTime();
          const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          const daysLeftCount = diffDays > 0 ? diffDays : 0;
          console.log(`📅 Days left: ${daysLeftCount}`);
          setDaysLeft(daysLeftCount);
        } else {
          console.warn("⚠️ Schedule dates are missing or invalid");
          setScheduleInfo(null);
          setDaysLeft(null);
        }
      } catch (error) {
        console.error("❌ Error fetching schedule info:", error);
        setScheduleInfo(null);
        setDaysLeft(null);
      }
    };

    fetchScheduleInfo();
  }, [viewMode]); // Re-fetch when view mode changes to ensure info is always up to date

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
      const data = await ScheduleService.fetchStaticData();
      setCaregivers(data.caregivers);
      setHouses(data.houses);
      setElderlyList(data.elderly);

      // Set H001 (St. Sebastian) as default house if present
      if (!activeHouseId && data.houses.length) {
        const defaultHouse = data.houses.find(h => h.house_id === "H001") || data.houses[0];
        setActiveHouseId(defaultHouse.house_id);
      }

      const v = await ScheduleService.getMaxVersion();
      setCurrentVersion(v);
    } catch (error) {
      console.error("Error loading static data:", error);
      showAlert("Failed to load data. Please refresh the page.", "Error");
    }
  };

  const loadAllAssignments = async () => {
    try {
      const isCurrent = viewMode === "current";
      const data = await ScheduleService.fetchAssignments(isCurrent);
      setAssignments(data);
    } catch (error) {
      console.error("Error loading assignments:", error);
    }
  };

  const loadAllElderlyAssigns = async () => {
    try {
      const data = await ScheduleService.fetchElderlyAssignments();
      setElderlyAssigns(data);
    } catch (error) {
      console.error("Error loading elderly assignments:", error);
    }
  };

  const loadTempReassigns = async () => {
    try {
      const data = await ScheduleService.fetchTempReassignments();
      setTempReassigns(data);
    } catch (error) {
      console.error("Error loading temp reassignments:", error);
    }
  };

  // Schedule generation function - now uses API service
  const handleScheduleGeneration = async (months) => {
    try {
      const result = await ScheduleService.generateSchedule(months, {
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
      
      const emergencyCheck = await EmergencyService.checkEmergencyNeedsAndDonors(selectedDateStr, assignments, elderlyAssigns, tempReassigns);
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
      
      const result = await EmergencyService.activateEmergencyCoverage(selectedDateStr, assignments, elderlyAssigns, tempReassigns, donorChoices);
      
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
    console.log(`%c🔧 TEST: Console logging is working! Button clicked.`, 'color: red; font-size: 14px; font-weight: bold;');
    try {
      // Refresh static data first to ensure we have latest caregiver info
      await loadStaticData();
      
      // Then detect unassigned caregivers
      const unassigned = await NewCaregiverService.detectUnassignedCaregivers();
      
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
    setSelectedRecommendation(null); // Reset selected recommendation
    
    if (integrationMode === 'auto') {
      // Generate system recommendations
      try {
        const recommendations = await NewCaregiverService.generateCaregiverRecommendations(caregiverId, assignments, houses);
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
      
      if (integrationMode === 'auto') {
        if (!selectedRecommendation) {
          showAlert("Please select a system recommendation first.", "No Recommendation Selected");
          return;
        }
        // Use the selected recommendation
        assignmentData = selectedRecommendation;
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
      const result = await NewCaregiverService.integrateNewCaregiver(selectedNewCaregiver, assignmentData, assignments, elderlyAssigns, houses);
      
      if (result.success) {
        console.log(`✅ Integration successful: ${result.elderlyAssigned} elderly assigned to new caregiver, ${result.totalElderlyRedistributed} total redistributed`);
      console.log(`%c🎉 INTEGRATION COMPLETED SUCCESSFULLY!`, 'color: green; font-size: 16px; font-weight: bold;');
      console.log(`%cNew caregiver assignments: ${result.elderlyAssigned}`, 'color: green; font-weight: bold;');
      console.log(`%cTotal redistributed: ${result.totalElderlyRedistributed}`, 'color: blue; font-weight: bold;');
        
        // Force a complete data refresh with proper timing
        console.log("🔄 Refreshing all schedule data after integration...");
        
        // Wait a bit for database operations to fully complete
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Refresh all data including caregivers list FIRST
        await loadStaticData(); // This will refresh the caregivers list so names show properly
        await loadAllAssignments();
        await loadAllElderlyAssigns();
        
        // Additional delay to ensure UI state is fully updated
        await new Promise(resolve => setTimeout(resolve, 200));
        
        console.log("✅ Data refresh completed after caregiver integration");
        
        showAlert(`Successfully integrated caregiver into the schedule!\n\nAssigned to: ${assignmentData.house}\nShift: ${assignmentData.shift}\nWork Days: ${assignmentData.workDays.join(', ')}\n\nTotal elderly redistributed: ${result.totalElderlyRedistributed}\nNew caregiver assigned: ${result.elderlyAssigned} elderly`, "Integration Successful");
        
        // Reset modal state
        setShowNewCaregiverModal(false);
        setSelectedNewCaregiver(null);
        setIntegrationMode('auto');
        setManualAssignment({ house: '', shift: '', workDays: [] });
        setSystemRecommendations([]);
        setSelectedRecommendation(null);
        
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
    setSelectedRecommendation(null);
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
      const result = await AbsenceService.markCaregiverAbsentWithEmergencyCheck(
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

  // --- Reset outdated absences (from previous days only) on component mount ---
  useEffect(() => {
    const resetOutdatedAbsences = async () => {
      try {
        console.log("🔄 Schedule component mounted - checking for outdated absences...");
        const result = await AbsenceService.resetDailyAbsences();
        console.log("📋 Reset result:", result);
        await loadAllAssignments();
      } catch (error) {
        console.error("Error resetting outdated absences:", error);
      }
    };

    resetOutdatedAbsences();
  }, []);

  const getDisplayedEldersFor = (caregiverId) => {
  const selectedDateStr = formatDateString(selectedDate);
  
  // Use the selected date from date picker to determine the day
  const dayName = daysOfWeek[selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1];
  
  console.log(`=== DISPLAYING ELDERLY FOR CAREGIVER ${caregiverId} ===`);
  console.log(`Selected date: ${selectedDateStr} (${dayName}), Current version: ${currentVersion}`);
  
  // First, check if this caregiver is marked as absent for this specific date
  const isAbsentForThisDate = isCaregiverAbsent(caregiverId, selectedDateStr, absences);
  
  if (isAbsentForThisDate) {
    console.log(`Caregiver ${caregiverId} is marked ABSENT for ${selectedDateStr} - showing no elderly assignments`);
    return []; // Return empty array - all elderly should be reassigned to others
  }
  
  const base = elderlyAssigns
    .filter(
      (ea) =>
        ea.user_id === caregiverId &&
        ea.assign_version === currentVersion &&
        ea.day?.toLowerCase() === dayName.toLowerCase()
    )
    .flatMap((ea) => ea.elderly_ids || []); // Handle array structure
  
  console.log(`Base assignments for ${caregiverId} on ${dayName}: ${base.length}`, base);

  const toTemp = tempReassigns
    .filter(
      (t) =>
        t.to_user_id === caregiverId &&
        t.date === selectedDateStr &&
        t.assign_version === currentVersion
    )
    .flatMap((t) => t.elderly_ids || []); // Handle array structure
    
  console.log(`Temp assignments TO ${caregiverId} for ${selectedDateStr}: ${toTemp.length}`, toTemp);

  const fromTemp = tempReassigns
    .filter(
      (t) =>
        t.from_user_id === caregiverId &&
        t.date === selectedDateStr &&
        t.assign_version === currentVersion
    )
    .flatMap((t) => t.elderly_ids || []); // Handle array structure
    
  console.log(`Temp assignments FROM ${caregiverId} for ${selectedDateStr}: ${fromTemp.length}`, fromTemp);

  const finalIds = [...new Set(base.filter((id) => !fromTemp.includes(id)).concat(toTemp))]; // Remove duplicates
  console.log(`Final elderly IDs for ${caregiverId}: ${finalIds.length}`, finalIds);
  
  const elders = finalIds
    .map((id) => {
      const elderly = elderlyList.find((e) => e.id === id);
      if (!elderly) {
        console.warn(`⚠️ Elderly not found: ${id}. Available elderly:`, 
          elderlyList.slice(0, 3).map(e => ({ id: e.id, name: `${e.elderly_fname} ${e.elderly_lname}` }))
        );
        return { id: id, elderly_fname: "Unknown", elderly_lname: `(${id.substring(0, 8)}...)` };
      }
      return elderly;
    })
    .filter(Boolean);

  console.log(`Final elderly objects for ${caregiverId}:`, elders.map(e => `${e.elderly_fname} ${e.elderly_lname}`));
  console.log(`=== END DISPLAY DEBUG ===`);
  
  return elders;
};

  // Get emergency coverage assignments for display
  const getEmergencyCoverageAssignments = () => {
    const selectedDateStr = formatDateString(selectedDate);
    const dayName = daysOfWeek[selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1];
    
    // Find emergency coverage temp assignments
    const emergencyTempAssigns = tempReassigns.filter(tr => 
      tr.date === selectedDateStr && 
      tr.from_user_id === "EMERGENCY_ABSENT"
    );
    
    // Group by caregiver to create virtual assignments
    const emergencyAssignments = [];
    const emergencyCaregivers = new Set();
    
    emergencyTempAssigns.forEach(ta => {
      emergencyCaregivers.add(ta.to_user_id);
    });
    
    // For each emergency caregiver, find which house/shift they're covering
    emergencyCaregivers.forEach(caregiverId => {
      // Get the first emergency temp assignment to parse the reason
      const firstEmergencyAssign = emergencyTempAssigns.find(ta => ta.to_user_id === caregiverId);
      
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
          
          // Find the shift times by looking at any assignment with this shift
          const referenceAssignment = assignments.find(a => a.shift === emergencyShift && a.is_current);
          const startTime = referenceAssignment?.start_time || "06:00";
          const endTime = referenceAssignment?.end_time || "14:00";
          
          // Create a virtual assignment for the emergency caregiver in the emergency house/shift
          emergencyAssignments.push({
            id: `emergency_${caregiverId}_${emergencyHouseId}_${emergencyShift}`,
            user_id: caregiverId,
            house_id: emergencyHouseId,
            shift: emergencyShift,
            days_assigned: [dayName],
            is_current: true,
            is_emergency_coverage: true,
            start_time: startTime,
            end_time: endTime,
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
      .filter(tr => tr.date === selectedDateStr && tr.from_user_id === "EMERGENCY_ABSENT")
      .map(tr => tr.to_user_id);
    
    console.log(`🚨 Emergency caregivers for ${selectedDateStr}:`, emergencyCaregivers);
    
    // Filter regular assignments
    const regularAssignments = assignments.filter((a) => {
      if (viewMode === "current" && !a.is_current) return false;
      if (viewMode === "previous" && a.is_current) return false;
      if (activeHouseId && a.house_id !== activeHouseId) return false;
      if (activeShift && a.shift !== activeShift) return false;
      
      if (!(a.days_assigned || []).map(d => d.toLowerCase()).includes(dayName.toLowerCase())) return false;
      
      // EXCLUDE caregivers who are providing emergency coverage (they'll appear in the emergency house)
      if (emergencyCaregivers.includes(a.user_id)) {
        console.log(`❌ EXCLUDING emergency caregiver ${a.user_id} from their original house ${a.house_id} ${a.shift}`);
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
      const result = await ScheduleService.clearSchedule();
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

  const handleCleanupOrphanedAssignments = async () => {
    if (!window.confirm("This will remove assignments for caregivers/elderly that no longer exist in the system. Are you sure?")) return;

    try {
      // Clean up both caregiver and elderly assignments
      const [caregiverResult, elderlyResult] = await Promise.all([
        ScheduleService.findOrphanedAssignments(true),
        ScheduleService.findOrphanedElderlyAssignments(true)
      ]);
      
      const totalCleaned = caregiverResult.count + elderlyResult.count;
      
      if (totalCleaned > 0) {
        showAlert(
          `Successfully cleaned up:\n• ${caregiverResult.count} orphaned caregiver assignment(s)\n• ${elderlyResult.count} orphaned elderly assignment(s)\n\nThe "Unknown" entries should now be gone.`, 
          "Cleanup Complete"
        );
        // Reload data to reflect changes
        await loadStaticData();
        await loadAllAssignments();
        await loadAllElderlyAssigns();
      } else {
        showAlert("No orphaned assignments found. All assignments have valid caregivers and elderly.", "Nothing to Clean");
      }
    } catch (error) {
      console.error("Error cleaning up orphaned assignments:", error);
      showAlert(`Failed to clean up assignments: ${error.message || "Unknown error occurred"}`, "Error");
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
          {/* <button
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
          </button> */}
        </div>

        {scheduleInfo && (
          <div className="schedule-inline">
            <span>
              <strong>Schedule:</strong>{" "}
              {scheduleInfo.start?.toLocaleDateString()} → {scheduleInfo.end?.toLocaleDateString()}
            </span>
            <span>
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
          min="1"
          max="36"
          onKeyDown={(e) => {
            // Prevent typing letters, special characters (except backspace, delete, arrow keys, tab)
            if (!/[0-9]/.test(e.key) && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) {
              e.preventDefault();
            }
          }}
          onChange={(e) => {
            const val = e.target.value;
            // Only allow positive numbers
            if (val === '' || (parseInt(val) > 0 && parseInt(val) <= 36)) {
              setCustomDuration(val);
              localStorage.setItem("schedule_custom", val); // save custom input
            }
          }}
        />
        <button onClick={handleGenerateClick}>Generate Schedule</button>
        <button onClick={handleClearSchedule} style={{ marginLeft: 8, background: '#e74c3c', color: 'white' }}>Clear Schedule</button>
        {/* <button onClick={handleCleanupOrphanedAssignments} style={{ marginLeft: 8, background: '#dc3545', color: 'white' }}>🧹 Fix Unknown</button> */}
        <button onClick={handleEmergencyCoverage} style={{ marginLeft: 8, background: '#f39c12', color: 'white' }}>🚨 Emergency Coverage</button>
        <button onClick={handleNewCaregiverIntegration} style={{ marginLeft: 8, background: '#28a745', color: 'white' }}>👥 Add New Caregiver</button>
      </div>

      {/* Search Bar */}
      <div className="search-panel">
        <div className="search-input-wrapper">
          <input
            type="text"
            placeholder="🔍 Search caregiver by name..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="caregiver-search-input"
          />
          {searchQuery && (
            <button onClick={clearSearch} className="clear-search-btn">
              ✕
            </button>
          )}
        </div>
        
        <SearchResultsDropdown
          isOpen={showSearchResults}
          searchQuery={searchQuery}
          searchResults={searchResults}
          onNavigate={navigateToCaregiver}
        />
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
              <th>Elderly Assigned</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredAssignments.map((a) => {
              const selectedDateStr = formatDateString(selectedDate);
              
              // Use the selected date from date picker to determine the day
              const dayName = daysOfWeek[selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1];
              
              // Check absence status using centralized collection with detailed info
              const absenceDetails = getCaregiverAbsenceDetails(a.user_id, selectedDateStr, absences);
              const isAbsent = absenceDetails.isAbsent;
              const isOnLeave = absenceDetails.type === "on_leave";
              
              // Check if providing emergency coverage
              const isEmergency = isProvidingEmergencyCoverage(a.user_id, selectedDateStr, tempReassigns);
              const emergencyDetails = isEmergency ? getEmergencyCoverageDetails(a.user_id, selectedDateStr, tempReassigns) : null;
              
              // Debug logging for absent status
              if (isAbsent) {
                console.log(`ABSENT CHECK - ${caregiverName(a.user_id, caregivers)}:`, {
                  caregiverId: a.user_id,
                  selectedDateStr: selectedDateStr,
                  isAbsent: isAbsent,
                  assignmentId: a.id,
                  className: "absent-row"
                });
              }
              
              let elders = getDisplayedEldersFor(a.user_id);
              elders = elders.slice().sort((e1, e2) => {
                const n1 = `${e1.elderly_fname} ${e1.elderly_lname}`.toLowerCase();
                const n2 = `${e2.elderly_fname} ${e2.elderly_lname}`.toLowerCase();
                return n1.localeCompare(n2);
              });
              
              // Determine row styling - priority: on leave > absent > emergency > normal
              let rowClassName = "";
              if (isOnLeave) {
                rowClassName = "on-leave-row";
              } else if (isAbsent) {
                rowClassName = "absent-row";
              } else if (isEmergency) {
                rowClassName = "emergency-row";
              }
              
              console.log(`ROW RENDER - ${caregiverName(a.user_id, caregivers)} (${a.id}): className="${rowClassName}", isAbsent=${isAbsent}, isEmergency=${isEmergency}`);
              
              return (
                <tr key={a.id} className={rowClassName}>
                  <td>
                    {isEmergency && <span className="emergency-badge">🚨</span>}
                    {caregiverName(a.user_id, caregivers)}
                  </td>
                  <td>{(a.days_assigned || []).slice().sort((d1, d2) => daysOfWeek.indexOf(d1) - daysOfWeek.indexOf(d2)).join(", ")}</td>
                  <td>{elders.map((e) => `${e.elderly_fname} ${e.elderly_lname}`).join(", ")}</td>
                  <td>
                    {isOnLeave ? (
                      <span className="on-leave-text">
                        🏖️ On Leave on {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}<br/>
                        {absenceDetails.reason && (
                          <small style={{ color: '#4caf50', fontStyle: 'italic' }}>
                            {absenceDetails.reason}
                          </small>
                        )}
                      </span>
                    ) : isAbsent ? (
                      <span className="absent-text">
                        ❌ Absent on {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
      <ConfirmationModal
        isOpen={showAbsentConfirm && !!pendingAbsentAssignment}
        caregiverName={pendingAbsentAssignment ? caregiverName(pendingAbsentAssignment.assignment.user_id, caregivers) : ''}
        onConfirm={confirmMarkAbsent}
        onCancel={cancelMarkAbsent}
      />

      {/* Emergency Coverage Modal */}
      <EmergencyCoverageModal
        isOpen={showEmergencyModal}
        emergencyOptions={emergencyOptions}
        selectedDonorChoices={selectedDonorChoices}
        setSelectedDonorChoices={setSelectedDonorChoices}
        caregiverName={(id) => caregiverName(id, caregivers)}
        onExecute={executeEmergencyCoverage}
        onCancel={cancelEmergencyCoverage}
      />

      {/* New Caregiver Integration Modal */}
      <NewCaregiverModal
        isOpen={showNewCaregiverModal}
        unassignedCaregivers={unassignedCaregivers}
        selectedNewCaregiver={selectedNewCaregiver}
        handleCaregiverSelection={handleCaregiverSelection}
        integrationMode={integrationMode}
        setIntegrationMode={setIntegrationMode}
        setSelectedRecommendation={setSelectedRecommendation}
        systemRecommendations={systemRecommendations}
        selectedRecommendation={selectedRecommendation}
        manualAssignment={manualAssignment}
        setManualAssignment={setManualAssignment}
        houses={houses}
        shiftDefs={shiftDefs}
        daysOfWeek={daysOfWeek}
        areWorkDaysConsecutive={(workDays) => areWorkDaysConsecutive(workDays, daysOfWeek)}
        onExecute={executeNewCaregiverIntegration}
        onCancel={cancelNewCaregiverIntegration}
      />

      {/* Custom Alert Modal */}
      <CustomAlertModal
        isOpen={showCustomAlert}
        title={customAlertTitle}
        message={customAlertMessage}
        onClose={closeCustomAlert}
      />

    </div>
  );
}