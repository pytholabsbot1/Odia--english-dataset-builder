
import { GoogleGenAI, Type } from "@google/genai";

const SYSTEM_INSTRUCTION = `Act as a native Odia language expert and professional translator.
Translate the following Odia text into English.

Rules (strict):
1. Translate exactly as written.
2. No summarising, rewriting, or interpreting.
3. Preserve original order, punctuation, and formatting.
4. Do not add or remove words, explanations, or headings.
5. Keep names, numbers, dates, and terms unchanged.
6. Return a JSON array of translated strings matching the input array length.`;

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 2000;

export class GeminiService {
  async translateBatch(odiaTexts: string[], model: string = 'gemini-3-flash-preview', manualKey?: string): Promise<string[]> {
    // Priority: Manual Key passed in argument > Environment Variable
    const apiKey = manualKey || process.env.API_KEY;
    
    if (!apiKey) {
      throw new Error("API Key is missing. Please click 'Set API Key' to configure it.");
    }

    const ai = new GoogleGenAI({ apiKey });

    let delay = INITIAL_BACKOFF_MS;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: model,
          contents: `Input array of Odia texts: ${JSON.stringify(odiaTexts)}`,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.STRING,
                description: 'The English translation of the corresponding Odia text.'
              }
            }
          },
        });

        const jsonStr = response.text?.trim();
        if (!jsonStr) {
          throw new Error("Empty response from Gemini");
        }

        const result = JSON.parse(jsonStr);
        
        if (!Array.isArray(result)) {
          throw new Error("Invalid response format from Gemini: Expected array");
        }

        return result;

      } catch (error: any) {
        // Check for Rate Limit (429) or Service Unavailable (503)
        const isRateLimit = error.status === 429 || error.code === 429 || error.message?.includes('429');
        const isServiceOverloaded = error.status === 503 || error.code === 503;

        if ((isRateLimit || isServiceOverloaded) && attempt < MAX_RETRIES) {
          console.warn(`Gemini API Error (Attempt ${attempt}/${MAX_RETRIES}): ${error.message}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          continue;
        }

        console.error("Translation error:", error);
        throw error;
      }
    }

    throw new Error(`Failed after ${MAX_RETRIES} attempts due to rate limits or errors.`);
  }
}
