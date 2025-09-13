import React, { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import Navbar from "./navbar";
import { useNavigate } from "react-router-dom";
import "./dashboard.css";

export default function Dashboard() {
  const [totalElderly, setTotalElderly] = useState(0);
  const [totalCaregivers, setTotalCaregivers] = useState(0);
  const [totalNurses, setTotalNurses] = useState(0);

  const navigate = useNavigate();

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const elderlySnapshot = await getDocs(collection(db, "elderly"));
        setTotalElderly(elderlySnapshot.size);

        const usersSnapshot = await getDocs(collection(db, "users"));
        let caregiverCount = 0;
        let nurseCount = 0;

        usersSnapshot.forEach((doc) => {
          const data = doc.data();
          if (data.user_type === "caregiver") caregiverCount++;
          if (data.user_type === "nurse") nurseCount++;
        });

        setTotalCaregivers(caregiverCount);
        setTotalNurses(nurseCount);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    fetchCounts();
  }, []);

// ---------------- Houses Carousel ----------------
const houses = [
  { 
    img: "/images/Sebastian.png", 
    name: "St. Sebastian", 
    shortTitle: "Women Receiving Psychological Support",
    desc: "Women who may be experiencing mental health challenges and are provided with care, guidance, and a supportive environment to promote their emotional well-being and recovery." 
  },
  { 
    img: "/images/Emmanuel.png", 
    name: "St. Emmanuel", 
    shortTitle: "Women Requiring Full-Time Bed Care",
    desc: "Women whose health conditions require them to remain bedridden, receiving attentive, compassionate care to support their daily needs, comfort, and quality of life." 
  },
  { 
    img: "/images/Charbell.png", 
    name: "St. Charbell", 
    shortTitle: "Men Requiring Full-Time Bed Care",
    desc: "Men whose medical or physical conditions require them to stay in bed, where they are given specialized support, attentive assistance, and care with dignity and respect." 
  },
  { 
    img: "/images/Rose.png", 
    name: "St. Rose of Lima", 
    shortTitle: "Women Living Independently with Assistance",
    desc: "Women who are physically able and mobile, supported with the necessary resources, companionship, and guidance to live meaningful and fulfilling lives within a caring environment." 
  },
  { 
    img: "/images/Gabriel.png", 
    name: "St. Gabriel", 
    shortTitle: "Men Living Independently with Assistance",
    desc: "Men who are physically able and mobile, supported with opportunities, resources, and compassionate guidance to help them maintain independence and enjoy a dignified quality of life." 
  },
];


  const [current, setCurrent] = useState(1); // start with middle card

  const prevIndex = () => (current - 1 + houses.length) % houses.length;
  const nextIndex = () => (current + 1) % houses.length;

  const prevSlide = () => setCurrent(prevIndex());
  const nextSlide = () => setCurrent(nextIndex());

  return (
    <div className="dashboard-container">
      <Navbar />

      {/* Overview */}
      <h2 className="section-title">Overview</h2>
      <div className="overview-cards">
        <div className="overview-card">
          <h3>Total Elderly</h3>
          <p>{totalElderly}</p>
        </div>
        <div className="overview-card">
          <h3>Total Caregivers</h3>
          <p>{totalCaregivers}</p>
        </div>
        <div className="overview-card">
          <h3>Total Nurses</h3>
          <p>{totalNurses}</p>
        </div>
      </div>

      {/* Graces Gallery */}
      <div className="graces-gallery-container">
        <div className="gallery-wrapper">
          <div className="gallery-wrapper-holder">
            <div id="slider-img-1"></div>
            <div id="slider-img-2"></div>
            <div id="slider-img-3"></div>
            <div id="slider-img-4"></div>
            <div id="slider-img-5"></div>
            <div id="slider-img-6"></div>
          </div>
        </div>
      </div>

      {/* Houses Carousel */}
    <h2 className="section-title">Houses</h2>
    <div className="houses-carousel">
      <button className="carousel-btn prev" onClick={prevSlide}> &lt; </button>
      <div className="carousel-wrapper">
      {houses.map((house, index) => {
        let position = "side";
        if (index === current) position = "center";
        else if (index === prevIndex()) position = "left";
        else if (index === nextIndex()) position = "right";

        return (
          <div key={house.name} className={`house-card ${position}`}>
            <img src={house.img} alt={house.name} />
            <h3>{house.name}</h3>
            <h4 className="house-short-title">{house.shortTitle}</h4>
            <p className="house-desc">{house.desc}</p>
          </div>
        );
      })}
      </div>
      <button className="carousel-btn next" onClick={nextSlide}> &gt; </button>
    </div>
    </div>
  );
}
