import React, { useState, useEffect } from "react"; 
import { useNavigate } from "react-router-dom";
import { MdArrowBack } from "react-icons/md";
import { FaHeartbeat, FaUserSlash } from "react-icons/fa"; 
import { IoMdArrowDropdown } from "react-icons/io";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import "./elderly_profile.css";

export default function Charbell() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("Alive"); // capital A to match your status values
  const [searchTerm, setSearchTerm] = useState("");
  const [elderlyList, setElderlyList] = useState([]);

  useEffect(() => {
    const fetchElderly = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "elderly"));
        const data = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setElderlyList(data);
      } catch (error) {
        console.error("Error fetching elderly profiles:", error);
      }
    };

    fetchElderly();
  }, []);

  // Filter by house_id "H002" for Emmanuel house
  const elderlyInHouse = elderlyList.filter(elder => elder.house_id === "H003");

  // Filter by search term
  const searchFiltered = elderlyInHouse.filter(elder =>
    elder.elderly_fname?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Filter by status tab
  const filteredElderly = searchFiltered.filter(elder => {
    if (activeTab === "Alive") return elder.elderly_status === "Alive";
    if (activeTab === "Deceased") return elder.elderly_status === "Deceased";
    return true;
  });

  return (
    <div className="elderly-profile-container">
      {/* Header Row */}
      <div className="elderly-profile-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <MdArrowBack size={20} /> Back
        </button>
        <div className="header-center">
          <img src="/images/Charbell.png" alt="Charbell" className="header-image" />
          <h1 className="header-title">House of St. Charbell</h1>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-buttons">
        <button
          className={activeTab === "Alive" ? "active" : ""}
          onClick={() => setActiveTab("Alive")}
        >
          <FaHeartbeat size={18} style={{ marginRight: "5px" }} /> Alive
        </button>
        <button
          className={activeTab === "Deceased" ? "active" : ""}
          onClick={() => setActiveTab("Deceased")}
        >
          <FaUserSlash size={18} style={{ marginRight: "5px" }} /> Deceased
        </button>
      </div>

      {/* Search + Sort Row */}
      <div className="search-sort-row">
        <input
          type="text"
          placeholder="Search..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <button className="sort-button">
          Sort <IoMdArrowDropdown size={20} />
        </button>
      </div>

      {/* Add Elderly Profile Button - Alive Only */}
      {activeTab === "Alive" && (
        <div className="add-elderly-wrapper">
          <button className="add-elderly-btn">
            Add Elderly Profile
          </button>
        </div>
      )}

      {/* Elderly Cards */}
      <div className="elderly-list">
        {filteredElderly.length === 0 && (
          <p style={{ textAlign: "center", color: "#555" }}>No profiles found.</p>
        )}
        {filteredElderly.map((elder) => (
          <div key={elder.id} className="elderly-card">
            <img
              src={elder.elderly_profilePic || "/images/house1.png"}
              alt={elder.elderly_fname}
            />
            <div className="elderly-name">{elder.elderly_fname}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
