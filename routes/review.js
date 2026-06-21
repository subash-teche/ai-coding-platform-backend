import express from 'express';
import { File, Project } from '../models.js';
import { authMiddleware } from '../middleware/auth.js';
import { reviewProject } from '../services/ai.js';

const router = express.Router({ mergeParams: true });

// Check project access middleware
const projectAccessMiddleware = async (req, res, next) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [
        { userId: req.user.id },
        { members: req.user.id }
      ]
    });
    if (!project) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }
    req.project = project;
    next();
  } catch (error) {
    console.error('Project access check error (review):', error);
    res.status(500).json({ message: 'Server error during project access validation' });
  }
};

router.use(authMiddleware);
router.use(projectAccessMiddleware);

// @route   POST /api/projects/:projectId/review
// @desc    Analyze all project files and return unified code review scores and suggestions
router.post('/', async (req, res) => {
  try {
    // 1. Fetch all files in this project
    const files = await File.find({ projectId: req.params.projectId });
    if (!files || files.length === 0) {
      return res.status(400).json({ message: 'No files found in this project to review' });
    }

    // 2. Call AI service code reviewer
    const reviewResult = await reviewProject(files, req.project.type);

    res.json(reviewResult);
  } catch (error) {
    console.error('Code review route error:', error);
    res.status(500).json({ message: 'Server error while running code review' });
  }
});

export default router;
