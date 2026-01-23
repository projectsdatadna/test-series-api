require('dotenv').config();
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require('uuid');
const { JWSauthenticate } = require("./JWTtoken");

AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const MATERIAL_VIEWS_TABLE = process.env.MATERIAL_VIEWS_TABLE || 'TestMaterialViews';
const ENROLLMENTS_TABLE = process.env.ENROLLMENTS_TABLE || 'TestEnrollments';
const USERS_TABLE = process.env.USERS_TABLE || 'TestUsers';
const AUDIT_LOGS_TABLE = process.env.AUDIT_LOGS_TABLE || 'TestAuditLogs';

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
  "Access-Control-Allow-Credentials": true
};

const createResponse = (statusCode, body) => {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body)
  };
};

// Helper function to create audit log
const createAuditLog = async (userId, action, details, event) => {
  try {
    const logId = uuidv4();
    const ipAddress = event?.headers?.['X-Forwarded-For'] || 
                     event?.headers?.['x-forwarded-for'] || 
                     'Unknown';

    await dynamoDB.put({
      TableName: AUDIT_LOGS_TABLE,
      Item: {
        log_id: logId,
        user_id: userId,
        action: action,
        module: 'MaterialView',
        details: details,
        ip_address: ipAddress,
        status: 'success',
        timestamp: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60)
      }
    }).promise();
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
};

// Helper function to update enrollment progress
const updateEnrollmentProgress = async (enrollmentId) => {
  try {
    // Get all material views for this enrollment
    const viewsResult = await dynamoDB.query({
      TableName: MATERIAL_VIEWS_TABLE,
      IndexName: 'enrollmentId-viewedAt-index',
      KeyConditionExpression: 'enrollment_id = :enrollmentId',
      ExpressionAttributeValues: {
        ':enrollmentId': enrollmentId
      }
    }).promise();

    const views = viewsResult.Items;
    const completedCount = views.filter(v => v.completed).length;
    const totalCount = views.length;

    // Calculate progress percentage
    const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    // Determine completion status
    let completionStatus = 'not_started';
    if (progress > 0 && progress < 100) {
      completionStatus = 'in_progress';
    } else if (progress === 100) {
      completionStatus = 'completed';
    }

    // Update enrollment
    await dynamoDB.update({
      TableName: ENROLLMENTS_TABLE,
      Key: { enrollment_id: enrollmentId },
      UpdateExpression: 'SET progress = :progress, completion_status = :status, updated_at = :updated, last_accessed_date = :accessed',
      ExpressionAttributeValues: {
        ':progress': progress,
        ':status': completionStatus,
        ':updated': new Date().toISOString(),
        ':accessed': new Date().toISOString()
      }
    }).promise();

  } catch (error) {
    console.error('Failed to update enrollment progress:', error);
  }
};

// 1. Record Material View
async function recordMaterialView(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const {
      enrollmentId,
      materialId,
      completed = false,
      notes,
      standardId,
      subjectId,
      chapterId,
      sectionId,
      courseId,
      syllabusId,
      userId
    } = JSON.parse(event.body);

    // Validation
    if (!enrollmentId) {
      return createResponse(400, {
        success: false,
        message: 'enrollmentId is required'
      });
    }

    if (!materialId) {
      return createResponse(400, {
        success: false,
        message: 'materialId is required'
      });
    }

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    // Check if enrollment exists
    const enrollmentResult = await dynamoDB.get({
      TableName: ENROLLMENTS_TABLE,
      Key: { enrollment_id: enrollmentId }
    }).promise();

    if (!enrollmentResult.Item) {
      return createResponse(404, {
        success: false,
        message: 'Enrollment not found'
      });
    }

    // Check if material view already exists
    const existingView = await dynamoDB.query({
      TableName: MATERIAL_VIEWS_TABLE,
      IndexName: 'enrollmentId-materialId-index',
      KeyConditionExpression: 'enrollment_id = :enrollmentId AND material_id = :materialId',
      ExpressionAttributeValues: {
        ':enrollmentId': enrollmentId,
        ':materialId': materialId
      }
    }).promise();


    if (existingView.Items && existingView.Items.length > 0) {
      // Update existing view
      const existingViewId = existingView.Items[0].view_id;

      const result = await dynamoDB.update({
        TableName: MATERIAL_VIEWS_TABLE,
        Key: { view_id: existingViewId },
        UpdateExpression: 'SET viewed_at = :viewedAt, completed = :completed, notes = :notes, view_count = if_not_exists(view_count, :zero) + :one',
        ExpressionAttributeValues: {
          ':viewedAt': new Date().toISOString(),
          ':completed': completed,
          ':notes': notes || null,
          ':zero': 0,
          ':one': 1
        },
        ReturnValues: 'ALL_NEW'
      }).promise();

      // Update enrollment progress
      await updateEnrollmentProgress(enrollmentId);

      // Update enrollment's last accessed material
      await dynamoDB.update({
        TableName: ENROLLMENTS_TABLE,
        Key: { enrollment_id: enrollmentId },
        UpdateExpression: 'SET last_accessed_material_id = :materialId, last_accessed_date = :accessed',
        ExpressionAttributeValues: {
          ':materialId': materialId,
          ':accessed': new Date().toISOString()
        }
      }).promise();

      // Create audit log
      await createAuditLog(
        userId,
        'update',
        {
          viewId: existingViewId,
          materialId: materialId,
          completed: completed
        },
        event
      );

      return createResponse(200, {
        success: true,
        message: 'Material view updated successfully',
        data: result.Attributes
      });
    }

    // Create new material view
    const viewId = uuidv4();
    const timestamp = new Date().toISOString();

    const materialView = {
      view_id: viewId,
      enrollment_id: enrollmentId,
      user_id: userId,
      material_id: materialId,
      viewed_at: timestamp,
      completed: completed,
      notes: notes || null,
      standard_id: standardId || null,
      subject_id: subjectId || null,
      chapter_id: chapterId || null,
      section_id: sectionId || null,
      course_id: courseId || null,
      syllabus_id: syllabusId || null,
      view_count: 1,
      created_at: timestamp,
      updated_at: timestamp
    };

    await dynamoDB.put({
      TableName: MATERIAL_VIEWS_TABLE,
      Item: materialView
    }).promise();

    // Update enrollment progress
    await updateEnrollmentProgress(enrollmentId);

    // Update enrollment's last accessed material
    await dynamoDB.update({
      TableName: ENROLLMENTS_TABLE,
      Key: { enrollment_id: enrollmentId },
      UpdateExpression: 'SET last_accessed_material_id = :materialId, last_accessed_date = :accessed',
      ExpressionAttributeValues: {
        ':materialId': materialId,
        ':accessed': timestamp
      }
    }).promise();

    // Update user's viewed materials list
    await dynamoDB.update({
      TableName: USERS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: 'SET viewedMaterialIds = list_append(if_not_exists(viewedMaterialIds, :empty_list), :materialId)',
      ExpressionAttributeValues: {
        ':materialId': [materialId],
        ':empty_list': []
      }
    }).promise();

    // Create audit log
    await createAuditLog(
      userId,
      'view',
      {
        viewId: viewId,
        materialId: materialId,
        enrollmentId: enrollmentId
      },
      event
    );

    return createResponse(201, {
      success: true,
      message: 'Material view recorded successfully',
      data: materialView
    });

  } catch (error) {
    console.error('RecordMaterialView Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to record material view',
      error: error.message
    });
  }
}

// 2. Get Views by Enrollment
async function getViewsByEnrollment(event) {
  try {
    const enrollmentId = event.pathParameters?.enrollmentId;

    if (!enrollmentId) {
      return createResponse(400, {
        success: false,
        message: 'enrollmentId is required'
      });
    }

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 100;
    const completed = queryParams.completed;

    let params = {
      TableName: MATERIAL_VIEWS_TABLE,
      IndexName: 'enrollmentId-viewedAt-index',
      KeyConditionExpression: 'enrollment_id = :enrollmentId',
      ExpressionAttributeValues: {
        ':enrollmentId': enrollmentId
      },
      Limit: limit,
      ScanIndexForward: false // Most recent first
    };

    // Filter by completion status if provided
    if (completed !== undefined) {
      params.FilterExpression = 'completed = :completed';
      params.ExpressionAttributeValues[':completed'] = completed === 'true';
    }

    // Handle pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.query(params).promise();

    // Calculate statistics
    const stats = {
      totalViews: result.Items.length,
      completedCount: result.Items.filter(v => v.completed).length,
      inProgressCount: result.Items.filter(v => !v.completed).length,
      completionRate: result.Items.length > 0
        ? Math.round((result.Items.filter(v => v.completed).length / result.Items.length) * 100)
        : 0,
      totalViewCount: result.Items.reduce((sum, v) => sum + (v.view_count || 1), 0)
    };

    const response = {
      success: true,
      data: {
        enrollmentId: enrollmentId,
        views: result.Items,
        statistics: stats,
        count: result.Items.length
      }
    };

    // Add pagination token if more items exist
    if (result.LastEvaluatedKey) {
      response.data.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetViewsByEnrollment Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve views by enrollment',
      error: error.message
    });
  }
}

// 3. Get Views by User
async function getViewsByUser(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 100;
    const courseId = queryParams.courseId;
    const subjectId = queryParams.subjectId;
    const completed = queryParams.completed;

    let params = {
      TableName: MATERIAL_VIEWS_TABLE,
      IndexName: 'userId-viewedAt-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      },
      Limit: limit,
      ScanIndexForward: false // Most recent first
    };

    // Build filter expression
    const filterExpressions = [];

    if (courseId) {
      filterExpressions.push('course_id = :courseId');
      params.ExpressionAttributeValues[':courseId'] = courseId;
    }

    if (subjectId) {
      filterExpressions.push('subject_id = :subjectId');
      params.ExpressionAttributeValues[':subjectId'] = subjectId;
    }

    if (completed !== undefined) {
      filterExpressions.push('completed = :completed');
      params.ExpressionAttributeValues[':completed'] = completed === 'true';
    }

    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
    }

    // Handle pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.query(params).promise();

    // Get user details
    const userResult = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: userId }
    }).promise();

    // Group by course
    const byCourse = {};
    result.Items.forEach(view => {
      if (view.course_id) {
        if (!byCourse[view.course_id]) {
          byCourse[view.course_id] = {
            courseId: view.course_id,
            views: [],
            completed: 0,
            inProgress: 0
          };
        }
        byCourse[view.course_id].views.push(view);
        if (view.completed) {
          byCourse[view.course_id].completed++;
        } else {
          byCourse[view.course_id].inProgress++;
        }
      }
    });

    // Calculate statistics
    const stats = {
      totalViews: result.Items.length,
      completedCount: result.Items.filter(v => v.completed).length,
      inProgressCount: result.Items.filter(v => !v.completed).length,
      uniqueMaterials: [...new Set(result.Items.map(v => v.material_id))].length,
      uniqueCourses: Object.keys(byCourse).length,
      totalViewCount: result.Items.reduce((sum, v) => sum + (v.view_count || 1), 0)
    };

    const response = {
      success: true,
      data: {
        user: userResult.Item ? {
          userId: userResult.Item.user_id,
          email: userResult.Item.email,
          fullName: userResult.Item.full_name
        } : null,
        views: result.Items,
        groupedByCourse: Object.values(byCourse),
        statistics: stats,
        count: result.Items.length
      }
    };

    // Add pagination token if more items exist
    if (result.LastEvaluatedKey) {
      response.data.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetViewsByUser Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve views by user',
      error: error.message
    });
  }
}

// 4. Update Completion Status
async function updateViewCompletion(event) {
  try {
    const viewId = event.pathParameters?.viewId;

    if (!viewId) {
      return createResponse(400, {
        success: false,
        message: 'viewId is required'
      });
    }

    const { completed, notes } = JSON.parse(event.body);

    // Get current view
    const currentView = await dynamoDB.get({
      TableName: MATERIAL_VIEWS_TABLE,
      Key: { view_id: viewId }
    }).promise();

    if (!currentView.Item) {
      return createResponse(404, {
        success: false,
        message: 'Material view not found'
      });
    }

    // Build update expression
    let updateExpression = 'SET updated_at = :updated_at';
    const expressionAttributeValues = {
      ':updated_at': new Date().toISOString()
    };

    if (completed !== undefined) {
      updateExpression += ', completed = :completed';
      expressionAttributeValues[':completed'] = completed;
    }

    if (notes !== undefined) {
      updateExpression += ', notes = :notes';
      expressionAttributeValues[':notes'] = notes;
    }

    const result = await dynamoDB.update({
      TableName: MATERIAL_VIEWS_TABLE,
      Key: { view_id: viewId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    }).promise();

    // Update enrollment progress if completion status changed
    if (completed !== undefined && completed !== currentView.Item.completed) {
      await updateEnrollmentProgress(currentView.Item.enrollment_id);
    }

    // Create audit log
    await createAuditLog(
      currentView.Item.user_id,
      'update',
      {
        viewId: viewId,
        materialId: currentView.Item.material_id,
        completed: completed,
        notesUpdated: notes !== undefined
      },
      event
    );

    return createResponse(200, {
      success: true,
      message: 'Material view updated successfully',
      data: result.Attributes
    });

  } catch (error) {
    console.error('UpdateViewCompletion Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to update material view',
      error: error.message
    });
  }
}

// 5. Get Material Notes
async function getMaterialNotes(event) {
  try {
    const materialId = event.pathParameters?.materialId;
    const userId = event.pathParameters?.userId;

    if (!materialId) {
      return createResponse(400, {
        success: false,
        message: 'materialId is required'
      });
    }

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    // Find view for this material and user
    const result = await dynamoDB.query({
      TableName: MATERIAL_VIEWS_TABLE,
      IndexName: 'userId-viewedAt-index',
      KeyConditionExpression: 'user_id = :userId',
      FilterExpression: 'material_id = :materialId',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':materialId': materialId
      }
    }).promise();

    if (!result.Items || result.Items.length === 0) {
      return createResponse(404, {
        success: false,
        message: 'No notes found for this material'
      });
    }

    const view = result.Items[0];

    return createResponse(200, {
      success: true,
      data: {
        viewId: view.view_id,
        materialId: view.material_id,
        userId: view.user_id,
        notes: view.notes,
        completed: view.completed,
        viewedAt: view.viewed_at,
        viewCount: view.view_count || 1
      }
    });

  } catch (error) {
    console.error('GetMaterialNotes Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve material notes',
      error: error.message
    });
  }
}

// 6. Get View Details
async function getViewDetails(event) {
  try {
    const viewId = event.pathParameters?.viewId;

    if (!viewId) {
      return createResponse(400, {
        success: false,
        message: 'viewId is required'
      });
    }

    const result = await dynamoDB.get({
      TableName: MATERIAL_VIEWS_TABLE,
      Key: { view_id: viewId }
    }).promise();

    if (!result.Item) {
      return createResponse(404, {
        success: false,
        message: 'Material view not found'
      });
    }

    // Get user details
    const userResult = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: result.Item.user_id }
    }).promise();

    // Get enrollment details
    const enrollmentResult = await dynamoDB.get({
      TableName: ENROLLMENTS_TABLE,
      Key: { enrollment_id: result.Item.enrollment_id }
    }).promise();

    const viewData = {
      ...result.Item,
      user: userResult.Item ? {
        userId: userResult.Item.user_id,
        email: userResult.Item.email,
        fullName: userResult.Item.full_name
      } : null,
      enrollment: enrollmentResult.Item || null
    };

    return createResponse(200, {
      success: true,
      data: viewData
    });

  } catch (error) {
    console.error('GetViewDetails Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve view details',
      error: error.message
    });
  }
}

// 7. Get Views by Material
async function getViewsByMaterial(event) {
  try {
    const materialId = event.pathParameters?.materialId;

    if (!materialId) {
      return createResponse(400, {
        success: false,
        message: 'materialId is required'
      });
    }

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 100;

    let params = {
      TableName: MATERIAL_VIEWS_TABLE,
      IndexName: 'materialId-viewedAt-index',
      KeyConditionExpression: 'material_id = :materialId',
      ExpressionAttributeValues: {
        ':materialId': materialId
      },
      Limit: limit,
      ScanIndexForward: false // Most recent first
    };

    // Handle pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.query(params).promise();

    // Calculate statistics
    const stats = {
      totalViews: result.Items.length,
      uniqueUsers: [...new Set(result.Items.map(v => v.user_id))].length,
      completedCount: result.Items.filter(v => v.completed).length,
      completionRate: result.Items.length > 0
        ? Math.round((result.Items.filter(v => v.completed).length / result.Items.length) * 100)
        : 0,
      totalViewCount: result.Items.reduce((sum, v) => sum + (v.view_count || 1), 0)
    };

    const response = {
      success: true,
      data: {
        materialId: materialId,
        views: result.Items,
        statistics: stats,
        count: result.Items.length
      }
    };

    // Add pagination token if more items exist
    if (result.LastEvaluatedKey) {
      response.data.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetViewsByMaterial Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve views by material',
      error: error.message
    });
  }
}

// 8. Delete Material View
async function deleteMaterialView(event) {
  try {
    const viewId = event.pathParameters?.viewId;

    if (!viewId) {
      return createResponse(400, {
        success: false,
        message: 'viewId is required'
      });
    }

    // Get view details before deletion
    const viewResult = await dynamoDB.get({
      TableName: MATERIAL_VIEWS_TABLE,
      Key: { view_id: viewId }
    }).promise();

    if (!viewResult.Item) {
      return createResponse(404, {
        success: false,
        message: 'Material view not found'
      });
    }

    const view = viewResult.Item;

    // Delete the view
    await dynamoDB.delete({
      TableName: MATERIAL_VIEWS_TABLE,
      Key: { view_id: viewId }
    }).promise();

    // Update enrollment progress
    await updateEnrollmentProgress(view.enrollment_id);

    // Create audit log
    await createAuditLog(
      view.user_id,
      'delete',
      {
        viewId: viewId,
        materialId: view.material_id,
        enrollmentId: view.enrollment_id
      },
      event
    );

    return createResponse(200, {
      success: true,
      message: 'Material view deleted successfully'
    });

  } catch (error) {
    console.error('DeleteMaterialView Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to delete material view',
      error: error.message
    });
  }
}

// 9. Get Learning Analytics
async function getLearningAnalytics(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const userId = queryParams.userId;
    const courseId = queryParams.courseId;
    const startDate = queryParams.startDate;
    const endDate = queryParams.endDate;

    let params = {
      TableName: MATERIAL_VIEWS_TABLE
    };

    // Build filter expression
    const filterExpressions = [];
    const expressionAttributeValues = {};

    if (userId) {
      filterExpressions.push('user_id = :userId');
      expressionAttributeValues[':userId'] = userId;
    }

    if (courseId) {
      filterExpressions.push('course_id = :courseId');
      expressionAttributeValues[':courseId'] = courseId;
    }

    if (startDate && endDate) {
      filterExpressions.push('viewed_at BETWEEN :startDate AND :endDate');
      expressionAttributeValues[':startDate'] = startDate;
      expressionAttributeValues[':endDate'] = endDate;
    }

    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
      params.ExpressionAttributeValues = expressionAttributeValues;
    }

    const result = await dynamoDB.scan(params).promise();
    const views = result.Items;

    // Calculate analytics
    const analytics = {
      overview: {
        totalViews: views.length,
        uniqueUsers: [...new Set(views.map(v => v.user_id))].length,
        uniqueMaterials: [...new Set(views.map(v => v.material_id))].length,
        completedMaterials: views.filter(v => v.completed).length,
        overallCompletionRate: views.length > 0
          ? Math.round((views.filter(v => v.completed).length / views.length) * 100)
          : 0
      },

      bySubject: {},
      byChapter: {},
      byCourse: {},

      timeDistribution: {},
      
      topMaterials: {},
      
      userEngagement: {}
    };

    // Aggregate by subject
    views.forEach(view => {
      if (view.subject_id) {
        if (!analytics.bySubject[view.subject_id]) {
          analytics.bySubject[view.subject_id] = {
            subjectId: view.subject_id,
            views: 0,
            completed: 0,
            inProgress: 0
          };
        }
        analytics.bySubject[view.subject_id].views++;
        if (view.completed) {
          analytics.bySubject[view.subject_id].completed++;
        } else {
          analytics.bySubject[view.subject_id].inProgress++;
        }
      }

      // By chapter
      if (view.chapter_id) {
        if (!analytics.byChapter[view.chapter_id]) {
          analytics.byChapter[view.chapter_id] = {
            chapterId: view.chapter_id,
            views: 0,
            completed: 0
          };
        }
        analytics.byChapter[view.chapter_id].views++;
        if (view.completed) {
          analytics.byChapter[view.chapter_id].completed++;
        }
      }

      // By course
      if (view.course_id) {
        if (!analytics.byCourse[view.course_id]) {
          analytics.byCourse[view.course_id] = {
            courseId: view.course_id,
            views: 0,
            completed: 0,
            uniqueUsers: new Set()
          };
        }
        analytics.byCourse[view.course_id].views++;
        analytics.byCourse[view.course_id].uniqueUsers.add(view.user_id);
        if (view.completed) {
          analytics.byCourse[view.course_id].completed++;
        }
      }

      // Time distribution
      const date = view.viewed_at.split('T')[0];
      analytics.timeDistribution[date] = (analytics.timeDistribution[date] || 0) + 1;

      // Top materials
      if (!analytics.topMaterials[view.material_id]) {
        analytics.topMaterials[view.material_id] = {
          materialId: view.material_id,
          viewCount: 0,
          uniqueUsers: new Set()
        };
      }
      analytics.topMaterials[view.material_id].viewCount += (view.view_count || 1);
      analytics.topMaterials[view.material_id].uniqueUsers.add(view.user_id);

      // User engagement
      if (!analytics.userEngagement[view.user_id]) {
        analytics.userEngagement[view.user_id] = {
          userId: view.user_id,
          totalViews: 0,
          completed: 0,
          lastActive: view.viewed_at
        };
      }
      analytics.userEngagement[view.user_id].totalViews++;
      if (view.completed) {
        analytics.userEngagement[view.user_id].completed++;
      }
      if (view.viewed_at > analytics.userEngagement[view.user_id].lastActive) {
        analytics.userEngagement[view.user_id].lastActive = view.viewed_at;
      }
    });

    // Convert Sets to counts and sort
    Object.values(analytics.byCourse).forEach(course => {
      course.uniqueUsers = course.uniqueUsers.size;
    });

    analytics.topMaterials = Object.values(analytics.topMaterials)
      .map(m => ({
        ...m,
        uniqueUsers: m.uniqueUsers.size
      }))
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, 10);

    analytics.topUsers = Object.values(analytics.userEngagement)
      .sort((a, b) => b.totalViews - a.totalViews)
      .slice(0, 10);

    return createResponse(200, {
      success: true,
      data: analytics
    });

  } catch (error) {
    console.error('GetLearningAnalytics Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve learning analytics',
      error: error.message
    });
  }
}

module.exports = {
  recordMaterialView: JWSauthenticate(recordMaterialView),
  getViewsByEnrollment: JWSauthenticate(getViewsByEnrollment),
  getViewsByUser: JWSauthenticate(getViewsByUser),
  updateViewCompletion: JWSauthenticate(updateViewCompletion),
  getMaterialNotes: JWSauthenticate(getMaterialNotes),
  getViewDetails: JWSauthenticate(getViewDetails),
  getViewsByMaterial: JWSauthenticate(getViewsByMaterial),
  deleteMaterialView: JWSauthenticate(deleteMaterialView),
  getLearningAnalytics: JWSauthenticate(getLearningAnalytics)
};
