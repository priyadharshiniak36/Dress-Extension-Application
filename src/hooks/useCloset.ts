"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CUSTOM_GARMENT_PROMPT, MAX_CUSTOM_GARMENTS, type Garment } from "@/lib/garments";
import { GarmentImageError, extractFromTransfer, loadImageUrl, normalizeImage } from "@/lib/garment-image";
import { track } from "@/lib/analytics";

export type AddSource = "upload" | "camera" | "drop" | "paste" | "link";

/** The user's own garments for this visit. Held in memory only; object URLs are revoked on removal/unmount. */
export function useCloset() {
  const [custom, setCustom] = useState<Garment[]>([]);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef(new Map<string, string>());
  const counter = useRef(0);

  // Errors are transient hints; clear them after a few seconds.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    const map = urls.current;
    return () => map.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const addBlob = useCallback(async (input: Blob, source: AddSource) => {
    const blob = await normalizeImage(input);
    const id = `mine-${Date.now().toString(36)}-${counter.current++}`;
    const image = URL.createObjectURL(blob);
    urls.current.set(id, image);
    const garment: Garment = { id, name: "My garment", image, prompt: CUSTOM_GARMENT_PROMPT, custom: { blob } };
    setCustom((prev) => {
      const next = [...prev, garment];
      while (next.length > MAX_CUSTOM_GARMENTS) {
        const old = next.shift()!;
        const u = urls.current.get(old.id);
        if (u) URL.revokeObjectURL(u);
        urls.current.delete(old.id);
      }
      return next;
    });
    setLastAdded(id);
    track("garment_added", { source });
  }, []);

  /** Runs one add flow with shared busy/error handling. */
  const run = useCallback(async (source: AddSource, task: () => Promise<Blob>) => {
    setBusy(true);
    setError(null);
    try {
      await addBlob(await task(), source);
    } catch (err) {
      const msg = err instanceof GarmentImageError ? err.message : "Couldn't add that image. Try another one.";
      setError(msg);
      track("garment_add_failed", { source, message: msg.slice(0, 120) });
    } finally {
      setBusy(false);
    }
  }, [addBlob]);

  const addFile = useCallback((file: File, source: AddSource = "upload") => run(source, async () => file), [run]);
  const addUrl = useCallback((url: string, source: AddSource = "link") => run(source, () => loadImageUrl(url)), [run]);

  const addFromTransfer = useCallback(
    (dt: DataTransfer | null, source: AddSource) => {
      const found = extractFromTransfer(dt);
      if (!found) {
        setError("Drop an image or an image link.");
        return;
      }
      void ("file" in found ? addFile(found.file, source) : addUrl(found.url, source));
    },
    [addFile, addUrl],
  );

  const remove = useCallback((id: string) => {
    const u = urls.current.get(id);
    if (u) URL.revokeObjectURL(u);
    urls.current.delete(id);
    setCustom((prev) => prev.filter((g) => g.id !== id));
  }, []);

  return { custom, lastAdded, busy, error, clearError: () => setError(null), addFile, addUrl, addFromTransfer, remove };
}
