import { SignIn } from "@clerk/nextjs";
export default function Page() {
  return (
    <main className="center">
      {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
        <SignIn fallbackRedirectUrl="/host" signUpFallbackRedirectUrl="/host" />
      ) : (
        <div className="panel">
          <h1>Host sign-in is being connected.</h1>
          <p>
            The authentication provider still needs account setup. Guest
            accounts will not require Vercel sign-in.
          </p>
          <a href="/">Back to home</a>
        </div>
      )}
    </main>
  );
}
