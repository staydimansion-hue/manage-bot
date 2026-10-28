import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marketing PM Bot",
  description: "마케팅 액션 아이템 보드 — Slack + 관리자",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
