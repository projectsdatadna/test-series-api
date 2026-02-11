// Book Upload Controller - Handles file upload and chapter creation

const hierarchyService = require('../file-hierarchy/service');

// Upload file to Anthropic and create chapter
const uploadBookFile = async (req, res) => {
  try {
    const { fileId, fileName, syllabusId, standardId, subjectId, chapterName, fileSize } = req.body;

    console.log('📚 Book Upload Request:', {
      fileId,
      fileName,
      syllabusId,
      standardId,
      subjectId,
      chapterName,
      fileSize,
    });

    // Validate all required fields
    if (!fileId || !fileName || !syllabusId || !standardId || !subjectId || !chapterName) {
      console.error('❌ Validation failed - Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'fileId, fileName, syllabusId, standardId, subjectId, and chapterName are all required',
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
      standardId
    );
    console.log('✅ Chapter created:', chapter);

    // Create book file record with complete hierarchy
    console.log('📄 Creating book file record...');
    const bookFile = await hierarchyService.createBookFile(
      fileId,
      fileName,
      chapter.chapterId,
      fileSize || 0,
      new Date().toISOString()
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

// Get chapters for a subject
const getChaptersForSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;
    if (!subjectId) {
      return res.status(400).json({
        success: false,
        message: 'subjectId is required',
      });
    }
    const chapters = await hierarchyService.getChaptersBySubject(subjectId);
    res.status(200).json({
      success: true,
      data: chapters,
      message: 'Chapters fetched successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
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
      message: error.message,
    });
  }
};

module.exports = {
  uploadBookFile,
  getChaptersForSubject,
  getBookFilesForChapter,
  getAllBooks,
};
