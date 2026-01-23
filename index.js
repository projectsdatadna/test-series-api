const express = require("express");
const serverless = require("serverless-http");
const authRoutes = require("./modules/auth/routes");
const userRoutes = require("./modules/users/routes");
// const roles = require("./components/roles");
// const userProfiles = require("./components/userProfiles");
// const userSessions = require("./components/userSessions");
// const auditLogs = require("./components/auditLogs");
// const enrollments = require("./components/enrollments")
// const auditMiddleware = require("./middleware/auditMiddleWare");
// const materialViews = require("./components/materialViews"); 
// const courses = require("./components/courses");
// const hierarchy = require("./components/hierarchy");
// const standards = require("./components/standards");
// const subjects = require("./components/subjects");
// const chapters = require("./components/chapters");
// const sections = require("./components/sections");
// const courseBundles = require("./components/courseBundles");
// const materialMappings = require("./components/materialMapping");
// const courseAssignments = require("./components/courseAssignment");
// const assignmentQuestions = require("./components/assignmentQuestions");
// const assignmentQuestionOptions = require("./components/assignmentquestionChoice");
// const learningMaterials = require("./components/learningMaterial");
// const materialTags = require("./components/materialTags");
// const localizedContent = require("./components/localizedContent");
// const flashCards = require("./components/flashCards");
// const userNotes = require("./components/userNotes");
// const materialAnalytics = require("./components/materialAnalytics");
// const exams = require("./components/exams");
// const questions = require("./components/questions");
// const questionOptions = require("./components/questionOptions");
// const examQuestions = require("./components/examQuestion");
// const answers = require("./components/answers");
// const errorBank = require("./components/errorBank");
// const results = require("./components/results");
const Anthropic = require('@anthropic-ai/sdk');
const multer = require('multer');
// const { Blob } = require('buffer');
// const FormData = require('form-data');
const cors = require('cors');

let fetch;
try {
  // For Node.js 18+ with native fetch
  if (typeof global.fetch === 'function') {
    fetch = global.fetch;
  } else {
    // For older Node.js versions
    fetch = require('node-fetch');
  }
} catch (error) {
  console.error('Failed to load fetch:', error);
  // Fallback using axios
  const axios = require('axios');
  fetch = async (url, options) => {
    const response = await axios({
      url,
      method: options.method || 'GET',
      headers: options.headers,
      data: options.body,
      responseType: 'json'
    });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.data,
      text: async () => JSON.stringify(response.data)
    };
  };
}

const app = express();
app.use(cors({
  origin: 'http://localhost:3001', // Your React frontend port
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY
});

if (!process.env.CLAUDE_API_KEY) {
  console.error('❌ CLAUDE_API_KEY environment variable is missing!');
}

app.get("/hello", (req, res) => {
  res.json({ message: "Hello from Express on Lambda!" });
});

app.use('/auth', authRoutes);
app.use('/users', userRoutes);



module.exports.handler = serverless(app);