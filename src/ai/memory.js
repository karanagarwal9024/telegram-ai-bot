import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { supabase } from '../supabase/client.js';

const embeddings = new GoogleGenerativeAIEmbeddings({
    model: "gemini-embedding-2", // Highly efficient Gemini embedding model
    apiKey: process.env.GOOGLE_API_KEY,
});

// Converts text into a mathematical vector representation
export const generateEmbedding = async (text) => {
    try {
        const vector = await embeddings.embedQuery(text);
        return vector;
    } catch (error) {
        console.error("Error generating embedding:", error);
        return null;
    }
};

// Performs a Semantic Similarity search using Supabase pgvector with Metadata Pre-Filtering
export const searchSimilarEntries = async (telegramId, queryText, categoryFilter = null, tagsFilter = [], limit = 15) => {
    try {
        const queryVector = await generateEmbedding(queryText);
        if (!queryVector) return [];

        // Call the custom Supabase stored procedure (RPC)
        const { data, error } = await supabase.rpc('match_journal_entries', {
            query_embedding: queryVector,
            match_threshold: 0.2, // 20% similarity threshold
            match_count: limit,
            p_telegram_id: telegramId,
            p_category: categoryFilter,
            p_tags: tagsFilter
        });

        if (error) {
            console.error("Supabase RPC Error:", error);
            return [];
        }
        
        return data || [];
    } catch (error) {
        console.error("Error searching memory:", error);
        return [];
    }
};
