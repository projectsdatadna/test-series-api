/**
 * Sections Controller
 * Handles retrieval of sections with chunks and embeddings
 */

const { getSectionsByChapter, getSectionById, searchSections } = require('../rag/sectionStore');

/**
 * Get all sections for a chapter
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
const getSectionsForChapter = async (req, res) => {
  try {
    const { chapterId } = req.params;

    if (!chapterId) {
      return res.status(400).json({
        success: false,
        message: 'chapterId is required'
      });
    }

    console.log(`[SECTIONS] Fetching sections for chapter: ${chapterId}`);

    const sections = await getSectionsByChapter(chapterId);

    if (!sections || sections.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No sections found for this chapter'
      });
    }

    // Enrich response with chunk and embedding counts
    const enrichedSections = sections.map(section => ({
      sectionId: section.sectionId,
      chapterId: section.chapterId,
      sectionNumber: section.sectionNumber,
      sectionTitle: section.sectionTitle,
      syllabusId: section.syllabusId,
      standardId: section.standardId,
      subjectId: section.subjectId,
      totalChunks: section.totalChunks || 0,
      chunks: section.chunks || [],
      createdAt: section.createdAt,
      updatedAt: section.updatedAt
    }));

    console.log(`[SECTIONS] Retrieved ${enrichedSections.length} sections for chapter ${chapterId}`);
    enrichedSections.forEach(section => {
      console.log(`[SECTIONS] Section ${section.sectionNumber}: ${section.chunks.length} chunks, totalChunks: ${section.totalChunks}`);
    });

    res.status(200).json({
      success: true,
      data: enrichedSections,
      count: enrichedSections.length,
      message: 'Sections retrieved successfully'
    });
  } catch (error) {
    console.error('[SECTIONS] Error fetching sections:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Get a specific section with all chunks and embeddings
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
const getSectionDetails = async (req, res) => {
  try {
    const { sectionId } = req.params;

    if (!sectionId) {
      return res.status(400).json({
        success: false,
        message: 'sectionId is required'
      });
    }

    console.log(`[SECTIONS] Fetching section details: ${sectionId}`);

    const section = await getSectionById(sectionId);

    if (!section) {
      return res.status(404).json({
        success: false,
        message: 'Section not found'
      });
    }

    console.log(`[SECTIONS] Retrieved section ${sectionId} with ${section.totalChunks} chunks`);

    res.status(200).json({
      success: true,
      data: {
        sectionId: section.sectionId,
        chapterId: section.chapterId,
        sectionNumber: section.sectionNumber,
        sectionTitle: section.sectionTitle,
        syllabusId: section.syllabusId,
        standardId: section.standardId,
        subjectId: section.subjectId,
        totalChunks: section.totalChunks,
        chunks: section.chunks,
        createdAt: section.createdAt,
        updatedAt: section.updatedAt
      },
      message: 'Section details retrieved successfully'
    });
  } catch (error) {
    console.error('[SECTIONS] Error fetching section details:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Search sections by metadata
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
const searchSectionsAPI = async (req, res) => {
  try {
    const { syllabusId, standardId, subjectId } = req.query;

    if (!syllabusId && !standardId && !subjectId) {
      return res.status(400).json({
        success: false,
        message: 'At least one filter (syllabusId, standardId, or subjectId) is required'
      });
    }

    console.log('[SECTIONS] Searching sections with filters:', { syllabusId, standardId, subjectId });

    const sections = await searchSections({
      syllabusId,
      standardId,
      subjectId
    });

    if (!sections || sections.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No sections found matching the criteria'
      });
    }

    const enrichedSections = sections.map(section => ({
      sectionId: section.sectionId,
      chapterId: section.chapterId,
      sectionNumber: section.sectionNumber,
      sectionTitle: section.sectionTitle,
      syllabusId: section.syllabusId,
      standardId: section.standardId,
      subjectId: section.subjectId,
      totalChunks: section.totalChunks || 0,
      createdAt: section.createdAt,
      updatedAt: section.updatedAt
    }));

    console.log(`[SECTIONS] Found ${enrichedSections.length} sections matching filters`);

    res.status(200).json({
      success: true,
      data: enrichedSections,
      count: enrichedSections.length,
      message: 'Sections found successfully'
    });
  } catch (error) {
    console.error('[SECTIONS] Error searching sections:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

module.exports = {
  getSectionsForChapter,
  getSectionDetails,
  searchSectionsAPI
};
