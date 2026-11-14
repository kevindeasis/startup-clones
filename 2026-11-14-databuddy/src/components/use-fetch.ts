"use client";

import { useCallback, useEffect, useState } from "react";

type State<T> = { url: string; data?: T; error?: string };

/** GET a JSON endpoint; refetches when `url` changes, every `intervalMs`, or when `reload()` is called. */
export function useFetch<T>(url: string, intervalMs?: number) {
  const [state, setState] = useState<State<T>>({ url: "" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(url)
        .then(async (res) => {
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? res.statusText);
          if (!cancelled) setState({ url, data: body as T });
        })
        .catch((e: Error) => {
          if (!cancelled) setState({ url, error: e.message });
        });
    load();
    const timer = intervalMs ? setInterval(load, intervalMs) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [url, intervalMs, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = state.url === url ? state : { url };
  return { data: current.data, error: current.error, loading: state.url !== url, reload };
}
