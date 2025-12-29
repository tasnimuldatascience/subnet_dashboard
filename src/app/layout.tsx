import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Leadpoet Subnet Dashboard",
  description: "Real-time transparency and performance dashboard for Leadpoet on Bittensor Subnet 71.",
  icons: {
    icon: '/icon.png',
  },
  openGraph: {
    siteName: "Leadpoet",
    title: "Leadpoet Subnet Dashboard",
    description: "Real-time dashboard for Bittensor Subnet 71 (Leadpoet).",
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
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}
