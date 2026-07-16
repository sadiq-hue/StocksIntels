import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { SidebarContent } from "./SidebarContent";

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`sticky top-0 h-screen bg-sidebar border-r border-sidebar-border flex flex-col hidden md:flex overflow-y-auto transition-all duration-300 ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      <div className="flex items-center justify-end p-2">
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="size-9 flex items-center justify-center rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>
      </div>
      <SidebarContent collapsed={collapsed} />
    </aside>
  );
}
