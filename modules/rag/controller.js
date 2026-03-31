const AWS = require('aws-sdk');
const { retrieveContext, retrieveContextBatch } = require('./retriever');
const { getVectorData } = require('./dynamodbStore');
const { createJob, getJobStatus } = require('./jobQueue');
const { pollAndProcessJobs } = require('./backgroundWorker');

// Use Lambda execution role - no explicit credentials needed
const s3 = new AWS.S3({
  region: process.env.AWS_REGION || 'ap-south-1',
  signatureVersion: 'v4'
});

const S3_BUCKET = process.env.S3_BUCKET_NAME || 'test-series-books';

// NEW: Batch generate presigned URLs for multiple files
async function batchGeneratePresignedUrls(req, res) {
  try {
    const { files } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'files array is required and must not be empty'
      });
    }

    if (files.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 50 files allowed per batch'
      });
    }

    const MAX_FILE_SIZE = 500 * 1024 * 1024;
    const results = [];

    for (const file of files) {
      const { fileName, fileSize, documentId } = file;

      // Validate each file
      if (!fileName || !documentId) {
        results.push({
          fileName: fileName || 'unknown',
          documentId: documentId || 'unknown',
          success: false,
          error: 'fileName and documentId are required'
        });
        continue;
      }

      if (fileSize && fileSize > MAX_FILE_SIZE) {
        results.push({
          fileName,
          documentId,
          success: false,
          error: 'File size exceeds 500MB limit'
        });
        continue;
      }

      try {
        const fileKey = `rag/${documentId}/${Date.now()}-${fileName}`;

        const presignedUrl = s3.getSignedUrl('putObject', {
          Bucket: S3_BUCKET,
          Key: fileKey,
          ContentType: 'application/pdf',
          Expires: 3600
        });

        results.push({
          fileName,
          documentId,
          success: true,
          data: {
            presignedUrl,
            fileKey,
            expiresIn: 3600
          }
        });
      } catch (error) {
        results.push({
          fileName,
          documentId,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    return res.status(200).json({
      success: true,
      data: {
        results,
        summary: {
          total: files.length,
          successful: successCount,
          failed: failureCount
        }
      }
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}
async function batchProcessFromS3(req, res) {
  try {
    const { files } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'files array is required and must not be empty'
      });
    }

    if (files.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 50 files allowed per batch'
      });
    }

    const results = [];
    const { processPDFToSections } = require('./pdfProcessor');
    const hierarchyService = require('../file-hierarchy/service');

    // Helper function to convert term format
    const convertTermFormat = (termStr) => {
      if (!termStr) return null;
      if (termStr === 'TERM_1' || termStr === 'TERM_2' || termStr === 'TERM_3') {
        return termStr;
      }
      const termMap = {
        'Term I': 'TERM_1',
        'Term II': 'TERM_2',
        'Term III': 'TERM_3'
      };
      return termMap[termStr] || termStr;
    };

    // Process each file
    for (const file of files) {
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
        sectionTitles,
        term,
        unitSectionTitles
      } = file;

      // Validate required fields
      if (!fileKey || !documentId) {
        results.push({
          fileName: fileName || 'unknown',
          documentId: documentId || 'unknown',
          success: false,
          error: 'fileKey and documentId are required'
        });
        continue;
      }

      try {
        // Map bookType to division if needed
        let finalDivision = division;
        const isEnglish = subjectId === 'SUB_ENG' || subjectId === 'English';
        const isSocialScience = subjectId === 'SUB_SS' || subjectId === 'SUB_SOC' || subjectId === 'Social Science';
        const isHindi = subjectId === 'SUB_HIN' || subjectId === 'Hindi' || subjectId === 'हिंदी';
        const isHindi9 = isHindi && (standardId === 'STD_9' || standardId === '9');
        const isHindi10 = isHindi && (standardId === 'STD_10' || standardId === '10');

        if (bookType && !division && isEnglish) {
          // English book type mapping
          const bookTypeMap = {
            'main': 'Chapters',
            'supplementary': 'Poems',
            'workbook': 'Workbook'
          };
          finalDivision = bookTypeMap[bookType.toLowerCase()];
          if (!finalDivision) {
            results.push({
              fileName,
              documentId,
              success: false,
              error: 'bookType must be one of: main, supplementary, workbook'
            });
            continue;
          }
        } else if (bookType && !division && isSocialScience) {
          // Social Science book part mapping
          const socialSciencePartMap = {
            'Part I': 'Part I',
            'Part II': 'Part II',
            'Contemporary India': 'Contemporary India',
            'Economics': 'Economics',
            'India and the Contemporary World': 'India and the Contemporary World',
            'Democratic Politics': 'Democratic Politics'
          };
          finalDivision = socialSciencePartMap[bookType];
          if (!finalDivision) {
            results.push({
              fileName,
              documentId,
              success: false,
              error: 'bookType for Social Science must be one of: Part I, Part II, Contemporary India, Economics, India and the Contemporary World, Democratic Politics'
            });
            continue;
          }
        } else if (bookType && !division && isHindi9) {
          // Hindi 9th standard book type mapping
          const hindiBookTypeMap = {
            'Sparsh': 'Sparsh',
            'स्पर्श': 'Sparsh',
            'Sanchayan': 'Sanchayan',
            'संचयन': 'Sanchayan',
            'Kshitij': 'Kshitij',
            'क्षितिज': 'Kshitij',
            'कृतिका': 'कृतिका',
            'Kritika': 'कृतिका'
          };
          finalDivision = hindiBookTypeMap[bookType];
          if (!finalDivision) {
            results.push({
              fileName,
              documentId,
              success: false,
              error: 'bookType for 9th Hindi must be one of: Sparsh (स्पर्श), Sanchayan (संचयन), Kshitij (क्षितिज), कृतिका'
            });
            continue;
          }
        } else if (bookType && !division && isHindi10) {
          // Hindi 10th standard book type mapping
          const hindiBookTypeMap = {
            'Sparsh': 'Sparsh',
            'स्पर्श': 'Sparsh',
            'Sanchayan': 'Sanchayan',
            'संचयन': 'Sanchayan',
            'Kshitij': 'Kshitij',
            'क्षितिज': 'Kshitij',
            'कृतिका': 'कृतिका',
            'Kritika': 'कृतिका'
          };
          finalDivision = hindiBookTypeMap[bookType];
          if (!finalDivision) {
            results.push({
              fileName,
              documentId,
              success: false,
              error: 'bookType for 10th Hindi must be one of: Sparsh (स्पर्श), Sanchayan (संचयन), Kshitij (क्षितिज), कृतिका'
            });
            continue;
          }
        }

        // Detect TN State Board
        const isTNStateBoard = syllabusId && syllabusId.toUpperCase().includes('TN');

        // Normalize standardId to handle both STD_8 and STD_8_TN formats
        const normalizeStandardId = (id) => {
          if (!id) return id;
          // Remove _TN suffix if present
          return String(id).replace(/_TN$/, '');
        };
        const normalizedStandardId = normalizeStandardId(standardId);

        // Normalize TN Social Science divisions to uppercase (for History, Geography, Civics, Economics)
        if (isTNStateBoard && isSocialScience && finalDivision) {
          const tnSocialScienceDivisionMap = {
            'History': 'HISTORY',
            'history': 'HISTORY',
            'HISTORY': 'HISTORY',
            'Geography': 'GEOGRAPHY',
            'geography': 'GEOGRAPHY',
            'GEOGRAPHY': 'GEOGRAPHY',
            'Civics': 'CIVICS',
            'civics': 'CIVICS',
            'CIVICS': 'CIVICS',
            'Economics': 'ECONOMICS',
            'economics': 'ECONOMICS',
            'ECONOMICS': 'ECONOMICS'
          };
          
          if (tnSocialScienceDivisionMap[finalDivision]) {
            console.log(`[BATCH] Normalized TN Social Science division '${finalDivision}' to '${tnSocialScienceDivisionMap[finalDivision]}'`);
            finalDivision = tnSocialScienceDivisionMap[finalDivision];
          }
        }

        // Validate term for TN State Board
        if (isTNStateBoard && term) {
          const validTermsFrontend = ['Term I', 'Term II', 'Term III'];
          const validTermsDatabase = ['TERM_1', 'TERM_2', 'TERM_3'];
          const allValidTerms = [...validTermsFrontend, ...validTermsDatabase];
          if (!allValidTerms.includes(term)) {
            results.push({
              fileName,
              documentId,
              success: false,
              error: `term must be one of: ${validTermsFrontend.join(', ')} or ${validTermsDatabase.join(', ')}`
            });
            continue;
          }
        }

        // Validate division for 9th and 10th English
        const isEnglish9or10 = (standardId === 'STD_9' || standardId === 'STD_10' || standardId === '9' || standardId === '10') &&
                               (subjectId === 'SUB_ENG' || subjectId === 'English');
        if (isEnglish9or10 && !finalDivision) {
          results.push({
            fileName,
            documentId,
            success: false,
            error: 'division or bookType is required for 9th and 10th English'
          });
          continue;
        }

        // Validate division value
        const validDivisions = ['Chapters', 'Poems', 'Workbook', 'Part I', 'Part II', 'Contemporary India', 'Economics', 'India and the Contemporary World', 'Democratic Politics', 'Sparsh', 'Sanchayan', 'Kshitij', 'कृतिका', 'HISTORY', 'GEOGRAPHY', 'CIVICS', 'ECONOMICS'];
        if (finalDivision && !validDivisions.includes(finalDivision)) {
          results.push({
            fileName,
            documentId,
            success: false,
            error: `division must be one of: ${validDivisions.join(', ')}`
          });
          continue;
        }

        // Validate splitPattern
        const validSplitPatterns = ['regex_based', 'heading_based', 'chapter_based', 'manual_anchors', 'ai_based'];
        if (splitPattern && !validSplitPatterns.includes(splitPattern)) {
          results.push({
            fileName,
            documentId,
            success: false,
            error: `splitPattern must be one of: ${validSplitPatterns.join(', ')}`
          });
          continue;
        }

        // Verify file exists in S3
        await s3.headObject({
          Bucket: S3_BUCKET,
          Key: fileKey
        }).promise();

        // Download file from S3
        const s3Object = await s3.getObject({
          Bucket: S3_BUCKET,
          Key: fileKey
        }).promise();

        const pdfBuffer = s3Object.Body;
        const dbTerm = convertTermFormat(term);

        let chapterData = null;

        // Create chapter in hierarchy (skip for TN State Board)
        if (syllabusId && standardId && subjectId && chapterName && !isTNStateBoard) {
          try {
            chapterData = await hierarchyService.createChapter(
              subjectId,
              chapterName,
              documentId,
              syllabusId,
              standardId,
              finalDivision || null,
              dbTerm
            );
          } catch (e) {
            console.warn(`[BATCH] Hierarchy creation failed for ${fileName}:`, e.message);
          }
        }

        // Process PDF to sections
        const storedSections = await processPDFToSections(pdfBuffer, {
          chapterId: chapterData?.chapterId || documentId,
          documentId: documentId,
          chapterName: chapterName || fileName || null,
          syllabusId,
          standardId,
          subjectId,
          division: finalDivision || null,
          bookType: bookType || null,
          pageRanges: pageRanges && Array.isArray(pageRanges) && pageRanges.length > 0 ? pageRanges : null,
          splitPattern: splitPattern || 'regex_based',
          sectionTitles: sectionTitles && Array.isArray(sectionTitles) && sectionTitles.length > 0 ? sectionTitles : null,
          isTNStateBoard: isTNStateBoard,
          term: term || null,
          unitSectionTitles: unitSectionTitles || null
        });

        const splitStrategyUsed = (pageRanges && Array.isArray(pageRanges) && pageRanges.length > 0)
          ? 'page_ranges'
          : (splitPattern || 'regex_based');

        results.push({
          fileName,
          documentId,
          success: true,
          data: {
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
        console.error(`[BATCH] Error processing ${fileName}:`, error.message);
        results.push({
          fileName,
          documentId,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    return res.status(200).json({
      success: true,
      data: {
        results,
        summary: {
          total: files.length,
          successful: successCount,
          failed: failureCount
        }
      }
    });

  } catch (error) {
    console.error('[BATCH] Error in batchProcessFromS3:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

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
      sectionTitles,
      chapterSections,
      term,
      unitSectionTitles
    } = req.body;

    console.log('[RAG] processRAGFileFromS3 - Request body:', {
      fileKey,
      documentId,
      fileName,
      syllabusId,
      standardId,
      subjectId,
      chapterName,
      division,
      bookType,
      chapterSections: chapterSections ? `PROVIDED (${chapterSections.length} sections)` : 'NOT PROVIDED',
      term: term || 'NOT PROVIDED',
      unitSectionTitles: unitSectionTitles ? 'PROVIDED' : 'NOT PROVIDED'
    });

    if (!fileKey || !documentId) {
      return res.status(400).json({
        success: false,
        message: 'fileKey and documentId are required'
      });
    }

    let finalDivision = division;
    // Handle bookType for English, Social Science, and Hindi books
    const isEnglish = subjectId === 'SUB_ENG' || subjectId === 'English';
    const isSocialScience = subjectId === 'SUB_SS' || subjectId === 'SUB_SOC' || subjectId === 'Social Science';
    const isHindi = subjectId === 'SUB_HIN' || subjectId === 'Hindi' || subjectId === 'हिंदी';
    const isHindi9 = isHindi && (standardId === 'STD_9' || standardId === '9');
    const isHindi10 = isHindi && (standardId === 'STD_10' || standardId === '10');

    if (bookType && !division && isEnglish) {
      // English book type mapping
      const bookTypeMap = {
        'main': 'Chapters',
        'supplementary': 'Poems',
        'workbook': 'Workbook'
      };
      finalDivision = bookTypeMap[bookType.toLowerCase()];

      if (!finalDivision) {
        return res.status(400).json({
          success: false,
          message: `bookType must be one of: main, supplementary, workbook`
        });
      }
      console.log(`[RAG] Mapped English bookType '${bookType}' to division '${finalDivision}'`);
    } else if (bookType && !division && isSocialScience) {
      // Social Science book part mapping
      const socialSciencePartMap = {
        // 7th & 8th standard parts
        'Part I': 'Part I',
        'Part II': 'Part II',
        // 9th & 10th standard parts
        'Contemporary India': 'Contemporary India',
        'Economics': 'Economics',
        'India and the Contemporary World': 'India and the Contemporary World',
        'Democratic Politics': 'Democratic Politics'
      };

      finalDivision = socialSciencePartMap[bookType];

      if (!finalDivision) {
        return res.status(400).json({
          success: false,
          message: `bookType for Social Science must be one of: Part I, Part II, Contemporary India, Economics, India and the Contemporary World, Democratic Politics`
        });
      }
      console.log(`[RAG] Mapped Social Science bookType '${bookType}' to division '${finalDivision}'`);
    } else if (bookType && !division && isHindi9) {
      // Hindi 9th standard book type mapping
      const hindiBookTypeMap = {
        'Sparsh': 'Sparsh',
        'स्पर्श': 'Sparsh',
        'Sanchayan': 'Sanchayan',
        'संचयन': 'Sanchayan',
        'Kshitij': 'Kshitij',
        'क्षितिज': 'Kshitij',
        'कृतिका': 'कृतिका',
        'Kritika': 'कृतिका'
      };

      finalDivision = hindiBookTypeMap[bookType];

      if (!finalDivision) {
        return res.status(400).json({
          success: false,
          message: `bookType for 9th Hindi must be one of: Sparsh (स्पर्श), Sanchayan (संचयन), Kshitij (क्षितिज), कृतिका`
        });
      }
      console.log(`[RAG] Mapped Hindi 9th bookType '${bookType}' to division '${finalDivision}'`);
    } else if (bookType && !division && isHindi10) {
      // Hindi 10th standard book type mapping
      const hindiBookTypeMap = {
        'Sparsh': 'Sparsh',
        'स्पर्श': 'Sparsh',
        'Sanchayan': 'Sanchayan',
        'संचयन': 'Sanchayan',
        'Kshitij': 'Kshitij',
        'क्षितिज': 'Kshitij',
        'कृतिका': 'कृतिका',
        'Kritika': 'कृतिका'
      };

      finalDivision = hindiBookTypeMap[bookType];

      if (!finalDivision) {
        return res.status(400).json({
          success: false,
          message: `bookType for 10th Hindi must be one of: Sparsh (स्पर्श), Sanchayan (संचयन), Kshitij (क्षितिज), कृतिका`
        });
      }
      console.log(`[RAG] Mapped Hindi 10th bookType '${bookType}' to division '${finalDivision}'`);
    } else if (bookType && !isEnglish && !isSocialScience && !isHindi9 && !isHindi10) {
      // For other subjects, bookType is ignored
      console.log(`[RAG] bookType provided for non-English/non-Social-Science/non-Hindi-9th/non-Hindi-10th subject (${subjectId}), ignoring it`);
    }

    // Detect TN State Board books
    const isTNStateBoard = syllabusId && syllabusId.toUpperCase().includes('TN');
    console.log(`[RAG] Detected TN State Board book: ${isTNStateBoard}, syllabusId: ${syllabusId}`);

    // Normalize standardId to handle both STD_8 and STD_8_TN formats
    const normalizeStandardId = (id) => {
      if (!id) return id;
      // Remove _TN suffix if present
      return String(id).replace(/_TN$/, '');
    };
    const normalizedStandardId = normalizeStandardId(standardId);

    // Normalize TN Social Science divisions to uppercase (for History, Geography, Civics, Economics)
    if (isTNStateBoard && isSocialScience && finalDivision) {
      const tnSocialScienceDivisionMap = {
        'History': 'HISTORY',
        'history': 'HISTORY',
        'HISTORY': 'HISTORY',
        'Geography': 'GEOGRAPHY',
        'geography': 'GEOGRAPHY',
        'GEOGRAPHY': 'GEOGRAPHY',
        'Civics': 'CIVICS',
        'civics': 'CIVICS',
        'CIVICS': 'CIVICS',
        'Economics': 'ECONOMICS',
        'economics': 'ECONOMICS',
        'ECONOMICS': 'ECONOMICS'
      };
      
      if (tnSocialScienceDivisionMap[finalDivision]) {
        console.log(`[RAG] Normalized TN Social Science division '${finalDivision}' to '${tnSocialScienceDivisionMap[finalDivision]}'`);
        finalDivision = tnSocialScienceDivisionMap[finalDivision];
      }
    }

    // Validate term for TN State Board books
    if (isTNStateBoard) {
      if (term) {
        // Accept both frontend format (Term I) and database format (TERM_1)
        const validTermsFrontend = ['Term I', 'Term II', 'Term III'];
        const validTermsDatabase = ['TERM_1', 'TERM_2', 'TERM_3'];
        const allValidTerms = [...validTermsFrontend, ...validTermsDatabase];

        if (!allValidTerms.includes(term)) {
          return res.status(400).json({
            success: false,
            message: `term must be one of: ${validTermsFrontend.join(', ')} or ${validTermsDatabase.join(', ')}`
          });
        }
        console.log(`[RAG] TN State Board term: ${term}`);
      } else {
        console.log(`[RAG] WARNING: TN State Board book uploaded without term parameter`);
      }
    }

    // Validate division for 9th and 10th English
    const isEnglish9or10 = (standardId === 'STD_9' || standardId === 'STD_10' || standardId === '9' || standardId === '10') &&
                           (subjectId === 'SUB_ENG' || subjectId === 'English');
    if (isEnglish9or10 && !finalDivision) {
      return res.status(400).json({
        success: false,
        message: 'division or bookType is required for 9th and 10th English (Chapters, Poems, or Workbook)'
      });
    }

    // Validate division for 9th Hindi (using isHindi9 already declared above)
    if (isHindi9 && !finalDivision) {
      return res.status(400).json({
        success: false,
        message: 'division or bookType is required for 9th Hindi (Sparsh, Sanchayan, Kshitij, or कृतिका)'
      });
    }

    // Validate division for 10th Hindi (using isHindi10 already declared above)
    if (isHindi10 && !finalDivision) {
      return res.status(400).json({
        success: false,
        message: 'division or bookType is required for 10th Hindi (Sparsh, Sanchayan, Kshitij, or कृतिका)'
      });
    }

    // Validate division for Social Science books
    const isSocialScience7to10 = (normalizedStandardId === 'STD_7' || normalizedStandardId === 'STD_8' || normalizedStandardId === 'STD_9' || normalizedStandardId === 'STD_10' ||
                                  normalizedStandardId === '7' || normalizedStandardId === '8' || normalizedStandardId === '9' || normalizedStandardId === '10') &&
                                 (subjectId === 'SUB_SS' || subjectId === 'SUB_SOC' || subjectId === 'Social Science');
    
    // For 8th Social Science TN State Board books, division comes from Claude API, so skip validation
    const isTNSocialScience8 = isTNStateBoard && isSocialScience7to10 && 
                               (normalizedStandardId === 'STD_8' || normalizedStandardId === '8');
    
    if (isSocialScience7to10 && !finalDivision && !isTNSocialScience8) {
      const validParts = normalizedStandardId === 'STD_7' || normalizedStandardId === 'STD_8' || normalizedStandardId === '7' || normalizedStandardId === '8'
        ? 'Part I, Part II'
        : 'Contemporary India, Economics, India and the Contemporary World, Democratic Politics';
      return res.status(400).json({
        success: false,
        message: `division or bookType is required for Social Science (${validParts})`
      });
    }
    
    if (isTNSocialScience8) {
      console.log('[RAG] TN State Board 8th Social Science book detected - division will be passed from UI request');
    }

    // Validate division value if provided
    const validDivisions = ['Chapters', 'Poems', 'Workbook', 'Part I', 'Part II', 'Contemporary India', 'Economics', 'India and the Contemporary World', 'Democratic Politics', 'Sparsh', 'Sanchayan', 'Kshitij', 'कृतिका', 'HISTORY', 'GEOGRAPHY', 'CIVICS', 'ECONOMICS'];
    if (finalDivision && !validDivisions.includes(finalDivision)) {
      return res.status(400).json({
        success: false,
        message: `division must be one of: ${validDivisions.join(', ')}`
      });
    }

    // Validate splitPattern if provided
    const validSplitPatterns = ['regex_based', 'heading_based', 'chapter_based', 'manual_anchors', 'ai_based'];
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

    // Validate chapterSections if provided (for TN Math books - filter specific chapter sections)
    if (chapterSections && Array.isArray(chapterSections) && chapterSections.length > 0) {
      const invalidSections = chapterSections.filter(s => 
        !s.chapterNumber || 
        typeof s.chapterNumber !== 'number' ||
        !Array.isArray(s.sections) ||
        s.sections.length === 0
      );

      if (invalidSections.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Each chapterSection must have chapterNumber (number) and sections (array of section numbers like [1, 2, 3])'
        });
      }

      // Validate section numbers are numbers
      for (const chapter of chapterSections) {
        const invalidNums = chapter.sections.filter(s => typeof s !== 'number' && typeof s !== 'string');
        if (invalidNums.length > 0) {
          return res.status(400).json({
            success: false,
            message: `Chapter ${chapter.chapterNumber}: All section numbers must be numbers or strings (e.g., 1, 2, 3 or "1", "2", "3")`
          });
        }
      }

      console.log('[RAG] chapterSections validated:', chapterSections.map(c => ({
        chapterNumber: c.chapterNumber,
        sections: c.sections
      })));
    }

    // Validate unitSectionTitles if provided (for TN State Board books)
    if (unitSectionTitles) {
      if (!Array.isArray(unitSectionTitles)) {
        return res.status(400).json({
          success: false,
          message: 'unitSectionTitles must be an array'
        });
      }

      // Validate structure: array of objects with unitNumber and sections
      const invalidUnits = unitSectionTitles.filter(unit =>
        !unit.unitNumber ||
        typeof unit.unitNumber !== 'number' ||
        !Array.isArray(unit.sections) ||
        unit.sections.length === 0
      );

      if (invalidUnits.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Each unit in unitSectionTitles must have unitNumber (number) and sections (array of strings)'
        });
      }

      // Validate section titles are non-empty strings
      for (const unit of unitSectionTitles) {
        const invalidSections = unit.sections.filter(s => typeof s !== 'string' || s.trim().length === 0);
        if (invalidSections.length > 0) {
          return res.status(400).json({
            success: false,
            message: `Unit ${unit.unitNumber}: All section titles must be non-empty strings`
          });
        }
      }

      console.log('[RAG] unitSectionTitles validated:', unitSectionTitles.map(u => ({
        unitNumber: u.unitNumber,
        sectionCount: u.sections.length
      })));
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

    // Convert term format to database format (TERM_1, TERM_2, TERM_3)
    const convertTermFormat = (termStr) => {
      if (!termStr) return null;

      // If already in database format, return as-is
      if (termStr === 'TERM_1' || termStr === 'TERM_2' || termStr === 'TERM_3') {
        return termStr;
      }

      // Convert from frontend format to database format
      const termMap = {
        'Term I': 'TERM_1',
        'Term II': 'TERM_2',
        'Term III': 'TERM_3'
      };
      return termMap[termStr] || termStr;
    };

    const dbTerm = convertTermFormat(term);

    console.log('[RAG] Term conversion:', {
      originalTerm: term,
      convertedTerm: dbTerm,
      isTNStateBoard
    });

    let chapterData = null;

    // For TN State Board books, skip creating main chapter as we'll create unit chapters instead
    if (syllabusId && standardId && subjectId && chapterName && !isTNStateBoard) {
      try {
        console.log('[RAG] Calling createChapter with parameters:', {
          subjectId,
          chapterName,
          fileId: documentId,
          syllabusId,
          standardId,
          division: finalDivision || null,
          term: dbTerm
        });

        chapterData = await hierarchyService.createChapter(
          subjectId,
          chapterName,
          documentId,
          syllabusId,
          standardId,
          finalDivision || null,
          dbTerm
        );

        console.log('[RAG] createChapter returned:', chapterData);
      } catch (e) {
        console.warn('Hierarchy creation failed:', e.message);
      }
    } else if (isTNStateBoard) {
      console.log('[RAG] Skipping main chapter creation for TN State Board book - will create unit chapters instead');
    }

    const { processPDFToSections } = require('./pdfProcessor');

    console.log('[RAG] DEBUG: About to call processPDFToSections with metadata:', {
      chapterId: chapterData?.chapterId || documentId,
      syllabusId,
      standardId,
      subjectId,
      division: finalDivision || null,
      splitPattern: splitPattern || 'regex_based',
      term: term || null
    });

    const storedSections = await processPDFToSections(pdfBuffer, {
      chapterId: chapterData?.chapterId || documentId,
      documentId: documentId,
      chapterName: chapterName || fileName || null,
      syllabusId,
      standardId,
      subjectId,
      division: finalDivision || null,
      bookType: bookType || null,
      pageRanges: pageRanges && Array.isArray(pageRanges) && pageRanges.length > 0 ? pageRanges : null,
      splitPattern: splitPattern || 'regex_based',
      sectionTitles: sectionTitles && Array.isArray(sectionTitles) && sectionTitles.length > 0 ? sectionTitles : null,
      chapterSections: chapterSections && Array.isArray(chapterSections) && chapterSections.length > 0 ? chapterSections : null,
      isTNStateBoard: isTNStateBoard,
      term: term || null,
      unitSectionTitles: unitSectionTitles || null
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

/**
 * Queue a single file for async processing
 * Returns immediately with jobId, processing happens in background
 */
async function queueProcessFromS3(req, res) {
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
      sectionTitles,
      term,
      unitSectionTitles
    } = req.body;

    // Validate required fields
    if (!fileKey || !documentId) {
      return res.status(400).json({
        success: false,
        message: 'fileKey and documentId are required'
      });
    }

    // Map bookType to division if provided
    let finalDivision = division;
    if (bookType && !division) {
      const isEnglish = subjectId === 'SUB_ENG' || subjectId === 'English';
      const isSocialScience = subjectId === 'SUB_SS' || subjectId === 'SUB_SOC' || subjectId === 'Social Science';
      const isHindi = subjectId === 'SUB_HIN' || subjectId === 'Hindi' || subjectId === 'हिंदी';
      const isHindi9 = isHindi && (standardId === 'STD_9' || standardId === '9');
      const isHindi10 = isHindi && (standardId === 'STD_10' || standardId === '10');

      if (isEnglish) {
        const bookTypeMap = {
          'main': 'Chapters',
          'supplementary': 'Poems',
          'workbook': 'Workbook'
        };
        finalDivision = bookTypeMap[bookType.toLowerCase()];

        if (!finalDivision) {
          return res.status(400).json({
            success: false,
            message: `bookType must be one of: main, supplementary, workbook`
          });
        }
      } else if (isSocialScience) {
        const socialSciencePartMap = {
          'Part I': 'Part I',
          'Part II': 'Part II',
          'Contemporary India': 'Contemporary India',
          'Economics': 'Economics',
          'India and the Contemporary World': 'India and the Contemporary World',
          'Democratic Politics': 'Democratic Politics'
        };
        finalDivision = socialSciencePartMap[bookType];

        if (!finalDivision) {
          return res.status(400).json({
            success: false,
            message: `bookType for Social Science must be one of: Part I, Part II, Contemporary India, Economics, India and the Contemporary World, Democratic Politics`
          });
        }
      } else if (isHindi9) {
        const hindiBookTypeMap = {
          'Sparsh': 'Sparsh',
          'स्पर्श': 'Sparsh',
          'Sanchayan': 'Sanchayan',
          'संचयन': 'Sanchayan',
          'Kshitij': 'Kshitij',
          'क्षितिज': 'Kshitij',
          'कृतिका': 'कृतिका',
          'Kritika': 'कृतिका'
        };
        finalDivision = hindiBookTypeMap[bookType];

        if (!finalDivision) {
          return res.status(400).json({
            success: false,
            message: `bookType for 9th Hindi must be one of: Sparsh (स्पर्श), Sanchayan (संचयन), Kshitij (क्षितिज), कृतिका`
          });
        }
      } else if (isHindi10) {
        const hindiBookTypeMap = {
          'Sparsh': 'Sparsh',
          'स्पर्श': 'Sparsh',
          'Sanchayan': 'Sanchayan',
          'संचयन': 'Sanchayan',
          'Kshitij': 'Kshitij',
          'क्षितिज': 'Kshitij',
          'कृतिका': 'कृतिका',
          'Kritika': 'कृतिका'
        };
        finalDivision = hindiBookTypeMap[bookType];

        if (!finalDivision) {
          return res.status(400).json({
            success: false,
            message: `bookType for 10th Hindi must be one of: Sparsh (स्पर्श), Sanchayan (संचयन), Kshitij (क्षितिज), कृतिका`
          });
        }
      }
    }

    // Detect TN State Board books
    const isTNStateBoard = syllabusId && syllabusId.toUpperCase().includes('TN');

    // Validate term for TN State Board books
    if (isTNStateBoard && term) {
      const validTermsFrontend = ['Term I', 'Term II', 'Term III'];
      const validTermsDatabase = ['TERM_1', 'TERM_2', 'TERM_3'];
      const allValidTerms = [...validTermsFrontend, ...validTermsDatabase];

      if (!allValidTerms.includes(term)) {
        return res.status(400).json({
          success: false,
          message: `term must be one of: ${validTermsFrontend.join(', ')} or ${validTermsDatabase.join(', ')}`
        });
      }
    }

    // Validate division for 9th and 10th English
    const isEnglish9or10 = (standardId === 'STD_9' || standardId === 'STD_10' || standardId === '9' || standardId === '10') &&
                           (subjectId === 'SUB_ENG' || subjectId === 'English');
    if (isEnglish9or10 && !finalDivision) {
      return res.status(400).json({
        success: false,
        message: 'division or bookType is required for 9th and 10th English (Chapters, Poems, or Workbook)'
      });
    }

    // Validate division value if provided
    const validDivisions = ['Chapters', 'Poems', 'Workbook', 'Part I', 'Part II', 'Contemporary India', 'Economics', 'India and the Contemporary World', 'Democratic Politics', 'Sparsh', 'Sanchayan', 'Kshitij', 'कृतिका', 'HISTORY', 'GEOGRAPHY', 'CIVICS', 'ECONOMICS'];
    if (finalDivision && !validDivisions.includes(finalDivision)) {
      return res.status(400).json({
        success: false,
        message: `division must be one of: ${validDivisions.join(', ')}`
      });
    }

    // Validate splitPattern if provided
    const validSplitPatterns = ['regex_based', 'heading_based', 'chapter_based', 'manual_anchors', 'ai_based'];
    if (splitPattern && !validSplitPatterns.includes(splitPattern)) {
      return res.status(400).json({
        success: false,
        message: `splitPattern must be one of: ${validSplitPatterns.join(', ')}`
      });
    }

    // Verify file exists in S3
    try {
      await s3.headObject({
        Bucket: S3_BUCKET,
        Key: fileKey
      }).promise();
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: `File not found in S3: ${fileKey}`
      });
    }

    // Create job in queue
    const jobData = {
      documentId,
      fileKey,
      fileName: fileName || 'unknown',
      syllabusId: syllabusId || null,
      standardId: standardId || null,
      subjectId: subjectId || null,
      chapterName: chapterName || null,
      fileSize: 0, // Will be updated by background worker
      term: term || null,
      bookType: bookType || null,
      splitPattern: splitPattern || 'regex_based',
      sectionTitles: sectionTitles && Array.isArray(sectionTitles) && sectionTitles.length > 0 ? sectionTitles : null,
      unitSectionTitles: unitSectionTitles || null,
      isTNStateBoard: isTNStateBoard
    };

    const { jobId, status } = await createJob(jobData);

    console.log(`[RAG] File queued for processing: ${fileName} (jobId: ${jobId})`);

    return res.status(202).json({
      success: true,
      message: 'File queued for processing',
      data: {
        jobId,
        documentId,
        status
      }
    });

  } catch (error) {
    console.error('[RAG] Error in queueProcessFromS3:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Get job status
 */
async function getJobStatusAPI(req, res) {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        message: 'jobId is required'
      });
    }

    const jobStatus = await getJobStatus(jobId);

    return res.status(200).json({
      success: true,
      data: jobStatus
    });

  } catch (error) {
    if (error.message.includes('Job not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    console.error('[RAG] Error in getJobStatusAPI:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Manually trigger background worker to process queued jobs
 * Useful for testing or manual job processing
 */
async function triggerBackgroundWorker(req, res) {
  try {
    const { maxJobs = 5 } = req.body;

    if (maxJobs < 1 || maxJobs > 50) {
      return res.status(400).json({
        success: false,
        message: 'maxJobs must be between 1 and 50'
      });
    }

    console.log(`[RAG] Triggering background worker to process up to ${maxJobs} jobs`);

    const result = await pollAndProcessJobs(maxJobs);

    return res.status(200).json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[RAG] Error in triggerBackgroundWorker:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Get job details (more detailed than status)
 */
async function getJobDetails(req, res) {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        message: 'jobId is required'
      });
    }

    const { getJobForProcessing } = require('./jobQueue');
    const jobDetails = await getJobForProcessing(jobId);

    return res.status(200).json({
      success: true,
      data: jobDetails
    });

  } catch (error) {
    if (error.message.includes('Job not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    console.error('[RAG] Error in getJobDetails:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

module.exports = {
  batchGeneratePresignedUrls,
  batchProcessFromS3,
  generatePresignedUrlForRAG,
  processRAGFileFromS3,
  retrieveContextAPI,
  retrieveContextBatchAPI,
  getDocumentVectors,
  splitByPageRangesAPI,
  queueProcessFromS3,
  getJobStatusAPI,
  triggerBackgroundWorker,
  getJobDetails
};
