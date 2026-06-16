"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

export function useRun(runId: string) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: async () => {
      const res = await fetch(`/api/fusion/runs/${runId}`);
      if (!res.ok) throw new Error("Failed to fetch run");
      return res.json();
    },
  });
}

export function useCreateRun() {
  return useMutation({
    mutationFn: async (body: unknown) => {
      const res = await fetch("/api/fusion/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create run");
      return res.json();
    },
  });
}
