/**
 * TN State Board Book Extraction Controller
 * DEPRECATED: This controller is no longer used
 * TN State Board books are now processed through Claude API in pdfProcessor.js
 * 
 * Kept for backward compatibility only
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');
const hierarchyService = require('../file-hierarchy/service');

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const CHAPTERS_TABLE = process.env.CHAPTERS_TABLE || 'ChaptersTable';

/**
 * Extract chapters and sections from TN State Board book text
 * DEPRECATED: Use pdfProcessor.js with Claude API instead
 * This endpoint is kept for backward compatibility only
 */
const extractChapters = async (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'This endpoint is deprecated. TN State Board books are now processed through Claude API in the RAG pipeline.',
    details: 'Use the /rag/process-file endpoint with splitPattern="ai_based" for TN Science/Social Science books (Std 8,9,10)'
  });
};

/**
 * Get extracted chapters for a book
 * GET /book-upload/tn-state-board/chapters/:syllabusId/:standardId/:subjectId
 */
const getExtractedChapters = async (req, res) => {
  try {
    const { syllabusId, standardId, subjectId } = req.params;

    console.log('[TN-SB] Get Extracted Chapters:', {
      syllabusId,
      standardId,
      subjectId
    });

    if (!syllabusId || !standardId || !subjectId) {
      return res.status(400).json({
        success: false,
        message: 'syllabusId, standardId, and subjectId are all required'
      });
    }

    // Query chapters from DynamoDB
    const result = await dynamoDB.scan({
      TableName: CHAPTERS_TABLE,
      FilterExpression: 'syllabusId = :syllabusId AND standardId = :standardId AND subjectId = :subjectId AND #source = :source',
      ExpressionAttributeNames: {
        '#source': 'source'
      },
      ExpressionAttributeValues: {
        ':syllabusId': syllabusId,
        ':standardId': standardId,
        ':subjectId': subjectId,
        ':source': 'tn-state-board-ai-extraction'
      }
    }).promise();

    const chapters = result.Items || [];

    console.log('[TN-SB] Found', chapters.length, 'extracted chapters');

    return res.status(200).json({
      success: true,
      data: {
        syllabusId,
        standardId,
        subjectId,
        totalChapters: chapters.length,
        chapters: chapters.map(ch => ({
          chapterId: ch.chapterId,
          chapterNumber: ch.chapterNumber,
          chapterTitle: ch.chapterTitle,
          totalSections: ch.totalSections,
          extractedAt: ch.extractedAt
        }))
      },
      message: 'Extracted chapters retrieved successfully'
    });

  } catch (error) {
    console.error('[TN-SB] Error in getExtractedChapters:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Get chapter details with sections
 * GET /book-upload/tn-state-board/chapters/:chapterId
 */
const getChapterDetails = async (req, res) => {
  try {
    const { chapterId } = req.params;

    if (!chapterId) {
      return res.status(400).json({
        success: false,
        message: 'chapterId is required'
      });
    }

    console.log('[TN-SB] Get Chapter Details:', { chapterId });

    // Query chapter from DynamoDB
    const result = await dynamoDB.scan({
      TableName: CHAPTERS_TABLE,
      FilterExpression: 'chapterId = :chapterId',
      ExpressionAttributeValues: {
        ':chapterId': chapterId
      }
    }).promise();

    const chapter = result.Items?.[0];

    if (!chapter) {
      return res.status(404).json({
        success: false,
        message: 'Chapter not found'
      });
    }

    console.log('[TN-SB] Found chapter:', chapter.chapterTitle);

    return res.status(200).json({
      success: true,
      data: {
        chapterId: chapter.chapterId,
        chapterNumber: chapter.chapterNumber,
        chapterTitle: chapter.chapterTitle,
        bookTitle: chapter.bookTitle,
        syllabusId: chapter.syllabusId,
        standardId: chapter.standardId,
        subjectId: chapter.subjectId,
        totalSections: chapter.totalSections,
        sections: chapter.sections || [],
        extractedAt: chapter.extractedAt
      },
      message: 'Chapter details retrieved successfully'
    });

  } catch (error) {
    console.error('[TN-SB] Error in getChapterDetails:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

module.exports = {
  extractChapters,
  getExtractedChapters,
  getChapterDetails
};
