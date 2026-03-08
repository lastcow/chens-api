import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";

const GEMINI_KEY = process.env.GEMINI_API_KEY!;
const MODEL = "gemini-2.0-flash-exp-image-generation";

const STYLE_PREFIX =
  "tech flat design illustration, flat vector art, minimal geometric shapes, " +
  "professional dark background, gold and teal accent colors, modern business aesthetic, high quality. ";

const PRESETS: Record<string, string> = {
  hero: "futuristic city skyline with glowing data streams and network nodes, wide panoramic view",
  services: "four interconnected gears with digital icons representing business services",
  about: "professional team collaborating around a holographic display in a modern office",
  feature_security: "glowing shield with a lock icon, cybersecurity concept, teal glow",
  feature_analytics: "elegant dashboard with animated charts and data visualization, gold accents",
  feature_cloud: "cloud infrastructure with connected servers and flowing data streams",
  feature_support: "headset with chat bubbles, customer support concept, warm lighting",
};

// POST /api/images/generate
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  try {
    const { prompt, preset, n = 1 } = await req.json();

    const basePrompt = preset && PRESETS[preset] ? PRESETS[preset] : prompt;
    if (!basePrompt) {
      return NextResponse.json({ error: "prompt or preset is required" }, { status: 400 });
    }
    const finalPrompt = STYLE_PREFIX + basePrompt;

    const images: { base64: string; mimeType: string; dataUrl: string }[] = [];

    for (let i = 0; i < Math.min(n, 4); i++) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: finalPrompt }] }],
            generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
          }),
        }
      );

      if (!res.ok) {
        const err = await res.json();
        return NextResponse.json({ error: err?.error?.message || "Gemini API error" }, { status: res.status });
      }

      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const imgPart = parts.find((p: { inlineData?: { data: string; mimeType: string } }) => p.inlineData);

      if (imgPart?.inlineData) {
        images.push({
          base64: imgPart.inlineData.data,
          mimeType: imgPart.inlineData.mimeType || "image/png",
          dataUrl: `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`,
        });
      }
    }

    return NextResponse.json({ images, prompt: finalPrompt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET /api/images/generate?preset=hero — returns raw image binary (cacheable)
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const preset = req.nextUrl.searchParams.get("preset") || "hero";
  const basePrompt = PRESETS[preset] || PRESETS.hero;
  const finalPrompt = STYLE_PREFIX + basePrompt;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: finalPrompt }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    return NextResponse.json({ error: err?.error?.message }, { status: res.status });
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p: { inlineData?: { data: string; mimeType: string } }) => p.inlineData);

  if (!imgPart?.inlineData) {
    return NextResponse.json({ error: "No image returned" }, { status: 500 });
  }

  const buffer = Buffer.from(imgPart.inlineData.data, "base64");
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": imgPart.inlineData.mimeType || "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
