import { useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { SidebarContent } from "./SidebarContent";

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`sticky top-0 h-screen bg-sidebar border-r border-sidebar-border flex flex-col hidden md:flex overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
        collapsed ? "w-[76px]" : "w-64"
      }`}
    >
      <SidebarContent collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
    </aside>
  );
}
