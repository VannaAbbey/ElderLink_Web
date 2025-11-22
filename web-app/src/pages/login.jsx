import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, updateDoc, Timestamp } from "firebase/firestore";
import { auth, db } from "../firebase";
import { MdVisibility, MdVisibilityOff } from "react-icons/md";
import "../css/login.css";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();

    try {
      // 1️⃣ Authenticate with Firebase Authentication
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid; // Get UID
      const userEmail = userCredential.user.email; // Firebase email

      // 2️⃣ Get Firestore document using UID as document ID
      const userDocRef = doc(db, "users", uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        setErrorMessage("No user data found in Firestore");
        setShowErrorModal(true);
        return;
      }

      const userData = userDoc.data();

      // 3️⃣ Optional: Verify email consistency
      if (userData.user_email !== userEmail) {
        setErrorMessage("Email mismatch detected. Please contact support.");
        setShowErrorModal(true);
        return;
      }

      // 4️⃣ Check user type
      if (userData.user_type === "administrator") {
        // 🔐 SECURITY: Generate unique session token and store in Firestore
        // This will invalidate any previous sessions on other devices
        const sessionToken = `${uid}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const deviceInfo = {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          timestamp: Timestamp.now()
        };

        console.log('🔐 LOGIN: Generating new session token');
        console.log('   User ID:', uid);
        console.log('   New Token:', sessionToken);
        console.log('   Device:', navigator.platform);

        // Update user document with new session token
        // This will automatically invalidate previous sessions
        await updateDoc(userDocRef, {
          active_session_token: sessionToken,
          last_login: Timestamp.now(),
          login_device: deviceInfo
        });

        console.log('✅ LOGIN: Session token saved to Firestore');

        // Store session token in localStorage for session validation
        localStorage.setItem('session_token', sessionToken);
        localStorage.setItem('user_id', uid);

        console.log('✅ LOGIN: Session token saved to localStorage');
        console.log('🚀 Navigating to dashboard...');
        
        navigate("/dashboard");
      } else {
        setErrorMessage("Access denied: Not an administrator account");
        setShowErrorModal(true);
      }
    } catch (error) {
      // Handle different Firebase error codes
      let message = "Login failed";
      if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password" || error.code === "auth/user-not-found") {
        message = "Invalid email or password. Please try again.";
      } else if (error.code === "auth/too-many-requests") {
        message = "Too many failed attempts. Please try again later.";
      } else if (error.code === "auth/network-request-failed") {
        message = "Network error. Please check your connection.";
      } else {
        message = error.message;
      }
      setErrorMessage(message);
      setShowErrorModal(true);
    }
  };

  // Toggle password visibility
  const togglePassword = () => setShowPassword((prev) => !prev);

  return (
    <div className="login-page">
      <div className="login-container">
        <img src="/images/Elderlink_Logo.png" alt="ElderLink Logo" className="login-logo" />
        <h2 id="elderlink">ELDERLINK</h2>
        <h2>Login</h2>
        <p>
          Continue your Elderly Care Journey, <br />
          Sign in now!
        </p>
        <form onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div className="password-wrapper">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={togglePassword}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <MdVisibilityOff /> : <MdVisibility />}
            </button>
          </div>

          <button type="submit">LOGIN</button>
        </form>
      </div>

      {/* Error Modal */}
      {showErrorModal && (
        <div className="modal-overlay" onClick={() => setShowErrorModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>❌ Login Failed</h3>
            <p>{errorMessage}</p>
            <button onClick={() => setShowErrorModal(false)}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}
