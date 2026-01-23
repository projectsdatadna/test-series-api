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
const s3 = new AWS.S3();

const USER_PROFILES_TABLE = process.env.USER_PROFILES_TABLE || 'TestUserProfiles';
const USERS_TABLE = process.env.USERS_TABLE || 'TestUsers';
const S3_BUCKET = process.env.PROFILE_PICS_BUCKET || 'testseries-profile-pics';

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

// Validate date format (YYYY-MM-DD)
const isValidDate = (dateString) => {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;
  
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
};

// Calculate age from date of birth
const calculateAge = (dob) => {
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age;
};

// 1. Create Profile
async function createProfile(event) {
  try {
    if (!event || !event.body) {
      return createResponse(400, {
        success: false,
        message: 'Request body is required'
      });
    }

    const {
      userId,
      email,
      username,
      phone,
      dob,
      address,
      gender,
      userType,
      schoolName,
      standard,
      collegeName,
      degree,
      governmentExam
    } = JSON.parse(event.body);

    // Validation
    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    if (!email) {
      return createResponse(400, {
        success: false,
        message: 'email is required'
      });
    }

    // Check if user exists (optional, depends on your setup)
    const userExists = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: userId }
    }).promise();

    if (!userExists.Item) {
      return createResponse(404, {
        success: false,
        message: 'User not found'
      });
    }

    // Check if profile already exists for this user
    const existingProfile = await dynamoDB.query({
      TableName: USER_PROFILES_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      }
    }).promise();

    // Prepare profile data
    const profileId = uuidv4();
    const timestamp = new Date().toISOString();

    const profile = {
      profile_id: profileId,
      user_id: userId,
      email: email,
      username: username || null,
      phone: phone || null,
      dob: dob || null,
      address: address || null,
      gender: gender || null,
      userType: userType || null,
      schoolName: schoolName || null,
      standard: standard || null,
      collegeName: collegeName || null,
      degree: degree || null,
      governmentExam: governmentExam || null,
      created_at: timestamp,
      updated_at: timestamp
    };

    // If profile exists, update it instead of creating new
    if (existingProfile.Items && existingProfile.Items.length > 0) {
      const existingProfileId = existingProfile.Items[0].profile_id;
      
      // Remove profile_id and created_at from update as they shouldn't change
      delete profile.profile_id;
      delete profile.created_at;
      
      // Build update expression
      let updateExpression = 'SET updated_at = :updated_at';
      const expressionAttributeValues = {
        ':updated_at': timestamp
      };
      
      // Dynamically add fields that have values
      Object.keys(profile).forEach(key => {
        if (profile[key] !== null && key !== 'user_id') {
          updateExpression += `, ${key} = :${key}`;
          expressionAttributeValues[`:${key}`] = profile[key];
        }
      });
      
      await dynamoDB.update({
        TableName: USER_PROFILES_TABLE,
        Key: { profile_id: existingProfileId },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW'
      }).promise();
      
      // Get updated profile
      const updatedProfile = await dynamoDB.get({
        TableName: USER_PROFILES_TABLE,
        Key: { profile_id: existingProfileId }
      }).promise();
      
      return createResponse(200, {
        success: true,
        message: 'Profile updated successfully',
        data: updatedProfile.Item
      });
    } else {
      // Create new profile
      await dynamoDB.put({
        TableName: USER_PROFILES_TABLE,
        Item: profile
      }).promise();

      return createResponse(201, {
        success: true,
        message: 'Profile created successfully',
        data: profile
      });
    }

  } catch (error) {
    console.error('CreateProfile Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to save profile',
      error: error.message
    });
  }
}

// 2. Get Profile by User ID
async function getProfile(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    // Query by userId using GSI
    const result = await dynamoDB.query({
      TableName: USER_PROFILES_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      }
    }).promise();

    if (!result.Items || result.Items.length === 0) {
      return createResponse(404, {
        success: false,
        message: 'Profile not found for this user'
      });
    }

    // Get user details as well
    const userDetails = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: userId }
    }).promise();

    const profileData = {
      ...result.Items[0],
      user: userDetails.Item ? {
        email: userDetails.Item.email,
        fullName: userDetails.Item.full_name,
        status: userDetails.Item.status,
        roleId: userDetails.Item.role_id
      } : null
    };

    return createResponse(200, {
      success: true,
      data: profileData
    });

  } catch (error) {
    console.error('GetProfile Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve profile',
      error: error.message
    });
  }
}

// 3. Get Profile by Profile ID
async function getProfileById(event) {
  try {
    const profileId = event.pathParameters?.profileId;

    if (!profileId) {
      return createResponse(400, {
        success: false,
        message: 'profileId is required'
      });
    }

    const result = await dynamoDB.get({
      TableName: USER_PROFILES_TABLE,
      Key: { profile_id: profileId }
    }).promise();

    if (!result.Item) {
      return createResponse(404, {
        success: false,
        message: 'Profile not found'
      });
    }

    // Get user details as well
    const userDetails = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: result.Item.user_id }
    }).promise();

    const profileData = {
      ...result.Item,
      user: userDetails.Item ? {
        email: userDetails.Item.email,
        fullName: userDetails.Item.full_name,
        status: userDetails.Item.status,
        roleId: userDetails.Item.role_id
      } : null
    };

    return createResponse(200, {
      success: true,
      data: profileData
    });

  } catch (error) {
    console.error('GetProfileById Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve profile',
      error: error.message
    });
  }
}

// 4. Update Profile
async function updateProfile(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    const updates = JSON.parse(event.body);
    
    // Updated validation to include all fields
    if (!updates.phone && !updates.address && !updates.dob && !updates.gender && 
        !updates.profile_pic_url && !updates.bio && !updates.name && !updates.email &&
        !updates.userType && !updates.schoolName && !updates.standard &&
        !updates.collegeName && !updates.degree && !updates.governmentExam) {
      return createResponse(400, {
        success: false,
        message: 'At least one profile field is required'
      });
    }

    // Validate date of birth if provided
    if (updates.dob && !isValidDate(updates.dob)) {
      return createResponse(400, {
        success: false,
        message: 'Invalid date format for dob. Use YYYY-MM-DD format'
      });
    }

    // Validate gender if provided
    const validGenders = ['male', 'female', 'other'];
    if (updates.gender && !validGenders.includes(updates.gender.toLowerCase())) {
      return createResponse(400, {
        success: false,
        message: 'Invalid gender. Must be one of: male, female, other'
      });
    }

    // Validate userType if provided
    const validUserTypes = ['student', 'college', 'bachelor'];
    if (updates.userType && !validUserTypes.includes(updates.userType.toLowerCase())) {
      return createResponse(400, {
        success: false,
        message: 'Invalid userType. Must be one of: student, college, bachelor'
      });
    }

    // Check if profile exists
    let profileId;
    try {
      const existingProfile = await dynamoDB.query({
        TableName: USER_PROFILES_TABLE,
        IndexName: 'userId-index',
        KeyConditionExpression: 'user_id = :userId',
        ExpressionAttributeValues: { ':userId': userId }
      }).promise();

      if (existingProfile.Items && existingProfile.Items.length > 0) {
        profileId = existingProfile.Items[0].profile_id;
        console.log('Profile found, updating:', profileId);
      }
    } catch (queryError) {
      console.log('Profile query failed (might not exist), will create new:', queryError.message);
    }

    // Updated fields that can be updated/created - ADD ALL FIELDS
    const allowedFields = [
      'name', 'email', 'phone', 'address', 'dob', 'gender', 
      'profile_pic_url', 'bio', 'userType', 'schoolName', 
      'standard', 'collegeName', 'degree', 'governmentExam'
    ];

    // Build update expression
    let updateExpression = 'SET ';
    const expressionAttributeNames = {};
    const expressionAttributeValues = {
      ':user_id': userId,
      ':created_at': new Date().toISOString(),
      ':updated_at': new Date().toISOString()
    };

    // Always set user_id and timestamps
    updateExpression += '#user_id = :user_id, created_at = :created_at, updated_at = :updated_at';
    expressionAttributeNames['#user_id'] = 'user_id';

    // Add updatable fields
    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateExpression += `, #${key} = :${key}`;
        expressionAttributeNames[`#${key}`] = key;
        
        // Handle special cases
        if (key === 'gender' && updates[key]) {
          expressionAttributeValues[`:${key}`] = updates[key].toLowerCase();
        } else if (key === 'userType' && updates[key]) {
          expressionAttributeValues[`:${key}`] = updates[key].toLowerCase();
        } else {
          expressionAttributeValues[`:${key}`] = updates[key];
        }
      }
    });

    // Add age calculation if dob is provided
    if (updates.dob) {
      updateExpression += `, age = :age`;
      expressionAttributeValues[':age'] = calculateAge(updates.dob);
    }

    let result;
    
    if (profileId) {
      // UPDATE existing profile
      const updateParams = {
        TableName: USER_PROFILES_TABLE,
        Key: { profile_id: profileId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW'
      };
      result = await dynamoDB.update(updateParams).promise();
      console.log('Profile updated successfully');
    } else {
      // CREATE new profile
      profileId = `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const putParams = {
        TableName: USER_PROFILES_TABLE,
        Item: {
          profile_id: profileId,
          user_id: userId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...updates
        }
      };
      
      // Calculate age if dob provided
      if (updates.dob) {
        putParams.Item.age = calculateAge(updates.dob);
      }
      
      // Normalize gender
      if (updates.gender) {
        putParams.Item.gender = updates.gender.toLowerCase();
      }
      
      // Normalize userType
      if (updates.userType) {
        putParams.Item.userType = updates.userType.toLowerCase();
      }
      
      result = await dynamoDB.put(putParams).promise();
      console.log('Profile created successfully:', profileId);
    }

    return createResponse(201, {
      success: true,
      message: profileId ? 'Profile updated successfully' : 'Profile created successfully',
      data: profileId ? result.Attributes : {
        profile_id: profileId,
        user_id: userId,
        ...updates
      }
    });

  } catch (error) {
    console.error('UpdateProfile Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to save profile',
      error: error.message
    });
  }
}


// 5. Delete Profile
async function deleteProfile(event) {
  try {
    const userId = event.pathParameters?.userId;
    const anonymize = event.queryStringParameters?.anonymize === 'true';

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    // Get existing profile
    const existingProfile = await dynamoDB.query({
      TableName: USER_PROFILES_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      }
    }).promise();

    if (!existingProfile.Items || existingProfile.Items.length === 0) {
      return createResponse(404, {
        success: false,
        message: 'Profile not found for this user'
      });
    }

    const profileId = existingProfile.Items[0].profile_id;
    const profile = existingProfile.Items[0];

    if (anonymize) {
      // Anonymize profile data instead of deleting
      const anonymizedData = {
        phone: null,
        address: '[REDACTED]',
        dob: null,
        age: null,
        gender: null,
        profile_pic_url: null,
        bio: '[User data has been anonymized]',
        updated_at: new Date().toISOString(),
        anonymized_at: new Date().toISOString()
      };

      await dynamoDB.update({
        TableName: USER_PROFILES_TABLE,
        Key: { profile_id: profileId },
        UpdateExpression: 'SET phone = :phone, address = :address, dob = :dob, age = :age, gender = :gender, profile_pic_url = :pic, bio = :bio, updated_at = :updated, anonymized_at = :anonymized',
        ExpressionAttributeValues: {
          ':phone': anonymizedData.phone,
          ':address': anonymizedData.address,
          ':dob': anonymizedData.dob,
          ':age': anonymizedData.age,
          ':gender': anonymizedData.gender,
          ':pic': anonymizedData.profile_pic_url,
          ':bio': anonymizedData.bio,
          ':updated': anonymizedData.updated_at,
          ':anonymized': anonymizedData.anonymized_at
        }
      }).promise();

      // Delete profile picture from S3 if exists
      if (profile.profile_pic_url) {
        try {
          const urlParts = profile.profile_pic_url.split('/');
          const key = urlParts[urlParts.length - 1];
          await s3.deleteObject({
            Bucket: S3_BUCKET,
            Key: `profile-pics/${key}`
          }).promise();
        } catch (s3Error) {
          console.error('Error deleting S3 object:', s3Error);
        }
      }

      return createResponse(200, {
        success: true,
        message: 'Profile data anonymized successfully'
      });

    } else {
      // Permanent deletion
      await dynamoDB.delete({
        TableName: USER_PROFILES_TABLE,
        Key: { profile_id: profileId }
      }).promise();

      // Delete profile picture from S3 if exists
      if (profile.profile_pic_url) {
        try {
          const urlParts = profile.profile_pic_url.split('/');
          const key = urlParts[urlParts.length - 1];
          await s3.deleteObject({
            Bucket: S3_BUCKET,
            Key: `profile-pics/${key}`
          }).promise();
        } catch (s3Error) {
          console.error('Error deleting S3 object:', s3Error);
        }
      }

      return createResponse(200, {
        success: true,
        message: 'Profile deleted successfully'
      });
    }

  } catch (error) {
    console.error('DeleteProfile Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to delete profile',
      error: error.message
    });
  }
}

// 6. Upload Profile Picture
async function uploadProfilePicture(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    const { imageData, fileExtension = 'jpg' } = JSON.parse(event.body);

    if (!imageData) {
      return createResponse(400, {
        success: false,
        message: 'imageData is required (base64 encoded image)'
      });
    }

    // Get existing profile
    const existingProfile = await dynamoDB.query({
      TableName: USER_PROFILES_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      }
    }).promise();

    if (!existingProfile.Items || existingProfile.Items.length === 0) {
      return createResponse(404, {
        success: false,
        message: 'Profile not found for this user'
      });
    }

    const profileId = existingProfile.Items[0].profile_id;

    // Delete old profile picture if exists
    if (existingProfile.Items[0].profile_pic_url) {
      try {
        const urlParts = existingProfile.Items[0].profile_pic_url.split('/');
        const oldKey = urlParts[urlParts.length - 1];
        await s3.deleteObject({
          Bucket: S3_BUCKET,
          Key: `profile-pics/${oldKey}`
        }).promise();
      } catch (s3Error) {
        console.error('Error deleting old profile picture:', s3Error);
      }
    }

    // Upload new image to S3
    const imageBuffer = Buffer.from(imageData, 'base64');
    const fileName = `${userId}-${Date.now()}.${fileExtension}`;
    const s3Key = `profile-pics/${fileName}`;

    await s3.putObject({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: imageBuffer,
      ContentType: `image/${fileExtension}`,
      ACL: 'public-read'
    }).promise();

    const imageUrl = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

    // Update profile with new image URL
    const result = await dynamoDB.update({
      TableName: USER_PROFILES_TABLE,
      Key: { profile_id: profileId },
      UpdateExpression: 'SET profile_pic_url = :url, updated_at = :updated_at',
      ExpressionAttributeValues: {
        ':url': imageUrl,
        ':updated_at': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    }).promise();

    return createResponse(200, {
      success: true,
      message: 'Profile picture uploaded successfully',
      data: {
        profilePicUrl: imageUrl,
        profile: result.Attributes
      }
    });

  } catch (error) {
    console.error('UploadProfilePicture Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to upload profile picture',
      error: error.message
    });
  }
}

// 7. Delete Profile Picture
async function deleteProfilePicture(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    // Get existing profile
    const existingProfile = await dynamoDB.query({
      TableName: USER_PROFILES_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      }
    }).promise();

    if (!existingProfile.Items || existingProfile.Items.length === 0) {
      return createResponse(404, {
        success: false,
        message: 'Profile not found for this user'
      });
    }

    const profileId = existingProfile.Items[0].profile_id;
    const profile = existingProfile.Items[0];

    if (!profile.profile_pic_url) {
      return createResponse(404, {
        success: false,
        message: 'No profile picture found'
      });
    }

    // Delete from S3
    try {
      const urlParts = profile.profile_pic_url.split('/');
      const key = urlParts[urlParts.length - 1];
      await s3.deleteObject({
        Bucket: S3_BUCKET,
        Key: `profile-pics/${key}`
      }).promise();
    } catch (s3Error) {
      console.error('Error deleting S3 object:', s3Error);
    }

    // Update profile to remove picture URL
    await dynamoDB.update({
      TableName: USER_PROFILES_TABLE,
      Key: { profile_id: profileId },
      UpdateExpression: 'SET profile_pic_url = :null, updated_at = :updated_at',
      ExpressionAttributeValues: {
        ':null': null,
        ':updated_at': new Date().toISOString()
      }
    }).promise();

    return createResponse(200, {
      success: true,
      message: 'Profile picture deleted successfully'
    });

  } catch (error) {
    console.error('DeleteProfilePicture Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to delete profile picture',
      error: error.message
    });
  }
}

// 8. Get All Profiles (Admin)
async function getAllProfiles(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const limit = parseInt(queryParams.limit) || 50;
    const gender = queryParams.gender;

    let params = {
      TableName: USER_PROFILES_TABLE,
      Limit: limit
    };

    // Filter by gender if provided
    if (gender) {
      params.FilterExpression = 'gender = :gender';
      params.ExpressionAttributeValues = {
        ':gender': gender.toLowerCase()
      };
    }

    // Handle pagination
    if (queryParams.lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.lastKey, 'base64').toString()
      );
    }

    const result = await dynamoDB.scan(params).promise();

    const response = {
      success: true,
      data: result.Items,
      count: result.Items.length
    };

    // Add pagination token if more items exist
    if (result.LastEvaluatedKey) {
      response.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return createResponse(200, response);

  } catch (error) {
    console.error('GetAllProfiles Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve profiles',
      error: error.message
    });
  }
}

// 9. Get Profile Statistics
async function getProfileStatistics(event) {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return createResponse(400, {
        success: false,
        message: 'userId is required'
      });
    }

    // Get profile
    const profileResult = await dynamoDB.query({
      TableName: USER_PROFILES_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      }
    }).promise();

    if (!profileResult.Items || profileResult.Items.length === 0) {
      return createResponse(404, {
        success: false,
        message: 'Profile not found'
      });
    }

    const profile = profileResult.Items[0];

    // Calculate profile completion percentage
    const requiredFields = ['phone', 'address', 'dob', 'gender', 'profile_pic_url', 'bio'];
    const completedFields = requiredFields.filter(field => profile[field] && profile[field] !== null);
    const completionPercentage = Math.round((completedFields.length / requiredFields.length) * 100);

    // Get user data
    const userResult = await dynamoDB.get({
      TableName: USERS_TABLE,
      Key: { user_id: userId }
    }).promise();

    const statistics = {
      profileCompletion: {
        percentage: completionPercentage,
        completedFields: completedFields,
        missingFields: requiredFields.filter(field => !completedFields.includes(field))
      },
      profileInfo: {
        hasProfilePicture: !!profile.profile_pic_url,
        hasBio: !!profile.bio,
        age: profile.age || null,
        accountAge: userResult.Item?.created_at 
          ? Math.floor((new Date() - new Date(userResult.Item.created_at)) / (1000 * 60 * 60 * 24))
          : null
      },
      timestamps: {
        profileCreated: profile.created_at,
        lastUpdated: profile.updated_at
      }
    };

    return createResponse(200, {
      success: true,
      data: statistics
    });

  } catch (error) {
    console.error('GetProfileStatistics Error:', error);
    return createResponse(500, {
      success: false,
      message: 'Failed to retrieve profile statistics',
      error: error.message
    });
  }
}

module.exports = {
  createProfile: JWSauthenticate(createProfile),
  getProfile: JWSauthenticate(getProfile),
  getProfileById: JWSauthenticate(getProfileById),
  updateProfile: JWSauthenticate(updateProfile),
  deleteProfile: JWSauthenticate(deleteProfile),
  uploadProfilePicture: JWSauthenticate(uploadProfilePicture),
  deleteProfilePicture: JWSauthenticate(deleteProfilePicture),
  getAllProfiles: JWSauthenticate(getAllProfiles),
  getProfileStatistics: JWSauthenticate(getProfileStatistics)
};
