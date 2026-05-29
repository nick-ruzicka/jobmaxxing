import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClientProviders } from "@/components/ClientProviders";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "JobOps — Pipeline Dashboard",
  description: "Job search pipeline dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="h-full" style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
        {/* ClientProviders wraps children in ChatProvider and mounts the
            GlobalChatPanel — the agent chat now follows the user across
            every route (AI feature audit Step 1). Cmd+K opens it from any
            page. See dashboard-web/components/ClientProviders.tsx. */}
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
