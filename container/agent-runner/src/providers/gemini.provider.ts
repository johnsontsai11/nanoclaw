import { GoogleGenerativeAI } from "@google/generative-ai";
import { BaseProvider, LLMResponse } from "../core/types.js";

export class GeminiProvider implements BaseProvider {
  private client: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string, modelName: string = "gemini-2.0-flash") {
    this.client = new GoogleGenerativeAI(apiKey);
    // Use the latest 2.0 Flash for subagent support and speed as requested
    this.model = this.client.getGenerativeModel({ model: modelName });
  }

  async chat(messages: any[], tools?: any[]): Promise<LLMResponse> {
    const config: any = { contents: messages };
    if (tools && tools.length > 0) {
      config.tools = [{ functionDeclarations: tools }];
    }

    const result = await this.model.generateContent(config);
    return this.parseResponse(result);
  }

  private parseResponse(result: any): LLMResponse {
    let text = "";
    try {
      text = result.response.text();
    } catch (e) {
      // Sometimes no text is returned if there's only a tool call.
    }

    let toolCalls = undefined;
    const responseTools = result.response.functionCalls();
    if (responseTools && responseTools.length > 0) {
      toolCalls = responseTools;
    }

    return {
      content: text,
      toolCalls,
    };
  }
}
