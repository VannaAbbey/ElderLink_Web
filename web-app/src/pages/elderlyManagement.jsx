import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { MdArrowBack } from "react-icons/md";
import Navbar from "./navbar";
import "./elderlyManagement.css";

export default function ElderlyManagement() {
  const navigate = useNavigate();
  const [houses, setHouses] = useState([]);
  const [activeTab, setActiveTab] = useState("records");
  const [activeHouse, setActiveHouse] = useState(null); // ✅ new state
  const [loading, setLoading] = useState(true);

  // ✅ Map house_id to image
  const houseImages = {
    H001: "/images/Sebastian.png",
    H002: "/images/Emmanuel.png",
    H003: "/images/Charbell.png",
    H004: "/images/Rose.png",
    H005: "/images/Gabriel.png",
  };

  // ✅ Map house_id to description
  const houseDescriptions = {
    H001: "Females with Psychological Needs",
    H002: "Females that are Bedridden",
    H003: "Males that are Bedridden",
    H004: "Females that are Abled",
    H005: "Males that are Abled",
  };

  // ✅ Fetch Houses from Firestore
  useEffect(() => {
    const fetchHouses = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "house"));
        const houseList = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // ✅ Sort by house_id so H001 comes first
        const sortedHouses = houseList.sort((a, b) =>
          a.house_id.localeCompare(b.house_id)
        );

        setHouses(sortedHouses);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching houses:", error);
        setLoading(false);
      }
    };

    fetchHouses();
  }, []);

  return (
    <>
      <Navbar />

      <div className="elderly-profile-container">
        {/* Header Section */}
        <div className="elderly-profile-header">
          <button className="back-btn" onClick={() => navigate("/dashboard")}>
            <MdArrowBack size={20} />
            Back
          </button>
          <div className="header-center">
            <img
              src="/images/Sebastian.png"
              alt="Header"
              className="header-image"
            />
            <h1 className="header-title">Elderly Profile Management</h1>
          </div>
        </div>

        {/* Tabs */}
        <div className="tab-buttons">
          <button
            className={activeTab === "records" ? "active" : ""}
            onClick={() => setActiveTab("records")}
          >
            View Records
          </button>
        </div>

        {/* Tab Content */}
        <div className="tab-content">
          {activeTab === "records" && (
            <div className="view-records">
              <div className="records-header">
                <img
                  src="/images/house-icon.png"
                  alt="House Icon"
                  className="house-icon"
                />
                <h2>Elderly Houses</h2>
              </div>

              {/* ✅ Folder Navigation */}
              <div className="folder-nav">
                {houses.map((house) => (
                  <button
                    key={house.house_id}
                    className={
                      activeHouse === house.house_id
                        ? "folder-btn active"
                        : "folder-btn"
                    }
                    onClick={() => {
                      setActiveHouse(house.house_id);
                      navigate(`/house/${house.house_id}`);
                    }}
                  >
                    {house.house_name}
                  </button>
                ))}
              </div>

              {/* House List */}
              {loading ? (
                <p className="loading-text">Loading houses...</p>
              ) : houses.length === 0 ? (
                <p className="no-houses-text">No houses found.</p>
              ) : (
                <div className="house-list">
                  {houses.map((house) => (
                    <div
                      key={house.house_id}
                      className="house-card"
                      onClick={() => navigate(`/house/${house.house_id}`)}
                    >
                      <img
                        src={
                          houseImages[house.house_id] ||
                          "/images/default-house.png"
                        }
                        alt={house.house_name}
                        className="house-image"
                      />
                      <p className="house-name">{house.house_name}</p>
                      <p className="house-desc">
                        {houseDescriptions[house.house_id] ||
                          "Click to view elderly"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
