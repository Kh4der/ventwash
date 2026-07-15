import type { Metadata } from "next";
import "./globals.css";
import { PHProvider } from "@/components/PostHogProvider";

export const metadata: Metadata = {
  title: "Commercial Kitchen Hood & Exhaust Cleaning | VentWash — NFPA 96",
  description:
    "VentWash provides NFPA 96 compliant commercial kitchen hood cleaning and exhaust system cleaning — canopy, baffle filters, grease duct, rooftop exhaust fan and make-up air, degreased to bare metal. Certified technicians, photo reports, free quotes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=IBM+Plex+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <PHProvider>{children}</PHProvider>
      </body>
    </html>
  );
}
