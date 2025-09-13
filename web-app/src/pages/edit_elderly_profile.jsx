// src/components/EditElderlyOverlay.jsx
import React, { useState, useEffect } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db } from "../firebase";
import "./profileElderly.css";

export default function EditElderlyOverlay({ elderId, onClose, onUpdate }) {
  const [formData, setFormData] = useState({
    elderly_fname: "",
    elderly_lname: "",
    elderly_bday: "",
    elderly_age: "",
    elderly_sex: "Male",
    elderly_mobilityStatus: "Independent",
    elderly_dietNotes: "",
    elderly_condition: "",
  });
  const [selectedImage, setSelectedImage] = useState(null);
  const [previewImage, setPreviewImage] = useState("");
  const storage = getStorage();

  useEffect(() => {
    if (!elderId) return;
    const fetchData = async () => {
      const docRef = doc(db, "elderly", elderId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        setFormData(data);
        setPreviewImage(data.elderly_profilePic || "");
      }
    };
    fetchData();
  }, [elderId]);

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

  const handleSave = async () => {
    try {
      let uploadedImageUrl = formData.elderly_profilePic || "";

      if (selectedImage) {
        const storageRef = ref(storage, `elderlyPics/${Date.now()}_${selectedImage.name}`);
        await uploadBytes(storageRef, selectedImage);
        uploadedImageUrl = await getDownloadURL(storageRef);
      }

      const docRef = doc(db, "elderly", elderId);
      await updateDoc(docRef, { ...formData, elderly_profilePic: uploadedImageUrl });

      onUpdate(); // refresh list
      onClose(); // close modal
    } catch (err) {
      console.error("Error updating elderly:", err);
    }
  };

  return (
    <div className="overlay">
      <div className="overlay-content">
        <span className="overlay-close" onClick={onClose}>✖</span>
        <h2 className="overlay-header">Edit Elderly Profile</h2>

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
        {["elderly_fname", "elderly_lname", "elderly_bday", "elderly_age", "elderly_dietNotes", "elderly_condition"].map((field) => (
          <div className="form-group" key={field}>
            <label>{field.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}</label>
            <input
              type={field === "elderly_age" ? "number" : field === "elderly_bday" ? "date" : "text"}
              name={field}
              value={field === "elderly_bday" && formData[field]?.toDate ? formData[field].toDate().toISOString().split("T")[0] : formData[field] || ""}
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
            <option>Needs Assistance</option>
            <option>Bedridden</option>
          </select>
        </div>

        <div className="overlay-buttons">
          <button className="save-btn" onClick={handleSave}>Save</button>
          <button className="cancel-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
