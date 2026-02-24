/**
 * RAG Chat Service
 * Handles chat queries with semantic search using cosine similarity
 * Finds most relevant chunks and sends to Claude API
 */

const { getSectionsByChapter } = require('./sectionStore');
const { cosineSimilarity, generateEmbeddings } = require('./embeddings');

/**
 * Generate embedding for a query
 * @param {string} query - User query
 * @returns {Promise<number[]>} Query embedding vector
 */
async function generateQueryEmbedding(query) {
  try {
    console.log('[RAG-CHAT] Generating embedding for query:', query.substring(0, 50));
    const embeddings = await generateEmbeddings([query]);
    console.log('[RAG-CHAT] Query embedding generated successfully');
    return embeddings[0];
  } catch (error) {
    console.error('[RAG-CHAT] Error generating query embedding:', error.message);
    throw error;
  }
}

/**
 * Find most similar chunks using cosine similarity
 * @param {string} query - User query
 * @param {string} chapterId - Chapter ID to search in
 * @param {number} topK - Number of top results to return
 * @param {number} threshold - Similarity threshold (0-1)
 * @returns {Promise<Array>} Most similar chunks with similarity scores
 */
async function findSimilarChunks(query, chapterId, topK = 5, threshold = 0.5) {
  try {
    console.log(`[RAG-CHAT] Finding similar chunks for query: "${query.substring(0, 50)}..."`);
    console.log(`[RAG-CHAT] Chapter: ${chapterId}, TopK: ${topK}, Threshold: ${threshold}`);

    // Generate embedding for the query
    const queryEmbedding = await generateQueryEmbedding(query);
    console.log(`[RAG-CHAT] Query embedding dimension: ${queryEmbedding.length}`);

    // Get all sections for the chapter
    const sections = await getSectionsByChapter(chapterId);
    console.log(`[RAG-CHAT] Retrieved ${sections.length} sections from chapter`);

    if (sections.length === 0) {
      console.warn('[RAG-CHAT] No sections found for chapter');
      return [];
    }

    // Collect all chunks with their similarity scores
    const chunksWithScores = [];

    for (const section of sections) {
      if (!section.chunks || section.chunks.length === 0) {
        console.warn(`[RAG-CHAT] Section ${section.sectionNumber} has no chunks`);
        continue;
      }

      for (const chunk of section.chunks) {
        try {
          // Calculate cosine similarity
          const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);

          console.log(`[RAG-CHAT] Section ${section.sectionNumber}, Chunk ${chunk.chunkIndex}: similarity=${similarity.toFixed(4)}`);

          // Only include chunks above threshold
          if (similarity >= threshold) {
            chunksWithScores.push({
              sectionNumber: section.sectionNumber,
              sectionTitle: section.sectionTitle,
              chunkIndex: chunk.chunkIndex,
              chunkId: chunk.chunkId,
              text: chunk.text,
              embedding: chunk.embedding,
              similarity: similarity,
              syllabusId: section.syllabusId,
              standardId: section.standardId,
              subjectId: section.subjectId
            });
          }
        } catch (chunkError) {
          console.warn(`[RAG-CHAT] Error processing chunk in section ${section.sectionNumber}:`, chunkError.message);
          continue;
        }
      }
    }

    console.log(`[RAG-CHAT] Found ${chunksWithScores.length} chunks above threshold ${threshold}`);

    // Sort by similarity score (descending) and get top K
    const topChunks = chunksWithScores
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    console.log(`[RAG-CHAT] Returning top ${topChunks.length} chunks`);
    topChunks.forEach((chunk, idx) => {
      console.log(`[RAG-CHAT] Top ${idx + 1}: Section ${chunk.sectionNumber}, Similarity: ${chunk.similarity.toFixed(4)}`);
    });

    return topChunks;
  } catch (error) {
    console.error('[RAG-CHAT] Error finding similar chunks:', error.message);
    throw error;
  }
}

/**
 * Chat with RAG - Find similar chunks and prepare for Claude API
 * @param {string} query - User query
 * @param {string} chapterId - Chapter ID to search in
 * @param {number} topK - Number of top results to return
 * @param {number} threshold - Similarity threshold
 * @returns {Promise<Object>} Response with similar chunks
 */
async function chatWithRAG(query, chapterId, topK = 5, threshold = 0.5) {
  try {
    console.log('[RAG-CHAT] ========== START ==========');
    console.log(`[RAG-CHAT] Query: "${query}"`);
    console.log(`[RAG-CHAT] Chapter: ${chapterId}`);

    if (!query || !chapterId) {
      throw new Error('query and chapterId are required');
    }

    // Find most similar chunks
    const similarChunks = await findSimilarChunks(query, chapterId, topK, threshold);

    if (similarChunks.length === 0) {
      console.warn('[RAG-CHAT] No similar chunks found');
      return {
        success: true,
        query,
        chapterId,
        similarChunks: [],
        totalChunks: 0,
        message: 'No relevant content found for this query'
        // Claude API call commented out for now
        // claudeResponse: null
      };
    }

    // Prepare context from similar chunks
    const context = similarChunks
      .map((chunk, idx) => `[Chunk ${idx + 1} - Section ${chunk.sectionNumber} - Similarity: ${(chunk.similarity * 100).toFixed(1)}%]\n${chunk.text}`)
      .join('\n\n---\n\n');

    console.log(`[RAG-CHAT] Context prepared: ${context.length} characters`);

    // TODO: Uncomment when ready to call Claude API
    /*
    console.log('[RAG-CHAT] Calling Claude API with context...');
    const claudeResponse = await callClaudeAPI(query, context);
    console.log('[RAG-CHAT] Claude API response received');
    */

    console.log('[RAG-CHAT] ========== END ==========');

    return {
      success: true,
      query,
      chapterId,
      similarChunks: similarChunks.map(chunk => ({
        sectionNumber: chunk.sectionNumber,
        sectionTitle: chunk.sectionTitle,
        chunkIndex: chunk.chunkIndex,
        chunkId: chunk.chunkId,
        text: chunk.text,
        similarity: chunk.similarity,
        syllabusId: chunk.syllabusId,
        standardId: chunk.standardId,
        subjectId: chunk.subjectId
      })),
      totalChunks: similarChunks.length,
      context: context
      // Claude API response commented out for now
      // claudeResponse: claudeResponse
    };
  } catch (error) {
    console.error('[RAG-CHAT] Error in chatWithRAG:', error.message);
    throw error;
  }
}

/**
 * Call Claude API with context (commented out for now)
 * @param {string} query - User query
 * @param {string} context - Context from similar chunks
 * @returns {Promise<string>} Claude API response
 */
/*
async function callClaudeAPI(query, context) {
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY
    });

    console.log('[RAG-CHAT] Sending to Claude API...');

    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Based on the following context, answer this question: ${query}

CONTEXT:
${context}

Please provide a clear and concise answer based only on the provided context.`
      }]
    });

    const response = message.content[0].text;
    console.log('[RAG-CHAT] Claude API response received');
    return response;
  } catch (error) {
    console.error('[RAG-CHAT] Error calling Claude API:', error.message);
    throw error;
  }
}
*/

module.exports = {
  generateQueryEmbedding,
  findSimilarChunks,
  chatWithRAG
  // callClaudeAPI
};
