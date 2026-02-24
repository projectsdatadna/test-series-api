/**
 * RAG Chat Controller
 * Handles chat API endpoints with semantic search
 */

const { chatWithRAG } = require('./chat');

/**
 * Chat endpoint - Find similar chunks based on query
 * POST /rag/chat
 *
 * Request body:
 * {
 *   "query": "What is photosynthesis?",
 *   "chapterId": "CH_MLT1XDHY",
 *   "topK": 5,
 *   "threshold": 0.5
 * }
 */
async function chat(req, res) {
  try {
    console.log('[RAG-CHAT-API] ========== START ==========');

    const { query, chapterId, topK = 5, threshold = 0.5 } = req.body;

    // Validate required fields
    if (!query || !chapterId) {
      console.error('[RAG-CHAT-API] Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'query and chapterId are required',
        requiredFields: ['query', 'chapterId'],
        optionalFields: ['topK', 'threshold']
      });
    }

    // Validate query length
    if (query.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Query must be at least 3 characters long'
      });
    }

    if (query.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Query must be less than 1000 characters'
      });
    }

    // Validate topK
    if (topK < 1 || topK > 20) {
      return res.status(400).json({
        success: false,
        message: 'topK must be between 1 and 20'
      });
    }

    // Validate threshold
    if (threshold < 0 || threshold > 1) {
      return res.status(400).json({
        success: false,
        message: 'threshold must be between 0 and 1'
      });
    }

    console.log('[RAG-CHAT-API] Request parameters:');
    console.log(`[RAG-CHAT-API]   Query: "${query.substring(0, 50)}..."`);
    console.log(`[RAG-CHAT-API]   Chapter: ${chapterId}`);
    console.log(`[RAG-CHAT-API]   TopK: ${topK}`);
    console.log(`[RAG-CHAT-API]   Threshold: ${threshold}`);

    // Call RAG chat service
    const result = await chatWithRAG(query, chapterId, topK, threshold);

    console.log(`[RAG-CHAT-API] Found ${result.totalChunks} similar chunks`);
    console.log('[RAG-CHAT-API] ========== END ==========');

    return res.status(200).json({
      success: true,
      data: {
        query: result.query,
        chapterId: result.chapterId,
        totalChunks: result.totalChunks,
        similarChunks: result.similarChunks,
        context: result.context
        // Claude API response commented out for now
        // claudeResponse: result.claudeResponse
      },
      message: result.totalChunks > 0
        ? `Found ${result.totalChunks} relevant chunks`
        : 'No relevant content found'
    });

  } catch (error) {
    console.error('[RAG-CHAT-API] Error in chat endpoint:', error.message);
    console.error('[RAG-CHAT-API] Stack:', error.stack);

    return res.status(500).json({
      success: false,
      message: 'Failed to process chat query',
      error: error.message
    });
  }
}

/**
 * Batch chat endpoint - Process multiple queries
 * POST /rag/chat-batch
 *
 * Request body:
 * {
 *   "queries": ["What is photosynthesis?", "How does it work?"],
 *   "chapterId": "CH_MLT1XDHY",
 *   "topK": 5,
 *   "threshold": 0.5
 * }
 */
async function chatBatch(req, res) {
  try {
    console.log('[RAG-CHAT-BATCH-API] ========== START ==========');

    const { queries, chapterId, topK = 5, threshold = 0.5 } = req.body;

    // Validate required fields
    if (!queries || !Array.isArray(queries) || queries.length === 0 || !chapterId) {
      console.error('[RAG-CHAT-BATCH-API] Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'queries (array) and chapterId are required',
        requiredFields: ['queries', 'chapterId'],
        optionalFields: ['topK', 'threshold']
      });
    }

    // Validate query count
    if (queries.length > 10) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 10 queries allowed per batch'
      });
    }

    console.log(`[RAG-CHAT-BATCH-API] Processing ${queries.length} queries`);
    console.log(`[RAG-CHAT-BATCH-API] Chapter: ${chapterId}`);

    // Process each query
    const results = [];
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      console.log(`[RAG-CHAT-BATCH-API] Processing query ${i + 1}/${queries.length}: "${query.substring(0, 30)}..."`);

      try {
        const result = await chatWithRAG(query, chapterId, topK, threshold);
        results.push({
          queryIndex: i,
          query: result.query,
          totalChunks: result.totalChunks,
          similarChunks: result.similarChunks,
          context: result.context
          // Claude API response commented out for now
          // claudeResponse: result.claudeResponse
        });
      } catch (queryError) {
        console.error(`[RAG-CHAT-BATCH-API] Error processing query ${i + 1}:`, queryError.message);
        results.push({
          queryIndex: i,
          query: query,
          error: queryError.message,
          totalChunks: 0,
          similarChunks: []
        });
      }
    }

    console.log(`[RAG-CHAT-BATCH-API] Processed ${results.length} queries`);
    console.log('[RAG-CHAT-BATCH-API] ========== END ==========');

    return res.status(200).json({
      success: true,
      data: {
        chapterId: chapterId,
        queryCount: queries.length,
        results: results
      },
      message: `Processed ${results.length} queries`
    });

  } catch (error) {
    console.error('[RAG-CHAT-BATCH-API] Error in batch chat endpoint:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Failed to process batch chat queries',
      error: error.message
    });
  }
}

module.exports = {
  chat,
  chatBatch
};
