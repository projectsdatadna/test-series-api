// Adaptive Content Library Service

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { PutCommand, GetCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLES = {
  ADAPTIVE_CONTENT_LIBRARY: process.env.ADAPTIVE_CONTENT_LIBRARY_TABLE || 'AdaptiveContentLibrary',
};

// Create/Store generated adaptive content
const createAdaptiveContent = async (contentData) => {
  try {
    const {
      contentId,
      userId,
      title,
      subject,
      standard,
      chapter,
      contentType,
      contentTypeId,
      syllabusId,
      standardId,
      subjectId,
      chapterId,
      fileId,
      images,
      htmlContent,
      metadata,
    } = contentData;

    if (!contentId || !userId || !title || !contentType) {
      throw new Error('contentId, userId, title, and contentType are required');
    }

    const item = {
      contentId,
      userId,
      title,
      subject,
      standard,
      chapter,
      contentType,
      contentTypeId,
      syllabusId,
      standardId,
      subjectId,
      chapterId,
      fileId,
      images: images || [],
      htmlContent,
      metadata: metadata || {},
      usedByClasses: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await docClient.send(new PutCommand({ TableName: TABLES.ADAPTIVE_CONTENT_LIBRARY, Item: item }));
    return item;
  } catch (error) {
    throw new Error(`Failed to create adaptive content: ${error.message}`);
  }
};

// Get all adaptive content for a user
const getAdaptiveContentByUser = async (userId) => {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLES.ADAPTIVE_CONTENT_LIBRARY,
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
      })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch adaptive content: ${error.message}`);
  }
};

// Get adaptive content by ID
const getAdaptiveContentById = async (contentId, userId) => {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLES.ADAPTIVE_CONTENT_LIBRARY,
        Key: { contentId, userId },
      })
    );
    return result.Item || null;
  } catch (error) {
    throw new Error(`Failed to fetch adaptive content: ${error.message}`);
  }
};

// Get adaptive content by standard
const getAdaptiveContentByStandard = async (userId, standardId) => {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLES.ADAPTIVE_CONTENT_LIBRARY,
        KeyConditionExpression: 'userId = :userId',
        FilterExpression: 'standardId = :standardId',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':standardId': standardId,
        },
      })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch adaptive content by standard: ${error.message}`);
  }
};

// Get adaptive content by subject
const getAdaptiveContentBySubject = async (userId, subjectId) => {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLES.ADAPTIVE_CONTENT_LIBRARY,
        KeyConditionExpression: 'userId = :userId',
        FilterExpression: 'subjectId = :subjectId',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':subjectId': subjectId,
        },
      })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch adaptive content by subject: ${error.message}`);
  }
};

// Get adaptive content by chapter
const getAdaptiveContentByChapter = async (userId, chapterId) => {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLES.ADAPTIVE_CONTENT_LIBRARY,
        KeyConditionExpression: 'userId = :userId',
        FilterExpression: 'chapterId = :chapterId',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':chapterId': chapterId,
        },
      })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch adaptive content by chapter: ${error.message}`);
  }
};

// Get adaptive content by type
const getAdaptiveContentByType = async (userId, contentType) => {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLES.ADAPTIVE_CONTENT_LIBRARY,
        KeyConditionExpression: 'userId = :userId',
        FilterExpression: 'contentType = :contentType',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':contentType': contentType,
        },
      })
    );
    return result.Items || [];
  } catch (error) {
    throw new Error(`Failed to fetch adaptive content by type: ${error.message}`);
  }
};

// Update adaptive content
const updateAdaptiveContent = async (contentId, userId, updateData) => {
  try {
    const item = await getAdaptiveContentById(contentId, userId);
    if (!item) {
      throw new Error('Adaptive content not found');
    }

    const updatedItem = {
      ...item,
      ...updateData,
      updatedAt: new Date().toISOString(),
    };

    await docClient.send(new PutCommand({ TableName: TABLES.ADAPTIVE_CONTENT_LIBRARY, Item: updatedItem }));
    return updatedItem;
  } catch (error) {
    throw new Error(`Failed to update adaptive content: ${error.message}`);
  }
};

// Delete adaptive content
const deleteAdaptiveContent = async (contentId, userId) => {
  try {
    await docClient.send(
      new DeleteCommand({
        TableName: TABLES.ADAPTIVE_CONTENT_LIBRARY,
        Key: { contentId, userId },
      })
    );
    return { success: true, message: 'Adaptive content deleted' };
  } catch (error) {
    throw new Error(`Failed to delete adaptive content: ${error.message}`);
  }
};

module.exports = {
  createAdaptiveContent,
  getAdaptiveContentByUser,
  getAdaptiveContentById,
  getAdaptiveContentByStandard,
  getAdaptiveContentBySubject,
  getAdaptiveContentByChapter,
  getAdaptiveContentByType,
  updateAdaptiveContent,
  deleteAdaptiveContent,
};
