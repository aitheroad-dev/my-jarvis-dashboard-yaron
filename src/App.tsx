import { BrowserRouter } from "react-router-dom";
import { HikingApp } from "./hiking/HikingApp";
import { ChunkErrorBoundary } from "./components/ChunkErrorBoundary";

// Public Israel hiking planner. Fully open (no auth) — a curated list of points
// of interest with search, filtering, an AI-style chat planner, field notes and
// CSV import. RTL Hebrew throughout.

const App = () => (
  <ChunkErrorBoundary>
    <BrowserRouter>
      <HikingApp />
    </BrowserRouter>
  </ChunkErrorBoundary>
);

export default App;
