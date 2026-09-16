import {
  CLASSIFY_MODEL_ID,
  NOVITA_MODEL_ID,
  classificationParams,
  getAnthropic,
  novitaClassify,
  parseClassification,
  type ClassificationResult,
} from "./llm";

export type ClassifierUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ClassifierResponse = {
  result: ClassificationResult | null;
  usage: ClassifierUsage;
  latencyMs: number;
  raw: string;
};

export interface ClassifierProvider {
  readonly provider: "anthropic" | "novita" | "google";
  readonly modelId: string;
  classify(rubric: string, articlePrompt: string): Promise<ClassifierResponse>;
}

export function providerFromModelId(modelId: string): string {
  if (modelId.startsWith("novita:")) return "novita";
  if (modelId.startsWith("google:") || modelId.startsWith("gemini-")) return "google";
  if (modelId.startsWith("local:")) return "local";
  return "anthropic";
}

export function anthropicProvider(modelId = CLASSIFY_MODEL_ID): ClassifierProvider {
  return {
    provider: "anthropic",
    modelId,
    async classify(rubric, articlePrompt) {
      const client = getAnthropic();
      if (!client) throw new Error("ANTHROPIC_API_KEY is not configured");
      const started = performance.now();
      const message = await client.messages.create({
        ...classificationParams(rubric, articlePrompt),
        model: modelId,
      });
      const raw = message.content.find((block) => block.type === "text")?.text ?? "";
      return {
        result: parseClassification(raw),
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
        latencyMs: Math.round(performance.now() - started),
        raw,
      };
    },
  };
}

export function novitaProvider(modelId = NOVITA_MODEL_ID): ClassifierProvider {
  return {
    provider: "novita",
    modelId,
    async classify(rubric, articlePrompt) {
      const started = performance.now();
      const response = await novitaClassify(rubric, articlePrompt);
      return {
        result: response.parsed,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        latencyMs: Math.round(performance.now() - started),
        raw: response.raw,
      };
    },
  };
}

export function geminiProvider(modelId: string): ClassifierProvider {
  return {
    provider: "google",
    modelId,
    async classify(rubric, articlePrompt) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
      const started = performance.now();
      const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}` +
        `:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: rubric }] },
          contents: [{ role: "user", parts: [{ text: articlePrompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
          },
        }),
      });
      const body = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(`Gemini ${response.status}: ${body.error?.message ?? "request failed"}`);
      const raw = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      return {
        result: parseClassification(raw),
        usage: {
          inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
        },
        latencyMs: Math.round(performance.now() - started),
        raw,
      };
    },
  };
}
