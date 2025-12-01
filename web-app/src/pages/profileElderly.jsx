// src/pages/profileElderly.jsx
import React, { useState, useEffect, useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MdArrowBack, MdCake, MdTransgender, MdAccessible, MdHome } from "react-icons/md";
import { FaHeartbeat, FaUser, FaNotesMedical, FaClipboardList, FaUserSlash } from "react-icons/fa";
import { doc, getDoc, updateDoc, arrayUnion, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../firebase";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { AuthContext } from "../contexts/authcontext";
import "../css/profileElderly.css";
import "../css/activity-log.css";


export default function Profile_Elderly() {
  const { id } = useParams(); // Firestore Document ID from route
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const [currentAdminName, setCurrentAdminName] = useState("");
  const [elder, setElder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showEditOverlay, setShowEditOverlay] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [formData, setFormData] = useState({});
  const [selectedImage, setSelectedImage] = useState(null);
  const [previewImage, setPreviewImage] = useState("");


  const storage = getStorage();


  const labelMap = {
    elderly_fname: "First Name",
    elderly_lname: "Last Name",
    elderly_bday: "Birth Date",
    elderly_age: "Age",
    elderly_dietNotes: "Dietary Notes",
    elderly_condition: "Health Condition",
  };


  const formatTimestamp = (ts) => {
    if (!ts) return "N/A";
    if (ts.toDate) return ts.toDate().toLocaleDateString();
    return ts;
  };


  const formatDateInput = (ts) => {
    if (!ts) return "";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toISOString().split("T")[0];
  };

  // Fetch admin name for logging
  useEffect(() => {
    const fetchAdminName = async () => {
      try {
        let currentUser = user;
        
        // Fallback to auth.currentUser if AuthContext is null
        if (!currentUser) {
          currentUser = auth.currentUser;
        }

        if (currentUser) {
          console.log("🔍 Fetching admin name for UID:", currentUser.uid);
          
          const userDocRef = doc(db, "users", currentUser.uid);
          const userDocSnap = await getDoc(userDocRef);
          
          if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            const fullName = `${userData.user_fname || ""} ${userData.user_lname || ""}`.trim();
            
            if (fullName) {
              setCurrentAdminName(fullName);
              console.log("✅ Admin name set:", fullName);
            } else {
              // Fallback to email if name fields are empty
              setCurrentAdminName(currentUser.email || "Admin User");
              console.log("⚠️ Using email as fallback:", currentUser.email);
            }
          } else {
            // User document doesn't exist, use email
            setCurrentAdminName(currentUser.email || "Admin User");
            console.log("⚠️ User document not found, using email:", currentUser.email);
          }
        } else {
          console.log("❌ No authenticated user found");
          setCurrentAdminName("Admin User");
        }
      } catch (error) {
        console.error("❌ Error fetching admin name:", error);
        // Fallback to a default name on error
        setCurrentAdminName(user?.email || "Admin User");
      }
    };

    fetchAdminName();
  }, [user]);

  useEffect(() => {
    const fetchElder = async () => {
      try {
        // fetch doc directly by Firestore document ID
        const elderRef = doc(db, "elderly", id);
        const docSnap = await getDoc(elderRef);


        if (docSnap.exists()) {
          setElder({ id: docSnap.id, ...docSnap.data() });
          setFormData({
            ...docSnap.data(),
            elderly_bday: docSnap.data().elderly_bday,
            elderly_deathDate: docSnap.data().elderly_deathDate,
          });
          setPreviewImage(docSnap.data().elderly_profilePic || "");
        } else {
          setElder(null);
        }
        setLoading(false);
      } catch (err) {
        console.error("Error fetching elderly profile:", err);
        setLoading(false);
      }
    };
    if (id) fetchElder();
  }, [id]);


  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };


  const handleImageChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedImage(file);
      setPreviewImage(URL.createObjectURL(file));
    }
  };


  const handleUpdate = async () => {
    try {
      let uploadedImageUrl = formData.elderly_profilePic || "";


      if (selectedImage) {
        const storageRef = ref(storage, `elderlyPics/${Date.now()}_${selectedImage.name}`);
        await uploadBytes(storageRef, selectedImage);
        uploadedImageUrl = await getDownloadURL(storageRef);
      }


      const elderRef = doc(db, "elderly", elder.id);


      let birthdayValue = formData.elderly_bday;
      if (typeof birthdayValue === "string") birthdayValue = new Date(birthdayValue);

      // Track what changed for logging
      const changes = [];
      const oldData = elder;
      
      if (formData.elderly_fname !== oldData.elderly_fname) {
        changes.push(`First Name: "${oldData.elderly_fname}" → "${formData.elderly_fname}"`);
      }
      if (formData.elderly_lname !== oldData.elderly_lname) {
        changes.push(`Last Name: "${oldData.elderly_lname}" → "${formData.elderly_lname}"`);
      }
      if (formData.elderly_age !== oldData.elderly_age) {
        changes.push(`Age: ${oldData.elderly_age} → ${formData.elderly_age}`);
      }
      if (formData.elderly_sex !== oldData.elderly_sex) {
        changes.push(`Sex: "${oldData.elderly_sex}" → "${formData.elderly_sex}"`);
      }
      if (formData.elderly_mobilityStatus !== oldData.elderly_mobilityStatus) {
        changes.push(`Mobility: "${oldData.elderly_mobilityStatus}" → "${formData.elderly_mobilityStatus}"`);
      }
      if (formData.elderly_dietNotes !== oldData.elderly_dietNotes) {
        changes.push(`Diet Notes: "${oldData.elderly_dietNotes}" → "${formData.elderly_dietNotes}"`);
      }
      if (formData.elderly_condition !== oldData.elderly_condition) {
        changes.push(`Condition: "${oldData.elderly_condition}" → "${formData.elderly_condition}"`);
      }
      if (selectedImage) {
        changes.push("Profile picture updated");
      }

      const changesDetail = changes.length > 0 ? changes.join(", ") : "No changes detected";

      await updateDoc(elderRef, {
        elderly_fname: formData.elderly_fname,
        elderly_lname: formData.elderly_lname,
        elderly_bday: birthdayValue,
        elderly_age: Number(formData.elderly_age),
        elderly_sex: formData.elderly_sex,
        elderly_mobilityStatus: formData.elderly_mobilityStatus,
        elderly_dietNotes: formData.elderly_dietNotes,
        elderly_condition: formData.elderly_condition,
        elderly_profilePic: uploadedImageUrl,
        activity_log: arrayUnion({
          action: "Profile Updated",
          performed_by: currentAdminName || user?.email || "Admin User",
          timestamp: new Date(),
          details: changesDetail
        }),
        last_updated_by: currentAdminName || user?.email || "Admin User",
        last_updated_at: serverTimestamp()
      });

      console.log("✏️ Elderly profile updated:", {
        id: elder.id,
        name: `${formData.elderly_fname} ${formData.elderly_lname}`,
        changes: changesDetail,
        by: currentAdminName || user?.email || "Admin User"
      });


      setElder((prev) => ({ ...prev, ...formData, elderly_profilePic: uploadedImageUrl }));
      setShowEditOverlay(false);
      setSelectedImage(null);
    } catch (err) {
      console.error("Update failed:", err);
    }
  };


  if (loading) return <p>Loading...</p>;
  if (!elder) return <p>Elderly profile not found.</p>;


  return (
    <>
      {/* --- Header Container --- */}
      <div className="elderly-profile-header-container">
        <button onClick={() => navigate(-1)}>
          <MdArrowBack /> Back
        </button>
        <h1>{elder.elderly_sex === "Female" ? "Lola" : "Lolo"} {elder.elderly_fname}</h1>
        <button onClick={() => setShowEditOverlay(true)}>Edit Profile</button>
      </div>


      {/* --- Profile Container --- */}
      <div className="elderly-profile-container-img">
        <div className="profile-left">
          <img
            src={elder.elderly_profilePic || "/images/people_icon.png"}
            alt={elder.elderly_fname}
            className="profile-picture-large"
          />
        </div>


        <div className="elderly-details">
          <p><FaUser className="elder-icon"/> <strong>Full Name: </strong> {elder.elderly_fname} {elder.elderly_lname}</p>
          <p><MdCake className="elder-icon"/> <strong>Age: </strong> {elder.elderly_age}</p>
          <p><MdCake className="elder-icon"/> <strong>Birth Date: </strong> {formatTimestamp(elder.elderly_bday)}</p>
          <p><MdTransgender className="elder-icon"/> <strong>Sex: </strong> {elder.elderly_sex}</p>
          <p><MdAccessible className="elder-icon"/> <strong>Mobility Status: </strong> {elder.elderly_mobilityStatus}</p>
          <p><FaNotesMedical className="elder-icon"/> <strong>Dietary Notes: </strong> {elder.elderly_dietNotes || "N/A"}</p>
          <p><FaHeartbeat className="elder-icon"/> <strong>Health Condition: </strong> {elder.elderly_condition || "N/A"}</p>
          <p>
            {elder.elderly_status === "Alive" ? (
              <><FaUser className="elder-icon"/> <strong>Status: </strong> Alive</>
            ) : (
              <><FaUserSlash className="elder-icon"/> <strong>Status: </strong> Deceased</>
            )}
          </p>
          {elder.elderly_status === "Deceased" && (
            <>
              <p><FaClipboardList className="elder-icon"/> <strong>Cause of Death: </strong> {elder.elderly_cause || "N/A"}</p>
              <p><MdCake className="elder-icon"/> <strong>Date of Death: </strong> {formatTimestamp(elder.elderly_deathDate)}</p>
            </>
          )}
          <p><MdHome className="elder-icon"/> <strong>House: </strong> {elder.house_id}</p>
        </div>
      </div>

      {/* --- Activity Log Section --- */}
      {elder.activity_log && elder.activity_log.length > 0 && (
        <div className="activity-log-section">
          <h2>Activity Log</h2>
          <div className="activity-timeline">
            {[...elder.activity_log].reverse().map((log, index) => (
              <div key={index} className="activity-item">
                <div className="activity-header">
                  <span className="activity-admin">{log.performed_by || "Unknown Admin"}</span>
                  <span className="activity-time">
                    {log.timestamp?.toDate 
                      ? log.timestamp.toDate().toLocaleString() 
                      : new Date(log.timestamp).toLocaleString()}
                  </span>
                </div>
                <div className="activity-action">
                  <strong>{log.action}</strong>
                </div>
                <div className="activity-details">{log.details}</div>
              </div>
            ))}
          </div>
        </div>
      )}


      {/* --- Edit Overlay --- */}
      {showEditOverlay && (
        <div className="overlay">
          <div className="overlay-content">
            <span className="overlay-close" onClick={() => setShowEditOverlay(false)}>✕</span>
            <h2 className="overlay-header">Edit Elderly Profile</h2>


            <div className="image-upload-box" onClick={() => document.getElementById("fileInput").click()}>
              {previewImage ? (
                <img src={previewImage} alt="Preview" className="preview-img" />
              ) : (
                <div className="placeholder-box">
                  <span className="placeholder-text">+ Upload Photo</span>
                </div>
              )}
              <input
                type="file"
                id="fileInput"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleImageChange}
              />
            </div>


            {["elderly_fname","elderly_lname","elderly_bday","elderly_age","elderly_dietNotes","elderly_condition"].map(field => (
              <div className="form-group" key={field}>
                <label>{labelMap[field]}</label>
                <input
                  type={field === "elderly_age" ? "number" : field === "elderly_bday" ? "date" : "text"}
                  name={field}
                  value={field === "elderly_bday" ? formatDateInput(formData[field]) : formData[field] || ""}
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
              <select 
                name="elderly_mobilityStatus" 
                value={
                  ["Independent", "Assisted", "Wheelchair-bound", "Bedridden", "Needs Supervision"].includes(formData.elderly_mobilityStatus)
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
              >
                <option>Independent</option>
                <option>Assisted</option>
                <option>Wheelchair-bound</option>
                <option>Bedridden</option>
                <option>Needs Supervision</option>
                <option>Custom</option>
              </select>
              {!["Independent", "Assisted", "Wheelchair-bound", "Bedridden", "Needs Supervision"].includes(formData.elderly_mobilityStatus) && (
                <input
                  type="text"
                  name="elderly_mobilityStatus"
                  value={formData.elderly_mobilityStatus || ""}
                  onChange={handleChange}
                  placeholder="Enter custom mobility status"
                  style={{ marginTop: "8px" }}
                />
              )}
            </div>


            <div className="overlay-buttons">
              <button onClick={() => setShowConfirm(true)}>Save Changes</button>
              <button onClick={() => setShowEditOverlay(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}


      {/* --- Confirmation Modal --- */}
      {showConfirm && (
        <div className="overlay">
          <div className="overlay-content">
            <h3>Are you really sure you want to modify this profile?</h3>
            <div className="overlay-buttons">
              <button onClick={() => { handleUpdate(); setShowConfirm(false); }}>Yes, Save</button>
              <button onClick={() => setShowConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
