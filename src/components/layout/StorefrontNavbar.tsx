import { Navbar } from "@/components/layout/Navbar";
import { getStorefrontNavProps } from "@/lib/storefrontNav";

/**
 * Server Navbar seeded like /category — pass this instead of bare <Navbar />
 * on any RSC page so department/brand menus paint immediately.
 */
export async function StorefrontNavbar() {
  const props = await getStorefrontNavProps();
  return <Navbar {...props} />;
}
