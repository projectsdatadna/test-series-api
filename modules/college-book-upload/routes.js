// College Book Upload Routes

const express = require('express');
const router = express.Router();
const {
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
} = require('./controller');

/**
 * POST /college-book-upload/initialize
 * Initialize college hierarchy with seed data
 */
router.post('/initialize', initializeCollegeHierarchy);

/**
 * POST /college-book-upload/upload
 * Upload a college book section directly without splitting
 * Body: {
 *   fileId: string,
 *   fileName: string,
 *   departmentId: string,
 *   semesterId: string,
 *   subject: string (text input),
 *   chapterName: string (text input),
 *   fileSize: number,
 *   splitPattern: string (e.g., 'direct_upload')
 * }
 */
router.post('/upload', uploadCollegeBookSection);

/**
 * GET /college-book-upload/chapters/:chapterId/sections
 * Get all book sections for a chapter
 */
router.get('/chapters/:chapterId/sections', getCollegeBookSectionsByChapter);

/**
 * GET /college-book-upload/subjects/:subjectId/chapters
 * Get all chapters for a subject
 */
router.get('/subjects/:subjectId/chapters', getCollegeChaptersBySubject);

/**
 * GET /college-book-upload/hierarchy/departments
 * Get all departments for hierarchy selector
 */
router.get('/hierarchy/departments', getAllDepartments);

/**
 * GET /college-book-upload/hierarchy/semesters
 * Get all semesters for hierarchy selector
 */
router.get('/hierarchy/semesters', getAllSemesters);

/**
 * GET /college-book-upload/hierarchy/departments/:departmentId/semesters
 * Get semesters for a specific department
 */
router.get('/hierarchy/departments/:departmentId/semesters', getSemestersByDepartment);

/**
 * GET /college-book-upload/hierarchy/subjects/:departmentId/:semesterId
 * Get subjects for a specific department and semester
 */
router.get('/hierarchy/subjects/:departmentId/:semesterId', getSubjectsByDepartmentAndSemester);

/**
 * GET /college-book-upload/hierarchy/chapters/:subjectId
 * Get chapters for a specific subject
 */
router.get('/hierarchy/chapters/:subjectId', getChaptersBySubject);

/**
 * GET /college-book-upload/hierarchy/sections/:chapterId
 * Get sections for a specific chapter
 */
router.get('/hierarchy/sections/:chapterId', getSectionsByChapter);

module.exports = router;
