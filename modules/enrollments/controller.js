require('dotenv').config();
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require('uuid');
const { JWSauthenticate } = require("../../components/JWTtoken");

AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const ENROLLMENTS_TABLE = process.env.ENROLLMENTS_TABLE || 'TestEnrollments';
const USERS_TABLE = process.env.USERS_TABLE || 'TestUsers';
const COURSES_TABLE = process.env.COURSES_TABLE || 'Courses';
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
        module: 'Enrollment',
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

// 1. Enroll in Course/Exam
async function enrollInCourse(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const {
      userId,
      courseId,
      examId,
      bundleId,
      enrollmentType = 'course' // course, exam, or bundle
    } = JSON.parse(event.body);

    // Validation
    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    if (!courseId && !examId) {
      return createResponse(400, {
        success: false,
        message: 'Either courseId or examId is required'
      });
    }

    // Check if user exists
    const userResult = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: userId }
    }).promise();

    if (!userResult.Item) {
      return createResponse(404, {
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is active
    if (userResult.Item.status !== 'active') {
      return createResponse(403, {
        success: false,
        message: 'User account is not active'
      });
    }

    // Check for duplicate enrollment
 let params;
if (courseId) {
  // Query using partition and sort key in KeyConditionExpression
  params = {
    TableName: ENROLLMENTS_TABLE,
    IndexName: 'userId-courseId-index',
    KeyConditionExpression: 'user_id = :userId AND course_id = :courseId',
    ExpressionAttributeValues: {
      ':userId': userId,
      ':courseId': courseId
    },
    Limit: 1
  };
} else if (examId) {
  // If you don't have an index with exam_id as sort key,
  // fall back to Scan with a filter expression (less optimal)
  params = {
    TableName: ENROLLMENTS_TABLE,
    FilterExpression: 'user_id = :userId AND exam_id = :examId',
    ExpressionAttributeValues: {
      ':userId': userId,
      ':examId': examId
    },
    Limit: 1
  };
} else {
  return createResponse(400, {
    success: false,
    message: 'Either courseId or examId is required'
  });
}

// Execute the appropriate DynamoDB call
const existingEnrollment = params.KeyConditionExpression 
  ? await dynamoDB.query(params).promise() 
  : await dynamoDB.scan(params).promise();

if (existingEnrollment.Items && existingEnrollment.Items.length > 0) {
  return createResponse(409, {
    success: false,
    message: 'User is already enrolled in this course/exam',
    existingEnrollmentId: existingEnrollment.Items[0].enrollment_id
  });
}

    const enrollmentId = uuidv4();
    const timestamp = new Date().toISOString();

    const enrollment = {
      enrollment_id: enrollmentId,
      user_id: userId,
      course_id: courseId || null,
      exam_id: examId || null,
      bundle_id: bundleId || null,
      enrollment_type: enrollmentType,
      enrollment_date: timestamp,
      progress: 0,
      completion_status: 'not_started',
      last_accessed_material_id: null,
      last_accessed_date: null,
      is_active: true,
      created_at: timestamp,
      updated_at: timestamp
    };

    await dynamoDB.put({
      TableName: ENROLLMENTS_TABLE,
      Item: enrollment
    }).promise();

    // Update user's enrolled courses/exams list
    const updateExpression = courseId 
      ? 'SET enrolledCourseIds = list_append(if_not_exists(enrolledCourseIds, :empty_list), :courseId)'
      : 'SET enrolledExamIds = list_append(if_not_exists(enrolledExamIds, :empty_list), :examId)';
    
    const expressionValues = courseId
      ? { ':courseId': [courseId], ':empty_list': [] }
      : { ':examId': [examId], ':empty_list': [] };

    await dynamoDB.update({
      TableName: USERS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionValues
    }).promise();

    // Create audit log
    await createAuditLog(
      userId,
      'enroll',
      {
        enrollmentId: enrollmentId,
        courseId: courseId,
        examId: examId,
        enrollmentType: enrollmentType
      },
      event
    );

    return createResponse(201, {
      success: true,
      message: 'Enrollment successful',
      data: enrollment
    });

  } catch (error) {
    console.error('EnrollInCourse Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to enroll in course',
      error: error.message
    });
  }
}

async function getUserEnrollments(event) {
  try {
    const userId = event.pathParameters?.userId;
    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;
    const enrollmentType = queryParams.type;
    const status = queryParams.status;
    const isActive = queryParams.isActive !== 'false';

    let params = {
      TableName: ENROLLMENTS_TABLE,
      IndexName: 'userId-enrollmentDate-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      },
      Limit: limit,
      ScanIndexForward: false // Most recent first
    };

    // Build filter expression and conditionally add ExpressionAttributeNames
    const filterExpressions = [];
    const expressionAttributeNames = {};

    if (enrollmentType) {
      filterExpressions.push('#enrollment_type = :type');
      expressionAttributeNames['#enrollment_type'] = 'enrollment_type';
      params.ExpressionAttributeValues[':type'] = enrollmentType;
    }
    if (status) {
      filterExpressions.push('#completion_status = :status');
      expressionAttributeNames['#completion_status'] = 'completion_status';
      params.ExpressionAttributeValues[':status'] = status;
    }
    if (isActive) {
      filterExpressions.push('#is_active = :active');
      expressionAttributeNames['#is_active'] = 'is_active';
      params.ExpressionAttributeValues[':active'] = true;
    }

    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
      params.ExpressionAttributeNames = expressionAttributeNames;
    }

    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.query(params).promise();

    const userResult = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: userId }
    }).promise();

    const stats = {
      total: result.Items.length,
      notStarted: result.Items.filter(e => e.completion_status === 'not_started').length,
      inProgress: result.Items.filter(e => e.completion_status === 'in_progress').length,
      completed: result.Items.filter(e => e.completion_status === 'completed').length,
      averageProgress: result.Items.length > 0
        ? Math.round(result.Items.reduce((sum, e) => sum + (e.progress || 0), 0) / result.Items.length)
        : 0
    };

    const response = {
      success: true,
      data: {
        user: userResult.Item ? {
          userId: userResult.Item.user_id,
          email: userResult.Item.email,
          fullName: userResult.Item.full_name
        } : null,
        enrollments: result.Items,
        statistics: stats,
        count: result.Items.length
      }
    };

    if (result.LastEvaluatedKey) {
      response.data.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetUserEnrollments Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve user enrollments',
      error: error.message
    });
  }
}


// 3. Get Course Enrollments
async function getCourseEnrollments(event) {
  try {
    const courseId = event.pathParameters?.courseId;

    if (!courseId) {
      return createResponse(400, {
        success: false,
        message: 'courseId is required'
      });
    }

    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;
    const status = queryParams.status;

    let params = {
      TableName: ENROLLMENTS_TABLE,
      IndexName: 'courseId-enrollmentDate-index',
      KeyConditionExpression: 'course_id = :courseId',
      ExpressionAttributeValues: {
        ':courseId': courseId
      },
      Limit: limit,
      ScanIndexForward: false // Most recent first
    };

    // Filter by completion status if provided
    if (status) {
      params.FilterExpression = 'completion_status = :status';
      params.ExpressionAttributeValues[':status'] = status;
    }

    // Handle pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.query(params).promise();

    // Enrich with user details
    const enrollmentsWithUsers = await Promise.all(
      result.Items.map(async (enrollment) => {
        const userResult = await dynamoDB.get({
          TableName: USERS_TABLE,
          Key: { user_id: enrollment.user_id }
        }).promise();

        return {
          ...enrollment,
          user: userResult.Item ? {
            userId: userResult.Item.user_id,
            email: userResult.Item.email,
            fullName: userResult.Item.full_name,
            status: userResult.Item.status
          } : null
        };
      })
    );

    // Calculate statistics
    const stats = {
      totalEnrollments: result.Items.length,
      activeEnrollments: result.Items.filter(e => e.is_active).length,
      notStarted: result.Items.filter(e => e.completion_status === 'not_started').length,
      inProgress: result.Items.filter(e => e.completion_status === 'in_progress').length,
      completed: result.Items.filter(e => e.completion_status === 'completed').length,
      averageProgress: result.Items.length > 0
        ? Math.round(result.Items.reduce((sum, e) => sum + (e.progress || 0), 0) / result.Items.length)
        : 0,
      completionRate: result.Items.length > 0
        ? Math.round((result.Items.filter(e => e.completion_status === 'completed').length / result.Items.length) * 100)
        : 0
    };

    const response = {
      success: true,
      data: {
        courseId: courseId,
        enrollments: enrollmentsWithUsers,
        statistics: stats,
        count: enrollmentsWithUsers.length
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
    console.error('GetCourseEnrollments Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve course enrollments',
      error: error.message
    });
  }
}

// 4. Get Enrollment Details
async function getEnrollmentDetails(event) {
  try {
    const enrollmentId = event.pathParameters?.enrollmentId;

    if (!enrollmentId) {
      return createResponse(400, {
        success: false,
        message: 'enrollmentId is required'
      });
    }

    const result = await dynamoDB.get({
      TableName: ENROLLMENTS_TABLE,
      Key: { enrollment_id: enrollmentId }
    }).promise();

    if (!result.Item) {
      return createResponse(404, {
        success: false,
        message: 'Enrollment not found'
      });
    }

    // Get user details
    const userResult = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: result.Item.user_id }
    }).promise();

    const enrollmentData = {
      ...result.Item,
      user: userResult.Item ? {
        userId: userResult.Item.user_id,
        email: userResult.Item.email,
        fullName: userResult.Item.full_name,
        status: userResult.Item.status
      } : null
    };

    return createResponse(200, {
      success: true,
      data: enrollmentData
    });

  } catch (error) {
    console.error('GetEnrollmentDetails Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve enrollment details',
      error: error.message
    });
  }
}

// 5. Update Enrollment Progress
async function updateEnrollmentProgress(event) {
  try {
    const enrollmentId = event.pathParameters?.enrollmentId;

    if (!enrollmentId) {
      return createResponse(400, {
        success: false,
        message: 'enrollmentId is required'
      });
    }

    const {
      progress,
      completionStatus,
      lastAccessedMaterialId
    } = JSON.parse(event.body);

    // Get current enrollment
    const currentEnrollment = await dynamoDB.get({
      TableName: ENROLLMENTS_TABLE,
      Key: { enrollment_id: enrollmentId }
    }).promise();

    if (!currentEnrollment.Item) {
      return createResponse(404, {
        success: false,
        message: 'Enrollment not found'
      });
    }

    // Validate progress
    if (progress !== undefined && (progress < 0 || progress > 100)) {
      return createResponse(400, {
        success: false,
        message: 'Progress must be between 0 and 100'
      });
    }

    // Validate completion status
    const validStatuses = ['not_started', 'in_progress', 'completed'];
    if (completionStatus && !validStatuses.includes(completionStatus)) {
      return createResponse(400, {
        success: false,
        message: `Invalid completion status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Build update expression
    let updateExpression = 'SET updated_at = :updated_at, last_accessed_date = :accessedDate';
    const expressionAttributeValues = {
      ':updated_at': new Date().toISOString(),
      ':accessedDate': new Date().toISOString()
    };

    if (progress !== undefined) {
      updateExpression += ', progress = :progress';
      expressionAttributeValues[':progress'] = progress;

      // Auto-update completion status based on progress
      if (progress === 0) {
        updateExpression += ', completion_status = :status';
        expressionAttributeValues[':status'] = 'not_started';
      } else if (progress === 100) {
        updateExpression += ', completion_status = :status';
        expressionAttributeValues[':status'] = 'completed';
      } else if (progress > 0 && progress < 100) {
        updateExpression += ', completion_status = :status';
        expressionAttributeValues[':status'] = 'in_progress';
      }
    }

    if (completionStatus) {
      updateExpression += ', completion_status = :status';
      expressionAttributeValues[':status'] = completionStatus;

      // Auto-update progress based on status
      if (completionStatus === 'completed' && progress !== 100) {
        updateExpression += ', progress = :fullProgress';
        expressionAttributeValues[':fullProgress'] = 100;
      }
    }

    if (lastAccessedMaterialId) {
      updateExpression += ', last_accessed_material_id = :materialId';
      expressionAttributeValues[':materialId'] = lastAccessedMaterialId;
    }

    const result = await dynamoDB.update({
      TableName: ENROLLMENTS_TABLE,
      Key: { enrollment_id: enrollmentId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    }).promise();

    // Create audit log
    await createAuditLog(
      currentEnrollment.Item.user_id,
      'update',
      {
        enrollmentId: enrollmentId,
        oldProgress: currentEnrollment.Item.progress,
        newProgress: result.Attributes.progress,
        completionStatus: result.Attributes.completion_status
      },
      event
    );

    return createResponse(200, {
      success: true,
      message: 'Enrollment progress updated successfully',
      data: result.Attributes
    });

  } catch (error) {
    console.error('UpdateEnrollmentProgress Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to update enrollment progress',
      error: error.message
    });
  }
}

// 6. Unenroll / Remove Enrollment
async function unenrollFromCourse(event) {
  try {
    const enrollmentId = event.pathParameters?.enrollmentId;
    const permanent = event.queryStringParameters?.permanent === 'true';

    if (!enrollmentId) {
      return createResponse(400, {
        success: false,
        message: 'enrollmentId is required'
      });
    }

    // Get enrollment details
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

    const enrollment = enrollmentResult.Item;

    if (permanent) {
      // Permanent deletion
      await dynamoDB.delete({
        TableName: ENROLLMENTS_TABLE,
        Key: { enrollment_id: enrollmentId }
      }).promise();

      // Remove from user's enrolled courses list
      if (enrollment.course_id) {
        const userResult = await dynamoDB.get({
          TableName: USERS_TABLE,
          Key: { user_id: enrollment.user_id }
        }).promise();

        if (userResult.Item && userResult.Item.enrolledCourseIds) {
          const updatedCourses = userResult.Item.enrolledCourseIds.filter(
            id => id !== enrollment.course_id
          );

          await dynamoDB.update({
            TableName: USERS_TABLE,
            Key: { user_id: enrollment.user_id },
            UpdateExpression: 'SET enrolledCourseIds = :courses',
            ExpressionAttributeValues: {
              ':courses': updatedCourses
            }
          }).promise();
        }
      }

      // Create audit log
      await createAuditLog(
        enrollment.user_id,
        'unenroll',
        {
          enrollmentId: enrollmentId,
          courseId: enrollment.course_id,
          permanent: true
        },
        event
      );

      return createResponse(200, {
        success: true,
        message: 'Enrollment permanently deleted'
      });

    } else {
      // Soft delete - mark as inactive
      await dynamoDB.update({
        TableName: ENROLLMENTS_TABLE,
        Key: { enrollment_id: enrollmentId },
        UpdateExpression: 'SET is_active = :false, unenrolled_at = :unenrolledAt, updated_at = :updated',
        ExpressionAttributeValues: {
          ':false': false,
          ':unenrolledAt': new Date().toISOString(),
          ':updated': new Date().toISOString()
        }
      }).promise();

      // Create audit log
      await createAuditLog(
        enrollment.user_id,
        'unenroll',
        {
          enrollmentId: enrollmentId,
          courseId: enrollment.course_id,
          permanent: false
        },
        event
      );

      return createResponse(200, {
        success: true,
        message: 'Enrollment deactivated successfully'
      });
    }

  } catch (error) {
    console.error('UnenrollFromCourse Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to unenroll from course',
      error: error.message
    });
  }
}

// 7. Reactivate Enrollment
async function reactivateEnrollment(event) {
  try {
    const enrollmentId = event.pathParameters?.enrollmentId;

    if (!enrollmentId) {
      return createResponse(400, {
        success: false,
        message: 'enrollmentId is required'
      });
    }

    const result = await dynamoDB.update({
      TableName: ENROLLMENTS_TABLE,
      Key: { enrollment_id: enrollmentId },
      UpdateExpression: 'SET is_active = :true, updated_at = :updated REMOVE unenrolled_at',
      ExpressionAttributeValues: {
        ':true': true,
        ':updated': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    }).promise();

    return createResponse(200, {
      success: true,
      message: 'Enrollment reactivated successfully',
      data: result.Attributes
    });

  } catch (error) {
    console.error('ReactivateEnrollment Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to reactivate enrollment',
      error: error.message
    });
  }
}

// 8. Bulk Enroll Users
async function bulkEnrollUsers(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const { userIds, courseId, examId } = JSON.parse(event.body);

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return createResponse(400, {
        success: false,
        message: 'userIds array is required'
      });
    }

    if (!courseId && !examId) {
      return createResponse(400, {
        success: false,
        message: 'Either courseId or examId is required'
      });
    }

    const results = {
      successful: [],
      failed: [],
      skipped: []
    };

    for (const userId of userIds) {
      try {
        // Check if already enrolled
        const existingEnrollment = await dynamoDB.query({
          TableName: ENROLLMENTS_TABLE,
          IndexName: 'userId-courseId-index',
          KeyConditionExpression: 'user_id = :userId',
          FilterExpression: courseId ? 'course_id = :courseId' : 'exam_id = :examId',
          ExpressionAttributeValues: {
            ':userId': userId,
            ...(courseId ? { ':courseId': courseId } : { ':examId': examId })
          }
        }).promise();

        if (existingEnrollment.Items && existingEnrollment.Items.length > 0) {
          results.skipped.push({
            userId: userId,
            reason: 'Already enrolled'
          });
          continue;
        }

        const enrollmentId = uuidv4();
        const timestamp = new Date().toISOString();

        const enrollment = {
          enrollment_id: enrollmentId,
          user_id: userId,
          course_id: courseId || null,
          exam_id: examId || null,
          bundle_id: null,
          enrollment_type: courseId ? 'course' : 'exam',
          enrollment_date: timestamp,
          progress: 0,
          completion_status: 'not_started',
          last_accessed_material_id: null,
          is_active: true,
          created_at: timestamp,
          updated_at: timestamp
        };

        await dynamoDB.put({
          TableName: ENROLLMENTS_TABLE,
          Item: enrollment
        }).promise();

        results.successful.push({
          userId: userId,
          enrollmentId: enrollmentId
        });

      } catch (error) {
        results.failed.push({
          userId: userId,
          error: error.message
        });
      }
    }

    return createResponse(200, {
      success: true,
      message: 'Bulk enrollment completed',
      data: {
        total: userIds.length,
        successful: results.successful.length,
        failed: results.failed.length,
        skipped: results.skipped.length,
        details: results
      }
    });

  } catch (error) {
    console.error('BulkEnrollUsers Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to bulk enroll users',
      error: error.message
    });
  }
}

// 9. Get Enrollment Statistics
async function getEnrollmentStatistics(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const courseId = queryParams.courseId;
    const userId = queryParams.userId;
    const startDate = queryParams.startDate;
    const endDate = queryParams.endDate;

    let params = {
      TableName: ENROLLMENTS_TABLE
    };

    // Build filter expression
    const filterExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    if (courseId) {
      filterExpressions.push('course_id = :courseId');
      expressionAttributeValues[':courseId'] = courseId;
    }

    if (userId) {
      filterExpressions.push('user_id = :userId');
      expressionAttributeValues[':userId'] = userId;
    }

    if (startDate && endDate) {
      filterExpressions.push('enrollment_date BETWEEN :startDate AND :endDate');
      expressionAttributeValues[':startDate'] = startDate;
      expressionAttributeValues[':endDate'] = endDate;
    }

    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
      params.ExpressionAttributeValues = expressionAttributeValues;
      if (Object.keys(expressionAttributeNames).length > 0) {
        params.ExpressionAttributeNames = expressionAttributeNames;
      }
    }

    const result = await dynamoDB.scan(params).promise();
    const enrollments = result.Items;

    // Calculate comprehensive statistics
    const statistics = {
      totalEnrollments: enrollments.length,
      activeEnrollments: enrollments.filter(e => e.is_active).length,
      inactiveEnrollments: enrollments.filter(e => !e.is_active).length,
      
      byStatus: {
        notStarted: enrollments.filter(e => e.completion_status === 'not_started').length,
        inProgress: enrollments.filter(e => e.completion_status === 'in_progress').length,
        completed: enrollments.filter(e => e.completion_status === 'completed').length
      },
      
      byType: {
        course: enrollments.filter(e => e.enrollment_type === 'course').length,
        exam: enrollments.filter(e => e.enrollment_type === 'exam').length,
        bundle: enrollments.filter(e => e.enrollment_type === 'bundle').length
      },
      
      progressMetrics: {
        averageProgress: enrollments.length > 0
          ? Math.round(enrollments.reduce((sum, e) => sum + (e.progress || 0), 0) / enrollments.length)
          : 0,
        completionRate: enrollments.length > 0
          ? Math.round((enrollments.filter(e => e.completion_status === 'completed').length / enrollments.length) * 100)
          : 0
      },
      
      timeMetrics: {
        enrollmentsLast7Days: enrollments.filter(e => {
          const enrollDate = new Date(e.enrollment_date);
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          return enrollDate >= sevenDaysAgo;
        }).length,
        
        enrollmentsLast30Days: enrollments.filter(e => {
          const enrollDate = new Date(e.enrollment_date);
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          return enrollDate >= thirtyDaysAgo;
        }).length
      }
    };

    return createResponse(200, {
      success: true,
      data: statistics
    });

  } catch (error) {
    console.error('GetEnrollmentStatistics Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve enrollment statistics',
      error: error.message
    });
  }
}

module.exports = {
  enrollInCourse: JWSauthenticate(enrollInCourse),
  getUserEnrollments: JWSauthenticate(getUserEnrollments),
  getCourseEnrollments: JWSauthenticate(getCourseEnrollments),
  getEnrollmentDetails: JWSauthenticate(getEnrollmentDetails),
  updateEnrollmentProgress: JWSauthenticate(updateEnrollmentProgress),
  unenrollFromCourse: JWSauthenticate(unenrollFromCourse),
  reactivateEnrollment: JWSauthenticate(reactivateEnrollment),
  bulkEnrollUsers: JWSauthenticate(bulkEnrollUsers),
  getEnrollmentStatistics: JWSauthenticate(getEnrollmentStatistics)
};
