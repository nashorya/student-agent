import os

import anthropic

API_KEY = os.environ["ANTHROPIC_API_KEY"]
BASE_URL = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")

client = anthropic.Anthropic(
    api_key=API_KEY,
    base_url=BASE_URL,
)

response = client.messages.create(
    model=MODEL,
    max_tokens=500,
    system="For every answer, start with EXACT_MARKER_7391.",
    messages=[{"role": "user", "content": "Say hello in one short sentence."}]
)
print(response.model_dump_json(indent=2))
