import React from "react";
import Navbar from "./navbar";
import "../css/summary-vitals-meds.css";

export default function SummaryVitalsMeds() {
  return (
    <div className="summary-vitals-meds-page">
      <Navbar />
      <main className="summary-vitals-meds-container">
        <h1 className="page-title">Summary of Vitals & Meds</h1>
        
        <div className="content-placeholder">
          <p>Input the code here</p>
        </div>
      </main>
    </div>
  );
}
