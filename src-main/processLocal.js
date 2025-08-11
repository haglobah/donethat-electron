const log = require('electron-log');
const { getGeminiApiKey } = require('./main-state');

// Firebase URLs for config and processing
const FIREBASE_CONFIG_URL = 'https://europe-west1-donethat.cloudfunctions.net/inputConfig';
const FIREBASE_PROCESS_URL = 'https://europe-west1-donethat.cloudfunctions.net/inputProcess';

// Cache for config data
let configCache = {
  data: null,
  lastFetch: 0,
  fetchInterval: 60 * 60 * 1000 // 1 hour in milliseconds
};

// LLM models and config (will be initialized when needed)
let llmModels = null;
let promptTemplate = null;
let configParameters = null;
let selectedCategories = null;

/**
 * Check if local processing is available (has Gemini API key)
 */
async function isLocalProcessingAvailable() {
  try {
    const result = await getGeminiApiKey();
    return result.success && result.apiKey;
  } catch (error) {
    log.error('Error checking local processing availability:', error);
    return false;
  }
}

/**
 * Get configuration from Firebase with caching
 */
async function getConfig(idToken) {
  const now = Date.now();
  
  // Return cached config if still valid
  if (configCache.data && (now - configCache.lastFetch) < configCache.fetchInterval) {
    return configCache.data;
  }

  try {
    const fetch = await import('node-fetch').then(module => module.default);
    
    const response = await fetch(FIREBASE_CONFIG_URL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${idToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch config: ${response.status}`);
    }

    const config = await response.json();
    
    if (!config.success) {
      throw new Error('Config fetch returned error');
    }

    // Cache the config
    configCache.data = config;
    configCache.lastFetch = now;
    
    return config;
  } catch (error) {
    log.error('Error fetching config:', error);
    throw error;
  }
}

/**
 * Initialize LLM models and prompt template
 */
async function initializeLLM(idToken) {
  try {
    const config = await getConfig(idToken);
    
    // Store prompt template and config data
    promptTemplate = config.promptTemplate;
    configParameters = config.parameters;
    selectedCategories = config.selectedCategories;
    
    // Get Gemini API key
    const geminiResult = await getGeminiApiKey();
    if (!geminiResult.success || !geminiResult.apiKey) {
      throw new Error('No valid Gemini API key available');
    }
    
    // Initialize LLM models based on config (only Gemini)
    const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
    
    llmModels = config.llmModels
      .filter(modelConfig => modelConfig.provider === 'gemini')
      .map(modelConfig => {
        return new ChatGoogleGenerativeAI({
          apiKey: geminiResult.apiKey,
          model: modelConfig.model,
          maxOutputTokens: modelConfig.maxOutputTokens || 300
        });
      });
    
    log.info(`Initialized ${llmModels.length} LLM models for local processing`);
  } catch (error) {
    log.error('Error initializing LLM:', error);
    throw error;
  }
}

/**
 * Extract text content from LLM response
 */
function extractLLMResponseText(response) {
  if (response && response.content) {
    return typeof response.content === 'string' 
      ? response.content 
      : response.content[0]?.text || '';
  }
  return '';
}

/**
 * Invoke LLM with fallback through multiple models
 */
async function invokeWithFallback(messages) {
  if (!llmModels || llmModels.length === 0) {
    throw new Error('No LLM models available');
  }

  for (const llm of llmModels) {
    try {
      const response = await llm.invoke(messages);
      return response;
    } catch (error) {
      log.error(`LLM ${llm.constructor.name} failed:`, error);
      continue;
    }
  }
  throw new Error("All LLMs failed");
}

/**
 * Build prompt with application activity and audio transcript
 */
function buildPrompt(applicationActivity, audioTranscript = 'No audio transcript available') {
  // Replace placeholders in the prompt template
  let prompt = promptTemplate;
  
  // Replace all parameters from config
  Object.keys(configParameters).forEach(key => {
    let value = configParameters[key];
    
    // Override specific values with actual data
    if (key === 'application_activity') {
      value = applicationActivity || 'No application activity data available';
    } else if (key === 'audio_transcript') {
      value = audioTranscript;
    }
    
    prompt = prompt.replace(`{${key}}`, value);
  });
  
  return prompt;
}

/**
 * Analyze screenshots using local LLM processing
 */
async function analyzeScreenshots(screenshots, previousScreenshots, activity, idToken) {
  try {
    // Validate current screenshots - this is critical
    if (!screenshots || screenshots.length === 0) {
      throw new Error('No current screenshots available for analysis');
    }

    // Validate that all current screenshots have valid data
    // Current screenshots come as data URLs (strings), not objects with base64Data property
    const validScreenshots = screenshots.filter(img => img && typeof img === 'string' && img.startsWith('data:image/'));
    if (validScreenshots.length === 0) {
      throw new Error('No valid screenshot data available for analysis');
    }

    // Initialize LLM if not already done
    if (!llmModels) {
      await initializeLLM(idToken);
    }
    
    // Build the prompt
    const enhancedPrompt = buildPrompt(activity);
    
    // Build content blocks for LangChain
    const blocks = [
      { type: "text", text: enhancedPrompt }
    ];
    
    // Add previous screenshots if available (optional)
    if (previousScreenshots && previousScreenshots.images && previousScreenshots.images.length > 0) {
      blocks.push({ type: "text", text: "PREVIOUS SCREENSHOTS (from 5 minutes ago):" });
      previousScreenshots.images.forEach(img => {
        if (img && img.base64Data) {
          blocks.push({
            type: "image_url",
            image_url: { url: img.base64Data }
          });
        }
      });
      blocks.push({ type: "text", text: "CURRENT SCREENSHOTS:" });
    }
    
    // Add current screenshots (required)
    validScreenshots.forEach(img => {
      blocks.push({
        type: "image_url", 
        image_url: { url: img }
      });
    });

    // Import HumanMessage
    const { HumanMessage } = await import('@langchain/core/messages');

    // Call LLM with fallback
    const response = await invokeWithFallback([
      new HumanMessage({ content: blocks })
    ]);

    return extractLLMResponseText(response);
  } catch (error) {
    log.error('Error in local screenshot analysis:', error);
    throw error;
  }
}



/**
 * Submit processed results to Firebase
 */
async function submitResults(idToken, timestamp, llmResponse) {
  try {
    const fetch = await import('node-fetch').then(module => module.default);
    
    // Prepare payload for Firebase
    const payload = {
      timestamp: timestamp,
      llmResponse: llmResponse,
      selectedCategories: selectedCategories
    };
    
    const response = await fetch(FIREBASE_PROCESS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Failed to submit results: ${response.status}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error('Result submission returned error');
    }

    return result;
  } catch (error) {
    log.error('Error submitting results:', error);
    throw error;
  }
}

/**
 * Main function to process data locally
 */
async function processDataLocally(idToken, screenshots, previousScreenshots, inputData) {
  try {
    // Check if local processing is available
    if (!await isLocalProcessingAvailable()) {
      throw new Error('Local processing not available - no Gemini API key');
    }

    // Format application activity
    let applicationActivity = 'No application activity data available';
    if (inputData.activity && inputData.activity.length > 0) {
      applicationActivity = inputData.activity.map(item => 
        `${item.appName}: ${item.formattedDuration || 'active'}`
      ).join(', ');
    }

    // Analyze screenshots locally
    const llmResponse = await analyzeScreenshots(
      screenshots,
      previousScreenshots,
      applicationActivity,
      idToken
    );

    // Submit results to Firebase
    const result = await submitResults(
      idToken,
      Date.now(),
      llmResponse
    );

    log.info('Local processing completed successfully');
    return result;
  } catch (error) {
    log.error('Error in local processing:', error);
    throw error;
  }
}

module.exports = {
  isLocalProcessingAvailable,
  processDataLocally
};
