import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MdArrowBack } from "react-icons/md";
import { FaHeartbeat, FaUserSlash, FaUserCircle } from "react-icons/fa";
import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import "../css/elderlyManagement.css";
import EditElderlyOverlay from "./edit_elderly_profile";
import CustomAlertModal from "./customAlertModal";
import { 
  checkActiveScheduleForHouse, 
  integrateNewElderlyIntoSchedule 
} from "../services/elderlyIntegrationService";
import { 
  checkActiveNurseScheduleForHouse,
  integrateNewElderlyIntoNurseSchedule 
} from "../services/nurseElderlyIntegrationService";

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

  const houseShortTitles = {
  H001: "Women Receiving Psychological Support",
  H002: "Women Requiring Full-Time Bed Care",
  H003: "Men Requiring Full-Time Bed Care",
  H004: "Women Living Independently with Assistance",
  H005: "Men Living Independently with Assistance",
};


const [editElderlyId, setEditElderlyId] = useState(null);

  // New states for schedule integration confirmation
  const [showIntegrationModal, setShowIntegrationModal] = useState(false);
  const [pendingElderlyId, setPendingElderlyId] = useState(null);
  const [scheduleInfo, setScheduleInfo] = useState(null);
  const [isIntegrating, setIsIntegrating] = useState(false);

  // Success modal state
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

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
  .filter((e) => {
    const searchable = `
      ${e.elderly_fname || ""} 
      ${e.elderly_lname || ""} 
      ${e.elderly_age || ""} 
      ${e.elderly_mobilityStatus || ""} 
      ${e.elderly_dietNotes || ""} 
      ${e.elderly_condition || ""}
    `.toLowerCase();

    return searchable.includes(searchTerm.toLowerCase());
  })
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
      // Validate required fields
      if (!formData.elderly_fname.trim()) {
        alert("First Name is required.");
        return;
      }
      if (!formData.elderly_lname.trim()) {
        alert("Last Name is required.");
        return;
      }
      if (!formData.elderly_bday) {
        alert("Date of Birth is required.");
        return;
      }
      if (!formData.elderly_age || formData.elderly_age <= 0) {
        alert("Age is required and must be greater than 0.");
        return;
      }
      if (!formData.elderly_sex) {
        alert("Sex is required.");
        return;
      }
      if (!formData.elderly_mobilityStatus) {
        alert("Mobility Status is required.");
        return;
      }

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

      // Save elderly to database first
      const docRef = await addDoc(collection(db, "elderly"), newElderly);
      const newElderlyId = docRef.id;
      
      // Refresh elderly list
      const q = await getDocs(collection(db, "elderly"));
      setElderlyList(q.docs.map((d) => ({ id: d.id, ...d.data() })));

      // Check if there's an active schedule for this house
      const caregiverScheduleCheck = await checkActiveScheduleForHouse(houseId);
      const nurseScheduleCheck = await checkActiveNurseScheduleForHouse(houseId);
      
      // Combine schedule information
      const hasAnyActiveSchedule = caregiverScheduleCheck.hasActiveSchedule || nurseScheduleCheck.hasActiveSchedule;
      
      if (hasAnyActiveSchedule) {
        // Show confirmation modal for schedule integration
        console.log('📊 Schedule Check Results:', {
          caregiver: caregiverScheduleCheck,
          nurse: nurseScheduleCheck,
          combined: {
            caregiverCount: caregiverScheduleCheck.caregiverCount || 0,
            nurseCount: nurseScheduleCheck.nurseCount || 0,
            hasNurseSchedule: nurseScheduleCheck.hasActiveSchedule
          }
        });
        
        setScheduleInfo({
          ...caregiverScheduleCheck,
          nurseCount: nurseScheduleCheck.nurseCount || 0,
          hasNurseSchedule: nurseScheduleCheck.hasActiveSchedule
        });
        setPendingElderlyId(newElderlyId);
        setShowIntegrationModal(true);
      } else {
        // No active schedule, just close and show success
        setSuccessMessage(`Elderly profile saved successfully! They will be included in the next schedule generation.`);
        setShowSuccessModal(true);
        setShowOverlay(false);
        resetForm();
      }
      
    } catch (error) {
      console.error("Error adding elderly:", error);
      setSuccessMessage("Failed to add elderly profile. Please try again.");
      setShowSuccessModal(true);
    }
  };

  const resetForm = () => {
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
  };

  // Handle integration confirmation
  const handleConfirmIntegration = async () => {
    try {
      setIsIntegrating(true);
      
      console.log(`\n%c🔄 INTEGRATING ELDERLY INTO ACTIVE SCHEDULES`, 'color: #4ECDC4; font-weight: bold; font-size: 16px');
      console.log(`%c   House: ${houseId}`, 'color: #FFD93D');
      console.log(`%c   Elderly ID: ${pendingElderlyId}`, 'color: #FFD93D');
      
      // Integrate into caregiver schedule
      console.log(`\n%c👥 Integrating into CAREGIVER schedule...`, 'color: #95E1D3; font-weight: bold');
      const caregiverResult = await integrateNewElderlyIntoSchedule(houseId, pendingElderlyId);
      
      // Integrate into nurse schedule
      console.log(`\n%c🩺 Integrating into NURSE schedule...`, 'color: #95E1D3; font-weight: bold');
      const nurseResult = await integrateNewElderlyIntoNurseSchedule(houseId, pendingElderlyId);
      
      // Prepare summary message
      const messages = [];
      
      if (caregiverResult.integrated) {
        messages.push(`✅ Caregiver: ${caregiverResult.updatedCount} assignments updated`);
      } else if (caregiverResult.success) {
        messages.push(`ℹ️ Caregiver: Will be included in next generation`);
      } else {
        messages.push(`⚠️ Caregiver: ${caregiverResult.message}`);
      }
      
      if (nurseResult.integrated) {
        messages.push(`✅ Nurse: ${nurseResult.updatedCount} assignments updated`);
      } else if (nurseResult.success) {
        messages.push(`ℹ️ Nurse: Will be included in next generation`);
      } else {
        messages.push(`⚠️ Nurse: ${nurseResult.message}`);
      }
      
      const summaryMessage = `Elderly profile saved successfully!\n\n${messages.join('\n')}`;
      
      console.log(`\n%c✅ INTEGRATION COMPLETE`, 'color: #95E1D3; font-weight: bold; font-size: 16px');
      console.log(summaryMessage);
      
      // Show success modal instead of alert
      setSuccessMessage(summaryMessage);
      setShowSuccessModal(true);
      
      setShowIntegrationModal(false);
      setShowOverlay(false);
      setPendingElderlyId(null);
      setScheduleInfo(null);
      resetForm();
      
    } catch (error) {
      console.error("Error integrating elderly:", error);
      setSuccessMessage("Failed to integrate elderly into schedule. Please try again.");
      setShowSuccessModal(true);
    } finally {
      setIsIntegrating(false);
    }
  };

  // Handle skip integration
  const handleSkipIntegration = () => {
    setSuccessMessage(`Elderly profile saved successfully! They will be included in the next schedule generation.`);
    setShowSuccessModal(true);
    setShowIntegrationModal(false);
    setShowOverlay(false);
    setPendingElderlyId(null);
    setScheduleInfo(null);
    resetForm();
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

  const totalElderlyInHouse = elderlyList.filter(
    (e) => e.house_id === houseId && e.elderly_status === "Alive"
  ).length;

  return (
  <div className="elderly-profile-container wide-layout">
  {/* Header */}
  <div className="elderly-profile-header">
    <div className="header-house">
  <div className="header-top">
    <img
      src={houseImages[houseId] || "/images/default-house.png"}
      alt={houseNames[houseId]}
      className="header-image"
    />
    <h1 className="header-title">{houseNames[houseId]}</h1>
  </div>
  <p className="house-shortTitle">
    {houseShortTitles[houseId] || "No short title available."}
  </p>
  <div className="header-title-wrapper">
    <span className="total-elderly"> Total Number of Alive Elderly: {totalElderlyInHouse}</span>
  </div>
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
            Sort {sortAsc ? "(A-Z) ▲" : "(Z-A) ▼"}
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
          <th className="icon-col"></th>
          <th className="name-col">Full Name</th>
          <th className="age-col">Age</th>
          <th className="mobility-col">Mobility Status</th>
          {showSelectPanel && <th className="select-col">Select</th>}
          <th className="action-th">Action</th>
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
            >
              <td className="icon-cell">
                <FaUserCircle size={25} color="#4A90E2" />
              </td>
              <td className="name-cell">
                {elder.elderly_fname} {elder.elderly_lname}
              </td>
              <td className="age-cell">{elder.elderly_age ?? "—"}</td>
              <td className="mobility-cell">{elder.elderly_mobilityStatus || "—"}</td>
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
              <td
    className="action-cell"
    onClick={(e) => {
      e.stopPropagation();
      setEditElderlyId(elder.id); // ✅ open overlay instead of navigating
    }}
    title="Edit"
  >
    <span className="pencil-icon">✎</span>
  </td>


            </tr>
          );
        })}
      </tbody>
    </table>
    
        )}
        {editElderlyId && (
  <EditElderlyOverlay
    elderId={editElderlyId}
    onClose={() => setEditElderlyId(null)}
    onUpdate={async () => {
      const q = await getDocs(collection(db, "elderly"));
      setElderlyList(q.docs.map((d) => ({ id: d.id, ...d.data() })));
    }}
  />
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
              <label>First Name<span className="required-asterisk">*</span></label>
              <input
                type="text"
                name="elderly_fname"
                value={formData.elderly_fname}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group">
              <label>Last Name<span className="required-asterisk">*</span></label>
              <input
                type="text"
                name="elderly_lname"
                value={formData.elderly_lname}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group">
              <label>Date of Birth<span className="required-asterisk">*</span></label>
              <input
                type="date"
                name="elderly_bday"
                value={formData.elderly_bday}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group">
              <label>Age<span className="required-asterisk">*</span></label>
              <input
                type="number"
                name="elderly_age"
                value={formData.elderly_age}
                onChange={handleChange}
                min="1"
                required
              />
            </div>

            <div className="form-group">
              <label>Sex<span className="required-asterisk">*</span></label>
              <select
                name="elderly_sex"
                value={formData.elderly_sex}
                onChange={handleChange}
                required
              >
                <option>Male</option>
                <option>Female</option>
              </select>
            </div>

            <div className="form-group">
              <label>Mobility Status<span className="required-asterisk">*</span></label>
              <select
                name="elderly_mobilityStatus"
                value={formData.elderly_mobilityStatus}
                onChange={handleChange}
                required
              >
                <option>Independent</option>
                <option>Needs Assistance</option>
                <option>Bedridden</option>
              </select>
            </div>

            <div className="form-group">
              <label>Diet Notes<span className="optional-label">(Optional)</span></label>
              <input
                type="text"
                name="elderly_dietNotes"
                value={formData.elderly_dietNotes}
                onChange={handleChange}
              />
            </div>

            <div className="form-group">
              <label>Condition<span className="optional-label">(Optional)</span></label>
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

      {/* Floating Select Panel */}
      {showSelectPanel && (
        <div className="select-panel">
          <div className="select-panel-header">
            <strong>Switch House</strong>
            <button className="select-panel-close" onClick={closeSelectPanel}>
              ✕
            </button>
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
                  .map((e) => (
                    <li key={e.id}>
                      {e.elderly_fname} {e.elderly_lname}
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className="select-panel-actions">
            <button
              className="done-btn"
              onClick={() => {
                if (selectedElderly.length === 0) {
                  alert("Please select at least one elderly.");
                  return;
                }
                setShowAllocateModal(true);
                setShowSelectPanel(false);
              }}
            >
              Done
            </button>
            <button className="cancel-btn" onClick={closeSelectPanel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Allocate Modal */}
      {showAllocateModal && (
        <div className="overlay">
          <div className="overlay-content">
            <span
              className="overlay-close"
              onClick={() => setShowAllocateModal(false)}
            >
              ✖
            </span>
            <h2 className="overlay-header">Allocate to New House</h2>

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
              <button
                className="cancel-btn"
                onClick={() => setShowAllocateModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Integration Confirmation Modal */}
      {showIntegrationModal && (
        <div className="overlay">
          <div className="overlay-content integration-modal-content">
            <span className="overlay-close" onClick={handleSkipIntegration}>
              ✖
            </span>
            
            <h2 className="overlay-header integration-modal-header">
              🔄 Integrate Elderly into Schedule
            </h2>

            <div className="integration-info-box">
              <p className="integration-success-text">
                <strong>Elderly profile saved successfully!</strong>
              </p>
              <p className="integration-house-text">
                Active schedules found for <strong>{houseNames[houseId]}</strong>:
              </p>
              <ul className="integration-staff-list">
                <li><strong>Caregivers:</strong> {scheduleInfo?.caregiverCount || 0} assigned</li>
                <li><strong>Nurses:</strong> {scheduleInfo?.nurseCount || 0} assigned</li>
              </ul>
              <p className="integration-question-text">
                Would you like to <strong>automatically integrate</strong> the new elderly into {
                  (scheduleInfo?.caregiverCount > 0) && (scheduleInfo?.nurseCount > 0)
                    ? 'both schedules' 
                    : (scheduleInfo?.caregiverCount > 0)
                      ? 'the caregiver schedule' 
                      : 'the nurse schedule'
                } now?
              </p>
            </div>

            <div className="integration-details-box">
              <p className="integration-details-header">
                ℹ️ <strong>What happens:</strong>
              </p>
              <ul className="integration-details-list">
                <li><strong>Incremental Addition:</strong> New elderly assigned to staff with least load</li>
                <li><strong>Minimal Disruption:</strong> Existing relationships remain unchanged</li>
                <li><strong>Both Schedules:</strong> Integrated into caregiver AND nurse schedules</li>
                <li><strong>Fair Distribution:</strong> Maintains balanced workload across all staff</li>
              </ul>
            </div>

            <div className="overlay-buttons">
              <button 
                className="save-btn integration-confirm-btn" 
                onClick={handleConfirmIntegration}
                disabled={isIntegrating}
              >
                {isIntegrating ? 'Integrating...' : '✅ Yes, Redistribute'}
              </button>
              <button
                className="cancel-btn integration-skip-btn"
                onClick={handleSkipIntegration}
                disabled={isIntegrating}
              >
                ⏭️ Skip for Now
              </button>
            </div>

            <p className="integration-footer-text">
              If you skip, the new elderly will be included in the next schedule generation.
            </p>
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
  );
}
