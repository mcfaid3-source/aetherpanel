import React, { useEffect, useState } from 'react';
import { useTheme } from '../lib/ThemeContext';

interface GlobalBackgroundProps {
  isPanel?: boolean;
  isAdminSection?: boolean;
}

const BLUR_CLASS_MAP: Record<string, string> = {
  none: 'blur-none',
  '4px': 'blur-[4px]',
  '8px': 'blur-[8px]',
  '12px': 'blur-[12px]',
  '20px': 'blur-[20px]',
  '32px': 'blur-[32px]'
};

const SCRIM_OPACITY_MAP: Record<number, string> = {
  0: 'bg-[#09090b]/0',
  5: 'bg-[#09090b]/5',
  10: 'bg-[#09090b]/10',
  15: 'bg-[#09090b]/15',
  20: 'bg-[#09090b]/20',
  25: 'bg-[#09090b]/25',
  30: 'bg-[#09090b]/30',
  35: 'bg-[#09090b]/35',
  40: 'bg-[#09090b]/40',
  45: 'bg-[#09090b]/45',
  50: 'bg-[#09090b]/50',
  55: 'bg-[#09090b]/55',
  60: 'bg-[#09090b]/60',
  65: 'bg-[#09090b]/65',
  70: 'bg-[#09090b]/70',
  75: 'bg-[#09090b]/75',
  80: 'bg-[#09090b]/80',
  85: 'bg-[#09090b]/85',
  90: 'bg-[#09090b]/90',
  95: 'bg-[#09090b]/95'
};

export const GlobalBackground: React.FC<GlobalBackgroundProps> = ({
  isPanel = false,
  isAdminSection = false
}) => {
  const { adminSectionBackground } = useTheme();
  const [imageFailed, setImageFailed] = useState(false);

  const rawUrl = adminSectionBackground.imageUrl?.trim() || '';

  useEffect(() => {
    setImageFailed(false);
  }, [rawUrl]);

  const showAdminWallpaper =
    isPanel &&
    isAdminSection &&
    adminSectionBackground.enabled &&
    rawUrl.length > 0 &&
    !imageFailed;

  const roundedOpacity = Math.min(95, Math.max(0, Math.round((adminSectionBackground.overlayOpacity ?? 75) / 5) * 5));
  const blurClass = BLUR_CLASS_MAP[adminSectionBackground.blur] || 'blur-[8px]';
  const scrimClass = SCRIM_OPACITY_MAP[roundedOpacity] || 'bg-[#09090b]/75';

  return (
    <div
      id="aether-wallpaper-layer"
      aria-hidden="true"
      className="fixed inset-0 z-0 bg-[var(--color-bg)] pointer-events-none select-none overflow-hidden"
    >
      {showAdminWallpaper && (
        <>
          <img
            src={rawUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className={`w-full h-full object-cover scale-105 transition-all duration-300 ${blurClass}`}
          />
          <div className={`absolute inset-0 transition-colors duration-200 ${scrimClass}`} />
          <div className="absolute inset-0 bg-gradient-to-b from-[#09090b]/40 via-transparent to-[#09090b]/80" />
        </>
      )}
    </div>
  );
};
