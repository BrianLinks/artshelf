import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { ApiError } from "./lib/client";
import type { Role, User } from "./lib/types";

interface AuthValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: { email: string; password: string; displayName: string; role: Extract<Role, "client" | "artist"> }) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ user: User }>("/auth/me")
      .then((response) => {
        if (!cancelled) setUser(response.user);
      })
      .catch((error: unknown) => {
        // 401 simply means nobody is signed in.
        if (!(error instanceof ApiError && error.status === 401)) console.error(error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.post<{ user: User }>("/auth/login", { email, password });
    setUser(response.user);
    return response.user;
  }, []);

  const register = useCallback(async (input: { email: string; password: string; displayName: string; role: "client" | "artist" }) => {
    const response = await api.post<{ user: User }>("/auth/register", input);
    setUser(response.user);
    return response.user;
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, register, logout }), [user, loading, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

/** Roles that can hold a wallet and buy. */
export function canTransact(user: User | null): boolean {
  return user !== null && (user.role === "client" || user.role === "artist");
}
