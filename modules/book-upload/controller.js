// Book Upload Controller - Handles file upload and chapter creation

const AWS = require('aws-sdk');
const hierarchyService = require('../file-hierarchy/service');

const s3 = new AWS.S3({
  region: process.env.AWS_REGION || 'ap-south-1'
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const BOOK_FILES_TABLE = process.env.BOOK_FILES_TABLE || 'BookFilesTable';
const CHAPTERS_TABLE = process.env.CHAPTERS_TABLE || 'ChaptersTable';
const S3_BUCKET = process.env.S3_BUCKET_NAME || 'test-series-books';

// Upload file to Anthropic and create chapter
const uploadBookFile = async (req, res) => {
  try {
    const { fileId, fileName, syllabusId, standardId, subjectId, chapterName, fileSize, division, bookType } = req.body;

    console.log('📚 Book Upload Request:', {
      fileId,
      fileName,
      syllabusId,
      standardId,
      subjectId,
      chapterName,
      fileSize,
      division,
      bookType
    });

    // Validate all required fields
    if (!fileId || !fileName || !syllabusId || !standardId || !subjectId || !chapterName) {
      console.error('❌ Validation failed - Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'fileId, fileName, syllabusId, standardId, subjectId, and chapterName are all required',
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
        console.error('❌ Validation failed - Invalid bookType');
        return res.status(400).json({
          success: false,
          message: `bookType must be one of: main, supplementary, workbook`,
        });
      }
      console.log(`[UPLOAD] Mapped bookType '${bookType}' to division '${finalDivision}'`);
    }

    // Validate division for 9th and 10th English
    const isEnglish9or10 = (standardId === 'STD_9' || standardId === 'STD_10' || standardId === '9' || standardId === '10') && 
                           (subjectId === 'SUB_ENG' || subjectId === 'English');
    if (isEnglish9or10 && !finalDivision) {
      console.error('❌ Validation failed - division is required for 9th and 10th English');
      return res.status(400).json({
        success: false,
        message: 'division or bookType is required for 9th and 10th English (Chapters, Poems, or Workbook)',
      });
    }

    // Validate division value if provided
    const validDivisions = ['Chapters', 'Poems', 'Workbook'];
    if (finalDivision && !validDivisions.includes(finalDivision)) {
      console.error('❌ Validation failed - Invalid division value');
      return res.status(400).json({
        success: false,
        message: `division must be one of: ${validDivisions.join(', ')}`,
      });
    }

    console.log('✅ All fields validated');

    // Create chapter with all hierarchy information
    console.log('📝 Creating chapter...');
    const chapter = await hierarchyService.createChapter(
      subjectId,
      chapterName,
      fileId,
      syllabusId,
      standardId,
      finalDivision || null
    );
    console.log('✅ Chapter created:', chapter);

    // Create book file record with complete hierarchy
    console.log('📄 Creating book file record...');
    const bookFile = await hierarchyService.createBookFile(
      fileId,
      fileName,
      chapter.chapterId,
      fileSize || 0,
      new Date().toISOString(),
      {
        chapterName: chapter.chapterName,
        syllabusId: chapter.syllabusId,
        standardId: chapter.standardId,
        subjectId: chapter.subjectId,
        division: chapter.division || null
      }
    );
    console.log('✅ Book file created:', bookFile);

    // Add hierarchy metadata to response
    res.status(201).json({
      success: true,
      data: {
        hierarchy: {
          syllabusId,
          standardId,
          subjectId,
          division: finalDivision || null
        },
        chapter,
        bookFile,
      },
      message: 'Book file uploaded and chapter created successfully',
    });
  } catch (error) {
    console.error('❌ Error in uploadBookFile:', error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get divisions for 9th and 10th English
const getDivisionsForEnglish = async (req, res) => {
  try {
    const { standardId, subjectId } = req.params;
    
    // Only return divisions for 9th and 10th English
    if ((standardId === '9' || standardId === '10') && subjectId === 'English') {
      return res.status(200).json({
        success: true,
        data: ['Chapters', 'Poems', 'Workbook'],
        message: 'Divisions fetched successfully'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: [],
      message: 'No divisions available for this subject'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get chapters for a subject (with optional division filter)
const getChaptersForSubject = async (req, res) => {
  try {
    const { subjectId, standardId, syllabusId } = req.params;
    const { division } = req.query;
    
    if (!subjectId || !standardId || !syllabusId) {
      return res.status(400).json({
        success: false,
        message: 'subjectId, standardId, and syllabusId are all required'
      });
    }
    
    let chapters = await hierarchyService.getChaptersBySubject(subjectId, standardId, syllabusId);
    
    // Filter by division if provided (for 9th and 10th English)
    if (division && (standardId === '9' || standardId === '10') && subjectId === 'English') {
      chapters = chapters.filter(ch => ch.division === division);
    }
    
    res.status(200).json({
      success: true,
      data: chapters,
      message: 'Chapters fetched successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get book files for a chapter
const getBookFilesForChapter = async (req, res) => {
  try {
    const { chapterId } = req.params;
    if (!chapterId) {
      return res.status(400).json({
        success: false,
        message: 'chapterId is required',
      });
    }
    const bookFiles = await hierarchyService.getBookFilesByChapter(chapterId);
    res.status(200).json({
      success: true,
      data: bookFiles,
      message: 'Book files fetched successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get all books from database
const getAllBooks = async (req, res) => {
  try {
    const books = await hierarchyService.getAllBooks();
    res.status(200).json({
      success: true,
      data: books,
      count: books.length,
      message: 'All books fetched successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Download book file from S3
const downloadBook = async (req, res) => {
  try {
    const { bookId, fileId } = req.params;

    if (!bookId || !fileId) {
      return res.status(400).json({
        success: false,
        message: 'bookId and fileId are required'
      });
    }

    // Get book file details from DynamoDB
    const bookFile = await hierarchyService.getBookFileById(bookId, fileId);

    if (!bookFile) {
      return res.status(404).json({
        success: false,
        message: 'Book file not found'
      });
    }

    // Construct S3 key
    const s3Key = `books/${fileId}/${bookFile.fileName}`;

    // Check if file exists in S3
    try {
      await s3.headObject({
        Bucket: S3_BUCKET,
        Key: s3Key
      }).promise();
    } catch (headError) {
      if (headError.code === 'NotFound') {
        return res.status(404).json({
          success: false,
          message: 'File not found in S3'
        });
      }
      throw headError;
    }

    // Get file from S3
    const s3Object = await s3.getObject({
      Bucket: S3_BUCKET,
      Key: s3Key
    }).promise();

    // Set response headers for file download
    res.setHeader('Content-Type', s3Object.ContentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${bookFile.fileName}"`);
    res.setHeader('Content-Length', s3Object.ContentLength);

    // Send file to client
    res.send(s3Object.Body);

  } catch (error) {
    console.error('Error downloading book:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Delete book file from S3 and DynamoDB
const deleteBook = async (req, res) => {
  try {
    const { bookId, fileId } = req.params;

    if (!bookId || !fileId) {
      return res.status(400).json({
        success: false,
        message: 'bookId and fileId are required'
      });
    }

    // Get book file details from DynamoDB
    const bookFile = await hierarchyService.getBookFileById(bookId, fileId);

    if (!bookFile) {
      return res.status(404).json({
        success: false,
        message: 'Book file not found'
      });
    }

    // Construct S3 key
    const s3Key = `books/${fileId}/${bookFile.fileName}`;

    // Delete from S3
    try {
      await s3.deleteObject({
        Bucket: S3_BUCKET,
        Key: s3Key
      }).promise();
      console.log(`✅ Deleted file from S3: ${s3Key}`);
    } catch (s3Error) {
      console.error('Error deleting from S3:', s3Error);
      // Continue with DynamoDB deletion even if S3 deletion fails
    }

    // Delete from DynamoDB
    await dynamoDB.delete({
      TableName: BOOK_FILES_TABLE,
      Key: {
        bookId: bookId,
        fileId: fileId
      }
    }).promise();

    console.log(`✅ Deleted book record from DynamoDB: bookId=${bookId}, fileId=${fileId}`);

    res.status(200).json({
      success: true,
      message: 'Book file deleted successfully',
      data: {
        bookId,
        fileId,
        fileName: bookFile.fileName
      }
    });

  } catch (error) {
    console.error('Error deleting book:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get book file details
const getBookDetails = async (req, res) => {
  try {
    const { bookId, fileId } = req.params;

    if (!bookId || !fileId) {
      return res.status(400).json({
        success: false,
        message: 'bookId and fileId are required'
      });
    }

    const bookFile = await hierarchyService.getBookFileById(bookId, fileId);

    if (!bookFile) {
      return res.status(404).json({
        success: false,
        message: 'Book file not found'
      });
    }

    // Get chapter details to include hierarchy info
    let chapterDetails = null;
    try {
      const chaptersResult = await dynamoDB.scan({
        TableName: CHAPTERS_TABLE,
        FilterExpression: 'chapterId = :chapterId',
        ExpressionAttributeValues: {
          ':chapterId': bookFile.chapterId
        }
      }).promise();

      chapterDetails = chaptersResult.Items?.[0] || null;
    } catch (error) {
      console.error('Error fetching chapter details:', error);
    }

    res.status(200).json({
      success: true,
      data: {
        ...bookFile,
        chapter: chapterDetails
      },
      message: 'Book details fetched successfully'
    });

  } catch (error) {
    console.error('Error fetching book details:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

module.exports = {
  uploadBookFile,
  getChaptersForSubject,
  getDivisionsForEnglish,
  getBookFilesForChapter,
  getAllBooks,
  downloadBook,
  deleteBook,
  getBookDetails
};
