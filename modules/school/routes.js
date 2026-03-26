const express = require('express');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');


const router = express.Router();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});
const ddbDocClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'TestSeriesSchool';

// ✅ Auto-increment schoolId (SCH-001, SCH-002...) — NEVER from user input
async function getNextSchoolId() {
  try {
    const command = new ScanCommand({
      TableName: TABLE_NAME,
      ProjectionExpression: 'schoolId'
    });

    const response = await ddbDocClient.send(command);
    const items = response.Items || [];

    const numbers = items
      .map(item => {
        const match = item.schoolId?.match(/SCH-(\d+)/);
        return match ? parseInt(match[1]) : 0;
      })
      .filter(num => num > 0);

    const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    return `SCH-${nextNumber.toString().padStart(3, '0')}`;
  } catch (error) {
    console.error('Error getting next schoolId:', error);
    return `SCH-${Date.now().toString().slice(-3)}`; // Fallback
  }
}

// GET /school/schools — Fetch all schools
router.get('/schools', async (req, res) => {
  try {
    const command = new ScanCommand({
      TableName: TABLE_NAME
    });

    const response = await ddbDocClient.send(command);
    res.json({
      success: true,
      data: response.Items || [],
      count: response.Count || 0
    });
  } catch (error) {
    console.error('Error fetching schools:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch schools' });
  }
});

// POST /school/schools — Add new school (used for both manual add AND CSV import loop)
router.post('/schools', async (req, res) => {
  try {
    const { name, grades, medium, email, schoolCode, address } = req.body;

    // ✅ Validate required fields
    if (!name?.trim() || !email?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Name and Email are required'
      });
    }

    // ✅ schoolId ALWAYS auto-generated — never from req.body
    const schoolId = await getNextSchoolId();

    const newSchool = {
      schoolId,               // ✅ Partition Key — auto-generated
      schoolCode: schoolCode?.trim() || '', // ✅ User-provided (optional)
      name: name.trim(),
      grades: grades?.trim() || '',
      medium: medium?.trim() || '',
      email: email.trim(),
      address: address?.trim() || '',
      createdAt: new Date().toISOString()
    };

    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: newSchool
    });

    await ddbDocClient.send(command);

    res.status(201).json({
      success: true,
      data: newSchool,
      message: 'School added successfully'
    });
  } catch (error) {
    console.error('Error adding school:', error);
    res.status(500).json({ success: false, error: 'Failed to add school' });
  }
});

module.exports = router;
