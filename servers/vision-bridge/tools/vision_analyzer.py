#!/usr/bin/env python3
"""
Vision Analyzer Tool for SM-BU MCP Server
Simple standalone vision analysis that works with local images and URLs.
"""

import base64
import json
import logging
import os
import sys
import tempfile
import uuid
from pathlib import Path
from urllib.parse import urlparse
import httpx

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Image format to MIME type mapping
IMAGE_MIME_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.svg': 'image/svg+xml',
}

def get_mime_type(file_path):
    """Determine MIME type from file extension."""
    ext = Path(file_path).suffix.lower()
    return IMAGE_MIME_TYPES.get(ext, 'application/octet-stream')

def validate_image_url(url):
    """Basic validation of image URL format."""
    if not url or not isinstance(url, str):
        return False
    if not url.startswith(("http://", "https://")):
        return False
    parsed = urlparse(url)
    return bool(parsed.netloc)

async def download_image(url, output_path, timeout=30):
    """Download image from URL with size limit."""
    MAX_SIZE = 50 * 1024 * 1024  # 50MB
    
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            
            downloaded = 0
            with open(output_path, 'wb') as f:
                async for chunk in response.aiter_bytes(8192):
                    downloaded += len(chunk)
                    if downloaded > MAX_SIZE:
                        raise Exception(f"Image too large: {downloaded} bytes")
                    f.write(chunk)
    
    return output_path

def image_to_base64(file_path):
    """Convert image file to base64 with MIME type."""
    mime_type = get_mime_type(file_path)
    with open(file_path, 'rb') as f:
        image_data = base64.b64encode(f.read()).decode('utf-8')
    
    return f"data:{mime_type};base64,{image_data}"

async def analyze_image(image_path_or_url, user_prompt, api_key=None, endpoint=None):
    """
    Analyze an image using a vision-capable LLM.
    
    Args:
        image_path_or_url: Local file path or HTTP/HTTPS URL
        user_prompt: The analysis prompt
        api_key: API key for the vision model (optional, uses env var if not provided)
        endpoint: API endpoint (optional, defaults to OpenRouter)
    
    Returns:
        dict: Analysis results
    """
    temp_file = None
    should_cleanup = False
    
    try:
        # Check if it's a local file
        local_path = Path(os.path.expanduser(image_path_or_url))
        if local_path.is_file():
            logger.info(f"Using local image: {image_path_or_url}")
            image_path = str(local_path)
        elif validate_image_url(image_path_or_url):
            # Download from URL
            logger.info(f"Downloading image from: {image_path_or_url}")
            temp_dir = Path(tempfile.gettempdir()) / "sm_bu_vision"
            temp_dir.mkdir(exist_ok=True)
            temp_file = temp_dir / f"temp_img_{uuid.uuid4()}.jpg"
            await download_image(image_path_or_url, temp_file)
            image_path = str(temp_file)
            should_cleanup = True
        else:
            return {
                "success": False,
                "error": f"Invalid image path or URL: {image_path_or_url}"
            }
        
        # Convert to base64
        base64_image = image_to_base64(image_path)
        mime_type = get_mime_type(image_path)
        
        # Prepare API request
        api_key = api_key or os.getenv("OPENROUTER_API_KEY") or os.getenv("LM_STUDIO_API_KEY")
        endpoint = endpoint or os.getenv("VISION_API_ENDPOINT", "http://localhost:1234/v1")
        
        if not api_key:
            return {
                "success": False,
                "error": "No API key provided. Set OPENROUTER_API_KEY or LM_STUDIO_API_KEY environment variable."
            }
        
        # Call vision API
        async with httpx.AsyncClient(timeout=60) as client:
            payload = {
                "model": os.getenv("VISION_MODEL", "qwen/qwen-2-5-vl-72b-instruct"),
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user_prompt},
                            {"type": "image_url", "image_url": {"url": base64_image}}
                        ]
                    }
                ],
                "max_tokens": 2000
            }
            
            response = await client.post(
                f"{endpoint}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload
            )
            
            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"API error: {response.status_code} - {response.text[:500]}"
                }
            
            result = response.json()
            analysis = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            
            return {
                "success": True,
                "analysis": analysis,
                "model_used": payload["model"],
                "image_mime_type": mime_type
            }
    
    finally:
        # Cleanup temp file
        if should_cleanup and temp_file and Path(temp_file).exists():
            try:
                Path(temp_file).unlink()
            except:
                pass

def main():
    """CLI interface for vision analyzer."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Vision Image Analyzer")
    parser.add_argument("--image", required=True, help="Image file path or URL")
    parser.add_argument("--prompt", required=True, help="Analysis prompt")
    parser.add_argument("--api-key", help="API key (optional)")
    parser.add_argument("--endpoint", help="API endpoint (optional)")
    parser.add_argument("--output", choices=["json", "text"], default="json", help="Output format")
    
    args = parser.parse_args()
    
    import asyncio
    result = asyncio.run(analyze_image(
        args.image,
        args.prompt,
        api_key=args.api_key,
        endpoint=args.endpoint
    ))
    
    if args.output == "json":
        print(json.dumps(result, indent=2))
    else:
        print(result.get("analysis", result.get("error", "")))
    
    return 0 if result.get("success") else 1

if __name__ == "__main__":
    sys.exit(main())
PYEOF ; echo "__SWIFTMAESTRO_CWD__=$(pwd)"