import { AdminSidebar } from "@/components/admin/AdminSidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-[#fafafa]">
      <AdminSidebar />
      <main className="flex-1 overflow-x-hidden">
        {/* Header bar placeholder if needed later */}
        <div className="p-10 animate-in fade-in duration-700">{children}</div>
      </main>
    </div>
  );
}
