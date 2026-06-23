"use client";

import { Check, MessageSquarePlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { FusionChat } from "./types";
import { cn } from "@/lib/utils";

type SidebarProps = {
  chats: FusionChat[];
  activeChatId: string | null;
  loading: boolean;
  error?: string | null;
  onNewFusion: () => void;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => Promise<void> | void;
};

export function Sidebar({ chats, activeChatId, loading, error, onNewFusion, onSelectChat, onDeleteChat, onRenameChat }: SidebarProps) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [savingChatId, setSavingChatId] = useState<string | null>(null);

  function startRename(chat: FusionChat) {
    setEditingChatId(chat.id);
    setDraftTitle(chat.title);
  }

  function cancelRename() {
    setEditingChatId(null);
    setDraftTitle("");
  }

  async function submitRename(chat: FusionChat) {
    const title = draftTitle.trim();
    if (!title || savingChatId) return;
    if (title === chat.title) {
      cancelRename();
      return;
    }

    setSavingChatId(chat.id);
    try {
      await onRenameChat(chat.id, title);
      cancelRename();
    } finally {
      setSavingChatId(null);
    }
  }

  return (
    <aside className="flex w-[250px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="p-3">
        <button
          onClick={onNewFusion}
          className="flex w-full items-center gap-2 rounded-xl bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90"
        >
          <Plus aria-hidden className="size-4" />
          New Fusion
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <p className="px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Previous Fusions
        </p>
        {loading ? (
          <div className="flex flex-col gap-1 px-2 py-1">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded-lg bg-muted/50" />
            ))}
          </div>
        ) : error ? (
          <p className="px-3 py-2 text-[12px] text-muted-foreground">{error}</p>
        ) : chats.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-muted-foreground">No fusions yet.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {chats.map((chat) => (
              <div
                key={chat.id}
                className={cn(
                  "group flex items-center rounded-lg transition-colors duration-150",
                  activeChatId === chat.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {editingChatId === chat.id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitRename(chat);
                    }}
                  >
                    <input
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") cancelRename();
                      }}
                      disabled={savingChatId === chat.id}
                      autoFocus
                      maxLength={120}
                      className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[13px] text-foreground outline-none focus:border-primary"
                    />
                    <button
                      type="submit"
                      aria-label="Save title"
                      title="Save"
                      disabled={!draftTitle.trim() || savingChatId === chat.id}
                      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Check aria-hidden className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Cancel rename"
                      title="Cancel"
                      onClick={cancelRename}
                      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X aria-hidden className="size-3.5" />
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onSelectChat(chat.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
                    >
                      <MessageSquarePlus aria-hidden className="size-3.5 shrink-0 opacity-60" />
                      <span className="flex-1 truncate text-[13px]">{chat.title}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Rename ${chat.title}`}
                      title="Rename"
                      onClick={() => startRename(chat)}
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:opacity-100",
                        activeChatId === chat.id ? "opacity-100" : "opacity-0",
                      )}
                    >
                      <Pencil aria-hidden className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${chat.title}`}
                      title="Delete"
                      onClick={() => onDeleteChat(chat.id)}
                      className={cn(
                        "mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100",
                        activeChatId === chat.id ? "opacity-100" : "opacity-0",
                      )}
                    >
                      <Trash2 aria-hidden className="size-3.5" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
