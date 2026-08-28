import { useState } from "react";
import { cn } from "../../lib/utils";

type VoiceAvatarProps = {
  voiceId: string;
  label: string;
  size?: number;
  className?: string;
};

export function VoiceAvatar({ voiceId, label, size = 20, className }: VoiceAvatarProps) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };

  if (failed || !voiceId) {
    const initial = label.trim().charAt(0).toUpperCase() || "?";
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[10px] font-semibold text-sidebar-accent-foreground",
          className,
        )}
        style={style}
      >
        {initial}
      </span>
    );
  }

  return (
    <img
      alt=""
      aria-hidden="true"
      className={cn("shrink-0 rounded-full bg-sidebar-accent/10", className)}
      loading="lazy"
      onError={() => setFailed(true)}
      src={`https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(voiceId)}`}
      style={style}
    />
  );
}
