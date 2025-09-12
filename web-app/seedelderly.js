import admin from "firebase-admin";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

console.log("Seeder is writing to project:", serviceAccount.project_id);

// Elderly data (matches your schema)
const elderlyData = [
  {
    allocation_reason: "Assigned to caregiver A",
    elderly_age: 80,
    elderly_bday: admin.firestore.Timestamp.fromDate(new Date("1945-06-15")),
    elderly_causeDeath: "",
    elderly_condition: "Hypertension",
    elderly_deathDate: "", // string muna as you mentioned
    elderly_dietNotes: "Low sodium diet",
    elderly_fname: "Juan",
    elderly_lname: "Dela Cruz",
    elderly_mobilityStatus: "Assisted",
    elderly_profilePic: "",
    elderly_sex: "Male",
    elderly_status: "Alive",
    house_id: "H001",
  },
  {
    allocation_reason: "Assigned to caregiver B",
    elderly_age: 75,
    elderly_bday: admin.firestore.Timestamp.fromDate(new Date("1950-02-20")),
    elderly_causeDeath: "",
    elderly_condition: "Diabetes",
    elderly_deathDate: "",
    elderly_dietNotes: "Vegetarian",
    elderly_fname: "Maria",
    elderly_lname: "Santos",
    elderly_mobilityStatus: "Independent",
    elderly_profilePic: "",
    elderly_sex: "Female",
    elderly_status: "Alive",
    house_id: "H002",
  }
];

// Seeder function
async function seedElderly() {
  const batch = db.batch();

  elderlyData.forEach((elderly) => {
    const docRef = db.collection("elderly").doc();
    console.log(`Seeding: ${elderly.elderly_fname} ${elderly.elderly_lname}`);
    batch.set(docRef, elderly);
  });

  await batch.commit();
  console.log("Elderly data seeded successfully!");
}

seedElderly().catch(console.error);