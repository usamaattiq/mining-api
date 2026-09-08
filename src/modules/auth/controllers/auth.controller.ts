import type { Response } from 'express';
import { sendSuccess } from '../../../common/http/api-response';
import type { AuthenticatedRequest } from '../../../common/http/authenticated-request';
import { authService } from '../services/auth.service';
import type {
  ChangeMpinBody,
  LoginMpinBody,
  LoginOtpSendBody,
  LoginOtpVerifyBody,
  ResetMpinBody,
  SignupOtpSendBody,
  SignupOtpVerifyBody,
  SignupSubmitBody,
  UpdateProfileBody,
} from '../validation/auth.validation';

class AuthController {
  async sendSignupOtp(req: AuthenticatedRequest, res: Response): Promise<void> {
    const body = req.validatedBody as SignupOtpSendBody;
    await authService.sendSignupOtp(body);
    sendSuccess(res, 200, { sent: true });
  }

  async verifySignupOtp(req: AuthenticatedRequest, res: Response): Promise<void> {
    const body = req.validatedBody as SignupOtpVerifyBody;
    await authService.verifySignupOtp(body);
    sendSuccess(res, 200, { verified: true });
  }

  async submitSignup(req: AuthenticatedRequest, res: Response): Promise<void> {
    const body = req.validatedBody as SignupSubmitBody;
    const result = await authService.submitSignup(body);
    sendSuccess(res, 201, result);
  }

  async sendLoginOtp(req: AuthenticatedRequest, res: Response): Promise<void> {
    const body = req.validatedBody as LoginOtpSendBody;
    await authService.sendLoginOtp(body);
    sendSuccess(res, 200, { sent: true });
  }

  async verifyLoginOtp(req: AuthenticatedRequest, res: Response): Promise<void> {
    const body = req.validatedBody as LoginOtpVerifyBody;
    await authService.verifyLoginOtp(body);
    sendSuccess(res, 200, { verified: true });
  }

  async loginWithMpin(req: AuthenticatedRequest, res: Response): Promise<void> {
    const body = req.validatedBody as LoginMpinBody;
    const result = await authService.loginWithMpin(body);
    sendSuccess(res, 200, result);
  }

  async resetMpin(req: AuthenticatedRequest, res: Response): Promise<void> {
    const body = req.validatedBody as ResetMpinBody;
    const result = await authService.resetMpin(body);
    sendSuccess(res, 200, result);
  }

  async getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
    const profile = await authService.getProfile(req.user!.id);
    sendSuccess(res, 200, profile);
  }

  async updateMe(req: AuthenticatedRequest, res: Response): Promise<void> {
    const body = req.validatedBody as UpdateProfileBody;
    const profile = await authService.updateProfile(req.user!.id, body);
    sendSuccess(res, 200, profile);
  }

  async changeMpin(req: AuthenticatedRequest, res: Response): Promise<void> {
    const body = req.validatedBody as ChangeMpinBody;
    await authService.changeMpin(req.user!.id, body);
    sendSuccess(res, 200, { updated: true });
  }

  async logout(req: AuthenticatedRequest, res: Response): Promise<void> {
    await authService.logout(req.sessionJti!);
    sendSuccess(res, 200, { loggedOut: true });
  }
}

export const authController = new AuthController();
