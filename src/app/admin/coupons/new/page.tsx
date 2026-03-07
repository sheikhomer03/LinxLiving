import { CouponForm } from "@/components/admin/CouponForm";
import { createCoupon } from "@/app/actions/coupons";

export default function NewCouponPage() {
  return <CouponForm title="Create New Coupon" action={createCoupon} />;
}
