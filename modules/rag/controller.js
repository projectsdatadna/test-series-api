const AWS = require('aws-sdk');
const { retrieveContext, retrieveContextBatch } = require('./retriever');
const { getVectorData } = require('./dynamodbStore');

const s3 = new AWS.S3({
  region: process.env.AWS_REGION || 'ap-south-1'
});

const S3_BUCKET = process.env.S3_BUCKET_NAME || 'test-series-books';
async function generatePresignedUrlForRAG(req, res) {
  try {
    const { fileName, fileSize, documentId } = req.body;

    if (!fileName || !documentId) {
      return res.status(400).json({
        success: false,
        message: 'fileName and documentId are required'
      });
    }

    const MAX_FILE_SIZE = 500 * 1024 * 1024;
    if (fileSize && fileSize > MAX_FILE_SIZE) {
      return res.status(413).json({
        success: false,
        message: 'File size exceeds 500MB limit'
      });
    }

    const fileKey = `rag/${documentId}/${Date.now()}-${fileName}`;

    const presignedUrl = s3.getSignedUrl('putObject', {
      Bucket: S3_BUCKET,
      Key: fileKey,
      ContentType: 'application/pdf',
      Expires: 3600
    });

    return res.status(200).json({
      success: true,
      data: {
        presignedUrl,
        fileKey,
        expiresIn: 3600
      }
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

async function processRAGFileFromS3(req, res) {
  try {
    const {
      fileKey,
      documentId,
      fileName,
      syllabusId,
      standardId,
      subjectId,
      chapterName,
      division,
      bookType,
      pageRanges,
      splitPattern,
      sectionTitles
    } = req.body;

    if (!fileKey || !documentId) {
      return res.status(400).json({
        success: false,
        message: 'fileKey and documentId are required'
      });
    }

    // Map bookType to division if bookType is provided
    let finalDivision = division;
    if (bookType && !division) {
      const bookTypeMap = {
        'main': 'Chapters',
        'supplementary': 'Poems',
        'workbook': 'Workbook'
      };
      finalDivision = bookTypeMap[bookType.toLowerCase()];
      
      if (!finalDivision) {
        return res.status(400).json({
          success: false,
          message: `bookType must be one of: main, supplementary, workbook`,
        });
      }
      console.log(`[RAG] Mapped bookType '${bookType}' to division '${finalDivision}'`);
    }

    // Detect TN State Board books
    const isTNStateBoard = syllabusId && syllabusId.toUpperCase().includes('TN');
    console.log(`[RAG] Detected TN State Board book: ${isTNStateBoard}, syllabusId: ${syllabusId}`);

    // Validate division for 9th and 10th English
    const isEnglish9or10 = (standardId === 'STD_9' || standardId === 'STD_10' || standardId === '9' || standardId === '10') && 
                           (subjectId === 'SUB_ENG' || subjectId === 'English');
    if (isEnglish9or10 && !finalDivision) {
      return res.status(400).json({
        success: false,
        message: 'division or bookType is required for 9th and 10th English (Chapters, Poems, or Workbook)',
      });
    }

    // Validate division value if provided
    const validDivisions = ['Chapters', 'Poems', 'Workbook'];
    if (finalDivision && !validDivisions.includes(finalDivision)) {
      return res.status(400).json({
        success: false,
        message: `division must be one of: ${validDivisions.join(', ')}`,
      });
    }

    // Validate splitPattern if provided
    const validSplitPatterns = ['regex_based', 'heading_based', 'chapter_based', 'manual_anchors'];
    if (splitPattern && !validSplitPatterns.includes(splitPattern)) {
      return res.status(400).json({
        success: false,
        message: `splitPattern must be one of: ${validSplitPatterns.join(', ')}`
      });
    }

    // Validate pageRanges if provided
    if (pageRanges && Array.isArray(pageRanges) && pageRanges.length > 0) {
      const invalidRanges = pageRanges.filter(r => !r.title || typeof r.startPage !== 'number' || typeof r.endPage !== 'number');
      if (invalidRanges.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Each pageRange must have title (string), startPage (number), and endPage (number)'
        });
      }
    }

    // Validate sectionTitles if provided (only for heading_based)
    if (sectionTitles && Array.isArray(sectionTitles) && sectionTitles.length > 0) {
      if (splitPattern && splitPattern !== 'heading_based') {
        console.warn(`[RAG] sectionTitles provided but splitPattern is '${splitPattern}', not 'heading_based'. sectionTitles will be ignored.`);
      }
      const invalidTitles = sectionTitles.filter(t => typeof t !== 'string' || t.trim().length === 0);
      if (invalidTitles.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Each sectionTitle must be a non-empty string'
        });
      }
    }

    // Verify file exists
    await s3.headObject({
      Bucket: S3_BUCKET,
      Key: fileKey
    }).promise();

    // Download file
    const s3Object = await s3.getObject({
      Bucket: S3_BUCKET,
      Key: fileKey
    }).promise();

    const pdfBuffer = s3Object.Body;

    const hierarchyService = require('../file-hierarchy/service');

    let chapterData = null;

    if (syllabusId && standardId && subjectId && chapterName) {
      try {
        chapterData = await hierarchyService.createChapter(
          subjectId,
          chapterName,
          documentId,
          syllabusId,
          standardId,
          finalDivision || null
        );
      } catch (e) {
        console.warn('Hierarchy creation failed:', e.message);
      }
    }

    const { processPDFToSections } = require('./pdfProcessor');

    console.log('[RAG] DEBUG: About to call processPDFToSections with metadata:', {
      chapterId: chapterData?.chapterId || documentId,
      syllabusId,
      standardId,
      subjectId,
      division: finalDivision || null,
      splitPattern: splitPattern || 'regex_based'
    });

    const storedSections = await processPDFToSections(pdfBuffer, {
      chapterId: chapterData?.chapterId || documentId,
      documentId: documentId,
      syllabusId,
      standardId,
      subjectId,
      division: finalDivision || null,
      bookType: bookType || null,
      pageRanges: pageRanges && Array.isArray(pageRanges) && pageRanges.length > 0 ? pageRanges : null,
      splitPattern: splitPattern || 'regex_based',
      sectionTitles: sectionTitles && Array.isArray(sectionTitles) && sectionTitles.length > 0 ? sectionTitles : null,
      isTNStateBoard: isTNStateBoard
    });

    console.log('[RAG] DEBUG: Returned from processPDFToSections, stored sections:', storedSections.map(s => ({
      sectionNumber: s.sectionNumber,
      sectionTitle: s.sectionTitle,
      type: s.type
    })));

    // Determine which splitting strategy was actually used
    const splitStrategyUsed = (pageRanges && Array.isArray(pageRanges) && pageRanges.length > 0) 
      ? 'page_ranges' 
      : (splitPattern || 'regex_based');

    return res.status(200).json({
      success: true,
      data: {
        documentId,
        totalSections: storedSections.length,
        fileSizeMB: (pdfBuffer.length / 1024 / 1024).toFixed(2),
        splitStrategyUsed,
        sections: storedSections.map(s => ({
          sectionId: s.sectionId,
          sectionNumber: s.sectionNumber,
          sectionTitle: s.sectionTitle,
          totalChunks: s.totalChunks
        }))
      }
    });

  } catch (error) {
    console.error('[RAG] Error in processRAGFileFromS3:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

async function retrieveContextAPI(req, res) {
  try {
    const { query, documentId, topK = 5, threshold } = req.body;

    if (!query || !documentId) {
      return res.status(400).json({
        success: false,
        message: 'query and documentId required'
      });
    }

    const contexts = await retrieveContext(query, documentId, topK, threshold);

    return res.status(200).json({
      success: true,
      data: contexts
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

async function retrieveContextBatchAPI(req, res) {
  try {
    const { queries, documentId, topK = 5 } = req.body;

    if (!queries || !documentId) {
      return res.status(400).json({
        success: false,
        message: 'queries and documentId required'
      });
    }

    const results = await retrieveContextBatch(queries, documentId, topK);

    return res.status(200).json({
      success: true,
      data: results
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

async function getDocumentVectors(req, res) {
  try {
    const { documentId } = req.params;

    if (!documentId) {
      return res.status(400).json({
        success: false,
        message: 'documentId required'
      });
    }

    const vectorData = await getVectorData(documentId);

    return res.status(200).json({
      success: true,
      data: vectorData
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

async function splitByPageRangesAPI(req, res) {
  try {
    const {
      fileKey,
      pageRanges,
      chapterId,
      syllabusId,
      standardId,
      subjectId
    } = req.body;

    if (!fileKey || !pageRanges || !Array.isArray(pageRanges) || pageRanges.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'fileKey and pageRanges array (with title, startPage, endPage) are required'
      });
    }

    // Validate pageRanges structure
    const invalidRanges = pageRanges.filter(r => !r.title || typeof r.startPage !== 'number' || typeof r.endPage !== 'number');
    if (invalidRanges.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Each pageRange must have title (string), startPage (number), and endPage (number)'
      });
    }

    // Download file from S3
    const s3Object = await s3.getObject({
      Bucket: S3_BUCKET,
      Key: fileKey
    }).promise();

    const pdfBuffer = s3Object.Body;

    // Extract text from PDF
    const { extractTextFromPDF } = require('./pdfProcessor');
    const text = await extractTextFromPDF(pdfBuffer);

    // Split by page ranges
    const { splitByPageRanges } = require('./textSplitter');
    const sections = splitByPageRanges(text, pageRanges);

    console.log(`[RAG] Split PDF into ${sections.length} sections by page ranges`);

    // Process sections to create chunks
    const { processSectionsToChunks } = require('./textSplitter');
    const allChunks = await processSectionsToChunks(sections);
    console.log(`[RAG] Created ${allChunks.length} chunks from ${sections.length} sections`);

    // Generate embeddings for all chunks
    const { generateEmbeddings } = require('./embeddings');
    const texts = allChunks.map(chunk => chunk.text);
    const embeddings = await generateEmbeddings(texts);

    // Combine chunks with embeddings
    const chunksWithEmbeddings = allChunks.map((chunk, index) => ({
      ...chunk,
      embedding: embeddings[index]
    }));

    console.log(`[RAG] Generated ${chunksWithEmbeddings.length} vector embeddings`);

    // Group chunks by section and store each section
    const storedSections = [];
    const sectionMap = {};

    // Group chunks by section number
    chunksWithEmbeddings.forEach(chunk => {
      if (!sectionMap[chunk.sectionNumber]) {
        sectionMap[chunk.sectionNumber] = {
          sectionNumber: chunk.sectionNumber,
          sectionTitle: chunk.sectionTitle,
          chunks: []
        };
      }
      sectionMap[chunk.sectionNumber].chunks.push(chunk);
    });

    // Store each section with its chunks
    const { storeSectionWithEmbeddings } = require('./sectionStore');
    for (const sectionNumber in sectionMap) {
      const sectionData = sectionMap[sectionNumber];
      try {
        const storedSection = await storeSectionWithEmbeddings({
          chapterId: chapterId || fileKey,
          sectionNumber: sectionData.sectionNumber,
          sectionTitle: sectionData.sectionTitle,
          syllabusId,
          standardId,
          subjectId,
          chunks: sectionData.chunks
        });
        storedSections.push(storedSection);
        console.log(`[RAG] Stored section ${sectionNumber} with ${sectionData.chunks.length} chunks`);
      } catch (sectionError) {
        console.warn(`[RAG] Warning: Could not store section ${sectionNumber}:`, sectionError.message);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        totalSections: storedSections.length,
        sections: storedSections.map(s => ({
          sectionId: s.sectionId,
          sectionNumber: s.sectionNumber,
          sectionTitle: s.sectionTitle,
          totalChunks: s.totalChunks
        }))
      }
    });

  } catch (error) {
    console.error('[RAG] Error in splitByPageRangesAPI:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

module.exports = {
  generatePresignedUrlForRAG,
  processRAGFileFromS3,
  retrieveContextAPI,
  retrieveContextBatchAPI,
  getDocumentVectors,
  splitByPageRangesAPI
};
