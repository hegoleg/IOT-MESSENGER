import { useEffect, useRef, useState, type JSX } from "react";
import jsQR from "jsqr";
import { CameraOff, X } from "lucide-react";

export interface QrScannerProps {
  onResult(text: string): void;
  onClose(): void;
}

/** Detection runs on a downscaled frame: much cheaper on phones, still reliable. */
const MAX_SCAN_WIDTH = 640;

export default function QrScanner({ onResult, onClose }: QrScannerProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const onResultRef = useRef(onResult);
  const onCloseRef = useRef(onClose);

  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Escape closes the scanner.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const context = canvas.getContext("2d", { willReadFrequently: true });

    let stream: MediaStream | null = null;
    let frameId = 0;
    let looping = false;
    let stopped = false;

    const stopCamera = () => {
      if (stopped) return;
      stopped = true;
      looping = false;
      if (frameId !== 0) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
      video.pause();
      video.srcObject = null;
    };

    const scanFrame = () => {
      if (stopped) return;
      frameId = requestAnimationFrame(scanFrame);

      if (!context) return;
      if (video.readyState < 2) return;

      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width < 2 || height < 2) return;

      const scale = Math.min(1, MAX_SCAN_WIDTH / width);
      const scanWidth = Math.max(1, Math.round(width * scale));
      const scanHeight = Math.max(1, Math.round(height * scale));

      if (canvas.width !== scanWidth || canvas.height !== scanHeight) {
        canvas.width = scanWidth;
        canvas.height = scanHeight;
      }

      context.drawImage(video, 0, 0, scanWidth, scanHeight);
      const image = context.getImageData(0, 0, scanWidth, scanHeight);
      const code = jsQR(image.data, image.width, image.height, {
        inversionAttempts: "dontInvert",
      });

      if (code) {
        const text = code.data.trim();
        if (text) {
          stopCamera();
          onResultRef.current(text);
        }
      }
    };

    const startLoop = () => {
      if (stopped || looping) return;
      looping = true;
      setReady(true);
      frameId = requestAnimationFrame(scanFrame);
    };

    video.addEventListener("loadeddata", startLoop);
    video.addEventListener("playing", startLoop);

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
      setError(true);
      return () => {
        video.removeEventListener("loadeddata", startLoop);
        video.removeEventListener("playing", startLoop);
        stopCamera();
      };
    }

    mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((mediaStream) => {
        if (stopped) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = mediaStream;
        video.muted = true;
        video.srcObject = mediaStream;
        const playResult = video.play();
        if (playResult) {
          playResult.catch(() => {
            if (!stopped) setError(true);
          });
        }
      })
      .catch(() => {
        if (stopped) return;
        setError(true);
        stopCamera();
      });

    return () => {
      video.removeEventListener("loadeddata", startLoop);
      video.removeEventListener("playing", startLoop);
      stopCamera();
    };
  }, []);

  return (
    <div className="animate-fade-in fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="safe-top flex items-center justify-between gap-3 px-4 pb-3">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white">
          Сканирование QR
        </p>
        <button
          type="button"
          onClick={() => onCloseRef.current()}
          aria-label="Закрыть сканер"
          className="flex size-10 items-center justify-center border border-white/20 bg-white/5 text-white transition hover:border-white/40 hover:bg-white/10"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-label="Изображение с камеры"
          className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${
            error ? "opacity-0" : "opacity-100"
          }`}
        />

        {!error && (
          <div className="relative z-10 aspect-square w-full max-w-[17rem]">
            <div className="absolute inset-0 border border-white/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" />
            <span className="absolute -left-0.5 -top-0.5 size-9 border-l-4 border-t-4 border-accent-400" />
            <span className="absolute -right-0.5 -top-0.5 size-9 border-r-4 border-t-4 border-accent-400" />
            <span className="absolute -bottom-0.5 -left-0.5 size-9 border-b-4 border-l-4 border-accent-400" />
            <span className="absolute -bottom-0.5 -right-0.5 size-9 border-b-4 border-r-4 border-accent-400" />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="flex size-12 items-center justify-center border border-white/10 bg-ink-850 text-zinc-500">
              <CameraOff className="size-6" strokeWidth={1.6} />
            </div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-200">
              Камера недоступна
            </p>
            <p className="max-w-[17rem] text-xs leading-relaxed text-zinc-500">
              Разрешите доступ к камере в настройках браузера и попробуйте снова.
            </p>
          </div>
        )}
      </div>

      <div className="safe-bottom shrink-0 space-y-3 px-6 pb-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-zinc-300">
          {error ? "Введите токен вручную" : ready ? "Наведите камеру на QR-код" : "Запуск камеры…"}
        </p>
        <button
          type="button"
          onClick={() => onCloseRef.current()}
          className="min-h-11 w-full border border-white/20 bg-white/5 px-4 font-mono text-[10px] uppercase tracking-[0.1em] text-white transition hover:bg-white/10"
        >
          Закрыть
        </button>
      </div>

      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
    </div>
  );
}
