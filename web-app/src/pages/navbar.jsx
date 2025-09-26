import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";
import { FaBell, FaBars, FaTimes } from "react-icons/fa";
import { collection, query, where, onSnapshot, updateDoc, doc } from "firebase/firestore";
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
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768); // ✅ track screen size
  const [showNotifModal, setShowNotifModal] = useState(false);
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

  // Handle leave request approval (for dropdown only)
  const handleApproveLeave = async (leaveId, event) => {
    event.stopPropagation(); // Prevent dropdown from closing
    try {
      await updateDoc(doc(db, "leave_requests", leaveId), {
        status: "approved",
        reviewed_at: new Date(),
        reviewed_by: "admin",
        reviewer_comments: "Approved by admin",
        updated_at: new Date()
      });
      alert("Leave request approved!");
    } catch (error) {
      console.error("Error approving leave:", error);
      alert("Failed to approve leave request.");
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
                  {(notifications.length + leaveRequests.length) > 0 && (
                    <span className="notif-badge">{notifications.length + leaveRequests.length}</span>
                  )}
                </button>
                {notifOpen && (
                  <div className="notif-menu">
                    <div className="notif-content">
                      {(notifications.length === 0 && leaveRequests.length === 0) ? (
                        <li>No new notifications</li>
                      ) : (
                        <>
                          {/* Elderly Status Notifications */}
                          {notifications.length > 0 && (
                            <>
                              <li className="notif-section-header">Elderly Status Updates</li>
                              {notifications.map((notif) => (
                                <li
                                  key={`notif-${notif.id}`}
                                  onClick={() => {
                                    navigate(`/notifications?id=${notif.id}`);
                                    setMenuOpen(false);
                                  }}
                                  className="notif-item elderly-notif"
                                >
                                  <strong>{notif.elderly_name}</strong> - {notif.elderly_status}
                                </li>
                              ))}
                            </>
                          )}
                          
                          {/* Leave Request Notifications */}
                          {leaveRequests.length > 0 && (
                            <>
                              <li className="notif-section-header">Leave Requests</li>
                              {leaveRequests.map((leave) => (
                                <li key={`leave-${leave.id}`} className="notif-item leave-notif">
                                  <div className="leave-notif-content">
                                    <div className="leave-info">
                                      <strong>{leave.full_name}</strong>
                                      <span className="leave-type">{leave.leave_type}</span>
                                      <span className="leave-dates">
                                        {leave.start_date?.toDate()?.toLocaleDateString()} - 
                                        {leave.end_date?.toDate()?.toLocaleDateString()}
                                      </span>
                                    </div>
                                    <div className="leave-actions">
                                      <button
                                        className="approve-btn-small"
                                        onClick={(e) => handleApproveLeave(leave.id, e)}
                                        title="Approve"
                                      >
                                        ✓
                                      </button>
                                      <button
                                        className="reject-btn-small"
                                        onClick={(e) => handleRejectLeave(leave.id, e)}
                                        title="Reject"
                                      >
                                        ✗
                                      </button>
                                    </div>
                                  </div>
                                </li>
                              ))}
                            </>
                          )}
                        </>
                      )}
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
              {(notifications.length + leaveRequests.length) > 0 && (
                <span className="notif-badge">{notifications.length + leaveRequests.length}</span>
              )}
            </button>
            {notifOpen && (
              <div className="notif-menu">
                <div className="notif-content">
                  {(notifications.length === 0 && leaveRequests.length === 0) ? (
                    <li>No new notifications</li>
                  ) : (
                    <>
                      {/* Elderly Status Notifications */}
                      {notifications.length > 0 && (
                        <>
                          <li className="notif-section-header">Elderly Status Updates</li>
                          {notifications.map((notif) => (
                            <li
                              key={`notif-${notif.id}`}
                              onClick={() => navigate(`/notifications?id=${notif.id}`)}
                              className="notif-item elderly-notif"
                            >
                              <strong>{notif.elderly_name}</strong> - {notif.elderly_status}
                            </li>
                          ))}
                        </>
                      )}
                      
                      {/* Leave Request Notifications */}
                      {leaveRequests.length > 0 && (
                        <>
                          <li className="notif-section-header">Leave Requests</li>
                          {leaveRequests.map((leave) => (
                            <li key={`leave-${leave.id}`} className="notif-item leave-notif">
                              <div className="leave-notif-content">
                                <div className="leave-info">
                                  <strong>{leave.full_name}</strong>
                                  <span className="leave-type">{leave.leave_type}</span>
                                  <span className="leave-dates">
                                    {leave.start_date?.toDate()?.toLocaleDateString()} - 
                                    {leave.end_date?.toDate()?.toLocaleDateString()}
                                  </span>
                                </div>
                                <div className="leave-actions">
                                  <button
                                    className="approve-btn-small"
                                    onClick={(e) => handleApproveLeave(leave.id, e)}
                                    title="Approve"
                                  >
                                    ✓
                                  </button>
                                  <button
                                    className="reject-btn-small"
                                    onClick={(e) => handleRejectLeave(leave.id, e)}
                                    title="Reject"
                                  >
                                    ✗
                                  </button>
                                </div>
                              </div>
                            </li>
                          ))}
                        </>
                      )}
                    </>
                  )}
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
    </nav>
  );
}
