// src/pages/profileNurse.jsx
import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MdArrowBack, MdCake } from "react-icons/md";
import { FaUser, FaPhone, FaEnvelope } from "react-icons/fa";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import "./profileNurse.css";

export default function ProfileNurse() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [nurse, setNurse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showEditOverlay, setShowEditOverlay] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [formData, setFormData] = useState({});
  const [selectedImage, setSelectedImage] = useState(null);
  const [previewImage, setPreviewImage] = useState("");

  const storage = getStorage();

  const labelMap = {
    user_fname: "First Name",
    user_lname: "Last Name",
    user_email: "Email",
    user_bday: "Birth Date",
    user_contactNum: "Contact Number",
  };

  const formatDateInput = (ts) => {
    if (!ts) return "";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toISOString().split("T")[0];
  };

  useEffect(() => {
    const fetchNurse = async () => {
      try {
        const nurseRef = doc(db, "users", id);
        const docSnap = await getDoc(nurseRef);

        if (docSnap.exists()) {
          setNurse({ id: docSnap.id, ...docSnap.data() });
          setFormData({ ...docSnap.data() });
          setPreviewImage(docSnap.data().user_profilePic || "");
        } else {
          setNurse(null);
        }
      } catch (err) {
        console.error("Error fetching nurse profile:", err);
      } finally {
        setLoading(false);
      }
    };

    if (id) fetchNurse();
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
      let uploadedImageUrl = formData.user_profilePic || "";

      if (selectedImage) {
        const storageRef = ref(storage, `nursePics/${Date.now()}_${selectedImage.name}`);
        await uploadBytes(storageRef, selectedImage);
        uploadedImageUrl = await getDownloadURL(storageRef);
      }

      const nurseRef = doc(db, "users", nurse.id);

      let birthdayValue = formData.user_bday;
      if (typeof birthdayValue === "string") birthdayValue = new Date(birthdayValue);

      await updateDoc(nurseRef, {
        user_fname: formData.user_fname,
        user_lname: formData.user_lname,
        user_email: formData.user_email,
        user_bday: birthdayValue,
        user_contactNum: formData.user_contactNum,
        user_profilePic: uploadedImageUrl,
      });

      setNurse((prev) => ({ ...prev, ...formData, user_profilePic: uploadedImageUrl }));
      setShowEditOverlay(false);
      setSelectedImage(null);
    } catch (err) {
      console.error("Update failed:", err);
    }
  };

  if (loading) return <p>Loading...</p>;
  if (!nurse) return <p>Nurse profile not found.</p>;

  return (
    <>
      {/* Header */}
      <div className="nurse-profile-header">
        <button onClick={() => navigate(-1)}><MdArrowBack /> Back</button>
        <h1>{nurse.user_fname} {nurse.user_lname}</h1>
        <button onClick={() => setShowEditOverlay(true)}>Edit Profile</button>
      </div>

      {/* Profile */}
      <div className="nurse-profile-container">
        <div className="profile-left">
          <img
            src={nurse.user_profilePic || "/images/user-placeholder.png"}
            alt={nurse.user_fname}
            className="profile-picture-large"
          />
        </div>

        <div className="nurse-details">
          <p className="detail-item">
            <FaUser className="icon" />
            <strong>Full Name: </strong> &nbsp; {nurse.user_fname} {nurse.user_lname}
          </p>
          <p className="detail-item">
            <MdCake className="icon" />
            <strong>Birth Date: </strong> &nbsp;{formatDateInput(nurse.user_bday)}
          </p>
          <p className="detail-item">
            <FaPhone className="icon" />
            <strong>Contact Number (+63): </strong> &nbsp; {nurse.user_contactNum || "N/A"}
          </p>
          <p className="detail-item">
            <FaEnvelope className="icon" />
            <strong>Email: </strong> &nbsp; {nurse.user_email}
          </p>
        </div>
      </div>

      {/* Edit Overlay */}
      {showEditOverlay && (
        <div className="overlay">
          <div className="overlay-content">
            <span className="overlay-close" onClick={() => setShowEditOverlay(false)}>✕</span>
            <h2>Edit Nurse Profile</h2>

            <div className="image-upload-box" onClick={() => document.getElementById("fileInput").click()}>
              {previewImage ? (
                <img src={previewImage} alt="Preview" className="preview-img" />
              ) : (
                <div className="placeholder-box">
                  <span>+ Upload Photo</span>
                </div>
              )}
              <input type="file" id="fileInput" accept="image/*" style={{ display: "none" }} onChange={handleImageChange} />
            </div>

            {["user_fname","user_lname","user_email","user_bday","user_contactNum"].map(field => (
              <div className="form-group" key={field}>
                <label>{labelMap[field]}</label>
                <input
                  type={field === "user_bday" ? "date" : "text"}
                  name={field}
                  value={field === "user_bday" ? formatDateInput(formData[field]) : formData[field] || ""}
                  onChange={handleChange}
                />
              </div>
            ))}

            <div className="overlay-buttons">
              <button onClick={() => setShowConfirm(true)}>Save Changes</button>
              <button onClick={() => setShowEditOverlay(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation */}
      {showConfirm && (
        <div className="overlay">
          <div className="overlay-content">
            <h3>Are you sure you want to save changes?</h3>
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
