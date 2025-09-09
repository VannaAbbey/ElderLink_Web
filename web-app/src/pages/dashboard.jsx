import React, { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import Navbar from "./navbar";
import { useNavigate } from "react-router-dom";  // ✅ insert this
import "./dashboard.css";

export default function Dashboard() {
  const [totalElderly, setTotalElderly] = useState(0);
  const [totalCaregivers, setTotalCaregivers] = useState(0);
  const [totalNurses, setTotalNurses] = useState(0);

  const navigate = useNavigate(); // ✅ insert this

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const elderlySnapshot = await getDocs(collection(db, "elderly"));
        setTotalElderly(elderlySnapshot.size);

        const usersSnapshot = await getDocs(collection(db, "users"));
        let caregiverCount = 0;
        let nurseCount = 0;

        usersSnapshot.forEach((doc) => {
          const data = doc.data();
          if (data.user_type === "caregiver") caregiverCount++;
          if (data.user_type === "nurse") nurseCount++;
        });

        setTotalCaregivers(caregiverCount);
        setTotalNurses(nurseCount);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    fetchCounts();
  }, []);

  return (
    <div className="dashboard-container">
      <Navbar />
      
      {/* Overview */}
      <h2 className="section-title">Overview</h2>
      <div className="overview-cards">
        <div className="overview-card">
          <h3>Total Elderly</h3>
          <p>{totalElderly}</p>
        </div>
        <div className="overview-card">
          <h3>Total Caregivers</h3>
          <p>{totalCaregivers}</p>
        </div>
        <div className="overview-card">
          <h3>Total Nurses</h3>
          <p>{totalNurses}</p>
        </div>
      </div>

      {/* Management */}
      <h2 className="section-title">Management</h2>
      <div className="management-buttons">

        {/* unang buttons, nicomment ko lang :P
        <button className="mgmt-btn" onClick={() => navigate("/elderlyManagement")}>
          👤 Elderly Profile & Life Status Management
        </button>
        <button className="mgmt-btn" onClick={() => navigate("/edit_cg_assign")}>
          👥 Edit Caregiver Assignment
        </button> */}

        <div className="management-buttons-row-2">
          <button className="mgmt-btn" onClick={() => navigate("/edit_cg_profile")}>
            👤 Edit Caregiver Profile
          </button>
          <button className="mgmt-btn" onClick={() => navigate("/edit_nurse_profile")}>
            🩺 Edit Nurse Profile
          </button>
        </div>
      </div>
    </div>
  );
}
