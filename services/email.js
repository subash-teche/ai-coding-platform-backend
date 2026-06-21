import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create transporter
const getTransporter = () => {
  const email = process.env.SMTP_EMAIL || 'subash.teche@gmail.com';
  const pass = process.env.SMTP_PASS || 'jkis ufnb vdui lhpc';
  
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: email,
      pass: pass
    }
  });
};

/**
 * Sends a project invitation email
 * @param {Object} options
 * @param {string} options.toEmail
 * @param {string} options.projectName
 * @param {string} options.projectId
 * @param {string} options.inviterName
 * @param {boolean} options.isNewUser
 */
export const sendInviteEmail = async ({ toEmail, projectName, projectId, inviterName, isNewUser }) => {
  try {
    const templatePath = path.join(__dirname, '../templates/invite_template.html');
    let htmlContent = fs.readFileSync(templatePath, 'utf8');

    const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    let inviteUrl = '';
    let ctaText = '';
    let subtext = '';

    if (isNewUser) {
      inviteUrl = `${appUrl}/signup?inviteProject=${projectId}&inviteEmail=${encodeURIComponent(toEmail)}`;
      ctaText = 'Sign Up & Join Project';
      subtext = 'To get started and access this workspace, please create your account by clicking the button below. Once signed up, the project will automatically appear on your active projects dashboard.';
    } else {
      inviteUrl = `${appUrl}/workspace/${projectId}`;
      ctaText = 'Open Project Workspace';
      subtext = 'You already have an account! Click the button below to open this workspace directly and start coding collaboratively.';
    }

    // Replace template tokens
    htmlContent = htmlContent
      .replace(/\{\{inviterName\}\}/g, inviterName)
      .replace(/\{\{projectName\}\}/g, projectName)
      .replace(/\{\{inviteUrl\}\}/g, inviteUrl)
      .replace(/\{\{ctaText\}\}/g, ctaText)
      .replace(/\{\{subtext\}\}/g, subtext);

    const transporter = getTransporter();
    const mailOptions = {
      from: `"MVP Apps Studio" <${process.env.SMTP_EMAIL || 'subash.teche@gmail.com'}>`,
      to: toEmail,
      subject: `Collaboration Invitation: ${projectName}`,
      html: htmlContent
    };

    console.log(`Sending email invitation to ${toEmail} for project ${projectName} (isNewUser: ${isNewUser})...`);
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending invite email:', error);
    throw error;
  }
};
