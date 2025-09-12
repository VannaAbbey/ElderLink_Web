import admin from "firebase-admin";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Caregiver accounts to seed
const caregiversData = [
  {
    email: "caregiver1@gmail.com",
    password: "Password123!",
    fname: "Antonio",
    lname: "Esguerra",
    contactNum: "+639171234567",
    bday: new Date("1985-03-15"),
    profilePic: "",
    type: "caregiver",
  },
  {
    email: "caregiver2@gmail.com",
    password: "Password123!",
    fname: "Maria",
    lname: "Santos",
    contactNum: "+639181234567",
    bday: new Date("1990-07-20"),
    profilePic: "",
    type: "caregiver",
  }
];

async function seedCaregivers() {
  for (const user of caregiversData) {
    try {
      // 1️⃣ Create caregiver in Firebase Auth
      const userRecord = await admin.auth().createUser({
        email: user.email,
        password: user.password,
        displayName: `${user.fname} ${user.lname}`,
      });

      console.log(`✅ Created Auth caregiver: ${userRecord.uid} (${user.email})`);

      // 2️⃣ Insert caregiver into Firestore "users" collection with UID as document ID
      await db.collection("users").doc(userRecord.uid).set({
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        user_activation: true,
        user_bday: admin.firestore.Timestamp.fromDate(user.bday),
        user_contactNum: user.contactNum,
        user_email: user.email,
        user_fname: user.fname,
        user_lname: user.lname,
        user_profilePic: user.profilePic,
        user_type: user.type,
      });

      console.log(`✅ Added Firestore doc for caregiver: ${user.email}`);
    } catch (error) {
      if (error.code === "auth/email-already-exists") {
        console.log(`⚠️ Caregiver already exists in Auth: ${user.email}`);
      } else {
        console.error("❌ Error seeding caregiver:", error);
      }
    }
  }

  console.log("🎉 Caregiver seeding complete!");
}

seedCaregivers().catch(console.error);
