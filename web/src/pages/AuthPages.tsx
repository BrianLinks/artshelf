import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { ErrorNotice } from "../components/Notice";
import { navigate } from "../hooks";
import { href } from "../lib/router";

function destination(query: URLSearchParams): string {
  const next = query.get("next") ?? "";
  // Only in-app paths; the hash router cannot leave the site, but keep the check explicit.
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function LoginPage({ query }: { query: URLSearchParams }) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await login(email, password);
      navigate(destination(query));
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel narrow" onSubmit={(event) => void submit(event)}>
      <h1>Log in</h1>
      <ErrorNotice error={error} />
      <label>
        Email
        <input type="email" value={email} autoComplete="email" required onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label>
        Password
        <input type="password" value={password} autoComplete="current-password" required onChange={(event) => setPassword(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        Log in
      </button>
      <p className="muted">
        New here? <a href={href("/register")}>Create an account</a>
      </p>
    </form>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"client" | "artist">("client");
  const [error, setError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await register({ email, password, displayName, role });
      navigate("/");
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel narrow" onSubmit={(event) => void submit(event)}>
      <h1>Create an account</h1>
      <ErrorNotice error={error} />
      <label>
        Display name
        <input value={displayName} maxLength={80} required onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <label>
        Email
        <input type="email" value={email} autoComplete="email" required onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label>
        Password (at least 12 characters)
        <input type="password" value={password} minLength={12} autoComplete="new-password" required onChange={(event) => setPassword(event.target.value)} />
      </label>
      <fieldset>
        <legend>I want to</legend>
        <label className="inline">
          <input type="radio" name="role" checked={role === "client"} onChange={() => setRole("client")} /> Buy artwork and commission artists
        </label>
        <label className="inline">
          <input type="radio" name="role" checked={role === "artist"} onChange={() => setRole("artist")} /> Sell my art and take commissions
        </label>
      </fieldset>
      <button type="submit" disabled={busy}>
        Register
      </button>
      <p className="muted">
        Already registered? <a href={href("/login")}>Log in</a>
      </p>
    </form>
  );
}
