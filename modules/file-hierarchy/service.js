// Business Logic for File Hierarchy

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { PutCommand, GetCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const {
  generateChapterId,
  generateFileId,
  validateHierarchy,
} = require('./utils');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLES = {
  SYLLABUS: process.env.SYLLABUS_TABLE || 'SyllabusTable',
  STANDARDS: process.env.STANDARDS_TABLE || 'StandardsTable',
  SUBJECTS: process.env.SUBJECTS_TABLE || 'SubjectsTable',
  CHAPTERS: process.env.CHAPTERS_TABLE || 'ChaptersTable',
  BOOK_FILES: process.env.BOOK_FILES_TABLE || 'BookFilesTable',
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
      linkedAt: new Date().toISOString(),
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
        TableName: TABLES.STANDARDS,
      })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch standards: ${error.message}`);
  }
};

const createStandard = async (syllabusId, standardId, standardName) => {
  try {
    const item = {
      syllabusId,
      standardId,
      standardName,
      linkedAt: new Date().toISOString(),
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
        TableName: TABLES.SUBJECTS,
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

const createSubject = async (standardId, subjectId, subjectName) => {
  try {
    const item = {
      subjectId,
      subjectName,
      linkedAt: new Date().toISOString(),
    };
    await docClient.send(new PutCommand({ TableName: TABLES.SUBJECTS, Item: item }));
    return item;
  } catch (error) {
    throw new Error(`Failed to create subject: ${error.message}`);
  }
};

// ============ CHAPTERS ============
const getChaptersBySubject = async (subjectId, standardId, syllabusId) => {
  try {
    // Scan all chapters and filter by all three hierarchy fields
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLES.CHAPTERS,
        FilterExpression: 'subjectId = :subjectId AND standardId = :standardId AND syllabusId = :syllabusId',
        ExpressionAttributeValues: {
          ':subjectId': subjectId,
          ':standardId': standardId,
          ':syllabusId': syllabusId,
        },
      })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch chapters: ${error.message}`);
  }
};

const createChapter = async (subjectId, chapterName, fileId, syllabusId, standardId) => {
  try {
    // Validate all hierarchy parameters
    if (!syllabusId || !standardId || !subjectId) {
      throw new Error('Invalid hierarchy: syllabusId, standardId, subjectId required');
    }
    
    const chapterId = generateChapterId();
    const item = {
      chapterId,
      chapterName,
      subjectId,
      fileId,
      syllabusId,
      standardId,
      linkedAt: new Date().toISOString(),
    };
    await docClient.send(new PutCommand({ TableName: TABLES.CHAPTERS, Item: item }));
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
        Key: { chapterId, chapterName },
      })
    );
    return result.Item || null;
  } catch (error) {
    throw new Error(`Failed to fetch chapter: ${error.message}`);
  }
};

// ============ BOOK FILES ============
const createBookFile = async (fileId, fileName, chapterId, fileSize, uploadedAt) => {
  try {
    const bookId = generateChapterId(); // Use as unique book identifier
    const item = {
      bookId,
      fileId,
      fileName,
      chapterId,
      fileSize,
      uploadedAt: uploadedAt || new Date().toISOString(),
    };
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
        Key: { bookId, fileId },
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
        ExpressionAttributeValues: { ':chapterId': chapterId },
      })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch book files: ${error.message}`);
  }
};

const getAllBooks = async () => {
  try {
    // Fetch all books
    const booksResult = await docClient.send(
      new ScanCommand({
        TableName: TABLES.BOOK_FILES,
      })
    );
    const books = booksResult.Items || [];

    // Fetch all chapters to map standardId
    const chaptersResult = await docClient.send(
      new ScanCommand({
        TableName: TABLES.CHAPTERS,
      })
    );
    const chapters = chaptersResult.Items || [];

    // Create a map of chapterId to chapter data for quick lookup
    const chapterMap = {};
    chapters.forEach(chapter => {
      chapterMap[chapter.chapterId] = chapter;
    });

    // Enrich books with standardId from chapters
    const enrichedBooks = books.map(book => ({
      ...book,
      standardId: chapterMap[book.chapterId]?.standardId || null,
      subjectId: chapterMap[book.chapterId]?.subjectId || null,
      syllabusId: chapterMap[book.chapterId]?.syllabusId || null,
      chapterName: chapterMap[book.chapterId]?.chapterName || null,
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
        ExpressionAttributeValues: { ':chapterId': chapterId },
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
  createStandard,
  getSubjectsByStandard,
  createSubject,
  getChaptersBySubject,
  createChapter,
  getChapterById,
  createBookFile,
  getBookFileById,
  getBookFilesByChapter,
  getAllBooks,
  getSectionsByChapter,
};
