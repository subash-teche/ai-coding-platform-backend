import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
let genAI = null;

if (apiKey) {
  try {
    genAI = new GoogleGenerativeAI(apiKey);
    console.log('Gemini AI Service initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize Gemini AI Service:', error);
  }
} else {
  console.log('Gemini AI Service running in OFFLINE mock mode. Add GEMINI_API_KEY to backend/.env for real AI chat.');
}

// Prompt system instructions to format output as JSON with file edits
const SYSTEM_INSTRUCTIONS = `
You are a highly capable AI assistant inside a web-based coding workspace.
You are helping the user build their project.
You have access to all files in the project workspace.

IMPORTANT: Your response MUST be a JSON object conforming to the following schema. Do NOT return plain text. Do NOT wrap the JSON in markdown code blocks unless it is standard \`\`\`json ... \`\`\`.

Schema:
{
  "reply": "Your explanation, instructions, or answer to the user in markdown format.",
  "edits": [
    {
      "path": "path/to/file.js",
      "content": "The COMPLETE new content of the file. Do not use placeholders or shorten the code."
    }
  ]
}

CRITICAL FOR JSON VALIDITY:
Double quotes (") inside the "reply" and "content" values must be strictly escaped as \\" to avoid breaking JSON syntax. In HTML/CSS/JavaScript files, you can use single quotes (') for attributes/strings where possible to prevent nested double quote conflicts.

If you do not need to create or edit any files, set "edits" to an empty array [].
If you want to edit a file, provide the FULL and COMPLETE content of the file. Do NOT write partial code or comment placeholders like "// rest of code...".
The user will be able to apply these edits directly to their files, so make sure they are correct and clean.
`;

// Robust JSON repair helper to handle unescaped double quotes inside reply/content fields
function repairJson(str) {
  try {
    // Try to parse directly first
    return JSON.parse(str);
  } catch (e) {
    console.log("Direct JSON parse failed, attempting automated repair on unescaped quotes...");
  }

  let repaired = str;
  const contentKeyPattern = /"content"\s*:\s*"/g;
  let match;
  
  // Find all "content": " matches
  const matches = [];
  while ((match = contentKeyPattern.exec(str)) !== null) {
    matches.push(match);
  }

  // Process from right to left so indices don't shift
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const startQuoteIdx = match.index + match[0].length - 1;
    const searchSub = str.substring(startQuoteIdx + 1);
    
    let endQuoteIdx = -1;
    for (let j = searchSub.length - 1; j >= 0; j--) {
      if (searchSub[j] === '"') {
        const after = searchSub.substring(j + 1);
        if (/^(?:\s|\\n)*\}(?:\s|\\n)*(?:,|(?:\s|\\n)*\]|(?:\s|\\n)*\}|(?:\s|\\n)*$)/.test(after)) {
          if (j > 0 && searchSub[j - 1] === '\\') {
            continue;
          }
          endQuoteIdx = startQuoteIdx + 1 + j;
          break;
        }
      }
    }
    
    if (endQuoteIdx !== -1) {
      const rawContent = str.substring(startQuoteIdx + 1, endQuoteIdx);
      const repairedContent = rawContent
        .replace(/(?<!\\)"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
      
      repaired = repaired.substring(0, startQuoteIdx + 1) + repairedContent + repaired.substring(endQuoteIdx);
    }
  }

  // Do the same for "reply" if it contains unescaped double quotes
  const replyKeyPattern = /"reply"\s*:\s*"/g;
  const replyMatches = [];
  while ((match = replyKeyPattern.exec(repaired)) !== null) {
    replyMatches.push(match);
  }

  for (let i = replyMatches.length - 1; i >= 0; i--) {
    const match = replyMatches[i];
    const startQuoteIdx = match.index + match[0].length - 1;
    const searchSub = repaired.substring(startQuoteIdx + 1);
    const endQuoteRegex = /"(?=\s*,\s*"edits"\s*:)/g;
    const endMatch = endQuoteRegex.exec(searchSub);
    
    if (endMatch) {
      const endQuoteIdx = startQuoteIdx + 1 + endMatch.index;
      const rawContent = repaired.substring(startQuoteIdx + 1, endQuoteIdx);
      const repairedContent = rawContent
        .replace(/(?<!\\)"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
      
      repaired = repaired.substring(0, startQuoteIdx + 1) + repairedContent + repaired.substring(endQuoteIdx);
    }
  }

  try {
    return JSON.parse(repaired);
  } catch (err) {
    console.error("JSON repair failed:", err.message);
    throw err;
  }
}

/**
 * Ask AI a question about the project files
 * @param {string} prompt - User request
 * @param {Array} chatHistory - Array of past messages [{role, content}]
 * @param {Array} files - Array of files [{name, path, content}]
 * @param {string} projectType - javascript / python / website_builder
 */
export const askAI = async (prompt, chatHistory, files, projectType) => {
  if (genAI) {
    const modelsToTry = [
      { name: 'gemini-2.5-flash-lite', supportsJson: true }, // Primary static model
      { name: 'gemini-2.0-flash-lite', supportsJson: true },
      { name: 'gemini-2.5-flash', supportsJson: true },
      { name: 'gemini-3.5-flash', supportsJson: true },
      { name: 'gemini-2.0-flash', supportsJson: true },
      { name: 'gemini-flash-latest', supportsJson: true },
      { name: 'gemini-flash-lite-latest', supportsJson: true },
      { name: 'gemini-pro-latest', supportsJson: true }
    ];

    console.log("prompt => ", prompt);
    console.log("chatHistory => ", chatHistory);
    console.log("files => ", files);
    console.log("projectType => ", projectType);

    let responseText = '';
    let success = false;

    for (const modelConfig of modelsToTry) {
      try {
        console.log(`Querying Gemini model: ${modelConfig.name}...`);
        const genOptions = { model: modelConfig.name };

        if (modelConfig.supportsJson) {
          genOptions.generationConfig = { responseMimeType: 'application/json' };
        }

        const model = genAI.getGenerativeModel(genOptions);

        // Construct system context & file contents
        let fileContext = `Project Type: ${projectType}\n\nExisting files in the project workspace:\n`;
        files.forEach(f => {
          fileContext += `\n--- FILE PATH: ${f.path} ---\n${f.content}\n--- END FILE ---\n`;
        });

        let fullPrompt = `${SYSTEM_INSTRUCTIONS}\n\nWorkspace Context:\n${fileContext}\n\nChat History:\n${JSON.stringify(chatHistory)}\n\nUser Request: ${prompt}`;
        if (!modelConfig.supportsJson) {
          fullPrompt += `\n\nREMINDER: You MUST output a valid JSON object matching the requested schema. Do not write any explanations outside the JSON structure.`;
        }

        const result = await model.generateContent(fullPrompt);
        responseText = result.response.text();
        success = true;
        console.log(`Successfully generated content using ${modelConfig.name}.`);
        break; // Exit loop on success
      } catch (err) {
        console.warn(`Gemini API call with ${modelConfig.name} failed:`, err.message);
      }
    }

    if (success) {
      // Parse JSON from response
      try {
        // Strip markdown code block wrappers if any
        let cleanText = responseText.trim();
        if (cleanText.startsWith('```json')) {
          cleanText = cleanText.substring(7);
        } else if (cleanText.startsWith('```')) {
          cleanText = cleanText.substring(3);
        }
        if (cleanText.endsWith('```')) {
          cleanText = cleanText.substring(0, cleanText.length - 3);
        }

        return repairJson(cleanText.trim());
      } catch (parseError) {
        console.error('Failed to parse Gemini JSON response, raw text was:', responseText);
        return {
          reply: `I received a response from Gemini, but had trouble parsing the edit payload: \n\n${responseText}`,
          edits: []
        };
      }
    }
  }

  // Smart Offline Fallback Mode
  return getOfflineAIResponse(prompt, files, projectType);
};

// Generates simulated smart responses for offline demonstration purposes
function getOfflineAIResponse(prompt, files, projectType) {
  const query = prompt.toLowerCase();
  let reply = '';
  let edits = [];

  const note = `\n\n> [!NOTE]\n> **Offline Mode Active:** The AI is running in offline/heuristic mode. To unlock full LLM intelligence and dynamic file modification, add a valid \`GEMINI_API_KEY\` to your \`backend/.env\` file and restart the backend server.`;

  if (query.includes('factorial')) {
    reply = `### Smart Offline AI: Factorial Function Suggested
I have created a factorial calculation demonstration for you. I will add/modify code to calculate factorials. ${note}`;
    if (projectType === 'python') {
      edits = [{
        path: 'main.py',
        content: `# Factorial demonstration added by Offline AI
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print("Factorial of 6 is:", factorial(6))
`
      }];
    } else {
      edits = [{
        path: 'index.js',
        content: `// Factorial demonstration added by Offline AI
function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

console.log("Factorial of 6 is:", factorial(6));
`
      }];
    }
  } else if (query.includes('fibonacci')) {
    reply = `### Smart Offline AI: Fibonacci Series Suggested
I've updated your workspace with a Fibonacci calculator that prints the first N Fibonacci numbers. ${note}`;
    if (projectType === 'python') {
      edits = [{
        path: 'main.py',
        content: `# Fibonacci series added by Offline AI
def fibonacci(n):
    sequence = [0, 1]
    while len(sequence) < n:
        sequence.append(sequence[-1] + sequence[-2])
    return sequence[:n]

print("Fibonacci sequence (10 items):", fibonacci(10))
`
      }];
    } else {
      edits = [{
        path: 'index.js',
        content: `// Fibonacci series added by Offline AI
function fibonacci(n) {
  const sequence = [0, 1];
  while (sequence.length < n) {
    sequence.push(sequence[sequence.length - 1] + sequence[sequence.length - 2]);
  }
  return sequence.slice(0, n);
}

console.log("Fibonacci sequence (10 items):", fibonacci(10));
`
      }];
    }
  } else if (projectType === 'website_builder' && (query.includes('color') || query.includes('theme') || query.includes('dark') || query.includes('light') || query.includes('style'))) {
    reply = `### Smart Offline AI: Custom UI Styler
I have added a glassmorphism card component with an indigo border glow style to your HTML file, and updated the CSS to add styling styles. ${note}`;

    // Find index.html, update it
    const indexHtml = files.find(f => f.path === 'index.html');
    const existingHtml = indexHtml ? indexHtml.content : '';

    // Add custom styled badge/div
    const updatedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tailwind Sandbox Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="styles.css">
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex items-center justify-center p-4">
  <div class="max-w-md w-full bg-slate-900 border border-violet-500 rounded-3xl p-8 shadow-2xl relative overflow-hidden group custom-border-glow">
    <div class="absolute -right-10 -top-10 w-40 h-40 bg-violet-600/30 rounded-full blur-3xl group-hover:bg-violet-600/40 transition-all duration-700"></div>
    <div class="absolute -left-10 -bottom-10 w-40 h-40 bg-indigo-600/30 rounded-full blur-3xl group-hover:bg-indigo-600/40 transition-all duration-700"></div>

    <div class="relative z-10">
      <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-violet-500/10 text-violet-400 border border-violet-500/20 mb-4 animate-pulse-slow">
        ✨ AI Styled Interface
      </div>
      <h1 class="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-indigo-400">
        Live Website Preview
      </h1>
      <p class="mt-4 text-slate-400 leading-relaxed text-sm">
        Offline AI successfully modified this layout to inject a custom border glow effect and animation.
      </p>
      
      <div class="mt-6 flex flex-col gap-3">
        <button id="counter-btn" class="w-full py-3 px-6 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-95 text-white rounded-2xl font-semibold shadow-lg shadow-violet-900/30 transition-all duration-300">
          Click Count: 0
        </button>
      </div>
    </div>
  </div>
  <script src="script.js"></script>
</body>
</html>`;

    edits = [{
      path: 'index.html',
      content: updatedHtml
    }];
  } else {
    // Default reply
    reply = `### Smart Offline Coding Assistant
Hello! I can answer your coding questions and help you modify your workspace.

**Try asking me to:**
- "implement a factorial function" or "suggest a fibonacci code" to watch me edit JavaScript/Python files automatically.
- "change style" or "add a dark theme" in a Website Builder workspace to see me edit Tailwind layouts in real time.

Your workspace details:
- Project Type: \`${projectType}\`
- Files in project: ${files.map(f => `\`${f.path}\``).join(', ')}

${note}`;
  }

  return { reply, edits };
}

export const reviewProject = async (files, projectType) => {
  if (genAI) {
    const modelsToTry = [
      { name: 'gemini-2.5-flash-lite', supportsJson: true },
      { name: 'gemini-2.0-flash-lite', supportsJson: true },
      { name: 'gemini-2.5-flash', supportsJson: true },
      { name: 'gemini-3.5-flash', supportsJson: true },
      { name: 'gemini-2.0-flash', supportsJson: true },
      { name: 'gemini-flash-latest', supportsJson: true },
      { name: 'gemini-flash-lite-latest', supportsJson: true },
      { name: 'gemini-pro-latest', supportsJson: true }
    ];

    let filesContext = '';
    files.forEach(f => {
      filesContext += `\n--- FILE PATH: ${f.path} ---\n${f.content}\n--- END FILE ---\n`;
    });

    const prompt = `You are an expert software engineer and code reviewer.
Analyze the following files in the project and perform a detailed code review focusing on three aspects:
1. Security (vulnerabilities, hardcoded secrets, weak logic, etc.)
2. Performance (redundant calculations, memory leaks, slow loops, etc.)
3. Readability & Cleanliness (structure, formatting, standard conventions)

Project Type: ${projectType}

Existing project files:
${filesContext}

IMPORTANT: Your response MUST be a JSON object matching the schema below. Do NOT include markdown code block wrappers around the JSON. Return only the JSON object itself.
CRITICAL FOR JSON VALIDITY: Double quotes (") inside JSON string values must be strictly escaped as \\" to prevent syntax errors.

Schema:
{
  "score": 85, // Overall project health score out of 100
  "summary": "Brief 1-2 sentence overall summary of the project health.",
  "metrics": {
    "security": { "grade": "A", "score": 95, "details": "Summary of security findings" },
    "performance": { "grade": "B-", "score": 80, "details": "Summary of performance findings" },
    "readability": { "grade": "A+", "score": 98, "details": "Summary of cleanliness/readability findings" }
  },
  "suggestions": [
    {
      "id": "unique-id-1",
      "path": "path/to/file.js", // The EXACT relative path of the file this suggestion applies to (must match one of the files listed above)
      "category": "security", // "security", "performance", or "readability"
      "impact": "high", // "high", "medium", or "low"
      "title": "Title of the finding",
      "description": "Explanation of the finding and recommendation.",
      "originalCode": "The EXACT code snippet to replace.",
      "refactoredCode": "The EXACT refactored code snippet to replace with."
    }
  ]
}

If there are no security, performance, or readability issues, keep "suggestions" as an empty array [].
For each suggestion, the 'originalCode' MUST be a unique and exact substring present in the file content of the file specified by 'path' so it can be auto-replaced. Do not truncate the originalCode or refactoredCode.`;

    let responseText = '';
    let success = false;

    for (const modelConfig of modelsToTry) {
      try {
        console.log(`Querying Gemini model for Code Review: ${modelConfig.name}...`);
        const genOptions = { model: modelConfig.name };

        if (modelConfig.supportsJson) {
          genOptions.generationConfig = { responseMimeType: 'application/json' };
        }

        const model = genAI.getGenerativeModel(genOptions);
        const result = await model.generateContent(prompt);
        responseText = result.response.text();
        success = true;
        console.log(`Successfully generated code review using ${modelConfig.name}.`);
        break;
      } catch (err) {
        console.warn(`Gemini API call for Code Review with ${modelConfig.name} failed:`, err.message);
      }
    }

    if (success) {
      try {
        let cleanText = responseText.trim();
        if (cleanText.startsWith('```json')) {
          cleanText = cleanText.substring(7);
        } else if (cleanText.startsWith('```')) {
          cleanText = cleanText.substring(3);
        }
        if (cleanText.endsWith('```')) {
          cleanText = cleanText.substring(0, cleanText.length - 3);
        }
        return JSON.parse(cleanText.trim());
      } catch (parseError) {
        console.error('Failed to parse Gemini Code Review response, raw text was:', responseText);
      }
    }
  }

  // Fallback to offline review mode
  return getOfflineReviewResponse(files, projectType);
};

// Generates smart simulated reviews for offline fallback demo purposes
function getOfflineReviewResponse(files, projectType) {
  const suggestions = [];
  let securityScore = 95;
  let performanceScore = 90;
  let readabilityScore = 92;

  files.forEach(file => {
    const fileContent = file.content;
    const filePath = file.path;

    // 1. Check for unencrypted URL/HTTPS (Security)
    if (fileContent.includes('http://') && !fileContent.includes('http://localhost')) {
      securityScore -= 15;
      suggestions.push({
        id: `sec-http-${filePath}`,
        path: filePath,
        category: 'security',
        impact: 'high',
        title: 'Use Secure HTTPS Protocol',
        description: `The file ${filePath} references an unencrypted HTTP link. This exposes data to potential man-in-the-middle attacks. Always use HTTPS.`,
        originalCode: 'http://',
        refactoredCode: 'https://'
      });
    }

    // 2. Check for hardcoded credentials/secrets
    const credentialsRegex = /(api[_-]?key|secret|password|token)\s*=\s*['"`][a-zA-Z0-9_\-*]{5,}['"`]/i;
    const dbUriRegex = /mongodb\+srv:\/\/[^'"`]+/i;

    if (credentialsRegex.test(fileContent) || dbUriRegex.test(fileContent)) {
      securityScore -= 25;

      let original = '';
      let refactored = '';
      const matchUri = fileContent.match(dbUriRegex);
      const matchSecret = fileContent.match(credentialsRegex);

      if (matchUri) {
        original = matchUri[0];
        refactored = 'process.env.MONGO_URI || "mongodb://localhost:27017/local"';
      } else if (matchSecret) {
        original = matchSecret[0];
        const keyName = matchSecret[1].toUpperCase().replace(/-/g, '_');
        refactored = `${matchSecret[1]} = process.env.${keyName}`;
      }

      suggestions.push({
        id: `sec-secret-${filePath}`,
        path: filePath,
        category: 'security',
        impact: 'high',
        title: 'Hardcoded Credentials or Connection URL',
        description: `Sensitive credentials (such as API keys, secrets, or MongoDB connection strings) inside ${filePath} should not be hardcoded in plain text. Store them in environmental variables.`,
        originalCode: original || 'apiKey = "key"',
        refactoredCode: refactored || 'apiKey = process.env.API_KEY'
      });
    }

    // 3. Check for nested loops (Performance)
    const nestedLoopRegex = /(for\s*\(.*{[\s\S]*?for\s*\(|while\s*\(.*{[\s\S]*?while\s*\()/;
    if (nestedLoopRegex.test(fileContent)) {
      performanceScore -= 15;
      suggestions.push({
        id: `perf-nested-${filePath}`,
        path: filePath,
        category: 'performance',
        impact: 'medium',
        title: 'Nested Loop Complexity',
        description: `Found nested loops in ${filePath} which may result in O(N^2) time complexity. Consider using a hash map/lookup cache to reduce search overhead to O(N).`,
        originalCode: 'for',
        refactoredCode: 'for /* Consider mapping indices to hash lookup */'
      });
    }

    // 4. Check for unhandled fetch errors (Readability/Cleanliness)
    if (fileContent.includes('fetch(') && !fileContent.includes('.catch') && !fileContent.includes('try {')) {
      readabilityScore -= 15;
      suggestions.push({
        id: `read-fetch-error-${filePath}`,
        path: filePath,
        category: 'readability',
        impact: 'medium',
        title: 'Unhandled Promise Rejection in Fetch',
        description: `Network requests inside ${filePath} can fail due to connectivity issues. Wrap your fetch call in a try/catch block or use a promise catch handler to manage network errors gracefully.`,
        originalCode: 'fetch(',
        refactoredCode: 'try {\n    fetch('
      });
    }
  });

  // 5. Default suggestion if code looks too clean to keep it interesting
  if (suggestions.length === 0 && files.length > 0) {
    const defaultFile = files[0];
    suggestions.push({
      id: `read-convention-${defaultFile.path}`,
      path: defaultFile.path,
      category: 'readability',
      impact: 'low',
      title: 'Add inline documentation',
      description: `The file ${defaultFile.path} is cleanly written, but adding docstrings or comment explanations for your main logic will improve readability for collaborators.`,
      originalCode: defaultFile.content.includes('function') ? 'function' : defaultFile.content.substring(0, 20),
      refactoredCode: defaultFile.content.includes('function') ? '/**\n * Helper function\n */\nfunction' : `/* Project File */\n${defaultFile.content.substring(0, 20)}`
    });
  }

  // Bound scores
  securityScore = Math.max(40, securityScore);
  performanceScore = Math.max(45, performanceScore);
  readabilityScore = Math.max(50, readabilityScore);
  const totalScore = Math.round((securityScore + performanceScore + readabilityScore) / 3);

  const getGrade = (score) => {
    if (score >= 95) return 'A+';
    if (score >= 90) return 'A';
    if (score >= 85) return 'B+';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    return 'D';
  };

  return {
    score: totalScore,
    summary: `Heuristic Code Review Completed for ${files.length} file(s). ${suggestions.length} potential area(s) of improvement detected.`,
    metrics: {
      security: { grade: getGrade(securityScore), score: securityScore, details: securityScore > 80 ? 'No major vulnerabilities detected.' : 'Sensitive information or insecure protocols identified.' },
      performance: { grade: getGrade(performanceScore), score: performanceScore, details: performanceScore > 80 ? 'Execution flow appears optimized.' : 'Potential loop complexities detected.' },
      readability: { grade: getGrade(readabilityScore), score: readabilityScore, details: readabilityScore > 80 ? 'Conforms to standards.' : 'Error handling or documentation can be improved.' }
    },
    suggestions
  };
}
