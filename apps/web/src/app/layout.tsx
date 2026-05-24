import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoxLink Voice",
  description: "Multi-tenant AI voice assistant platform"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
