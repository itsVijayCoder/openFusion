export type JudgeResult = {
  consensus: string[];
  contradictions: Array<{
    topic: string;
    models: string[];
    details: string;
    recommended_resolution: string;
  }>;
  missing_coverage: string[];
  unique_insights: Array<{ model: string; insight: string }>;
  risks: Array<{ risk: string; severity: "low" | "medium" | "high"; mitigation: string }>;
  confidence: number;
  recommended_final_strategy: string;
};
