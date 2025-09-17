import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";
import { FaBell, FaBars, FaTimes } from "react-icons/fa";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import "./navbar.css";

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768); // ✅ track screen size
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

  // Real-time notifications
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
                            onClick={() => {
                              navigate(`/notifications?id=${notif.id}`);
                              setMenuOpen(false);
                            }}
                            className="notif-item"
                          >
                            <strong>{notif.elderly_name}</strong> -{" "}
                            {notif.elderly_status}
                          </li>
                        ))}
                        <li
                          className="view-all"
                          onClick={() => {
                            navigate("/notifications");
                            setMenuOpen(false);
                          }}
                        >
                          View All Notifications
                        </li>
                      </>
                    )}
                  </ul>
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
                        <strong>{notif.elderly_name}</strong> - {notif.elderly_status}
                      </li>
                    ))}
                    <li className="view-all" onClick={() => navigate("/notifications")}>
                      View All Notifications
                    </li>
                  </>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
