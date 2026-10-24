import { recipeRescueService } from '../services/recipeRescue.service.js';

export class RecipeController {
  constructor(service = recipeRescueService) {
    this.service = service;
  }

  /**
   * GET /api/v1/recipes/rescue
   * Prioritize at-risk items and retrieve AI recipe suggestions.
   */
  rescueRecipes = async (req, res, next) => {
    try {
      const data = await this.service.getRescueRecipes(req.household.id, req.query);
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (err) {
      return next(err);
    }
  };
}

export const recipeController = new RecipeController();
export default recipeController;
