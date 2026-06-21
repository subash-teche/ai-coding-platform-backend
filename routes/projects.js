import express from 'express';
import mongoose from 'mongoose';
import { Project, File, User } from '../models.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendInviteEmail } from '../services/email.js';

const router = express.Router();

// Helper to seed template files for new projects
const seedProjectFiles = async (projectId, userId, projectType) => {
  const templates = {
    javascript: [
      {
        name: 'index.js',
        path: 'index.js',
        content: `// Welcome to the JavaScript Workspace!
// Edit this file and click "Run" at the bottom to execute.

function greet(name) {
  console.log("Hello, " + name + "!");
  return "Workspace is active";
}

const status = greet("Developer");
console.log("Status check:", status);
`
      }
    ],
    python: [
      {
        name: 'main.py',
        path: 'main.py',
        content: `# Welcome to the Python Workspace!
# Code runs sandboxed in WebAssembly (Pyodide).

def calculate_factorial(n):
    if n <= 1:
        return 1
    return n * calculate_factorial(n - 1)

number = 5
result = calculate_factorial(number)
print(f"Factorial of {number} is {result}")
`
      }
    ],
    website_builder: [
      {
        name: 'index.html',
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tailwind Sandbox Preview</title>
  <!-- Load Tailwind CSS CDN for styling -->
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Custom stylesheet link -->
  <link rel="stylesheet" href="styles.css">
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex items-center justify-center p-4">
  <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden group">
    <div class="absolute -right-10 -top-10 w-40 h-40 bg-violet-600/20 rounded-full blur-3xl group-hover:bg-violet-600/30 transition-all duration-700"></div>
    <div class="absolute -left-10 -bottom-10 w-40 h-40 bg-indigo-600/20 rounded-full blur-3xl group-hover:bg-indigo-600/30 transition-all duration-700"></div>

    <div class="relative z-10">
      <h1 class="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-indigo-400">
        Live Website Preview
      </h1>
      <p class="mt-4 text-slate-400 leading-relaxed text-sm">
        Modify the code inside <code class="text-violet-400">index.html</code>, <code class="text-violet-400">styles.css</code>, or <code class="text-violet-400">script.js</code>, and watch the changes reflect here instantly.
      </p>
      
      <div class="mt-6 flex flex-col gap-3">
        <button id="counter-btn" class="w-full py-3 px-6 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-95 text-white rounded-2xl font-semibold shadow-lg shadow-violet-900/30 transition-all duration-300">
          Click Count: 0
        </button>
        
        <p class="text-center text-xs text-slate-500 animate-pulse">
          Fully dynamic Tailwind website
        </p>
      </div>
    </div>
  </div>
  <script src="script.js"></script>
</body>
</html>
`
      },
      {
        name: 'styles.css',
        path: 'styles.css',
        content: `/* Custom style additions */
body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

/* Custom class to demonstrate styling custom attributes */
.custom-border-glow {
  box-shadow: 0 0 15px rgba(124, 58, 237, 0.4);
}
`
      },
      {
        name: 'script.js',
        path: 'script.js',
        content: `// Interactive script logic
console.log("Website Builder live script connected!");

let clickCount = 0;
const button = document.getElementById('counter-btn');

if (button) {
  button.addEventListener('click', () => {
    clickCount++;
    button.textContent = \`Click Count: \${clickCount}\`;
    console.log(\`Clicked! Current count: \${clickCount}\`);
  });
}
`
      }
    ]
  };

  const filesToCreate = templates[projectType] || [];
  for (const f of filesToCreate) {
    const file = new File({
      name: f.name,
      path: f.path,
      content: f.content,
      projectId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await file.save();
  }
};

// @route   GET /api/projects
// @desc    Get user's projects
router.get('/', authMiddleware, async (req, res) => {
  try {
    const projects = await Project.find({
      $or: [
        { userId: req.user.id },
        { members: req.user.id }
      ]
    })
    .populate('userId', 'username email')
    .populate('members', 'username email')
    .populate('lastUpdatedBy', 'username')
    .sort({ updatedAt: -1 });
    res.json(projects);
  } catch (error) {
    console.error('Fetch projects error:', error);
    res.status(500).json({ message: 'Server error while fetching projects' });
  }
});

// @route   GET /api/projects/db-collections
// @desc    Retrieve MongoDB collection names natively
router.get('/db-collections', authMiddleware, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(500).json({ message: 'Database not connected' });
    }
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(col => col.name);
    res.json(collectionNames);
  } catch (error) {
    console.error('Fetch collections error:', error);
    res.status(500).json({ message: 'Server error while fetching collections' });
  }
});

// @route   POST /api/projects
// @desc    Create a new project
router.post('/', authMiddleware, async (req, res) => {
  const { name, type } = req.body;

  if (!name || !type) {
    return res.status(400).json({ message: 'Project name and workspace type are required' });
  }

  if (!['javascript', 'python', 'website_builder'].includes(type)) {
    return res.status(400).json({ message: 'Invalid workspace type' });
  }

  try {
    const project = new Project({
      name,
      type,
      userId: req.user.id,
      lastUpdatedBy: req.user.id,
      updatedAt: new Date()
    });

    await project.save();
    
    // Seed default workspace files
    await seedProjectFiles(project._id, req.user.id, type);

    const populatedProject = await Project.findById(project._id)
      .populate('userId', 'username email')
      .populate('members', 'username email')
      .populate('lastUpdatedBy', 'username');

    res.status(201).json(populatedProject);
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ message: 'Server error while creating project' });
  }
});

// @route   GET /api/projects/:id
// @desc    Get project details by ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      $or: [
        { userId: req.user.id },
        { members: req.user.id }
      ]
    })
    .populate('userId', 'username email')
    .populate('members', 'username email')
    .populate('lastUpdatedBy', 'username');

    if (!project) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }
    res.json(project);
  } catch (error) {
    console.error('Fetch project error:', error);
    res.status(500).json({ message: 'Server error while fetching project' });
  }
});

// @route   POST /api/projects/:projectId/invite
// @desc    Invite a user to a project
router.post('/:projectId/invite', authMiddleware, async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  try {
    // Find project and verify ownership
    const project = await Project.findOne({ _id: req.params.projectId, userId: req.user.id });
    if (!project) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    // Prevent inviting owner
    const owner = await User.findById(project.userId);
    if (owner && owner.email.toLowerCase() === email.toLowerCase()) {
      return res.status(400).json({ message: 'You cannot invite the project owner' });
    }

    // Check if user is already a member
    const existingUser = await User.findOne({ email: new RegExp(`^${email}$`, 'i') });

    if (existingUser) {
      if (project.members.includes(existingUser._id)) {
        return res.status(400).json({ message: 'User is already a member of this project' });
      }

      project.members.push(existingUser._id);
      project.updatedAt = new Date();
      project.lastUpdatedBy = req.user.id;
      await project.save();

      // Send email notification to existing user
      await sendInviteEmail({
        toEmail: email.toLowerCase(),
        projectName: project.name,
        projectId: project._id,
        inviterName: owner.username,
        isNewUser: false
      });

      const updatedProject = await Project.findById(project._id)
        .populate('userId', 'username email')
        .populate('members', 'username email')
        .populate('lastUpdatedBy', 'username');

      return res.json({ 
        message: 'User successfully added to the project',
        project: updatedProject 
      });
    } else {
      if (project.pendingInvites.includes(email.toLowerCase())) {
        return res.status(400).json({ message: 'This email has already been invited to this project' });
      }

      project.pendingInvites.push(email.toLowerCase());
      project.updatedAt = new Date();
      project.lastUpdatedBy = req.user.id;
      await project.save();

      // Send email to new user
      await sendInviteEmail({
        toEmail: email.toLowerCase(),
        projectName: project.name,
        projectId: project._id,
        inviterName: owner.username,
        isNewUser: true
      });

      const updatedProject = await Project.findById(project._id)
        .populate('userId', 'username email')
        .populate('members', 'username email')
        .populate('lastUpdatedBy', 'username');

      return res.json({ 
        message: 'Invitation email sent successfully to new user',
        project: updatedProject 
      });
    }
  } catch (error) {
    console.error('Invite member error:', error);
    res.status(500).json({ message: 'Server error during invitation' });
  }
});

// @route   DELETE /api/projects/:id
// @desc    Delete a project and its associated files & messages
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, userId: req.user.id });
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Delete associated files & messages
    await File.deleteMany({ projectId: req.params.id });
    await Project.deleteOne({ _id: req.params.id });

    res.json({ message: 'Project and all related files deleted successfully' });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ message: 'Server error while deleting project' });
  }
});

export default router;
