import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import ElderlyProfile from "./pages/elderly_profile";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/elderly_profile" element={<ElderlyProfile />} />
      </Routes>
    </Router>
  );
}
