import { Outlet } from "react-router";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { Toaster } from "../components/ui/sonner";

export function MainLayout() {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <Toaster position="top-right" />
    </div>
  );
}
