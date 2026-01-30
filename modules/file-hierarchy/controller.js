// API Controllers for File Hierarchy

const service = require('./service');

// ============ SYLLABUS ============
const getAllSyllabi = async (req, res) => {
  try {
    const syllabi = await service.getAllSyllabi();
    res.status(200).json({
      success: true,
      data: syllabi,
      message: 'Syllabi fetched successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============ STANDARDS ============
const getStandardsBySyllabus = async (req, res) => {
  try {
    const { syllabusId } = req.params;
    if (!syllabusId) {
      return res.status(400).json({
        success: false,
        message: 'syllabusId is required',
      });
    }
    const standards = await service.getStandardsBysyllabus(syllabusId);
    res.status(200).json({
      success: true,
      data: standards,
      message: 'Standards fetched successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============ SUBJECTS ============
const getSubjectsByStandard = async (req, res) => {
  try {
    const { standardId } = req.params;
    if (!standardId) {
      return res.status(400).json({
        success: false,
        message: 'standardId is required',
      });
    }
    const subjects = await service.getSubjectsByStandard(standardId);
    res.status(200).json({
      success: true,
      data: subjects,
      message: 'Subjects fetched successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============ CHAPTERS ============
const getChaptersBySubject = async (req, res) => {
  try {
    const { subjectId, standardId, syllabusId } = req.query;
    
    if (!subjectId || !standardId || !syllabusId) {
      return res.status(400).json({
        success: false,
        message: 'subjectId, standardId, and syllabusId are all required',
      });
    }

    console.log(`📚 Fetching chapters for: Syllabus=${syllabusId}, Standard=${standardId}, Subject=${subjectId}`);
    
    const chapters = await service.getChaptersBySubject(subjectId, standardId, syllabusId);
    
    res.status(200).json({
      success: true,
      data: chapters,
      message: 'Chapters fetched successfully',
    });
  } catch (error) {
    console.error('❌ Error fetching chapters:', error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const createChapterWithFile = async (req, res) => {
  try {
    const { subjectId, chapterName, fileId, fileName, fileSize } = req.body;

    if (!subjectId || !chapterName || !fileId || !fileName) {
      return res.status(400).json({
        success: false,
        message: 'subjectId, chapterName, fileId, fileName are required',
      });
    }

    // Create chapter
    const chapter = await service.createChapter(subjectId, chapterName, fileId);

    // Create book file record
    const bookFile = await service.createBookFile(
      fileId,
      fileName,
      chapter.chapterId,
      fileSize || 0,
      new Date().toISOString()
    );

    res.status(201).json({
      success: true,
      data: {
        chapter,
        bookFile,
      },
      message: 'Chapter and file created successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============ BOOK FILES ============
const getBookFileById = async (req, res) => {
  try {
    const { bookId, fileId } = req.params;
    if (!bookId || !fileId) {
      return res.status(400).json({
        success: false,
        message: 'bookId and fileId are required',
      });
    }
    const bookFile = await service.getBookFileById(bookId, fileId);
    if (!bookFile) {
      return res.status(404).json({
        success: false,
        message: 'Book file not found',
      });
    }
    res.status(200).json({
      success: true,
      data: bookFile,
      message: 'Book file fetched successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getBookFilesByChapter = async (req, res) => {
  try {
    const { chapterId } = req.params;
    if (!chapterId) {
      return res.status(400).json({
        success: false,
        message: 'chapterId is required',
      });
    }
    const bookFiles = await service.getBookFilesByChapter(chapterId);
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

module.exports = {
  getAllSyllabi,
  getStandardsBySyllabus,
  getSubjectsByStandard,
  getChaptersBySubject,
  createChapterWithFile,
  getBookFileById,
  getBookFilesByChapter,
};
