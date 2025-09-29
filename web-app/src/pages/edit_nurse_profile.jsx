import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FaUserNurse, FaUserCircle } from "react-icons/fa"; // nurse + user icon
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import "./edit_nurse_profile.css";
import EditNurseOverlay from "./edit_nurse_overlay.jsx";



export default function EditNurseProfile() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [nurses, setNurses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortAsc, setSortAsc] = useState(true);
  const [editNurseId, setEditNurseId] = useState(null);


  // Fetch nurses from Firestore
  useEffect(() => {
  const fetchNurses = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "users"));
      const data = querySnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter(
          (u) => u.user_type === "nurse" && u.user_activation !== false // ✅ only active
        );

      setNurses(data);
    } catch (error) {
      console.error("Error fetching nurses:", error);
    } finally {
      setLoading(false);
    }
  };

  fetchNurses();
}, []);

  // Search + Sort
  const filteredNurses = nurses
    .filter((nurse) =>
      `${nurse.user_fname} ${nurse.user_lname}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
    )
    .sort((a, b) =>
      sortAsc
        ? a.user_fname.localeCompare(b.user_fname)
        : b.user_fname.localeCompare(a.user_fname)
    );

  // Navigate to nurse profile
  const handleRowClick = (id) => {
    navigate(`/profileNurse/${id}`);
  };

  const totalNurses = nurses.length;

  return (
    <div className="nurse-list-container">
      {/* Header */}
      <div className="nurse-list-header">
        <div className="header-center">
          <FaUserNurse className="header-icon" size={28} color="#e63946" />
          <h1 className="header-title">Nurses</h1>
        </div>
      </div>
      <div className="header-title-wrapper">
          <span className="total-nurse"> Total Number of Active Nurses: {totalNurses}</span>
        </div>

      {/* Search + Sort */}
      <div className="search-sort-row">
        <input
          type="text"
          placeholder="Search nurses..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
          aria-label="Search nurses"
        />
        <button
          className="sort-button"
          onClick={() => setSortAsc((prev) => !prev)}
        >
          Sort {sortAsc ? "(A-Z) ▲" : "(Z-A) ▼"}
        </button>
      </div>

      {/* Nurse Table */}
      <div className="nurse-list">
        {loading ? (
          <p style={{ textAlign: "center", color: "#777" }}>Loading nurses...</p>
        ) : filteredNurses.length === 0 ? (
          <p style={{ textAlign: "center", color: "#555" }}>No nurses found.</p>
        ) : (
          <table className="nurse-table">
            <thead>
              <tr>
                <th></th>
                <th>Full Name</th>
                <th>Email</th>
                <th className="action-th">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredNurses.map((nurse) => (
                <tr
                  key={nurse.id}
                  className="nurse-row"
                  onClick={() => handleRowClick(nurse.id)}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <FaUserCircle className="nurse-icon" />
                  </td>
                  <td>{`${nurse.user_fname} ${nurse.user_lname}`}</td>
                  <td>{nurse.user_email || "N/A"}</td>
                  <td
    className="action-cell"
    onClick={(e) => {
      e.stopPropagation();
      setEditNurseId(nurse.id); // ✅ open overlay only
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
        {editNurseId && (
  <EditNurseOverlay
    nurseId={editNurseId}     // pass the nurse id
    onClose={() => setEditNurseId(null)} // close overlay
    onUpdate={() => {
      // refresh nurses list if needed
      setEditNurseId(null);
    }}
  />
)}
      </div>
    </div>
  );
}
