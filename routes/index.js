/**
 * Central Route Registry
 * Consolidates all module routes for clean architecture
 */

// Import all module routes
const authRoutes = require("../modules/auth/routes");
const userRoutes = require("../modules/users/routes");
const rolesRoutes = require("../modules/roles/routes");
const profilesRoutes = require("../modules/profiles/routes");
const sessionsRoutes = require("../modules/sessions/routes");
const auditLogsRoutes = require("../modules/audit-logs/routes");
const enrollmentsRoutes = require("../modules/enrollments/routes");
const coursesRoutes = require("../modules/courses/routes");
const standardsRoutes = require("../modules/standards/routes");
const subjectsRoutes = require("../modules/subjects/routes");
const chaptersRoutes = require("../modules/chapters/routes");
const sectionsRoutes = require("../modules/sections/routes");
const materialsRoutes = require("../modules/materials/routes");
const examsRoutes = require("../modules/exams/routes");
const materialViewsRoutes = require("../modules/material-views/routes");
const hierarchyRoutes = require("../modules/hierarchy/routes");
const courseBundlesRoutes = require("../modules/course-bundles/routes");
const materialMappingsRoutes = require("../modules/material-mappings/routes");
const assignmentsRoutes = require("../modules/assignments/routes");
const assignmentQuestionsRoutes = require("../modules/assignment-questions/routes");
const assignmentQuestionOptionsRoutes = require("../modules/assignment-question-options/routes");
const materialTagsRoutes = require("../modules/material-tags/routes");
const localizedContentRoutes = require("../modules/localized-content/routes");
const flashcardsRoutes = require("../modules/flashcards/routes");
const userNotesRoutes = require("../modules/user-notes/routes");
const materialAnalyticsRoutes = require("../modules/material-analytics/routes");
const questionsRoutes = require("../modules/questions/routes");
const questionOptionsRoutes = require("../modules/question-options/routes");
const examQuestionsRoutes = require("../modules/exam-questions/routes");
const answersRoutes = require("../modules/answers/routes");
const errorBankRoutes = require("../modules/error-bank/routes");
const resultsRoutes = require("../modules/results/routes");
const claudeAIRoutes = require("../modules/claude-ai/routes");
const anthropicUploadRoutes = require("../modules/anthropic-upload/routes");
const adaptiveContentRoutes = require("../modules/adaptive-content/routes");

/**
 * Register all routes with the Express app
 * @param {Express} app - Express application instance
 */
function registerRoutes(app) {
  // ============ CORE AUTHENTICATION & USER MANAGEMENT ============
  app.use('/auth', authRoutes);
  app.use('/users', userRoutes);
  app.use('/roles', rolesRoutes);
  app.use('/profiles', profilesRoutes);
  app.use('/sessions', sessionsRoutes);

  // ============ SYSTEM MANAGEMENT ============
  app.use('/audit-logs', auditLogsRoutes);

  // ============ COURSE MANAGEMENT ============
  app.use('/enrollments', enrollmentsRoutes);
  app.use('/courses', coursesRoutes);
  app.use('/course-bundles', courseBundlesRoutes);

  // ============ EDUCATIONAL HIERARCHY ============
  app.use('/standards', standardsRoutes);
  app.use('/subjects', subjectsRoutes);
  app.use('/chapters', chaptersRoutes);
  app.use('/sections', sectionsRoutes);
  app.use('/', hierarchyRoutes); // Hierarchy linking routes use root paths

  // ============ CONTENT MANAGEMENT ============
  app.use('/materials', materialsRoutes);
  app.use('/material-views', materialViewsRoutes);
  app.use('/material-mappings', materialMappingsRoutes);
  app.use('/material-tags', materialTagsRoutes);
  app.use('/localized-content', localizedContentRoutes);

  // ============ ASSIGNMENT MANAGEMENT ============
  app.use('/assignments', assignmentsRoutes);
  app.use('/', assignmentQuestionsRoutes); // Assignment questions use mixed paths
  app.use('/', assignmentQuestionOptionsRoutes); // Assignment question options use mixed paths

  // ============ EXAM MANAGEMENT ============
  app.use('/exams', examsRoutes);
  app.use('/questions', questionsRoutes);
  app.use('/', questionOptionsRoutes); // Question options use mixed paths
  app.use('/', examQuestionsRoutes); // Exam questions use mixed paths
  app.use('/', answersRoutes); // Answers use mixed paths

  // ============ LEARNING TOOLS ============
  app.use('/flashcards', flashcardsRoutes);
  app.use('/', userNotesRoutes); // User notes use mixed paths

  // ============ ANALYTICS & REPORTING ============
  app.use('/', materialAnalyticsRoutes); // Material analytics use mixed paths
  app.use('/error-bank', errorBankRoutes);
  app.use('/results', resultsRoutes);

  // ============ AI INTEGRATION ============
  app.use('/', claudeAIRoutes); // Claude AI routes use root paths
  app.use('/anthropic', anthropicUploadRoutes); // Anthropic file upload routes
  app.use('/adaptive-content', adaptiveContentRoutes); // Adaptive content generation routes

  // ============ DEBUG & DOCUMENTATION ROUTES ============
  if (process.env.NODE_ENV !== 'production') {
    const { addDebugRoutes } = require('./utils');
    addDebugRoutes(app);
  }

  console.log('✅ All routes registered successfully');
  console.log(`📊 Total modules: 34`);
  console.log(`🏗️ Architecture: Centralized route management`);
}

/**
 * Get route summary for documentation/debugging
 * @returns {Object} Route summary with counts and organization
 */
function getRouteSummary() {
  return {
    totalModules: 34,
    categories: {
      'Core Auth & Users': ['auth', 'users', 'roles', 'profiles', 'sessions'],
      'System Management': ['audit-logs'],
      'Course Management': ['enrollments', 'courses', 'course-bundles'],
      'Educational Hierarchy': ['standards', 'subjects', 'chapters', 'sections', 'hierarchy'],
      'Content Management': ['materials', 'material-views', 'material-mappings', 'material-tags', 'localized-content'],
      'Assignment Management': ['assignments', 'assignment-questions', 'assignment-question-options'],
      'Exam Management': ['exams', 'questions', 'question-options', 'exam-questions', 'answers'],
      'Learning Tools': ['flashcards', 'user-notes'],
      'Analytics & Reporting': ['material-analytics', 'error-bank', 'results'],
      'AI Integration': ['claude-ai', 'anthropic-upload', 'adaptive-content']
    },
    routePatterns: {
      'Standard Namespace': ['/auth/*', '/users/*', '/courses/*', '/materials/*', '/exams/*'],
      'Root Level Routes': ['hierarchy', 'user-notes', 'answers', 'claude-ai'],
      'Mixed Path Routes': ['assignment-questions', 'question-options', 'exam-questions']
    }
  };
}

module.exports = {
  registerRoutes,
  getRouteSummary
};