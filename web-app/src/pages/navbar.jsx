import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";
import { FaBell, FaBars, FaTimes } from "react-icons/fa";
import { collection, query, where, onSnapshot, updateDoc, doc, getDoc, getDocs } from "firebase/firestore";
import { processApprovedLeave } from "../services/absenceService";
import Notifications from "./notifications";
import "./navbar.css";

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [userRegistrations, setUserRegistrations] = useState([]);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768); // ✅ track screen size
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [showLeaveConfirmModal, setShowLeaveConfirmModal] = useState(false);
  const [pendingLeaveRequest, setPendingLeaveRequest] = useState(null);
  const [isProcessingLeave, setIsProcessingLeave] = useState(false);
  const dropdownRef = useRef(null);
  const notifRef = useRef(null);

  // Track screen resize
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Redirect if not authenticated
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!user) navigate("/login", { replace: true });
    });
    return () => unsubscribeAuth();
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  // Handle leave request approval (for dropdown only) - show confirmation modal
  const handleApproveLeave = async (leaveId, event) => {
    event.stopPropagation(); // Prevent dropdown from closing
    try {
      // Find the leave request details
      const leaveRequest = leaveRequests.find(leave => leave.id === leaveId);
      if (!leaveRequest) {
        alert("Leave request not found.");
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
      setNotifOpen(false); // Close notification dropdown
    } catch (error) {
      console.error("Error preparing leave approval:", error);
      alert("Failed to prepare leave approval.");
    }
  };

  // Handle leave request rejection (for dropdown only)
  const handleRejectLeave = async (leaveId, event) => {
    event.stopPropagation(); // Prevent dropdown from closing
    const reason = prompt("Enter reason for rejection:");
    if (reason === null) return; // User cancelled
    
    try {
      await updateDoc(doc(db, "leave_requests", leaveId), {
        status: "rejected",
        reviewed_at: new Date(),
        reviewed_by: "admin",
        reviewer_comments: reason || "No reason provided",
        updated_at: new Date()
      });
      alert("Leave request rejected.");
    } catch (error) {
      console.error("Error rejecting leave:", error);
      alert("Failed to reject leave request.");
    }
  };

  // Handle elderly notification approval (for dropdown only)
  const handleApproveElderly = async (notifId, event) => {
    event.stopPropagation(); // Prevent dropdown from closing
    try {
      const notifRef = doc(db, "notifications", notifId);
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
      alert("Failed to approve elderly notification.");
    }
  };

  // Handle elderly notification rejection (for dropdown only)
  const handleRejectElderly = async (notifId, event) => {
    event.stopPropagation(); // Prevent dropdown from closing
    const reason = prompt("Enter reason for rejection:");
    if (reason === null) return; // User cancelled
    
    try {
      await updateDoc(doc(db, "notifications", notifId), {
        action_status: "rejected",
        reason_for_rejection: reason || "No reason provided",
      });
      alert("Elderly notification rejected.");
    } catch (error) {
      console.error("Error rejecting elderly notification:", error);
      alert("Failed to reject elderly notification.");
    }
  };

  // Real-time notifications for elderly status
  useEffect(() => {
    const q = query(
      collection(db, "notifications"),
      where("action_status", "==", "pending")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setNotifications(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, []);

  // Real-time notifications for leave requests
  useEffect(() => {
    const q = query(
      collection(db, "leave_requests"),
      where("status", "==", "pending")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setLeaveRequests(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, []);

  // Real-time notifications for new user registrations (last 7 days)
  useEffect(() => {
    // Simplified query to avoid composite index requirement
    // We'll filter client-side instead
    const q = query(
      collection(db, "users"),
      where("user_type", "in", ["caregiver", "nurse"])
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      // Filter client-side for last 7 days
      const recentUsers = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((user) => {
          if (!user.createdAt) return false;
          const userCreatedAt = user.createdAt.toDate ? user.createdAt.toDate() : new Date(user.createdAt);
          return userCreatedAt >= sevenDaysAgo;
        });
      
      setUserRegistrations(recentUsers);
    });
    return () => unsubscribe();
  }, []);

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
      // We'll need to fetch these from the database for the absence service
      const [assignmentsSnap, elderlyAssignmentsSnap, tempReassignmentsSnap] = await Promise.all([
        getDocs(collection(db, "house_shift_assignments")),
        getDocs(collection(db, "elderly_assignments")),
        getDocs(collection(db, "temporary_assignments"))
      ]);

      const assignments = assignmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const elderlyAssigns = elderlyAssignmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const tempReassigns = tempReassignmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      console.log("🔧 NAVBAR DEBUG - About to process leave with:", {
        leaveRequest: pendingLeaveRequest,
        assignmentsCount: assignments.length,
        elderlyAssignsCount: elderlyAssigns.length,
        tempReassignsCount: tempReassigns.length
      });

      // Process the leave using the absence service
      const leaveProcessResult = await processApprovedLeave(pendingLeaveRequest, assignments, elderlyAssigns, tempReassigns);
      console.log("🎉 Leave processing completed:", leaveProcessResult);

      alert(`Leave request approved and processed successfully! ${leaveProcessResult.message || 'Schedule has been updated.'}`);
      setShowLeaveConfirmModal(false);
      setPendingLeaveRequest(null);
      
    } catch (error) {
      console.error("Error processing leave approval:", error);
      alert("Leave was approved but there was an error processing the schedule changes. Please check the schedule manually.");
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

  // ✅ Function to get unified and sorted notifications
  const getUnifiedNotifications = () => {
    const allNotifications = [];

    // Add elderly notifications with timestamp
    notifications.forEach(notif => {
      let sortTimestamp;
      
      // Try different timestamp fields for elderly notifications
      if (notif.updated_at) {
        sortTimestamp = notif.updated_at.toDate ? notif.updated_at.toDate() : new Date(notif.updated_at);
      } else if (notif.created_at) {
        sortTimestamp = notif.created_at.toDate ? notif.created_at.toDate() : new Date(notif.created_at);
      } else if (notif.timestamp) {
        sortTimestamp = notif.timestamp.toDate ? notif.timestamp.toDate() : new Date(notif.timestamp);
      } else {
        // Fallback to a very old date so it doesn't appear as recent
        sortTimestamp = new Date('2020-01-01');
      }
      
      allNotifications.push({
        id: `elderly-${notif.id}`,
        type: 'elderly',
        timestamp: notif.updated_at || notif.created_at || notif.timestamp || new Date('2020-01-01'),
        data: notif,
        sortTimestamp: sortTimestamp
      });
    });

    // Add leave requests with timestamp
    leaveRequests.forEach(leave => {
      let sortTimestamp;
      
      if (leave.submitted_at) {
        sortTimestamp = leave.submitted_at.toDate ? leave.submitted_at.toDate() : new Date(leave.submitted_at);
      } else if (leave.created_at) {
        sortTimestamp = leave.created_at.toDate ? leave.created_at.toDate() : new Date(leave.created_at);
      } else {
        sortTimestamp = new Date('2020-01-01');
      }
      
      allNotifications.push({
        id: `leave-${leave.id}`,
        type: 'leave',
        timestamp: leave.submitted_at || leave.created_at || new Date('2020-01-01'),
        data: leave,
        sortTimestamp: sortTimestamp
      });
    });

    // Add user registrations with timestamp
    userRegistrations.forEach(user => {
      let sortTimestamp;
      
      if (user.createdAt) {
        sortTimestamp = user.createdAt.toDate ? user.createdAt.toDate() : new Date(user.createdAt);
      } else if (user.created_at) {
        sortTimestamp = user.created_at.toDate ? user.created_at.toDate() : new Date(user.created_at);
      } else {
        sortTimestamp = new Date('2020-01-01');
      }
      
      allNotifications.push({
        id: `user-${user.id}`,
        type: 'user',
        timestamp: user.createdAt || user.created_at || new Date('2020-01-01'),
        data: user,
        sortTimestamp: sortTimestamp
      });
    });

    // Sort by most recent first
    return allNotifications.sort((a, b) => b.sortTimestamp - a.sortTimestamp);
  };

  // ✅ Function to render notification item based on type
  const renderNotificationItem = (notification) => {
    const { type, data } = notification;
    
    switch (type) {
      case 'elderly':
        return (
          <li key={notification.id} className="notif-item unified-notif elderly-type">
            <div className="notif-type-indicator elderly-indicator">👴 Elderly Status</div>
            <div className="notif-content-unified">
              <div className="notif-main-info">
                <strong>{data.elderly_name}</strong>
                <span className="notif-status">{data.elderly_status}</span>
                <span className="notif-meta">{data.house_name}</span>
              </div>
              <div className="notif-actions">
                <button
                  className="approve-btn-small"
                  onClick={(e) => handleApproveElderly(data.id, e)}
                  title="Approve"
                >
                  ✓
                </button>
                <button
                  className="reject-btn-small"
                  onClick={(e) => handleRejectElderly(data.id, e)}
                  title="Reject"
                >
                  ✗
                </button>
              </div>
            </div>
          </li>
        );

      case 'leave':
        return (
          <li key={notification.id} className="notif-item unified-notif leave-type">
            <div className="notif-type-indicator leave-indicator">🏖️ Leave Request</div>
            <div className="notif-content-unified">
              <div className="notif-main-info">
                <strong>{data.full_name}</strong>
                <span className="notif-status">{data.leave_type}</span>
                <span className="notif-meta">
                  {data.start_date?.toDate()?.toLocaleDateString()} - 
                  {data.end_date?.toDate()?.toLocaleDateString()}
                </span>
              </div>
              <div className="notif-actions">
                <button
                  className="approve-btn-small"
                  onClick={(e) => handleApproveLeave(data.id, e)}
                  title="Approve"
                >
                  ✓
                </button>
                <button
                  className="reject-btn-small"
                  onClick={(e) => handleRejectLeave(data.id, e)}
                  title="Reject"
                >
                  ✗
                </button>
              </div>
            </div>
          </li>
        );

      case 'user':
        return (
          <li key={notification.id} className="notif-item unified-notif user-type">
            <div className="notif-type-indicator user-indicator">👤 New Registration</div>
            <div className="notif-content-unified">
              <div className="notif-main-info">
                <strong>{data.user_fname} {data.user_lname}</strong>
                <span className="notif-status">{data.user_type}</span>
                <span className="notif-meta">{data.user_email}</span>
              </div>
            </div>
          </li>
        );

      default:
        return null;
    }
  };

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target))
        setDropdownOpen(false);
      if (notifRef.current && !notifRef.current.contains(event.target))
        setNotifOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <nav className="navbar">
      <h1 className="nav-logo" onClick={() => navigate("/dashboard")}>
        <img src="/images/Elderlink_Logo.png" alt="ElderLink Logo" />
        ElderLink
      </h1>

      {/* ✅ Hamburger for mobile */}
      <button
        className="menu-toggle"
        onClick={() => setMenuOpen((prev) => !prev)}
      >
        {menuOpen ? <FaTimes /> : <FaBars />}
      </button>

      {/* ✅ Menu Links */}
      <ul className={`nav-links ${menuOpen ? "open" : ""}`}>
        <li
          className={location.pathname === "/dashboard" ? "active" : ""}
          onClick={() => { navigate("/dashboard"); setMenuOpen(false); }}
        >
          Home
        </li>
        <li
          className={location.pathname.startsWith("/elderlyManagement") ? "active" : ""}
          onClick={() => { navigate("/elderlyManagement"); setMenuOpen(false); }}
        >
          Elderly Management
        </li>
        <li
          className={location.pathname.startsWith("/schedule") ? "active" : ""}
          onClick={() => { navigate("/schedule"); setMenuOpen(false); }}
        >
          Caregiver Schedule
        </li>
        <li
          className={location.pathname.startsWith("/nurse-schedule") ? "active" : ""}
          onClick={() => { navigate("/nurse-schedule"); setMenuOpen(false); }}
        >
          Nurse Schedule
        </li>
        <li
          className={location.pathname.startsWith("/accounts") ? "active" : ""}
          onClick={() => { navigate("/accounts"); setMenuOpen(false); }}
        >
          Accounts
        </li>

        {/* ✅ Supervisor + Notifications inside burger (only mobile) */}
        {isMobile && (
          <li className="nav-actions-mobile">
            <div className="nav-actions-row">
              <div className="admin-dropdown" ref={dropdownRef}>
                <button
                  className="admin-btn"
                  onClick={() => setDropdownOpen((prev) => !prev)}
                >
                  Supervisor
                </button>
                {dropdownOpen && (
                  <ul className="dropdown-menu">
                    <li
                      onClick={() => {
                        navigate("/edit_admin_profile");
                        setMenuOpen(false);
                      }}
                    >
                      Edit Profile
                    </li>
                    <li onClick={handleLogout} className="logout-item">
                      Logout
                    </li>
                  </ul>
                )}
              </div>

              <div className="notif-dropdown" ref={notifRef}>
                <button
                  className="notif-btn"
                  onClick={() => setNotifOpen((prev) => !prev)}
                >
                  <FaBell size={20} />
                  {(notifications.length + leaveRequests.length + userRegistrations.length) > 0 && (
                    <span className="notif-badge">{notifications.length + leaveRequests.length + userRegistrations.length}</span>
                  )}
                </button>
                {notifOpen && (
                  <div className="notif-menu">
                    <div className="notif-content">
                      {(() => {
                        const unifiedNotifications = getUnifiedNotifications();
                        return unifiedNotifications.length === 0 ? (
                          <li>No new notifications</li>
                        ) : (
                          unifiedNotifications.map(renderNotificationItem)
                        );
                      })()}
                    </div>
                    
                    {/* Fixed Bottom - View All Notifications */}
                    <div className="notif-bottom">
                      <li 
                        className="notif-item view-all-notif"
                        onClick={() => {
                          setShowNotifModal(true);
                          setMenuOpen(false);
                          setNotifOpen(false);
                        }}
                      >
                        📋 View All Notifications
                      </li>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </li>
        )}
      </ul>

      {/* ✅ Desktop actions (hidden on mobile) */}
      {!isMobile && (
        <div className="nav-actions">
          <div className="admin-dropdown" ref={dropdownRef}>
            <button className="admin-btn" onClick={() => setDropdownOpen((prev) => !prev)}>
              Supervisor
            </button>
            {dropdownOpen && (
              <ul className="dropdown-menu">
                <li onClick={() => navigate("/edit_admin_profile")}>Edit Profile</li>
                <li onClick={handleLogout} className="logout-item">Logout</li>
              </ul>
            )}
          </div>

          <div className="notif-dropdown" ref={notifRef}>
            <button className="notif-btn" onClick={() => setNotifOpen((prev) => !prev)}>
              <FaBell size={20} />
              {(notifications.length + leaveRequests.length + userRegistrations.length) > 0 && (
                <span className="notif-badge">{notifications.length + leaveRequests.length + userRegistrations.length}</span>
              )}
            </button>
            {notifOpen && (
              <div className="notif-menu">
                <div className="notif-content">
                  {(() => {
                    const unifiedNotifications = getUnifiedNotifications();
                    return unifiedNotifications.length === 0 ? (
                      <li>No new notifications</li>
                    ) : (
                      unifiedNotifications.map(renderNotificationItem)
                    );
                  })()}
                </div>
                
                {/* Fixed Bottom - View All Notifications */}
                <div className="notif-bottom">
                  <li 
                    className="notif-item view-all-notif"
                    onClick={() => {
                      setShowNotifModal(true);
                      setNotifOpen(false);
                    }}
                  >
                    📋 View All Notifications
                  </li>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ✅ Notifications Modal */}
      <Notifications 
        isOpen={showNotifModal} 
        onClose={() => setShowNotifModal(false)}
        isModal={true}
      />

      {/* ✅ Leave Confirmation Modal */}
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
    </nav>
  );
}
