import { useCallback, useEffect, useRef, useState } from "react";

/** Fetch now and then every `ms` (pass 0 to stop). Returns latest data, error and a manual refresh. */
export function usePolling<T>(fn: () => Promise<T>, ms: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refresh = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (!ms) return;
    const t = setInterval(refresh, ms);
    return () => clearInterval(t);
  }, [ms, refresh]);

  return { data, error, refresh, setData };
}
