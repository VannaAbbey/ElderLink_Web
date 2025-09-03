import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { collection, query, where, getDocs } from "firebase/firestore";
import { auth, db } from "../firebase";
import { MdVisibility, MdVisibilityOff } from "react-icons/md";
import "./login.css";
  
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();

    try {
      // 1️⃣ Authenticate with Firebase Authentication
      await signInWithEmailAndPassword(auth, email, password);

      // 2️⃣ Query Firestore for user data using email
      const q = query(
        collection(db, "users"),
        where("user_email", "==", email)
      );
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        alert("No user data found in Firestore");
        return;
      }

      const userData = querySnapshot.docs[0].data();

      // 3️⃣ Check admin role
      if (userData.user_type === "administrator") {
        navigate("/dashboard");
      } else {
        alert("Access denied: Not an administrator");
      }
    } catch (error) {
      alert("Login failed: " + error.message);
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
    </div>
  );

  
}
