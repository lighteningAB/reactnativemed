import * as SQLite from 'expo-sqlite';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
// Legacy import to silence deprecation warning until migration to new FileSystem API
import { getInfoAsync, makeDirectoryAsync, copyAsync } from 'expo-file-system/legacy';

export interface SnomedConcept {
  id: string;      // Description ID
  conceptId: string; // Concept ID
  term: string;
  active: number;
}

// Open the database. In modern Expo SQLite, openDatabaseSync is preferred if available,
// or use the legacy openDatabase.
// Note: For pre-populated databases, we need to ensure the file exists in the document directory.

const DB_NAME = 'snomed.db';

export const getSnomedDb = async (): Promise<SQLite.SQLiteDatabase> => {
  // Check if DB exists in document directory
  const dbPath = `${FileSystem.documentDirectory}SQLite/${DB_NAME}`;
  const dirInfo = await getInfoAsync(`${FileSystem.documentDirectory}SQLite`);
  
  if (!dirInfo.exists) {
    await makeDirectoryAsync(`${FileSystem.documentDirectory}SQLite`);
  }

  const fileInfo = await getInfoAsync(dbPath);
  
  if (!fileInfo.exists) {
    console.log("Copying SNOMED DB to document directory...");
    // Need to bundle the asset first
    const asset = Asset.fromModule(require('@/assets/snomed.db'));
    await asset.downloadAsync();
    if (asset.localUri) {
        await copyAsync({
            from: asset.localUri,
            to: dbPath
        });
    }
  }

  return SQLite.openDatabaseAsync(DB_NAME);
};

// Function to search terms by text (Exact or LIKE)
// Note: FTS (Full Text Search) is better, but LIKE is a start.
export const searchSnomedTerms = async (query: string, limit = 20): Promise<SnomedConcept[]> => {
  const db = await getSnomedDb();
  // Use simple LIKE query for now. 
  // For "chest pain", we might want "%chest%pain%" or similar.
  const likeQuery = `%${query}%`;
  
  // Debug log to verify query execution
  console.log(`[SnomedDB] Executing query: SELECT ... FROM descriptions WHERE term LIKE '${likeQuery}' LIMIT ${limit}`);

  // We can't do Vector Search inside standard SQLite easily without extensions.
  // So we will use Text Search to find candidates, THEN maybe re-rank or just return them.
  // Since the user asked for Embedding Model + DB, the flow is:
  // 1. Embedding Model -> Vector (Can't easily query SQL with Vector without extension)
  // 2. Fallback: Use SQL Text Search to get candidates -> Embed candidates -> Cosine Sim -> Re-rank.
  
  try {
    const result = await db.getAllAsync<SnomedConcept>(
      `SELECT id, conceptId, term, active FROM descriptions WHERE term LIKE ? LIMIT ?`,
      [likeQuery, limit]
    );
    console.log(`[SnomedDB] Found ${result.length} matches for '${likeQuery}'`);
    return result;
  } catch (error) {
    console.error("[SnomedDB] Query failed:", error);
    // Fallback: Return empty to prevent crash
    return [];
  }
};

// If we really want "Vector Search" against the DB, we'd need to store 
// embeddings in the DB (as blobs) and iterate them (slow in JS) or use an extension.
// Given constraints, Hybrid is best:
// Search text matches -> Re-rank with Vector if needed, or just rely on Text Search for exact matches.

