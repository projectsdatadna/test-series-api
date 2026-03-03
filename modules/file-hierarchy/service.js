// Business Logic for File Hierarchy

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { PutCommand, GetCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const {
  generateChapterId,
  generateFileId,
  validateHierarchy
} = require('./utils');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLES = {
  SYLLABUS: process.env.SYLLABUS_TABLE || 'SyllabusTable',
  STANDARDS: process.env.STANDARDS_TABLE || 'StandardsTable',
  SUBJECTS: process.env.SUBJECTS_TABLE || 'SubjectsTable',
  CHAPTERS: process.env.CHAPTERS_TABLE || 'ChaptersTable',
  BOOK_FILES: process.env.BOOK_FILES_TABLE || 'BookFilesTable'
};

// ============ SYLLABUS ============
const getAllSyllabi = async () => {
  try {
    const result = await docClient.send(
      new ScanCommand({ TableName: TABLES.SYLLABUS })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch syllabi: ${error.message}`);
  }
};

const createSyllabus = async (syllabusId, syllabusName) => {
  try {
    const item = {
      syllabusId,
      syllabusName,
      linkedAt: new Date().toISOString()
    };
    await docClient.send(new PutCommand({ TableName: TABLES.SYLLABUS, Item: item }));
    return item;
  } catch (error) {
    throw new Error(`Failed to create syllabus: ${error.message}`);
  }
};

// ============ STANDARDS ============
const getStandardsBysyllabus = async (syllabusId) => {
  try {
    // Standards are common for all syllabi, so fetch all standards
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLES.STANDARDS
      })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch standards: ${error.message}`);
  }
};

// NEW: Get all standards with their syllabus relationships
const getAllStandards = async () => {
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLES.STANDARDS
      })
    );
    
    // Return all standards with their syllabusId included
    // Each standard item should have: standardId, standardName, syllabusId, linkedAt
    const standards = (result.Items || []).map(item => ({
      standardId: item.standardId,
      standardName: item.standardName,
      syllabusId: item.syllabusId,
      linkedAt: item.linkedAt
    }));
    
    return standards;
  } catch (error) {
    throw new Error(`Failed to fetch all standards: ${error.message}`);
  }
};

const createStandard = async (syllabusId, standardId, standardName) => {
  try {
    const item = {
      syllabusId,
      standardId,
      standardName,
      linkedAt: new Date().toISOString()
    };
    await docClient.send(new PutCommand({ TableName: TABLES.STANDARDS, Item: item }));
    return item;
  } catch (error) {
    throw new Error(`Failed to create standard: ${error.message}`);
  }
};

// ============ SUBJECTS ============
const getSubjectsByStandard = async (standardId) => {
  try {
    // Define which subjects are available for each standard range
    const subjectsFor6to10 = ['SUB_TAM', 'SUB_ENG', 'SUB_MAT', 'SUB_SCI', 'SUB_SOC'];
    const subjectsFor11to12 = ['SUB_TAM', 'SUB_ENG', 'SUB_PHY', 'SUB_CHE', 'SUB_BIO', 'SUB_MAT', 'SUB_HIS', 'SUB_GEO', 'SUB_ECO', 'SUB_POL'];

    // Determine which subjects to return based on standard
    let allowedSubjects = [];
    const standardNum = parseInt(standardId.split('_')[1]);

    if (standardNum >= 6 && standardNum <= 10) {
      allowedSubjects = subjectsFor6to10;
    } else if (standardNum >= 11 && standardNum <= 12) {
      allowedSubjects = subjectsFor11to12;
    }

    // Fetch all subjects and filter
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLES.SUBJECTS
      })
    );

    const filteredItems = (result.Items || []).filter(item =>
      allowedSubjects.includes(item.subjectId)
    );

    return filteredItems;
  } catch (error) {
    throw new Error(`Failed to fetch subjects: ${error.message}`);
  }
};

// NEW: Get all subjects with their standard relationships
const getAllSubjects = async () => {
  try {
    // Define subject availability by standard range
    const subjectsFor6to10 = ['SUB_TAM', 'SUB_ENG', 'SUB_MAT', 'SUB_SCI', 'SUB_SOC'];
    const subjectsFor11to12 = ['SUB_TAM', 'SUB_ENG', 'SUB_PHY', 'SUB_CHE', 'SUB_BIO', 'SUB_MAT', 'SUB_HIS', 'SUB_GEO', 'SUB_ECO', 'SUB_POL'];
    
    // Fetch all subjects
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLES.SUBJECTS
      })
    );
    
    const allSubjects = result.Items || [];
    
    // Fetch all standards to create subject-standard relationships
    const standardsResult = await docClient.send(
      new ScanCommand({
        TableName: TABLES.STANDARDS
      })
    );
    
    const allStandards = standardsResult.Items || [];
    
    // Create subject-standard relationships
    const subjectStandardRelationships = [];
    
    allStandards.forEach(standard => {
      const standardNum = parseInt(standard.standardId.split('_')[1]);
      let allowedSubjects = [];
      
      if (standardNum >= 6 && standardNum <= 10) {
        allowedSubjects = subjectsFor6to10;
      } else if (standardNum >= 11 && standardNum <= 12) {
        allowedSubjects = subjectsFor11to12;
      }
      
      // For each allowed subject, create a relationship entry
      allSubjects.forEach(subject => {
        if (allowedSubjects.includes(subject.subjectId)) {
          subjectStandardRelationships.push({
            subjectId: subject.subjectId,
            subjectName: subject.subjectName,
            standardId: standard.standardId,
            linkedAt: subject.linkedAt || new Date().toISOString()
          });
        }
      });
    });
    
    return subjectStandardRelationships;
  } catch (error) {
    throw new Error(`Failed to fetch all subjects: ${error.message}`);
  }
};

const createSubject = async (standardId, subjectId, subjectName) => {
  try {
    const item = {
      subjectId,
      subjectName,
      linkedAt: new Date().toISOString()
    };
    await docClient.send(new PutCommand({ TableName: TABLES.SUBJECTS, Item: item }));
    return item;
  } catch (error) {
    throw new Error(`Failed to create subject: ${error.message}`);
  }
};

// ============ CHAPTERS ============
const getChaptersBySubject = async (subjectId, standardId, syllabusId, term = null) => {
  try {
    // Build filter expression based on whether term is provided
    let filterExpression = 'subjectId = :subjectId AND standardId = :standardId AND syllabusId = :syllabusId';
    const expressionAttributeValues = {
      ':subjectId': subjectId,
      ':standardId': standardId,
      ':syllabusId': syllabusId
    };

    // Add term filter if provided
    if (term) {
      filterExpression += ' AND #term = :term';
      expressionAttributeValues[':term'] = term;
    }

    const scanParams = {
      TableName: TABLES.CHAPTERS,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues
    };

    // Add ExpressionAttributeNames if term is used (since 'term' might be a reserved word)
    if (term) {
      scanParams.ExpressionAttributeNames = {
        '#term': 'term'
      };
    }

    // Scan all chapters and filter by hierarchy fields and optionally term
    const result = await docClient.send(new ScanCommand(scanParams));

    const chapters = result.Items || [];
    console.log(`📚 Found ${chapters.length} chapters${term ? ` for term: ${term}` : ''}`);

    // Fetch all book files to enrich chapters with vector data
    const booksResult = await docClient.send(
      new ScanCommand({
        TableName: TABLES.BOOK_FILES
      })
    );
    const books = booksResult.Items || [];

    // Create a map of chapterId to book files with vector data
    const chapterBooksMap = {};
    books.forEach(book => {
      if (book.chapterId) {
        if (!chapterBooksMap[book.chapterId]) {
          chapterBooksMap[book.chapterId] = [];
        }
        chapterBooksMap[book.chapterId].push({
          bookId: book.bookId,
          fileId: book.fileId,
          fileName: book.fileName,
          fileSize: book.fileSize,
          uploadedAt: book.uploadedAt,
          vectorSections: book.vectorSections || [],
          vectorMetadata: book.vectorMetadata || {}
        });
      }
    });

    // Enrich chapters with book files and vector data
    const enrichedChapters = chapters.map(chapter => ({
      ...chapter,
      bookFiles: chapterBooksMap[chapter.chapterId] || []
    }));

    return enrichedChapters;
  } catch (error) {
    throw new Error(`Failed to fetch chapters: ${error.message}`);
  }
};

const createChapter = async (subjectId, chapterName, fileId, syllabusId, standardId, division = null, term = null) => {
  try {
    // Validate all hierarchy parameters
    if (!syllabusId || !standardId || !subjectId) {
      throw new Error('Invalid hierarchy: syllabusId, standardId, subjectId required');
    }

    console.log('[HIERARCHY] createChapter called with:', {
      subjectId,
      chapterName,
      fileId,
      syllabusId,
      standardId,
      division,
      term
    });

    const chapterId = generateChapterId();
    const item = {
      chapterId,
      chapterName,
      subjectId,
      fileId,
      syllabusId,
      standardId,
      linkedAt: new Date().toISOString()
    };
    
    // Add division field if provided (for 9th and 10th English: Chapters, Poems, Workbook)
    if (division) {
      item.division = division;
      console.log('[HIERARCHY] Added division to item:', division);
    }
    
    // Add term field if provided (for TN State Board: TERM_1, TERM_2, TERM_3)
    if (term) {
      item.term = term;
      console.log('[HIERARCHY] Added term to item:', term);
    }
    
    console.log('[HIERARCHY] Final item to be stored:', JSON.stringify(item, null, 2));
    
    await docClient.send(new PutCommand({ TableName: TABLES.CHAPTERS, Item: item }));
    
    console.log('[HIERARCHY] Chapter created successfully with chapterId:', chapterId);
    
    return item;
  } catch (error) {
    throw new Error(`Failed to create chapter: ${error.message}`);
  }
};

const getChapterById = async (chapterId, chapterName) => {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLES.CHAPTERS,
        Key: { chapterId, chapterName }
      })
    );
    return result.Item || null;
  } catch (error) {
    throw new Error(`Failed to fetch chapter: ${error.message}`);
  }
};

// ============ BOOK FILES ============
const createBookFile = async (fileId, fileName, chapterId, fileSize, uploadedAt, chapterData = null) => {
  try {
    const bookId = generateChapterId(); // Use as unique book identifier
    const item = {
      bookId,
      fileId,
      fileName,
      chapterId,
      fileSize,
      uploadedAt: uploadedAt || new Date().toISOString()
    };

    // Add chapter data if provided
    if (chapterData) {
      item.chapterName = chapterData.chapterName || null;
      item.syllabusId = chapterData.syllabusId || null;
      item.standardId = chapterData.standardId || null;
      item.subjectId = chapterData.subjectId || null;
    }

    await docClient.send(new PutCommand({ TableName: TABLES.BOOK_FILES, Item: item }));
    return item;
  } catch (error) {
    throw new Error(`Failed to create book file: ${error.message}`);
  }
};

const getBookFileById = async (bookId, fileId) => {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLES.BOOK_FILES,
        Key: { bookId, fileId }
      })
    );
    return result.Item || null;
  } catch (error) {
    throw new Error(`Failed to fetch book file: ${error.message}`);
  }
};

const getBookFilesByChapter = async (chapterId) => {
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLES.BOOK_FILES,
        FilterExpression: 'chapterId = :chapterId',
        ExpressionAttributeValues: { ':chapterId': chapterId }
      })
    );

    const bookFiles = result.Items || [];

    // Enrich book files with vector data
    const enrichedBookFiles = bookFiles.map(book => ({
      bookId: book.bookId,
      fileId: book.fileId,
      fileName: book.fileName,
      chapterId: book.chapterId,
      fileSize: book.fileSize,
      uploadedAt: book.uploadedAt,
      vectorSections: book.vectorSections || [],
      vectorMetadata: book.vectorMetadata || {}
    }));

    return enrichedBookFiles;
  } catch (error) {
    throw new Error(`Failed to fetch book files: ${error.message}`);
  }
};

const getAllBooks = async () => {
  try {
    // Fetch all books
    const booksResult = await docClient.send(
      new ScanCommand({
        TableName: TABLES.BOOK_FILES
      })
    );
    const books = booksResult.Items || [];

    // Fetch all chapters to map standardId
    const chaptersResult = await docClient.send(
      new ScanCommand({
        TableName: TABLES.CHAPTERS
      })
    );
    const chapters = chaptersResult.Items || [];

    // Create a map of chapterId to chapter data for quick lookup
    const chapterMap = {};
    chapters.forEach(chapter => {
      chapterMap[chapter.chapterId] = chapter;
    });

    // Enrich books with standardId from chapters and vector data
    const enrichedBooks = books.map(book => ({
      bookId: book.bookId,
      fileId: book.fileId,
      fileName: book.fileName,
      chapterId: book.chapterId,
      fileSize: book.fileSize,
      uploadedAt: book.uploadedAt,
      standardId: chapterMap[book.chapterId]?.standardId || null,
      subjectId: chapterMap[book.chapterId]?.subjectId || null,
      syllabusId: chapterMap[book.chapterId]?.syllabusId || null,
      chapterName: chapterMap[book.chapterId]?.chapterName || null,
      vectorSections: book.vectorSections || [],
      vectorMetadata: book.vectorMetadata || {}
    }));

    return enrichedBooks;
  } catch (error) {
    throw new Error(`Failed to fetch all books: ${error.message}`);
  }
};

// ============ SECTIONS ============
const getSectionsByChapter = async (chapterId) => {
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLES.CHAPTERS,
        FilterExpression: 'chapterId = :chapterId',
        ExpressionAttributeValues: { ':chapterId': chapterId }
      })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch sections: ${error.message}`);
  }
};

module.exports = {
  getAllSyllabi,
  createSyllabus,
  getStandardsBysyllabus,
  getAllStandards,
  createStandard,
  getSubjectsByStandard,
  getAllSubjects,
  createSubject,
  getChaptersBySubject,
  createChapter,
  getChapterById,
  createBookFile,
  getBookFileById,
  getBookFilesByChapter,
  getAllBooks,
  getSectionsByChapter
};
