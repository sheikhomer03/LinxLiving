import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import { ProfileClient } from "./ProfileClient";

export default function ProfilePage() {
  return <ProfileClient navbar={<StorefrontNavbar />} />;
}
