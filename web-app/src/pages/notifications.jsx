// src/pages/notifications.jsx
import React from "react";
import "./elderly_profile.css";

export default function Notifications() {
  const notifications = [
    {
      img: "public/images/house1.jng",
      name: "Juan Dela Cruz",
      status: "Deceased",
      dateOfDeath: "2025-05-10",
      cause: "Heart Attack",
    },
    /*{
      img: "/images/elderly2.png",
      name: "Maria Santos",
      status: "Deceased",
      dateOfDeath: "2025-06-12",
      cause: "Natural Causes",
    },*/
  ];

  return (
    <div className="notifications-list">
      {notifications.map((notif, idx) => (
        <div className="notification-card" key={idx}>
          <img src={notif.img} alt={notif.name} className="notif-img" />
          <div className="notif-details">
            <h3>{notif.name}</h3>
            <p>Status: {notif.status}</p>
            <p>Date of Death: {notif.dateOfDeath}</p>
            <p>Cause of Death: {notif.cause}</p>
          </div>
          <div className="notif-actions">
            <button className="confirm-btn">Confirm Update</button>
            <button className="reject-btn">Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}
