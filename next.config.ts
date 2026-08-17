import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
    /*
     * Client-side router cache — the Next equivalent of the React Query
     * staleTime our Vite sites rely on.
     *
     * Without this, Next holds a prefetched or visited page for 30 seconds
     * (dynamic routes: 0), so going back to a category or product re-fetches
     * it from the server and the customer waits again. Holding it for a few
     * minutes means a click on an already-seen link renders straight from
     * memory, with no server round trip and no loading state — the same
     * behaviour as an SPA.
     *
     * Note this is a *client* cache keyed per session; it does not affect what
     * a first-time visitor sees, and any router.refresh() or server action
     * still busts it.
     */
    staleTimes: {
      dynamic: 180,
      static: 300,
    },
  },
  images: {
    // Bypass Vercel Image Optimization — Hobby/plan quota returns HTTP 402
    // (OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED) for new transforms. Assets
    // already live on Cloudinary / Shopify CDN, so serve them directly.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "plus.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "placehold.co",
      },
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      {
        protocol: "https",
        hostname: "cdn.shopify.com",
      },
      {
        protocol: "https",
        hostname: "cdn.shopifycdn.net",
      },
      {
        protocol: "https",
        hostname: "catalogos.porcelanosagrupo.com",
      },
      {
        protocol: "https",
        hostname: "www.noken.com",
      },
      {
        protocol: "https",
        hostname: "noken.com",
      },
      {
        protocol: "https",
        hostname: "productfinder.porcelanosagrupo.com",
      },
      {
        protocol: "https",
        hostname: "www.britmet.co.uk",
      },
      {
        protocol: "https",
        hostname: "britmet.co.uk",
      },
    ],
  },
};

export default nextConfig;
