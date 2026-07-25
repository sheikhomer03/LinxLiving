import type { LucideIcon } from "lucide-react";
import {
  Package,
  Box,
  BadgeCheck,
  Truck,
  MapPinned,
  CheckCircle2,
  XCircle,
} from "lucide-react";

export type OrderStatus =
  | "Processing"
  | "Confirmed Order"
  | "Shipped"
  | "Out for Delivery"
  | "Delivered"
  | "Cancelled";

export type TrackingStep = {
  status: string;
  description: string;
  icon: LucideIcon;
  completed: boolean;
  current: boolean;
  date: string;
};

const FLOW: {
  status: OrderStatus;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    status: "Processing",
    label: "Processing",
    description: "Your order has been received and is being prepared.",
    icon: Package,
  },
  {
    status: "Confirmed Order",
    label: "Confirmed",
    description: "Payment verified and your order is confirmed.",
    icon: BadgeCheck,
  },
  {
    status: "Shipped",
    label: "Shipped",
    description: "Your order has left our warehouse with the courier.",
    icon: Truck,
  },
  {
    status: "Out for Delivery",
    label: "Out for Delivery",
    description: "Your order is out for delivery today.",
    icon: MapPinned,
  },
  {
    status: "Delivered",
    label: "Delivered",
    description: "Your order has arrived at the delivery address.",
    icon: CheckCircle2,
  },
];

const RANK: Record<string, number> = {
  Processing: 0,
  "Confirmed Order": 1,
  Shipped: 2,
  "Out for Delivery": 3,
  Delivered: 4,
  Cancelled: -1,
};

export function buildTrackingSteps(
  status: string,
  createdAt: string | Date,
): TrackingStep[] {
  const placed = new Date(createdAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (status === "Cancelled") {
    return [
      {
        status: "Ordered",
        description: "Your order was received.",
        icon: Box,
        completed: true,
        current: false,
        date: placed,
      },
      {
        status: "Cancelled",
        description: "This order has been cancelled.",
        icon: XCircle,
        completed: true,
        current: true,
        date: "Cancelled",
      },
    ];
  }

  const currentRank = RANK[status] ?? 0;

  return FLOW.map((step, index) => {
    const completed = currentRank > index;
    const current = currentRank === index;

    let date = "Pending";
    if (index === 0) date = placed;
    else if (completed) date = "Complete";
    else if (current) date = "In progress";

    return {
      status: step.label,
      description: step.description,
      icon: step.icon,
      completed,
      current,
      date,
    };
  });
}
