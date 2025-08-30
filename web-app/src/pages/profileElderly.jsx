import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MdArrowBack } from "react-icons/md";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import "./elderlyManagement.css";

export default function Profile_Elderly() {
  const { id } = useParams(); // elderly_id from URL
  const navigate = useNavigate();
  const [elder, setElder] = useState(null);
  const [loading, setLoading] = useState(true);

  const [showEditOverlay, setShowEditOverlay] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [formData, setFormData] = useState({});
  const [selectedImage, setSelectedImage] = useState(null);
  const [previewImage, setPreviewImage] = useState("");

  const storage = getStorage();

  // Map field names to proper labels
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

  useEffect(() => {
    const fetchElder = async () => {
      try {
        const q = query(collection(db, "elderly"), where("elderly_id", "==", id));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const docData = querySnapshot.docs[0];
          setElder({ id: docData.id, ...docData.data() });
          setFormData({
            ...docData.data(),
            elderly_bday: docData.data().elderly_bday,
            elderly_deathDate: docData.data().elderly_deathDate,
          });
          setPreviewImage(docData.data().elderly_profilePic || "");
        }
        setLoading(false);
      } catch (err) {
        console.error(err);
        setLoading(false);
      }
    };
    fetchElder();
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
        const storageRef = ref(
          storage,
          `elderlyPics/${Date.now()}_${selectedImage.name}`
        );
        await uploadBytes(storageRef, selectedImage);
        uploadedImageUrl = await getDownloadURL(storageRef);
      }

      const elderRef = doc(db, "elderly", elder.id);

      let birthdayValue = formData.elderly_bday;
      if (typeof birthdayValue === "string") birthdayValue = new Date(birthdayValue);

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
    <div className="elderly-profile-container">
      <div className="elderly-profile-header">
        <button onClick={() => navigate(-1)}>
          <MdArrowBack /> Back
        </button>
        <h1>
           {elder.elderly_sex === "Female" ? "Lola" : "Lolo"} {elder.elderly_fname}
        </h1>
        {/* Edit button visible for all users */}
        <button style={{ marginLeft: "20px" }} onClick={() => setShowEditOverlay(true)}>
          Edit Profile
        </button>
      </div>

      <img
        src={elder.elderly_profilePic || "/images/house1.png"}
        alt={elder.elderly_fname}
        className="profile-picture-large"
      />

      <div className="elderly-details">
        <p>
          <strong>Full Name:</strong> {elder.elderly_fname} {elder.elderly_lname}
        </p>
        <p>
          <strong>Age:</strong> {elder.elderly_age}
        </p>
        <p>
          <strong>Birth Date:</strong> {formatTimestamp(elder.elderly_bday)}
        </p>
        <p>
          <strong>Sex:</strong> {elder.elderly_sex}
        </p>
        <p>
          <strong>Mobility Status:</strong> {elder.elderly_mobilityStatus}
        </p>
        <p>
          <strong>Dietary Notes:</strong> {elder.elderly_dietNotes || "N/A"}
        </p>
        <p>
          <strong>Health Condition:</strong> {elder.elderly_condition || "N/A"}
        </p>
        <p>
          <strong>Status:</strong> {elder.elderly_status}
        </p>
        {elder.elderly_status === "Deceased" && (
          <>
            <p>
              <strong>Cause of Death:</strong> {elder.elderly_cause || "N/A"}
            </p>
            <p>
              <strong>Date of Death:</strong> {formatTimestamp(elder.elderly_deathDate)}
            </p>
          </>
        )}
        <p>
          <strong>House:</strong> {elder.house_id}
        </p>
      </div>

      {/* Edit Overlay */}
      {showEditOverlay && (
        <div className="overlay">
          <div className="overlay-content">
            <span className="overlay-close" onClick={() => setShowEditOverlay(false)}>
              ✕
            </span>
            <h2 class="overlay-header">Edit Elderly Profile</h2>

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

            {/* Form Fields with proper labels */}
            {[
              "elderly_fname",
              "elderly_lname",
              "elderly_bday",
              "elderly_age",
              "elderly_dietNotes",
              "elderly_condition",
            ].map((field) => (
              <div className="form-group" key={field}>
                <label>{labelMap[field]}</label>
                <input
                  type={
                    field === "elderly_age"
                      ? "number"
                      : field === "elderly_bday"
                      ? "date"
                      : "text"
                  }
                  name={field}
                  value={
                    field === "elderly_bday"
                      ? formatDateInput(formData[field])
                      : formData[field] || ""
                  }
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
                value={formData.elderly_mobilityStatus}
                onChange={handleChange}
              >
                <option>Independent</option>
                <option>Assisted</option>
                <option>Wheelchair-bound</option>
                <option>Bedridden</option>
                <option>Needs Supervision</option>
              </select>
            </div>

            <div className="overlay-buttons">
              <button onClick={() => setShowConfirm(true)}>Save Changes</button>
              <button onClick={() => setShowEditOverlay(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="overlay">
          <div className="overlay-content">
            <h3>Are you really sure you want to modify this profile?</h3>
            <div className="overlay-buttons">
              <button
                onClick={() => {
                  handleUpdate();
                  setShowConfirm(false);
                }}
              >
                Yes, Save
              </button>
              <button onClick={() => setShowConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
