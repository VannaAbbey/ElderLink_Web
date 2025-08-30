import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MdArrowBack } from "react-icons/md";
import { IoMdArrowDropdown } from "react-icons/io";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import "./edit_nurse_profile.css";

export default function EditNurseProfile() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [nurses, setNurses] = useState([]);

  // Fetch nurses from Firestore (users where user_type = nurse)
  useEffect(() => {
    const fetchNurses = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "users"));
        const data = querySnapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((u) => u.user_type === "nurse"); // filter nurses only

        setNurses(data);
      } catch (error) {
        console.error("Error fetching nurses:", error);
      }
    };

    fetchNurses();
  }, []);

  // Search filter
  const filteredNurses = nurses.filter((nurse) =>
    `${nurse.user_fname} ${nurse.user_lname}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase())
  );

  return (
    <div className="nurse-list-container">
      {/* Header */}
      <div className="nurse-list-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <MdArrowBack size={20} /> Back
        </button>
        <div className="header-center">
          <img
            src="/images/nurse.png"
            alt="Nurses"
            className="header-image"
          />
          <h1 className="header-title">Nurses</h1>
        </div>
      </div>

      {/* Search + Sort */}
      <div className="search-sort-row">
        <input
          type="text"
          placeholder="Search nurses..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <button className="sort-button">
          Sort <IoMdArrowDropdown size={20} />
        </button>
      </div>

      {/* Nurse Cards */}
      <div className="nurse-list">
        {filteredNurses.length === 0 && (
          <p style={{ textAlign: "center", color: "#555" }}>
            No nurses found.
          </p>
        )}

        {filteredNurses.map((nurse) => (
          <div key={nurse.id} className="nurse-card">
            <img
              src={nurse.user_profilePic || "/images/default-user.png"}
              alt={nurse.user_fname}
            />
            <div className="nurse-name">
              {nurse.user_fname} {nurse.user_lname}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
