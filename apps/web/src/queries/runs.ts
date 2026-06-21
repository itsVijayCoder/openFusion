"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { apiPost, apiUrl } from "@/lib/api";

export function useRun(runId: string) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/fusion/runs/${runId}`), {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch run");
      return res.json();
    },
  });
}

export function useCreateRun() {
  return useMutation({
    mutationFn: (body: unknown) => apiPost("/api/fusion/runs", body),
  });
}
