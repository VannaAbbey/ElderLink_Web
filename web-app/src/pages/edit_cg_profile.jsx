// src/pages/edit_cg_profile.jsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FaUserCircle, FaHeartbeat } from "react-icons/fa";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import "./edit_cg_overlay.jsx"; // ✅ import overlay
import "./edit_cg_profile.css";
import EditCaregiverOverlay from "./edit_cg_overlay.jsx";


export default function EditCaregiverProfile() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [caregivers, setCaregivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortAsc, setSortAsc] = useState(true);

  // ✅ overlay state
  const [editCaregiverId, setEditCaregiverId] = useState(null);

  // Fetch caregivers from Firestore
useEffect(() => {
  const fetchCaregivers = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "users"));
      const data = querySnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter(
          (u) => u.user_type === "caregiver" && u.user_activation !== false // ✅ only active caregivers
        );

      setCaregivers(data);
    } catch (error) {
      console.error("Error fetching caregivers:", error);
    } finally {
      setLoading(false);
    }
  };

  fetchCaregivers();
}, []);


  // Filter + sort caregivers
  const filteredCaregivers = caregivers
    .filter((cg) =>
      `${cg.user_fname} ${cg.user_lname}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
    )
    .sort((a, b) =>
      sortAsc
        ? a.user_fname.localeCompare(b.user_fname)
        : b.user_fname.localeCompare(a.user_fname)
    );

  // Navigate to caregiver profile
  const handleRowClick = (id) => {
    navigate(`/profileCaregiver/${id}`);
  };

  const totalCaregivers = caregivers.length;

  return (
    <div className="caregiver-list-container">
      {/* Header */}
      <div className="caregiver-list-header">
        <div className="header-center">
          <FaHeartbeat className="header-icon" size={28} color="#e63946" />
          <h1 className="header-title">Caregivers</h1>
        </div>
      </div>
        <div className="header-title-wrapper">
          <span className="total-caregiver"> Total Number of Active Caregivers: {totalCaregivers}</span>
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
        <button
          className="sort-button"
          onClick={() => setSortAsc((prev) => !prev)}
        >
          Sort {sortAsc ? "(A-Z) ▲" : "(Z-A) ▼"}
        </button>
      </div>

      {/* Caregiver Table */}
      <div className="caregiver-list">
        {loading ? (
          <p style={{ textAlign: "center", color: "#777" }}>
            Loading caregivers...
          </p>
        ) : filteredCaregivers.length === 0 ? (
          <p style={{ textAlign: "center", color: "#555" }}>
            No caregivers found.
          </p>
        ) : (
          <table className="caregiver-table">
            <thead>
              <tr>
                <th></th>
                <th>Full Name</th>
                <th>Email</th>
                <th className="action-th">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredCaregivers.map((cg) => (
                <tr
                  key={cg.id}
                  className="caregiver-row"
                  onClick={() => handleRowClick(cg.id)}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <FaUserCircle className="caregiver-icon" />
                  </td>
                  <td>
                    {cg.user_fname} {cg.user_lname}
                  </td>
                  <td>{cg.user_email}</td>
                  <td
                    className="action-cell"
                    onClick={(e) => {
                      e.stopPropagation(); // ✅ prevent row click
                      setEditCaregiverId(cg.id); // ✅ show overlay
                    }}
                    title="Edit"
                  >
                    <span className="pencil-icon">✎</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ✅ Overlay (only shows if editCaregiverId is set) */}
      {editCaregiverId && (
        <EditCaregiverOverlay
          caregiverId={editCaregiverId}
          onClose={() => setEditCaregiverId(null)}
          onUpdate={() => {
            console.log("Caregiver updated!");
            setEditCaregiverId(null);
          }}
        />
      )}
    </div>
  );
}
