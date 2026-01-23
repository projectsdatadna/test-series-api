const express = require('express');
const authController = require('./controllers/auth');
const jwtAuthController = require('./controllers/jwtAuth');
const handler = require('../../helpers/handler');

const router = express.Router();

/**
 * Helper function to create route handlers
 * Eliminates repetitive route definitions
 */
const createRoute = (path, controllerMethod) => {
  router.post(path, handler(controllerMethod));
};

// Authentication Routes (from auth.js)
createRoute('/email-signup', authController.emailsignUp);
createRoute('/phone-signup', authController.phoneSignUp);
createRoute('/confirm-email', authController.confirmSignUp);
createRoute('/confirm-phone', authController.confirmPhoneSignUp);
createRoute('/forgot/email', authController.forgotPasswordEmail);
createRoute('/forgot/phone', authController.forgotPasswordPhone);
createRoute('/forgot/email/Reset', authController.emailForgetResetPassword);
createRoute('/forgot/phone/Reset', authController.phoneForgetResetPassword);

// Login & Token Management Routes (from jwtauth.js)
createRoute('/email-login', jwtAuthController.jwtLoginEmail);
createRoute('/phone-login', jwtAuthController.jwtLoginPhone);
createRoute('/refresh-token', jwtAuthController.refreshToken);
createRoute('/email-logout', jwtAuthController.jwtEmailLogout);
createRoute('/phone-logout', jwtAuthController.jwtPhoneLogout);

createRoute('/reset/password-email', jwtAuthController.jwtResetPasswordEmail);
createRoute('/reset/password-phone', jwtAuthController.jwtResetPasswordPhone);

createRoute('/resend/email/confirmationCode', jwtAuthController.jwtResendConfirmationCode);
createRoute('/resend/phone/confirmationCode', jwtAuthController.jwtResendConfirmationCodePhone);

createRoute('/get/attribute/verification', jwtAuthController.jwtResendPhoneAttributeVerification);
createRoute('/reset/password/email', jwtAuthController.jwtResetPasswordWithOld);
createRoute('/reset/password/phone', jwtAuthController.jwtResetPasswordWithOldPhone);

module.exports = router;
