import type { Metadata } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

const notoSansThai = Noto_Sans_Thai({
  variable: "--font-noto-sans-thai",
  subsets: ["thai", "latin"],
});

export const metadata: Metadata = {
  title: "Thai AI Paper Feed",
  description: "สรุปเปเปอร์ AI ภาษาไทย อ่านเล่นเจอของว้าว",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`${notoSansThai.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col overflow-x-hidden bg-zinc-50 font-sans">
        {children}
      </body>
    </html>
  );
}
