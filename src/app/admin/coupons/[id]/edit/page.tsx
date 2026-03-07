import { CouponForm } from "@/components/admin/CouponForm";
import { getCoupon, updateCoupon } from "@/app/actions/coupons";
import { notFound } from "next/navigation";

interface EditCouponPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditCouponPage({ params }: EditCouponPageProps) {
  const { id } = await params;
  const coupon = await getCoupon(id);

  if (!coupon) {
    notFound();
  }

  const updateAction = async (data: any) => {
    "use server";
    return await updateCoupon(id, data);
  };

  return (
    <CouponForm
      title="Edit Coupon"
      initialData={coupon}
      action={updateAction}
    />
  );
}
