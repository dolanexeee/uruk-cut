import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "URUK Cut — browser video editor",
  description:
    "Uruk Cut is a clean-room, open-source short-form video editor that runs entirely in your browser.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e0e11",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body className="bg-[#0e0e11] text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
