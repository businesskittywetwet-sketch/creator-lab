"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Loader as Loader2 } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const supabase = createClient();

  return (
    <div className="relative z-10 min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-xl border border-signal/40 bg-signal/10">
            <span className="font-display text-lg font-bold text-signal">V</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-white">Viboro Creator Lab</h1>
          <p className="mt-1 text-sm text-zinc-500">Sign in to your content operations</p>
        </div>

        <form
          className="panel space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const { error } = await supabase.auth.signInWithPassword({ email, password });
              if (error) {
                setError(error.message);
              } else {
                router.push("/overview");
                router.refresh();
              }
            });
          }}
        >
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field"
              placeholder="••••••••"
            />
          </div>
          {error && (
            <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {pending ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-center text-xs text-zinc-500">
            Don&apos;t have an account?{" "}
            <a href="/signup" className="text-signal hover:underline">Sign up</a>
          </p>
        </form>
      </div>
    </div>
  );
}
