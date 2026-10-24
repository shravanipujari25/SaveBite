import { assistantService } from '../services/assistant.service.js';

export class AssistantController {
  constructor(service = assistantService) {
    this.service = service;
  }

  /**
   * POST /api/v1/assistant/chat
   * Proxy chat request to FastAPI AI assistant with household inventory context.
   */
  chat = async (req, res, next) => {
    try {
      const response = await this.service.chat(
        req.household.id,
        req.user.id,
        req.body
      );
      return res.status(200).json({
        status: 'success',
        data: response
      });
    } catch (err) {
      return next(err);
    }
  };
}

export const assistantController = new AssistantController();
export default assistantController;
