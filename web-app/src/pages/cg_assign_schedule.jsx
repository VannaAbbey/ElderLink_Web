import React, { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase"; // adjust path if needed

export default function CgAssignSchedule() {
  const [assignments, setAssignments] = useState([]);

  useEffect(() => {
    const fetchAssignments = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "cg_house_assign_v2")); // Database Name 1
        const data = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setAssignments(data);
      } catch (error) {
        console.error("Error fetching assignments: ", error);
      }
    };
    fetchAssignments();
  }, []);

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">📅 Caregiver House Assignments</h2>
      {assignments.length === 0 ? (
        <p>No caregiver assignments found.</p>
      ) : (
        <table className="table-auto w-full border-collapse border border-gray-300">
          <thead>
            <tr className="bg-gray-200">
              <th className="border border-gray-300 px-4 py-2">Assign ID</th>
              <th className="border border-gray-300 px-4 py-2">User ID</th>
              <th className="border border-gray-300 px-4 py-2">House ID</th>
              <th className="border border-gray-300 px-4 py-2">Shift</th>
              <th className="border border-gray-300 px-4 py-2">Days Assigned</th>
              <th className="border border-gray-300 px-4 py-2">Start Date</th>
              <th className="border border-gray-300 px-4 py-2">End Date</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((assign) => (
              <tr key={assign.id} className="hover:bg-gray-100">
                <td className="border border-gray-300 px-4 py-2">{assign.assign_id}</td>
                <td className="border border-gray-300 px-4 py-2">{assign.user_id}</td>
                <td className="border border-gray-300 px-4 py-2">{assign.house_id}</td>
                <td className="border border-gray-300 px-4 py-2">{assign.shift}</td>
                <td className="border border-gray-300 px-4 py-2">
                  {assign.days_assigned?.join(", ")}
                </td>
                <td className="border border-gray-300 px-4 py-2">
                  {assign.start_date?.toDate
                    ? assign.start_date.toDate().toLocaleDateString()
                    : assign.start_date}
                </td>
                <td className="border border-gray-300 px-4 py-2">
                  {assign.end_date?.toDate
                    ? assign.end_date.toDate().toLocaleDateString()
                    : assign.end_date}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
