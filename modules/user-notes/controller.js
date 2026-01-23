const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const USER_NOTES_TABLE = process.env.USER_NOTES_TABLE || 'TestUserNotes';

const createResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
    "Access-Control-Allow-Credentials": true
  },
  body: JSON.stringify(body)
});

// 1. Add Note to Material
async function addNote(event) {
  try {
    const materialId = event.pathParameters?.materialId;
    if (!materialId) return createResponse(400, { success: false, message: 'materialId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const {
      user_id,
      course_id = null,
      section_id = null,
      standard_id = null,
      subject_id = null,
      chapter_id = null,
      note_text
    } = JSON.parse(event.body);

    if (!user_id) return createResponse(400, { success: false, message: 'user_id is required' });
    if (!note_text) return createResponse(400, { success: false, message: 'note_text is required' });

    const now = new Date().toISOString();
    const noteId = uuidv4();

    const item = {
      note_id: noteId,
      user_id,
      material_id: materialId,
      course_id,
      section_id,
      standard_id,
      subject_id,
      chapter_id,
      note_text,
      status: 'active',
      created_at: now,
      updated_at: now
    };

    await dynamoDB.put({ TableName: USER_NOTES_TABLE, Item: item }).promise();

    return createResponse(201, { success: true, message: 'Note added successfully', data: item });
  } catch (error) {
    console.error('AddNote Error:', error);
    return createResponse(500, { success: false, message: 'Failed to add note', error: error.message });
  }
}

// 2. Get Notes For Material
async function getNotesForMaterial(event) {
  try {
    const materialId = event.pathParameters?.materialId;
    if (!materialId) return createResponse(400, { success: false, message: 'materialId is required' });

    // Assumes GSI 'materialId-index' exists on material_id
    const params = {
      TableName: USER_NOTES_TABLE,
      IndexName: 'materialId-index',
      KeyConditionExpression: 'material_id = :materialId',
      ExpressionAttributeValues: { ':materialId': materialId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items, count: result.Items.length });
  } catch (error) {
    console.error('GetNotesForMaterial Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve notes for material', error: error.message });
  }
}

// 3. Get User Notes
async function getUserNotes(event) {
  try {
    const userId = event.pathParameters?.userId;
    if (!userId) return createResponse(400, { success: false, message: 'userId is required' });

    // Assumes GSI 'userId-index' exists on user_id
    const params = {
      TableName: USER_NOTES_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: { ':userId': userId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items, count: result.Items.length });
  } catch (error) {
    console.error('GetUserNotes Error:', error);
    return createResponse(500, { success: false, message: 'Failed to retrieve notes for user', error: error.message });
  }
}

// 4. Update Note
async function updateNote(event) {
  try {
    const noteId = event.pathParameters?.noteId;
    if (!noteId) return createResponse(400, { success: false, message: 'noteId is required' });
    if (!event.body) return createResponse(400, { success: false, message: 'Request body is required' });

    const updates = JSON.parse(event.body);
    if (!updates.note_text) return createResponse(400, { success: false, message: 'note_text is required for update' });

    const updateExpression = 'SET note_text = :note_text, updated_at = :updated_at';

    const params = {
      TableName: USER_NOTES_TABLE,
      Key: { note_id: noteId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: {
        ':note_text': updates.note_text,
        ':updated_at': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Note updated successfully', data: result.Attributes });
  } catch (error) {
    console.error('UpdateNote Error:', error);
    return createResponse(500, { success: false, message: 'Failed to update note', error: error.message });
  }
}

// 5. Delete Note (soft delete)
async function deleteNote(event) {
  try {
    const noteId = event.pathParameters?.noteId;
    if (!noteId) return createResponse(400, { success: false, message: 'noteId is required' });

    const params = {
      TableName: USER_NOTES_TABLE,
      Key: { note_id: noteId },
      UpdateExpression: 'SET #status = :status, updated_at = :updated_at',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'inactive', ':updated_at': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();

    return createResponse(200, { success: true, message: 'Note marked inactive', data: result.Attributes });
  } catch (error) {
    console.error('DeleteNote Error:', error);
    return createResponse(500, { success: false, message: 'Failed to delete note', error: error.message });
  }
}

// 6. Filter Notes by Course
async function filterNotesByCourse(event) {
  try {
    const courseId = event.pathParameters?.courseId;
    if (!courseId) return createResponse(400, { success: false, message: 'courseId is required' });

    // Assumes GSI 'courseId-index' on course_id
    const params = {
      TableName: USER_NOTES_TABLE,
      IndexName: 'courseId-index',
      KeyConditionExpression: 'course_id = :courseId',
      ExpressionAttributeValues: { ':courseId': courseId }
    };

    const result = await dynamoDB.query(params).promise();

    return createResponse(200, { success: true, data: result.Items, count: result.Items.length });
  } catch (error) {
    console.error('FilterNotesByCourse Error:', error);
    return createResponse(500, { success: false, message: 'Failed to filter notes by course', error: error.message });
  }
}

module.exports = {
  addNote,
  getNotesForMaterial,
  getUserNotes,
  updateNote,
  deleteNote,
  filterNotesByCourse
};
