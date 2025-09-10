// src/pages/elderlyManagement.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";
import Navbar from "./navbar";
import HouseView from "./houseView";
import "./elderlyManagement.css";


export default function ElderlyManagement() {
  const [houses, setHouses] = useState([]);
  const [activeTab, setActiveTab] = useState("records");
  const [activeHouse, setActiveHouse] = useState(null); // 🔹 default null muna
  const [loading, setLoading] = useState(true);


  useEffect(() => {
    const fetchHouses = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "house"));
        const houseList = querySnapshot.docs.map((doc) => ({
          id: doc.id,         // ✅ Firestore doc.id
          ...doc.data(),
        }));


        const sortedHouses = houseList.sort((a, b) =>
          a.house_id.localeCompare(b.house_id)
        );


        setHouses(sortedHouses);


        // 🔹 Set first house as default activeHouse
        if (sortedHouses.length > 0) {
          setActiveHouse(sortedHouses[0].house_id);
        }


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
      <div>
        <div className="elderly-profile-container">
          {/* Header */}
          <div className="elderly-profile-header">
            <div className="header-center">
              <img
                src="/images/ElderlyHouseLogo.png"
                alt="Header"
                className="header-image"
              />
              <h1 className="header-title">Elderly Profile Management</h1>
            </div>
          </div>
        </div>


        {/* Folder Navigation */}
        <div className="folder-nav">
          {houses.map((house) => (
            <button
              key={house.id}   // ✅ gamit doc.id
              className={
                activeHouse === house.house_id
                  ? "folder-btn active"
                  : "folder-btn"
              }
              onClick={() => setActiveHouse(house.house_id)}
            >
              {house.house_name}
            </button>
          ))}
        </div>
             
        <div className="elderly-folder-container">
          {/* Content */}
          <div className="tab-content">
            {activeTab === "records" && activeHouse && (
              <div className="view-records">
                <div className="house-content">
                  {/* ✅ Pass activeHouse so HouseView can fetch elderly under this house */}
                  <HouseView houseId={activeHouse} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
