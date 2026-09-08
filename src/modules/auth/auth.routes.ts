import { Router } from 'express';
import { wrap } from '../../common/http/wrap';
import { authRateLimiter } from '../../common/middleware/auth-rate-limit';
import { validate } from '../../common/validation/validate';
import { authController } from './controllers/auth.controller';
import { authenticateUser } from './middleware/authenticate-user';
import {
  changeMpinBodySchema,
  loginMpinBodySchema,
  loginOtpSendBodySchema,
  loginOtpVerifyBodySchema,
  logoutBodySchema,
  resetMpinBodySchema,
  signupOtpSendBodySchema,
  signupOtpVerifyBodySchema,
  signupSubmitBodySchema,
  updateProfileBodySchema,
} from './validation/auth.validation';

export const authRoutes = Router();

authRoutes.post(
  '/signup/otp/send',
  authRateLimiter,
  validate(signupOtpSendBodySchema),
  wrap((req, res) => authController.sendSignupOtp(req, res)),
);

authRoutes.post(
  '/signup/otp/verify',
  authRateLimiter,
  validate(signupOtpVerifyBodySchema),
  wrap((req, res) => authController.verifySignupOtp(req, res)),
);

authRoutes.post(
  '/signup/submit',
  authRateLimiter,
  validate(signupSubmitBodySchema),
  wrap((req, res) => authController.submitSignup(req, res)),
);

authRoutes.post(
  '/login/otp/send',
  authRateLimiter,
  validate(loginOtpSendBodySchema),
  wrap((req, res) => authController.sendLoginOtp(req, res)),
);

authRoutes.post(
  '/login/otp/verify',
  authRateLimiter,
  validate(loginOtpVerifyBodySchema),
  wrap((req, res) => authController.verifyLoginOtp(req, res)),
);

authRoutes.post(
  '/login/mpin',
  authRateLimiter,
  validate(loginMpinBodySchema),
  wrap((req, res) => authController.loginWithMpin(req, res)),
);

authRoutes.post(
  '/login/mpin/reset',
  authRateLimiter,
  validate(resetMpinBodySchema),
  wrap((req, res) => authController.resetMpin(req, res)),
);

authRoutes.get(
  '/me',
  wrap((req, res, next) => authenticateUser(req, res, next)),
  wrap((req, res) => authController.getMe(req, res)),
);

authRoutes.patch(
  '/me',
  wrap((req, res, next) => authenticateUser(req, res, next)),
  validate(updateProfileBodySchema),
  wrap((req, res) => authController.updateMe(req, res)),
);

authRoutes.patch(
  '/mpin',
  wrap((req, res, next) => authenticateUser(req, res, next)),
  validate(changeMpinBodySchema),
  wrap((req, res) => authController.changeMpin(req, res)),
);

authRoutes.post(
  '/logout',
  wrap((req, res, next) => authenticateUser(req, res, next)),
  validate(logoutBodySchema),
  wrap((req, res) => authController.logout(req, res)),
);
