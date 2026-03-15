# Google AI Studio — Model Reference for Tilly Live Ops

> **Last verified:** 15 March 2026 from [ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models)
> **API Key Tier:** Paid (billing enabled via AI Studio)

---

## Two-Model Architecture

We use exactly **2 models** — one for live voice, one for everything else.

| Purpose | Model String | Marketing Name | SDK Method |
|---------|-------------|----------------|------------|
| **Live Voice** | `gemini-2.5-flash-native-audio-preview-12-2025` | Gemini 2.5 Flash Live Preview | Live API (WebSocket) |
| **Text + Image** | `gemini-3.1-flash-image-preview` | Nano Banana 2 🍌🍌 | `generateContent` |

### Why two models?

- The **Live API** (real-time bidirectional audio) is only supported by `gemini-2.5-flash-native-audio-preview-12-2025`. No other model can do streaming audio in/out. This is non-negotiable.
- **Everything else** (text planning, JSON structured output, AND image generation) runs through the single `gemini-3.1-flash-image-preview` model. This is multimodal — it returns both text and images via the standard `generateContent` method.

---

## Nano Banana Image Models (for reference)

All use `generateContent` (NOT `generateImages`). Images come back as `inlineData` parts.

| Name | Model String | Resolution | Cost/Image | Notes |
|------|-------------|-----------|------------|-------|
| **Nano Banana 2** 🍌🍌 | `gemini-3.1-flash-image-preview` | Up to 4K | ~$0.045–$0.151 | **We use this** — best balance |
| **Nano Banana Pro** 🍌 | `gemini-3-pro-image-preview` | Up to 4K | ~$0.134–$0.24 | Studio quality, thinking |
| **Nano Banana** 🍌 | `gemini-2.5-flash-image` | 1024px | ~$0.039 | Cheapest, fast |

### Imagen 4 (different API — NOT used)

Uses `generateImages` instead of `generateContent`. Different response format.

| Name | Model String |
|------|-------------|
| Imagen 4 Standard | `imagen-4.0-generate-001` |
| Imagen 4 Ultra | `imagen-4.0-ultra-generate-001` |
| Imagen 4 Fast | `imagen-4.0-fast-generate-001` |

---

## SDK Usage — JavaScript (`@google/genai`)

```javascript
// TEXT (structured JSON response)
const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: "your prompt",
    config: { responseMimeType: "application/json" }
});
const text = response.candidates[0].content.parts[0].text;

// IMAGE (same model, same method!)
const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: "Generate a hero image for a pizza promotion",
});
for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
        const base64 = part.inlineData.data;
        const mime = part.inlineData.mimeType; // image/png
    }
}
```

---

## Key Gotchas

1. **Nano Banana models use `generateContent`**, NOT `generateImages`
2. **Imagen 4 uses `generateImages`** — completely different method and response format
3. **The Live API model cannot generate images** — only audio streaming
4. **All generated images include a SynthID watermark**
5. **Preview models** may change before becoming stable
