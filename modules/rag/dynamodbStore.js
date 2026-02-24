/**
 * DynamoDB Vector Store
 * Stores and retrieves vector embeddings from BOOK_FILES_TABLE
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const ragConfig = require('./config');

const client = new DynamoDBClient({ region: ragConfig.dynamodb.region });
const docClient = DynamoDBDocumentClient.from(client);

const BOOK_FILES_TABLE = process.env.BOOK_FILES_TABLE || 'BookFilesTable';

/**
 * Store vector data for a document
 * @param {string} documentId - Document ID (used as fileId)
 * @param {Array<{text: string, embedding: number[], section: string, chunkIndex: number}>} vectorData - Vector data to store
 * @returns {Promise<void>}
 */
async function storeVectorData(documentId, vectorData) {
  try {
    if (!documentId || !vectorData || vectorData.length === 0) {
      throw new Error('Document ID and vector data are required');
    }

    // Use documentId as both bookId and fileId for RAG vectors
    const params = {
      TableName: BOOK_FILES_TABLE,
      Key: {
        bookId: `RAG_${documentId}`,
        fileId: documentId
      },
      UpdateExpression: 'SET vectorSections = :vectorData, updatedAt = :timestamp',
      ExpressionAttributeValues: {
        ':vectorData': vectorData,
        ':timestamp': new Date().toISOString()
      }
    };

    await docClient.send(new UpdateCommand(params));

    console.log(`[RAG] Stored ${vectorData.length} vector chunks for document: ${documentId}`);
  } catch (error) {
    console.error('[RAG] Error storing vector data:', error.message);
    throw error;
  }
}

/**
 * Retrieve vector data for a document
 * @param {string} documentId - Document ID
 * @returns {Promise<Array>} Vector data
 */
async function getVectorData(documentId) {
  try {
    const params = {
      TableName: BOOK_FILES_TABLE,
      Key: {
        bookId: `RAG_${documentId}`,
        fileId: documentId
      }
    };

    const result = await docClient.send(new GetCommand(params));

    if (!result.Item) {
      console.warn(`[RAG] No vector data found for document: ${documentId}`);
      return [];
    }

    return result.Item.vectorSections || [];
  } catch (error) {
    console.error('[RAG] Error retrieving vector data:', error.message);
    throw error;
  }
}

/**
 * Search for similar vectors
 * @param {number[]} queryVector - Query vector
 * @param {Array<{text: string, embedding: number[]}>} vectorData - Vector data to search
 * @param {number} topK - Number of top results to return
 * @param {number} threshold - Similarity threshold
 * @returns {Array<{text: string, similarity: number, section: string}>} Similar results
 */
function searchSimilarVectors(queryVector, vectorData, topK = 5, threshold = null) {
  const { cosineSimilarity } = require('./embeddings');
  const similarityThreshold = threshold || ragConfig.vector.similarityThreshold;

  const results = vectorData
    .map(item => ({
      text: item.text,
      section: item.section,
      chunkIndex: item.chunkIndex,
      similarity: cosineSimilarity(queryVector, item.embedding)
    }))
    .filter(item => item.similarity >= similarityThreshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  console.log(`[RAG] Found ${results.length} similar vectors (threshold: ${similarityThreshold})`);

  return results;
}

/**
 * Update document with new vector data
 * @param {string} bookId - Book ID (primary key)
 * @param {string} fileId - File ID (sort key)
 * @param {Array<{text: string, embedding: number[], section: string, chunkIndex: number}>} vectorData - New vector data
 * @param {Object} metadata - Additional metadata to store
 * @returns {Promise<void>}
 */
async function updateDocumentVectors(bookId, fileId, vectorData, metadata = {}) {
  try {
    const timestamp = new Date().toISOString();
    const params = {
      TableName: BOOK_FILES_TABLE,
      Key: {
        bookId: bookId,
        fileId: fileId
      },
      UpdateExpression: 'SET vectorSections = :vectorData, vectorMetadata = :metadata, updatedAt = :timestamp',
      ExpressionAttributeValues: {
        ':vectorData': vectorData,
        ':metadata': {
          ...metadata,
          vectorCount: vectorData.length,
          lastUpdated: timestamp
        },
        ':timestamp': timestamp
      }
    };

    await docClient.send(new UpdateCommand(params));

    console.log(`[RAG] Updated ${vectorData.length} vectors for document: bookId=${bookId}, fileId=${fileId}`);
  } catch (error) {
    console.error('[RAG] Error updating document vectors:', error.message);
    // Don't throw - allow graceful degradation for local development
    console.warn('[RAG] Vectors generated but not persisted to DynamoDB');
  }
}

/**
 * Delete vector data for a document
 * @param {string} documentId - Document ID
 * @returns {Promise<void>}
 */
async function deleteVectorData(documentId) {
  try {
    const params = {
      TableName: BOOK_FILES_TABLE,
      Key: {
        bookId: `RAG_${documentId}`,
        fileId: documentId
      },
      UpdateExpression: 'REMOVE vectorSections, vectorMetadata'
    };

    await docClient.send(new UpdateCommand(params));

    console.log(`[RAG] Deleted vector data for document: ${documentId}`);
  } catch (error) {
    console.error('[RAG] Error deleting vector data:', error.message);
    throw error;
  }
}

module.exports = {
  storeVectorData,
  getVectorData,
  searchSimilarVectors,
  updateDocumentVectors,
  deleteVectorData
};
