import { useEffect, useRef, useState } from "react";
import { FileWarning, LoaderCircle } from "lucide-react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

type PdfViewerProps = { dataUrl: string; title: string; zoom: number; onPages?: (pages: number) => void };

const decodeDataUrl = (value: string) => {
  const binary = atob(value.split(",", 2)[1] || "");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export default function PdfViewer({ dataUrl, title, zoom, onPages }: PdfViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const host = hostRef.current;
      if (!host) return;
      host.replaceChildren();
      setState("loading");
      try {
        const pdf = await getDocument({ data: decodeDataUrl(dataUrl) }).promise;
        if (cancelled) return;
        onPages?.(pdf.numPages);
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          if (cancelled) return;
          const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale: zoom * 1.18 });
          const canvas = window.document.createElement("canvas");
          canvas.width = Math.floor(viewport.width * pixelRatio);
          canvas.height = Math.floor(viewport.height * pixelRatio);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          canvas.setAttribute("aria-label", `${title}, page ${pageNumber}`);
          host.append(canvas);
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("Canvas is unavailable");
          await page.render({ canvas, canvasContext: context, viewport, transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0] }).promise;
        }
        if (!cancelled) setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    };
    render();
    return () => { cancelled = true; };
  }, [dataUrl, title, zoom]);

  return <div className="workspace-pdf-viewer">
    {state === "loading" && <div className="pdf-state"><LoaderCircle className="spin" /><span>Rendering PDF…</span></div>}
    {state === "error" && <div className="pdf-state error"><FileWarning /><b>PDF preview unavailable</b><span>You can still download the original file.</span></div>}
    <div ref={hostRef} className="pdf-pages" aria-busy={state === "loading"} />
  </div>;
}
