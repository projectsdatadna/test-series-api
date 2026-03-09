const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const ragConfig = require('./config');

const client = new DynamoDBClient({ region: ragConfig.dynamodb.region });
const docClient = DynamoDBDocumentClient.from(client);

const SECTIONS_TABLE = process.env.SECTIONS_TABLE || 'SectionsTable';

/**
 * Store section with embeddings and metadata
 * Splits large sections to avoid DynamoDB 400KB item size limit
 * Stores embeddings separately from text to minimize item size
 * @param {Object} sectionData - Section data to store
 * @returns {Promise<Object>} Stored section data
 */
async function storeSectionWithEmbeddings(sectionData) {
  try {
    const {
      chapterId,
      sectionNumber,
      sectionTitle,
      syllabusId,
      standardId,
      subjectId,
      sectionType = null,
      type = null,
      chunks = []
    } = sectionData;

    console.log(`[RAG] storeSectionWithEmbeddings - START for section ${sectionNumber}`);
    console.log(`[RAG] storeSectionWithEmbeddings - Received data:`, {
      sectionNumber,
      sectionTitle,
      sectionType,
      type,
      chunkCount: chunks.length
    });

    if (!chapterId || !sectionNumber || !sectionTitle) {
      throw new Error('chapterId, sectionNumber, and sectionTitle are required');
    }

    console.log(`[RAG] storeSectionWithEmbeddings - Storing ${chunks.length} chunks`);

    const timestamp = new Date().toISOString();

    // Verify all chunks have required data
    const invalidChunks = chunks.filter(c => !c.text || !c.embedding);
    if (invalidChunks.length > 0) {
      console.warn(`[RAG] storeSectionWithEmbeddings - WARNING: ${invalidChunks.length} chunks missing text or embedding`);
    }

    // Process chunks to extract embeddings and text
    const processedChunks = chunks.map((chunk, index) => {
      if (!chunk.text) {
        console.warn(`[RAG] storeSectionWithEmbeddings - WARNING: Chunk ${index} has no text content`);
      }
      if (!chunk.embedding) {
        console.warn(`[RAG] storeSectionWithEmbeddings - WARNING: Chunk ${index} has no embedding`);
      }

      return {
        chunkIndex: index,
        text: chunk.text || '',
        embedding: chunk.embedding || [],
        chunkId: uuidv4()
      };
    });

    // Verify total content
    const totalChunkContent = processedChunks.reduce((sum, c) => sum + (c.text ? c.text.length : 0), 0);
    console.log(`[RAG] storeSectionWithEmbeddings - Total chunk content: ${totalChunkContent} characters`);

    // Calculate optimal batch size based on actual chunk size
    // DynamoDB limit: 400KB per item
    // Safe margin: use 300KB per item
    // Average embedding size: ~12KB (3072 floats * 4 bytes)
    const avgChunkSize = totalChunkContent > 0 ? totalChunkContent / processedChunks.length : 1000;
    const avgItemSize = avgChunkSize + 12000; // text + embedding + metadata overhead
    const CHUNKS_PER_BATCH = Math.max(1, Math.floor(300000 / avgItemSize));

    console.log(`[RAG] storeSectionWithEmbeddings - Avg chunk size: ${Math.round(avgItemSize)} bytes, Optimal batch size: ${CHUNKS_PER_BATCH} chunks per batch`);

    // Split chunks into batches based on calculated batch size
    const chunkBatches = [];

    for (let i = 0; i < processedChunks.length; i += CHUNKS_PER_BATCH) {
      chunkBatches.push(processedChunks.slice(i, i + CHUNKS_PER_BATCH));
    }

    console.log(`[RAG] storeSectionWithEmbeddings - Splitting ${processedChunks.length} chunks into ${chunkBatches.length} batches (${CHUNKS_PER_BATCH} chunks per batch)`);

    const storedItems = [];
    let successCount = 0;

    // Prepare all items for batch write
    const itemsToWrite = [];
    for (let batchIndex = 0; batchIndex < chunkBatches.length; batchIndex++) {
      const batch = chunkBatches[batchIndex];
      const sectionId = uuidv4();

      const subSectionNumber = chunkBatches.length > 1
        ? `${sectionNumber}_batch_${batchIndex + 1}`
        : sectionNumber;

      const item = {
        sectionId,
        chapterId,
        sectionNumber: subSectionNumber,
        sectionTitle: chunkBatches.length > 1
          ? `${sectionTitle} (Part ${batchIndex + 1}/${chunkBatches.length})`
          : sectionTitle,
        syllabusId: syllabusId || null,
        standardId: standardId || null,
        subjectId: subjectId || null,
        sectionType: sectionType || null,
        type: type || null,
        chunks: batch,
        totalChunks: batch.length,
        batchIndex: batchIndex,
        totalBatches: chunkBatches.length,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      itemsToWrite.push(item);
    }

    // Batch write all items (DynamoDB BatchWriteItem supports up to 25 items per request)
    const BATCH_SIZE = 25;
    for (let i = 0; i < itemsToWrite.length; i += BATCH_SIZE) {
      const batch = itemsToWrite.slice(i, i + BATCH_SIZE);
      const requestItems = batch.map(item => ({
        PutRequest: {
          Item: item
        }
      }));

      console.log(`[RAG] storeSectionWithEmbeddings - Batch writing ${batch.length} items (batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(itemsToWrite.length / BATCH_SIZE)})`);

      try {
        await docClient.send(new BatchWriteCommand({
          RequestItems: {
            [SECTIONS_TABLE]: requestItems
          }
        }));
        storedItems.push(...batch);
        successCount += batch.length;
        console.log(`[RAG] storeSectionWithEmbeddings - Batch ${Math.floor(i / BATCH_SIZE) + 1} written successfully (${batch.length} items)`);
      } catch (dbError) {
        console.warn(`[RAG] Warning: Batch write failed:`, dbError.message);
        
        // Fallback: write items individually if batch fails
        for (const item of batch) {
          try {
            await docClient.send(new PutCommand({
              TableName: SECTIONS_TABLE,
              Item: item
            }));
            storedItems.push(item);
            successCount++;
          } catch (singleError) {
            console.warn(`[RAG] Could not store item ${item.sectionId}:`, singleError.message);
          }
        }
      }
    }

    console.log(`[RAG] storeSectionWithEmbeddings - COMPLETE: Stored ${successCount}/${chunkBatches.length} batches with total ${processedChunks.length} chunks, sectionType: ${sectionType}, type: ${type}`);

    // Return combined view of all stored items
    return {
      sectionId: storedItems[0]?.sectionId || uuidv4(),
      chapterId,
      sectionNumber,
      sectionTitle,
      syllabusId: syllabusId || null,
      standardId: standardId || null,
      subjectId: subjectId || null,
      sectionType: sectionType || null,
      type: type || null,
      totalChunks: processedChunks.length,
      totalBatches: chunkBatches.length,
      storedBatches: successCount,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  } catch (error) {
    console.error('[RAG] Error storing section with embeddings:', error.message);
    throw error;
  }
}

/**
 * Get sections by chapter
 * Automatically combines batched sections
 * Handles pagination with a limit to prevent timeouts
 * @param {string} chapterId - Chapter ID
 * @param {number} maxItems - Maximum items to fetch (default: 1000)
 * @returns {Promise<Array>} Sections for the chapter (combined if batched)
 */
async function getSectionsByChapter(chapterId, maxItems = 1000) {
  try {
    const allItems = [];
    let lastEvaluatedKey = null;
    let itemCount = 0;

    // Paginate through results with a limit to prevent timeouts
    do {
      const params = {
        TableName: SECTIONS_TABLE,
        KeyConditionExpression: 'chapterId = :chapterId',
        ExpressionAttributeValues: {
          ':chapterId': chapterId
        },
        Limit: 100 // Fetch 100 items per request
      };

      if (lastEvaluatedKey) {
        params.ExclusiveStartKey = lastEvaluatedKey;
      }

      const result = await docClient.send(new QueryCommand(params));
      const items = result.Items || [];
      
      console.log(`[RAG] Retrieved ${items.length} section items for chapter ${chapterId}`);
      allItems.push(...items);
      itemCount += items.length;

      // Stop if we've reached the max items limit
      if (itemCount >= maxItems) {
        console.warn(`[RAG] Reached max items limit (${maxItems}) for chapter ${chapterId}. Stopping pagination.`);
        break;
      }

      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    console.log(`[RAG] Total items retrieved: ${allItems.length} for chapter ${chapterId}`);
    
    // Group batched sections by original section number
    const sectionMap = {};

    for (const item of allItems) {
      // Extract base section number by removing batch/sub identifiers
      // Examples: "1_batch_1" -> "1", "1_sub_1" -> "1", "2.1_batch_2" -> "2.1"
      const baseSectionNumber = item.sectionNumber
        .split('_batch_')[0]
        .split('_sub_')[0];

      console.log(`[RAG] Processing item - sectionNumber: ${item.sectionNumber}, baseSectionNumber: ${baseSectionNumber}, chunks: ${item.chunks?.length || 0}`);

      if (!sectionMap[baseSectionNumber]) {
        sectionMap[baseSectionNumber] = {
          sectionId: item.sectionId,
          chapterId: item.chapterId,
          sectionNumber: baseSectionNumber,
          sectionTitle: item.sectionTitle
            .replace(/ \(Part \d+\/\d+\)$/, '')
            .replace(/ \(Sub-batch\)$/, ''),
          syllabusId: item.syllabusId,
          standardId: item.standardId,
          subjectId: item.subjectId,
          chunks: [],
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        };
        console.log(`[RAG] Created new section entry for ${baseSectionNumber}`);
      }

      // Combine chunks from all batches/sub-batches
      const chunksToAdd = item.chunks || [];
      console.log(`[RAG] Adding ${chunksToAdd.length} chunks to section ${baseSectionNumber}. Current chunks: ${sectionMap[baseSectionNumber].chunks.length}`);
      
      sectionMap[baseSectionNumber].chunks.push(...chunksToAdd);
      
      console.log(`[RAG] After adding - section ${baseSectionNumber} now has ${sectionMap[baseSectionNumber].chunks.length} chunks`);
    }

    const combinedSections = Object.values(sectionMap);
    console.log(`[RAG] Combined ${allItems.length} items into ${combinedSections.length} sections`);
    
    // Recalculate totalChunks based on actual combined chunks
    combinedSections.forEach(section => {
      section.totalChunks = section.chunks.length;
      console.log(`[RAG] Final section ${section.sectionNumber}: ${section.chunks.length} chunks, totalChunks: ${section.totalChunks}`);
    });

    return combinedSections;
  } catch (error) {
    console.warn('[RAG] Warning: Could not retrieve sections from DynamoDB:', error.message);
    return [];
  }
}

/**
 * Get section by ID
 * @param {string} sectionId - Section ID
 * @returns {Promise<Object>} Section data
 */
async function getSectionById(sectionId) {
  try {
    const result = await docClient.send(new ScanCommand({
      TableName: SECTIONS_TABLE,
      FilterExpression: 'sectionId = :sectionId',
      ExpressionAttributeValues: {
        ':sectionId': sectionId
      }
    }));

    return result.Items?.[0] || null;
  } catch (error) {
    console.warn('[RAG] Warning: Could not retrieve section from DynamoDB:', error.message);
    return null;
  }
}

/**
 * Search sections by metadata
 * @param {Object} filters - Filter criteria
 * @returns {Promise<Array>} Matching sections
 */
async function searchSections(filters) {
  try {
    const { syllabusId, standardId, subjectId } = filters;

    let filterExpression = [];
    let expressionAttributeValues = {};

    if (syllabusId) {
      filterExpression.push('syllabusId = :syllabusId');
      expressionAttributeValues[':syllabusId'] = syllabusId;
    }

    if (standardId) {
      filterExpression.push('standardId = :standardId');
      expressionAttributeValues[':standardId'] = standardId;
    }

    if (subjectId) {
      filterExpression.push('subjectId = :subjectId');
      expressionAttributeValues[':subjectId'] = subjectId;
    }

    const params = {
      TableName: SECTIONS_TABLE
    };

    if (filterExpression.length > 0) {
      params.FilterExpression = filterExpression.join(' AND ');
      params.ExpressionAttributeValues = expressionAttributeValues;
    }

    const result = await docClient.send(new ScanCommand(params));

    console.log(`[RAG] Found ${result.Items?.length || 0} sections matching filters`);
    return result.Items || [];
  } catch (error) {
    console.warn('[RAG] Warning: Could not search sections in DynamoDB:', error.message);
    return [];
  }
}

/**
 * Delete section
 * @param {string} sectionId - Section ID
 * @returns {Promise<void>}
 */
async function deleteSection(sectionId) {
  try {
    // First find the section to get chapterId
    const section = await getSectionById(sectionId);
    if (!section) {
      throw new Error(`Section ${sectionId} not found`);
    }

    // Delete using chapterId and sectionId
    const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
    await docClient.send(new DeleteCommand({
      TableName: SECTIONS_TABLE,
      Key: {
        chapterId: section.chapterId,
        sectionId: sectionId
      }
    }));

    console.log(`[RAG] Deleted section ${sectionId}`);
  } catch (error) {
    console.warn('[RAG] Warning: Could not delete section from DynamoDB:', error.message);
  }
}

module.exports = {
  storeSectionWithEmbeddings,
  getSectionsByChapter,
  getSectionById,
  searchSections,
  deleteSection
};
