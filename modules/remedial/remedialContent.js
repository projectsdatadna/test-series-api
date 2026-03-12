const express = require('express');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const { UpdateCommand, DeleteCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});
const ddb = DynamoDBDocumentClient.from(client);

const TABLE = 'TestSeriesRemedialGeneratedContent';

// POST /remedial/save — Save generated content
router.post('/save', async (req, res) => {
  try {
    const {
      userId,
      categoryId,       // optional now
      syllabusId,
      standardId,
      subjectId,
      chapterId,
      chapterName,
      sectionNumber,
      contentData,
    } = req.body;

    // ✅ Only userId and chapterId are required
    if (!userId?.trim() || !chapterId?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'userId and chapterId are required',
      });
    }

    const contentId = uuidv4();

    const item = {
      contentId,
      userId: userId.trim(),
      categoryId: categoryId || 'all',     // ✅ default to 'all' for batch saves
      syllabusId: syllabusId || '',
      standardId: standardId || '',
      subjectId: subjectId || '',
      chapterId,
      chapterName: chapterName || '',
      sectionNumber: sectionNumber || '',
      contentData,
      generatedAt: new Date().toISOString(),
    };

    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));

    res.status(201).json({
      success: true,
      data: { contentId, generatedAt: item.generatedAt },
      message: 'Content saved successfully',
    });
  } catch (error) {
    console.error('Error saving generated content:', error);
    res.status(500).json({ success: false, error: 'Failed to save content' });
  }
});


// GET /remedial/history?userId=xxx — Fetch saved content for a user
router.get('/history', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }

    const command = new QueryCommand({
      TableName: TABLE,
      IndexName: 'userId-generatedAt-index',   // ✅ GSI on userId + generatedAt
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ScanIndexForward: false,                 // newest first
    });

    const response = await ddb.send(command);
    res.json({ success: true, data: response.Items || [] });
  } catch (error) {
    console.error('Error fetching content history:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch history' });
  }
});

// PUT /remedial/update-question — Edit a specific question in saved content
router.put('/update-question', async (req, res) => {
  try {
    const { contentId, questionId, updatedQuestion } = req.body;

    if (!contentId || questionId === undefined || !updatedQuestion) {
      return res.status(400).json({ success: false, error: 'contentId, questionId, updatedQuestion are required' });
    }

    // Fetch existing item first
    const getResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: { contentId } }));
    if (!getResult.Item) {
      return res.status(404).json({ success: false, error: 'Content not found' });
    }

    const contentData = getResult.Item.contentData;
    const questions = contentData?.quiz;

    if (!Array.isArray(questions)) {
      return res.status(400).json({ success: false, error: 'No quiz questions found in this content' });
    }

    // Update the specific question by id
    const updatedQuestions = questions.map(q =>
      q.id === questionId ? { ...q, ...updatedQuestion } : q
    );

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { contentId },
      UpdateExpression: 'SET contentData.quiz = :q, updatedAt = :t',
      ExpressionAttributeValues: {
        ':q': updatedQuestions,
        ':t': new Date().toISOString(),
      },
    }));

    res.json({ success: true, message: 'Question updated successfully' });
  } catch (error) {
    console.error('Error updating question:', error);
    res.status(500).json({ success: false, error: 'Failed to update question' });
  }
});

// DELETE /remedial/delete-question — Delete a specific question
router.delete('/delete-question', async (req, res) => {
  try {
    const { contentId, questionId } = req.body;

    if (!contentId || questionId === undefined) {
      return res.status(400).json({ success: false, error: 'contentId and questionId are required' });
    }

    const getResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: { contentId } }));
    if (!getResult.Item) {
      return res.status(404).json({ success: false, error: 'Content not found' });
    }

    const contentData = getResult.Item.contentData;
    const questions = contentData?.quiz;

    if (!Array.isArray(questions)) {
      return res.status(400).json({ success: false, error: 'No quiz questions found in this content' });
    }

    const filteredQuestions = questions.filter(q => q.id !== questionId);

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { contentId },
      UpdateExpression: 'SET contentData.quiz = :q, updatedAt = :t',
      ExpressionAttributeValues: {
        ':q': filteredQuestions,
        ':t': new Date().toISOString(),
      },
    }));

    res.json({ success: true, message: 'Question deleted successfully' });
  } catch (error) {
    console.error('Error deleting question:', error);
    res.status(500).json({ success: false, error: 'Failed to delete question' });
  }
});

module.exports = router;
