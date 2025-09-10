import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";
import { FaBell } from "react-icons/fa";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import "./navbar.css";

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const dropdownRef = useRef(null);
  const notifRef = useRef(null);

  // ✅ Redirect to login if user is not authenticated
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        navigate("/login", { replace: true });
      }
    });
    return () => unsubscribeAuth();
  }, [navigate]);

  // ✅ Logout function
  const handleLogout = async () => {
    try {
      await signOut(auth);
      console.log("✅ Successfully logged out");
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  // ✅ Real-time listener for PENDING notifications
  useEffect(() => {
    const q = query(
      collection(db, "notifications"),
      where("action_status", "==", "pending")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const notifData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setNotifications(notifData);
    });

    return () => unsubscribe();
  }, []);

  // ✅ Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setNotifOpen(false);
      }
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

      <ul className="nav-links">
        <li
          className={location.pathname === "/dashboard" ? "active" : ""}
          onClick={() => navigate("/dashboard")}
        >
          Home
        </li>
        <li
          className={
            location.pathname.startsWith("/elderlyManagement") ? "active" : ""
          }
          onClick={() => navigate("/elderlyManagement")}
        >
          Elderly Management
        </li>
        <li
          className={location.pathname.startsWith("/schedule") ? "active" : ""}
          onClick={() => navigate("/schedule")}
        >
          Schedule
        </li>
        <li
          className={location.pathname.startsWith("/accounts") ? "active" : ""}
          onClick={() => navigate("/accounts")}
        >
          Accounts
        </li>
      </ul>

      <div className="nav-actions">
        {/* Admin Dropdown */}
        <div className="admin-dropdown" ref={dropdownRef}>
          <button
            className="admin-btn"
            onClick={() => setDropdownOpen((prev) => !prev)}
          >
            Admin
          </button>
          {dropdownOpen && (
            <ul className="dropdown-menu">
              <li onClick={() => navigate("/edit-profile")}>Edit Profile</li>
              <li onClick={() => navigate("/settings")}>Settings</li>
              <li onClick={() => navigate("/help-support")}>Help & Support</li>
              <li onClick={handleLogout} className="logout-item">
                Logout
              </li>
            </ul>
          )}
        </div>

        {/* Notifications Dropdown */}
        <div className="notif-dropdown" ref={notifRef}>
          <button
            className="notif-btn"
            onClick={() => setNotifOpen((prev) => !prev)}
          >
            <FaBell size={20} />
            {notifications.length > 0 && (
              <span className="notif-badge">{notifications.length}</span>
            )}
          </button>
          {notifOpen && (
            <ul className="notif-menu">
              {notifications.length === 0 ? (
                <li>No new notifications</li>
              ) : (
                <>
                  {notifications.map((notif) => (
                    <li
                      key={notif.id}
                      onClick={() => navigate(`/notifications?id=${notif.id}`)}
                      className="notif-item"
                    >
                      <strong>{notif.elderly_name}</strong> -{" "}
                      {notif.elderly_status}
                    </li>
                  ))}
                  <li
                    className="view-all"
                    onClick={() => navigate("/notifications")}
                  >
                    View All Notifications
                  </li>
                </>
              )}
            </ul>
          )}
        </div>
      </div>
    </nav>
  );
}
