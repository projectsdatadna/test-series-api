/**
 * RAG Retriever Service
 * Retrieves relevant context from vector store for content generation
 */

const { generateEmbedding } = require('./embeddings');
const { getVectorData, searchSimilarVectors } = require('./dynamodbStore');

/**
 * Retrieve relevant context for a query
 * @param {string} query - User query
 * @param {string} documentId - Document ID to search in
 * @param {number} topK - Number of top results to return
 * @param {number} threshold - Similarity threshold
 * @returns {Promise<Array<{text: string, similarity: number, section: string}>>} Relevant context
 */
async function retrieveContext(query, documentId, topK = 5, threshold = null) {
  try {
    console.log(`[RAG] Retrieving context for query: "${query.substring(0, 50)}..."`);

    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(query);

    // Get vector data from DynamoDB
    const vectorData = await getVectorData(documentId);

    if (vectorData.length === 0) {
      console.warn(`[RAG] No vector data found for document: ${documentId}`);
      return [];
    }

    // Search for similar vectors
    const results = searchSimilarVectors(queryEmbedding, vectorData, topK, threshold);

    console.log(`[RAG] Retrieved ${results.length} relevant contexts`);

    return results;
  } catch (error) {
    console.error('[RAG] Error retrieving context:', error.message);
    throw error;
  }
}

/**
 * Retrieve context for multiple queries
 * @param {string[]} queries - Array of queries
 * @param {string} documentId - Document ID to search in
 * @param {number} topK - Number of top results per query
 * @returns {Promise<Object>} Results for each query
 */
async function retrieveContextBatch(queries, documentId, topK = 5) {
  try {
    const results = {};

    for (const query of queries) {
      try {
        results[query] = await retrieveContext(query, documentId, topK);
      } catch (error) {
        console.error(`[RAG] Error retrieving context for query "${query}":`, error.message);
        results[query] = { error: error.message };
      }
    }

    return results;
  } catch (error) {
    console.error('[RAG] Error retrieving context batch:', error.message);
    throw error;
  }
}

/**
 * Format retrieved context for prompt injection
 * @param {Array<{text: string, similarity: number, section: string}>} contexts - Retrieved contexts
 * @returns {string} Formatted context string
 */
function formatContextForPrompt(contexts) {
  if (!contexts || contexts.length === 0) {
    return '';
  }

  let formatted = 'RELEVANT CONTEXT FROM DOCUMENT:\n\n';

  contexts.forEach((context, index) => {
    formatted += `[Context ${index + 1}] (Section: ${context.section}, Similarity: ${(context.similarity * 100).toFixed(1)}%)\n`;
    formatted += `${context.text}\n\n`;
  });

  return formatted;
}

/**
 * Create RAG prompt with context
 * @param {string} query - Original query
 * @param {Array<{text: string, similarity: number, section: string}>} contexts - Retrieved contexts
 * @param {string} systemPrompt - System prompt template
 * @returns {string} Complete prompt with context
 */
function createRAGPrompt(query, contexts, systemPrompt = '') {
  const contextStr = formatContextForPrompt(contexts);

  const ragPrompt = `${systemPrompt}

${contextStr}

USER QUERY: ${query}

Please answer the query based on the provided context. If the context doesn't contain relevant information, indicate that.`;

  return ragPrompt;
}

module.exports = {
  retrieveContext,
  retrieveContextBatch,
  formatContextForPrompt,
  createRAGPrompt
};
