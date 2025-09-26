import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  onSnapshot,
  updateDoc,
  doc,
  getDoc
} from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";
import "./elderlyManagement.css";

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [singleNotif, setSingleNotif] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  // ✅ Extract ID from URL
  const searchParams = new URLSearchParams(location.search);
  const notifId = searchParams.get("id");

  useEffect(() => {
    if (notifId) {
      // ✅ Fetch specific notification
      const fetchNotification = async () => {
        const notifRef = doc(db, "notifications", notifId);
        const notifSnap = await getDoc(notifRef);
        if (notifSnap.exists()) {
          setSingleNotif({ id: notifSnap.id, ...notifSnap.data() });
        }
      };
      fetchNotification();
    } else {
      // ✅ Fetch all notifications (real-time)
      const unsubscribe = onSnapshot(collection(db, "notifications"), (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setNotifications(data);
      });

      return () => unsubscribe();
    }
  }, [notifId]);

  // ✅ Approve Notification
  const handleApprove = async (id) => {
    try {
      const notifRef = doc(db, "notifications", id);
      const notifSnap = await getDoc(notifRef);

      if (notifSnap.exists()) {
        const notifData = notifSnap.data();

        const elderlyRef = doc(db, "elderly", notifData.elderly_id);
        await updateDoc(elderlyRef, {
          elderly_status: notifData.elderly_status,
          elderly_deathDate:
            notifData.elderly_status === "Deceased" && notifData.elderly_deathDate
              ? notifData.elderly_deathDate
              : null,
          elderly_cause: notifData.elderly_causeDeath || "",
        });

        await updateDoc(notifRef, { action_status: "approved" });
        alert("Elderly profile updated successfully!");
      }
    } catch (error) {
      console.error("Error approving notification:", error);
    }
  };

  // ✅ Reject Notification
  const handleReject = async (id) => {
    try {
      const reason = prompt("Enter reason for rejection:");
      await updateDoc(doc(db, "notifications", id), {
        action_status: "rejected",
        reason_for_rejection: reason || "No reason provided",
      });
    } catch (error) {
      console.error("Error rejecting notification:", error);
    }
  };

  // ✅ UI Rendering
  const renderNotificationCard = (notif) => (
    <div className="notification-card" key={notif.id}>
      <img
        src={notif.elderly_profilePic || "https://via.placeholder.com/100"}
        alt={notif.elderly_name}
        className="notif-img"
      />
      <div className="notif-details">
        <h3>{notif.elderly_name}</h3>
        <p><strong>Status:</strong> {notif.elderly_status}</p>
        {notif.elderly_status === "Deceased" && (
          <>
            <p>
              <strong>Date of Death:</strong>{" "}
              {notif.elderly_deathDate && notif.elderly_deathDate.toDate
                ? notif.elderly_deathDate.toDate().toLocaleDateString()
                : "Not provided"}
            </p>
            <p>
              <strong>Cause of Death:</strong>{" "}
              {notif.elderly_causeDeath || "Not provided"}
            </p>
          </>
        )}
        <p><strong>Updated By:</strong> {notif.updated_by}</p>
        <p><strong>House:</strong> {notif.house_name}</p>
        <p><strong>Status:</strong> {notif.action_status}</p>
      </div>
      <div className="notif-actions">
        {notif.action_status === "pending" && (
          <>
            <button className="confirm-btn" onClick={() => handleApprove(notif.id)}>
              Approve
            </button>
            <button className="reject-btn" onClick={() => handleReject(notif.id)}>
              Reject
            </button>
          </>
        )}
        {notif.action_status === "approved" && (
          <p className="approved-text">✅ Approved</p>
        )}
        {notif.action_status === "rejected" && (
          <p className="rejected-text">
            ❌ Rejected: {notif.reason_for_rejection}
          </p>
        )}
      </div>
      {notifId && (
        <button
          className="back-btn"
          onClick={() => navigate("/notifications")}
          style={{ marginTop: "10px", background: "#ccc", padding: "8px" }}
        >
          ← Back to All Notifications
        </button>
      )}
    </div>
  );

  return (
    <div className="notifications-list">
      {notifId ? (
        singleNotif ? (
          renderNotificationCard(singleNotif)
        ) : (
          <p>Loading notification...</p>
        )
      ) : notifications.length === 0 ? (
        <p>No notifications available</p>
      ) : (
        notifications.map(renderNotificationCard)
      )}
    </div>
  );
}
