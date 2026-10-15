import { useEffect, useState } from "react";
import { getHealth } from "../services/api";

export function useApiHealth() {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let cancelled = false;
    let controller;
    async function check() {
      if (!navigator.onLine) { setStatus("down"); return; }
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const data = await getHealth(request.signal);
        if (!cancelled && !request.signal.aborted) setStatus(data?.success ? "live" : "down");
      } catch {
        if (!cancelled && !request.signal.aborted) setStatus("down");
      }
    }
    const offline = () => { controller?.abort(); setStatus("down"); };
    check();
    const interval = window.setInterval(check, 60_000);
    window.addEventListener("online", check);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return status;
}
