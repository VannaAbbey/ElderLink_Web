import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  onSnapshot,
  updateDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";
import { processApprovedLeave } from "../services/absenceService";
import "./elderlyManagement.css";
import "../css/notifications.css";

export default function Notifications({ isOpen, onClose, isModal = false }) {
  const [notifications, setNotifications] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [userRegistrations, setUserRegistrations] = useState([]);
  const [singleNotif, setSingleNotif] = useState(null);
  const [activeTab, setActiveTab] = useState("elderly"); // "elderly", "leave", or "users"
  const [customAlert, setCustomAlert] = useState({ show: false, message: "", type: "" });
  const [showLeaveConfirmModal, setShowLeaveConfirmModal] = useState(false);
  const [pendingLeaveRequest, setPendingLeaveRequest] = useState(null);
  const [isProcessingLeave, setIsProcessingLeave] = useState(false);
  const [tabOrder, setTabOrder] = useState(["elderly", "leave", "users"]); // Dynamic tab ordering
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

      // ✅ Fetch user registrations (last 7 days for modal, all for page)
      // Simplified query to avoid composite index requirement
      const userRegistrationsQuery = query(
        collection(db, "users"),
        where("user_type", "in", ["caregiver", "nurse"])
      );
        
      const unsubscribeUserRegistrations = onSnapshot(userRegistrationsQuery, (snapshot) => {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const data = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((user) => {
            if (isModal) {
              // For modal, show only last 7 days
              if (!user.createdAt) return false;
              const userCreatedAt = user.createdAt.toDate ? user.createdAt.toDate() : new Date(user.createdAt);
              return userCreatedAt >= sevenDaysAgo;
            }
            return true; // For full page, show all users
          });
        
        setUserRegistrations(data);
      });

      return () => {
        unsubscribeNotifications();
        unsubscribeLeaveRequests();
        unsubscribeUserRegistrations();
      };
    }
  }, [notifId, isModal, isOpen]);

  // ✅ Function to get the most recent timestamp from each notification category
  const getMostRecentTimestamp = (categoryData, timestampField) => {
    if (!categoryData || categoryData.length === 0) return null;
    
    let mostRecent = null;
    
    categoryData.forEach(item => {
      let timestamp = null;
      
      if (timestampField && item[timestampField]) {
        try {
          // Handle Firestore timestamp or JavaScript Date
          timestamp = item[timestampField].toDate ? item[timestampField].toDate() : new Date(item[timestampField]);
          
          // Validate that we have a valid date
          if (isNaN(timestamp.getTime())) {
            timestamp = null;
          }
        } catch (error) {
          console.warn(`Failed to parse timestamp for ${timestampField}:`, error);
          timestamp = null;
        }
      }
      
      if (timestamp && (!mostRecent || timestamp > mostRecent)) {
        mostRecent = timestamp;
      }
    });
    
    return mostRecent;
  };

  // ✅ Determine tab order based on most recent notifications
  useEffect(() => {
    if (isModal) {
      // Get most recent timestamp from each category
      const elderlyRecent = getMostRecentTimestamp(notifications, 'updated_at'); // Elderly notifications use updated_at
      const leaveRecent = getMostRecentTimestamp(leaveRequests, 'submitted_at'); // Leave requests use submitted_at  
      const usersRecent = getMostRecentTimestamp(userRegistrations, 'createdAt'); // User registrations use createdAt

      // Create array of categories with their most recent timestamps
      const categoriesWithTimestamps = [
        { type: 'elderly', timestamp: elderlyRecent, count: notifications.length },
        { type: 'leave', timestamp: leaveRecent, count: leaveRequests.filter(req => req.status === "pending").length },
        { type: 'users', timestamp: usersRecent, count: userRegistrations.length }
      ];

      // Filter out categories with no notifications and sort by timestamp (most recent first)
      const sortedCategories = categoriesWithTimestamps
        .filter(cat => cat.timestamp !== null && cat.count > 0) // Only include categories with notifications
        .sort((a, b) => b.timestamp - a.timestamp) // Sort by most recent first
        .map(cat => cat.type);

      // Add categories with no notifications at the end in original order
      const categoriesWithoutNotifications = categoriesWithTimestamps
        .filter(cat => cat.timestamp === null || cat.count === 0)
        .map(cat => cat.type);

      const newTabOrder = [...sortedCategories, ...categoriesWithoutNotifications];

      // Only update if order actually changed to avoid unnecessary re-renders
      if (JSON.stringify(newTabOrder) !== JSON.stringify(tabOrder)) {
        setTabOrder(newTabOrder);
        
        // Set active tab to the first tab with notifications
        if (sortedCategories.length > 0 && !sortedCategories.includes(activeTab)) {
          setActiveTab(sortedCategories[0]);
        }
      }
    }
  }, [notifications, leaveRequests, userRegistrations, isModal, activeTab, tabOrder]);

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
      if (reason === null) return; // User cancelled, don't proceed
      
      await updateDoc(doc(db, "notifications", id), {
        action_status: "rejected",
        reason_for_rejection: reason || "No reason provided",
      });
      showCustomAlert("Elderly notification rejected.", "info");
    } catch (error) {
      console.error("Error rejecting notification:", error);
      showCustomAlert("Failed to reject notification.", "error");
    }
  };

  // ✅ Approve Leave Request - show confirmation modal
  const handleApproveLeave = async (id) => {
    try {
      // Find the leave request details
      const leaveRequest = leaveRequests.find(leave => leave.id === id);
      if (!leaveRequest) {
        showCustomAlert("Leave request not found.", "error");
        return;
      }

      // Set pending leave request and show confirmation modal
      setPendingLeaveRequest({
        ...leaveRequest,
        user_id: leaveRequest.caregiver_id || leaveRequest.user_id,
        user_type: "caregiver", // Default to caregiver, can be enhanced later
        start_date: leaveRequest.start_date?.toDate ? leaveRequest.start_date.toDate().toISOString().slice(0, 10) : leaveRequest.start_date,
        end_date: leaveRequest.end_date?.toDate ? leaveRequest.end_date.toDate().toISOString().slice(0, 10) : leaveRequest.end_date
      });
      setShowLeaveConfirmModal(true);
    } catch (error) {
      console.error("Error preparing leave approval:", error);
      showCustomAlert("Failed to prepare leave approval.", "error");
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

  // Handle confirmed leave approval and processing
  const confirmLeaveApproval = async () => {
    if (!pendingLeaveRequest) return;

    setIsProcessingLeave(true);
    try {
      // First, update the leave request status in database
      await updateDoc(doc(db, "leave_requests", pendingLeaveRequest.id), {
        status: "approved",
        reviewed_at: new Date(),
        reviewed_by: "admin",
        reviewer_comments: "Approved by admin - automatically processed",
        updated_at: new Date()
      });

      // Load current assignments, elderly assignments, and temp reassignments for processing
      const [assignmentsSnap, elderlyAssignmentsSnap, tempReassignmentsSnap] = await Promise.all([
        getDocs(collection(db, "house_shift_assignments")),
        getDocs(collection(db, "elderly_assignments")),
        getDocs(collection(db, "temporary_assignments"))
      ]);

      const assignments = assignmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const elderlyAssigns = elderlyAssignmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const tempReassigns = tempReassignmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Process the leave using the absence service
      await processApprovedLeave(pendingLeaveRequest, assignments, elderlyAssigns, tempReassigns);

      showCustomAlert("Leave request approved and processed successfully! Schedule has been updated.", "success");
      setShowLeaveConfirmModal(false);
      setPendingLeaveRequest(null);
      
    } catch (error) {
      console.error("Error processing leave approval:", error);
      showCustomAlert("Leave was approved but there was an error processing the schedule changes. Please check the schedule manually.", "error");
    } finally {
      setIsProcessingLeave(false);
    }
  };

  // Cancel leave approval
  const cancelLeaveApproval = () => {
    setShowLeaveConfirmModal(false);
    setPendingLeaveRequest(null);
    setIsProcessingLeave(false);
  };

  // // ✅ UI Rendering for Elderly Notifications
  // const renderNotificationCard = (notif) => (
  //   <div className="notification-card" key={notif.id}>
  //     <img
  //       src={notif.elderly_profilePic || "https://via.placeholder.com/100"}
  //       alt={notif.elderly_name}
  //       className="notif-img"
  //     />
  //     <div className="notif-details">
  //       <h3>{notif.elderly_name}</h3>
  //       <p><strong>Status:</strong> {notif.elderly_status}</p>
  //       {notif.elderly_status === "Deceased" && (
  //         <>
  //           <p>
  //             <strong>Date of Death:</strong>{" "}
  //             {notif.elderly_deathDate && notif.elderly_deathDate.toDate
  //               ? notif.elderly_deathDate.toDate().toLocaleDateString()
  //               : "Not provided"}
  //           </p>
  //           <p>
  //             <strong>Cause of Death:</strong>{" "}
  //             {notif.elderly_causeDeath || "Not provided"}
  //           </p>
  //         </>
  //       )}
  //       <p><strong>Updated By:</strong> {notif.updated_by}</p>
  //       <p><strong>House:</strong> {notif.house_name}</p>
  //       <p><strong>Status:</strong> {notif.action_status}</p>
  //     </div>
  //     <div className="notif-actions">
  //       {notif.action_status === "pending" && (
  //         <>
  //           <button className="confirm-btn" onClick={() => handleApprove(notif.id)}>
  //             Approve
  //           </button>
  //           <button className="reject-btn" onClick={() => handleReject(notif.id)}>
  //             Reject
  //           </button>
  //         </>
  //       )}
  //       {notif.action_status === "approved" && (
  //         <p className="approved-text">✅ Approved</p>
  //       )}
  //       {notif.action_status === "rejected" && (
  //         <p className="rejected-text">
  //           ❌ Rejected: {notif.reason_for_rejection}
  //         </p>
  //       )}
  //     </div>
  //     {notifId && (
  //       <button
  //         className="back-btn"
  //         onClick={() => navigate("/notifications")}
  //         style={{ marginTop: "10px", background: "#ccc", padding: "8px" }}
  //       >
  //         ← Back to All Notifications
  //       </button>
  //     )}
  //   </div>
  // );

  // // ✅ UI Rendering for Leave Requests
  // const renderLeaveRequestCard = (leave) => (
  //   <div className="notification-card leave-request-card" key={leave.id}>
  //     <div className="leave-icon">
  //       <span style={{ fontSize: "48px" }}>🏖️</span>
  //     </div>
  //     <div className="notif-details">
  //       <h3>{leave.full_name}</h3>
  //       <p><strong>Leave Type:</strong> {leave.leave_type}</p>
  //       <p><strong>Duration:</strong> {leave.duration_days} day{leave.duration_days > 1 ? 's' : ''}</p>
  //       <p>
  //         <strong>Period:</strong>{" "}
  //         {leave.start_date && leave.start_date.toDate
  //           ? leave.start_date.toDate().toLocaleDateString()
  //           : "Not provided"}{" "}
  //         to{" "}
  //         {leave.end_date && leave.end_date.toDate
  //           ? leave.end_date.toDate().toLocaleDateString()
  //           : "Not provided"}
  //       </p>
  //       <p><strong>Reason:</strong> {leave.reason}</p>
  //       <p><strong>Contact:</strong> {leave.contact_info}</p>
  //       <p><strong>Emergency Contact:</strong> {leave.emergency_contact}</p>
  //       <p><strong>Email:</strong> {leave.caregiver_email}</p>
  //       <p>
  //         <strong>Submitted:</strong>{" "}
  //         {leave.submitted_at && leave.submitted_at.toDate
  //           ? leave.submitted_at.toDate().toLocaleDateString() + " " + leave.submitted_at.toDate().toLocaleTimeString()
  //           : "Not provided"}
  //       </p>
  //       <p><strong>Status:</strong> <span className={`status-${leave.status}`}>{leave.status.toUpperCase()}</span></p>
  //       {leave.reviewer_comments && (
  //         <p><strong>Admin Comments:</strong> {leave.reviewer_comments}</p>
  //       )}
  //     </div>
  //     <div className="notif-actions">
  //       {leave.status === "pending" && (
  //         <>
  //           <button className="confirm-btn" onClick={() => handleApproveLeave(leave.id)}>
  //             Approve Leave
  //           </button>
  //           <button className="reject-btn" onClick={() => handleRejectLeave(leave.id)}>
  //             Reject Leave
  //           </button>
  //         </>
  //       )}
  //       {leave.status === "approved" && (
  //         <p className="approved-text">✅ Approved</p>
  //       )}
  //       {leave.status === "rejected" && (
  //         <p className="rejected-text">
  //           ❌ Rejected: {leave.reviewer_comments}
  //         </p>
  //       )}
  //     </div>
  //   </div>
  // );

  // ✅ Helper function to get tab display info
  const getTabInfo = (tabType) => {
    switch(tabType) {
      case 'elderly':
        return { 
          label: 'Elderly Status', 
          count: notifications.length,
          data: notifications,
          renderCard: (notif) => (
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
          )
        };
      case 'leave':
        return {
          label: 'Leave Requests',
          count: leaveRequests.filter(req => req.status === "pending").length,
          data: leaveRequests,
          renderCard: (leave) => (
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
          )
        };
      case 'users':
        return {
          label: 'User Registrations',
          count: userRegistrations.length,
          data: userRegistrations,
          renderCard: (user) => (
            <div className="notif-modal-card user-notification" key={`user-${user.id}`}>
              <div className="user-modal-icon">
                <span style={{ fontSize: "36px" }}>👤</span>
              </div>
              <div className="notif-modal-details">
                <div className="notification-type-badge user-badge">User Registration</div>
                <h4>{user.user_fname} {user.user_lname}</h4>
                <p><strong>Type:</strong> <span className={`user-type ${user.user_type}`}>{user.user_type}</span></p>
                <p><strong>Email:</strong> {user.user_email}</p>
                <p>
                  <strong>Registered:</strong>{" "}
                  {user.createdAt ? new Date(user.createdAt.toDate()).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            </div>
          )
        };
      default:
        return { label: 'Unknown', count: 0, data: [], renderCard: () => null };
    }
  };

  // ✅ Modal View - Return modal JSX if in modal mode
  if (isModal) {
    if (!isOpen) return null;

    return (
      <div className="notif-modal-overlay" onClick={onClose}>
        <div className="notif-modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="notif-modal-header">
            <h2>All Notifications ({notifications.length + leaveRequests.length + userRegistrations.length})</h2>
            <button 
              className="notif-modal-close" 
              onClick={onClose}
            >
              ✕
            </button>
          </div>

          {/* Modal Tabs - Dynamically Ordered */}
          <div className="notification-tabs">
            {tabOrder.map(tabType => {
              const tabInfo = getTabInfo(tabType);
              return (
                <button
                  key={tabType}
                  className={`tab-btn ${activeTab === tabType ? "active" : ""}`}
                  onClick={() => setActiveTab(tabType)}
                >
                  {tabInfo.label} ({tabInfo.count})
                </button>
              );
            })}
          </div>

          {/* Modal Content - Tabbed View */}
          <div className="notif-modal-body">
            {(notifications.length === 0 && leaveRequests.length === 0 && userRegistrations.length === 0) ? (
              <p className="no-notifications">No notifications available</p>
            ) : (
              <div className="notif-modal-list">
                {(() => {
                  const activeTabInfo = getTabInfo(activeTab);
                  return activeTabInfo.data.length === 0 ? (
                    <p className="no-notifications">No {activeTabInfo.label.toLowerCase()} available</p>
                  ) : (
                    activeTabInfo.data.map(activeTabInfo.renderCard)
                  );
                })()}
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
            <button
              className={`tab-btn ${activeTab === "users" ? "active" : ""}`}
              onClick={() => setActiveTab("users")}
            >
              User Registrations ({userRegistrations.length})
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
            ) : activeTab === "leave" ? (
              leaveRequests.length === 0 ? (
                <p>No leave requests available</p>
              ) : (
                leaveRequests.map(renderLeaveRequestCard)
              )
            ) : activeTab === "users" ? (
              userRegistrations.length === 0 ? (
                <p>No user registrations available</p>
              ) : (
                userRegistrations.map((user) => (
                  <div className="notification-card user-registration-card" key={user.id}>
                    <div className="user-icon">
                      <span style={{ fontSize: "48px" }}>👤</span>
                    </div>
                    <div className="notif-details">
                      <h3>{user.user_fname} {user.user_lname}</h3>
                      <p><strong>User Type:</strong> <span className={`user-type ${user.user_type}`}>{user.user_type}</span></p>
                      <p><strong>Email:</strong> {user.user_email}</p>
                      <p>
                        <strong>Registered:</strong>{" "}
                        {user.createdAt ? new Date(user.createdAt.toDate()).toLocaleDateString() : 'N/A'}
                      </p>
                    </div>
                  </div>
                ))
              )
            ) : null}
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

      {/* Leave Confirmation Modal */}
      {showLeaveConfirmModal && pendingLeaveRequest && (
        <div className="leave-confirmation-modal" onClick={cancelLeaveApproval}>
          <div className="leave-confirmation-content" onClick={(e) => e.stopPropagation()}>
            <div className="leave-confirmation-header">
              <h3>
                🏖️ Confirm Leave Approval
              </h3>
            </div>

            <div className="leave-confirmation-body">
              <div className="leave-details-grid">
                <div className="leave-detail-item">
                  <span className="leave-detail-label">Employee:</span>
                  <span className="leave-detail-value">{pendingLeaveRequest.full_name}</span>
                </div>

                <div className="leave-detail-item">
                  <span className="leave-detail-label">Leave Type:</span>
                  <span className="leave-detail-value">{pendingLeaveRequest.leave_type}</span>
                </div>

                <div className="leave-detail-item">
                  <span className="leave-detail-label">Duration:</span>
                  <span className="leave-duration-highlight">
                    {pendingLeaveRequest.duration_days} day{pendingLeaveRequest.duration_days > 1 ? 's' : ''}
                  </span>
                </div>

                <div className="leave-detail-item">
                  <span className="leave-detail-label">Period:</span>
                  <span className="leave-detail-value">
                    {new Date(pendingLeaveRequest.start_date).toLocaleDateString()} - 
                    {new Date(pendingLeaveRequest.end_date).toLocaleDateString()}
                  </span>
                </div>

                <div className="leave-detail-item">
                  <span className="leave-detail-label">Reason:</span>
                  <span className="leave-detail-value">{pendingLeaveRequest.reason}</span>
                </div>

                <div className="leave-detail-item">
                  <span className="leave-detail-label">Contact Info:</span>
                  <span className="leave-detail-value">{pendingLeaveRequest.contact_info}</span>
                </div>
              </div>

              <div className="leave-warning-box">
                <p className="leave-warning-text">
                  ⚠️ This will automatically mark the employee as "On Leave" for all scheduled days in this period and redistribute their elderly assignments to available caregivers.
                </p>
              </div>
            </div>

            <div className="leave-confirmation-actions">
              <button 
                className="leave-cancel-btn" 
                onClick={cancelLeaveApproval}
                disabled={isProcessingLeave}
              >
                Cancel
              </button>
              <button 
                className="leave-confirm-btn" 
                onClick={confirmLeaveApproval}
                disabled={isProcessingLeave}
              >
                {isProcessingLeave ? (
                  <div className="leave-processing">
                    <div className="leave-processing-spinner"></div>
                    Processing...
                  </div>
                ) : (
                  'Approve & Process Leave'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
