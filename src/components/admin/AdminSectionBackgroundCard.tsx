import React, { useEffect, useRef, useState } from 'react';
import {
  Image as ImageIcon,
  ImageOff,
  Lock,
  RotateCcw,
  Save,
  Loader2,
  Check,
  X,
  Sliders,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import {
  DEFAULT_ADMIN_SECTION_BACKGROUND,
  useTheme,
} from '../../lib/ThemeContext';
import { useToast } from '../../lib/ToastContext';
import { AdminSectionBackgroundSettings } from '../../types';

interface BackgroundPreset {
  id: string;
  label: string;
  subtitle: string;
  url: string;
}

const ADMIN_BACKGROUND_PRESETS: BackgroundPreset[] = [
  {
    id: 'none',
    label: 'Default Obsidian',
    subtitle: 'Solid #09090b canvas',
    url: '',
  },
  {
    id: 'datacenter',
    label: 'Datacenter Rack',
    subtitle: 'Server aisle backdrop',
    url: '/images/hero_datacenter_servers_1791889746971.jpg',
  },
  {
    id: 'bot-runtime',
    label: 'Bot Runtime Nodes',
    subtitle: 'Compute cluster art',
    url: '/images/hero_bot_runtime_1791994187221.jpg',
  },
  {
    id: 'voxel',
    label: 'Voxel Horizon',
    subtitle: 'Landscape environment',
    url: '/images/hero_minecraft_landscape_1791889746896.jpg',
  },
];

const BLUR_OPTIONS: Array<{ value: AdminSectionBackgroundSettings['blur']; label: string }> = [
  { value: 'none', label: 'Sharp (0px)' },
  { value: '4px', label: 'Subtle (4px)' },
  { value: '8px', label: 'Balanced (8px)' },
  { value: '12px', label: 'Soft (12px)' },
  { value: '20px', label: 'Deep (20px)' },
  { value: '32px', label: 'Ultra (32px)' },
];

const BLUR_CLASS_MAP: Record<string, string> = {
  none: 'blur-none',
  '4px': 'blur-[4px]',
  '8px': 'blur-[8px]',
  '12px': 'blur-[12px]',
  '20px': 'blur-[20px]',
  '32px': 'blur-[32px]',
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
  95: 'bg-[#09090b]/95',
};

export const AdminSectionBackgroundCard: React.FC = () => {
  const { user } = useAuth();
  const { adminSectionBackground, setAdminSectionBackground } = useTheme();
  const { toast } = useToast();

  const isStrictAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedState, setSavedState] = useState<AdminSectionBackgroundSettings>(adminSectionBackground);
  const [draft, setDraft] = useState<AdminSectionBackgroundSettings>(adminSectionBackground);
  const [previewError, setPreviewError] = useState(false);

  const savedRef = useRef<AdminSectionBackgroundSettings>(adminSectionBackground);
  const hasSavedChangesRef = useRef(true);

  // Fetch authoritative admin-only background on mount
  useEffect(() => {
    if (!isStrictAdmin) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const res = await apiRequest<AdminSectionBackgroundSettings>('/admin/section-background');
        if (!cancelled && res.success && res.data) {
          const merged: AdminSectionBackgroundSettings = {
            ...DEFAULT_ADMIN_SECTION_BACKGROUND,
            ...res.data,
          };
          hasSavedChangesRef.current = true;
          setSavedState(merged);
          savedRef.current = merged;
          setDraft(merged);
          setAdminSectionBackground(merged);
        }
      } catch {
        // Keep defaults on error
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    // Restore last saved config if unmounted with unsaved draft edits
    return () => {
      cancelled = true;
      if (!hasSavedChangesRef.current) {
        setAdminSectionBackground(savedRef.current);
      }
    };
  }, [isStrictAdmin, setAdminSectionBackground]);

  // Reset image error whenever URL changes
  useEffect(() => {
    setPreviewError(false);
  }, [draft.imageUrl]);

  // Sync live workspace preview after commit (never inside setDraft updater)
  useEffect(() => {
    if (!isStrictAdmin || loading) return;
    setAdminSectionBackground(draft);
  }, [draft, isStrictAdmin, loading, setAdminSectionBackground]);

  const updateDraft = (updater: (prev: AdminSectionBackgroundSettings) => AdminSectionBackgroundSettings) => {
    hasSavedChangesRef.current = false;
    setDraft(updater);
  };

  if (!isStrictAdmin) {
    return null;
  }

  const isDirty =
    draft.enabled !== savedState.enabled ||
    draft.imageUrl.trim() !== savedState.imageUrl.trim() ||
    draft.blur !== savedState.blur ||
    draft.overlayOpacity !== savedState.overlayOpacity ||
    (draft.presetId || '') !== (savedState.presetId || '');

  const handleSelectPreset = (preset: BackgroundPreset) => {
    updateDraft((prev) => ({
      ...prev,
      enabled: preset.id === 'none' ? false : true,
      imageUrl: preset.url,
      presetId: preset.id,
    }));
  };

  const handleClearImage = () => {
    updateDraft((prev) => ({
      ...prev,
      enabled: false,
      imageUrl: '',
      presetId: 'none',
    }));
  };

  const handleRevert = () => {
    hasSavedChangesRef.current = true;
    setDraft(savedState);
    setAdminSectionBackground(savedState);
  };

  const handleSave = async () => {
    const trimmedUrl = draft.imageUrl.trim();
    if (draft.enabled && !trimmedUrl) {
      toast.error('Select a preset or enter a valid image URL before enabling the admin background.');
      return;
    }

    try {
      setSaving(true);
      const payload: AdminSectionBackgroundSettings = {
        enabled: draft.enabled,
        imageUrl: trimmedUrl,
        blur: draft.blur,
        overlayOpacity: draft.overlayOpacity,
        presetId: draft.presetId || (trimmedUrl ? 'custom' : 'none'),
      };

      const res = await apiRequest<AdminSectionBackgroundSettings>('/admin/section-background', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (res.success && res.data) {
        const persisted: AdminSectionBackgroundSettings = {
          ...DEFAULT_ADMIN_SECTION_BACKGROUND,
          ...res.data,
        };
        hasSavedChangesRef.current = true;
        savedRef.current = persisted;
        setSavedState(persisted);
        setDraft(persisted);
        setAdminSectionBackground(persisted);
        toast.success('Admin section background saved.');
      } else {
        toast.error(res.error?.message || 'Failed to save admin section background.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save admin section background.');
    } finally {
      setSaving(false);
    }
  };

  const roundedOpacity = Math.min(
    95,
    Math.max(0, Math.round((draft.overlayOpacity ?? 75) / 5) * 5)
  );
  const blurClass = BLUR_CLASS_MAP[draft.blur] || 'blur-[8px]';
  const scrimClass = SCRIM_OPACITY_MAP[roundedOpacity] || 'bg-[#09090b]/75';
  const hasPreviewImage = draft.enabled && draft.imageUrl.trim().length > 0 && !previewError;

  return (
    <div className="p-5 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-line)] space-y-5">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--color-line)]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-[var(--color-accent)] shrink-0" />
            <h3 className="text-sm font-semibold text-[var(--color-ink)]">
              Admin Section Background
            </h3>
            <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--color-ink-mute)]">
              <Lock className="h-3 w-3" />
              Admins Only
            </span>
          </div>
          <p className="text-xs text-[var(--color-ink-mute)] leading-relaxed">
            Configure a custom wallpaper shown exclusively inside the Admin section for administrators. Public pages and customer views stay untouched.
          </p>
        </div>

        {/* Enable Switch */}
        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
          <span className="text-xs font-medium text-[var(--color-ink-dim)]">
            {draft.enabled ? 'Enabled' : 'Disabled'}
          </span>
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={loading}
            onChange={(e) =>
              updateDraft((prev) => ({
                ...prev,
                enabled: e.target.checked,
                imageUrl:
                  e.target.checked && !prev.imageUrl.trim()
                    ? ADMIN_BACKGROUND_PRESETS[1].url
                    : prev.imageUrl,
                presetId:
                  e.target.checked && !prev.imageUrl.trim()
                    ? ADMIN_BACKGROUND_PRESETS[1].id
                    : prev.presetId,
              }))
            }
            className="h-4 w-4 accent-[var(--color-accent)] cursor-pointer"
          />
        </label>
      </div>

      {loading ? (
        <div className="py-8 flex items-center justify-center gap-2 text-xs text-[var(--color-ink-mute)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent)]" />
          <span>Loading admin background configuration...</span>
        </div>
      ) : (
        <>
          {/* Built-In Presets */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="label">Admin Backdrop Presets</span>
              {isDirty && (
                <span className="text-[11px] font-mono text-[var(--color-warn)]">
                  Unsaved preview active
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {ADMIN_BACKGROUND_PRESETS.map((preset) => {
                const isSelected =
                  preset.id === 'none'
                    ? !draft.enabled || !draft.imageUrl.trim()
                    : draft.enabled && draft.imageUrl.trim() === preset.url;

                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`group text-left rounded-lg border overflow-hidden transition-colors cursor-pointer bg-[var(--color-surface)] ${
                      isSelected
                        ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/40'
                        : 'border-[var(--color-line)] hover:border-[var(--color-ink-mute)]'
                    }`}
                  >
                    <div className="relative h-20 w-full bg-[#09090b] overflow-hidden border-b border-[var(--color-line)]">
                      {preset.url ? (
                        <img
                          src={preset.url}
                          alt={preset.label}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                        />
                      ) : (
                        <div className="w-full h-full bg-[#09090b] flex items-center justify-center text-[11px] font-mono text-[var(--color-ink-mute)]">
                          Default #09090b
                        </div>
                      )}
                      {isSelected && (
                        <span className="absolute top-1.5 right-1.5 h-5 w-5 rounded bg-[var(--color-accent)] text-[#09090b] flex items-center justify-center">
                          <Check className="h-3 w-3 stroke-[3]" />
                        </span>
                      )}
                    </div>
                    <div className="p-2.5">
                      <div className="text-xs font-semibold text-[var(--color-ink)] truncate">
                        {preset.label}
                      </div>
                      <div className="text-[11px] text-[var(--color-ink-mute)] truncate">
                        {preset.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Image URL + FX Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left: URL Input + Blur + Scrim */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="label block">Custom Image or GIF URL</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={draft.imageUrl}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateDraft((prev) => ({
                        ...prev,
                        imageUrl: val,
                        enabled: val.trim().length > 0 ? true : prev.enabled,
                        presetId: 'custom',
                      }));
                    }}
                    placeholder="/images/hero_datacenter_servers_1791889746971.jpg or https://..."
                    className="field flex-1 text-xs font-mono"
                  />
                  {draft.imageUrl && (
                    <button
                      type="button"
                      onClick={handleClearImage}
                      className="btn btn-ghost h-9 px-2.5 text-xs whitespace-nowrap shrink-0 border border-[var(--color-line)]"
                      title="Clear background image"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Clear</span>
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-[var(--color-ink-mute)]">
                  Supports local panel assets (e.g. /images/...) or direct HTTPS PNG/JPG/WebP/GIF URLs.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="label block">Backdrop Blur</label>
                  <select
                    value={draft.blur}
                    onChange={(e) =>
                      updateDraft((prev) => ({
                        ...prev,
                        blur: e.target.value as AdminSectionBackgroundSettings['blur'],
                      }))
                    }
                    className="field w-full text-xs font-mono"
                  >
                    {BLUR_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="label">Dark Scrim Opacity</label>
                    <span className="text-xs font-mono tabular-nums font-semibold text-[var(--color-accent)]">
                      {roundedOpacity}%
                    </span>
                  </div>
                  <div className="h-9 flex items-center px-2.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-line)]">
                    <input
                      type="range"
                      min={0}
                      max={95}
                      step={5}
                      value={roundedOpacity}
                      onChange={(e) =>
                        updateDraft((prev) => ({
                          ...prev,
                          overlayOpacity: parseInt(e.target.value, 10) || 0,
                        }))
                      }
                      className="w-full accent-[var(--color-accent)] cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Right: 16:9 Live Preview Stage */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="label">Admin Canvas Preview</span>
                <span className="text-[11px] font-mono tabular-nums text-[var(--color-ink-mute)]">
                  {draft.enabled && draft.imageUrl.trim()
                    ? `${draft.blur === 'none' ? '0px' : draft.blur} blur · ${roundedOpacity}% scrim`
                    : 'Default obsidian canvas'}
                </span>
              </div>

              <div className="relative aspect-[16/9] w-full rounded-lg overflow-hidden border border-[var(--color-line)] bg-[#09090b]">
                {hasPreviewImage ? (
                  <>
                    <img
                      src={draft.imageUrl.trim()}
                      alt="Admin section background preview"
                      referrerPolicy="no-referrer"
                      onError={() => setPreviewError(true)}
                      className={`absolute inset-0 w-full h-full object-cover scale-105 transition-all duration-200 ${blurClass}`}
                    />
                    <div className={`absolute inset-0 transition-colors duration-200 ${scrimClass}`} />
                  </>
                ) : previewError && draft.imageUrl.trim() ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-4 text-center bg-[#09090b]">
                    <ImageOff className="h-5 w-5 text-[var(--color-err)]" />
                    <p className="text-xs font-medium text-[var(--color-ink)]">
                      Unable to load image URL
                    </p>
                    <p className="text-[11px] font-mono text-[var(--color-ink-mute)] truncate max-w-full">
                      {draft.imageUrl}
                    </p>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-4 text-center bg-[#09090b]">
                    <Sliders className="h-4 w-4 text-[var(--color-ink-mute)]" />
                    <p className="text-xs text-[var(--color-ink-mute)]">
                      Standard dark admin surface active
                    </p>
                  </div>
                )}

                {/* Simulated Admin Card for Contrast Verification */}
                <div className="relative z-10 h-full p-3.5 flex flex-col justify-between pointer-events-none">
                  <div className="flex items-center justify-between text-[10px] font-mono text-zinc-300">
                    <span>/admin/dashboard</span>
                    <span className="text-[var(--color-accent)]">ADMIN ONLY</span>
                  </div>
                  <div className="p-3 rounded-md bg-[var(--color-surface)]/95 border border-[var(--color-line)] max-w-xs space-y-1">
                    <div className="text-xs font-semibold text-[var(--color-ink)]">
                      Admin Overview Card
                    </div>
                    <div className="text-[11px] text-[var(--color-ink-dim)]">
                      Contrast & text legibility sample over your admin background.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[var(--color-line)]">
            <span className="text-[11px] text-[var(--color-ink-mute)]">
              Changes appear immediately in the Admin section; save to persist across sessions.
            </span>

            <div className="flex items-center gap-2 shrink-0">
              {isDirty && (
                <button
                  type="button"
                  onClick={handleRevert}
                  disabled={saving}
                  className="btn btn-ghost text-xs h-9 px-3 whitespace-nowrap shrink-0 border border-[var(--color-line)]"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Revert</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="btn btn-primary text-xs h-9 px-4 whitespace-nowrap shrink-0"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                <span>{saving ? 'Saving...' : 'Save Admin Background'}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
