/** Shown while the checkout guard verifies the cart and prior steps. */
export function CheckoutGuardFallback() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-[#333]/20 border-t-[#333] animate-spin rounded-full" />
    </div>
  );
}
