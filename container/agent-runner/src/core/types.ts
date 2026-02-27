export interface LLMResponse {
  content: string;
  toolCalls?: any[];
}

export interface BaseProvider {
  chat(messages: any[], tools?: any[]): Promise<LLMResponse>;
}
