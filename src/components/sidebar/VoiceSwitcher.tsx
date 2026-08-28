import {
  IconChevronDown,
  IconCheck,
  IconPlayerPlay,
  IconPlayerStop,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { cn } from "../../lib/utils";
import { TTS_PROVIDER_LABELS, type TtsProviderId, type TtsSetupState, type TtsVoice } from "../../types/tts";
import { VoiceAvatar } from "./VoiceAvatar";

type VoiceSwitcherProps = {
  ttsState: TtsSetupState;
  onSelectVoice: (provider: TtsProviderId, voiceId: string) => void;
  onOpenSettings: () => void;
};

function matchesQuery(voice: TtsVoice, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = `${voice.label} ${voice.locale ?? ""}`.toLowerCase();
  return haystack.includes(query);
}

export function VoiceSwitcher({ ttsState, onSelectVoice, onOpenSettings }: VoiceSwitcherProps) {
  const [query, setQuery] = useState("");
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const setup = ttsState.status === "loaded" ? ttsState.setup : undefined;
  const currentSettings = setup?.settings;
  const currentProvider = setup?.providers.find(
    (provider) => provider.id === currentSettings?.provider,
  );
  const currentVoice = currentProvider?.voices.find(
    (voice) => voice.id === currentSettings?.voiceId,
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredProviders = useMemo(() => {
    if (!setup) {
      return [];
    }
    return setup.providers
      .map((provider) => ({
        provider,
        voices: provider.voices.filter((voice) => matchesQuery(voice, normalizedQuery)),
      }))
      .filter(({ voices }) => voices.length > 0);
  }, [setup, normalizedQuery]);

  function togglePreview(voice: TtsVoice) {
    if (!voice.previewUrl) {
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (playingVoiceId === voice.id) {
      audio.pause();
      audio.currentTime = 0;
      setPlayingVoiceId(null);
      return;
    }
    audio.src = voice.previewUrl;
    void audio.play();
    setPlayingVoiceId(voice.id);
  }

  function stopSearchKeyPropagation(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") {
      event.stopPropagation();
    }
  }

  const triggerLabel = currentVoice?.label ?? (setup ? "Choose a voice" : "Loading voices…");
  const triggerMeta = currentProvider ? TTS_PROVIDER_LABELS[currentProvider.id] : undefined;

  return (
    <SidebarMenuItem>
      <audio className="sr-only" onEnded={() => setPlayingVoiceId(null)} ref={audioRef} />
      <DropdownMenu
        onOpenChangeComplete={(open) => {
          if (open) {
            searchInputRef.current?.focus();
          } else {
            setQuery("");
            audioRef.current?.pause();
            setPlayingVoiceId(null);
          }
        }}
      >
        <DropdownMenuTriggerButton
          disabled={!setup}
          meta={triggerMeta}
          label={triggerLabel}
          voiceId={currentVoice?.id ?? ""}
        />
        <DropdownMenuContent align="start" className="w-72" side="bottom">
          <div className="px-1 pb-1.5">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-7 pl-7 text-xs"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={stopSearchKeyPropagation}
                placeholder="Search voices…"
                ref={searchInputRef}
                value={query}
              />
            </div>
          </div>

          {filteredProviders.length === 0 && (
            <p className="px-2 py-3 text-center text-caption text-muted-foreground">
              No voices match "{query}"
            </p>
          )}

          {filteredProviders.map(({ provider, voices }) => (
            <DropdownMenuGroup key={provider.id}>
              <DropdownMenuLabel>
                {TTS_PROVIDER_LABELS[provider.id]}
                {!provider.availability.available && " (unavailable)"}
              </DropdownMenuLabel>
              {voices.map((voice) => {
                const isActive =
                  provider.id === setup?.settings.provider && voice.id === setup?.settings.voiceId;
                const isPlaying = playingVoiceId === voice.id;
                return (
                  <DropdownMenuItem
                    key={voice.id}
                    onClick={() => onSelectVoice(provider.id, voice.id)}
                  >
                    <VoiceAvatar label={voice.label} size={20} voiceId={voice.id} />
                    <span className="min-w-0 flex-1 truncate">{voice.label}</span>
                    {voice.locale && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {voice.locale}
                      </span>
                    )}
                    {voice.previewUrl && (
                      <button
                        aria-label={isPlaying ? `Stop preview of ${voice.label}` : `Preview ${voice.label}`}
                        className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        onClick={(event) => {
                          event.stopPropagation();
                          togglePreview(voice);
                        }}
                        type="button"
                      >
                        {isPlaying ? (
                          <IconPlayerStop className="size-3" />
                        ) : (
                          <IconPlayerPlay className="size-3" />
                        )}
                      </button>
                    )}
                    {isActive && <IconCheck className="size-3.5 shrink-0" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2" onClick={onOpenSettings}>
            <IconSettings className="size-4" />
            Voice settings…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function DropdownMenuTriggerButton({
  disabled,
  label,
  meta,
  voiceId,
}: {
  disabled: boolean;
  label: string;
  meta?: string;
  voiceId: string;
}) {
  return (
    <DropdownMenuTrigger
      disabled={disabled}
      render={
        <SidebarMenuButton
          className={cn("gap-2 px-2", disabled && "cursor-not-allowed opacity-60")}
        />
      }
    >
      <VoiceAvatar label={label} size={22} voiceId={voiceId} />
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="w-full truncate text-body font-medium text-foreground">{label}</span>
        {meta && <span className="w-full truncate text-caption text-muted-foreground -mt-1">{meta}</span>}
      </span>
      <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
    </DropdownMenuTrigger>
  );
}
