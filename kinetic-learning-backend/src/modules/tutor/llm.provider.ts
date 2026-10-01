export type TutorTurn = { role: "user" | "assistant" | "system"; content: string };
export interface LlmProvider { complete(messages: TutorTurn[]): Promise<string>; }

class MockProvider implements LlmProvider {
  async complete(messages: TutorTurn[]) {
    const last = [...messages].reverse().find(m => m.role === "user")?.content ?? "your question";
    return `Tutor test response: I received your question: "${last}". Connect an AI provider to receive generated tutoring responses.`;
  }
}

class OpenAICompatibleProvider implements LlmProvider {
  constructor(private apiKey: string, private baseUrl: string, private model: string) {}
  async complete(messages: TutorTurn[]) {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages, temperature: 0.3 })
    });
    if (!response.ok) throw new Error(`LLM provider error (${response.status})`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("LLM provider returned an empty response");
    return content;
  }
}

export function getLlmProvider(): LlmProvider {
  const provider = (process.env.AI_PROVIDER ?? "mock").toLowerCase();
  if (provider === "mock") return new MockProvider();
  if (provider === "openai-compatible") {
    const key = process.env.AI_API_KEY, base = process.env.AI_BASE_URL, model = process.env.AI_MODEL;
    if (!key || !base || !model) throw new Error("AI_API_KEY, AI_BASE_URL and AI_MODEL are required for openai-compatible provider");
    return new OpenAICompatibleProvider(key, base, model);
  }
  throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
}
