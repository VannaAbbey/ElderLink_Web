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
} from "firebase/firestore";
import "./schedule.css";

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

  const [viewMode, setViewMode] = useState("current");
  const [activeHouseId, setActiveHouseId] = useState(null);
  const [activeShift, setActiveShift] = useState("Morning");

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

    if (!activeHouseId && houseList.length) setActiveHouseId(houseList[0].house_id);

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

  // --- Core distribution logic (fixed) ---
  const distributeCaregivers = async (months) => {
    // deactivate previous current assignments
    const allAssignSnap = await getDocs(collection(db, "cg_house_assign"));
    const deactivate = allAssignSnap.docs.map((d) =>
      updateDoc(doc(db, "cg_house_assign", d.id), { is_current: false })
    );
    await Promise.all(deactivate);

    const prevVersion = await getMaxVersion();
    const nextVersion = prevVersion + 1;

    const start_date = Timestamp.now();
    const end_date = Timestamp.fromDate(getEndDate(months));

    // shuffle caregivers for fairness
    const pool = [...caregivers];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const totalCgs = pool.length;
    const housesCount = houses.length || 1;
    const base = Math.floor(totalCgs / housesCount);
    let remainder = totalCgs % housesCount;

    const perHouseCounts = houses.map((h) => {
      const add = remainder > 0 ? 1 : 0;
      remainder = Math.max(0, remainder - 1);
      const count = Math.max(1, base + add);
      return { house: h, count };
    });

    let poolIdx = 0;
    const assignedCaregivers = new Set(); // ensure each cg assigned to only 1 house

    // For each house: pick unique caregivers, then split them into morning/night groups.
    for (const { house, count } of perHouseCounts) {
      const selected = [];
      while (selected.length < count && assignedCaregivers.size < pool.length) {
        const cg = pool[poolIdx++ % pool.length];
        if (!assignedCaregivers.has(cg.id)) {
          selected.push(cg);
          assignedCaregivers.add(cg.id);
        }
      }

      // group into morning and night caregivers
      const morningCount = Math.ceil(selected.length / 2);
      const morningCaregivers = selected.slice(0, morningCount);
      const nightCaregivers = selected.slice(morningCount);

      // all elderly for this house (same for both shifts)
      const houseElders = elderlyList.filter((e) => e.house_id === house.house_id) || [];

      // split elders among morning caregivers only (each morning caregiver gets a subset)
      const morningChunks = splitIntoChunks(houseElders, Math.max(1, morningCaregivers.length));
      // split elders among night caregivers only (each night caregiver gets a subset)
      const nightChunks = splitIntoChunks(houseElders, Math.max(1, nightCaregivers.length));

      const createPromises = [];

      // create assignments for morning caregivers (they share ALL elders among themselves)
      for (let i = 0; i < morningCaregivers.length; i++) {
        const cg = morningCaregivers[i];
        const shift = "Morning";
        const time_range = { start: "08:00", end: "17:00" };
        const shuffledDays = [...daysOfWeek].sort(() => 0.5 - Math.random());
        const days_assigned = shuffledDays.slice(0, 5);

        const payload = {
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
        };

        // create cg_house_assign and elderly_caregiver_assign entries for this chunk
        const p = addDoc(collection(db, "cg_house_assign"), payload).then(async (ref) => {
          const chunkElders = morningChunks[i] || [];
          const eaPromises = (chunkElders || []).map((elder) =>
            addDoc(collection(db, "elderly_caregiver_assign"), {
              caregiver_id: cg.id,
              elderly_id: elder.id,
              assigned_at: Timestamp.now(),
              assign_version: nextVersion,
              assign_id: ref.id,
              status: "active",
            })
          );
          await Promise.all(eaPromises);
        });

        createPromises.push(p);
      }

      // create assignments for night caregivers (they also share ALL elders among themselves)
      for (let i = 0; i < nightCaregivers.length; i++) {
        const cg = nightCaregivers[i];
        const shift = "Night";
        const time_range = { start: "17:00", end: "08:00" };
        const shuffledDays = [...daysOfWeek].sort(() => 0.5 - Math.random());
        const days_assigned = shuffledDays.slice(0, 5);

        const payload = {
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
        };

        const p = addDoc(collection(db, "cg_house_assign"), payload).then(async (ref) => {
          const chunkElders = nightChunks[i] || [];
          const eaPromises = (chunkElders || []).map((elder) =>
            addDoc(collection(db, "elderly_caregiver_assign"), {
              caregiver_id: cg.id,
              elderly_id: elder.id,
              assigned_at: Timestamp.now(),
              assign_version: nextVersion,
              assign_id: ref.id,
              status: "active",
            })
          );
          await Promise.all(eaPromises);
        });

        createPromises.push(p);
      }

      await Promise.all(createPromises);
    }

    // activity log
    await addDoc(collection(db, "activity_logs"), {
      action: "Generate Schedule",
      version: nextVersion,
      time: Timestamp.now(),
      created_by: "system",
      details: { duration_months: months },
    });

    // reload data
    await loadAllAssignments();
    await loadAllElderlyAssigns();
    await loadTempReassigns();

    setCurrentVersion(nextVersion);
    return true;
  };

  const confirmGenerate = async () => {
    setShowOverlay(false);
    await distributeCaregivers(pendingDuration);
  };

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


  // show elders for UI, accounting for temporary reassigns for today
  const getDisplayedEldersFor = (caregiverId) => {
    const base = elderlyAssigns
      .filter((ea) => ea.caregiver_id === caregiverId && ea.assign_version === currentVersion)
      .map((ea) => ea.elderly_id);

    const today = new Date().toISOString().slice(0, 10);
    const toTemp = tempReassigns.filter((t) => t.to_caregiver_id === caregiverId && t.date === today && t.assign_version === currentVersion).map((t) => t.elderly_id);
    const fromTemp = tempReassigns.filter((t) => t.from_caregiver_id === caregiverId && t.date === today && t.assign_version === currentVersion).map((t) => t.elderly_id);

    const finalIds = base.filter((id) => !fromTemp.includes(id)).concat(toTemp);
    const elders = finalIds.map((id) => elderlyList.find((e) => e.id === id)).filter(Boolean);
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



  return (
    <div className="schedule-page">
      <h2 className="page-title">Caregiver Scheduling</h2>

      <div style={{ marginBottom: 12 }}>
        <button onClick={() => { setViewMode("current"); }} className={viewMode === "current" ? "active" : ""}>Current Schedule</button>
        <button onClick={() => { setViewMode("previous"); }} className={viewMode === "previous" ? "active" : ""} style={{ marginLeft: 8 }}>Previous Schedules</button>
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

      <div className="house-tabs">
        {houses.map((h) => (
          <button key={h.house_id} className={`house-tab ${activeHouseId === h.house_id ? "active" : ""}`} onClick={() => setActiveHouseId(h.house_id)}>
            {h.house_name}
          </button>
        ))}
      </div>

      <div className="table-container">
        <div className="shift-tabs">
          {["Morning", "Night"].map((s) => (
            <button key={s} className={`shift-tab ${activeShift === s ? "active-shift" : ""}`} onClick={() => setActiveShift(s)}>{s}</button>
          ))}
        </div>

        <table className="schedule-table">
          <thead>
            <tr>
              <th>Caregiver Name</th>
              <th>Days</th>
              <th>Time</th>
              <th>Elderly Assigned</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
  {filteredAssignments.map((a) => {
    const isAbsent = !!a.is_absent;
    const elders = getDisplayedEldersFor(a.caregiver_id);
    return (
      <tr key={a.id} className={isAbsent ? "absent-row" : ""}>
        <td>{caregiverName(a.caregiver_id)}</td>
        <td>{(a.days_assigned || []).join(", ")}</td>
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
