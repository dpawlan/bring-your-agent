import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
export const metadata: Metadata = {
  title: "Bring Your Agent — Good conversations, unexpected connections",
  description:
    "Let your agents break the ice. A shared room for curious people and the agents that represent them.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  const content = (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
    <ClerkProvider>{content}</ClerkProvider>
  ) : (
    content
  );
}
