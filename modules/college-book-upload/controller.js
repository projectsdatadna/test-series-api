// College Book Upload Controller - Handles college section uploads without splitting

const AWS = require('aws-sdk');
const collegeHierarchyService = require('../college-hierarchy/service');
const { extractTextFromPDF } = require('../rag/pdfProcessor');
const { generateEmbedding } = require('../rag/embeddings');

const s3 = new AWS.S3({
  region: process.env.AWS_REGION || 'ap-south-1'
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const COLLEGE_SECTIONS_TABLE = process.env.COLLEGE_SECTIONS_TABLE || 'CollegeSectionsTable';

/**
 * Upload college book section directly without splitting
 * Extracts text, generates embeddings, and stores in database
 */
const uploadCollegeBookSection = async (req, res) => {
  try {
    const {
      fileId,
      fileName,
      departmentId,
      semesterId,
      subjectId,
      sectionId,
      chapterName,
      fileSize,
      pdfBuffer // Base64 encoded PDF buffer
    } = req.body;

    console.log('📚 College Book Upload Request:', {
      fileId,
      fileName,
      departmentId,
      semesterId,
      subjectId,
      sectionId,
      chapterName,
      fileSize
    });

    // Validate all required fields
    if (!fileId || !fileName || !departmentId || !semesterId || !subjectId || !sectionId || !chapterName) {
      console.error('❌ Validation failed - Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'fileId, fileName, departmentId, semesterId, subjectId, sectionId, and chapterName are all required'
      });
    }

    if (!pdfBuffer) {
      console.error('❌ Validation failed - PDF buffer is required');
      return res.status(400).json({
        success: false,
        message: 'PDF buffer is required'
      });
    }

    console.log('✅ All fields validated');

    // Create chapter with college hierarchy information
    console.log('📝 Creating chapter...');
    const chapter = await collegeHierarchyService.createChapter(
      subjectId,
      chapterName,
      fileId,
      departmentId,
      semesterId,
      sectionId
    );
    console.log('✅ Chapter created:', chapter);

    // Create book file record with complete hierarchy
    console.log('📄 Creating book file record...');
    const bookFile = await collegeHierarchyService.createBookFile(
      fileId,
      fileName,
      chapter.chapterId,
      departmentId,
      semesterId,
      subjectId,
      sectionId,
      fileSize
    );
    console.log('✅ Book file created:', bookFile);

    // Convert base64 buffer to Buffer
    const pdfBufferObj = Buffer.from(pdfBuffer, 'base64');

    // Extract text from PDF
    console.log('📖 Extracting text from PDF...');
    const extractedText = await extractTextFromPDF(pdfBufferObj);
    console.log('✅ Text extracted, length:', extractedText.length);

    // Generate embedding for the entire section
    console.log('🔢 Generating embedding...');
    const embedding = await generateEmbedding(extractedText);
    console.log('✅ Embedding generated, dimension:', embedding.length);

    // Store section with embedding in DynamoDB
    console.log('💾 Storing section with embedding...');
    const sectionRecord = {
      sectionId: `SEC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      chapterId: chapter.chapterId,
      departmentId,
      semesterId,
      subjectId,
      sectionName: chapterName,
      text: extractedText,
      embedding: embedding,
      fileId,
      fileName,
      uploadedAt: new Date().toISOString(),
      textLength: extractedText.length,
      metadata: {
        departmentId,
        semesterId,
        subjectId,
        sectionId,
        chapterName
      }
    };

    await dynamoDB.put({
      TableName: COLLEGE_SECTIONS_TABLE,
      Item: sectionRecord
    }).promise();

    console.log('✅ Section stored successfully');

    // Update book file with vector metadata
    await dynamoDB.update({
      TableName: process.env.COLLEGE_BOOK_FILES_TABLE || 'CollegeBookFilesTable',
      Key: { bookId: bookFile.bookId },
      UpdateExpression: 'SET vectorSections = :vs, vectorMetadata = :vm',
      ExpressionAttributeValues: {
        ':vs': [sectionRecord.sectionId],
        ':vm': {
          sectionId: sectionRecord.sectionId,
          embeddingDimension: embedding.length,
          textLength: extractedText.length
        }
      }
    }).promise();

    console.log('✅ Book file updated with vector metadata');

    return res.status(200).json({
      success: true,
      message: 'College book section uploaded successfully',
      data: {
        bookId: bookFile.bookId,
        chapterId: chapter.chapterId,
        sectionId: sectionRecord.sectionId,
        fileName,
        chapterName,
        textLength: extractedText.length,
        embeddingDimension: embedding.length,
        hierarchy: {
          departmentId,
          semesterId,
          subjectId,
          sectionId
        }
      }
    });

  } catch (error) {
    console.error('❌ College Book Upload Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload college book section',
      error: error.message
    });
  }
};

/**
 * Get college book sections by chapter
 */
const getCollegeBookSectionsByChapter = async (req, res) => {
  try {
    const { chapterId } = req.params;

    if (!chapterId) {
      return res.status(400).json({
        success: false,
        message: 'chapterId is required'
      });
    }

    const bookFiles = await collegeHierarchyService.getBookFilesByChapter(chapterId);

    return res.status(200).json({
      success: true,
      data: bookFiles
    });

  } catch (error) {
    console.error('Error fetching book sections:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch book sections',
      error: error.message
    });
  }
};

/**
 * Get all college chapters by subject
 */
const getCollegeChaptersBySubject = async (req, res) => {
  try {
    const { subjectId } = req.params;

    if (!subjectId) {
      return res.status(400).json({
        success: false,
        message: 'subjectId is required'
      });
    }

    const chapters = await collegeHierarchyService.getChaptersBySubject(subjectId);

    return res.status(200).json({
      success: true,
      data: chapters
    });

  } catch (error) {
    console.error('Error fetching chapters:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch chapters',
      error: error.message
    });
  }
};

/**
 * Initialize college hierarchy with seed data
 */
const initializeCollegeHierarchy = async (req, res) => {
  try {
    console.log('📚 Initializing college hierarchy...');
    
    const { seedCollegeHierarchy } = require('./seed');
    await seedCollegeHierarchy();

    return res.status(200).json({
      success: true,
      message: 'College hierarchy initialized successfully'
    });

  } catch (error) {
    console.error('❌ Error initializing college hierarchy:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to initialize college hierarchy',
      error: error.message
    });
  }
};

/**
 * Get all departments
 */
const getAllDepartments = async (req, res) => {
  try {
    console.log('📚 Fetching all departments for hierarchy selector');
    
    const departments = await collegeHierarchyService.getAllDepartments();
    
    console.log(`✅ Retrieved ${departments.length} departments`);

    return res.status(200).json({
      success: true,
      data: departments
    });

  } catch (error) {
    console.error('❌ Error fetching departments:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch departments',
      error: error.message
    });
  }
};

/**
 * Get all semesters for hierarchy selector
 */
const getAllSemesters = async (req, res) => {
  try {
    console.log('📚 Fetching all semesters for hierarchy selector');
    
    const semesters = await collegeHierarchyService.getAllSemesters();
    
    console.log(`✅ Retrieved ${semesters.length} semesters`);

    return res.status(200).json({
      success: true,
      data: semesters
    });

  } catch (error) {
    console.error('❌ Error fetching semesters:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch semesters',
      error: error.message
    });
  }
};

/**
 * Get all semesters for a specific department
 */
const getSemestersByDepartment = async (req, res) => {
  try {
    const { departmentId } = req.params;

    if (!departmentId) {
      return res.status(400).json({
        success: false,
        message: 'departmentId is required'
      });
    }

    console.log(`📚 Fetching semesters for department: ${departmentId}`);
    
    const semesters = await collegeHierarchyService.getSemestersByDepartment(departmentId);
    
    console.log(`✅ Retrieved ${semesters.length} semesters`);

    return res.status(200).json({
      success: true,
      data: semesters
    });

  } catch (error) {
    console.error('❌ Error fetching semesters:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch semesters',
      error: error.message
    });
  }
};

/**
 * Get subjects for a specific department and semester
 */
const getSubjectsByDepartmentAndSemester = async (req, res) => {
  try {
    const { departmentId, semesterId } = req.params;

    if (!departmentId || !semesterId) {
      return res.status(400).json({
        success: false,
        message: 'departmentId and semesterId are required'
      });
    }

    console.log(`📚 Fetching subjects for department: ${departmentId}, semester: ${semesterId}`);
    
    const subjects = await collegeHierarchyService.getSubjectsByDepartmentAndSemester(departmentId, semesterId);
    
    console.log(`✅ Retrieved ${subjects.length} subjects`);

    return res.status(200).json({
      success: true,
      data: subjects
    });

  } catch (error) {
    console.error('❌ Error fetching subjects:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch subjects',
      error: error.message
    });
  }
};

/**
 * Get all chapters for a specific subject
 */
const getChaptersBySubject = async (req, res) => {
  try {
    const { subjectId } = req.params;

    if (!subjectId) {
      return res.status(400).json({
        success: false,
        message: 'subjectId is required'
      });
    }

    console.log(`📚 Fetching chapters for subject: ${subjectId}`);
    
    const chapters = await collegeHierarchyService.getChaptersBySubject(subjectId);
    
    console.log(`✅ Retrieved ${chapters.length} chapters`);

    return res.status(200).json({
      success: true,
      data: chapters
    });

  } catch (error) {
    console.error('❌ Error fetching chapters:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch chapters',
      error: error.message
    });
  }
};

/**
 * Get all sections for a specific chapter
 */
const getSectionsByChapter = async (req, res) => {
  try {
    const { chapterId } = req.params;

    if (!chapterId) {
      return res.status(400).json({
        success: false,
        message: 'chapterId is required'
      });
    }

    console.log(`📚 Fetching sections for chapter: ${chapterId}`);
    
    const sections = await collegeHierarchyService.getSectionsByChapter(chapterId);
    
    console.log(`✅ Retrieved ${sections.length} sections`);

    return res.status(200).json({
      success: true,
      data: sections
    });

  } catch (error) {
    console.error('❌ Error fetching sections:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch sections',
      error: error.message
    });
  }
};

module.exports = {
  uploadCollegeBookSection,
  getCollegeBookSectionsByChapter,
  getCollegeChaptersBySubject,
  initializeCollegeHierarchy,
  getAllDepartments,
  getAllSemesters,
  getSemestersByDepartment,
  getSubjectsByDepartmentAndSemester,
  getChaptersBySubject,
  getSectionsByChapter
};
