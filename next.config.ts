import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Static export: the app is fully client-side, so ONE build (out/) serves
  // both the hosted web app (Vercel) and the Tauri desktop shell.
  output: "export",
};

export default nextConfig;
