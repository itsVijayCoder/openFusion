import type { Metadata } from "next";
import { Geist, Geist_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AppShell } from "@/features/shell/app-shell";
import { ThemeProvider } from "@/features/theme/theme-provider";

const ibmPlexSans = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

const themeScript = `(function(){try{var t=localStorage.getItem("fusion-harness:theme")??"dark";if(t==="dark"){document.documentElement.classList.add("dark");}}catch(e){document.documentElement.classList.add("dark");}})();`;

export const metadata: Metadata = {
	title: "Fusion Harness",
	description: "Internal multi-model coding and reasoning platform.",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" className={cn("font-sans", ibmPlexSans.variable)} suppressHydrationWarning>
			<head>
				<link rel="icon" href="/favicon.svg" type="image/svg+xml"></link>
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
			</head>
			<body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
				<ThemeProvider>
					<AppShell>{children}</AppShell>
				</ThemeProvider>
			</body>
		</html>
	);
}
