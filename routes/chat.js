import express from 'express';
import { ChatMessage, File, Project } from '../models.js';
import { authMiddleware } from '../middleware/auth.js';
import { askAI } from '../services/ai.js';

const router = express.Router({ mergeParams: true });

// Check project access
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
    console.error('Project access check error:', error);
    res.status(500).json({ message: 'Server error during project access validation' });
  }
};

router.use(authMiddleware);
router.use(projectAccessMiddleware);

// @route   GET /api/projects/:projectId/chat
// @desc    Get chat history for a project
router.get('/', async (req, res) => {
  try {
    const messages = await ChatMessage.find({ projectId: req.params.projectId, userId: req.user.id }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (error) {
    console.error('Fetch chat history error:', error);
    res.status(500).json({ message: 'Server error while fetching chat history' });
  }
});

// @route   POST /api/projects/:projectId/chat
// @desc    Send a message to the AI, get response and optional file edits
router.post('/', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ message: 'Message is required' });
  }

  try {
    // 1. Save user's message
    const userMessage = new ChatMessage({
      role: 'user',
      content: message,
      projectId: req.params.projectId,
      userId: req.user.id
    });
    await userMessage.save();

    // 2. Fetch project files
    const files = await File.find({ projectId: req.params.projectId });

    // 3. Fetch past chat history for context (limit to last 15 messages for context length)
    const historyDb = await ChatMessage.find({ projectId: req.params.projectId, userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(15);
    
    // Reverse to chronological order
    const chatHistory = historyDb.reverse().map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // 4. Query AI service
    const aiResponse = await askAI(message, chatHistory, files, req.project.type);
    
    // 5. Save AI response
    const assistantMessage = new ChatMessage({
      role: 'assistant',
      content: aiResponse.reply,
      projectId: req.params.projectId,
      userId: req.user.id
    });
    await assistantMessage.save();

    // 6. Handle file edits (if any)
    const appliedEdits = [];
    if (aiResponse.edits && Array.isArray(aiResponse.edits)) {
      for (const edit of aiResponse.edits) {
        if (!edit.path) continue;

        // Try to find the file
        let file = await File.findOne({ projectId: req.params.projectId, path: edit.path });
        
        if (file) {
          // Update existing file
          file.content = edit.content;
          file.updatedAt = new Date();
          await file.save();
          appliedEdits.push({ fileId: file._id, path: file.path, action: 'updated', content: file.content });
          
          // Broadcast update
          if (req.app.get('io')) {
            req.app.get('io').to(req.params.projectId).emit('file-updated', file);
          }
        } else {
          // Create a new file
          // Determine file name from path
          const pathParts = edit.path.split('/');
          const name = pathParts[pathParts.length - 1];
          
          file = new File({
            name,
            path: edit.path,
            content: edit.content,
            projectId: req.params.projectId,
            userId: req.user.id
          });
          await file.save();
          appliedEdits.push({ fileId: file._id, path: file.path, action: 'created', content: file.content });
          
          // Broadcast creation
          if (req.app.get('io')) {
            req.app.get('io').to(req.params.projectId).emit('file-created', file);
          }
        }
      }
    }

    res.json({
      userMessage,
      assistantMessage,
      edits: appliedEdits
    });
  } catch (error) {
    console.error('Chat AI endpoint error:', error);
    res.status(500).json({ message: 'Server error while processing AI chat' });
  }
});

export default router;
