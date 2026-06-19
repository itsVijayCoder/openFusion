import type { Metadata } from "next";
import { Space_Gun, Cal_Sans } from "next/font/google";
import "./globals.css";

const spaceGun = Space_Gun({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-space-gun",
  display: "swap",
});

const calSans = Cal_Sans({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-cal-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Developer Portfolio | Full-Stack Engineer",
  description: "Full-stack developer specializing in React, TypeScript, Node.js, and cloud-native architectures. Building elegant solutions to complex problems.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${spaceGun.variable} ${calSans.variable}`}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
