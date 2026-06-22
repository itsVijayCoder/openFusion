export type PanelOutput = {
  model: string;
  output: string;
  completed: boolean;
};

export type ModelStats = {
  model: string;
  outputLength: number;
  hasCodeBlocks: boolean;
  hasRisks: boolean;
  completed: boolean;
};

export type UniqueInsight = {
  model: string;
  insight: string;
};

export type Contradiction = {
  topic: string;
  models: string[];
};

export type Analysis = {
  agreementScore: number;
  confidence: number;
  uniqueInsights: UniqueInsight[];
  contradictions: Contradiction[];
  modelStats: ModelStats[];
};

export function computeAnalysis(outputs: PanelOutput[]): Analysis {
  const completed = outputs.filter((o) => o.completed && o.output.trim());

  if (completed.length === 0) {
    return {
      agreementScore: 0,
      confidence: 0,
      uniqueInsights: [],
      contradictions: [],
      modelStats: outputs.map((o) => ({
        model: o.model,
        outputLength: o.output.length,
        hasCodeBlocks: false,
        hasRisks: false,
        completed: o.completed,
      })),
    };
  }

  const sentences = completed.map((o) => splitSentences(o.output));
  const agreementScore = avgPairwiseSimilarity(sentences);

  const uniqueInsights = completed.flatMap((o, i) => {
    const otherSentences = sentences.filter((_, j) => j !== i).flat();
    return sentences[i]
      .filter((s) => s.length > 30 && !otherSentences.some((os) => ngramSimilarity(s, os) > 0.6))
      .slice(0, 3)
      .map((insight) => ({ model: o.model, insight: insight.slice(0, 200) }));
  });

  const contradictions = detectContradictions(completed);

  const modelStats: ModelStats[] = outputs.map((o) => ({
    model: o.model,
    outputLength: o.output.length,
    hasCodeBlocks: /```/.test(o.output),
    hasRisks: /risk|warning|caution|danger/i.test(o.output),
    completed: o.completed,
  }));

  const completionRate = completed.length / outputs.length;
  const avgLength = completed.reduce((sum, o) => sum + o.output.length, 0) / completed.length;
  const lengthFactor = Math.min(avgLength / 2000, 1);
  const confidence = agreementScore * 0.5 + completionRate * 0.3 + lengthFactor * 0.2;

  return { agreementScore, confidence, uniqueInsights, contradictions, modelStats };
}

export function confidenceLabel(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.7) return "high";
  if (confidence >= 0.4) return "medium";
  return "low";
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

function avgPairwiseSimilarity(sentences: string[][]): number {
  if (sentences.length < 2) return 1;

  let total = 0;
  let count = 0;
  for (let i = 0; i < sentences.length; i++) {
    for (let j = i + 1; j < sentences.length; j++) {
      const aSet = new Set(sentences[i].flatMap((s) => getNgrams(s.toLowerCase(), 3)));
      const bSet = new Set(sentences[j].flatMap((s) => getNgrams(s.toLowerCase(), 3)));
      const intersection = [...aSet].filter((x) => bSet.has(x)).length;
      const union = new Set([...aSet, ...bSet]).size;
      total += union > 0 ? intersection / union : 0;
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

function ngramSimilarity(a: string, b: string): number {
  const aNgrams = new Set(getNgrams(a.toLowerCase(), 3));
  const bNgrams = new Set(getNgrams(b.toLowerCase(), 3));
  const intersection = [...aNgrams].filter((x) => bNgrams.has(x)).length;
  const union = new Set([...aNgrams, ...bNgrams]).size;
  return union > 0 ? intersection / union : 0;
}

function getNgrams(text: string, n: number): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i <= text.length - n; i++) {
    ngrams.push(text.slice(i, i + n));
  }
  return ngrams;
}

const OPPOSING_PAIRS: Array<[RegExp, RegExp]> = [
  [/\b(use|recommend|prefer|should use)\b/i, /\b(avoid|don't use|never use|should not use)\b/i],
  [/\b(safe|secure|reliable)\b/i, /\b(risky|dangerous|insecure|unreliable)\b/i],
  [/\b(fast|quick|efficient)\b/i, /\b(slow|inefficient|performance issue)\b/i],
  [/\b(simple|easy|straightforward)\b/i, /\b(complex|complicated|difficult)\b/i],
  [/\b(works?|supported|compatible)\b/i, /\b(fails?|broken|incompatible|unsupported)\b/i],
];

function detectContradictions(outputs: PanelOutput[]): Contradiction[] {
  const contradictions: Contradiction[] = [];

  for (const [positive, negative] of OPPOSING_PAIRS) {
    const positiveModels = outputs.filter((o) => positive.test(o.output)).map((o) => o.model);
    const negativeModels = outputs.filter((o) => negative.test(o.output)).map((o) => o.model);

    if (positiveModels.length > 0 && negativeModels.length > 0) {
      const topic = positive.source.replace(/\\b|\(|\)|\|/g, " ").trim();
      contradictions.push({
        topic: topic.charAt(0).toUpperCase() + topic.slice(1),
        models: [...new Set([...positiveModels, ...negativeModels])],
      });
    }
  }

  return contradictions.slice(0, 5);
}