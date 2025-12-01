import React, { useState, useEffect, useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MdArrowBack } from "react-icons/md";
import { FaHeartbeat, FaUserSlash, FaUserCircle } from "react-icons/fa";
import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  query,
  where,
  getDoc,
  arrayUnion,
  serverTimestamp,
  deleteDoc,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { AuthContext } from "../contexts/authcontext";
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

export default function HouseView({ houseId: propHouseId, currentHouse, onEditHouse, onDeleteHouse }) {
  const { houseId: paramHouseId } = useParams();
  const houseId = propHouseId || paramHouseId;
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const [currentAdminName, setCurrentAdminName] = useState("");

  const [activeTab, setActiveTab] = useState("Alive");
  const [searchTerm, setSearchTerm] = useState("");
  const [elderlyList, setElderlyList] = useState([]);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showSelectPanel, setShowSelectPanel] = useState(false);
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [selectedElderly, setSelectedElderly] = useState([]);
  const [reason, setReason] = useState("");
  const [showDeleteElderlyMode, setShowDeleteElderlyMode] = useState(false);
  const [selectedForDeletion, setSelectedForDeletion] = useState([]);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
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
  const [houses, setHouses] = useState([]); // Store all houses from Firestore
  const storage = getStorage();

  const houseImages = {
    H001: "/images/Sebastian.png",
    H002: "/images/Emmanuel.png",
    H003: "/images/Charbell.png",
    H004: "/images/Rose.png",
    H005: "/images/Gabriel.png",
  };

  // Function to get house image with fallback to default
  const getHouseImage = (hId) => {
    if (hId === "INFIRMARY") {
      return "/images/infirmary-icon.png";
    }
    return houseImages[hId] || "/images/default-house.png";
  };

  // Function to get house name dynamically
  const getHouseName = (hId) => {
    if (hId === "INFIRMARY") {
      return "🏥 Infirmary";
    }
    const house = houses.find(h => h.house_id === hId);
    return house ? house.house_name : "Unknown House";
  };

  // Function to get house short title dynamically
  const getHouseShortTitle = (hId) => {
    if (hId === "INFIRMARY") {
      return "Elderly currently receiving medical care";
    }
    const house = houses.find(h => h.house_id === hId);
    return house ? (house.house_desc || "No description available.") : "No description available.";
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
  const [infirmaryTransfers, setInfirmaryTransfers] = useState([]);

  // Fetch current admin name
  useEffect(() => {
    const fetchAdminName = async () => {
      console.log("🔍 AuthContext user:", user);
      
      if (!user) {
        console.warn("⚠️ User is NULL - You might not be logged in!");
        const currentUser = auth.currentUser;
        console.log("🔍 Firebase Auth currentUser:", currentUser);
        
        if (currentUser) {
          console.log("✅ Found user from Firebase Auth directly");
          try {
            const adminDoc = await getDoc(doc(db, "users", currentUser.uid));
            if (adminDoc.exists()) {
              const adminData = adminDoc.data();
              const fullName = `${adminData.user_fname || ""} ${adminData.user_lname || ""}`.trim();
              
              if (!fullName) {
                setCurrentAdminName(currentUser.email || "Admin User");
                console.log("✅ Using fallback name:", currentUser.email || "Admin User");
              } else {
                setCurrentAdminName(fullName);
                console.log("✅ Admin name loaded:", fullName);
              }
            }
          } catch (error) {
            console.error("❌ Error fetching admin name:", error);
            setCurrentAdminName(currentUser.email || "Admin User");
          }
        } else {
          console.error("❌ No user logged in at all!");
          setCurrentAdminName("Admin User");
        }
        return;
      }
      
      try {
        console.log("🔍 Fetching admin name for user:", user.uid);
        const adminDoc = await getDoc(doc(db, "users", user.uid));
        if (adminDoc.exists()) {
          const adminData = adminDoc.data();
          const fullName = `${adminData.user_fname || ""} ${adminData.user_lname || ""}`.trim();
          
          if (!fullName) {
            setCurrentAdminName(user.email || "Admin User");
            console.log("✅ Using fallback name:", user.email || "Admin User");
          } else {
            setCurrentAdminName(fullName);
            console.log("✅ Admin name loaded:", fullName);
          }
        } else {
          console.warn("⚠️ Admin document not found for user:", user.uid);
          setCurrentAdminName(user.email || "Admin User");
        }
      } catch (error) {
        console.error("❌ Error fetching admin name:", error);
        setCurrentAdminName(user.email || "Admin User");
      }
    };
    fetchAdminName();
  }, [user]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch elderly
        const elderlySnapshot = await getDocs(collection(db, "elderly"));
        setElderlyList(
          elderlySnapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
        );

        // Fetch houses
        const housesSnapshot = await getDocs(collection(db, "house"));
        const housesList = housesSnapshot.docs.map((d) => ({
          id: d.id,
          ...d.data()
        }));
        setHouses(housesList);
        
        // Fetch infirmary transfers (approved ones to get transfer reasons)
        const transfersSnapshot = await getDocs(
          query(collection(db, "infirmary_transfers"), where("transfer_status", "==", "approved"))
        );
        const transfersList = transfersSnapshot.docs.map((d) => ({
          id: d.id,
          ...d.data()
        }));
        setInfirmaryTransfers(transfersList);
      } catch (err) {
        console.error("Error fetching data:", err);
      }
    };
    fetchData();
  }, []);

  // Filter elderly based on houseId or Infirmary
  const elderlyInHouse = houseId === "INFIRMARY"
    ? elderlyList.filter((e) => e.elderly_location === "Infirmary")
    : elderlyList.filter((e) => e.house_id === houseId);

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
        // Add audit logging fields
        created_by: currentAdminName || user?.email || "Admin User",
        created_at: serverTimestamp(),
        activity_log: arrayUnion({
          action: "Created",
          performed_by: currentAdminName || user?.email || "Admin User",
          timestamp: new Date(),
          details: `Elderly profile created in ${houseId}`
        })
      };

      // Save elderly to database first
      const docRef = await addDoc(collection(db, "elderly"), newElderly);
      const newElderlyId = docRef.id;
      
      console.log("✅ Elderly profile created by:", currentAdminName || user?.email || "Admin User");
      
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

  const toggleDeleteSelection = (elderId) => {
    setSelectedForDeletion((prev) =>
      prev.includes(elderId)
        ? prev.filter((id) => id !== elderId)
        : [...prev, elderId]
    );
  };

  const handleDeleteElderlyClick = () => {
    setShowDeleteElderlyMode(true);
    setSelectedForDeletion([]);
  };

  const cancelDeleteMode = () => {
    setShowDeleteElderlyMode(false);
    setSelectedForDeletion([]);
  };

  const confirmDeleteElderly = async () => {
    if (selectedForDeletion.length === 0) {
      alert("Please select at least one elderly to delete.");
      return;
    }

    try {
      // Delete all selected elderly with logging
      for (const elderlyId of selectedForDeletion) {
        const elderlyDoc = await getDoc(doc(db, "elderly", elderlyId));
        const elderlyData = elderlyDoc.data();
        
        // Log deletion before removing
        console.log("🗑️ Deleting elderly profile:", {
          id: elderlyId,
          name: `${elderlyData?.elderly_fname} ${elderlyData?.elderly_lname}`,
          deleted_by: currentAdminName || user?.email || "Admin User"
        });
        
        await deleteDoc(doc(db, "elderly", elderlyId));
      }

      console.log("✅ Deleted", selectedForDeletion.length, "elderly profiles by:", currentAdminName || user?.email || "Admin User");
      
      setSuccessMessage(`Successfully deleted ${selectedForDeletion.length} elderly profile(s).`);
      setShowSuccessModal(true);
      setShowDeleteConfirmModal(false);
      setShowDeleteElderlyMode(false);
      setSelectedForDeletion([]);

      // Refresh elderly list
      const q = await getDocs(collection(db, "elderly"));
      setElderlyList(q.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Error deleting elderly:", error);
      alert("Failed to delete elderly profiles. Please try again.");
    }
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
        const elderDoc = await getDoc(elderRef);
        const elderData = elderDoc.data();
        const oldHouseId = elderData?.house_id;
        
        await updateDoc(elderRef, {
          house_id: formData.newHouseId,
          allocation_reason: reason,
          activity_log: arrayUnion({
            action: "Reallocated",
            performed_by: currentAdminName || user?.email || "Admin User",
            timestamp: new Date(),
            details: `Moved from ${oldHouseId} to ${formData.newHouseId}. Reason: ${reason}`
          })
        });

        console.log("🏠 Reallocated elderly:", {
          id: elderId,
          name: `${elderData?.elderly_fname} ${elderData?.elderly_lname}`,
          from: oldHouseId,
          to: formData.newHouseId,
          by: currentAdminName || user?.email || "Admin User"
        });
      });
      await Promise.all(updates);

      console.log("✅ Reallocated", selectedElderly.length, "elderly profiles by:", currentAdminName || user?.email || "Admin User");

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

  const totalElderlyInHouse = houseId === "INFIRMARY"
    ? elderlyList.filter((e) => e.elderly_location === "Infirmary" && e.elderly_status === "Alive").length
    : elderlyList.filter((e) => e.house_id === houseId && e.elderly_status === "Alive").length;

  return (
  <div className="elderly-profile-container wide-layout">
  {/* Header */}
  <div className="elderly-profile-header">
    <div className="header-house">
  <div className="header-top">
    {houseId !== "INFIRMARY" && getHouseImage(houseId) && (
      <img
        src={getHouseImage(houseId)}
        alt={getHouseName(houseId)}
        className="header-image"
      />
    )}
    <h1 className="header-title">
      {getHouseName(houseId)}
    </h1>
  </div>
  <p className="house-shortTitle">
    {getHouseShortTitle(houseId)}
  </p>
  <div className="header-title-wrapper">
    <span className="total-elderly"> Total Number of Alive Elderly: {totalElderlyInHouse}</span>
  </div>
</div>
  </div>

      {/* House Action Buttons */}
      {currentHouse && houseId !== "INFIRMARY" && (
        <div className="house-action-buttons">
          <button
            className="house-action-btn edit-house-btn"
            onClick={() => onEditHouse(currentHouse)}
            title={`Edit ${currentHouse.house_name}`}
          >
            ✏️ Edit House
          </button>
          <button
            className="house-action-btn delete-house-btn"
            onClick={() => onDeleteHouse(currentHouse)}
            title={`Delete ${currentHouse.house_name}`}
          >
            🗑️ Delete House
          </button>
          <button
            className="house-action-btn delete-elderly-btn"
            onClick={handleDeleteElderlyClick}
            title="Delete elderly profiles"
          >
            🗑️ Delete Elderly
          </button>
        </div>
      )}

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

      {/* Delete Elderly Mode Banner */}
      {showDeleteElderlyMode && (
        <div style={{
          background: '#FFF3CD',
          border: '2px solid #FFECB5',
          borderRadius: '8px',
          padding: '15px',
          marginBottom: '15px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <strong style={{ color: '#856404', fontSize: '16px' }}>🗑️ Delete Elderly Mode</strong>
            <p style={{ color: '#856404', margin: '5px 0 0 0', fontSize: '14px' }}>
              Select the elderly profiles you want to delete ({selectedForDeletion.length} selected)
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setShowDeleteConfirmModal(true)}
              disabled={selectedForDeletion.length === 0}
              style={{
                background: '#dc3545',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                cursor: selectedForDeletion.length === 0 ? 'not-allowed' : 'pointer',
                opacity: selectedForDeletion.length === 0 ? 0.5 : 1
              }}
            >
              Delete Selected ({selectedForDeletion.length})
            </button>
            <button
              onClick={cancelDeleteMode}
              style={{
                background: '#6c757d',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Cancel
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
          <th className="mobility-col">{houseId === "INFIRMARY" ? "Transfer Reason" : "Mobility Status"}</th>
          {showSelectPanel && <th className="select-col">Select</th>}
          {showDeleteElderlyMode && <th className="select-col">Delete</th>}
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
              <td className="mobility-cell">
                {houseId === "INFIRMARY" 
                  ? (infirmaryTransfers.find(t => t.elderly_id === elder.id)?.transfer_reason || "—")
                  : (elder.elderly_mobilityStatus || "—")
                }
              </td>
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
              {showDeleteElderlyMode && (
                <td
                  className="select-cell"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selectedForDeletion.includes(elder.id)}
                    onChange={() => toggleDeleteSelection(elder.id)}
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
                value={
                  ["Independent", "Assisted", "Wheelchair-bound", "Bedridden", "Needs Supervision", "Needs Assistance"].includes(formData.elderly_mobilityStatus)
                    ? formData.elderly_mobilityStatus
                    : "Custom"
                }
                onChange={(e) => {
                  if (e.target.value !== "Custom") {
                    handleChange(e);
                  } else {
                    setFormData(prev => ({ ...prev, elderly_mobilityStatus: "" }));
                  }
                }}
                required
              >
                <option value="">Select mobility status</option>
                <option>Independent</option>
                <option>Assisted</option>
                <option>Wheelchair-bound</option>
                <option>Bedridden</option>
                <option>Needs Supervision</option>
                <option>Needs Assistance</option>
                <option>Custom</option>
              </select>
              {!["Independent", "Assisted", "Wheelchair-bound", "Bedridden", "Needs Supervision", "Needs Assistance"].includes(formData.elderly_mobilityStatus) && formData.elderly_mobilityStatus !== "" && (
                <input
                  type="text"
                  name="elderly_mobilityStatus"
                  value={formData.elderly_mobilityStatus || ""}
                  onChange={handleChange}
                  placeholder="Enter custom mobility status"
                  style={{ marginTop: "8px" }}
                  required
                />
              )}
              {formData.elderly_mobilityStatus === "" && (
                <input
                  type="text"
                  name="elderly_mobilityStatus"
                  value=""
                  onChange={handleChange}
                  placeholder="Enter custom mobility status"
                  style={{ marginTop: "8px" }}
                  required
                  autoFocus
                />
              )}
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
                {houses
                  .filter((house) => house.house_id !== houseId) // Exclude current house
                  .map((house) => (
                    <option key={house.id} value={house.house_id}>
                      {house.house_name}
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
                Active schedules found for <strong>{getHouseName(houseId)}</strong>:
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

      {/* Delete Elderly Confirmation Modal */}
      {showDeleteConfirmModal && (
        <div className="overlay">
          <div className="overlay-content" style={{ maxWidth: '500px' }}>
            <span
              className="overlay-close"
              onClick={() => setShowDeleteConfirmModal(false)}
            >
              ✖
            </span>
            <h2 className="overlay-header" style={{ color: '#dc3545' }}>⚠️ Delete Elderly Profiles</h2>
            
            <div style={{ padding: '20px 0' }}>
              <p style={{ fontSize: '16px', marginBottom: '15px' }}>
                Are you sure you want to delete <strong>{selectedForDeletion.length}</strong> elderly profile(s)?
              </p>
              
              <div style={{ 
                maxHeight: '200px', 
                overflowY: 'auto', 
                background: '#f8f9fa', 
                padding: '10px', 
                borderRadius: '6px',
                marginBottom: '15px'
              }}>
                <ul style={{ margin: 0, paddingLeft: '20px' }}>
                  {elderlyList
                    .filter((e) => selectedForDeletion.includes(e.id))
                    .map((e) => (
                      <li key={e.id} style={{ marginBottom: '5px' }}>
                        {e.elderly_fname} {e.elderly_lname}
                      </li>
                    ))}
                </ul>
              </div>
              
              <div style={{ 
                background: '#FFF3CD', 
                border: '1px solid #FFECB5', 
                borderRadius: '6px', 
                padding: '12px'
              }}>
                <p style={{ fontSize: '13px', color: '#856404', margin: 0 }}>
                  ⚠️ <strong>Warning:</strong> This action cannot be undone. All elderly profile data will be permanently deleted.
                </p>
              </div>
            </div>

            <div className="overlay-buttons">
              <button 
                className="save-btn" 
                onClick={confirmDeleteElderly}
                style={{ background: '#dc3545' }}
              >
                Delete {selectedForDeletion.length} Profile(s)
              </button>
              <button
                className="cancel-btn"
                onClick={() => setShowDeleteConfirmModal(false)}
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
  );
}