const express = require('express');
const { chat, chatBatch } = require('./chatController');

const router = express.Router();

/**
 * POST /rag/chat
 * Chat with RAG - Find similar chunks based on query
 *
 * Request body:
 * {
 *   "query": "What is photosynthesis?",
 *   "chapterId": "CH_MLT1XDHY",
 *   "topK": 5,
 *   "threshold": 0.5
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "query": "What is photosynthesis?",
 *     "chapterId": "CH_MLT1XDHY",
 *     "totalChunks": 5,
 *     "similarChunks": [
 *       {
 *         "sectionNumber": "2.1",
 *         "sectionTitle": "Introduction to Photosynthesis",
 *         "chunkIndex": 0,
 *         "chunkId": "uuid",
 *         "text": "Photosynthesis is...",
 *         "similarity": 0.85,
 *         "syllabusId": "SYL_NCERT",
 *         "standardId": "STD_6",
 *         "subjectId": "SUB_SCI"
 *       }
 *     ],
 *     "context": "Combined context from all similar chunks"
 *   },
 *   "message": "Found 5 relevant chunks"
 * }
 */
router.post('/chat', chat);

/**
 * POST /rag/chat-batch
 * Batch chat - Process multiple queries at once
 *
 * Request body:
 * {
 *   "queries": ["What is photosynthesis?", "How does it work?"],
 *   "chapterId": "CH_MLT1XDHY",
 *   "topK": 5,
 *   "threshold": 0.5
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "chapterId": "CH_MLT1XDHY",
 *     "queryCount": 2,
 *     "results": [
 *       {
 *         "queryIndex": 0,
 *         "query": "What is photosynthesis?",
 *         "totalChunks": 5,
 *         "similarChunks": [...],
 *         "context": "..."
 *       },
 *       {
 *         "queryIndex": 1,
 *         "query": "How does it work?",
 *         "totalChunks": 3,
 *         "similarChunks": [...],
 *         "context": "..."
 *       }
 *     ]
 *   },
 *   "message": "Processed 2 queries"
 * }
 */
router.post('/chat-batch', chatBatch);

module.exports = router;
