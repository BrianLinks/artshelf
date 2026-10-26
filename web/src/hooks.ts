import { useCallback, useEffect, useMemo, useState } from "react";
import { parseHash, type Location } from "./lib/router";

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** Runs `load` on mount and whenever `deps` change, ignoring answers that arrive after the page moved on. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().then(
      (value) => {
        if (cancelled) return;
        setData(value);
        setError(undefined);
        setLoading(false);
      },
      (failure: unknown) => {
        if (cancelled) return;
        setError(failure);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, error, loading, reload };
}

export function useLocation(): Location {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = (): void => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return useMemo(() => parseHash(hash), [hash]);
}

export function navigate(to: string): void {
  window.location.hash = to.startsWith("#") ? to.slice(1) : to;
}

/** Runs an action, remembers its error, and calls `onChanged` when it succeeds. */
export function useAction(onChanged: () => void): { run: (action: () => Promise<unknown>) => Promise<void>; error: unknown; busy: boolean } {
  const [error, setError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onChanged();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return { run, error, busy };
}
