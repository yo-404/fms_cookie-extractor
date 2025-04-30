require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.json());

// Authentication middleware
const authenticateToken = (req, res, next) => {
  // Get the authorization header
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  
  // Check if token matches expected value
  if (token !== process.env.API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
  
  next();
};

// Browser automation function
async function getBrowserCookies() {
  // Get configuration from environment variables
  const username = process.env.FMS_USERNAME || 'admin';
  const password = process.env.FMS_PASSWORD || 'password';
  const loginUrl = process.env.FMS_LOGIN_URL || 'https://fms.goddardschool.com/login.aspx?ReturnUrl=%2f';
  const showBrowser = process.env.SHOW_BROWSER === 'true';

  // Launch the browser
  const browser = await puppeteer.launch({
    headless: !showBrowser,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // Helpful for running in containers
  });

  try {
    // Open a new page
    const page = await browser.newPage();
    
    // Navigate to the website
    console.log(`Navigating to the Goddard School FMS login page: ${loginUrl}...`);
    await page.goto(loginUrl, {
      waitUntil: 'networkidle2', // Wait until the network is idle
    });
    
    // Wait for the login form elements to be available
    console.log('Waiting for login form to load...');
    await page.waitForSelector('#loginName');
    await page.waitForSelector('#loginPass');
    await page.waitForSelector('#loginButton');
    
    // Get the elements using selectors
    const usernameInput = await page.$('#loginName');
    const passwordInput = await page.$('#loginPass');
    const loginButton = await page.$('#loginButton');
    
    // Type username and password
    console.log(`Entering credentials for user: ${username}...`);
    await usernameInput.type(username);
    await passwordInput.type(password);
    
    // Click the login button
    console.log('Clicking login button...');
    await loginButton.click();
    
    // Wait for navigation after login
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    console.log('Login successful!');
    
    // Get all cookies
    const cookies = await page.cookies();
    
    // Format cookies in the desired string format
    const cookieStr = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    
    return {
      cookieString: cookieStr,
      cookieObjects: cookies
    };
  } catch (error) {
    console.error('An error occurred during automation:', error);
    throw error;
  } finally {
    // Close the browser
    await browser.close();
    console.log('Browser closed.');
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Cookie retrieval endpoint with token auth
app.post('/api/cookies', authenticateToken, async (req, res) => {
  try {
    console.log('Received authenticated request for cookie retrieval');
    const cookies = await getBrowserCookies();
    res.status(200).json({ 
      success: true, 
      cookies: cookies.cookieString,
      cookieObjects: cookies.cookieObjects
    });
  } catch (error) {
    console.error('Error retrieving cookies:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to retrieve cookies',
      message: error.message
    });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check available at: http://localhost:${PORT}/health`);
  console.log(`Cookie API available at: http://localhost:${PORT}/api/cookies`);
});

// Health check cron job
const serverUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;
cron.schedule('*/5 * * * *', async () => {
  try {
    const response = await axios.get(`${serverUrl}/health`);
    console.log(`Health check response: ${response.status} at ${new Date().toISOString()}`);
  } catch (error) {
    console.error(`Health check error: ${error.message}`);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

module.exports = { app, server }; // Export for testing