import { Route, Routes } from "react-router-dom";
import "./hiking.css";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { PoiDetailPage } from "./pages/PoiDetailPage";
import { PoiEditPage } from "./pages/PoiEditPage";
import { ImportPage } from "./pages/ImportPage";

export function HikingApp() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="/poi/new" element={<PoiEditPage />} />
        <Route path="/poi/:id" element={<PoiDetailPage />} />
        <Route path="/poi/:id/edit" element={<PoiEditPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="*" element={<HomePage />} />
      </Route>
    </Routes>
  );
}
