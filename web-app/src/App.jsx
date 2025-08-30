import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import ElderlyManagement from "./pages/elderlyManagement";
import EditCgAssign from "./pages/edit_cg_assign";
import EditCaregiverProfile from "./pages/edit_cg_profile";
import EditNurseProfile from "./pages/edit_cg_profile";
import Profile_Elderly from "./pages/profileElderly";
import HouseView from "./pages/houseView";



export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/elderlyManagement" element={<ElderlyManagement />} />
        <Route path="/edit_cg_assign" element={<EditCgAssign />} />
        <Route path="/edit_cg_profile" element={<EditCaregiverProfile />} />
        <Route path="/edit_nurse_profile" element={<EditNurseProfile />} />
        <Route path="/profileElderly/:id" element={<Profile_Elderly />} />
        <Route path="/house/:houseId" element={<HouseView />} />

      </Routes>
    </Router>
  );
}
