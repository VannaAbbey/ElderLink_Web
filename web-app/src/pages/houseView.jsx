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
  const [sortAsc, setSortAsc] = useState(true); // Full-name sort
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
    H004: "House of St. Rose of Lima",
    H005: "House of St. Gabriel",
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

  // Filtered + Sorted Elderly
  const filteredElderly = elderlyInHouse
    .filter((e) =>
      `${e.elderly_fname} ${e.elderly_lname}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
    )
    .filter((e) => {
      if (activeTab === "Alive") return e.elderly_status === "Alive";
      if (activeTab === "Deceased") return e.elderly_status === "Deceased";
      return true;
    })
    .sort((a, b) => {
      const nameA = `${a.elderly_fname} ${a.elderly_lname}`.toLowerCase();
      const nameB = `${b.elderly_fname} ${b.elderly_lname}`.toLowerCase();
      return sortAsc ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
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

      {/* Search & Sort */}
      <div className="search-sort-row">
        <input
          type="text"
          placeholder="Search..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <div className="sort-switch-container">
          <button
            className="sort-button"
            onClick={() => setSortAsc((prev) => !prev)}
          >
            Sort {sortAsc ? "(A-Z) ▲" : "(Z-A) ▼"} <IoMdArrowDropdown size={20} />
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

      {/* Elderly Table with Status Tabs */}
      <div className="elderly-table-wrapper" style={{ position: "relative" }}>
        <div className="status-tabs">
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
                <th></th>
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
                    navigate(`/profileElderly/${elder.id}`);
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

      {/* Add Elderly Modal */}
      {showOverlay && (
        <div className="overlay">
          <div className="overlay-content">
            <span className="overlay-close" onClick={() => setShowOverlay(false)}>
              ✖
            </span>
            <h2 className="overlay-header">Add Elderly</h2>

            <label className="image-upload-box">
              {previewImage ? (
                <img src={previewImage} alt="Preview" className="preview-img" />
              ) : (
                <div className="placeholder-box">Upload Photo</div>
              )}
              <input type="file" accept="image/*" onChange={handleImageChange} />
            </label>

            <div className="form-group">
              <label>First Name</label>
              <input
                type="text"
                name="elderly_fname"
                value={formData.elderly_fname}
                onChange={handleChange}
              />
            </div>

            <div className="form-group">
              <label>Last Name</label>
              <input
                type="text"
                name="elderly_lname"
                value={formData.elderly_lname}
                onChange={handleChange}
              />
            </div>

            <div className="form-group">
              <label>Date of Birth</label>
              <input
                type="date"
                name="elderly_bday"
                value={formData.elderly_bday}
                onChange={handleChange}
              />
            </div>

            <div className="form-group">
              <label>Age</label>
              <input
                type="number"
                name="elderly_age"
                value={formData.elderly_age}
                onChange={handleChange}
              />
            </div>

            <div className="form-group">
              <label>Sex</label>
              <select
                name="elderly_sex"
                value={formData.elderly_sex}
                onChange={handleChange}
              >
                <option>Male</option>
                <option>Female</option>
              </select>
            </div>

            <div className="form-group">
              <label>Mobility Status</label>
              <select
                name="elderly_mobilityStatus"
                value={formData.elderly_mobilityStatus}
                onChange={handleChange}
              >
                <option>Independent</option>
                <option>Needs Assistance</option>
                <option>Bedridden</option>
              </select>
            </div>

            <div className="form-group">
              <label>Diet Notes</label>
              <input
                type="text"
                name="elderly_dietNotes"
                value={formData.elderly_dietNotes}
                onChange={handleChange}
              />
            </div>

            <div className="form-group">
              <label>Condition</label>
              <input
                type="text"
                name="elderly_condition"
                value={formData.elderly_condition}
                onChange={handleChange}
              />
            </div>

            <div className="overlay-buttons">
              <button className="save-btn" onClick={handleSave}>
                Save
              </button>
              <button className="cancel-btn" onClick={() => setShowOverlay(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Switch House Modal */}
      {showSelectPanel && (
        <div className="overlay">
          <div className="overlay-content">
            <span className="overlay-close" onClick={closeSelectPanel}>
              ✖
            </span>
            <h2 className="overlay-header">Switch House</h2>

            <div className="form-group">
              <label>New House</label>
              <select
                name="newHouseId"
                value={formData.newHouseId}
                onChange={handleChange}
              >
                <option value="">-- Select House --</option>
                {Object.entries(houseNames).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Reason for Switch</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Enter reason..."
              />
            </div>

            <div className="overlay-buttons">
              <button className="save-btn" onClick={confirmAllocation}>
                Confirm
              </button>
              <button className="cancel-btn" onClick={closeSelectPanel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
