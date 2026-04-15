// College Hierarchy Service - Manages college-specific hierarchy

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { PutCommand, GetCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLES = {
  COLLEGE_DEPARTMENTS: process.env.COLLEGE_DEPARTMENTS_TABLE || 'CollegeDepartmentsTable',
  COLLEGE_SEMESTERS: process.env.COLLEGE_SEMESTERS_TABLE || 'CollegeSemestersTable',
  COLLEGE_SUBJECTS: process.env.COLLEGE_SUBJECTS_TABLE || 'CollegeSubjectsTable',
  COLLEGE_SECTIONS: process.env.COLLEGE_SECTIONS_TABLE || 'CollegeSectionsTable',
  COLLEGE_CHAPTERS: process.env.COLLEGE_CHAPTERS_TABLE || 'CollegeChaptersTable',
  COLLEGE_BOOK_FILES: process.env.COLLEGE_BOOK_FILES_TABLE || 'CollegeBookFilesTable',
};

// ============ DEPARTMENTS ============
const getAllDepartments = async () => {
  try {
    const result = await docClient.send(
      new ScanCommand({ TableName: TABLES.COLLEGE_DEPARTMENTS })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch departments: ${error.message}`);
  }
};

const createDepartment = async (departmentId, departmentName) => {
  try {
    const item = {
      departmentId,
      departmentName,
      createdAt: new Date().toISOString()
    };
    await docClient.send(new PutCommand({ TableName: TABLES.COLLEGE_DEPARTMENTS, Item: item }));
    return item;
  } catch (error) {
    throw new Error(`Failed to create department: ${error.message}`);
  }
};

// ============ SEMESTERS ============
const getAllSemesters = async () => {
  try {
    const result = await docClient.send(
      new ScanCommand({ TableName: TABLES.COLLEGE_SEMESTERS })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch semesters: ${error.message}`);
  }
};

const getSemestersByDepartment = async (departmentId) => {
  try {
    // Since semesters are global, we return all semesters
    // In a more complex system, you might have department-specific semesters
    const result = await docClient.send(
      new ScanCommand({ TableName: TABLES.COLLEGE_SEMESTERS })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch semesters: ${error.message}`);
  }
};

const createSemester = async (semesterId, semesterName) => {
  try {
    const item = {
      semesterId,
      semesterName,
      createdAt: new Date().toISOString()
    };
    await docClient.send(new PutCommand({ TableName: TABLES.COLLEGE_SEMESTERS, Item: item }));
    return item;
  } catch (error) {
    throw new Error(`Failed to create semester: ${error.message}`);
  }
};

// ============ SUBJECTS ============
const getSubjectsByDepartmentAndSemester = async (departmentId, semesterId) => {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLES.COLLEGE_SUBJECTS,
        KeyConditionExpression: 'departmentId = :deptId AND semesterId = :semId',
        ExpressionAttributeValues: {
          ':deptId': departmentId,
          ':semId': semesterId
        }
      })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch subjects: ${error.message}`);
  }
};

const createSubject = async (subjectId, subjectName, departmentId, semesterId) => {
  try {
    const item = {
      subjectId,
      subjectName,
      departmentId,
      semesterId,
      createdAt: new Date().toISOString()
    };
    await docClient.send(new PutCommand({ TableName: TABLES.COLLEGE_SUBJECTS, Item: item }));
    return item;
  } catch (error) {
    throw new Error(`Failed to create subject: ${error.message}`);
  }
};

// ============ SECTIONS ============
const getAllSections = async () => {
  try {
    const result = await docClient.send(
      new ScanCommand({ TableName: TABLES.COLLEGE_SECTIONS })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch sections: ${error.message}`);
  }
};

const getSectionsByChapter = async (chapterId) => {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLES.COLLEGE_SECTIONS,
        IndexName: 'chapterId-index',
        KeyConditionExpression: 'chapterId = :chapterId',
        ExpressionAttributeValues: {
          ':chapterId': chapterId
        }
      })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch sections: ${error.message}`);
  }
};

const createSection = async (sectionId, sectionName) => {
  try {
    const item = {
      sectionId,
      sectionName,
      createdAt: new Date().toISOString()
    };
    await docClient.send(new PutCommand({ TableName: TABLES.COLLEGE_SECTIONS, Item: item }));
    return item;
  } catch (error) {
    throw new Error(`Failed to create section: ${error.message}`);
  }
};

// ============ CHAPTERS ============
const createChapter = async (
  subjectId,
  chapterName,
  fileId,
  departmentId,
  semesterId,
  sectionId
) => {
  try {
    const chapterId = `CHAP_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const item = {
      chapterId,
      chapterName,
      subjectId,
      fileId,
      departmentId,
      semesterId,
      sectionId,
      createdAt: new Date().toISOString()
    };
    await docClient.send(new PutCommand({ TableName: TABLES.COLLEGE_CHAPTERS, Item: item }));
    return item;
  } catch (error) {
    throw new Error(`Failed to create chapter: ${error.message}`);
  }
};

const getChaptersBySubject = async (subjectId) => {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLES.COLLEGE_CHAPTERS,
        IndexName: 'subjectId-index',
        KeyConditionExpression: 'subjectId = :subjectId',
        ExpressionAttributeValues: {
          ':subjectId': subjectId
        }
      })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch chapters: ${error.message}`);
  }
};

// ============ BOOK FILES ============
const createBookFile = async (
  fileId,
  fileName,
  chapterId,
  departmentId,
  semesterId,
  subjectId,
  sectionId,
  fileSize
) => {
  try {
    const bookId = `BOOK_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const item = {
      bookId,
      fileId,
      fileName,
      chapterId,
      departmentId,
      semesterId,
      subjectId,
      sectionId,
      fileSize,
      uploadedAt: new Date().toISOString(),
      vectorSections: [],
      vectorMetadata: {}
    };
    await docClient.send(new PutCommand({ TableName: TABLES.COLLEGE_BOOK_FILES, Item: item }));
    return item;
  } catch (error) {
    throw new Error(`Failed to create book file: ${error.message}`);
  }
};

const getBookFilesByChapter = async (chapterId) => {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLES.COLLEGE_BOOK_FILES,
        IndexName: 'chapterId-index',
        KeyConditionExpression: 'chapterId = :chapterId',
        ExpressionAttributeValues: {
          ':chapterId': chapterId
        }
      })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch book files: ${error.message}`);
  }
};

module.exports = {
  getAllDepartments,
  createDepartment,
  getAllSemesters,
  getSemestersByDepartment,
  createSemester,
  getSubjectsByDepartmentAndSemester,
  createSubject,
  getAllSections,
  getSectionsByChapter,
  createSection,
  createChapter,
  getChaptersBySubject,
  createBookFile,
  getBookFilesByChapter,
};
