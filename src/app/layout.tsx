import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { TermlyCMP } from "@/components/TermlyCMP";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://assess.cyrvana.com"),
  title: {
    default: "CYRVANA Assessments",
    template: "%s | CYRVANA",
  },
  description:
    "Cybersecurity readiness assessments and lead-generation quizzes from CYRVANA.",
  openGraph: {
    type: "website",
    siteName: "CYRVANA Assessments",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <TermlyCMP />
        {children}
      </body>
    </html>
  );
}
