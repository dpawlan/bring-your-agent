"use client";
import {
  ClerkLoading,
  Show,
  SignInButton,
  UserButton,
  useUser,
} from "@clerk/nextjs";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
// Inlined at build time. Without a key the layout renders no ClerkProvider, so
// Clerk components must not mount; local runs without Clerk keep working.
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
export function NavAccount() {
  if (!clerkEnabled) return null;
  return (
    <Show when="signed-in">
      <span className="nav-account">
        <UserButton
          appearance={{
            elements: {
              userButtonAvatarBox: {
                width: "var(--account-size)",
                height: "var(--account-size)",
              },
            },
          }}
          fallback={<span className="account-placeholder" />}
        />
      </span>
    </Show>
  );
}
function SignedInAs() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  return (
    <span className="status account-status">
      <i />
      <span>
        Signed in
        {email && (
          <>
            {" "}
            as <b>{email}</b>
          </>
        )}
      </span>
    </span>
  );
}
function HostSignIn({ children }: { children: ReactNode }) {
  return (
    <SignInButton>
      <button className="button primary" type="button">
        {children}
      </button>
    </SignInButton>
  );
}
export function HostAccount() {
  if (!clerkEnabled)
    return (
      <Link className="button" href="/sign-in">
        Host sign-in <ArrowUpRight size={16} />
      </Link>
    );
  return (
    <>
      <Show when="signed-in">
        <SignedInAs />
      </Show>
      <Show when="signed-out">
        <HostSignIn>
          Host sign-in <ArrowUpRight size={16} />
        </HostSignIn>
      </Show>
    </>
  );
}
export function HostGate({ children }: { children: ReactNode }) {
  if (!clerkEnabled) return <>{children}</>;
  return (
    <>
      <ClerkLoading>
        <section className="panel narrow">
          <p className="muted">Checking your sign-in…</p>
        </section>
      </ClerkLoading>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <section className="panel narrow">
          <h2>Sign in to create a meetup.</h2>
          <p className="muted">
            Hosting is free. Rooms you create belong to your account, so only
            you can manage them. Guests never need an account.
          </p>
          <HostSignIn>
            Host sign-in <ArrowRight size={16} />
          </HostSignIn>
        </section>
      </Show>
    </>
  );
}
