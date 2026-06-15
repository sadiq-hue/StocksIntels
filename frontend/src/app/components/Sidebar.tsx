import { SidebarContent } from "./SidebarContent";

export function Sidebar() {
  return (
    <aside className="w-64 sticky top-0 h-screen bg-sidebar border-r border-sidebar-border flex flex-col hidden md:flex overflow-y-auto">
      <SidebarContent />
    </aside>
  );
}
