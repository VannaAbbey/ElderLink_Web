// src/pages/elderlyManagement.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc } from "firebase/firestore";
import Navbar from "./navbar";
import HouseView from "./houseView";
import CustomAlertModal from "./customAlertModal";
import ImportElderlyModal from "./importElderlyModal";
import "../css/elderlyManagement.css";


export default function ElderlyManagement() {
  const [houses, setHouses] = useState([]);
  const [activeTab, setActiveTab] = useState("records");
  const [activeHouse, setActiveHouse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddHouseModal, setShowAddHouseModal] = useState(false);
  const [showEditHouseModal, setShowEditHouseModal] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [selectedHouse, setSelectedHouse] = useState(null);
  const [newHouseData, setNewHouseData] = useState({
    house_name: "",
    house_desc: "",
  });

  const fetchHouses = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "house"));
      const houseList = querySnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          house_id: data.house_id,
          house_name: data.house_name,
          house_desc: data.house_desc || '',
        };
      });

      const sortedHouses = houseList.sort((a, b) =>
        a.house_id.localeCompare(b.house_id)
      );

      setHouses(sortedHouses);

      if (sortedHouses.length > 0 && !activeHouse) {
        setActiveHouse(sortedHouses[0].house_id);
      }

      setLoading(false);
    } catch (error) {
      console.error("Error fetching houses:", error);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHouses();
  }, []);

  const generateHouseId = () => {
    const numbers = houses
      .map((h) => parseInt(h.house_id?.replace("H", "")))
      .filter((n) => !isNaN(n));
    const nextNum = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    return `H${String(nextNum).padStart(3, "0")}`;
  };

  const handleAddHouse = async () => {
    if (!newHouseData.house_name.trim()) {
      alert("Please enter a house name.");
      return;
    }

    try {
      const newHouseId = generateHouseId();
      await addDoc(collection(db, "house"), {
        house_id: newHouseId,
        house_name: newHouseData.house_name.trim(),
        house_desc: newHouseData.house_desc.trim() || "",
      });

      setSuccessMessage(`House "${newHouseData.house_name}" created successfully!`);
      setShowSuccessModal(true);
      setShowAddHouseModal(false);
      setNewHouseData({ house_name: "", house_desc: "" });
      
      // Refresh houses
      await fetchHouses();
    } catch (error) {
      console.error("Error adding house:", error);
      alert("Failed to add house. Please try again.");
    }
  };

  const handleEditHouse = async () => {
    if (!newHouseData.house_name.trim()) {
      alert("Please enter a house name.");
      return;
    }

    try {
      const houseRef = doc(db, "house", selectedHouse.id);
      await updateDoc(houseRef, {
        house_name: newHouseData.house_name.trim(),
        house_desc: newHouseData.house_desc.trim() || "",
      });

      setSuccessMessage(`House "${newHouseData.house_name}" updated successfully!`);
      setShowSuccessModal(true);
      setShowEditHouseModal(false);
      setNewHouseData({ house_name: "", house_desc: "" });
      setSelectedHouse(null);
      
      // Refresh houses
      await fetchHouses();
    } catch (error) {
      console.error("Error updating house:", error);
      alert("Failed to update house. Please try again.");
    }
  };

  const handleDeleteHouse = async () => {
    try {
      // Check if house has elderly residents
      const elderlySnapshot = await getDocs(collection(db, "elderly"));
      const hasResidents = elderlySnapshot.docs.some(
        (doc) => doc.data().house_id === selectedHouse.house_id
      );

      if (hasResidents) {
        alert("Cannot delete house with residents. Please relocate all elderly first.");
        setShowDeleteConfirmModal(false);
        return;
      }

      const houseRef = doc(db, "house", selectedHouse.id);
      await deleteDoc(houseRef);

      setSuccessMessage(`House "${selectedHouse.house_name}" deleted successfully!`);
      setShowSuccessModal(true);
      setShowDeleteConfirmModal(false);
      setSelectedHouse(null);
      
      // Switch to first available house if deleted house was active
      if (activeHouse === selectedHouse.house_id) {
        setActiveHouse(null);
      }
      
      // Refresh houses
      await fetchHouses();
    } catch (error) {
      console.error("Error deleting house:", error);
      alert("Failed to delete house. Please try again.");
    }
  };

  const openEditHouseModal = (house) => {
    setSelectedHouse(house);
    setNewHouseData({
      house_name: house.house_name,
      house_desc: house.house_desc || "",
    });
    setShowEditHouseModal(true);
  };

  const openDeleteConfirmModal = (house) => {
    setSelectedHouse(house);
    setShowDeleteConfirmModal(true);
  };

  const handleImportComplete = (results) => {
    setShowImportModal(false);
    setSuccessMessage(
      `Import completed! Successfully imported ${results.success} elderly. ${
        results.failed > 0 ? `${results.failed} failed.` : ''
      }`
    );
    setShowSuccessModal(true);
    
    // Refresh the current view
    window.location.reload();
  };

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
        
        {/* Action Buttons */}
        <div className="header-actions">
          <button 
            className={
              activeHouse === "INFIRMARY"
                ? "header-action-btn infirmary-action-btn active"
                : "header-action-btn infirmary-action-btn"
            }
            onClick={() => setActiveHouse("INFIRMARY")}
            title="View elderly currently in infirmary"
          >
            Infirmary
          </button>
          <button 
            className="header-action-btn import-action-btn"
            onClick={() => setShowImportModal(true)}
            title="Import elderly from CSV or Excel file"
          >
            Import Elderly
          </button>
          <button 
            className="header-action-btn add-house-action-btn"
            onClick={() => setShowAddHouseModal(true)}
            title="Add a new house"
          >
            Add House
          </button>
        </div>

        {/* Folder Navigation */}
        <div className="folder-nav-container">
          <div className="folder-nav">
            {houses.map((house) => (
              <button
                key={house.id}
                className={
                  activeHouse === house.house_id
                    ? "folder-btn active"
                    : "folder-btn"
                }
                onClick={() => setActiveHouse(house.house_id)}
                title={`View elderly residents and profiles in ${house.house_name}`}
              >
                {house.house_name}
              </button>
            ))}
          </div>
        </div>
             
        <div className="elderly-folder-container">
          {/* Content */}
          <div className="tab-content">
            {activeTab === "records" && activeHouse && (
              <div className="view-records">
                <div className="house-content">
                  <HouseView 
                    houseId={activeHouse}
                    currentHouse={houses.find(h => h.house_id === activeHouse)}
                    onEditHouse={openEditHouseModal}
                    onDeleteHouse={openDeleteConfirmModal}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Add House Modal */}
        {showAddHouseModal && (
          <div className="overlay">
            <div className="overlay-content">
              <span
                className="overlay-close"
                onClick={() => setShowAddHouseModal(false)}
              >
                ✖
              </span>
              <h2 className="overlay-header">Add New House</h2>

              <div className="form-group">
                <label>
                  House Name<span className="required-asterisk">*</span>
                </label>
                <input
                  type="text"
                  value={newHouseData.house_name}
                  onChange={(e) =>
                    setNewHouseData({ ...newHouseData, house_name: e.target.value })
                  }
                  placeholder="e.g., House of St. Michael"
                />
              </div>

              <div className="form-group">
                <label>
                  Description<span className="optional-label">(Optional)</span>
                </label>
                <textarea
                  value={newHouseData.house_desc}
                  onChange={(e) =>
                    setNewHouseData({ ...newHouseData, house_desc: e.target.value })
                  }
                  placeholder="Enter house description..."
                />
              </div>

              <div className="overlay-buttons">
                <button className="save-btn" onClick={handleAddHouse}>
                  Create House
                </button>
                <button
                  className="cancel-btn"
                  onClick={() => setShowAddHouseModal(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Import Elderly Modal */}
        <ImportElderlyModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          onImportComplete={handleImportComplete}
        />

        {/* Edit House Modal */}
        {showEditHouseModal && (
          <div className="overlay">
            <div className="overlay-content">
              <span
                className="overlay-close"
                onClick={() => {
                  setShowEditHouseModal(false);
                  setSelectedHouse(null);
                  setNewHouseData({ house_name: "", house_desc: "" });
                }}
              >
                ✖
              </span>
              <h2 className="overlay-header">Edit House</h2>

              <div className="form-group">
                <label>
                  House Name<span className="required-asterisk">*</span>
                </label>
                <input
                  type="text"
                  value={newHouseData.house_name}
                  onChange={(e) =>
                    setNewHouseData({ ...newHouseData, house_name: e.target.value })
                  }
                  placeholder="e.g., House of St. Michael"
                />
              </div>

              <div className="form-group">
                <label>
                  Description<span className="optional-label">(Optional)</span>
                </label>
                <textarea
                  value={newHouseData.house_desc}
                  onChange={(e) =>
                    setNewHouseData({ ...newHouseData, house_desc: e.target.value })
                  }
                  placeholder="Enter house description..."
                />
              </div>

              <div className="overlay-buttons">
                <button className="save-btn" onClick={handleEditHouse}>
                  Update House
                </button>
                <button
                  className="cancel-btn"
                  onClick={() => {
                    setShowEditHouseModal(false);
                    setSelectedHouse(null);
                    setNewHouseData({ house_name: "", house_desc: "" });
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirmModal && (
          <div className="overlay">
            <div className="overlay-content" style={{ maxWidth: '500px' }}>
              <span
                className="overlay-close"
                onClick={() => {
                  setShowDeleteConfirmModal(false);
                  setSelectedHouse(null);
                }}
              >
                ✖
              </span>
              <h2 className="overlay-header" style={{ color: '#dc3545' }}>⚠️ Delete House</h2>
              
              <div style={{ padding: '20px 0' }}>
                <p style={{ fontSize: '16px', marginBottom: '15px' }}>
                  Are you sure you want to delete <strong>"{selectedHouse?.house_name}"</strong>?
                </p>
                <p style={{ fontSize: '14px', color: '#666', marginBottom: '10px' }}>
                  House ID: <strong>{selectedHouse?.house_id}</strong>
                </p>
                <div style={{ 
                  background: '#FFF3CD', 
                  border: '1px solid #FFECB5', 
                  borderRadius: '6px', 
                  padding: '12px', 
                  marginTop: '15px' 
                }}>
                  <p style={{ fontSize: '13px', color: '#856404', margin: 0 }}>
                    ⚠️ <strong>Warning:</strong> This action cannot be undone. Make sure there are no elderly residents in this house before deleting.
                  </p>
                </div>
              </div>

              <div className="overlay-buttons">
                <button 
                  className="save-btn" 
                  onClick={handleDeleteHouse}
                  style={{ background: '#dc3545' }}
                >
                  Delete House
                </button>
                <button
                  className="cancel-btn"
                  onClick={() => {
                    setShowDeleteConfirmModal(false);
                    setSelectedHouse(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Success Modal */}
        <CustomAlertModal
          isOpen={showSuccessModal}
          onClose={() => setShowSuccessModal(false)}
          title="Success"
          message={successMessage}
          type="alert"
        />
      </div>
    </>
  );
}