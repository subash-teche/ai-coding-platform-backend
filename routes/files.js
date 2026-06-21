import express from 'express';
import { File, Project } from '../models.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router({ mergeParams: true }); // Merge params to get :projectId from parent router

// Middleware to check if user has access to this project
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

// Apply both auth and project access validation to all endpoints in this router
router.use(authMiddleware);
router.use(projectAccessMiddleware);

// @route   GET /api/projects/:projectId/files
// @desc    Get all files in a project
router.get('/', async (req, res) => {
  try {
    const files = await File.find({ projectId: req.params.projectId }).sort({ path: 1 });
    res.json(files);
  } catch (error) {
    console.error('Fetch files error:', error);
    res.status(500).json({ message: 'Server error while fetching files' });
  }
});

// @route   POST /api/projects/:projectId/files
// @desc    Create a new file in a project
router.post('/', async (req, res) => {
  const { name, path, content } = req.body;

  if (!name || !path) {
    return res.status(400).json({ message: 'File name and path are required' });
  }

  try {
    // Check if file already exists at this path in this project
    const existingFile = await File.findOne({ projectId: req.params.projectId, path });
    if (existingFile) {
      return res.status(400).json({ message: 'A file already exists at this path' });
    }

    const file = new File({
      name,
      path,
      content: content || '',
      projectId: req.params.projectId,
      userId: req.user.id,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await file.save();

    // Update parent project's updatedAt timestamp and track who updated it
    await Project.findByIdAndUpdate(req.params.projectId, { 
      updatedAt: new Date(),
      lastUpdatedBy: req.user.id
    });
    
    // Broadcast file creation via socket (will implement socket broadcast hook later in server.js)
    if (req.app.get('io')) {
      req.app.get('io').to(req.params.projectId).emit('file-created', file);
    }

    res.status(201).json(file);
  } catch (error) {
    console.error('Create file error:', error);
    res.status(500).json({ message: 'Server error while creating file' });
  }
});

// @route   PUT /api/projects/:projectId/files/:fileId
// @desc    Update a file's content or rename it
router.put('/:fileId', async (req, res) => {
  const { name, path, content } = req.body;

  try {
    const file = await File.findOne({ _id: req.params.fileId, projectId: req.params.projectId });
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Handle rename if path is changed
    if (path && path !== file.path) {
      const pathConflict = await File.findOne({ projectId: req.params.projectId, path });
      if (pathConflict) {
        return res.status(400).json({ message: 'A file already exists at the new path' });
      }
      file.path = path;
      if (name) file.name = name;
    }

    if (content !== undefined) {
      file.content = content;
    }
    
    file.updatedAt = new Date();
    await file.save();

    // Update parent project's updatedAt timestamp and track who updated it
    await Project.findByIdAndUpdate(req.params.projectId, { 
      updatedAt: new Date(),
      lastUpdatedBy: req.user.id
    });

    // Broadcast file update via Socket.io
    if (req.app.get('io')) {
      req.app.get('io').to(req.params.projectId).emit('file-updated', {
        fileId: file._id,
        path: file.path,
        name: file.name,
        content: file.content,
        updatedAt: file.updatedAt
      });
    }

    res.json(file);
  } catch (error) {
    console.error('Update file error:', error);
    res.status(500).json({ message: 'Server error while updating file' });
  }
});

// @route   DELETE /api/projects/:projectId/files/:fileId
// @desc    Delete a file
router.delete('/:fileId', async (req, res) => {
  try {
    const file = await File.findOne({ _id: req.params.fileId, projectId: req.params.projectId });
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    await File.deleteOne({ _id: req.params.fileId });

    // Update parent project's updatedAt timestamp and track who updated it
    await Project.findByIdAndUpdate(req.params.projectId, { 
      updatedAt: new Date(),
      lastUpdatedBy: req.user.id
    });

    // Broadcast file deletion via Socket.io
    if (req.app.get('io')) {
      req.app.get('io').to(req.params.projectId).emit('file-deleted', req.params.fileId);
    }

    res.json({ message: 'File deleted successfully', fileId: req.params.fileId });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ message: 'Server error while deleting file' });
  }
});

export default router;
