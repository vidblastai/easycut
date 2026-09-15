import { SignIn } from '@clerk/nextjs';

/** Clerk's hosted form, on our own background. */
export default function Page() {
  return (
    <main className="grid min-h-screen place-items-center bg-ink p-6">
      <SignIn appearance={{ variables: { colorPrimary: '#9B7BFF', colorBackground: '#19191F' } }} />
    </main>
  );
}
