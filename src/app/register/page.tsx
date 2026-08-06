import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";
import { RegisterForm } from "./RegisterForm";

export default function RegisterPage() {
  return <RegisterForm navbar={<StorefrontNavbar />} />;
}
