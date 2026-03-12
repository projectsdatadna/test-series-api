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

const TEACHER_TABLE = 'TestSeriesTeacher';
const SCHOOL_TABLE  = 'TestSeriesSchool';

// ✅ Auto-increment teacherId (TEA-001, TEA-002...) — NEVER from user input
async function getNextTeacherId() {
  try {
    const command = new ScanCommand({
      TableName: TEACHER_TABLE,
      ProjectionExpression: 'teacherId',
    });

    const response = await ddbDocClient.send(command);
    const items = response.Items || [];

    const numbers = items
      .map(item => {
        const match = item.teacherId?.match(/TEA-(\d+)/);
        return match ? parseInt(match[1]) : 0;
      })
      .filter(num => num > 0);

    const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    return `TEA-${nextNumber.toString().padStart(3, '0')}`;
  } catch (error) {
    console.error('Error getting next teacherId:', error);
    return `TEA-${Date.now().toString().slice(-3)}`; // Fallback
  }
}

// ✅ Get schoolCode + schoolId from school table by schoolId
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

// GET /teacher/teachers — Fetch all teachers
router.get('/teachers', async (req, res) => {
  try {
    const command = new ScanCommand({ TableName: TEACHER_TABLE });
    const response = await ddbDocClient.send(command);

    const sorted = (response.Items || []).sort((a, b) =>
      a.teacherId.localeCompare(b.teacherId)
    );

    res.json({
      success: true,
      data: sorted,
      count: sorted.length,
    });
  } catch (error) {
    console.error('Error fetching teachers:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch teachers' });
  }
});

// POST /teacher/teachers — Add new teacher
router.post('/teachers', async (req, res) => {
  try {
    const { name, standard, medium, email, address, schoolId } = req.body;

    // ✅ Validate required fields
    if (!name?.trim() || !email?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Name and Email are required',
      });
    }

    // ✅ Fetch schoolCode + schoolName from school table using schoolId
    let schoolCode = '';
    let schoolName = '';
    if (schoolId) {
      const school = await getSchoolDetails(schoolId);
      if (school) {
        schoolCode = school.schoolCode || '';
        schoolName = school.name || '';
      }
    }

    // ✅ teacherId ALWAYS auto-generated — never from req.body
    const teacherId = await getNextTeacherId();

    const newTeacher = {
      teacherId,                    // ✅ Partition Key — auto-generated
      name: name.trim(),
      standard: standard?.trim() || '',
      medium: medium?.trim() || '',
      email: email.trim(),
      address: address?.trim() || '',
      schoolId: schoolId || '',     // ✅ Reference to school
      schoolCode,                   // ✅ Fetched from school table
      schoolName,                   // ✅ Fetched from school table
      createdAt: new Date().toISOString(),
    };

    const command = new PutCommand({
      TableName: TEACHER_TABLE,
      Item: newTeacher,
    });

    await ddbDocClient.send(command);

    res.status(201).json({
      success: true,
      data: newTeacher,
      message: 'Teacher added successfully',
    });
  } catch (error) {
    console.error('Error adding teacher:', error);
    res.status(500).json({ success: false, error: 'Failed to add teacher' });
  }
});



module.exports = router;
