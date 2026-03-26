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

router.put('/update-visual-image', async (req, res) => {
  try {
    const { contentId, visualIndex, imageUrl, imageId } = req.body;

    if (!contentId || visualIndex === undefined || !imageUrl) {
      return res.status(400).json({
        success: false,
        error: 'contentId, visualIndex, and imageUrl are required',
      });
    }

    const getResult = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { contentId },
    }));

    if (!getResult.Item) {
      return res.status(404).json({ success: false, error: 'Content not found' });
    }

    const visualSuggestions = getResult.Item.contentData?.explanation?.visualSuggestions;

    if (!Array.isArray(visualSuggestions)) {
      return res.status(400).json({ success: false, error: 'No visualSuggestions found' });
    }

    // Patch only the specific visual's generatedImageUrl
    const updatedVisuals = visualSuggestions.map((v, i) =>
      i === visualIndex
        ? { ...v, generatedImageUrl: imageUrl, generatedImageId: imageId || null }
        : v
    );

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { contentId },
      UpdateExpression: 'SET contentData.explanation.visualSuggestions = :vs, updatedAt = :t',
      ExpressionAttributeValues: {
        ':vs': updatedVisuals,
        ':t':  new Date().toISOString(),
      },
    }));

    res.json({ success: true, message: 'Visual image URL saved to content' });
  } catch (error) {
    console.error('Error updating visual image:', error);
    res.status(500).json({ success: false, error: 'Failed to update visual image' });
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


// simplified explanation tab api's

// PUT /remedial/update-explanation — Edit a specific explanation field
router.put('/update-explanation', async (req, res) => {
  try {
    const { contentId, field, value } = req.body;

    if (!contentId || !field) {
      return res.status(400).json({ success: false, error: 'contentId and field are required' });
    }

    const getResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: { contentId } }));
    if (!getResult.Item) {
      return res.status(404).json({ success: false, error: 'Content not found' });
    }

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { contentId },
      UpdateExpression: 'SET contentData.explanation.#field = :val, updatedAt = :t',
      ExpressionAttributeNames: { '#field': field },
      ExpressionAttributeValues: {
        ':val': value,
        ':t': new Date().toISOString(),
      },
    }));

    res.json({ success: true, message: 'Explanation field updated successfully' });
  } catch (error) {
    console.error('Error updating explanation:', error);
    res.status(500).json({ success: false, error: 'Failed to update explanation' });
  }
});


// DELETE /remedial/delete-explanation-field — Remove a field or array item
router.delete('/delete-explanation-field', async (req, res) => {
  try {
    const { contentId, field, index } = req.body;
    // field: 'keyPoints' | 'highlightedTerms' | 'visualSuggestions' | 'analogy' | 'practiceHint'
    // index: number (for array fields) or undefined (for scalar fields)

    if (!contentId || !field) {
      return res.status(400).json({ success: false, error: 'contentId and field are required' });
    }

    const getResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: { contentId } }));
    if (!getResult.Item) {
      return res.status(404).json({ success: false, error: 'Content not found' });
    }

    const explanation = getResult.Item.contentData?.explanation;
    if (!explanation) {
      return res.status(400).json({ success: false, error: 'No explanation data found' });
    }

    let newValue;
    if (index !== undefined && Array.isArray(explanation[field])) {
      // Remove specific array item
      newValue = explanation[field].filter((_, i) => i !== index);
    } else {
      // Remove scalar field (set to null)
      newValue = null;
    }

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { contentId },
      UpdateExpression: 'SET contentData.explanation.#field = :val, updatedAt = :t',
      ExpressionAttributeNames: { '#field': field },
      ExpressionAttributeValues: {
        ':val': newValue,
        ':t': new Date().toISOString(),
      },
    }));

    res.json({ success: true, message: 'Field deleted successfully' });
  } catch (error) {
    console.error('Error deleting explanation field:', error);
    res.status(500).json({ success: false, error: 'Failed to delete field' });
  }
});

// step by step tab api's

router.put('/update-step', async (req, res) => {
  try {
    const { contentId, stepIndex, updatedStep } = req.body;

    if (!contentId || stepIndex === undefined || !updatedStep) {
      return res.status(400).json({ success: false, error: 'contentId, stepIndex, updatedStep are required' });
    }

    const getResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: { contentId } }));
    if (!getResult.Item) {
      return res.status(404).json({ success: false, error: 'Content not found' });
    }

    const steps = getResult.Item.contentData?.steps?.steps;
    if (!Array.isArray(steps)) {
      return res.status(400).json({ success: false, error: 'No steps found in this content' });
    }

    const updatedSteps = steps.map((s, i) => i === stepIndex ? { ...s, ...updatedStep } : s);

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { contentId },
      UpdateExpression: 'SET contentData.steps.steps = :s, updatedAt = :t',
      ExpressionAttributeValues: {
        ':s': updatedSteps,
        ':t': new Date().toISOString(),
      },
    }));

    res.json({ success: true, message: 'Step updated successfully' });
  } catch (error) {
    console.error('Error updating step:', error);
    res.status(500).json({ success: false, error: 'Failed to update step' });
  }
});

router.delete('/delete-step', async (req, res) => {
  try {
    const { contentId, stepIndex } = req.body;

    if (!contentId || stepIndex === undefined) {
      return res.status(400).json({ success: false, error: 'contentId and stepIndex are required' });
    }

    const getResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: { contentId } }));
    if (!getResult.Item) {
      return res.status(404).json({ success: false, error: 'Content not found' });
    }

    const steps = getResult.Item.contentData?.steps?.steps;
    if (!Array.isArray(steps)) {
      return res.status(400).json({ success: false, error: 'No steps found in this content' });
    }

    const filteredSteps = steps.filter((_, i) => i !== stepIndex);

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { contentId },
      UpdateExpression: 'SET contentData.steps.steps = :s, updatedAt = :t',
      ExpressionAttributeValues: {
        ':s': filteredSteps,
        ':t': new Date().toISOString(),
      },
    }));

    res.json({ success: true, message: 'Step deleted successfully' });
  } catch (error) {
    console.error('Error deleting step:', error);
    res.status(500).json({ success: false, error: 'Failed to delete step' });
  }
});

// worksheet tab add

router.put('/update-worksheet-activity', async (req, res) => {
  try {
    const { contentId, activityIndex, updatedActivity } = req.body;

    if (!contentId || activityIndex === undefined || !updatedActivity) {
      return res.status(400).json({ success: false, error: 'contentId, activityIndex, updatedActivity are required' });
    }

    const getResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: { contentId } }));
    if (!getResult.Item) {
      return res.status(404).json({ success: false, error: 'Content not found' });
    }

    const activities = getResult.Item.contentData?.worksheet?.activities;
    if (!Array.isArray(activities)) {
      return res.status(400).json({ success: false, error: 'No worksheet activities found' });
    }

    const updatedActivities = activities.map((a, i) => i === activityIndex ? { ...a, ...updatedActivity } : a);

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { contentId },
      UpdateExpression: 'SET contentData.worksheet.activities = :a, updatedAt = :t',
      ExpressionAttributeValues: {
        ':a': updatedActivities,
        ':t': new Date().toISOString(),
      },
    }));

    res.json({ success: true, message: 'Activity updated successfully' });
  } catch (error) {
    console.error('Error updating worksheet activity:', error);
    res.status(500).json({ success: false, error: 'Failed to update activity' });
  }
});

router.delete('/delete-worksheet-activity', async (req, res) => {
  try {
    const { contentId, activityIndex } = req.body;

    if (!contentId || activityIndex === undefined) {
      return res.status(400).json({ success: false, error: 'contentId and activityIndex are required' });
    }

    const getResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: { contentId } }));
    if (!getResult.Item) {
      return res.status(404).json({ success: false, error: 'Content not found' });
    }

    const activities = getResult.Item.contentData?.worksheet?.activities;
    if (!Array.isArray(activities)) {
      return res.status(400).json({ success: false, error: 'No worksheet activities found' });
    }

    const filtered = activities.filter((_, i) => i !== activityIndex);

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { contentId },
      UpdateExpression: 'SET contentData.worksheet.activities = :a, updatedAt = :t',
      ExpressionAttributeValues: {
        ':a': filtered,
        ':t': new Date().toISOString(),
      },
    }));

    res.json({ success: true, message: 'Activity deleted successfully' });
  } catch (error) {
    console.error('Error deleting worksheet activity:', error);
    res.status(500).json({ success: false, error: 'Failed to delete activity' });
  }
});

// puzzle tab

router.put('/update-puzzle-clue', async (req, res) => {
  try {
    const { contentId, clueIndex, updatedClue } = req.body;

    if (!contentId || clueIndex === undefined || !updatedClue) {
      return res.status(400).json({ success: false, error: 'contentId, clueIndex, updatedClue are required' });
    }

    const getResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: { contentId } }));
    if (!getResult.Item) {
      return res.status(404).json({ success: false, error: 'Content not found' });
    }

    const clues = getResult.Item.contentData?.puzzle?.clues;
    if (!Array.isArray(clues)) {
      return res.status(400).json({ success: false, error: 'No puzzle clues found in this content' });
    }

    const updatedClues = clues.map((c, i) => i === clueIndex ? { ...c, ...updatedClue } : c);

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { contentId },
      UpdateExpression: 'SET contentData.puzzle.clues = :c, updatedAt = :t',
      ExpressionAttributeValues: {
        ':c': updatedClues,
        ':t': new Date().toISOString(),
      },
    }));

    res.json({ success: true, message: 'Clue updated successfully' });
  } catch (error) {
    console.error('Error updating puzzle clue:', error);
    res.status(500).json({ success: false, error: 'Failed to update clue' });
  }
});

router.delete('/delete-puzzle-clue', async (req, res) => {
  try {
    const { contentId, clueIndex } = req.body;

    if (!contentId || clueIndex === undefined) {
      return res.status(400).json({ success: false, error: 'contentId and clueIndex are required' });
    }

    const getResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: { contentId } }));
    if (!getResult.Item) {
      return res.status(404).json({ success: false, error: 'Content not found' });
    }

    const clues = getResult.Item.contentData?.puzzle?.clues;
    if (!Array.isArray(clues)) {
      return res.status(400).json({ success: false, error: 'No puzzle clues found in this content' });
    }

    const filtered = clues.filter((_, i) => i !== clueIndex);

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { contentId },
      UpdateExpression: 'SET contentData.puzzle.clues = :c, updatedAt = :t',
      ExpressionAttributeValues: {
        ':c': filtered,
        ':t': new Date().toISOString(),
      },
    }));

    res.json({ success: true, message: 'Clue deleted successfully' });
  } catch (error) {
    console.error('Error deleting puzzle clue:', error);
    res.status(500).json({ success: false, error: 'Failed to delete clue' });
  }
});

module.exports = router;
