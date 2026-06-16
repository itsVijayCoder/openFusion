"use client";

import { create } from "zustand";

export type UiState = {
  sidebarOpen: boolean;
  selectedWorkspaceId?: string;
  selectedPreset: string;
  tracePanelOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setSelectedWorkspaceId: (id?: string) => void;
  setSelectedPreset: (preset: string) => void;
  setTracePanelOpen: (open: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  selectedPreset: "same-provider-first",
  tracePanelOpen: true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSelectedWorkspaceId: (selectedWorkspaceId) => set({ selectedWorkspaceId }),
  setSelectedPreset: (selectedPreset) => set({ selectedPreset }),
  setTracePanelOpen: (tracePanelOpen) => set({ tracePanelOpen }),
}));
