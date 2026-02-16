import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OnATilt - Crypto Setup Validator",
  description: "Only trade when your setup is valid. Gate perp positions through predefined chart conditions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
