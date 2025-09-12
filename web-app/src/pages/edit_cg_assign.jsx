import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  addDoc,
  query,
  where,
} from "firebase/firestore";
import "./edit_cg_assign.css";

const EditCgAssign = () => {
  const [formData, setFormData] = useState({
    assign_id: "",
    user_id: "",
    house_id: "",
    shift: "",
    days_assigned: [],
    start_date: "",
    end_date: "",
  });

  const [assignments, setAssignments] = useState([]);
  const [caregivers, setCaregivers] = useState({});
  const [nextCaregiver, setNextCaregiver] = useState("");

  const shuffleArray = (arr) => {
    let array = [...arr];
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  };

  const randomAssignCaregivers = async () => {
    try {
      const caregiverIds = Object.keys(caregivers); // all caregiver IDs
      if (caregiverIds.length === 0) {
        alert("No caregivers available to assign.");
        return;
      }

      const shuffled = shuffleArray(caregiverIds);
      let houseIndex = 0;

      for (let cgId of shuffled) {
        const house = houses[houseIndex % houses.length]; // round-robin

        await addDoc(collection(db, "cg_house_assign_v2"), {
          assign_id: `AUTO-${cgId}-${house.id}`,
          user_id: cgId,
          house_id: house.id,
          shift: Math.random() > 0.5 ? "Morning" : "Night", // random shift
          days_assigned: ["Monday","Tuesday","Wednesday","Thursday","Friday"],
          start_date: new Date(),
          end_date: new Date(new Date().setDate(new Date().getDate() + 7)), // 1 week
        });

        houseIndex++;
      }

      await fetchAssignments(); // refresh table
      alert("Caregivers shuffled and assigned successfully!");
    } catch (error) {
      console.error("Error randomly assigning caregivers:", error);
    }
  };

  const houses = [
    { id: "H001", name: "St. Sebastian" },
    { id: "H002", name: "St. Emmanuel" },
    { id: "H003", name: "St. Charbell" },
    { id: "H004", name: "St. Rose" },
    { id: "H005", name: "St. Gabriel" },
  ];

  const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const shifts = ["Morning", "Night"];

  // Shift time ranges
  const shiftTimes = {
    Morning: { start: "08:00", end: "17:00" },
    Night: { start: "17:00", end: "08:00" },
  };

  // Auto-generate assign_id as A0001, A0002, ...
  useEffect(() => {
    const generateAssignId = () => {
      if (assignments.length === 0) {
        return "A0001";
      }
      // Find max assign_id number
      const maxNum = assignments.reduce((max, a) => {
        const num = parseInt((a.assign_id || "A0000").replace("A", ""), 10);
        return num > max ? num : max;
      }, 0);
      const nextNum = maxNum + 1;
      return `A${nextNum.toString().padStart(4, "0")}`;
    };
    setFormData((prev) => ({ ...prev, assign_id: generateAssignId() }));
  }, [assignments]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleDaysChange = (day) => {
    setFormData((prev) => {
      const exists = prev.days_assigned.includes(day);
      return {
        ...prev,
        days_assigned: exists
          ? prev.days_assigned.filter((d) => d !== day)
          : [...prev.days_assigned, day],
      };
    });
  };

  // Fetch caregivers from users table (only user_type === 'caregiver')
  const fetchCaregivers = async () => {
    const snapshot = await getDocs(collection(db, "users"));
    let map = {};
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.user_type === "caregiver") {
        map[data.user_id] = `${data.user_fname} ${data.user_lname} (${data.user_id})`;
      }
    });
    setCaregivers(map);
  };

  const fetchAssignments = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "cg_house_assign_v2"));
      const data = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setAssignments(data);
      detectNextCaregiver(data); // update next caregiver whenever assignments change
    } catch (error) {
      console.error("Error fetching assignments:", error);
    }
  };

  useEffect(() => {
    fetchCaregivers();
    fetchAssignments();
  }, []);

  // Distribute elderly equally
  const distributeElderly = async (houseId) => {
    try {
      const elderlySnap = await getDocs(
        query(collection(db, "elderly"), where("house_id", "==", houseId))
      );
      const elderlyList = elderlySnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      const caregiverSnap = await getDocs(
        query(collection(db, "cg_house_assign_v2"), where("house_id", "==", houseId))
      );
      const caregiverList = caregiverSnap.docs.map((d) => d.data());

      if (caregiverList.length === 0) {
        alert("No caregivers assigned in this house.");
        return;
      }

      let i = 0;
      for (let elder of elderlyList) {
        const caregiver = caregiverList[i % caregiverList.length];
        await addDoc(collection(db, "elderly_caregiver_assign"), {
          elderly_id: elder.elderly_id,
          caregiver_id: caregiver.user_id,
          house_id: houseId,
        });
        i++;
      }
    } catch (error) {
      console.error("Error distributing elderly:", error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const payload = {
      ...formData,
      start_date: new Date(formData.start_date),
      end_date: new Date(formData.end_date),
    };

    try {
      await addDoc(collection(db, "cg_house_assign_v2"), payload);
      await fetchAssignments(); // refresh table
      await distributeElderly(payload.house_id);

      alert("Assignment saved and elderly distributed equally among caregivers!");
    } catch (error) {
      console.error("Error saving assignment:", error);
    }
  };

  // Detect next caregiver based on current time
  const detectNextCaregiver = (assignmentList) => {
    const now = new Date();
    const currentDay = daysOfWeek[now.getDay() - 1]; // Sunday = 0
    const currentTime = now.getHours() * 60 + now.getMinutes(); // in minutes

    const activeAssignments = assignmentList.filter((a) =>
      a.days_assigned.includes(currentDay)
    );

    for (let assign of activeAssignments) {
      const { shift } = assign;
      if (!shiftTimes[shift]) continue;

      const [startHour, startMin] = shiftTimes[shift].start.split(":").map(Number);
      const [endHour, endMin] = shiftTimes[shift].end.split(":").map(Number);
      let startMinutes = startHour * 60 + startMin;
      let endMinutes = endHour * 60 + endMin;

      // Night shift crosses midnight
      for (let assign of activeAssignments) {
  const { shift } = assign;
  if (!shiftTimes[shift]) continue;

  const [startHour, startMin] = shiftTimes[shift].start.split(":").map(Number);
  const [endHour, endMin] = shiftTimes[shift].end.split(":").map(Number);
  let startMinutes = startHour * 60 + startMin;
  let endMinutes = endHour * 60 + endMin;

  // Night shift crosses midnight
  let adjustedCurrentTime = currentTime;
  if (shift === "Night" && endMinutes < startMinutes) {
    endMinutes += 24 * 60;
    if (adjustedCurrentTime < startMinutes) adjustedCurrentTime += 24 * 60;
  }

  if (adjustedCurrentTime >= startMinutes && adjustedCurrentTime <= endMinutes) {
    setNextCaregiver(caregivers[assign.user_id] || assign.user_id);
    return;
  }
}
    }

    setNextCaregiver("No caregiver on shift now");
  };

  useEffect(() => {
    detectNextCaregiver(assignments);
    const timer = setInterval(() => detectNextCaregiver(assignments), 60000); // every minute
    return () => clearInterval(timer);
  }, [assignments, caregivers]);

  // Dates and countdown
  const currentStart = formData.start_date
    ? new Date(formData.start_date).toLocaleDateString()
    : "-";
  const currentEnd = formData.end_date
    ? new Date(formData.end_date).toLocaleDateString()
    : "-";
  const daysLeft =
    formData.end_date &&
    Math.ceil(
      (new Date(formData.end_date) - new Date()) / (1000 * 60 * 60 * 24)
    );

  return (
    <div className="page-container">
      <h2 className="main-header">Edit Caregiver Assignment</h2>
      <div className="form-container">

        <div className="assignment-period">
          <span><strong>Current Period:</strong></span>
          <div className="date-range">
            <input
              type="date"
              name="start_date"
              value={formData.start_date}
              onChange={handleChange}
              required
            />
            <span className="to-label">to</span>
            <input
              type="date"
              name="end_date"
              value={formData.end_date}
              onChange={handleChange}
              required
            />
          </div>
          <span>
            <strong>Next Rotation:</strong>{" "}
            {daysLeft > 0 ? `${daysLeft} days left` : "Expired / Not Set"}
          </span>
          <br />
          <span>
            <strong>Current Caregiver on Shift:</strong> {nextCaregiver}
          </span>
        </div>

        {/* Form stays unchanged */}
        <form onSubmit={handleSubmit} className="assignment-form">
          <div className="form-row-group">
            <div className="form-row">
              <label>Assign ID</label>
              <input type="text" name="assign_id" value={formData.assign_id} readOnly style={{ background: '#eee' }} />
            </div>
            <div className="form-row">
              <label>Caregiver User ID</label>
              <select
                name="user_id"
                value={formData.user_id}
                onChange={handleChange}
                required
              >
                <option value="">Select a Caregiver</option>
                {Object.entries(caregivers).map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row-group">
            <div className="form-row">
              <label>House</label>
              <select
                name="house_id"
                value={formData.house_id}
                onChange={handleChange}
                required
              >
                <option value="">Select a House</option>
                {houses.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Shift</label>
              <select
                name="shift"
                value={formData.shift}
                onChange={handleChange}
                required
              >
                <option value="">Select a Shift</option>
                {shifts.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="days-section">
            <p className="days-title">Days of the Week</p>
            <div className="days-grid">
              {daysOfWeek.map((day) => (
                <label key={day} className="checkbox-card">
                  <input
                    type="checkbox"
                    checked={formData.days_assigned.includes(day)}
                    onChange={() => handleDaysChange(day)}
                  />
                  <span>{day}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="button-row">
            <button type="submit" className="save-btn">Save Assignment</button>
            <button type="button" className="shuffle-btn" onClick={randomAssignCaregivers}>
              Shuffle & Assign All
            </button>
          </div>
        </form>

        <h3 className="mt-8 mb-4">📅 Current Caregiver Schedules</h3>
        {assignments.length === 0 ? (
          <p>No caregiver assignments found.</p>
        ) : (
          <table className="schedule-table">
            <thead>
              <tr>
                <th>Assign ID</th>
                <th>User ID</th>
                <th>Caregiver Name</th>
                <th>House</th>
                <th>Shift</th>
                <th>Days</th>
                <th>Start</th>
                <th>End</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id}>
                  <td>{a.assign_id}</td>
                  <td>{a.user_id}</td>
                  <td>{caregivers[a.user_id] || "Unknown"}</td>
                  <td>{a.house_id}</td>
                  <td>{a.shift}</td>
                  <td>{a.days_assigned?.join(", ")}</td>
                  <td>
                    {a.start_date?.toDate
                      ? a.start_date.toDate().toLocaleDateString()
                      : new Date(a.start_date).toLocaleDateString()}
                  </td>
                  <td>
                    {a.end_date?.toDate
                      ? a.end_date.toDate().toLocaleDateString()
                      : new Date(a.end_date).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3 className="mt-8 mb-4">👥 All Caregivers (Users Table)</h3>
        {Object.keys(caregivers).length === 0 ? (
          <p>No caregivers found in Users table.</p>
        ) : (
          <table className="schedule-table">
            <thead>
              <tr>
                <th>User ID</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(caregivers).map(([id, name]) => (
                <tr key={id}>
                  <td>{id}</td>
                  <td>{name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default EditCgAssign;
