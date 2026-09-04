import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-space" });
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono" });

export const metadata: Metadata = {
  title: "Viboro Creator Lab — AI Content Operations",
  description:
    "Viboro Creator Lab — autonomous AI entertainment content platform: discovery, research, scripting, production and publishing operations.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${space.variable} ${jbmono.variable}`}
    >
      <body className="bg-ink font-sans text-zinc-300 antialiased">
        {children}
      </body>
    </html>
  );
}
