import { authClient } from "@repo/auth/client";
import { ArrowRight, Sparkles } from "lucide-react";
import { useCallback, useState, type SubmitEvent } from "react";
import { useNavigate } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";

type AuthMode = "login" | "signup";

export function meta() {
  return [
    { title: "Squee Online" },
    {
      name: "description",
      content: "Create an account or sign in to Squee Online.",
    },
  ];
}

export function AuthForm() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>("login");
  const [error, setError] = useState<string>();
  const [isPending, setIsPending] = useState(false);
  const isSignup = mode === "signup";

  const selectLogin = useCallback(() => {
    setMode("login");
    setError(undefined);
  }, []);

  const selectSignup = useCallback(() => {
    setMode("signup");
    setError(undefined);
  }, []);

  const handleSubmit = useCallback(
    async (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(undefined);
      setIsPending(true);

      const formData = new FormData(event.currentTarget);
      const emailValue = formData.get("email");
      const nameValue = formData.get("name");
      const passwordValue = formData.get("password");
      const email = typeof emailValue === "string" ? emailValue : "";
      const name = typeof nameValue === "string" ? nameValue : "";
      const password = typeof passwordValue === "string" ? passwordValue : "";

      try {
        const result = isSignup
          ? await authClient.signUp.email({ email, name, password })
          : await authClient.signIn.email({ email, password });

        if (result.error) {
          setError(result.error.message ?? "Authentication failed. Please try again.");
          return;
        }

        await navigate("/dashboard", { replace: true });
      } catch {
        setError("Unable to reach the authentication service. Please try again.");
      } finally {
        setIsPending(false);
      }
    },
    [isSignup, navigate],
  );

  return (
    <Card className="w-full max-w-md shadow-xl shadow-primary/5">
      <CardHeader className="gap-3">
        <div className="bg-muted grid grid-cols-2 rounded-lg p-1" aria-label="Authentication mode">
          <Button
            type="button"
            variant={mode === "login" ? "default" : "ghost"}
            aria-pressed={mode === "login"}
            onClick={selectLogin}
          >
            Log in
          </Button>
          <Button
            type="button"
            variant={mode === "signup" ? "default" : "ghost"}
            aria-pressed={mode === "signup"}
            onClick={selectSignup}
          >
            Sign up
          </Button>
        </div>
        <div className="pt-2">
          <CardTitle>
            <h2 className="text-2xl font-bold">
              {isSignup ? "Create your account" : "Welcome back"}
            </h2>
          </CardTitle>
          <CardDescription className="mt-1">
            {isSignup
              ? "Enter your details to get started."
              : "Enter your credentials to continue."}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            {isSignup ? (
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input id="name" name="name" autoComplete="name" placeholder="Your name" required />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                minLength={8}
                maxLength={128}
                required
              />
            </Field>
            <FieldError>{error}</FieldError>
            <Button className="w-full" size="lg" type="submit" disabled={isPending}>
              {isPending ? "Please wait…" : isSignup ? "Create account" : "Log in"}
              {!isPending ? <ArrowRight data-icon="inline-end" /> : null}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  return (
    <main className="relative isolate min-h-screen overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_15%_15%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent_32%),radial-gradient(circle_at_85%_80%,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_28%)]" />
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-16 px-6 py-16 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
        <section>
          <p className="text-primary flex items-center gap-2 text-sm font-bold uppercase tracking-[0.24em]">
            <Sparkles className="size-4" aria-hidden="true" />
            Squee Online
          </p>
          <h1 className="mt-6 max-w-3xl text-5xl font-black tracking-[-0.05em] text-balance sm:text-7xl">
            Semantic Search Made Easy
          </h1>
          <p className="text-muted-foreground mt-6 max-w-xl text-lg leading-8">
            All in one solution for semantic search on PDF and text files
          </p>
        </section>
        <section className="flex justify-center lg:justify-end" aria-label="Account access">
          <AuthForm />
        </section>
      </div>
    </main>
  );
}
