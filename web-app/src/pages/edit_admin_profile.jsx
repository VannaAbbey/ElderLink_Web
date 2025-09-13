// src/pages/edit_admin_profile.jsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MdArrowBack, MdCake } from "react-icons/md";
import { FaUser, FaPhone, FaEnvelope } from "react-icons/fa";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db, auth } from "../firebase";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import "./edit_admin_profile.css";

export default function EditAdminProfile() {
  const navigate = useNavigate();
  const [admin, setAdmin] = useState(null);
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

  // Fetch currently logged-in admin profile with onAuthStateChanged
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        setAdmin(null);
        setLoading(false);
        return;
      }

      try {
        const adminRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(adminRef);

        if (docSnap.exists()) {
          setAdmin({ id: docSnap.id, ...docSnap.data() });
          setFormData({ ...docSnap.data() });
          setPreviewImage(docSnap.data().user_profilePic || "");
        } else {
          setAdmin(null);
        }
      } catch (err) {
        console.error("Error fetching admin profile:", err);
        setAdmin(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe(); // Clean up listener
  }, []);

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
        const storageRef = ref(storage, `adminPics/${Date.now()}_${selectedImage.name}`);
        await uploadBytes(storageRef, selectedImage);
        uploadedImageUrl = await getDownloadURL(storageRef);
      }

      const adminRef = doc(db, "users", admin.id);

      let birthdayValue = formData.user_bday;
      if (typeof birthdayValue === "string") birthdayValue = new Date(birthdayValue);

      await updateDoc(adminRef, {
        user_fname: formData.user_fname,
        user_lname: formData.user_lname,
        user_email: formData.user_email,
        user_bday: birthdayValue,
        user_contactNum: formData.user_contactNum,
        user_profilePic: uploadedImageUrl,
      });

      setAdmin((prev) => ({ ...prev, ...formData, user_profilePic: uploadedImageUrl }));
      setShowEditOverlay(false);
      setSelectedImage(null);
    } catch (err) {
      console.error("Update failed:", err);
    }
  };

  if (loading) return <p>Loading...</p>;
  if (!admin) return <p>Admin profile not found.</p>;

  return (
    <>
      {/* Header */}
      <div className="admin-profile-header">
        <button onClick={() => navigate(-1)}><MdArrowBack /> Back</button>
        <h1> Supervisor {admin.user_fname} {admin.user_lname}</h1>
        <button onClick={() => setShowEditOverlay(true)}>Edit Profile</button>
      </div>

      {/* Profile */}
      <div className="admin-profile-container">
        <div className="profile-left">
          <img
            src={admin.user_profilePic || "/images/user-placeholder.png"}
            alt={admin.user_fname}
            className="profile-picture-large"
          />
        </div>

        <div className="admin-details">
          <p className="detail-item">
            <FaUser className="icon" />
            <strong>Full Name:  </strong>&nbsp; {admin.user_fname} {admin.user_lname}
          </p>
          <p className="detail-item">
            <MdCake className="icon" />
            <strong>Birth Date:  </strong>&nbsp; {formatDateInput(admin.user_bday)}
          </p>
          <p className="detail-item">
            <FaPhone className="icon" />
            <strong>Contact Number (+63):  </strong>&nbsp; {admin.user_contactNum || "N/A"}
          </p>
          <p className="detail-item">
            <FaEnvelope className="icon" />
            <strong>Email:  </strong>&nbsp; {admin.user_email}
          </p>
        </div>
      </div>

      {/* Edit Overlay */}
      {showEditOverlay && (
        <div className="overlay">
          <div className="overlay-content">
            <span className="overlay-close" onClick={() => setShowEditOverlay(false)}>✖</span>
            <h2>Edit Supervisor Profile</h2>

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
