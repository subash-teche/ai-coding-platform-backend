# MVP Apps Studio - Backend Server

The backend server is built using Node.js and Express.js, providing secure REST endpoints, WebSockets synchronization, database persistence, and email delivery hooks.

---

## 🛠️ Technology Stack

- **Framework**: Express.js
- **Real-Time Collaboration**: Socket.io
- **Database Persistence**: MongoDB & Mongoose
- **Email Dispatch Service**: Nodemailer
- **AI Models Integration**: Google Generative AI (Gemini API)
- **Token Cryptography**: JSON Web Tokens (JWT) & Bcryptjs password hashing

---

## 📂 Project Architecture

```
backend/
├── middleware/          # Express route verification guards
│   └── auth.js          # JWT authentication checks
├── routes/              # Express REST Controller endpoints
│   ├── auth.js          # User login, registration, and session validations
│   ├── projects.js      # CRUD operations and collaborator invites
│   ├── files.js         # Workspace document operations & change broadcats
│   └── chat.js          # Workspace private copilot conversations & code edits
├── services/            # Background logic classes
│   ├── ai.js            # Gemini API prompt packaging & offline heuristics
│   └── email.js         # Nodemailer SMTP transporter and templates compiler
├── templates/           # Email HTML documents
│   └── invite_template.html  # Premium light-themed project invite newsletter
├── models.js            # Mongoose Schemas (User, Project, File, ChatMessage)
├── server.js            # Application entrypoint & WebSockets handler
└── .env                 # Environment secrets configurations
```

---

## ⚙️ Environment Configuration

Create a `.env` file in the root of the `backend/` directory:

```env
PORT=5000
JWT_SECRET=your_jwt_secret_token_key_here
MONGO_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/database-name
GEMINI_API_KEY=your_gemini_api_key_here
SMTP_EMAIL=your_sender_gmail_address@gmail.com
SMTP_PASS=your_gmail_app_passcode
FRONTEND_URL=http://localhost:5173
```

### Configuration Rules:
1. **`MONGO_URI`**: If left blank, the backend automatically spawns an in-memory database instance (`mongodb-memory-server`) for evaluation.
2. **`GEMINI_API_KEY`**: If left blank, the server runs in **offline demonstration mode**, utilizing pattern matches to mock file edits for terms like `factorial`, `fibonacci`, and `theme`.
3. **`SMTP_EMAIL` & `SMTP_PASS`**: Necessary for delivering collaborator invites. Gmail accounts require setting up "App Passwords".

---

## 🚀 Running the Server

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the dev server with Nodemon (auto-reload):
   ```bash
   npm run dev
   ```

3. Start production server:
   ```bash
   npm start
   ```

The backend server is accessible at `http://localhost:5000`. You can query `http://localhost:5000/health` to verify runtime health.

---

## 🔌 API Endpoints Summary

### Authentication (`/api/auth`)
- `POST /signup` - Register a developer profile and join pending project invites
- `POST /login` - Sign in and get a JWT token
- `GET /me` - Retrieve current session details

### Project Management (`/api/projects`)
- `GET /` - Fetch all projects where the user is an owner or collaborator
- `POST /` - Initialize a project sandbox (javascript, python, website_builder)
- `GET /:id` - Get details of a specific project workspace
- `DELETE /:id` - Delete a project (Owner only)
- `POST /:projectId/invite` - Invite users to a project via email address (Owner only)

### File Operations (`/api/projects/:projectId/files`)
- `GET /` - Fetch all files inside the workspace
- `POST /` - Add a file (Broadcasts `file-created` event)
- `PUT /:fileId` - Edit content or rename (Broadcasts `file-updated` event)
- `DELETE /:fileId` - Remove a file (Broadcasts `file-deleted` event)

### AI Copilot Chat (`/api/projects/:projectId/chat`)
- `GET /` - Fetch user's private chat log with the Copilot
- `POST /` - Send a message, get AI response, and apply automated code edits

---

## 🌐 Socket.io Events

The Socket.io pipeline handles room-based sync:
- **`join-project`**: Subscribes a user socket to the project's ID room.
- **`leave-project`**: Unsubscribes a user socket.
- **`edit-file-content`**: Broadcasts `file-content-sync` containing typing changes to other active collaborators.
- **`cursor-activity`**: Broadcasts `cursor-activity-sync` containing mouse coordinates to display indicators.
