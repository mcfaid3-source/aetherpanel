import React, { useState, useEffect } from 'react';
import {
  Image as ImageIcon,
  ImageOff,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Layers,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';

interface HeroWallpaperPreviewProps {
  urls: string[];
  slideDelaySeconds: number;
  headlinePrefix?: string;
  headlineAccent?: string;
  description?: string;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
}

export const HeroWallpaperPreview: React.FC<HeroWallpaperPreviewProps> = ({
  urls,
  slideDelaySeconds,
  headlinePrefix = 'Powerful infrastructure for',
  headlineAccent = 'your next server.',
  description = 'Deploy high-performance Minecraft servers and 24/7 background bots with instant automated setup, enterprise NVMe storage, and DDoS protection.',
  selectedIndex,
  onSelectIndex,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [showOverlay, setShowOverlay] = useState<boolean>(true);
  const [loadStatus, setLoadStatus] = useState<Record<string, 'loading' | 'loaded' | 'error'>>({});

  const total = urls.length;
  const safeIndex = total > 0 ? Math.min(Math.max(selectedIndex, 0), total - 1) : 0;
  const activeUrl = total > 0 ? urls[safeIndex] : '';
  const activeStatus = activeUrl ? (loadStatus[activeUrl] || 'loading') : 'error';

  // Keep selectedIndex clamped when URL list changes
  useEffect(() => {
    if (total > 0 && selectedIndex >= total) {
      onSelectIndex(total - 1);
    } else if (total === 0 && selectedIndex !== 0) {
      onSelectIndex(0);
    }
  }, [total, selectedIndex, onSelectIndex]);

  // Reset status to loading for newly added URLs
  useEffect(() => {
    if (!activeUrl) return;
    setLoadStatus((prev) => {
      if (prev[activeUrl]) return prev;
      return { ...prev, [activeUrl]: 'loading' };
    });
  }, [activeUrl]);

  // Optional live slideshow preview loop respecting reduced motion
  useEffect(() => {
    if (!isPlaying || total <= 1) return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const delayMs = Math.max(1500, (Number(slideDelaySeconds) || 5.5) * 1000);
    const timer = setInterval(() => {
      onSelectIndex((safeIndex + 1) % total);
    }, delayMs);

    return () => clearInterval(timer);
  }, [isPlaying, total, slideDelaySeconds, safeIndex, onSelectIndex]);

  const handlePrev = () => {
    if (total <= 1) return;
    setIsPlaying(false);
    onSelectIndex((safeIndex - 1 + total) % total);
  };

  const handleNext = () => {
    if (total <= 1) return;
    setIsPlaying(false);
    onSelectIndex((safeIndex + 1) % total);
  };

  const handleThumbClick = (idx: number) => {
    setIsPlaying(false);
    onSelectIndex(idx);
  };

  if (total === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-8 flex flex-col items-center justify-center text-center gap-2.5 min-h-[220px]">
        <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500">
          <ImageIcon className="w-5 h-5" />
        </div>
        <div className="space-y-1 max-w-md">
          <p className="text-xs font-semibold text-zinc-200">
            No hero wallpaper URLs configured
          </p>
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Paste one or more image paths or HTTPS URLs above, or click Load Default Wallpapers to preview the active hero backdrop.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-2 border-t border-zinc-800/80">
      {/* Preview Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-zinc-200">Active Wallpaper Preview</span>
          <span className="text-zinc-600" aria-hidden="true">/</span>
          <span className="font-mono tabular-nums text-amber-400">
            Slide {safeIndex + 1} of {total}
          </span>
          {activeStatus === 'loaded' && (
            <>
              <span className="text-zinc-600" aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                <span>Ready</span>
              </span>
            </>
          )}
          {activeStatus === 'loading' && (
            <>
              <span className="text-zinc-600" aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                <span>Loading</span>
              </span>
            </>
          )}
          {activeStatus === 'error' && (
            <>
              <span className="text-zinc-600" aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-rose-400">
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span>Load failed</span>
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowOverlay((prev) => !prev)}
            className={`h-8 px-2.5 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              showOverlay
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800'
            }`}
            title="Toggle hero vignette and headline contrast preview"
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span>{showOverlay ? 'Hero Scrim On' : 'Raw Image'}</span>
          </button>

          {total > 1 && (
            <>
              <button
                type="button"
                onClick={() => setIsPlaying((prev) => !prev)}
                className={`h-8 px-2.5 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isPlaying
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800'
                }`}
                title={isPlaying ? 'Pause slideshow preview' : `Auto-cycle every ${slideDelaySeconds}s`}
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5 shrink-0" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 shrink-0" />
                    <span>Preview Cycle</span>
                  </>
                )}
              </button>

              <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden shrink-0">
                <button
                  type="button"
                  onClick={handlePrev}
                  className="h-8 w-8 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                  aria-label="Previous wallpaper"
                  title="Previous wallpaper"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-zinc-800" />
                <button
                  type="button"
                  onClick={handleNext}
                  className="h-8 w-8 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                  aria-label="Next wallpaper"
                  title="Next wallpaper"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main 16:9 Visual Image Preview Stage */}
      <div className="relative w-full aspect-[16/9] max-h-[340px] rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950">
        {urls.map((url, idx) => {
          const isCurrent = idx === safeIndex;
          const status = loadStatus[url] || 'loading';

          if (status === 'error') {
            if (!isCurrent) return null;
            return (
              <div
                key={`${url}-${idx}`}
                className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-6 text-center bg-gradient-to-br from-zinc-900 via-zinc-950 to-black"
              >
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
                  <ImageOff className="w-5 h-5" />
                </div>
                <div className="space-y-1 max-w-lg">
                  <p className="text-xs font-semibold text-zinc-200">
                    Unable to load wallpaper #{idx + 1}
                  </p>
                  <p className="text-[11px] font-mono text-zinc-400 break-all">
                    {url}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Verify the local asset path or HTTPS image URL is accessible.
                  </p>
                </div>
              </div>
            );
          }

          return (
            <img
              key={`${url}-${idx}`}
              src={url}
              alt={`Active hero wallpaper ${idx + 1}`}
              referrerPolicy="no-referrer"
              onLoad={() =>
                setLoadStatus((prev) =>
                  prev[url] === 'loaded' ? prev : { ...prev, [url]: 'loaded' }
                )
              }
              onError={() =>
                setLoadStatus((prev) =>
                  prev[url] === 'error' ? prev : { ...prev, [url]: 'error' }
                )
              }
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
                isCurrent ? 'opacity-100 z-0' : 'opacity-0 -z-10 pointer-events-none'
              }`}
            />
          );
        })}

        {/* Hero Dark Vignette & Copy Readability Preview */}
        {showOverlay && activeStatus !== 'error' && (
          <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-end p-5 sm:p-7 bg-gradient-to-r from-[#09090b]/90 via-[#09090b]/55 to-[#09090b]/25">
            <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#09090b]/90 to-transparent" />
            <div className="relative max-w-lg space-y-1.5">
              <p className="text-lg sm:text-2xl font-bold text-white leading-tight tracking-tight">
                {headlinePrefix}{' '}
                <span className="text-amber-400">{headlineAccent}</span>
              </p>
              {description && (
                <p className="text-[11px] sm:text-xs text-zinc-300 line-clamp-2 leading-relaxed">
                  {description}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Active Source URL Readout + Clickable Thumbnail Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-mono text-zinc-400 truncate" title={activeUrl}>
            <span className="text-zinc-500">Source: </span>
            <span className="text-zinc-200">{activeUrl}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 shrink-0">
          {urls.map((url, idx) => {
            const isSelected = idx === safeIndex;
            const status = loadStatus[url];
            return (
              <button
                key={`${url}-thumb-${idx}`}
                type="button"
                onClick={() => handleThumbClick(idx)}
                className={`relative h-11 w-20 rounded-lg overflow-hidden border transition-all shrink-0 cursor-pointer bg-zinc-950 ${
                  isSelected
                    ? 'border-amber-500 ring-1 ring-amber-500/40'
                    : 'border-zinc-800 opacity-70 hover:opacity-100 hover:border-zinc-600'
                }`}
                title={`Preview wallpaper #${idx + 1}: ${url}`}
                aria-label={`Select wallpaper ${idx + 1}`}
                aria-pressed={isSelected}
              >
                {status === 'error' ? (
                  <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-rose-400">
                    <ImageOff className="w-3.5 h-3.5" />
                  </div>
                ) : (
                  <img
                    src={url}
                    alt={`Wallpaper thumbnail ${idx + 1}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                    onError={() =>
                      setLoadStatus((prev) =>
                        prev[url] === 'error' ? prev : { ...prev, [url]: 'error' }
                      )
                    }
                  />
                )}
                <span
                  className={`absolute bottom-0.5 right-0.5 px-1 rounded text-[9px] font-mono tabular-nums ${
                    isSelected
                      ? 'bg-amber-500 text-zinc-950 font-bold'
                      : 'bg-black/80 text-zinc-300'
                  }`}
                >
                  {String(idx + 1).padStart(2, '0')}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
