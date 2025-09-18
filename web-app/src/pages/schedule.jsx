import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  addDoc,
  query,
  where,
  Timestamp,
  doc,
  updateDoc,
  deleteDoc,
  orderBy,
  writeBatch,
  limit,
  onSnapshot
} from "firebase/firestore";
import "./schedule.css";
import Navbar from "./navbar";


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
  const [activeDay, setActiveDay] = useState("Monday");

  const [scheduleInfo, setScheduleInfo] = useState(null);
  const [daysLeft, setDaysLeft] = useState(null);


  // 3-shift schedule definitions
  const shiftDefs = [
    { name: "1st Shift (6:00 AM - 2:00 PM)", key: "1st", time_range: { start: "06:00", end: "14:00" } },
    { name: "2nd Shift (2:00 PM - 10:00 PM)", key: "2nd", time_range: { start: "14:00", end: "22:00" } },
    { name: "3rd Shift (10:00 PM - 6:00 AM)", key: "3rd", time_range: { start: "22:00", end: "06:00" } },
  ];
  const [activeShift, setActiveShift] = useState(shiftDefs[0].key);

  const [currentVersion, setCurrentVersion] = useState(0);

  const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  //code for rest day modal
  const [showRestDayModal, setShowRestDayModal] = useState(false);
  const [selectedCaregiverAssignId, setSelectedCaregiverAssignId] = useState(null);
  const [selectedCaregiverName, setSelectedCaregiverName] = useState("");
  const [selectedRestDays, setSelectedRestDays] = useState([]);


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
        await distributeCaregivers(months);
      }
    };

    checkAutoReshuffle();
  }, [assignments]); // runs whenever assignments are loaded/updated

    // inside your Schedule component
  useEffect(() => {
    // build the query to only get current schedules
    const q = query(
      collection(db, "cg_house_assign"),
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
      collection(db, "cg_house_assign"),
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
      collection(db, "elderly_caregiver_assign"),
      (snapshot) => {
        setElderlyAssigns(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
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

  // --- Loaders ---
  const loadStaticData = async () => {
    const cgSnap = await getDocs(query(collection(db, "users"), where("user_type", "==", "caregiver")));
    const houseSnap = await getDocs(collection(db, "house"));
    const elderlySnap = await getDocs(collection(db, "elderly"));

    const cgList = cgSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const houseList = houseSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const elderly = elderlySnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    setCaregivers(cgList);
    setHouses(houseList);
    setElderlyList(elderly);

    // Set H001 (St. Sebastian) as default house if present
    if (!activeHouseId && houseList.length) {
      const defaultHouse = houseList.find(h => h.house_id === "H001") || houseList[0];
      setActiveHouseId(defaultHouse.house_id);
    }

    const v = await getMaxVersion();
    setCurrentVersion(v);
  };

  const loadAllAssignments = async () => {
    let q;
    if (viewMode === "current") q = query(collection(db, "cg_house_assign"), where("is_current", "==", true));
    else q = query(collection(db, "cg_house_assign"), where("is_current", "==", false));
    const snap = await getDocs(q);
    setAssignments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  const loadAllElderlyAssigns = async () => {
    const snap = await getDocs(collection(db, "elderly_caregiver_assign"));
    setElderlyAssigns(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  const loadTempReassigns = async () => {
    const snap = await getDocs(collection(db, "temp_reassignments"));
    setTempReassigns(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  const getMaxVersion = async () => {
    const snap = await getDocs(collection(db, "cg_house_assign"));
    if (snap.empty) return 0;
    const versions = snap.docs.map((d) => d.data().version || 0);
    return Math.max(...versions);
  };

  const getEndDate = (months) => {
    const end = new Date();
    end.setMonth(end.getMonth() + months);
    return end;
  };

  const handleGenerateClick = () => {
    const months = customDuration ? parseInt(customDuration) : duration;
    setPendingDuration(months);
    setShowOverlay(true);
  };

  // helper: split arr into n groups as even as possible
  const splitIntoChunks = (arr, n) => {
    if (!arr || arr.length === 0) return Array.from({ length: n }, () => []);
    const res = Array.from({ length: n }, () => []);
    for (let i = 0; i < arr.length; i++) {
      res[i % n].push(arr[i]);
    }
    return res;
  };

    // helper to fetch each caregiver's last house
  const getLastHouseMap = async () => {
    const snap = await getDocs(
      query(collection(db, "cg_house_assign"), orderBy("created_at", "desc"))
    );

    const lastMap = {};
    snap.docs.forEach((d) => {
      const data = d.data();
      if (!lastMap[data.caregiver_id]) {
        lastMap[data.caregiver_id] = data.house_id;
      }
    });
    return lastMap;
  };

const distributeCaregivers = async (months) => {
  // 🔹 1. Deactivate *only* current assignments (same as before)
  const allAssignSnap = await getDocs(
    query(collection(db, "cg_house_assign"), where("is_current", "==", true))
  );

  let batch = writeBatch(db);
  let writeCount = 0;
  const BATCH_SIZE = 450; // commit threshold (adjust if needed)

  for (const d of allAssignSnap.docs) {
    batch.update(doc(db, "cg_house_assign", d.id), { is_current: false });
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

  // 🔹 3. House weights (same)
  const weights = {
    H002: 2,
    H003: 2,
    H001: 1,
    H004: 1,
    H005: 1,
  };
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  // 🔹 4. Caregivers per house (proportional)
  const caregiversPerHouse = {};
  for (const house of houses) {
    const w = weights[house.house_id] || 1;
    caregiversPerHouse[house.house_id] = Math.max(
      1,
      Math.floor((caregivers.length * w) / totalWeight)
    );
  }

  // 🔹 5. Last-house history (avoid repeating)
  const lastHouseMap = await getLastHouseMap();

  // 🔹 6. Shuffle caregivers pool
  const pool = [...caregivers].sort(() => Math.random() - 0.5);

  // 🔹 7. Assign caregivers to houses (weighted)
  let poolIdx = 0;
  const houseAssignments = {}; // houseId -> array of caregiver objects
  for (const house of houses) {
    const count = caregiversPerHouse[house.house_id] || 1;
    houseAssignments[house.house_id] = [];

    for (let i = 0; i < count && poolIdx < pool.length; i++) {
      const cg = pool[poolIdx];
      // Avoid giving caregiver the same last house when possible
      if (lastHouseMap[cg.id] === house.house_id) {
        pool.push(pool.splice(poolIdx, 1)[0]); // move to end
        i--;
        continue;
      }
      houseAssignments[house.house_id].push(cg);
      poolIdx++;
    }
  }

  // If any caregivers remain in pool (not enough weight slots) assign them to houses round-robin
  if (poolIdx < pool.length) {
    const remaining = pool.slice(poolIdx);
    const houseIds = houses.map((h) => h.house_id);
    let rIdx = 0;
    for (const cg of remaining) {
      const hid = houseIds[rIdx % houseIds.length];
      houseAssignments[hid] = houseAssignments[hid] || [];
      houseAssignments[hid].push(cg);
      rIdx++;
    }
  }

  // Helper: ensure dayCounts container for each house+shift
  const ensureDayCounts = (obj, key) => {
    if (!obj[key]) obj[key] = daysOfWeek.map(() => 0);
    return obj[key];
  };

  // 🔹 8. For each house: split into shifts, assign days per caregiver, THEN distribute elderly per day
  for (const house of houses) {
    const assignedCGs = houseAssignments[house.house_id] || [];
    if (!assignedCGs.length) continue;

    // split caregivers into 3 shift groups as evenly as possible
    const shiftCaregivers = splitIntoChunks(assignedCGs, 3);

    // house elders (all elderly that belong to this house)
    const houseElders = elderlyList.filter((e) => e.house_id === house.house_id) || [];

    // We'll keep references to assignRef IDs per caregiver so we can relate per-day elder assignments
    const assignRefsByCaregiver = {}; // caregiverId -> { assignRef, shift, days_assigned }

    for (let s = 0; s < 3; s++) {
      const cgInShift = shiftCaregivers[s] || [];
      if (!cgInShift.length) continue;

      // day counts keyed by house_shift to balance days across caregivers in same house+shift
      const dayCountsKey = `${house.house_id}_${shiftDefs[s].key}_dayCounts`;
      const dayCounts = ensureDayCounts(houseAssignments, dayCountsKey);

      // For each caregiver in this shift: pick 5 least-loaded days (balanced)
      for (let i = 0; i < cgInShift.length; i++) {
        const cg = cgInShift[i];
        // choose 5 days with smallest counts
        let dayIndexes = daysOfWeek.map((_, idx) => idx);
        dayIndexes.sort((a, b) => dayCounts[a] - dayCounts[b] || Math.random() - 0.5);
        const selectedIndexes = dayIndexes.slice(0, 5);
        const days_assigned = selectedIndexes.map((idx) => daysOfWeek[idx]);
        // update day counts
        selectedIndexes.forEach((idx) => (dayCounts[idx]++));
        // create cg_house_assign doc for the caregiver/shift
        const shift = shiftDefs[s].key;
        const time_range = shiftDefs[s].time_range;

        const assignRef = doc(collection(db, "cg_house_assign"));
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

        // Save the assignRef for later linking per-day elder assignment
        assignRefsByCaregiver[cg.id] = {
          assignRefId: assignRef.id,
          shift,
          days_assigned,
        };

        // commit batch if needed
        if (writeCount >= BATCH_SIZE) {
          await batch.commit();
          batch = writeBatch(db);
          writeCount = 0;
        }
      }
    }

    // --- Now: per-day distribution of elders among active caregivers (house-level, per shift) ---
    // For each day of the week, for each shift, find the caregivers active that day+shift and split the houseElders among them.
    for (let s = 0; s < 3; s++) {
      const shiftKey = shiftDefs[s].key;
      // list caregivers in this house & shift from assignRefsByCaregiver
      const cgIdsInShift = Object.keys(assignRefsByCaregiver).filter(
        (cid) => assignRefsByCaregiver[cid].shift === shiftKey
      );

      if (cgIdsInShift.length === 0) continue;

      // For each day
      for (const day of daysOfWeek) {
        // caregivers active that day
        const activeCgIds = cgIdsInShift.filter((cid) =>
          (assignRefsByCaregiver[cid].days_assigned || []).map(d => d.toLowerCase()).includes(day.toLowerCase())
        );

        if (activeCgIds.length === 0) {
          // no caregivers for this shift/day -> skip (no assignment)
          continue;
        }

        // split the house elders among active caregivers for this day
        const elderChunks = splitIntoChunks(houseElders, activeCgIds.length);

        // create elderly_caregiver_assign entries per caregiver for this day
        for (let i = 0; i < activeCgIds.length; i++) {
          const targetCgId = activeCgIds[i];
          const elderChunk = elderChunks[i] || [];

          // If no elders assigned to this chunk, skip
          if (!elderChunk.length) continue;

          // Use previously created assignRefId for the caregiver
          const assignId = assignRefsByCaregiver[targetCgId].assignRefId;

          for (const elder of elderChunk) {
            const elderRef = doc(collection(db, "elderly_caregiver_assign"));
            batch.set(elderRef, {
              caregiver_id: targetCgId,
              elderly_id: elder.id,
              assigned_at: Timestamp.now(),
              assign_version: nextVersion,
              assign_id: assignId,
              status: "active",
              day, // day string (e.g., "Monday") — indicates the day this link applies to
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
    }
  }


  // final commit if anything left
  if (writeCount > 0) {
    await batch.commit();
  }

  // 🔹 9. Activity log
  await addDoc(collection(db, "activity_logs"), {
    action: "Generate Schedule (per-day elder distribution)",
    version: nextVersion,
    time: Timestamp.now(),
    created_by: "system",
    details: { duration_months: months },
  });
};


  const confirmGenerate = async () => {
    setIsGenerating(true); // Show loading spinner immediately
    setShowOverlay(false);
    try {
      await distributeCaregivers(pendingDuration);
      setShowSuccess(true);
    } catch (err) {
      console.error("Error generating schedule:", err);
      alert("Something went wrong. Please try again.");
    } finally {
      setIsGenerating(false); // Hide loading overlay
    }
  };

  const closeSuccess = () => setShowSuccess(false);


  const cancelGenerate = () => setShowOverlay(false);

  // --- Absent handling (unchanged) ---
  const markAbsent = async (assignDocId) => {
    const assign = assignments.find((a) => a.id === assignDocId);
    if (!assign) return;

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD
    const dayName = daysOfWeek[today.getDay()]; // get current day name

    // 1. Mark the caregiver as absent for today only
    await updateDoc(doc(db, "cg_house_assign", assignDocId), {
      is_absent: true,
      absent_at: Timestamp.now(),
      absent_for_date: todayStr // track which date this absence is for
    });

    await loadAllAssignments();
    await loadAllElderlyAssigns();

    // 2. Get the caregiver's assigned elderly
    const assignedEAs = elderlyAssigns.filter(
      (ea) => ea.caregiver_id === assign.caregiver_id && ea.assign_version === assign.version
    );
    const elderIds = assignedEAs.map((ea) => ea.elderly_id);

    // 3. Find other caregivers in the SAME house & shift, who are NOT absent today AND work today
    const otherAssigns = assignments.filter((a) =>
      a.house_id === assign.house_id &&
      a.shift === assign.shift &&
      a.id !== assignDocId &&
      (!a.is_absent || a.absent_for_date !== todayStr) && // only present today
      a.is_current &&
      a.days_assigned.includes(dayName) // only those scheduled today
    );

    if (otherAssigns.length === 0) {
      // fallback: do not reassign across shifts
      console.log("No available caregivers to reassign today.");
      return;
    }

    // 4. Split elders evenly among available caregivers
    const chunks = splitIntoChunks(elderIds, otherAssigns.length);
    const promises = [];
    for (let i = 0; i < otherAssigns.length; i++) {
      const target = otherAssigns[i];
      const chunk = chunks[i] || [];
      for (const eid of chunk) {
        promises.push(
          addDoc(collection(db, "temp_reassignments"), {
            elderly_id: eid,
            from_caregiver_id: assign.caregiver_id,
            to_caregiver_id: target.caregiver_id,
            date: todayStr,
            assign_version: assign.version,
            created_at: Timestamp.now(),
          })
        );
      }
    }

    await Promise.all(promises);
    await loadTempReassigns();
    await loadAllAssignments();
    await loadAllElderlyAssigns();
  };

  // --- Optional: reset absences automatically on component mount ---
  useEffect(() => {
    const resetDailyAbsences = async () => {
      const todayStr = new Date().toISOString().slice(0, 10);
      const snap = await getDocs(collection(db, "cg_house_assign"));

      const resetPromises = snap.docs
        .filter((d) => d.data().is_absent && d.data().absent_for_date !== todayStr)
        .map((d) =>
          updateDoc(doc(db, "cg_house_assign", d.id), {
            is_absent: false,
            absent_at: null,
            absent_for_date: null,
          })
        );

      await Promise.all(resetPromises);
      await loadAllAssignments();
    };

    resetDailyAbsences();
  }, []); // run once on component mount


  const unmarkAbsent = async (assignDocId) => {
    const assign = assignments.find(a => a.id === assignDocId);
    if (!assign) return;

    const todayStr = new Date().toISOString().slice(0, 10);

    // 1. Clear absence for today only
    await updateDoc(doc(db, "cg_house_assign", assignDocId), {
      is_absent: false,
      absent_at: null,
      absent_for_date: null, // reset the day-specific absence
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

    // 3. Reload state
    await loadTempReassigns();
    await loadAllAssignments();
    await loadAllElderlyAssigns();
  };

  // ✅ Manual Rest Day function
  const manualRestDay = async (assignDocId) => {
    const assign = assignments.find(a => a.id === assignDocId);
    if (!assign) return;

    const currentDays = assign.days_assigned || [];

    const input = prompt(
      `Current days assigned: ${currentDays.join(", ")}\nEnter 2 rest days separated by comma (e.g., Saturday, Sunday):`,
      ""
    );

    if (!input) return;

    const restDays = input.split(",").map(d => d.trim()).filter(d => daysOfWeek.includes(d));

    if (restDays.length !== 2) {
      alert("Please enter exactly 2 valid rest days!");
      return;
    }

    const newDaysAssigned = daysOfWeek.filter(d => !restDays.includes(d)).slice(0, 5);

    await updateDoc(doc(db, "cg_house_assign", assignDocId), {
      days_assigned: newDaysAssigned
    });

    alert(`Updated working days for ${caregiverName(assign.caregiver_id)}: ${newDaysAssigned.join(", ")}`);
    await loadAllAssignments();
  };


  const getDisplayedEldersFor = (caregiverId) => {
  const base = elderlyAssigns
    .filter(
      (ea) =>
        ea.caregiver_id === caregiverId &&
        ea.assign_version === currentVersion &&
        ea.day?.toLowerCase() === activeDay.toLowerCase()
    )
    .map((ea) => ea.elderly_id);

  const today = new Date().toISOString().slice(0, 10);

  const toTemp = tempReassigns
    .filter(
      (t) =>
        t.to_caregiver_id === caregiverId &&
        t.date === today &&
        t.assign_version === currentVersion
    )
    .map((t) => t.elderly_id);

  const fromTemp = tempReassigns
    .filter(
      (t) =>
        t.from_caregiver_id === caregiverId &&
        t.date === today &&
        t.assign_version === currentVersion
    )
    .map((t) => t.elderly_id);

  const finalIds = base.filter((id) => !fromTemp.includes(id)).concat(toTemp);
  const elders = finalIds
    .map((id) => elderlyList.find((e) => e.id === id))
    .filter(Boolean);

  return elders;
};


  const caregiverName = (id) => {
    const c = caregivers.find((cg) => cg.id === id);
    return c ? `${c.user_fname} ${c.user_lname}` : "Unknown";
  };

  const filteredAssignments = assignments.filter((a) => {
    if (viewMode === "current" && !a.is_current) return false;
    if (viewMode === "previous" && a.is_current) return false;
    if (activeHouseId && a.house_id !== activeHouseId) return false;
    if (activeShift && a.shift !== activeShift) return false;
    if (activeDay && !(a.days_assigned || []).map(d => d.toLowerCase()).includes(activeDay.toLowerCase())) return false;
    return true;
  });

  // ✅ Open modal for specific caregiver
  const openRestDayModal = (assignDocId, caregiverId) => {
    setSelectedCaregiverAssignId(assignDocId);
    setSelectedCaregiverName(caregiverName(caregiverId)); // existing helper
    setSelectedRestDays([]); // reset selection
    setShowRestDayModal(true);
  };

  // ✅ Handle checkbox selection
  const toggleRestDay = (day) => {
    if (selectedRestDays.includes(day)) {
      setSelectedRestDays(selectedRestDays.filter(d => d !== day));
    } else if (selectedRestDays.length < 2) {
      setSelectedRestDays([...selectedRestDays, day]);
    } else {
      alert("You can only select 2 rest days.");
    }
  };

  // ✅ Save selected rest days
  const saveRestDays = async () => {
    if (selectedRestDays.length !== 2) {
      alert("Please select exactly 2 rest days.");
      return;
    }

    const newDaysAssigned = daysOfWeek.filter(d => !selectedRestDays.includes(d)).slice(0, 5);

    await updateDoc(doc(db, "cg_house_assign", selectedCaregiverAssignId), {
      days_assigned: newDaysAssigned
    });

    alert(`Updated working days for ${selectedCaregiverName}: ${newDaysAssigned.join(", ")}`);
    setShowRestDayModal(false);
    await loadAllAssignments();
  };

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
    // delete both collections
    await deleteCollection("cg_house_assign");
    await deleteCollection("elderly_caregiver_assign");

    alert("Schedule cleared!");
    // reload state so UI updates
    await loadAllAssignments();
    await loadAllElderlyAssigns();
  } catch (err) {
    console.error("Error clearing schedule:", err);
    alert("Failed to clear schedule.");
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
            onClick={() => { setViewMode("current"); }}
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
        <div className="shift-tabs">
          {shiftDefs.map((s) => (
            <button key={s.key} className={`shift-tab ${activeShift === s.key ? "active-shift" : ""}`} onClick={() => setActiveShift(s.key)}>{s.name}</button>
          ))}
        </div>

        {/* ✅ New Days-of-Week tabs */}
      <div className="day-tabs">
        {daysOfWeek.map((day) => (
          <button
            key={day}
            className={`day-tab ${activeDay === day ? "active" : ""}`}
            onClick={() => setActiveDay(day)}
          >
            {day}
          </button>
        ))}
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
              const isAbsent = !!a.is_absent;
              let elders = getDisplayedEldersFor(a.caregiver_id);
              elders = elders.slice().sort((e1, e2) => {
                const n1 = `${e1.elderly_fname} ${e1.elderly_lname}`.toLowerCase();
                const n2 = `${e2.elderly_fname} ${e2.elderly_lname}`.toLowerCase();
                return n1.localeCompare(n2);
              });
              return (
                <tr key={a.id} className={isAbsent ? "absent-row" : ""}>
                  <td>{caregiverName(a.caregiver_id)}</td>
                  <td>{(a.days_assigned || []).slice().sort((d1, d2) => daysOfWeek.indexOf(d1) - daysOfWeek.indexOf(d2)).join(", ")}</td>
                  <td>{a.time_range?.start} - {a.time_range?.end}</td>
                  <td>{elders.map((e) => `${e.elderly_fname} ${e.elderly_lname}`).join(", ")}</td>
                  <td>
                    {isAbsent ? (
                      <>
                        <span className="absent-text">Marked Absent Today</span>
                        <button onClick={() => unmarkAbsent(a.id)} className="unabsent-btn">Unmark</button>
                      </>
                    ) : (
                      <button onClick={() => markAbsent(a.id)} className="absent-btn">Mark as Absent</button>
                    )}
                    <button onClick={() => openRestDayModal(a.id, a.caregiver_id)} className="restday-btn">Set Rest Days</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </main>
      {showRestDayModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Set Rest Days for {selectedCaregiverName}</h3>
            <p>Select 2 rest days:</p>
            <div className="days-checkboxes">
              {daysOfWeek.map(day => (
                <label key={day} style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    checked={selectedRestDays.includes(day)}
                    onChange={() => toggleRestDay(day)}
                  />
                  {day}
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button onClick={saveRestDays} className="save-btn">Save</button>
              <button onClick={() => setShowRestDayModal(false)} className="cancel-btn">Cancel</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
