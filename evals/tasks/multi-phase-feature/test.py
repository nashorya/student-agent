import anthropic

API_KEY = "REDACTED_SECRET"
BASE_URL = "https://work.poloapi.com"
MODEL = "claude-sonnet-4-6"

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
