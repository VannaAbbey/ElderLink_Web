import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  onSnapshot,
  updateDoc,
  doc,
  getDoc,
  query,
  where
} from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";
import "./elderlyManagement.css";
import "../css/notifications.css";

export default function Notifications({ isOpen, onClose, isModal = false }) {
  const [notifications, setNotifications] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [singleNotif, setSingleNotif] = useState(null);
  const [activeTab, setActiveTab] = useState("elderly"); // "elderly" or "leave"
  const [customAlert, setCustomAlert] = useState({ show: false, message: "", type: "" });
  const location = useLocation();
  const navigate = useNavigate();

  // ✅ Extract ID from URL
  const searchParams = new URLSearchParams(location.search);
  const notifId = searchParams.get("id");

  // ✅ Custom Alert Function
  const showCustomAlert = (message, type = "success") => {
    setCustomAlert({ show: true, message, type });
    setTimeout(() => {
      setCustomAlert({ show: false, message: "", type: "" });
    }, 4000); // Hide after 4 seconds
  };

  useEffect(() => {
    if (isModal && !isOpen) return; // Don't fetch data if modal is closed
    
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
      // ✅ Fetch notifications (filter for pending if modal, all if page)
      const notificationsQuery = isModal 
        ? query(collection(db, "notifications"), where("action_status", "==", "pending"))
        : collection(db, "notifications");
        
      const unsubscribeNotifications = onSnapshot(notificationsQuery, (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setNotifications(data);
      });

      // ✅ Fetch leave requests (filter for pending if modal, all if page)
      const leaveRequestsQuery = isModal
        ? query(collection(db, "leave_requests"), where("status", "==", "pending"))
        : collection(db, "leave_requests");
        
      const unsubscribeLeaveRequests = onSnapshot(leaveRequestsQuery, (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setLeaveRequests(data);
      });

      return () => {
        unsubscribeNotifications();
        unsubscribeLeaveRequests();
      };
    }
  }, [notifId, isModal, isOpen]);

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
        showCustomAlert("Elderly profile updated successfully!", "success");
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

  // ✅ Approve Leave Request
  const handleApproveLeave = async (id) => {
    try {
      const leaveRef = doc(db, "leave_requests", id);
      await updateDoc(leaveRef, {
        status: "approved",
        reviewed_at: new Date(),
        reviewed_by: "admin", // You can replace this with actual admin user
        reviewer_comments: "Approved by admin",
        updated_at: new Date()
      });
      showCustomAlert("Leave request approved successfully!", "success");
    } catch (error) {
      console.error("Error approving leave request:", error);
      showCustomAlert("Failed to approve leave request.", "error");
    }
  };

  // ✅ Reject Leave Request
  const handleRejectLeave = async (id) => {
    try {
      const reason = prompt("Enter reason for rejection:");
      if (reason === null) return; // User cancelled
      
      const leaveRef = doc(db, "leave_requests", id);
      await updateDoc(leaveRef, {
        status: "rejected",
        reviewed_at: new Date(),
        reviewed_by: "admin", // You can replace this with actual admin user
        reviewer_comments: reason || "No reason provided",
        updated_at: new Date()
      });
      showCustomAlert("Leave request rejected.", "info");
    } catch (error) {
      console.error("Error rejecting leave request:", error);
      showCustomAlert("Failed to reject leave request.", "error");
    }
  };

  // ✅ UI Rendering for Elderly Notifications
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

  // ✅ UI Rendering for Leave Requests
  const renderLeaveRequestCard = (leave) => (
    <div className="notification-card leave-request-card" key={leave.id}>
      <div className="leave-icon">
        <span style={{ fontSize: "48px" }}>🏖️</span>
      </div>
      <div className="notif-details">
        <h3>{leave.full_name}</h3>
        <p><strong>Leave Type:</strong> {leave.leave_type}</p>
        <p><strong>Duration:</strong> {leave.duration_days} day{leave.duration_days > 1 ? 's' : ''}</p>
        <p>
          <strong>Period:</strong>{" "}
          {leave.start_date && leave.start_date.toDate
            ? leave.start_date.toDate().toLocaleDateString()
            : "Not provided"}{" "}
          to{" "}
          {leave.end_date && leave.end_date.toDate
            ? leave.end_date.toDate().toLocaleDateString()
            : "Not provided"}
        </p>
        <p><strong>Reason:</strong> {leave.reason}</p>
        <p><strong>Contact:</strong> {leave.contact_info}</p>
        <p><strong>Emergency Contact:</strong> {leave.emergency_contact}</p>
        <p><strong>Email:</strong> {leave.caregiver_email}</p>
        <p>
          <strong>Submitted:</strong>{" "}
          {leave.submitted_at && leave.submitted_at.toDate
            ? leave.submitted_at.toDate().toLocaleDateString() + " " + leave.submitted_at.toDate().toLocaleTimeString()
            : "Not provided"}
        </p>
        <p><strong>Status:</strong> <span className={`status-${leave.status}`}>{leave.status.toUpperCase()}</span></p>
        {leave.reviewer_comments && (
          <p><strong>Admin Comments:</strong> {leave.reviewer_comments}</p>
        )}
      </div>
      <div className="notif-actions">
        {leave.status === "pending" && (
          <>
            <button className="confirm-btn" onClick={() => handleApproveLeave(leave.id)}>
              Approve Leave
            </button>
            <button className="reject-btn" onClick={() => handleRejectLeave(leave.id)}>
              Reject Leave
            </button>
          </>
        )}
        {leave.status === "approved" && (
          <p className="approved-text">✅ Approved</p>
        )}
        {leave.status === "rejected" && (
          <p className="rejected-text">
            ❌ Rejected: {leave.reviewer_comments}
          </p>
        )}
      </div>
    </div>
  );

  // ✅ Modal View - Return modal JSX if in modal mode
  if (isModal) {
    if (!isOpen) return null;

    return (
      <div className="notif-modal-overlay" onClick={onClose}>
        <div className="notif-modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="notif-modal-header">
            <h2>All Notifications ({notifications.length + leaveRequests.length})</h2>
            <button 
              className="notif-modal-close" 
              onClick={onClose}
            >
              ✕
            </button>
          </div>

          {/* Modal Content - Unified List */}
          <div className="notif-modal-body">
            {(notifications.length === 0 && leaveRequests.length === 0) ? (
              <p className="no-notifications">No notifications available</p>
            ) : (
              <div className="notif-modal-list">
                {/* Elderly Status Notifications */}
                {notifications.map((notif) => (
                  <div className="notif-modal-card elderly-notification" key={`elderly-${notif.id}`}>
                    <img
                      src={notif.elderly_profilePic || "https://via.placeholder.com/60"}
                      alt={notif.elderly_name}
                      className="notif-modal-img"
                    />
                    <div className="notif-modal-details">
                      <div className="notification-type-badge elderly-badge">Elderly Status</div>
                      <h4>{notif.elderly_name}</h4>
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
                      <p><strong>Status:</strong> <span className={`status-${notif.action_status}`}>{notif.action_status}</span></p>
                    </div>
                    <div className="notif-modal-actions">
                      {notif.action_status === "pending" && (
                        <>
                          <button 
                            className="approve-btn" 
                            onClick={() => handleApprove(notif.id)}
                          >
                            Approve
                          </button>
                          <button 
                            className="reject-btn" 
                            onClick={() => handleReject(notif.id)}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {notif.action_status === "approved" && (
                        <span className="status-approved">✅ Approved</span>
                      )}
                      {notif.action_status === "rejected" && (
                        <span className="status-rejected">❌ Rejected</span>
                      )}
                    </div>
                  </div>
                ))}

                {/* Leave Request Notifications */}
                {leaveRequests.map((leave) => (
                  <div className="notif-modal-card leave-notification" key={`leave-${leave.id}`}>
                    <div className="leave-modal-icon">
                      <span style={{ fontSize: "36px" }}>🏖️</span>
                    </div>
                    <div className="notif-modal-details">
                      <div className="notification-type-badge leave-badge">Leave Request</div>
                      <h4>{leave.full_name}</h4>
                      <p><strong>Leave Type:</strong> {leave.leave_type}</p>
                      <p><strong>Duration:</strong> {leave.duration_days} day{leave.duration_days > 1 ? 's' : ''}</p>
                      <p>
                        <strong>Period:</strong>{" "}
                        {leave.start_date && leave.start_date.toDate
                          ? leave.start_date.toDate().toLocaleDateString()
                          : "Not provided"}{" "}
                        to{" "}
                        {leave.end_date && leave.end_date.toDate
                          ? leave.end_date.toDate().toLocaleDateString()
                          : "Not provided"}
                      </p>
                      <p><strong>Reason:</strong> {leave.reason}</p>
                      <p><strong>Status:</strong> <span className={`status-${leave.status}`}>{leave.status.toUpperCase()}</span></p>
                    </div>
                    <div className="notif-modal-actions">
                      {leave.status === "pending" && (
                        <>
                          <button 
                            className="approve-btn" 
                            onClick={() => handleApproveLeave(leave.id)}
                          >
                            Approve
                          </button>
                          <button 
                            className="reject-btn" 
                            onClick={() => handleRejectLeave(leave.id)}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {leave.status === "approved" && (
                        <span className="status-approved">✅ Approved</span>
                      )}
                      {leave.status === "rejected" && (
                        <span className="status-rejected">❌ Rejected</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        
        {/* Custom Alert */}
        {customAlert.show && (
          <div className={`custom-alert custom-alert-${customAlert.type}`}>
            <div className="alert-content">
              <span className="alert-icon">
                {customAlert.type === "success" && "✅"}
                {customAlert.type === "error" && "❌"}
                {customAlert.type === "info" && "ℹ️"}
              </span>
              <span className="alert-message">{customAlert.message}</span>
              <button 
                className="alert-close" 
                onClick={() => setCustomAlert({ show: false, message: "", type: "" })}
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ✅ Regular Page View
  return (
    <div className="notifications-list">
      {notifId ? (
        singleNotif ? (
          renderNotificationCard(singleNotif)
        ) : (
          <p>Loading notification...</p>
        )
      ) : (
        <>
          {/* Navigation Tabs */}
          <div className="notification-tabs">
            <button
              className={`tab-btn ${activeTab === "elderly" ? "active" : ""}`}
              onClick={() => setActiveTab("elderly")}
            >
              Elderly Status ({notifications.length})
            </button>
            <button
              className={`tab-btn ${activeTab === "leave" ? "active" : ""}`}
              onClick={() => setActiveTab("leave")}
            >
              Leave Requests ({leaveRequests.filter(req => req.status === "pending").length})
            </button>
          </div>

          {/* Content based on active tab */}
          <div className="notification-content">
            {activeTab === "elderly" ? (
              notifications.length === 0 ? (
                <p>No elderly status notifications available</p>
              ) : (
                notifications.map(renderNotificationCard)
              )
            ) : (
              leaveRequests.length === 0 ? (
                <p>No leave requests available</p>
              ) : (
                leaveRequests.map(renderLeaveRequestCard)
              )
            )}
          </div>
        </>
      )}
      
      {/* Custom Alert */}
      {customAlert.show && (
        <div className={`custom-alert custom-alert-${customAlert.type}`}>
          <div className="alert-content">
            <span className="alert-icon">
              {customAlert.type === "success" && "✅"}
              {customAlert.type === "error" && "❌"}
              {customAlert.type === "info" && "ℹ️"}
            </span>
            <span className="alert-message">{customAlert.message}</span>
            <button 
              className="alert-close" 
              onClick={() => setCustomAlert({ show: false, message: "", type: "" })}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
