import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { PwaClient } from "@/components/PwaClient";

// Self-hosted (SIL OFL fonts: Inter, Space Grotesk) so the build never depends on fonts.googleapis.com being reachable.
const inter = localFont({ src: "./fonts/Inter-latin-var.woff2", weight: "100 900", variable: "--font-inter", display: "swap" });
const grotesk = localFont({
  src: [
    { path: "./fonts/SpaceGrotesk-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/SpaceGrotesk-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tryanything — your AI dressing room",
  description: "Try on clothes in real time with your phone camera.",
  robots: { index: false },
  applicationName: "Tryanything",
  appleWebApp: { capable: true, title: "Tryanything", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/icons/192", sizes: "192x192", type: "image/png" }], apple: [{ url: "/icons/apple-180", sizes: "180x180" }] },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0b0d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable}`}>
      <body className="font-sans">
        {children}
        <PwaClient />
      </body>
    </html>
  );
}
