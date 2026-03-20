import AdminLayoutContent from "./AdminLayoutContent";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin Dashboard | Linx Living",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminLayoutContent>{children}</AdminLayoutContent>;
}
