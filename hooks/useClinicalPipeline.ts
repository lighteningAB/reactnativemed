import { useCactusLM, type Message } from 'cactus-react-native';
import { jsonrepair } from 'jsonrepair';
import { useState } from 'react';
import { FinalDiagnosis, PatientData } from '../types/pipeline';

// Load the local SNOMED subset directly (no database)
const snomedSubset: { id: string; term: string }[] = require('@/assets/snomed_subset.json');

export type PipelineStage = 'idle' | 'extracting' | 'proposing' | 'mapping' | 'explaining';

export function useClinicalPipeline() {
  // Using 'qwen3-1.7' for both completion and embedding
  const cactusLM = useCactusLM({ model: 'lfm2-vl-1.6b' });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<PipelineStage>('idle');

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

  // Helper to safely parse JSON, or return null if completely failed
  const parseJSON = (text: string) => {
    console.log("Raw LLM Output:", text); // Debug logging
    if (!text) return null;
    
    let cleanedText = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    cleanedText = cleanedText.replace(/```json/g, '').replace(/```/g, '').trim();
    cleanedText = cleanedText.replace(/<\|im_end\|>/g, '').trim();
    cleanedText = cleanedText.replace(/\/\/.*$/gm, '');
    cleanedText = cleanedText.replace(/\*\*/g, '');
    
    try {
      return JSON.parse(jsonrepair(cleanedText));
    } catch (e) {
      // Fallback strategies (Array or Object extraction)
      try {
          const firstBracket = cleanedText.indexOf('[');
          const lastBracket = cleanedText.lastIndexOf(']');
          if (firstBracket !== -1 && lastBracket > firstBracket) {
             return JSON.parse(jsonrepair(cleanedText.substring(firstBracket, lastBracket + 1)));
          }
          const firstBrace = cleanedText.indexOf('{');
          const lastBrace = cleanedText.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace > firstBrace) {
              return JSON.parse(jsonrepair(cleanedText.substring(firstBrace, lastBrace + 1)));
          }
      } catch (e2) {}
      return null;
    }
  };

  const chatExtract = async (history: Message[]): Promise<PatientData | null> => {
    setLoading(true);
    setStage('extracting');
    try {
      await ensureModelDownloaded(cactusLM, "qwen3-1.7");
      
      // Simplified prompt: Ask for a simple string summary first, then we can try to parse or just use it as "free_text_summary"
      // For robust extracted fields, we still try JSON but make it very permissive.
      const systemPrompt: Message = {
        role: 'system',
        content: `Extract patient details. Return JSON: {"age": number, "sex": "string", "symptoms": [{"name": "string", "location": "string"}], "summary": "string"}`
      };

      const messages = [systemPrompt, ...history];
      const response = await cactusLM.complete({ 
        messages, 
        options: { temperature: 0.1 } 
      });
      
      // Attempt parse
      const parsed = parseJSON(response.response);
      if (parsed) return parsed;
      
      // Fallback: Construct a minimal PatientData object from the raw text if JSON failed
      return {
        symptoms: [],
        past_medical_history: [],
        medications: [],
        red_flags: [],
        free_text_summary: response.response.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
      };

    } catch (err) {
      console.error("Extraction pipeline error:", err);
      setError('Extraction failed');
      return null;
    } finally {
      setLoading(false);
      setStage('idle');
    }
  };

  const proposeDiagnoses = async (data: PatientData): Promise<string[]> => {
    setLoading(true);
    setStage('proposing');
    try {
      // Extremely simple prompt: Ask for a comma-separated string. 
      // JSON is brittle with small models. Text processing is robust.
      const systemPrompt: Message = {
        role: 'system',
        content: `Based on the patient data, list 3 potential diagnoses. Separate them with commas. Do not use numbers or bullet points.`
      };
      
      const userPrompt: Message = {
        role: 'user',
        content: `Patient Data: ${JSON.stringify(data)}`
      };

      const response = await cactusLM.complete({ 
        messages: [systemPrompt, userPrompt], 
        options: { temperature: 0.3 } 
      });
      
      let text = response.response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      // Remove potential tokens like <|im_end|> which might leak
      text = text.replace(/<\|im_end\|>/g, '').trim();
      // Remove potential markdown or "Here are..." prefixes
      text = text.replace(/^.*?:/m, '').trim(); 

      // Split by comma or newline
      // The user provided output shows the model sometimes returns descriptions with colons.
      // e.g. "Angina Pectoris: description..."
      // We want to keep just the diagnosis name for SNOMED mapping.
      
      const diagnoses = text.split(/,|\n/).map(d => d.trim()).filter(d => d.length > 3);
      
      const cleanedDiagnoses = diagnoses.map(d => {
         // Remove "1.", "-", etc
         let clean = d.replace(/^[\d-]+\.?\s*/, '').trim();
         // Remove everything after a colon (often the explanation)
         // e.g. "Angina Pectoris: This is a..." -> "Angina Pectoris"
         clean = clean.split(':')[0].trim();
         // Remove trailing " or ' if present
         clean = clean.replace(/['"]+$/, '');
         return clean;
      }).filter(d => d.length > 0);
      
      console.log("Propose Diagnoses (Text Mode):", cleanedDiagnoses);
      return cleanedDiagnoses.slice(0, 3);

    } catch (err) {
      setError('Diagnosis proposal failed');
      return [];
    } finally {
      setLoading(false);
      setStage('idle');
    }
  };

  // Simple local search against the JSON subset
  const searchSnomedLocal = (query: string) => {
    const lowerQuery = query.toLowerCase();
    return snomedSubset.filter(s => s.term.toLowerCase().includes(lowerQuery));
  };

  const explainAndMap = async (data: PatientData, diagnoses: string[]): Promise<FinalDiagnosis[]> => {
    setLoading(true);
    setStage('mapping');
    try {
      // 1. Map candidates locally first using the JSON subset
      const mappedCandidates = diagnoses.map(diagnosis => {
         const candidates = searchSnomedLocal(diagnosis);
         return { phrase: diagnosis, candidates };
      });

      console.log("Mapped SNOMED Terms (Hallucinated -> JSON Subset):", JSON.stringify(mappedCandidates, null, 2));

      let finalDiagnoses: FinalDiagnosis[] = [];

      try {
          const prompt: Message = {
            role: 'user',
            content: `
    Match these diagnoses to SNOMED codes.
    Diagnoses: ${diagnoses.join(', ')}

    Return valid JSON array only.
    Example:
    [
      { "phrase": "Pneumonia", "chosen_snomed_ids": ["233604007"], "confidence": 0.9, "explanation": "Matched based on symptoms." }
    ]`
          };

          // Inject context if missing
          const contextMsg: Message = {
             role: 'user',
             content: `Context Data:
    Patient: ${JSON.stringify(data)}`
          };

          const response = await cactusLM.complete({ 
            messages: [contextMsg, prompt], 
            options: { temperature: 0.3 } // Lower temp for structure
          });
          
          const parsed = parseJSON(response.response);
          if (parsed && Array.isArray(parsed) && parsed.length > 0) {
            finalDiagnoses = parsed;
          } else {
            console.warn("LLM explanation JSON invalid or empty, falling back to manual mapping.");
          }
      } catch (llmErr) {
          console.warn("LLM explanation failed:", llmErr);
      }
      
      if (finalDiagnoses.length === 0) {
        // Fallback: Construct results directly from mapped candidates
        finalDiagnoses = mappedCandidates.map(item => {
            // Get top candidate
            const best = item.candidates.length > 0 ? item.candidates[0] : null;
            return {
                phrase: item.phrase,
                chosen_snomed_ids: best ? [best.id] : [],
                confidence: best ? 0.8 : 0, 
                explanation: best 
                  ? `Mapped to SNOMED term: "${best.term}"` 
                  : "No matching SNOMED concept found in local subset."
            };
        });
      }

      console.log("Final Mapped & Explained Diagnoses:", JSON.stringify(finalDiagnoses, null, 2));
      return finalDiagnoses;

    } catch (err) {
      console.error("Explanation/Mapping pipeline error:", err);
      setError('Explanation failed');
      return [];
    } finally {
      setLoading(false);
      setStage('idle');
    }
  };

  return {
    cactusLM,
    // embeddingLM, // Removed, re-using cactusLM
    loading,
    error,
    stage,
    chatExtract,
    proposeDiagnoses,
    explainAndMap
  };
}
