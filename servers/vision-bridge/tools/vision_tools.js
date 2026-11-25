/**
 * Vision Tools for SM-BU MCP Server
 * Analyzes images using native vision model or auxiliary vision model
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import https from 'https';
import http from 'https';

const MAX_IMAGE_SIZE_MB = 20;
const MAX_IMAGE_SIZE = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const SUPPORTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

/**
 * Detect MIME type from file header
 */
function detectMimeType(buffer) {
  const signature = buffer.slice(0, 16).toString('hex').toLowerCase();
  
  if (signature.startsWith('89504e47')) return 'image/png';
  if (signature.startsWith('ffd8ffe0') || signature.startsWith('ffd8ffe1') || signature.startsWith('ffd8ffe3')) return 'image/jpeg';
  if (signature.startsWith('47494638')) return 'image/gif';
  if (signature.startsWith('52494646') && signature.slice(8, 16).toLowerCase().includes('webp')) return 'image/webp';
  
  return 'image/jpeg'; // Default fallback
}

/**
 * Check if main model supports vision natively
 */
function mainModelSupportsVision() {
  try {
    const configsPath = path.join(process.env.HOME, 'Library', 'Application Support', 'SwiftMaestro', 'configs.json');
    if (!fs.existsSync(configsPath)) return false;
    
    const configs = JSON.parse(fs.readFileSync(configsPath, 'utf8'));
    const activeConfig = configs.find(c => c.isActive) || configs[0];
    
    if (!activeConfig) return false;
    
    const visionModels = [
      'claude-3', 'claude-3-5', 'claude-3-7',
      'gemini-2', 'gemini-3',
      'gpt-4o', 'gpt-4-turbo',
      'llava', 'moondream',
      'vision', 'multimodal'
    ];
    
    const modelId = (activeConfig.modelIdentifier || '').toLowerCase();
    return visionModels.some(v => modelId.includes(v));
  } catch {
    return false;
  }
}

/**
 * Get auxiliary vision model from SwiftMaestro configs
 */
function getAuxiliaryVisionModel() {
  try {
    const configsPath = path.join(process.env.HOME, 'Library', 'Application Support', 'SwiftMaestro', 'configs.json');
    if (!fs.existsSync(configsPath)) return null;
    
    const configs = JSON.parse(fs.readFileSync(configsPath, 'utf8'));
    
    // Look for vision-specific model
    const visionConfig = configs.find(c => 
      (c.modelIdentifier || '').toLowerCase().includes('vision') ||
      (c.modelIdentifier || '').toLowerCase().includes('gemini-3-flash')
    );
    
    return visionConfig?.modelIdentifier || 'google/gemini-3-flash-preview';
  } catch {
    return 'google/gemini-3-flash-preview';
  }
}

/**
 * Download image from URL with timeout and size limit
 */
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    let data = Buffer.alloc(0);
    
    const req = protocol.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }
      
      res.on('data', (chunk) => {
        data = Buffer.concat([data, chunk]);
        if (data.length > MAX_IMAGE_SIZE) {
          res.destroy();
          reject(new Error(`Image too large (max ${MAX_IMAGE_SIZE_MB}MB)`));
        }
      });
      
      res.on('end', () => {
        resolve({
          buffer: data,
          mimeType: detectMimeType(data)
        });
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

/**
 * Vision analyze tool - main function
 */
export async function visionAnalyzeTool(imageSource, userPrompt, customModel = null) {
  try {
    // Determine if image is URL or local path
    let buffer, mimeType;
    
    if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
      // Download from URL
      const result = await downloadImage(imageSource);
      buffer = result.buffer;
      mimeType = result.mimeType;
    } else {
      // Local file
      if (!fs.existsSync(imageSource)) {
        return JSON.stringify({
          success: false,
          error: `Image file not found: ${imageSource}`
        });
      }
      
      buffer = fs.readFileSync(imageSource);
      if (buffer.length > MAX_IMAGE_SIZE) {
        return JSON.stringify({
          success: false,
          error: `Image too large (max ${MAX_IMAGE_SIZE_MB}MB)`
        });
      }
      
      mimeType = detectMimeType(buffer);
    }
    
    // Validate MIME type
    if (!mimeType.startsWith('image/')) {
      return JSON.stringify({
        success: false,
        error: `Unsupported file type: ${mimeType}`
      });
    }
    
    // Convert to base64
    const base64Image = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Image}`;
    
    // Check if main model supports vision
    const mainModelHasVision = mainModelSupportsVision();
    
    if (mainModelHasVision) {
      // Native vision path - return image for main model to see
      return JSON.stringify({
        _multimodal: true,
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: dataUrl } }
        ],
        mimeType: mimeType
      });
    } else {
      // Fallback to auxiliary vision model
      const visionModel = customModel || getAuxiliaryVisionModel();
      
      return JSON.stringify({
        _multimodal: false,
        success: true,
        analysis: `Image analysis requested using ${visionModel}. Please process the image data provided.`,
        imageInfo: {
          mimeType: mimeType,
          size: buffer.length,
          base64: dataUrl
        },
        visionModel: visionModel,
        prompt: userPrompt
      });
    }
    
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: error.message
    });
  }
}

/**
 * Video analyze tool (placeholder - can be expanded)
 */
export async function videoAnalyzeTool(videoPath, userPrompt) {
  return JSON.stringify({
    success: false,
    error: 'Video analysis not yet implemented. Use image analysis for screenshots or keyframes.'
  });
}

export default { visionAnalyzeTool, videoAnalyzeTool };
