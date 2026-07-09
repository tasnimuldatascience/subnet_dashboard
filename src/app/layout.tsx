import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

// Display face for headings and every large numeral (platinum design system).
const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Monospace for all data, labels, hashes, eyebrows, and metadata.
const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

// Use NEXT_PUBLIC_SITE_URL when set so OG images resolve to absolute URLs
// in production. Falls back to a sensible default in local dev.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dashboard.leadpoet.com'

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0908",
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Leadpoet · Live Subnet Dashboard',
    template: '%s · Leadpoet',
  },
  description:
    'Real-time fulfillment reporting and FAQ for Leadpoet on Bittensor Subnet 71.',
  applicationName: 'Leadpoet Subnet Dashboard',
  icons: {
    icon: '/icon.png',
    apple: '/icon-64.png',
  },
  openGraph: {
    type: 'website',
    siteName: 'Leadpoet',
    title: 'Leadpoet · Live Subnet Dashboard',
    description:
      'Real-time fulfillment reporting and FAQ for Bittensor Subnet 71.',
    url: SITE_URL,
    images: [
      {
        url: '/icon-64.png',
        width: 512,
        height: 512,
        alt: 'Leadpoet',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'Leadpoet · Live Subnet Dashboard',
    description:
      'Real-time fulfillment reporting and FAQ for Bittensor Subnet 71.',
    images: ['/icon-64.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${ibmPlexMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}
