"use client";

import dynamic from "next/dynamic";
import type { EmojiClickData } from "emoji-picker-react";
import { Theme } from "emoji-picker-react";

const Picker = dynamic(() => import("emoji-picker-react").then((m) => m.default), {
  ssr: false,
  loading: () => <p className="p-3 text-center text-xs text-slate-500">Loading emoji picker…</p>,
});

type EmojiPickerPanelProps = {
  onEmojiClick: (emoji: string) => void;
};

/** Full emoji grid with categories + search (similar to macOS Character Viewer coverage). */
export function EmojiPickerPanel({ onEmojiClick }: EmojiPickerPanelProps) {
  return (
    <div className="emoji-picker-wrap max-h-[min(320px,50vh)] w-[min(100%,22rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg [&_.EmojiPickerReact]:!border-0">
      <Picker
        theme={Theme.LIGHT}
        width="100%"
        height={280}
        lazyLoadEmojis
        previewConfig={{ showPreview: false }}
        skinTonesDisabled={false}
        searchPlaceholder="Search emoji…"
        onEmojiClick={(e: EmojiClickData) => {
          onEmojiClick(e.emoji);
        }}
      />
    </div>
  );
}
