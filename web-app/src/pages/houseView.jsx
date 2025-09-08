import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MdArrowBack } from "react-icons/md";
import { FaHeartbeat, FaUserSlash, FaUserCircle } from "react-icons/fa";
import { IoMdArrowDropdown } from "react-icons/io";
import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import "./elderlyManagement.css";

export default function HouseView({ houseId: propHouseId }) {
  const { houseId: paramHouseId } = useParams();
  const houseId = propHouseId || paramHouseId;
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("Alive");
  const [searchTerm, setSearchTerm] = useState("");
  const [elderlyList, setElderlyList] = useState([]);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showSelectPanel, setShowSelectPanel] = useState(false);
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [selectedElderly, setSelectedElderly] = useState([]);
  const [reason, setReason] = useState("");
  const [formData, setFormData] = useState({
    elderly_fname: "",
    elderly_lname: "",
    elderly_bday: "",
    elderly_age: "",
    elderly_sex: "Male",
    elderly_mobilityStatus: "Independent",
    elderly_dietNotes: "",
    elderly_condition: "",
    newHouseId: "",
  });

  const [selectedImage, setSelectedImage] = useState(null);
  const [previewImage, setPreviewImage] = useState("");
  const storage = getStorage();

  const houseImages = {
    H001: "/images/Sebastian.png",
    H002: "/images/Emmanuel.png",
    H003: "/images/Charbell.png",
    H004: "/images/Rose.png",
    H005: "/images/Gabriel.png",
  };

  const houseNames = {
    H001: "House of St. Sebastian",
    H002: "House of St. Emmanuel",
    H003: "House of St. Charbell",
    H004: "House of St. Rose",
    H005: "House of St. Gabriel",
  };

  const fieldLabels = {
    elderly_fname: "First Name",
    elderly_lname: "Last Name",
    elderly_bday: "Date of Birth",
    elderly_age: "Age",
    elderly_dietNotes: "Diet Notes",
    elderly_condition: "Condition",
  };

  useEffect(() => {
    const fetchElderly = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "elderly"));
        setElderlyList(
          querySnapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
        );
      } catch (err) {
        console.error("Error fetching elderly:", err);
      }
    };
    fetchElderly();
  }, []);

  const elderlyInHouse = elderlyList.filter((e) => e.house_id === houseId);
  const filteredElderly = elderlyInHouse
    .filter((e) =>
      e.elderly_fname?.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .filter((e) => {
      if (activeTab === "Alive") return e.elderly_status === "Alive";
      if (activeTab === "Deceased") return e.elderly_status === "Deceased";
      return true;
    });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((p) => ({ ...p, [name]: value }));
  };

  const handleImageChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      setSelectedImage(f);
      setPreviewImage(URL.createObjectURL(f));
    }
  };

  const generateElderlyId = () => {
    const numbers = elderlyList
      .map((e) => parseInt(e.elderly_id?.replace("E", "")))
      .filter((n) => !isNaN(n));
    const nextNum = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    return `E${String(nextNum).padStart(3, "0")}`;
  };

  const handleSave = async () => {
    try {
      let uploadedImageUrl = "";
      if (selectedImage) {
        const storageRef = ref(
          storage,
          `elderlyPics/${Date.now()}_${selectedImage.name}`
        );
        await uploadBytes(storageRef, selectedImage);
        uploadedImageUrl = await getDownloadURL(storageRef);
      }

      const newElderly = {
        elderly_id: generateElderlyId(),
        elderly_fname: formData.elderly_fname,
        elderly_lname: formData.elderly_lname,
        elderly_bday: formData.elderly_bday,
        elderly_age: Number(formData.elderly_age),
        elderly_sex: formData.elderly_sex,
        elderly_mobilityStatus: formData.elderly_mobilityStatus,
        elderly_dietNotes: formData.elderly_dietNotes,
        elderly_condition: formData.elderly_condition,
        elderly_profilePic: uploadedImageUrl || "",
        elderly_status: "Alive",
        elderly_cause: "",
        elderly_deathDate: "",
        house_id: houseId,
        user_id: "",
      };

      await addDoc(collection(db, "elderly"), newElderly);
      const q = await getDocs(collection(db, "elderly"));
      setElderlyList(q.docs.map((d) => ({ id: d.id, ...d.data() })));

      setShowOverlay(false);
      setFormData({
        elderly_fname: "",
        elderly_lname: "",
        elderly_bday: "",
        elderly_age: "",
        elderly_sex: "Male",
        elderly_mobilityStatus: "Independent",
        elderly_dietNotes: "",
        elderly_condition: "",
        newHouseId: "",
      });
      setSelectedImage(null);
      setPreviewImage("");
    } catch (err) {
      console.error("Error saving elderly:", err);
    }
  };

  const toggleSelect = (elderId) => {
    setSelectedElderly((prev) =>
      prev.includes(elderId)
        ? prev.filter((id) => id !== elderId)
        : [...prev, elderId]
    );
  };

  const confirmAllocation = async () => {
    if (!formData.newHouseId) {
      alert("Please select a new house.");
      return;
    }
    if (selectedElderly.length === 0) {
      alert("Please select at least one elderly.");
      return;
    }
    if (!reason.trim()) {
      alert("Please provide a reason for allocation.");
      return;
    }

    try {
      const updates = selectedElderly.map(async (elderId) => {
        const elderRef = doc(db, "elderly", elderId);
        await updateDoc(elderRef, {
          house_id: formData.newHouseId,
          allocation_reason: reason,
        });
      });
      await Promise.all(updates);

      const q = await getDocs(collection(db, "elderly"));
      setElderlyList(q.docs.map((d) => ({ id: d.id, ...d.data() })));

      alert("Elderly successfully allocated to the new house!");
      setShowAllocateModal(false);
      setShowSelectPanel(false);
      setSelectedElderly([]);
      setReason("");
      setFormData((prev) => ({ ...prev, newHouseId: "" }));
    } catch (err) {
      console.error("Error allocating elderly:", err);
      alert("Allocation failed. Check console.");
    }
  };

  const isSelected = (id) => selectedElderly.includes(id);
  const closeSelectPanel = () => {
    setShowSelectPanel(false);
    setSelectedElderly([]);
  };

  return (
    <div className="elderly-profile-container wide-layout">
      {/* Header */}
      <div className="elderly-profile-header">
        {!propHouseId && (
          <button
            className="back-btn"
            onClick={() => navigate("/elderlyManagement")}
          >
            <MdArrowBack size={20} /> Back
          </button>
        )}
        <div className="header-house">
          <img
            src={houseImages[houseId] || "/images/default-house.png"}
            alt={houseNames[houseId]}
            className="header-image"
          />
          <h1 className="header-title">{houseNames[houseId]}</h1>
        </div>
      </div>

      {/* Search & Switch */}
      <div className="search-sort-row">
        <input
          type="text"
          placeholder="Search..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <div className="sort-switch-container">
          <button className="sort-button">
            Sort <IoMdArrowDropdown size={20} />
          </button>
          {activeTab === "Alive" && (
            <button
              className="switch-house-button"
              onClick={() => setShowSelectPanel(true)}
            >
              Switch House
            </button>
          )}
        </div>
      </div>

      {/* Add Elderly */}
      {activeTab === "Alive" && (
        <div className="add-elderly-wrapper">
          <div className="add-elderly-top">
            <button
              className="add-elderly-btn"
              onClick={() => setShowOverlay(true)}
            >
              Add Elderly Profile
            </button>
          </div>
        </div>
      )}

      {/* Elderly Table with Tabs at Top-Right */}
      <div className="elderly-table-wrapper" style={{ position: "relative" }}>
        {/* Alive / Deceased Tabs */}
        <div className="table-tabs">
          <button
            className={activeTab === "Alive" ? "active" : ""}
            onClick={() => setActiveTab("Alive")}
          >
            <FaHeartbeat size={18} className="tab-icon" /> Alive
          </button>
          <button
            className={activeTab === "Deceased" ? "active" : ""}
            onClick={() => setActiveTab("Deceased")}
          >
            <FaUserSlash size={18} className="tab-icon" /> Deceased
          </button>
        </div>

        {filteredElderly.length === 0 ? (
          <p className="no-profiles">No profiles found.</p>
        ) : (
          <table className="elderly-table">
            <thead>
              <tr>
                <th></th> {/* Icon Column */}
                <th>Full Name</th>
                <th>Age</th>
                <th>Sex</th>
                {showSelectPanel && <th>Select</th>}
              </tr>
            </thead>
            <tbody>
              {filteredElderly.map((elder) => {
                const onRowClick = () => {
                  if (showSelectPanel) {
                    toggleSelect(elder.id);
                  } else {
                    navigate(`/profileElderly/${elder.elderly_id}`);
                  }
                };

                return (
                  <tr
                    key={elder.id}
                    className={isSelected(elder.id) ? "selected-row" : ""}
                    onClick={onRowClick}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="icon-cell">
                      <FaUserCircle size={25} color="#4A90E2" />
                    </td>
                    <td className="name-cell">
                      {elder.elderly_fname} {elder.elderly_lname}
                    </td>
                    <td className="age-cell">{elder.elderly_age ?? "—"}</td>
                    <td className="sex-cell">{elder.elderly_sex || "—"}</td>
                    {showSelectPanel && (
                      <td
                        className="select-cell"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected(elder.id)}
                          onChange={() => toggleSelect(elder.id)}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Floating Select Panel */}
      {showSelectPanel && (
        <div className="select-panel">
          <div className="select-panel-header">
            <strong>Switch House</strong>
            <button className="select-panel-close" onClick={closeSelectPanel}>✕</button>
          </div>
          <div className="select-panel-note">
            Please select the elderly you want to allocate or change house.
          </div>
          <div className="selected-list-compact">
            {selectedElderly.length === 0 ? (
              <div className="no-selected">No elderly selected yet.</div>
            ) : (
              <ul>
                {elderlyList
                  .filter((e) => selectedElderly.includes(e.id))
                  .map((e) => <li key={e.id}>{e.elderly_fname} {e.elderly_lname}</li>)}
              </ul>
            )}
          </div>
          <div className="select-panel-actions">
            <button className="done-btn" onClick={() => {
              if (selectedElderly.length === 0) {
                alert("Please select at least one elderly.");
                return;
              }
              setShowAllocateModal(true);
              setShowSelectPanel(false);
            }}>
              Done
            </button>
            <button className="cancel-btn" onClick={closeSelectPanel}>Cancel</button>
          </div>
        </div>
      )}

      {/* Add Elderly Overlay */}
      {showOverlay && (
        <div className="overlay">
          <div className="overlay-content">
            <span className="overlay-close" onClick={() => setShowOverlay(false)}>✕</span>
            <h2 className="overlay-header">Add Elderly Profile</h2>

            <div className="image-upload-box" onClick={() => document.getElementById("fileInput").click()}>
              {previewImage ? <img src={previewImage} alt="Preview" className="preview-img" /> : (
                <div className="placeholder-box"><span className="placeholder-text">+ Upload Photo</span></div>
              )}
              <input type="file" id="fileInput" accept="image/*" className="hidden-input" onChange={handleImageChange} />
            </div>

            {["elderly_fname", "elderly_lname", "elderly_bday", "elderly_age", "elderly_dietNotes", "elderly_condition"].map((field) => (
              <div className="form-group" key={field}>
                <label>{fieldLabels[field]}</label>
                <input
                  type={field === "elderly_age" ? "number" : field === "elderly_bday" ? "date" : "text"}
                  name={field}
                  value={formData[field]}
                  onChange={handleChange}
                />
              </div>
            ))}

            <div className="form-group">
              <label>Sex</label>
              <select name="elderly_sex" value={formData.elderly_sex} onChange={handleChange}>
                <option>Male</option>
                <option>Female</option>
              </select>
            </div>

            <div className="form-group">
              <label>Mobility Status</label>
              <select name="elderly_mobilityStatus" value={formData.elderly_mobilityStatus} onChange={handleChange}>
                <option>Independent</option>
                <option>Assisted</option>
                <option>Wheelchair-bound</option>
                <option>Bedridden</option>
                <option>Needs Supervision</option>
              </select>
            </div>

            <div className="overlay-buttons">
              <button onClick={handleSave}>Save Elderly Profile</button>
              <button onClick={() => setShowOverlay(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Allocation Modal */}
      {showAllocateModal && (
        <div className="overlay">
          <div className="overlay-content">
            <span className="overlay-close" onClick={() => {
              setShowAllocateModal(false);
              setSelectedElderly([]);
            }}>✕</span>
            <h2>Allocate Selected Elderly</h2>

            <div className="selected-list">
              <strong>Selected:</strong>
              <ul>
                {elderlyList
                  .filter((e) => selectedElderly.includes(e.id))
                  .map((e) => <li key={e.id}>{e.elderly_fname} {e.elderly_lname}</li>)}
              </ul>
            </div>

            <label>Choose New House:</label>
            <select className="allocation-select" value={formData.newHouseId} onChange={(e) => setFormData((p) => ({ ...p, newHouseId: e.target.value }))}>
              <option value="">-- Select House --</option>
              {Object.keys(houseNames).map((id) => (
                <option key={id} value={id}>{houseNames[id]}</option>
              ))}
            </select>

            <div className="form-group">
              <label>Reason for Allocation:</label>
              <textarea rows="3" className="allocation-textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>

            <div className="overlay-buttons">
              <button onClick={confirmAllocation}>Save & Allocate</button>
              <button onClick={() => {
                setShowAllocateModal(false);
                setSelectedElderly([]);
              }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
