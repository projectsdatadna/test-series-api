const express = require('express');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  GetCommand,
} = require('@aws-sdk/lib-dynamodb');


const router = express.Router();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});
const ddbDocClient = DynamoDBDocumentClient.from(client);

const STUDENT_TABLE = 'TestSeriesStudent';
const SCHOOL_TABLE  = 'TestSeriesSchool';
const TEACHER_TABLE = 'TestSeriesTeacher';

// ✅ Auto-increment studentId (STU-001, STU-002...) — NEVER from user input
async function getNextStudentId() {
  try {
    const command = new ScanCommand({
      TableName: STUDENT_TABLE,
      ProjectionExpression: 'studentId',
    });

    const response = await ddbDocClient.send(command);
    const items = response.Items || [];

    const numbers = items
      .map(item => {
        const match = item.studentId?.match(/STU-(\d+)/);
        return match ? parseInt(match[1]) : 0;
      })
      .filter(num => num > 0);

    const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    return `STU-${nextNumber.toString().padStart(3, '0')}`;
  } catch (error) {
    console.error('Error getting next studentId:', error);
    return `STU-${Date.now().toString().slice(-3)}`; // Fallback
  }
}

// ✅ Fetch school details by schoolId
async function getSchoolDetails(schoolId) {
  try {
    const command = new GetCommand({
      TableName: SCHOOL_TABLE,
      Key: { schoolId },
    });
    const response = await ddbDocClient.send(command);
    return response.Item || null;
  } catch (error) {
    console.error('Error fetching school details:', error);
    return null;
  }
}

// ✅ Fetch teacher details by teacherId
async function getTeacherDetails(teacherId) {
  try {
    const command = new GetCommand({
      TableName: TEACHER_TABLE,
      Key: { teacherId },
    });
    const response = await ddbDocClient.send(command);
    return response.Item || null;
  } catch (error) {
    console.error('Error fetching teacher details:', error);
    return null;
  }
}

// GET /student/students — Fetch all students
router.get('/students', async (req, res) => {
  try {
    const command = new ScanCommand({ TableName: STUDENT_TABLE });
    const response = await ddbDocClient.send(command);

    const sorted = (response.Items || []).sort((a, b) =>
      a.studentId.localeCompare(b.studentId)
    );

    res.json({
      success: true,
      data: sorted,
      count: sorted.length,
    });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch students' });
  }
});

// POST /student/students — Add new student
// ✅ Used for both manual form add AND CSV import loop from frontend
router.post('/students', async (req, res) => {
  try {
    const { name, standard, medium, email, address, schoolId, teacherId } = req.body;

    // ✅ Validate required fields
    if (!name?.trim() || !email?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Name and Email are required',
      });
    }

    // ✅ Fetch schoolCode + schoolName from school table
    let schoolCode = '';
    let schoolName = '';
    if (schoolId) {
      const school = await getSchoolDetails(schoolId);
      if (school) {
        schoolCode = school.schoolCode || '';
        schoolName = school.name || '';
      }
    }

    // ✅ Fetch teacherName from teacher table
    let teacherName = '';
    if (teacherId) {
      const teacher = await getTeacherDetails(teacherId);
      if (teacher) {
        teacherName = teacher.name || '';
      }
    }

    // ✅ studentId ALWAYS auto-generated — never from req.body
    const studentId = await getNextStudentId();

    const newStudent = {
      studentId,                      // ✅ Partition Key — auto-generated
      name: name.trim(),
      standard: standard?.trim() || '',
      medium: medium?.trim() || '',
      email: email.trim(),
      address: address?.trim() || '',
      schoolId: schoolId || '',       // ✅ Reference to school
      schoolCode,                     // ✅ Fetched from school table
      schoolName,                     // ✅ Fetched from school table
      teacherId: teacherId || '',     // ✅ Reference to teacher
      teacherName,                    // ✅ Fetched from teacher table
      createdAt: new Date().toISOString(),
    };

    const command = new PutCommand({
      TableName: STUDENT_TABLE,
      Item: newStudent,
    });

    await ddbDocClient.send(command);

    res.status(201).json({
      success: true,
      data: newStudent,
      message: 'Student added successfully',
    });
  } catch (error) {
    console.error('Error adding student:', error);
    res.status(500).json({ success: false, error: 'Failed to add student' });
  }
});

module.exports = router;
