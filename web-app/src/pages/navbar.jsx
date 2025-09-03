import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { FaBell } from "react-icons/fa";
import "./navbar.css";

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const dropdownRef = useRef(null);
  const notifRef = useRef(null);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/login");
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  // Close Dropdowns when clicking outside
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
        <li className={location.pathname === "/dashboard" ? "active" : ""} onClick={() => navigate("/dashboard")}> Home </li>
        <li className={location.pathname.startsWith("/elderlyManagement") ? "active" : ""} onClick={() => navigate("/elderlyManagement")} > Elderly Management </li>
        <li className={location.pathname.startsWith("/edit_cg_assign") ? "active" : ""} onClick={() => navigate("/edit_cg_assign")}> Schedule </li>
        <li className={location.pathname.startsWith("/accounts") ? "active" : ""} onClick={() => navigate("/accounts")}> Accounts </li>
      </ul>

      <div className="nav-actions">
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

        <div className="notif-dropdown" ref={notifRef}>
          <button
            className="notif-btn"
            onClick={() => setNotifOpen((prev) => !prev)}
          >
            <FaBell size={20} />
          </button>
          {notifOpen && (
            <ul className="notif-menu">
              <li>No new notifications</li>
              {/* Later: map real notifications here */}
            </ul>
          )}
        </div>
      </div>
    </nav>
  );
}
