import { cosineSimilarity } from '@/utils/math';
import { searchSnomedTerms } from '@/utils/snomedDb';
import { SnomedConcept } from '@/utils/snomedLoader';
import { useCactusLM, type Message } from 'cactus-react-native';
import { jsonrepair } from 'jsonrepair';
import { useState } from 'react';
import { FinalDiagnosis, PatientData } from '../types/pipeline';

interface SnomedEntry extends SnomedConcept {
  embedding?: number[];
}

export function useClinicalPipeline() {
  // Using 'qwen3-1.7' for both completion and embedding
  const cactusLM = useCactusLM({ model: 'qwen3-1.7' });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ensure models are downloaded before usage
  const ensureModelDownloaded = async (lm: ReturnType<typeof useCactusLM>, modelName: string) => {
     // Check if model exists in file system via the hook's exposed state
     // Note: useCactusLM exposes isDownloaded. 
     // If it's false, we try to download.
     if (!lm.isDownloaded && !lm.isDownloading) {
        console.log(`Downloading ${modelName}...`);
        try {
            await lm.download();
            console.log(`Downloaded ${modelName}`);
        } catch (e) {
            console.error(`Failed to download ${modelName}`, e);
            throw e;
        }
     }
  };

  const parseJSON = (text: string) => {
    console.log("Raw LLM Output:", text); // Debug logging
    if (!text) {
        console.error("LLM Output is empty or undefined");
        return null;
    }
    
    // Clean up the output: remove <think> blocks and sanitize
    let cleanedText = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    // Remove markdown code blocks if present
    cleanedText = cleanedText.replace(/```json/g, '').replace(/```/g, '').trim();
    // Remove <|im_end|> or other special tokens if they appear
    cleanedText = cleanedText.replace(/<\|im_end\|>/g, '').trim();
    // Remove comments like // ...
    cleanedText = cleanedText.replace(/\/\/.*$/gm, '');
    
    // Fix single quotes (common issue with Qwen-0.6/1.7)
    // This regex finds keys or string values wrapped in single quotes and converts them to double quotes.
    cleanedText = cleanedText.replace(/'([^']+)':/g, '"$1":'); // Fix keys
    cleanedText = cleanedText.replace(/: '([^']+)'/g, ': "$1"'); // Fix values
    // Fix Qwen 1.7 hallucinated closing parenthesis in keys (e.g. "@id"): )
    cleanedText = cleanedText.replace(/"\):/g, '":');
    
    try {
      // Use jsonrepair to fix truncated or malformed JSON
      const repaired = jsonrepair(cleanedText);
      return JSON.parse(repaired);
    } catch (e) {
      console.error("JSON Parse Error", e);
      // Fallback: Try to find at least a valid structure if repair fails
      try {
          const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
          if (jsonMatch) return JSON.parse(jsonrepair(jsonMatch[0]));
      } catch (e2) {}
      return null;
    }
  };

  const chatExtract = async (history: Message[]): Promise<PatientData | null> => {
    setLoading(true);
    try {
      await ensureModelDownloaded(cactusLM, "qwen3-1.7");
      
      // Qwen 1.7 needs very explicit examples to output correct JSON
      const systemPrompt: Message = {
        role: 'system',
        content: `You are a medical scribe. Extract data into standard JSON. Use ONLY double quotes. Do NOT use single quotes. Do NOT use @ keys or JSON-LD. Return ONLY the JSON object as a single line:
{ "demographics": {"age": null, "sex": null}, "symptoms": [{"name": "symptom", "location": "body part", "duration": "time"}], "past_medical_history": [], "medications": [], "red_flags": [], "free_text_summary": "summary here" }`
      };

      const messages = [systemPrompt, ...history];
      const response = await cactusLM.complete({ 
        messages, 
        options: { temperature: 0.1 } // Lower temp for structure
      });
      return parseJSON(response.response); // Use .response property
    } catch (err) {
      console.error("Extraction pipeline error:", err);
      setError('Extraction failed');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const proposeDiagnoses = async (data: PatientData): Promise<string[]> => {
    setLoading(true);
    try {
      const prompt: Message = {
        role: 'user',
        content: `Patient Data: ${JSON.stringify(data)}
List 3 likely diagnosis phrases. Return ONLY a JSON array of strings (e.g. ["Condition A", "Condition B", "Condition C"]). Do NOT use markdown or comments.`
      };

      const response = await cactusLM.complete({ 
        messages: [prompt], 
        options: { temperature: 0.5 } 
      });
      return parseJSON(response.response) || [];
    } catch (err) {
      setError('Diagnosis proposal failed');
      return [];
    } finally {
      setLoading(false);
    }
  };

  const mapToSnomed = async (phrases: string[]) => {
    // We will perform a Hybrid Search here:
    // 1. Get candidates via SQL Text Search (Fast, On-device)
    // 2. Embed the candidates and re-rank (Semantic)
    
    await ensureModelDownloaded(cactusLM, "qwen3-1.7");

    const results = [];
    for (const phrase of phrases) {
      // 1. SQL Search
      // We search for words in the phrase. Simplistic "LIKE" search for now.
      const searchTerms = phrase.split(' ').filter(w => w.length > 3); // Basic keyword extraction
      // Or just search the whole phrase first
      let candidates = await searchSnomedTerms(phrase, 10);
      
      if (candidates.length === 0 && searchTerms.length > 0) {
        // Fallback: search by main keyword
        candidates = await searchSnomedTerms(searchTerms[0], 10);
      }

      if (candidates.length === 0) {
         results.push({ phrase, candidates: [] });
         continue;
      }

      // 2. Re-ranking (Semantic)
      let phraseEmbedding: number[] | null = null;
      try {
         const res = await cactusLM.embed({ text: phrase });
         phraseEmbedding = res.embedding;
      } catch (e) {
         // Embedding failed, just return text matches
      }

      const rankedCandidates = await Promise.all(candidates.map(async (c) => {
         // We need to embed the candidate term to compare
         // Optimization: Cache these embeddings in DB in future
         try {
            const res = await cactusLM.embed({ text: c.term });
            return {
               ...c,
               score: phraseEmbedding ? cosineSimilarity(phraseEmbedding, res.embedding) : 1.0
            };
         } catch (e) {
            return { ...c, score: 0 };
         }
      }));
      
      // Sort by score
      rankedCandidates.sort((a, b) => b.score - a.score);
      
      results.push({ phrase, candidates: rankedCandidates.slice(0, 3) });
    }
    return results;
  };

  const explainAndMap = async (data: PatientData, diagnoses: string[]): Promise<FinalDiagnosis[]> => {
    setLoading(true);
    try {
      const mappedCandidates = await mapToSnomed(diagnoses);
      
      const prompt: Message = {
        role: 'user',
        content: `Patient: ${JSON.stringify(data)}
Candidates: ${JSON.stringify(mappedCandidates)}

Select best SNOMED match and explain.
Return ONLY JSON array: { "phrase": string, "chosen_snomed_ids": string[], "confidence": number, "explanation": string }`
      };

      const response = await cactusLM.complete({ 
        messages: [prompt], 
        options: { temperature: 0.5 }
      });
      return parseJSON(response.response) || [];
    } catch (err) {
      setError('Explanation failed');
      return [];
    } finally {
      setLoading(false);
    }
  };

  return {
    cactusLM,
    // embeddingLM, // Removed, re-using cactusLM
    loading,
    error,
    chatExtract,
    proposeDiagnoses,
    explainAndMap
  };
}
