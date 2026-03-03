"use client";
import { Skeleton } from "@/components/ui/Skeleton";

export function PersonalDetailsSkeleton() {
  return (
    <div className="space-y-10 max-w-2xl">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
      </div>

      <div className="space-y-6 pt-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-12 w-full" />
        </div>

        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>

      <Skeleton className="h-14 w-full md:w-[200px]" />
    </div>
  );
}

export function AddressBookSkeleton() {
  return (
    <div className="space-y-10">
      <Skeleton className="h-7 w-40" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {[1, 2].map((i) => (
          <div key={i} className="border border-foreground/10 p-6 space-y-4">
            <div className="flex justify-between items-start">
              <Skeleton className="h-4 w-32" />
              <div className="flex gap-4">
                <Skeleton className="h-4 w-10" />
                <Skeleton className="h-4 w-12" />
              </div>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        ))}
      </div>

      <div className="pt-6">
        <Skeleton className="h-14 w-full md:w-[200px]" />
      </div>
    </div>
  );
}

export function OrdersReturnsSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-5 w-72" />
      </div>

      <div className="py-8 border-t border-foreground/5">
        <div className="space-y-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex justify-between items-center py-4 border-b border-foreground/5"
            >
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
              </div>
              <div className="space-y-2 text-right">
                <Skeleton className="h-4 w-16 ml-auto" />
                <Skeleton className="h-4 w-20 ml-auto" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WishlistSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 py-8 border-t border-foreground/5">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex gap-4 p-4 border border-foreground/5 bg-white relative"
          >
            <div className="relative w-24 h-24 bg-secondary overflow-hidden">
              <Skeleton className="h-full w-full" />
            </div>
            <div className="flex-1 flex flex-col justify-between py-1">
              <div className="space-y-2">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-4 w-1/4" />
              </div>
              <div className="flex justify-between items-center border-t border-foreground/5 pt-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-4" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
