// College Hierarchy Routes

const express = require('express');
const router = express.Router();
const service = require('./service');

/**
 * GET /college-hierarchy/departments
 * Get all departments
 */
router.get('/departments', async (req, res) => {
  try {
    const departments = await service.getAllDepartments();
    res.status(200).json({
      success: true,
      data: departments
    });
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch departments',
      error: error.message
    });
  }
});

/**
 * POST /college-hierarchy/departments
 * Create a new department
 * Body: { departmentId: string, departmentName: string }
 */
router.post('/departments', async (req, res) => {
  try {
    const { departmentId, departmentName } = req.body;
    if (!departmentId || !departmentName) {
      return res.status(400).json({
        success: false,
        message: 'departmentId and departmentName are required'
      });
    }
    const department = await service.createDepartment(departmentId, departmentName);
    res.status(201).json({
      success: true,
      data: department
    });
  } catch (error) {
    console.error('Error creating department:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create department',
      error: error.message
    });
  }
});

/**
 * GET /college-hierarchy/semesters
 * Get all semesters
 */
router.get('/semesters', async (req, res) => {
  try {
    const semesters = await service.getAllSemesters();
    res.status(200).json({
      success: true,
      data: semesters
    });
  } catch (error) {
    console.error('Error fetching semesters:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch semesters',
      error: error.message
    });
  }
});

/**
 * POST /college-hierarchy/semesters
 * Create a new semester
 * Body: { semesterId: string, semesterName: string }
 */
router.post('/semesters', async (req, res) => {
  try {
    const { semesterId, semesterName } = req.body;
    if (!semesterId || !semesterName) {
      return res.status(400).json({
        success: false,
        message: 'semesterId and semesterName are required'
      });
    }
    const semester = await service.createSemester(semesterId, semesterName);
    res.status(201).json({
      success: true,
      data: semester
    });
  } catch (error) {
    console.error('Error creating semester:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create semester',
      error: error.message
    });
  }
});

/**
 * GET /college-hierarchy/departments/:departmentId/semesters/:semesterId/subjects
 * Get subjects for a department and semester
 */
router.get('/departments/:departmentId/semesters/:semesterId/subjects', async (req, res) => {
  try {
    const { departmentId, semesterId } = req.params;
    const subjects = await service.getSubjectsByDepartmentAndSemester(departmentId, semesterId);
    res.status(200).json({
      success: true,
      data: subjects
    });
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subjects',
      error: error.message
    });
  }
});

/**
 * POST /college-hierarchy/subjects
 * Create a new subject
 * Body: { subjectId: string, subjectName: string, departmentId: string, semesterId: string }
 */
router.post('/subjects', async (req, res) => {
  try {
    const { subjectId, subjectName, departmentId, semesterId } = req.body;
    if (!subjectId || !subjectName || !departmentId || !semesterId) {
      return res.status(400).json({
        success: false,
        message: 'subjectId, subjectName, departmentId, and semesterId are required'
      });
    }
    const subject = await service.createSubject(subjectId, subjectName, departmentId, semesterId);
    res.status(201).json({
      success: true,
      data: subject
    });
  } catch (error) {
    console.error('Error creating subject:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create subject',
      error: error.message
    });
  }
});

/**
 * GET /college-hierarchy/chapters
 * Get chapters for a specific subject
 * Query params: departmentId, semesterId, subjectId
 */
router.get('/chapters', async (req, res) => {
  try {
    const { subjectId } = req.query;
    if (!subjectId) {
      return res.status(400).json({
        success: false,
        message: 'subjectId is required'
      });
    }
    const chapters = await service.getChaptersBySubject(subjectId);
    res.status(200).json({
      success: true,
      data: chapters,
      message: 'Chapters fetched successfully'
    });
  } catch (error) {
    console.error('Error fetching chapters:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chapters',
      error: error.message
    });
  }
});

/**
 * POST /college-hierarchy/chapters
 * Create a new chapter
 * Body: { subjectId, chapterName, fileId, departmentId, semesterId, sectionId }
 */
router.post('/chapters', async (req, res) => {
  try {
    const { subjectId, chapterName, fileId, departmentId, semesterId, sectionId } = req.body;
    if (!subjectId || !chapterName || !fileId) {
      return res.status(400).json({
        success: false,
        message: 'subjectId, chapterName, and fileId are required'
      });
    }
    const chapter = await service.createChapter(
      subjectId,
      chapterName,
      fileId,
      departmentId,
      semesterId,
      sectionId
    );
    res.status(201).json({
      success: true,
      data: chapter
    });
  } catch (error) {
    console.error('Error creating chapter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create chapter',
      error: error.message
    });
  }
});

/**
 * GET /college-hierarchy/sections
 * Get all sections
 */
router.get('/sections', async (req, res) => {
  try {
    const sections = await service.getAllSections();
    res.status(200).json({
      success: true,
      data: sections
    });
  } catch (error) {
    console.error('Error fetching sections:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sections',
      error: error.message
    });
  }
});

/**
 * POST /college-hierarchy/sections
 * Create a new section
 * Body: { sectionId: string, sectionName: string }
 */
router.post('/sections', async (req, res) => {
  try {
    const { sectionId, sectionName } = req.body;
    if (!sectionId || !sectionName) {
      return res.status(400).json({
        success: false,
        message: 'sectionId and sectionName are required'
      });
    }
    const section = await service.createSection(sectionId, sectionName);
    res.status(201).json({
      success: true,
      data: section
    });
  } catch (error) {
    console.error('Error creating section:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create section',
      error: error.message
    });
  }
});

module.exports = router;
