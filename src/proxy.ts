import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
export default process.env.CLERK_SECRET_KEY
  ? clerkMiddleware()
  : () => NextResponse.next();
export const config = {
  matcher: ["/host/:path*", "/sign-in/:path*", "/api/e/:event/:op"],
};
