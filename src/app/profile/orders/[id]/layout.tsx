import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";

export default function OrderDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <StorefrontNavbar />
      {children}
    </>
  );
}
