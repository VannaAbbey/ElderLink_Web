import React, { useState, useEffect } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db } from "../firebase";
import "./profileNurse.css";

export default function EditNurseOverlay({ nurseId, onClose, onUpdate }) {
  const [formData, setFormData] = useState({
    user_fname: "",
    user_lname: "",
    user_email: "",
    user_bday: "",
    user_contactNum: "",
    user_type: "nurse", // default
    user_activationStatus: true,
    user_profilePic: "",
  });
  const [selectedImage, setSelectedImage] = useState(null);
  const [previewImage, setPreviewImage] = useState("");
  const storage = getStorage();

  useEffect(() => {
    if (!nurseId) return;
    const fetchData = async () => {
      const docRef = doc(db, "users", nurseId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        setFormData({
          ...data,
          user_bday: data.user_bday?.toDate
            ? data.user_bday.toDate().toISOString().split("T")[0]
            : data.user_bday || "",
        });
        setPreviewImage(data.user_profilePic || "");
      }
    };
    fetchData();
  }, [nurseId]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleImageChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedImage(file);
      setPreviewImage(URL.createObjectURL(file));
    }
  };

  const handleSave = async () => {
    try {
      let uploadedImageUrl = formData.user_profilePic || "";

      if (selectedImage) {
        const storageRef = ref(storage, `nursePics/${Date.now()}_${selectedImage.name}`);
        await uploadBytes(storageRef, selectedImage);
        uploadedImageUrl = await getDownloadURL(storageRef);
      }

      const docRef = doc(db, "users", nurseId);
      await updateDoc(docRef, {
        ...formData,
        user_bday: formData.user_bday ? new Date(formData.user_bday) : null,
        user_profilePic: uploadedImageUrl,
      });

      onUpdate(); // refresh list
      onClose(); // close modal
    } catch (err) {
      console.error("Error updating nurse:", err);
    }
  };

  return (
    <div className="overlay">
      <div className="overlay-content">
        <span className="overlay-close" onClick={onClose}>✖</span>
        <h2 className="overlay-header">Edit Nurse Profile</h2>

        {/* Image Upload */}
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

       {/* Form Fields */}
       {/* First Name */}
<div className="form-group">
  <label>First Name</label>
  <input
    type="text"
    name="user_fname"
    value={formData.user_fname || ""}
    onChange={handleChange}
  />
</div>

{/* Last Name */}
<div className="form-group">
  <label>Last Name</label>
  <input
    type="text"
    name="user_lname"
    value={formData.user_lname || ""}
    onChange={handleChange}
  />
</div>

{/* Email */}
<div className="form-group">
  <label>Email</label>
  <input
    type="text"
    name="user_email"
    value={formData.user_email || ""}
    onChange={handleChange}
  />
</div>

{/* Birthday */}
<div className="form-group">
  <label>Birth Date</label>
  <input
    type="date"
    name="user_bday"
    value={formData.user_bday || ""}
    onChange={handleChange}
  />
</div>

{/* Contact Number */}
<div className="form-group">
  <label>Contact Number</label>
  <input
    type="text"
    name="user_contactNum"
    value={formData.user_contactNum || ""}
    onChange={handleChange}
  />
</div>

        <div className="overlay-buttons">
          <button className="save-btn" onClick={handleSave}>Save</button>
          <button className="cancel-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
