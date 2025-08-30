import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MdArrowBack } from "react-icons/md";
import { IoMdArrowDropdown } from "react-icons/io";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import "./edit_cg_profile.css";

export default function EditCaregiverProfile() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [caregivers, setCaregivers] = useState([]);

  // Fetch caregivers from Firestore (users where user_type = caregiver)
  useEffect(() => {
    const fetchCaregivers = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "users"));
        const data = querySnapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((u) => u.user_type === "caregiver"); // filter caregivers only

        setCaregivers(data);
      } catch (error) {
        console.error("Error fetching caregivers:", error);
      }
    };

    fetchCaregivers();
  }, []);

  // Search filter
  const filteredCaregivers = caregivers.filter((cg) =>
    `${cg.user_fname} ${cg.user_lname}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase())
  );

  return (
    <div className="caregiver-list-container">
      {/* Header */}
      <div className="caregiver-list-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <MdArrowBack size={20} /> Back
        </button>
        <div className="header-center">
          <img
            src="/images/caregiver.png"
            alt="Caregivers"
            className="header-image"
          />
          <h1 className="header-title">Caregivers</h1>
        </div>
      </div>

      {/* Search + Sort */}
      <div className="search-sort-row">
        <input
          type="text"
          placeholder="Search caregivers..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <button className="sort-button">
          Sort <IoMdArrowDropdown size={20} />
        </button>
      </div>

      {/* Caregiver Cards */}
      <div className="caregiver-list">
        {filteredCaregivers.length === 0 && (
          <p style={{ textAlign: "center", color: "#555" }}>
            No caregivers found.
          </p>
        )}

        {filteredCaregivers.map((cg) => (
          <div key={cg.id} className="caregiver-card">
            <img
              src={cg.user_profilePic || "/images/default-user.png"}
              alt={cg.user_fname}
            />
            <div className="caregiver-name">
              {cg.user_fname} {cg.user_lname}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
