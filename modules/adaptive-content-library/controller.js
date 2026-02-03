// Adaptive Content Library Controller

const service = require('./service');
const { v4: uuidv4 } = require('uuid');

// Create adaptive content after generation
const createAdaptiveContent = async (req, res) => {
  try {
    const userId = req.query.userId || req.user?.userId || 'anonymous';
    const {
      title,
      subject,
      standard,
      chapter,
      contentType,
      contentTypeId,
      syllabusId,
      standardId,
      subjectId,
      chapterId,
      fileId,
      images,
      htmlContent,
      metadata,
    } = req.body;

    if (!title || !contentType) {
      return res.status(400).json({
        success: false,
        message: 'title and contentType are required',
      });
    }

    const contentId = `AC_${uuidv4()}`;

    const content = await service.createAdaptiveContent({
      contentId,
      userId,
      title,
      subject,
      standard,
      chapter,
      contentType,
      contentTypeId,
      syllabusId,
      standardId,
      subjectId,
      chapterId,
      fileId,
      images,
      htmlContent,
      metadata,
    });

    res.status(201).json({
      success: true,
      data: content,
      message: 'Adaptive content created successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get all adaptive content for user
const getAdaptiveContentByUser = async (req, res) => {
  try {
    const userId = req.query.userId || req.user?.userId || 'anonymous';

    const contents = await service.getAdaptiveContentByUser(userId);

    res.status(200).json({
      success: true,
      data: contents,
      count: contents.length,
      message: 'Adaptive content fetched successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get adaptive content by ID
const getAdaptiveContentById = async (req, res) => {
  try {
    const { contentId } = req.params;
    const userId = req.query.userId || req.user?.userId || 'anonymous';

    if (!contentId) {
      return res.status(400).json({
        success: false,
        message: 'contentId is required',
      });
    }

    const content = await service.getAdaptiveContentById(contentId, userId);

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Adaptive content not found',
      });
    }

    res.status(200).json({
      success: true,
      data: content,
      message: 'Adaptive content fetched successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get adaptive content by standard
const getAdaptiveContentByStandard = async (req, res) => {
  try {
    const { standardId } = req.params;
    const userId = req.query.userId || req.user?.userId || 'anonymous';

    if (!standardId) {
      return res.status(400).json({
        success: false,
        message: 'standardId is required',
      });
    }

    const contents = await service.getAdaptiveContentByStandard(userId, standardId);

    res.status(200).json({
      success: true,
      data: contents,
      count: contents.length,
      message: 'Adaptive content fetched successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get adaptive content by subject
const getAdaptiveContentBySubject = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const userId = req.query.userId || req.user?.userId || 'anonymous';

    if (!subjectId) {
      return res.status(400).json({
        success: false,
        message: 'subjectId is required',
      });
    }

    const contents = await service.getAdaptiveContentBySubject(userId, subjectId);

    res.status(200).json({
      success: true,
      data: contents,
      count: contents.length,
      message: 'Adaptive content fetched successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get adaptive content by chapter
const getAdaptiveContentByChapter = async (req, res) => {
  try {
    const { chapterId } = req.params;
    const userId = req.query.userId || req.user?.userId || 'anonymous';

    if (!chapterId) {
      return res.status(400).json({
        success: false,
        message: 'chapterId is required',
      });
    }

    const contents = await service.getAdaptiveContentByChapter(userId, chapterId);

    res.status(200).json({
      success: true,
      data: contents,
      count: contents.length,
      message: 'Adaptive content fetched successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get adaptive content by type
const getAdaptiveContentByType = async (req, res) => {
  try {
    const { contentType } = req.params;
    const userId = req.query.userId || req.user?.userId || 'anonymous';

    if (!contentType) {
      return res.status(400).json({
        success: false,
        message: 'contentType is required',
      });
    }

    const contents = await service.getAdaptiveContentByType(userId, contentType);

    res.status(200).json({
      success: true,
      data: contents,
      count: contents.length,
      message: 'Adaptive content fetched successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Update adaptive content
const updateAdaptiveContent = async (req, res) => {
  try {
    const { contentId } = req.params;
    const userId = req.query.userId || req.user?.userId || 'anonymous';
    const updateData = req.body;

    if (!contentId) {
      return res.status(400).json({
        success: false,
        message: 'contentId is required',
      });
    }

    const content = await service.updateAdaptiveContent(contentId, userId, updateData);

    res.status(200).json({
      success: true,
      data: content,
      message: 'Adaptive content updated successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Delete adaptive content
const deleteAdaptiveContent = async (req, res) => {
  try {
    const { contentId } = req.params;
    const userId = req.query.userId || req.user?.userId || 'anonymous';

    if (!contentId) {
      return res.status(400).json({
        success: false,
        message: 'contentId is required',
      });
    }

    await service.deleteAdaptiveContent(contentId, userId);

    res.status(200).json({
      success: true,
      message: 'Adaptive content deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createAdaptiveContent,
  getAdaptiveContentByUser,
  getAdaptiveContentById,
  getAdaptiveContentByStandard,
  getAdaptiveContentBySubject,
  getAdaptiveContentByChapter,
  getAdaptiveContentByType,
  updateAdaptiveContent,
  deleteAdaptiveContent,
};
