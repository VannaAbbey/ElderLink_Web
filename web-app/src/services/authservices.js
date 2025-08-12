import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

const handleLogin = async (email, password) => {
  try {
    // 1. Authenticate sa Firebase Auth
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // 2. Kuhanin yung data niya sa Firestore
    const userDocRef = doc(db, "users", user.uid);
    const userDocSnap = await getDoc(userDocRef);

    if (userDocSnap.exists()) {
      const userData = userDocSnap.data();
      if (userData.user_type === "administrator") {
        console.log("Welcome Admin!");
      } else {
        console.log("Access denied: Not an administrator");
      }
    } else {
      console.log("No such user in Firestore");
    }
  } catch (error) {
    console.error("Login failed:", error.message);
  }
};
